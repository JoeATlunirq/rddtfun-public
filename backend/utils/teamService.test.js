import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import express from 'express';
import { createTeamService, sanitizeScriptInput, scriptPermissions, workspacePermissions } from '../services/teamService.js';
import { createFileStore } from '../services/teamStore.js';
import { createPublicInviteRouter, createScriptsRouter, createTeamRouter, TEAM_ONLY_PATHS } from '../routes/team.js';

const OWNER = { id: 'owner-1', email: 'owner@example.com' };
const WRITER = { id: 'writer-1', email: 'writer@example.com', app_metadata: { team_only: true } };
const EDITOR = { id: 'editor-1', email: 'editor@example.com' };
const VIEWER = { id: 'viewer-1', email: 'viewer@example.com' };
const STRANGER = { id: 'stranger-1', email: 'stranger@example.com' };
const USERS = Object.fromEntries([OWNER, WRITER, EDITOR, VIEWER, STRANGER].map(u => [u.id, u]));

test('role permissions', () => {
    assert.equal(workspacePermissions('owner').manageTeam, true);
    assert.equal(workspacePermissions('editor').manageTeam, false);
    assert.equal(workspacePermissions('editor').manageBoards, true);
    assert.deepEqual(workspacePermissions('scriptwriter').statuses, ['scripting', 'to_edit']);
    assert.equal(workspacePermissions('viewer').createScripts, false);
    assert.equal(workspacePermissions('viewer').comment, false);

    const own = { author_id: 'w', status: 'scripting' };
    assert.deepEqual(scriptPermissions('scriptwriter', own, 'w'), { edit: true, delete: true });
    assert.deepEqual(scriptPermissions('scriptwriter', { ...own, status: 'to_post' }, 'w'), { edit: false, delete: false });
    assert.deepEqual(scriptPermissions('scriptwriter', own, 'someone-else'), { edit: false, delete: false });
    assert.deepEqual(scriptPermissions('editor', own, 'x'), { edit: true, delete: true });
    assert.deepEqual(scriptPermissions('viewer', own, 'w'), { edit: false, delete: false });
});

test('script input is cleaned and validated', () => {
    assert.deepEqual(sanitizeScriptInput({ title: '  6 SF ', tags: ['POV: male', 'POV: male', ' '], userId: 'x' }), {
        title: '6 SF',
        tags: ['POV: male'],
    });
    assert.equal(sanitizeScriptInput({ performance: '' }).performance, null);
    assert.equal(sanitizeScriptInput({ edited_video_url: '' }).edited_video_url, null);
    assert.throws(() => sanitizeScriptInput({ status: 'done' }), /Status/);
    assert.throws(() => sanitizeScriptInput({ source_video_url: 'javascript:alert(1)' }), /http/);
    assert.throws(() => sanitizeScriptInput({ post_date: '11/03/2026' }), /YYYY-MM-DD/);
});

test('team-only accounts are limited to team and script endpoints', () => {
    assert.ok(TEAM_ONLY_PATHS.test('/scripts/boards'));
    assert.ok(TEAM_ONLY_PATHS.test('/team/workspaces'));
    assert.ok(!TEAM_ONLY_PATHS.test('/user-settings/abc'));
    assert.ok(!TEAM_ONLY_PATHS.test('/teamwork'));
});

async function startServer() {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'team-test-'));
    const service = createTeamService({
        store: createFileStore(path.join(dir, 'team_scripts.json')),
        listChannelProfiles: async ownerId => ownerId === OWNER.id ? [{ id: 'chan-1', name: 'Billy Diaries', image_url: null }] : [],
    });
    const app = express();
    app.use(express.json());
    app.use('/api/team-invites', createPublicInviteRouter(service));
    // Stand-in for server.js auth: the test picks the user with a header
    app.use('/api', (req, res, next) => {
        req.authUser = USERS[req.get('x-test-user')];
        if (!req.authUser) return res.status(401).json({ error: 'Authentication required' });
        next();
    });
    app.use('/api/team', createTeamRouter(service));
    app.use('/api/scripts', createScriptsRouter(service));
    const server = await new Promise(resolve => {
        const s = app.listen(0, () => resolve(s));
    });
    const base = `http://127.0.0.1:${server.address().port}`;
    const call = async (user, method, url, body, workspace) => {
        const headers = { 'content-type': 'application/json' };
        if (user) headers['x-test-user'] = user.id;
        if (workspace) headers['x-workspace-id'] = workspace;
        const res = await fetch(base + url, { method, headers, body: body ? JSON.stringify(body) : undefined });
        return { status: res.status, body: await res.json() };
    };
    return { call, close: () => { server.close(); fs.rmSync(dir, { recursive: true, force: true }); } };
}

