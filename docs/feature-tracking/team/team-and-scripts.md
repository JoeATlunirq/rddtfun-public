# Team members, roles and the Script board

**Status:** implemented
**Next step / blockers:** apply `supabase/migrations/20261103120000_add_team_and_scripts.sql`. Until then the backend
stores everything in `backend/data/team_scripts.json`, which isn't moved to Supabase automatically.

## Purpose

The owner invites people (for example a scriptwriter) into their account. Teammates drop video scripts onto a
per-channel board, and the owner edits, films and posts them. This replaces the owner's Notion boards
("YouTube Video for Billy Diaries", and so on).

## Intended behavior

- **Settings → Team** (owner): invite by email with a role, change roles, remove people, copy a pending invite link.
  The section also lists the teams this account has joined, each with a Leave button.
- **Invites** are one-time links: `/join?token=…`.
  - Someone with no account signs up from the link without a signup code. That makes a **team-only account**
    (`app_metadata.team_only`). It sees only Scripts and Settings → Team. The backend returns 403 on every other
    `/api` path, and the frontend sends other routes to `/scripts`.
  - Someone who already has an account signs in and accepts. Their sign-in email must match the invite. They keep
    their own workspace and get a workspace switcher on `/scripts`.
- **Script board** (`/scripts`): one board per channel. A board can link to a Channel Profile, which gives it a name
  and avatar.
  - Columns go Scripting → To Edit → To Post. Posted is collapsed into a pill that shows its count. Drag a card to move it.
  - Table view; search, filters (status, format, tag) and sort (number, post date, last edited); New.
  - A card has a number (per board, auto), title, status, format (short/long), post date, goal, performance, links
    (edited video, source video), tags, a hook and the script, plus comments.

## Roles

| Role | Team | Boards | Scripts | Comments |
|---|---|---|---|---|
| Owner (implicit) | manage | add/edit/delete | everything | add, delete any |
| Editor | — | add/edit/delete | everything | add, delete any |
| Scriptwriter | — | read | add; edit/delete **own** while Scripting/To Edit; can only set those two statuses | add, delete own |
| Viewer | — | read | read | read |

## Must-preserve invariants

- All role checks live in `backend/services/teamService.js`. The UI hides what the API would refuse, using the
  `permissions` objects the API sends back, but it never decides access itself.
- The workspace is picked with the `X-Workspace-Id` header (the owner's user id). When it's missing, the caller's own
  workspace is used. Team-only accounts have no workspace of their own.
- Every row stores `owner_id`, and every lookup filters on it. Changing the board or script id in a request can't
  reach another owner's data.

## Contracts, security, compatibility

- `GET /api/team-invites/:token` is public: it returns only the invite email, role and owner email. Everything else
  needs auth.
- Invite tokens are 24 random bytes and are cleared once accepted. Signing up from an invite needs the matching
  email. If accepting fails, the newly created auth user is deleted.
- Links have to be http(s). Text fields have length caps (see `sanitizeScriptInput`).

## Main implementation locations

- `supabase/migrations/20261103120000_add_team_and_scripts.sql`
- `backend/services/teamService.js` (rules), `backend/services/teamStore.js` (Supabase / JSON storage),
  `backend/routes/team.js` (HTTP)
- `backend/server.js`: invite signup branch in `/api/auth/signup`, team-only gate in the `/api` auth middleware,
  router mounts
- `src/pages/Scripts.tsx`, `src/components/ScriptEditor.tsx`, `src/components/TeamSettings.tsx`, `src/pages/Join.tsx`,
  `src/types/scripts.ts`

## Verification

- `npm test`: `backend/utils/teamService.test.js` covers the role rules, input checks, and a full HTTP run of
  invite → accept → board → create, move and comment → role change → removal → leave.
- In the browser (real UI and routers, stubbed login): invite, accept and the team-only navigation; adding a board from
  a channel; a scriptwriter creating a script and handing it off; drag between columns; the Posted pill; table view;
  the redirect away from owner-only routes.
