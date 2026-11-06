# Long-form video + linked promo short

**Status:** in progress. Pipeline, renderer, job queue, page, thumbnail and CTA arrow work end to end with a cloned local voice (Pocket TTS). Look matched to QuokkaReads on 2026-10-27.
**Next step / blockers:**
- run one real 50k-character job and record TTS/render minutes
- clip prep re-encodes whole source clips (first use of each clip is slow; see Dependencies)
- move the gameplay libraries from local folders to S3

## Purpose
Copy the format of the big Reddit-story channels (e.g. QuokkaReads): a 40–50 min **16:9** story on gameplay, and a ~3 min **9:16 promo short** of the same story that ends with "Full story on my channel linked below" and a red arrow at YouTube's related-video link. One job makes both videos plus the thumbnail.

## Intended behavior
- **Long Form page** (`/longform`): channel, and a long and a short tab, each with its own hook, script and voice / caption / hook-card presets ("Channel default" falls back to the channel profile). Submitting creates a background job.
- **Job list:**
  - step progress, live ETA, cancel, and resume (failed or cancelled jobs)
  - when done: download links for both videos and the thumbnail, the thumbnail preview, and a copy-able upload checklist
- **Each video has its own hook.** The long hook opens the long video and is the thumbnail title and its library title; the short hook opens the promo short and is its library title. Older jobs with one shared `input.title` still resume with it (`hookFor`).
- **Both videos start with the hook card** while their own hook is narrated, then single-word captions follow the narration.
  - Short: portrait renderer, the caption preset and hook style, the channel's background type (or `PROMO_CLIPS_DIR`). The script gets the CTA line appended (with a period closing the story first) if its last 160 chars don't already say it.
  - **Short follows its audio preset like a regular short:** the target length (fixed, or picked at random from the preset's min–max range once in `prepare`, kept in `shortTargetSeconds`) caps title + story + CTA together; longer audio is sped up by one factor with `applyTimeStretch` (pitch kept, word timings scaled, `fitToTarget`), shorter audio stays 1×. The preset's background music (`addBackgroundMusic` + `customMusicUrl` at `musicVolumeDb`) is mixed in (`presetMusic`). The job card shows each video's real length once it's voiced; until then an estimate for the job's voice, with the short capped at the target.
  - **Hook captions:** when the card is at the top or floating, captions under it follow the narrated title's word timings (`hookCaptionWords`), showing the card's own wording when Whisper heard the same number of words.
  - **The CTA is voiced as its own clip**, never as part of the story's last chunk: Fish Drama can end a chunk early and drop its last sentence (it did on job `3e8edff9`). `splitCta` keeps the script's own closing CTA wording or adds `CTA_LINE`; `voiceCta` checks with Whisper that the line was said, re-voices up to 3 times, and otherwise fails the step rather than delivering a short without it. Captions come from the known text (`ctaCaptionWords`). It joins the story after a 0.25 s pause.
  - **CTA arrow** (`layers/ctaArrow.js`), copied from QuokkaReads: flat `#FD3000` arrow pointing straight down at the bottom left, bobbing. Shown **only while the CTA is spoken**: from the start of the CTA audio (`ctaStartSec`, scaled with any speed-up) to the end of the video.
  - Long: landscape 1920×1080, no music, not mirrored, 6 Mbps (`LONGFORM_VIDEO_BITRATE`), gameplay from the landscape library. **Light Reddit card** whatever the preset's colours (white, `#111` text, Inter ExtraBold, no ••• menu) at 1.6× centered. **Captions 1.25× the preset size, centered on the frame's center line** (`position: 'center'` + `opticalCenter`: one steady baseline per font, with the middle of the letters, halfway between the capital and lowercase centers, on the line).
  - Hook text is Title Case in both videos (`toTitleCase`).
- **Thumbnail** (`render/thumbnail.js`), measured from QuokkaReads: 1280×720, white, 150 px avatar at (10,10), 48 px name + badge, 40 px awards with a dark drop shadow (they blend into white otherwise), then the **Title Case title in Inter ExtraBold at the largest size that fills y 166–672** (124→52 px, so short titles don't leave dead space), and a small ♡ 99+ 💬 99+ / Share footer.
- **Linking the short to the long video is manual** (YouTube's API can't set a Short's related video). The upload checklist says where.

## Implemented / unfinished
- **Done:**
  - renderer `format: 'landscape'`, chunked resumable render (`resumeDir`), cue cursor
  - `ctaArrow`, `videoBitrate`
  - job queue, pipeline, `/api/longform` routes
  - Long Form page, 16:9 cards in the Library (detected by the `-long.mp4` filename); submitting keeps the inputs and scrolls to the new job
  - thumbnail, CTA arrow and long-form card/captions matched to QuokkaReads
  - local narration: Pocket TTS with a cloned voice, pauses cut, 1.15× tempo (below)
- **Not done:**
  - DB columns linking short ↔ long (`videos.kind` / `parent_video_id`); the link lives in the job file only

## Long hooks
The hook is narrated in full, so its text is never cut. `HookCard` starts the title at 45 px and shrinks it (down to 20 px) until the card fits 92% of the frame height, then scales the whole card as a last resort; short hooks are unchanged. Long videos use title line height 1.1. The thumbnail title fits the same way (124→30 px), with an ellipsis only past that.

## Must-preserve invariants
- **Every step resumes:**
  - narration chunks (`chunk-NNNN.json` + mp3, or `localTtsService`'s `chunk-NNN.wav/.json`) are reused when their text is unchanged; local chunks with estimated timings get re-transcribed, not re-synthesized
  - render segments are reused when the render input hash (`resume.json`) is unchanged
  - finished steps are skipped
  - a job never pays for the same TTS twice
- **Jobs survive the browser and the server.** Jobs are files in `backend/data/jobs/<id>/job.json`; anything `running` at startup goes back to `queued`. nodemon must keep ignoring `data/**`.
- **Portrait renders are unchanged by default** (`format` defaults to portrait; prepared-clip and overlay cache keys for portrait are the same as before).

## Scope and edge cases
- **Limits:** scripts up to 120k characters (long) and 8k (short); a hook is required on both sides.
- **Empty gameplay library:** the long render fails with "No 16:9 gameplay clips found. Add videos to …"; retry after adding clips.
- **Narration provider:** `ttsProvider: 'local'` → `localTtsService.synthesizeLong` with **long videos at `LONGFORM_TEMPO` (1.2×, env override, pitch kept; a preset's own `tempo` wins on the Pocket voice)**. Promo shorts keep `LOCAL_TTS_TEMPO` (1.1, env override) on Pocket and `FISH_DRAMA_TEMPO` (1×) on Fish, then fit their target length. Non-local providers aren't sped up. Other providers (ElevenLabs/Fish/Vibi) go through the pipeline's own 1200-char chunker with per-chunk Groq/ElevenLabs transcription; they work but cost money at this length.
- **Queue:** one job runs at a time (FIFO); others wait as `queued`.

## Related features (ownership / precedence)
- **Renderer:** [Local video renderer](../rendering/local-renderer.md) owns the landscape format, chunking, resume, CTA and bitrate.
- **Local TTS / voice cloning:** owned by `backend/services/localTtsService.js` + the Pocket TTS server in `backend/local-tts/`. The pipeline only calls `synthesizeLong(text, { baseUrl, apiKey, voice, engine, speed, tempo, workDir, signal, onChunk })` → `{ audioPath, durationSec, words }` (30fps frames, already scaled for `tempo`). An unset Local TTS URL means `http://localhost:3910`.

## Dependencies and regression risks
- **Disk:**
  - a 50-min long video is ~2.3 GB at 6 Mbps; a 3-min short ~280 MB at 12 Mbps
  - job work dirs (narration chunks, render segments) are kept until the job finishes; render segments are deleted on success, narration chunks stay in the job dir
- **CPU:** a long render keeps the machine busy for ~8 min (2 ffmpeg encoders + Skia).
- **Gameplay clips:** prepared once per clip at the frame size into `.render-cache/clips`. Prep re-encodes the **whole** source clip, so the first job using a 10-min clip spends minutes there (first real job: 72 s of an 84 s short render was clip prep). Use 1080p sources (the 4K short clips were downscaled into `sf clips 1080`).

## Contracts, security, compatibility
- **Endpoints** (all behind the `/api` auth middleware; jobs are visible only to their owner):
  - `POST /api/longform/jobs` with `{ channelId?, short: {hook, script, audioPresetId?, captionPresetId?, hookStylePresetId?}, long: {...} }`, returns `201 {job}`
  - `GET /api/longform/jobs` returns `{jobs}`; `GET /api/longform/jobs/:id` returns `{job}`
  - `POST /api/longform/jobs/:id/cancel` and `/retry` return `{job}`
- **Job view fields:** `{ id, status, error, title (long hook), shortTitle, steps[{id,label,status,progress,detail}], outputs{shortVideo,longVideo,thumbnail}, etaSeconds, estimates }`
- **Gameplay library:** `LANDSCAPE_CLIPS_DIR` (default `backend/public/background-videos-16x9/`) and/or `s3://$AWS_BUCKET_NAME/$LANDSCAPE_CLIPS_PREFIX` (default `Clips/Gameplay16x9/`). Long clips (5–20 min sessions) are best.
- **Promo short clips:** `PROMO_CLIPS_DIR` (local folder of long vertical clips, picked by duration like the landscape library); unset → the normal short-form library.

## Acceptance criteria
- A submitted job finishes with both MP4s (1920×1080 and 1080×1920), the thumbnail, and two Library entries.
- Closing the tab doesn't affect it. Killing the server mid-render and restarting resumes from the last finished segment.
- ETA is shown from the start (estimates) and then follows measured speed.

## Main implementation locations
- **Backend:**
  - `backend/routes/longform.js` (routes; mounted in `backend/server.js`)
  - `backend/services/jobQueue.js` (persistent queue, resume, cancel, ETA)
  - `backend/services/longformPipeline.js` (steps, preset loading, chunked narration)
  - `backend/services/backgroundLibrary.js` (16:9 gameplay picker)
- **Renderer:** `backend/render/{index.js,timeline.js,thumbnail.js,layers/ctaArrow.js}`
- **Frontend:** `src/pages/LongForm.tsx`, route in `src/App.tsx`, nav in `src/components/Layout.tsx`, 16:9 cards in `src/pages/VideoLibrary.tsx`

## Verification
- **`npm test`:**
  - chunk timing offsets, resume, tempo scaling, retrying estimated timings (`backend/utils/localTtsService.test.js`)
  - CTA timing from word timings, Title Case, thumbnail title fill, arrow geometry (`backend/utils/longformLook.test.js`)
  - job queue order, outputs, retry-from-failed-step, cancel, crash recovery, ETA (`backend/utils/jobQueue.test.js`)
  - landscape layout, cue cursor vs `cuesAtFrame`, cache keys (`backend/render/render.test.js`)
- **End to end (stand-in narrator, 2026-10-25, M3):**
  - a 3:08 short + 10:00 long video job, killed at 45% of the long render and restarted
  - it resumed 3/8 segments and finished all 7 steps: 1080×1920 short, 1920×1080 long at 6.2 Mbps, thumbnail, 2 library saves
  - the second run took 73 s
- **Landscape render speed:** `npm run render:bench -- --format landscape --duration 600` gives 201 fps, so ~7.5 min per 50 min of video.

## Local TTS benchmark (M3, 16 GB, 2026-10-25/27)
Same 8,311-char story (10 chunks of ~900 chars), cloned voice from a 15 s clip.

| Engine | Where | Speed (RTF, lower is faster) | RAM | Verdict |
|---|---|---|---|---|
| VoiceStudio OmniVoice (fast tier, 8 steps) | MPS | **3.1** warm (36 s for 11.5 s); first call timed out at 305 s | ~2 GB + swap | too slow |
| VoiceStudio IndexTTS / CosyVoice | CPU only on macOS | not run (6.4 GB each, CPU) | | would be slower |
| **Pocket TTS** (Kyutai, CPU, `backend/local-tts`) | 2 CPU cores | **0.128** synthesis only (7.8× realtime) | 1.9 GB | **chosen** |
| Pocket TTS `--quantize` | CPU | slower (RTF 1.0–1.5 before the Mac slept) | 1.9 GB | not used |
| Fish Drama 3 (rented GPU, documented) | ≥48 GB GPU (int4: 40 GB A100) | 0.28 on H100 | | later option; a 3090 can't fit it, S2-Pro is non-commercial |

**Full pipeline through `synthesizeLong`** (synthesis → pause cut → Whisper → concat, 2 chunks in flight): 7:13 of audio in 104 s (**RTF 0.24, ~12 min per 50 min**), all 1,578 words timed.

- **Word timings:** faster-whisper `base.en` inside the Pocket server: ~1.9% WER vs the script (`small.en` 1.6% at 2.2× the time). Don't pass the chunk text as Whisper's prompt: it made Whisper skip whole sentences (78/153 words).
- **Pacing:** raw Pocket narration was 197 wpm with 26% silence (28 pauses/min up to 0.8 s). Chunks now cut pauses over 0.15 s down to 0.12 s (−15% length, max pause ~0.27 s), and the joined audio is sped to 1.15× (pitch kept) → ~265 wpm. The user picked 1.15× over 1.3×.
- **Seams:** chunks are joined with a 0.2 s gap (before tempo).
- **Setup:** `./backend/local-tts/start.sh` (creates `.venv`, ~1 GB). Cloned voices = `backend/local-tts/voices/<name>.wav` (gitignored). The cloning weights are gated: accept the terms at huggingface.co/kyutai/pocket-tts and `hf auth login` once. Weights CC-BY-4.0 (commercial use with attribution).

## Speed (Fish Drama 3 on Modal + local render, M3, 2026-10-27)
- **Order:** `prepare` (wakes the Fish GPU) → `long_video`: the long script is voiced in ~7k-char parts (2 at a time) and each part renders as soon as its audio exists; the **promo short is voiced alongside the first parts and rendered while the encoder waits for part 1**. `narrate_short` / `render_short` run after it only if that failed. While the GPU boots the card says "Starting voice GPU".
- **Measured job `bfe453a3`** (51 min long + promo short): GPU cold start ~3.5 min, all long narration 4.0 min (Fish is faster than the render), render 8.1 min at ~205 fps.
- **Render ceiling:** the M3's hardware HEVC encoder does ~280–290 fps at 1080p with `-prio_speed` (already on); more parallel renders don't add throughput. Without `-prio_speed` it is ~190 fps; H.264 VT ~210; libx264 veryfast on all 8 cores ~200.
- **Fixed 2026-10-27, background seek:** `-ss` on a concat-demuxer input decoded every frame before the seek point (68 s to start a segment 9.5 min into a raw clip), so later parts of a long video crawled (44 fps vs 272). Replaying job `bfe453a3`'s render from its cached audio: 486 s → **374 s** (~266 fps overall) for the 51-min video + promo short. The first clip of a segment is now its own accurately seeked input and the following clips come through one concat input joined by the `concat` filter (frame-exact at the clip switch, checked against the source).
- **Raw clips:** long-form and promo short use clips exactly as they are (`rawBackground`: no grade, filter, mirror or re-encode; a clip already 30 fps yuv420p at the target size is used directly).

