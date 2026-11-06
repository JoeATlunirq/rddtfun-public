# Local video renderer (Skia + FFmpeg)

**Status:** implemented and wired into all render paths. The old Remotion compositions (`backend/remotion/`), `backend/services/lambdaRender.js` and the `remotion` / `@remotion/*` deps are dead code awaiting removal after visual sign-off.
**Next step:** user verifies real renders end-to-end in the UI → remove Remotion/Lambda code and deps; optionally add a cache-warming script for the S3 clip library.

## Purpose
Render the vertical short-form videos (Reddit hook card + word-by-word captions over background clips) on the local machine for free, replacing Remotion Lambda, with output visually matching the old Remotion `MainComposition`.

## Intended behavior
- Input: `renderVideo(spec, { outputPath, onProgress, signal })` where `spec` uses the **same prop names as the old Remotion `MainComposition` inputProps** (validated by `backend/render/spec.js`).
- Output: 1080x1920, 30fps, H.264 (High, bt709) + AAC 48kHz stereo MP4, exact frame count `ceil(30 * (hook + script seconds))`.
- Timeline (ported from `MainComposition.tsx`): hook sequence `[0, ceil(hook*30))`, script sequence after it; single-audio-block mode offsets word timings by `hookSplitTime`; hook captions render on top of the hook card.
- Background: clips back to back, cover-cropped, mirrored, graded with `saturate(1.27) brightness(0.87) contrast(1.14) sepia(0.27)`; loops the clip list if it is shorter than the video; black if no clips.
- Hook card: fall (`HookVideo.tsx`) and float (`FloatingHookVideo.tsx`) layouts/animations ported 1:1, incl. hookStyle colors/font/radius/top position. Award row: 7 awards (`HOOK_AWARDS` in `constants.js`: shocked Snoo, pyramid, heart, hands, popcorn, dino, seal — animated and still alternate), stored as 192px VP9+alpha WebM in `backend/public/assets/hook-awards` (renderer) and `public/hook-awards` (Presets preview). They are built from the source GIF/WebP files with `node backend/render/buildAwards.js <source-dir>`: square crop around the visible content across all frames (92% fill, so every award reads the same size), Lanczos in premultiplied alpha, stills as 2s clips. For rendering they are prepared at exactly their output size (`round(45|60 × card scale)`, cache dir `<content sha1>-<px>px-v2`, so rebuilt files are re-prepared) and drawn 1:1 on whole pixels; at rest (scale 1, no rotation) the whole card bitmap is also placed on whole pixels. Clips of ≥1.5s loop naturally; shorter one-shots play once and hold their last frame until a 2.4s cycle restarts them (`awardFrameIndex` in `hookAnimation.js`). The previous S3 award clips were low quality (160px, 0.47–0.6s one-shots that vibrated when looped), and Skia's per-frame 3× downscale at fractional offsets looked jagged/soft.
- Hook card, channel-style options (all on `hookStyle`, modelled on TaleTrailz / Reddit Report / Nuke Readit / Talereader / Brooks Special):
  - `animation`: `pop | zoom | fade | slide` (or `fall | float`) overrides `hook_animation_type`. pop = 0.6→1.06→1 overshoot in, shrink + fade out; zoom = slow 0.88→1 push-in over the whole hook; fade = up from frame 0, fades out; slide = drops in from above (back easing), slides back up. All exit over the last ≤8 frames and are gone at hook audio end − 2 frames, like fall/float. Stored on the preset because the DB constrains `channel_profiles.hook_animation_type` to fall/float.
  - `scale` (0.6–1.6): card rasterized at that size (stays sharp; the channels use ~1.12). `titleLineHeight` (default 0.9, templates 1.12). `menuDots`: "•••" top right. `accentMode: 'lead'` + `accentColor`: colors the AskReddit addressee of a question ("**Anesthesiologists**, what's…?" — words before the first comma, ≤5 words, title contains `?`), trailing punctuation stays in the title color.
  - Unknown/invalid values of these fields fall back to defaults instead of failing the render (they come from user-saved JSON).
