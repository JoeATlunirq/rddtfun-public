# RddtFun

Turn Reddit-style stories into short-form (9:16) and long-form (16:9) narrated videos: script, text-to-speech, word-timed captions, hook cards and gameplay backgrounds, rendered locally with Skia + FFmpeg.

## Requirements

- Node.js 20+
- `ffmpeg` and `ffprobe` on your `PATH` (macOS: `brew install ffmpeg`)
- A free [Supabase](https://supabase.com) project (login and database)
- Optional: Python 3.12+ for the local TTS / Whisper server in `backend/local-tts/`

## Setup

```bash
git clone <this repo> && cd RddtFun
npm install
cp .env.example .env
```

1. In Supabase, run the SQL files in `supabase/migrations/` in order (SQL editor, or `supabase db push` with the CLI).
2. Put your project's URL, anon key and service key into `.env` (`SUPABASE_*` and `VITE_SUPABASE_*`).
3. Drop some gameplay clips (`.mp4`) into `backend/public/background-videos/` (or point `BACKGROUND_CLIPS_DIR` at a folder). For long-form, use `backend/public/background-videos-16x9/` or `LANDSCAPE_CLIPS_DIR`.
4. Start everything:

   ```bash
   npm run dev:all
   ```

   Frontend: http://localhost:5173 · Backend: http://localhost:3000

5. Sign up in the app, then add your TTS / AI API keys on the **Settings** page.

Everything else in `.env.example` is optional; features without keys are just unavailable.

### Optional extras

- **Local TTS + word timings:** `backend/local-tts/start.sh` (Pocket TTS / Whisper on :3910). Put reference voices in `backend/local-tts/voices/<name>.wav` + `<name>.txt` (the transcript); this folder is gitignored.
- **Fish Drama 3 on Modal:** see the header of `backend/cloud-tts/fish_drama.py`.
- **One-command macOS launcher:** `scripts/start-local.sh` starts the TTS server, backend and frontend and opens the browser. `scripts/RddtFun.applescript` wraps it as a Dock app (instructions inside).

## Development

```bash
npm test          # unit tests
npm run lint
npm run build     # frontend build
npm run render:bench -- --duration 12   # renderer smoke test
```

Feature specs live in `docs/feature-tracking/` (renderer: `docs/feature-tracking/rendering/local-renderer.md`).

## What stays private

Your `.env`, generated videos/audio, job data (`backend/data/`), voice samples, background clips and database dumps are all gitignored. Keep it that way: don't commit API keys or other people's data.

## License

[MIT](LICENSE)
