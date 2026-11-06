// /api/team (members, roles, invites) and /api/scripts (Script board). Role rules live in
// services/teamService.js; these routers only map HTTP onto it.
import express from 'express';
import { HttpError } from '../services/teamService.js';

/** The signed-in user as the team service sees it. Team-only = created from an invite link. */
export function teamUser(authUser) {
    return {
        id: authUser.id,
        email: authUser.email || null,
        teamOnly: authUser.app_metadata?.team_only === true,
    };
}

// API paths a team-only account may call (everything else is the owner's tooling).
export const TEAM_ONLY_PATHS = /^\/(team|scripts)(\/|$)/;

const handle = fn => async (req, res) => {
    try {
        await fn(req, res);
    } catch (error) {
        if (error instanceof HttpError) return res.status(error.status).json({ error: error.message });
        console.error('[Team]', error.message);
        res.status(500).json({ error: 'Something went wrong' });
    }
};

/** Mounted before the auth middleware: the join page previews an invite while signed out. */
export function createPublicInviteRouter(service) {
    const router = express.Router();
    router.get('/:token', handle(async (req, res) => {
        const invite = await service.getInvite(req.params.token);
        if (!invite) return res.status(404).json({ error: 'This invite link is invalid or was already used' });
        res.json({ invite });
    }));
    return router;
}

export function createTeamRouter(service) {
    const router = express.Router();
    const user = req => teamUser(req.authUser);

    router.get('/workspaces', handle(async (req, res) => {
        res.json({ workspaces: await service.listWorkspaces(user(req)) });
    }));
    router.post('/workspaces/:ownerId/leave', handle(async (req, res) => {
        await service.leaveWorkspace(user(req), req.params.ownerId);
        res.json({ success: true });
    }));

    router.get('/members', handle(async (req, res) => {
        res.json({ members: await service.listMembers(user(req)) });
    }));
    router.post('/members', handle(async (req, res) => {
        res.status(201).json({ member: await service.inviteMember(user(req), req.body || {}) });
    }));
    router.put('/members/:id', handle(async (req, res) => {
        res.json({ member: await service.updateMemberRole(user(req), req.params.id, req.body?.role) });
    }));
    router.delete('/members/:id', handle(async (req, res) => {
        await service.removeMember(user(req), req.params.id);
        res.json({ success: true });
    }));

    router.post('/invites/:token/accept', handle(async (req, res) => {
        res.json({ member: await service.acceptInvite(user(req), req.params.token) });
    }));

    return router;
}

export function createScriptsRouter(service) {
    const router = express.Router();
    // Which workspace (owner's user id) the request is for; defaults to the caller's own.
    const ctx = req => [teamUser(req.authUser), req.get('x-workspace-id') || undefined];

    router.get('/boards', handle(async (req, res) => {
        res.json(await service.listBoards(...ctx(req)));
    }));
    router.post('/boards', handle(async (req, res) => {
        res.status(201).json({ board: await service.createBoard(...ctx(req), req.body || {}) });
    }));
    router.put('/boards/:id', handle(async (req, res) => {
        res.json({ board: await service.updateBoard(...ctx(req), req.params.id, req.body || {}) });
    }));
    router.delete('/boards/:id', handle(async (req, res) => {
        await service.deleteBoard(...ctx(req), req.params.id);
        res.json({ success: true });
    }));

    router.get('/boards/:id/scripts', handle(async (req, res) => {
        res.json({ scripts: await service.listScripts(...ctx(req), req.params.id) });
    }));
    router.post('/boards/:id/scripts', handle(async (req, res) => {
        res.status(201).json({ script: await service.createScript(...ctx(req), req.params.id, req.body || {}) });
    }));

    router.get('/:id', handle(async (req, res) => {
        res.json(await service.getScript(...ctx(req), req.params.id));
    }));
    router.put('/:id', handle(async (req, res) => {
        res.json({ script: await service.updateScript(...ctx(req), req.params.id, req.body || {}) });
    }));
    router.delete('/:id', handle(async (req, res) => {
        await service.deleteScript(...ctx(req), req.params.id);
        res.json({ success: true });
    }));

    router.post('/:id/comments', handle(async (req, res) => {
        res.status(201).json({ comment: await service.addComment(...ctx(req), req.params.id, req.body?.body) });
    }));
    router.delete('/:id/comments/:commentId', handle(async (req, res) => {
        await service.deleteComment(...ctx(req), req.params.id, req.params.commentId);
        res.json({ success: true });
    }));

    return router;
}
