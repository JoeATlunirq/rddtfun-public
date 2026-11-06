import crypto from 'crypto';

// Team members + roles and the Script board. A workspace is one owner's account; members
// reach it with the role the owner gave them. All role checks happen here (the routes
// only translate HTTP), so the rules below are the single source of truth.
export const ASSIGNABLE_ROLES = ['editor', 'scriptwriter', 'viewer'];
export const SCRIPT_STATUSES = ['scripting', 'to_edit', 'to_post', 'posted'];
export const SCRIPT_FORMATS = ['short', 'long'];
export const PERFORMANCE_LEVELS = ['flop', 'average', 'good', 'viral'];
// A scriptwriter hands a script to the owner by moving it to "To Edit"; past that it's the editor's.
const WRITER_STATUSES = ['scripting', 'to_edit'];

export class HttpError extends Error {
    constructor(status, message) {
        super(message);
        this.status = status;
    }
}

/** What a role may do in a workspace (sent to the page so it can hide what the API would refuse). */
export function workspacePermissions(role) {
    const full = role === 'owner' || role === 'editor';
    return {
        role,
        manageTeam: role === 'owner',
        manageBoards: full,
        createScripts: full || role === 'scriptwriter',
        comment: role !== 'viewer',
        statuses: full ? SCRIPT_STATUSES : role === 'scriptwriter' ? WRITER_STATUSES : [],
    };
}

