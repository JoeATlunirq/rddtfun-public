// Team members/roles (Settings → Team) and the Script board (/scripts). Mirrors backend/services/teamService.js.
export type TeamRole = 'owner' | 'editor' | 'scriptwriter' | 'viewer';
export type ScriptStatus = 'scripting' | 'to_edit' | 'to_post' | 'posted';
export type ScriptFormat = 'short' | 'long';
export type ScriptPerformance = 'flop' | 'average' | 'good' | 'viral';

export const ROLE_INFO: Record<TeamRole, { label: string; description: string }> = {
    owner: { label: 'Owner', description: 'Everything, including the team' },
    editor: { label: 'Editor', description: 'Manages boards and every script; no team access' },
    scriptwriter: { label: 'Scriptwriter', description: 'Adds scripts and edits their own until they move past To Edit' },
    viewer: { label: 'Viewer', description: 'Reads boards and comments only' },
};
export const ASSIGNABLE_ROLES: TeamRole[] = ['editor', 'scriptwriter', 'viewer'];

export const STATUS_INFO: Record<ScriptStatus, { label: string; dot: string; column: string }> = {
    scripting: { label: 'Scripting', dot: 'bg-sky-400', column: 'bg-sky-400/5' },
    to_edit: { label: 'To Edit', dot: 'bg-pink-400', column: 'bg-pink-400/5' },
    to_post: { label: 'To Post', dot: 'bg-amber-400', column: 'bg-amber-400/5' },
    posted: { label: 'Posted', dot: 'bg-emerald-400', column: 'bg-emerald-400/5' },
};
export const STATUSES: ScriptStatus[] = ['scripting', 'to_edit', 'to_post', 'posted'];

export const PERFORMANCE_LABELS: Record<ScriptPerformance, string> = {
    flop: 'Flop',
    average: 'Average',
    good: 'Good',
    viral: 'Viral',
};

export interface WorkspacePermissions {
    role: TeamRole;
    manageTeam: boolean;
    manageBoards: boolean;
    createScripts: boolean;
    comment: boolean;
    statuses: ScriptStatus[];
}

export interface Workspace {
    owner_id: string;
    owner_email: string | null;
    role: TeamRole;
    permissions: WorkspacePermissions;
}

export interface TeamMember {
    id: string;
    email: string;
    role: Exclude<TeamRole, 'owner'>;
    user_id: string | null;
    invite_token: string | null;
    accepted_at: string | null;
    created_at: string;
}

export interface ChannelSummary {
    id: string;
    name: string;
    image_url: string | null;
}

export interface ScriptBoard {
    id: string;
    name: string;
    channel_profile_id: string | null;
    channel: ChannelSummary | null;
    created_at: string;
}

export interface Script {
    id: string;
    board_id: string;
    number: number;
    title: string;
    status: ScriptStatus;
    format: ScriptFormat;
    hook: string;
    body: string;
    tags: string[];
    edited_video_url: string | null;
    source_video_url: string | null;
    post_date: string | null;
    goal: string | null;
    performance: ScriptPerformance | null;
    author_id: string | null;
    author_email: string | null;
    comment_count: number;
    permissions: { edit: boolean; delete: boolean };
    created_at: string;
    updated_at: string;
}

export interface ScriptComment {
    id: string;
    body: string;
    author_id: string | null;
    author_email: string | null;
    can_delete: boolean;
    created_at: string;
}

export function inviteLink(token: string) {
    return `${window.location.origin}/join?token=${encodeURIComponent(token)}`;
}