- Captions: animations `scale | slide | fade | motion-blur | none` ported from `SubtitleCard.tsx` (except the blank first frame, see below), plus channel-style `pop` (0.7→1.15→1 in 6 frames), `bounce` (rise from +36px with overshoot), `grow` (0.97→1.07 over the word's whole duration) and `blur-in` (CapCut's motion-blur caption transition, measured frame by frame on a CapCut tutorial at 30fps: words travel left to right — the incoming word eases in from −1.15, −0.38, 0 × font size, the outgoing one drifts +0.26, +0.42 while fading, both with a light horizontal Gaussian motion blur (σ 0.03–0.05 × font size), cross-fading 50/50 on the cut frame; each word overlaps the next by 1 frame via `CUE_OVERLAP_FRAMES`; the finished word bitmap is blurred with 3 running-sum box passes in premultiplied alpha, cached per σ), `blur-swap` (measured frame by frame on a viral shorts channel at 30fps: hard cut, no slide or fade; the outgoing group blurs out over its last 2 frames (σx 0.085 → 0.21 × font size, scale → 0.97), the incoming group starts at σx 0.31 / σy 0.055, scale 0.94 and sharpens over 6 frames (σx 0.31, 0.12, 0.05, 0.03, 0.02, 0.01), mostly horizontal blur with a little vertical; used by the Blur Swap, Color Mix and Blur Swap Caps templates), and CapCut-style `drop` (falls from −140px, 10px overshoot, 8 frames), `shake` (decaying ±9° wobble over 10 frames), `typewriter` (characters revealed over ~60% of the word, 0.5–2 frames per char, never fewer than 1 char) and `punch` (1.6→1 scale with 4px blur in 4 frames). Per-word color, stroke = `stroke_size * 2` with paint-order stroke→fill. A caption must be visible on every frame after the first word. Caption and hook text reproduce the old `font-weight: 700` look via a fill-coloured dilation stroke (~size/48), since the S3 font files only contain weight 400 and Skia cannot synthesize bold. Fonts in `NATIVE_BOLD_FONTS` skip the dilation (a custom `fontUrl` always keeps it).
- Caption look (`captionLook`, built from the caption preset by `captionLookFromStyle` — preset keys `text_case`, `shadow`, `position`, `highlight_mode`, `highlight_color`): `textCase none|upper|lower`; `shadow hard` (offset drop shadow, size×0.06/0.07) or `soft` (2× blurred dark glow) drawn once under the finished stroke+fill; `position center|upper|lower` (block center at 50% / 36% / 68% of the frame, caption band moves with it); `highlightMode auto` colors cues containing digits/money/`!` plus every 7th cue with a ≥5-letter word (deterministic) in `highlightColor`, overriding per-word colors. `palette` (preset `color_mix` + `palette`, ≥2 colors): color mix like TaleTrailz — each cue takes a different palette color than the last run, held for 1–3 cues (seeded PRNG, deterministic; applied before highlights). `strokeJoin` (preset `stroke_join`, `miter` default | `round` for the TaleTrailz/CapCut outline). `boxColor` (preset `box_color`, #rgb–#rrggbbaa): rounded box (pad size×0.28/0.12, radius size×0.22) behind each caption. `shadow neon`: text core mixed 70% toward white, 2× glow in the word color over a faint dark halo.
- Extra fonts (static Google Fonts files fetched into the render cache): Luckiest Guy, Poppins Black, Poppins ExtraBold, Ubuntu Bold, Anton, Bangers, plus CapCut favourites Archivo Black, Bebas Neue, Titan One, Paytone One, Russo One. The frontend lists them via `src/lib/videoStyles.ts`, which also holds the one-click caption/hook templates.
- Visual filters `none | crt | vhs | old-film | vibrant | dark | warm | cool`: CSS color chains applied with spec math (clamped per function) to background and overlay; CRT scanlines+vignette, VHS grain+tracking line, old-film grain+flicker drawn on top unfiltered.
- Audio: hook audio, script audio placed at the hook end (or offset into the same file in single-block mode), optional looped background music at `background_music_volume`; summed without normalization.

- **Captions during the hook never sit on the card:** they keep their normal position when it's clear, otherwise move just below the card (`CaptionRenderer.centerAvoiding`, using `HookCard.span`), else just above it. If neither side has room they aren't drawn during the hook.
- **Formats:** `format: 'portrait'` (default, 1080×1920) or `'landscape'` (1920×1080, used by [long-form](../longform/longform.md)). The frame size is passed through captions (`frameWidth/frameHeight`: text width, caption center, band), the hook card (centering; "hook at top" sits 15% down), filter overlays, ffmpeg graphs and clip preparation.
  - Landscape clips are not mirrored by default (`mirrorBackground`; gameplay HUD text).
  - Prepared clips and overlay PNGs get size-specific cache keys; portrait keys are unchanged.
- **Long renders:** videos with more than 3× `LONG_CHUNK_FRAMES` (2700 frames, 90 s) of script render in 90 s segments unless `RENDER_SCRIPT_CHUNKS` is set.
  - With `renderVideo(..., { resumeDir })` finished segments stay on disk (written as `.part.mp4`, renamed when complete) and are reused on the next attempt while the input hash in `resume.json` matches. The dir is removed on success unless `keepIntermediates`.
  - Progress reports include `framesDone / totalFrames / fps` for ETAs.
  - A cue cursor (`createCueCursor`) replaces the per-frame scan over all cues.
- **Promo CTA:** `ctaArrow: { seconds }` renders the last N seconds as a full-frame `cta` segment with a bobbing red arrow (`layers/ctaArrow.js`) pointing at the Shorts related-video link (bottom left, ~80% down).
- **Bitrate:** `videoBitrate` overrides `RENDER_VIDEO_BITRATE` for one render.

## How it works
- `assets.js`: downloads into `backend/.render-cache/` (keys ignore `X-Amz-*`/`token` query params). Background clips are converted once per (clip, visual filter) into "prepared" clips with grade + filter baked in (VideoToolbox, 0.5s GOP). Emoji webms are decoded once to RGBA PNGs (`libvpx-vp9`).
- `layers/`: Skia (`@napi-rs/canvas`) draws the hook card (static card cached, per-frame transform/blur/emoji) and captions (word bitmaps cached with the visual filter baked in).
- `index.js`: splits the timeline into a full-frame hook segment and caption-band script segment(s); each streams straight-alpha RGBA frames into its own ffmpeg (overlay → filter overlays → encoder); audio mixes in parallel; segments are concatenated with `-c copy` and muxed. A segment's background is its first clip as its own input, accurately seeked (`-ss` before `-i`), plus the following clips as one concat-demuxer input, joined by the `concat` filter. Never put `-ss` on a concat-demuxer input: it decodes everything before the seek point (68 s to start 9.5 min into a raw clip).

## Must-preserve invariants
- Prop names/semantics compatible with the old Remotion inputProps.
- Frame-exact durations; animations are pure functions of the frame number.
- `server.js` stream events (`status_update` / `step_progress` with `stepId: 'video_generation'`), thumbnail generation and `renderHookVideo` return shape `{ videoUrl, thumbnailUrl, hookAudio, scriptAudio, hookVideo }`.
- Visual filter overlays are drawn above (not through) the color filter, like `VisualFilterContainer.tsx`.

## Known differences vs Remotion
- Parity stills (same props, Remotion `renderStill` vs new): SSIM 0.985–0.989 unfiltered, ≥0.98 with `warm`. Remaining differences are H.264 encoding and sub-pixel antialiasing.
- VHS/old-film grain is a generated fractal value-noise texture approximating the SVG `feTurbulence`; jitter/flicker use a deterministic per-frame hash instead of Remotion `random()`.
- Different award set than Remotion (new local high-quality clips); long clips loop instead of freezing on the last frame after ~2.4s.
- **Caption flicker fix (intentional change):** the old `scale` and `fade` animations started every word at opacity 0 while the previous word was already gone, leaving a blank caption frame on every word change. Now `scale` pops in at full opacity (scale 0.8 → 1.05 → 1 unchanged) and `fade` starts at 60% opacity. Word timings are gap-filled (`sanitizeWordTimings`) on every render path, including cron. On top of that, `fillCueGaps` (timeline.js) stretches the cues of each sequence so **no frame is caption-less**: the first cue starts at the sequence start (covers the silence before the first word, frame 0 and the hook→script handoff), every cue lasts until the next starts (+5 frames for motion-blur so its exit still cross-fades), and the last runs to the sequence end (tail after the last word). With the card at the top (or float) and no hook word timings, the hook text is spaced evenly instead of leaving the hook blank; a centered card still has no captions under it (it covers the caption area). Motion-blur words now enter at 45% opacity (was 0, which blanked frame 0 and the handoff). Covered by the "no frame is left without a caption" test. Covered by the "captions never blink between words" regression test; verified on a rendered video (33 blank frames → 0).

## Configuration (env)
| Var | Default | Meaning |
|---|---|---|
| `RENDER_CACHE_DIR` | `backend/.render-cache` | Cache location (downloads, prepared clips, emoji frames) |
| `BACKGROUND_CLIPS_DIR` | `backend/public/background-videos` | Local clip library, used before S3 when it has clips |
| `RENDER_ENCODER` | auto | `software` forces libx264 instead of VideoToolbox |
| `RENDER_CODEC` | `h264` | `hevc` for HEVC (faster on VideoToolbox, less compatible) |
| `RENDER_VIDEO_BITRATE` | `12M` | Output bitrate (VideoToolbox) |
| `RENDER_CONCURRENCY` | `2` | Segments rendered at once |
| `RENDER_SCRIPT_CHUNKS` | `1` | Split the script into N segments (helps software encoding) |
| `RENDER_PREP_CONCURRENCY` | `6` | Parallel background clip preparation |
| `FFMPEG_PATH` / `FFPROBE_PATH` | `ffmpeg` / `ffprobe` | Binaries |

## Dependencies and regression risks
- System `ffmpeg` with `h264_videotoolbox` (macOS) or `libx264`, plus `libvpx-vp9` for hook emoji (Homebrew ffmpeg 8 has all of these; it lacks libass/drawtext, which are not needed).
- `@napi-rs/canvas` (Skia) pinned to 1.0.11.
- Cache growth: one prepared copy per clip per visual filter (~10 MB per 4s clip); no eviction yet.
- First render with new clips/filters pays clip download + preparation (~1–2s per clip, parallel). Warm-cache re-render of the same job drops the asset stage to ~1–2s total.

## Main implementation locations
- `backend/render/` — `index.js` (orchestrator), `timeline.js`, `easing.js`, `cssFilters.js`, `assets.js`, `ffmpeg.js`, `spec.js`, `styles.js` (caption look, highlights, hook accent), `hookAnimation.js` (hook animation states, shared with the frontend), `layers/{captions,hookCard,filterAssets}.js`, `bench.js`, `render.test.js`
- Frontend: `src/lib/videoStyles.ts` (fonts, animation options, channel templates), `src/pages/Presets.tsx` (caption + hook style editors), `src/components/CaptionPreview.tsx`, `src/components/HookPreview.tsx` (live 9:16 hook preview: card laid out in renderer px, animated with `backend/render/hookAnimation.js`, the same frame math the renderer uses — keep that module canvas-free)
- Callers: `renderHookVideo` in `backend/server.js`, `generateVideo` in `backend/services/videoRenderService.js`

## Verification
- `npm test` — unit tests for easing parity (vs Remotion reference values), timeline, segments, background windows, CSS filter math, animation states, ffmpeg graph builders, spec validation.
- `npm run render:bench -- --duration 180 [--filter vhs --anim motion-blur --hook float --music --top]` — fixture render + timing. Channel looks: `--top --dark --dots --accent --scale 1.12 --hook fade|zoom|pop|slide --font "Luckiest Guy" --case upper --shadow hard|soft --highlight --plain --hookText "..."`.
- Landscape (M3, 10 min, 1920×1080): 201 fps, so ~7.5 min per 50 min of video. Cancel-and-resume verified: 3/8 segments reused, exact frame count.
- Benchmark (M3, 60s): `grow` + soft shadow + highlights 171 fps, `blur-in` at 122px with color mix 161 fps, vs `scale` baseline 189 fps.
- Benchmarks (M3, warm cache, 3-min video): none/scale 27.6s (196 fps, 341 MB RSS); vhs/motion-blur/float/music 45.9s (118 fps).
- Manual: generate a video from Video Generator and Audio Import in the UI; check progress, thumbnail, Video Library entry, hook/captions/filter appearance.