/** Owners/editors change any script; scriptwriters only their own until it leaves "To Edit". */
export function scriptPermissions(role, script, userId) {
    if (role === 'owner' || role === 'editor') return { edit: true, delete: true };
    const own = role === 'scriptwriter' && script.author_id === userId && WRITER_STATUSES.includes(script.status);
    return { edit: own, delete: own };
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function normalizeEmail(value) {
    const email = String(value || '').trim().toLowerCase();
    if (!EMAIL_RE.test(email) || email.length > 320) throw new HttpError(400, 'Enter a valid email address');
    return email;
}

function checkRole(role) {
    if (!ASSIGNABLE_ROLES.includes(role)) throw new HttpError(400, `Role must be one of: ${ASSIGNABLE_ROLES.join(', ')}`);
    return role;
}

function text(value, max, label) {
    const out = String(value ?? '').trim();
    if (out.length > max) throw new HttpError(400, `${label} is over ${max.toLocaleString()} characters`);
    return out;
}

function optionalUrl(value, label) {
    const out = text(value, 2000, label);
    if (!out) return null;
    try {
        const url = new URL(out);
        if (url.protocol === 'http:' || url.protocol === 'https:') return out;
    } catch { /* fall through */ }
    throw new HttpError(400, `${label} must be an http(s) link`);
}

function oneOf(value, allowed, label, { nullable = false } = {}) {
    if (nullable && (value === null || value === '')) return null;
    if (!allowed.includes(value)) throw new HttpError(400, `${label} must be one of: ${allowed.join(', ')}`);
    return value;
}

/** Cleans the editable script fields present in `input`; unknown keys are dropped. */
export function sanitizeScriptInput(input = {}) {
    const out = {};
    const has = key => Object.prototype.hasOwnProperty.call(input, key);
    if (has('title')) out.title = text(input.title, 200, 'Title');
    if (has('hook')) out.hook = text(input.hook, 2000, 'Hook');
    if (has('body')) out.body = text(input.body, 120_000, 'Script');
    if (has('goal')) out.goal = text(input.goal, 200, 'Goal') || null;
    if (has('status')) out.status = oneOf(input.status, SCRIPT_STATUSES, 'Status');
    if (has('format')) out.format = oneOf(input.format, SCRIPT_FORMATS, 'Format');
    if (has('performance')) out.performance = oneOf(input.performance, PERFORMANCE_LEVELS, 'Performance', { nullable: true });
    if (has('edited_video_url')) out.edited_video_url = optionalUrl(input.edited_video_url, 'Edited video');
    if (has('source_video_url')) out.source_video_url = optionalUrl(input.source_video_url, 'Source video');
    if (has('post_date')) {
        const date = input.post_date ? String(input.post_date) : null;
        if (date && !/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new HttpError(400, 'Post date must be YYYY-MM-DD');
        out.post_date = date;
    }
    if (has('tags')) {
        if (!Array.isArray(input.tags)) throw new HttpError(400, 'Tags must be a list');
        const tags = [...new Set(input.tags.map(tag => text(tag, 40, 'Tag')).filter(Boolean))];
        if (tags.length > 20) throw new HttpError(400, 'Up to 20 tags per script');
        out.tags = tags;
    }
    return out;
}

/**
 * @param {object} deps
 * @param {object|(() => Promise<object>)} deps.store - teamStore, or a function resolving one
 * @param {(ownerId: string) => Promise<{id, name, image_url}[]>} [deps.listChannelProfiles]
 */
export function createTeamService({ store, listChannelProfiles = async () => [] }) {
    const db = () => Promise.resolve(typeof store === 'function' ? store() : store);

    async function access(user, workspaceId) {
        const ownerId = workspaceId || user.id;
        if (ownerId === user.id) {
            if (user.teamOnly) throw new HttpError(403, 'This account only works inside the teams it was invited to');
            return { ownerId, role: 'owner' };
        }
        const member = await (await db()).get('team_members', { owner_id: ownerId, user_id: user.id });
        if (!member) throw new HttpError(404, 'Workspace not found');
        return { ownerId, role: member.role };
    }

    function requireOwnerTeam(user) {
        if (user.teamOnly) throw new HttpError(403, 'Team accounts cannot invite members');
    }

    async function boardFor(ownerId, boardId) {
        const board = await (await db()).get('script_boards', { id: boardId, owner_id: ownerId });
        if (!board) throw new HttpError(404, 'Board not found');
        return board;
    }

    async function scriptFor(ownerId, scriptId) {
        const script = await (await db()).get('scripts', { id: scriptId, owner_id: ownerId });
        if (!script) throw new HttpError(404, 'Script not found');
        return script;
    }

    const scriptView = (script, ctx, user, commentCount) => ({
        ...script,
        comment_count: commentCount,
        permissions: scriptPermissions(ctx.role, script, user.id),
    });

    return {
        // ---- Workspaces ------------------------------------------------------------------
        async listWorkspaces(user) {
            const memberships = await (await db()).list('team_members', { user_id: user.id });
            const own = user.teamOnly ? [] : [{ owner_id: user.id, owner_email: user.email, role: 'owner' }];
            return [...own, ...memberships.map(m => ({ owner_id: m.owner_id, owner_email: m.owner_email, role: m.role }))]
                .map(w => ({ ...w, permissions: workspacePermissions(w.role) }));
        },

        // ---- Team (the signed-in owner's own workspace) -------------------------------------
        async listMembers(user) {
            requireOwnerTeam(user);
            const members = await (await db()).list('team_members', { owner_id: user.id });
            return members.sort((a, b) => a.created_at.localeCompare(b.created_at));
        },

        async inviteMember(user, { email, role }) {
            requireOwnerTeam(user);
            const address = normalizeEmail(email);
            if (address === String(user.email || '').toLowerCase()) throw new HttpError(400, 'You already own this workspace');
            const store = await db();
            const existing = await store.list('team_members', { owner_id: user.id });
            if (existing.some(m => m.email === address)) throw new HttpError(409, `${address} is already on your team`);
            return store.insert('team_members', {
                owner_id: user.id,
                owner_email: user.email || null,
                user_id: null,
                email: address,
                role: checkRole(role),
                invite_token: crypto.randomBytes(24).toString('base64url'),
                accepted_at: null,
            });
        },

        async updateMemberRole(user, memberId, role) {
            requireOwnerTeam(user);
            const store = await db();
            if (!await store.get('team_members', { id: memberId, owner_id: user.id })) throw new HttpError(404, 'Member not found');
            return store.update('team_members', memberId, { role: checkRole(role) });
        },

        async removeMember(user, memberId) {
            requireOwnerTeam(user);
            const store = await db();
            if (!await store.get('team_members', { id: memberId, owner_id: user.id })) throw new HttpError(404, 'Member not found');
            await store.remove('team_members', { id: memberId, owner_id: user.id });
        },

        async leaveWorkspace(user, ownerId) {
            const store = await db();
            if (!await store.get('team_members', { owner_id: ownerId, user_id: user.id })) throw new HttpError(404, 'Workspace not found');
            await store.remove('team_members', { owner_id: ownerId, user_id: user.id });
        },

        // ---- Invites -------------------------------------------------------------------------
        /** Public preview for the join page; null once used or revoked. */
        async getInvite(token) {
            if (!token) return null;
            const invite = await (await db()).get('team_members', { invite_token: String(token) });
            return invite && !invite.user_id
                ? { email: invite.email, role: invite.role, owner_email: invite.owner_email }
                : null;
        },

        async acceptInvite(user, token) {
            const store = await db();
            const invite = token ? await store.get('team_members', { invite_token: String(token) }) : null;
            if (!invite || invite.user_id) throw new HttpError(404, 'This invite link is invalid or was already used');
            if (invite.email !== String(user.email || '').toLowerCase()) {
                throw new HttpError(403, `This invite is for ${invite.email}. Sign in with that email to accept it.`);
            }
            if (invite.owner_id === user.id) throw new HttpError(400, 'You already own this workspace');
            return store.update('team_members', invite.id, { user_id: user.id, invite_token: null, accepted_at: new Date().toISOString() });
        },

        // ---- Boards --------------------------------------------------------------------------
        async listBoards(user, workspaceId) {
            const ctx = await access(user, workspaceId);
            const [boards, channels] = await Promise.all([
                (await db()).list('script_boards', { owner_id: ctx.ownerId }),
                listChannelProfiles(ctx.ownerId).catch(() => []),
            ]);
            const channelById = new Map(channels.map(c => [c.id, c]));
            return {
                permissions: workspacePermissions(ctx.role),
                channels: ctx.role === 'owner' || ctx.role === 'editor' ? channels : [],
                boards: boards
                    .sort((a, b) => a.created_at.localeCompare(b.created_at))
                    .map(board => ({ ...board, channel: channelById.get(board.channel_profile_id) || null })),
            };
        },

        async createBoard(user, workspaceId, { name, channel_profile_id }) {
            const ctx = await access(user, workspaceId);
            if (!workspacePermissions(ctx.role).manageBoards) throw new HttpError(403, 'Only the owner or an editor can add boards');
            const title = text(name, 80, 'Board name');
            if (!title) throw new HttpError(400, 'Board name is required');
            return (await db()).insert('script_boards', { owner_id: ctx.ownerId, name: title, channel_profile_id: channel_profile_id || null });
        },

        async updateBoard(user, workspaceId, boardId, { name, channel_profile_id }) {
            const ctx = await access(user, workspaceId);
            if (!workspacePermissions(ctx.role).manageBoards) throw new HttpError(403, 'Only the owner or an editor can edit boards');
            await boardFor(ctx.ownerId, boardId);
            const patch = {};
            if (name !== undefined) {
                patch.name = text(name, 80, 'Board name');
                if (!patch.name) throw new HttpError(400, 'Board name is required');
            }
            if (channel_profile_id !== undefined) patch.channel_profile_id = channel_profile_id || null;
            return (await db()).update('script_boards', boardId, patch);
        },

        async deleteBoard(user, workspaceId, boardId) {
            const ctx = await access(user, workspaceId);
            if (!workspacePermissions(ctx.role).manageBoards) throw new HttpError(403, 'Only the owner or an editor can delete boards');
            await boardFor(ctx.ownerId, boardId);
            await (await db()).remove('script_boards', { id: boardId, owner_id: ctx.ownerId });
        },

        // ---- Scripts -------------------------------------------------------------------------
        async listScripts(user, workspaceId, boardId) {
            const ctx = await access(user, workspaceId);
            await boardFor(ctx.ownerId, boardId);
            const store = await db();
            const [scripts, comments] = await Promise.all([
                store.list('scripts', { board_id: boardId, owner_id: ctx.ownerId }),
                store.list('script_comments', { owner_id: ctx.ownerId }),
            ]);
            const counts = new Map();
            for (const c of comments) counts.set(c.script_id, (counts.get(c.script_id) || 0) + 1);
            return scripts.sort((a, b) => a.number - b.number).map(s => scriptView(s, ctx, user, counts.get(s.id) || 0));
        },

        async createScript(user, workspaceId, boardId, input) {
            const ctx = await access(user, workspaceId);
            const perms = workspacePermissions(ctx.role);
            if (!perms.createScripts) throw new HttpError(403, 'Your role cannot add scripts');
            await boardFor(ctx.ownerId, boardId);
            const fields = sanitizeScriptInput(input);
            const status = fields.status || 'scripting';
            if (!perms.statuses.includes(status)) throw new HttpError(403, 'Your role cannot use that status');
            const store = await db();
            const siblings = await store.list('scripts', { board_id: boardId, owner_id: ctx.ownerId });
            const script = await store.insert('scripts', {
                title: '', hook: '', body: '', goal: null, format: 'short', performance: null, tags: [],
                edited_video_url: null, source_video_url: null, post_date: null,
                ...fields,
                status,
                owner_id: ctx.ownerId,
                board_id: boardId,
                number: siblings.reduce((max, s) => Math.max(max, s.number), 0) + 1,
                author_id: user.id,
                author_email: user.email || null,
            });
            return scriptView(script, ctx, user, 0);
        },

        async getScript(user, workspaceId, scriptId) {
            const ctx = await access(user, workspaceId);
            const script = await scriptFor(ctx.ownerId, scriptId);
            const comments = (await (await db()).list('script_comments', { script_id: scriptId, owner_id: ctx.ownerId }))
                .sort((a, b) => a.created_at.localeCompare(b.created_at))
                .map(c => ({ ...c, can_delete: c.author_id === user.id || workspacePermissions(ctx.role).manageBoards }));
            return { script: scriptView(script, ctx, user, comments.length), comments };
        },

        async updateScript(user, workspaceId, scriptId, input) {
            const ctx = await access(user, workspaceId);
            const script = await scriptFor(ctx.ownerId, scriptId);
            if (!scriptPermissions(ctx.role, script, user.id).edit) throw new HttpError(403, 'You cannot edit this script');
            const fields = sanitizeScriptInput(input);
            if (fields.status && !workspacePermissions(ctx.role).statuses.includes(fields.status)) {
                throw new HttpError(403, 'Your role cannot move scripts to that status');
            }
            const store = await db();
            const updated = await store.update('scripts', scriptId, fields);
            const comments = await store.list('script_comments', { script_id: scriptId, owner_id: ctx.ownerId });
            return scriptView(updated, ctx, user, comments.length);
        },

        async deleteScript(user, workspaceId, scriptId) {
            const ctx = await access(user, workspaceId);
            const script = await scriptFor(ctx.ownerId, scriptId);
            if (!scriptPermissions(ctx.role, script, user.id).delete) throw new HttpError(403, 'You cannot delete this script');
            await (await db()).remove('scripts', { id: scriptId, owner_id: ctx.ownerId });
        },

        async addComment(user, workspaceId, scriptId, body) {
            const ctx = await access(user, workspaceId);
            if (!workspacePermissions(ctx.role).comment) throw new HttpError(403, 'Viewers cannot comment');
            await scriptFor(ctx.ownerId, scriptId);
            const message = text(body, 4000, 'Comment');
            if (!message) throw new HttpError(400, 'Comment is empty');
            const comment = await (await db()).insert('script_comments', {
                owner_id: ctx.ownerId,
                script_id: scriptId,
                author_id: user.id,
                author_email: user.email || null,
                body: message,
            });
            return { ...comment, can_delete: true };
        },

        async deleteComment(user, workspaceId, scriptId, commentId) {
            const ctx = await access(user, workspaceId);
            const store = await db();
            const comment = await store.get('script_comments', { id: commentId, script_id: scriptId, owner_id: ctx.ownerId });
            if (!comment) throw new HttpError(404, 'Comment not found');
            if (comment.author_id !== user.id && !workspacePermissions(ctx.role).manageBoards) {
                throw new HttpError(403, 'You can only delete your own comments');
            }
            await store.remove('script_comments', { id: commentId, owner_id: ctx.ownerId });
        },
    };
}
