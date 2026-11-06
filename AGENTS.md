# AGENTS.md

## Run (everything local)
- Frontend + backend: `npm run dev:all` (Vite dev server + `backend/server.js` on `PORT`, default 3000)
- Backend only: `npm run backend`
- Requires system `ffmpeg`/`ffprobe` (Homebrew `ffmpeg` is fine).

## Verify
- Unit tests: `npm test` (`backend/utils/*.test.js`, `backend/render/*.test.js`)
- Lint: `npm run lint` (backend files have many pre-existing `no-unused-vars` warnings; no errors expected)
- Frontend build: `npm run build`
- Renderer smoke/benchmark: `npm run render:bench -- --duration 12` (options: `--filter`, `--anim`, `--hook fall|float`, `--top`, `--music`, `--out`)

## Video rendering
- Videos render locally with Skia + FFmpeg in `backend/render/` (not Remotion/Lambda). Spec: `docs/feature-tracking/rendering/local-renderer.md`.
- Render cache lives in `backend/.render-cache/` (gitignored, safe to delete).

## Conventions
- Feature specs live in `docs/feature-tracking/`; update the relevant spec with behavior changes.