test('owner invites members and roles gate the Script board end to end', async t => {
    const { call, close } = await startServer();
    t.after(close);
    const ws = OWNER.id;

    // Owner invites a scriptwriter, an editor and a viewer
    const invite = async (email, role) => (await call(OWNER, 'POST', '/api/team/members', { email, role })).body.member;
    const writerInvite = await invite('Writer@Example.com', 'scriptwriter');
    assert.equal(writerInvite.email, 'writer@example.com');
    assert.ok(writerInvite.invite_token);
    const editorInvite = await invite(EDITOR.email, 'editor');
    const viewerInvite = await invite(VIEWER.email, 'viewer');
    assert.equal((await call(OWNER, 'POST', '/api/team/members', { email: EDITOR.email, role: 'viewer' })).status, 409);
    assert.equal((await call(OWNER, 'POST', '/api/team/members', { email: 'x@example.com', role: 'owner' })).status, 400);
    // Team-only accounts cannot build their own team
    assert.equal((await call(WRITER, 'POST', '/api/team/members', { email: 'y@example.com', role: 'viewer' })).status, 403);

    // Invite links: public preview, email must match, one-time use
    const preview = await call(null, 'GET', `/api/team-invites/${writerInvite.invite_token}`);
    assert.deepEqual(preview.body.invite, { email: 'writer@example.com', role: 'scriptwriter', owner_email: OWNER.email });
    assert.equal((await call(STRANGER, 'POST', `/api/team/invites/${writerInvite.invite_token}/accept`)).status, 403);
    assert.equal((await call(WRITER, 'POST', `/api/team/invites/${writerInvite.invite_token}/accept`)).status, 200);
    assert.equal((await call(WRITER, 'POST', `/api/team/invites/${writerInvite.invite_token}/accept`)).status, 404);
    assert.equal((await call(null, 'GET', `/api/team-invites/${writerInvite.invite_token}`)).status, 404);
    await call(EDITOR, 'POST', `/api/team/invites/${editorInvite.invite_token}/accept`);
    await call(VIEWER, 'POST', `/api/team/invites/${viewerInvite.invite_token}/accept`);

    // Workspaces: team-only writer sees only the owner's; a normal account also sees its own
    const writerSpaces = (await call(WRITER, 'GET', '/api/team/workspaces')).body.workspaces;
    assert.deepEqual(writerSpaces.map(w => [w.owner_id, w.role]), [[OWNER.id, 'scriptwriter']]);
    const editorSpaces = (await call(EDITOR, 'GET', '/api/team/workspaces')).body.workspaces;
    assert.deepEqual(editorSpaces.map(w => w.role), ['owner', 'editor']);
    assert.equal((await call(WRITER, 'GET', '/api/scripts/boards')).status, 403); // no own workspace
    assert.equal((await call(STRANGER, 'GET', '/api/scripts/boards', null, ws)).status, 404);

    // Boards: owner/editor only, linked to a channel profile
    assert.equal((await call(WRITER, 'POST', '/api/scripts/boards', { name: 'Billy Diaries' }, ws)).status, 403);
    const board = (await call(OWNER, 'POST', '/api/scripts/boards', { name: 'Billy Diaries', channel_profile_id: 'chan-1' }, ws)).body.board;
    const boards = (await call(WRITER, 'GET', '/api/scripts/boards', null, ws)).body;
    assert.equal(boards.boards[0].channel.name, 'Billy Diaries');
    assert.equal(boards.permissions.role, 'scriptwriter');
    assert.deepEqual(boards.channels, []); // channel list is for board managers only

    // Scriptwriter adds a script, numbered per board, then hands it off to "To Edit"
    const create = (user, body) => call(user, 'POST', `/api/scripts/boards/${board.id}/scripts`, body, ws);
    const first = (await create(WRITER, { title: 'Blocked my number', hook: 'My son blocked my number…', body: 'Script', tags: ['POV: male'] })).body.script;
    assert.equal(first.number, 1);
    assert.equal(first.status, 'scripting');
    assert.equal(first.author_email, WRITER.email);
    assert.deepEqual(first.permissions, { edit: true, delete: true });
    assert.equal((await create(WRITER, { status: 'posted' })).status, 403);
    assert.equal((await create(VIEWER, { title: 'nope' })).status, 403);
    const second = (await create(OWNER, { title: 'Owner draft' })).body.script;
    assert.equal(second.number, 2);

    const update = (user, id, body) => call(user, 'PUT', `/api/scripts/${id}`, body, ws);
    assert.equal((await update(WRITER, second.id, { title: 'hijack' })).status, 403); // not theirs
    assert.equal((await update(WRITER, first.id, { status: 'to_post' })).status, 403); // past hand-off
    assert.equal((await update(WRITER, first.id, { status: 'to_edit' })).body.script.status, 'to_edit');
    // Editor takes it forward; then it's locked for the writer
    const moved = (await update(EDITOR, first.id, { status: 'to_post', edited_video_url: 'https://drive.example.com/v.mp4' })).body.script;
    assert.equal(moved.status, 'to_post');
    assert.equal((await update(WRITER, first.id, { title: 'late fix' })).status, 403);
    assert.equal((await call(WRITER, 'DELETE', `/api/scripts/${first.id}`, null, ws)).status, 403);
    assert.equal((await update(VIEWER, second.id, { title: 'x' })).status, 403);

    // Comments: viewers read only; authors and managers can delete
    const comment = (await call(WRITER, 'POST', `/api/scripts/${first.id}/comments`, { body: 'POV: MALE\nSCRP: grm 2.0' }, ws)).body.comment;
    assert.equal((await call(VIEWER, 'POST', `/api/scripts/${first.id}/comments`, { body: 'hi' }, ws)).status, 403);
    const detail = (await call(VIEWER, 'GET', `/api/scripts/${first.id}`, null, ws)).body;
    assert.equal(detail.comments.length, 1);
    assert.equal(detail.comments[0].can_delete, false);
    const listed = (await call(OWNER, 'GET', `/api/scripts/boards/${board.id}/scripts`, null, ws)).body.scripts;
    assert.deepEqual(listed.map(s => [s.number, s.comment_count]), [[1, 1], [2, 0]]);
    assert.equal((await call(VIEWER, 'DELETE', `/api/scripts/${first.id}/comments/${comment.id}`, null, ws)).status, 403);
    assert.equal((await call(EDITOR, 'DELETE', `/api/scripts/${first.id}/comments/${comment.id}`, null, ws)).status, 200);

    // Role change and removal take effect immediately
    await call(OWNER, 'PUT', `/api/team/members/${viewerInvite.id}`, { role: 'scriptwriter' });
    assert.equal((await create(VIEWER, { title: 'now allowed' })).status, 201);
    assert.equal((await call(EDITOR, 'PUT', `/api/team/members/${viewerInvite.id}`, { role: 'editor' })).status, 404);
    await call(OWNER, 'DELETE', `/api/team/members/${writerInvite.id}`);
    assert.equal((await call(WRITER, 'GET', '/api/scripts/boards', null, ws)).status, 404);

    // Deleting a board removes its scripts
    assert.equal((await call(EDITOR, 'DELETE', `/api/scripts/boards/${board.id}`, null, ws)).status, 200);
    assert.equal((await call(OWNER, 'GET', `/api/scripts/${second.id}`, null, ws)).status, 404);

    // Members can leave a workspace
    assert.equal((await call(VIEWER, 'POST', `/api/team/workspaces/${OWNER.id}/leave`)).status, 200);
    assert.deepEqual((await call(VIEWER, 'GET', '/api/team/workspaces')).body.workspaces.map(w => w.role), ['owner']);
});
