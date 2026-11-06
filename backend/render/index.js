import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { once } from 'events';
import { createCanvas, GlobalFonts, loadImage } from '@napi-rs/canvas';
import { FPS, BADGE_URL, NATIVE_BOLD_FONTS, frameSize } from './constants.js';
import { parseRenderSpec } from './spec.js';
import { buildTimeline, createCueCursor, planSegments, backgroundWindow } from './timeline.js';
import { VISUAL_FILTERS, cssFilterToFfmpeg } from './cssFilters.js';
import {
    ensureCacheDirs, cacheDirs, fetchAssetOrNull, resolveFont, prepareEmojiSet,
    prepareBackgroundClips, backgroundRefsFromSpec,
} from './assets.js';
import {
    probeCapabilities, capsForCodec, spawnFfmpeg, runFfmpeg, videoEncoderArgs, concatListContent,
    buildSegmentFilter, buildAudioArgs, buildFinalizeArgs,
} from './ffmpeg.js';
import { CaptionRenderer } from './layers/captions.js';
import { HookCard, hookEmojiPixelSize } from './layers/hookCard.js';
import { CtaArrow } from './layers/ctaArrow.js';
import { filterOverlayImage } from './layers/filterAssets.js';

const registeredFonts = new Map();

export function registerFont(file) {
    if (!file) return null;
    if (registeredFonts.has(file)) return registeredFonts.get(file);
    const alias = `RF_${crypto.createHash('sha1').update(file).digest('hex').slice(0, 12)}`;
    const ok = GlobalFonts.registerFromPath(file, alias);
    const family = ok ? alias : null;
    if (!ok) console.warn(`[Render] Could not register font ${path.basename(file)}; using sans-serif`);
    registeredFonts.set(file, family);
    return family;
}

export async function loadImageOrNull(file) {
    if (!file) return null;
    try {
        return await loadImage(fs.readFileSync(file));
    } catch (error) {
        console.warn(`[Render] Could not load image ${path.basename(file)}: ${error.message}`);
        return null;
    }
}

const nonEmptyFile = file => (file && fs.existsSync(file) && fs.statSync(file).size > 0 ? file : null);

/**
 * Render one segment: Skia draws the overlay for each frame and streams raw RGBA into ffmpeg,
 * which composites it over the prepared background, applies the visual filter and encodes.
 */
async function renderSegment(ctx, segment) {
    const { timeline, clips, captions, hookCard, ctaArrow, caps, band, colorFilter, visualFilter, fxImage, workDir, signal, width, height, bitrate, backgroundStartFrame = 0 } = ctx;
    const full = segment.kind === 'hook' || segment.kind === 'cta';
    const overlayH = full ? height : band.height;
    const overlayY = full ? 0 : band.y;
    const originY = -overlayY;
    const frameCount = segment.end - segment.start;

    const bgInput = [];
    let trimStart = 0;
    let backgroundInputs = 1;
    // A video rendered in parts continues the gameplay where the previous part stopped
    const window = backgroundWindow(clips, segment.start + backgroundStartFrame, segment.end + backgroundStartFrame);
    if (window) {
        const hwaccel = caps.videotoolboxDecode ? ['-hwaccel', 'videotoolbox'] : [];
        // The first clip is its own input, seeked accurately (keyframe seek + a few decoded frames). `-ss`
        // on a concat-demuxer input decodes everything before the seek point instead: 68 s to start a
        // segment 9.5 min into a raw 1080p clip, which held long-form renders to ~200 fps from ~280.
        const seek = window.trimStart > 0 ? ['-ss', (window.trimStart / FPS).toFixed(6)] : [];
        bgInput.push(...hwaccel, ...seek, '-i', window.files[0]);
        // The clips after it play from their start: one concat-demuxer input, joined in the filter graph
        if (window.files.length > 1) {
            const list = path.join(workDir, `bg-${segment.index}.txt`);
            fs.writeFileSync(list, concatListContent(window.files.slice(1)));
            bgInput.push(...hwaccel, '-f', 'concat', '-safe', '0', '-i', list);
            backgroundInputs = 2;
        }
    } else {
        bgInput.push('-f', 'lavfi', '-i', `color=c=black:s=${width}x${height}:r=${FPS}`);
    }

    const graph = buildSegmentFilter({
        trimStart,
        overlayY,
        colorFilter,
        visualFilter: fxImage ? visualFilter : null,
        frameOffset: segment.start,
        overlayInputIndex: fxImage ? backgroundInputs + 1 : null,
        backgroundInputs,
        width,
        height,
    });
    const output = segmentPath(workDir, segment);
    // Encode to a .part file and rename when complete, so a resumed render never reuses a cut-off segment
    const partial = `${output}.part.mp4`;
    // Several segments encode at once: ffmpeg's default (a filter thread per core, per process) makes them
    // fight. One filter thread each cut a 4-segment render from ~5.2 to ~1.9 cores and raised it 144 -> 235 fps.
    const filterThreads = Number(process.env.RENDER_FILTER_THREADS) || 1;
    const { child, done } = spawnFfmpeg([
        '-filter_complex_threads', String(filterThreads),
        ...bgInput,
        '-f', 'rawvideo', '-pix_fmt', 'rgba', '-s', `${width}x${overlayH}`, '-framerate', String(FPS), '-i', 'pipe:0',
        ...(fxImage ? ['-i', fxImage] : []),
        '-filter_complex', graph,
        '-map', '[v]', '-frames:v', String(frameCount), '-an',
        ...videoEncoderArgs(caps, bitrate ? { bitrate } : undefined),
        '-video_track_timescale', '15360',
        partial,
    ], { signal });

    const canvas = createCanvas(width, overlayH);
    const g = canvas.getContext('2d');
    // Captions during the hook stay clear of the card (long hooks make it reach the frame's middle)
    const hookCaptionY = segment.kind === 'hook' && hookCard ? captions.centerAvoiding(hookCard.span.top, hookCard.span.bottom) : captions.centerY;
    const cuesAt = createCueCursor(segment.kind === 'hook' ? timeline.hookCues : timeline.scriptCues);
    let failed = null;
    done.catch(error => { failed = error; });

    let lastKey = null;
    let lastBuffer = null;
    for (let frame = segment.start; frame < segment.end; frame++) {
        if (failed) break;
        if (signal?.aborted) throw new Error('Render cancelled');
        const visible = cuesAt(frame);
        const key = full ? null : captions.frameKey(visible, frame);
        let buffer = lastBuffer;
        if (key === null || key !== lastKey) {
            g.clearRect(0, 0, width, overlayH);
            if (segment.kind === 'hook' && hookCard) hookCard.draw(g, frame);
            if (segment.kind === 'cta' && ctaArrow) ctaArrow.draw(g, frame - segment.start);
            if (hookCaptionY !== null) captions.draw(g, visible, frame, originY, hookCaptionY);
            const data = g.getImageData(0, 0, width, overlayH).data;
            buffer = Buffer.from(data.buffer, data.byteOffset, data.byteLength);
            lastKey = key;
            lastBuffer = buffer;
        }
        if (!child.stdin.write(buffer)) {
            await Promise.race([once(child.stdin, 'drain'), done.catch(() => { })]);
        }
        ctx.onFrame();
    }
    child.stdin.end();
    await done;
    fs.renameSync(partial, output);
    return output;
}

const segmentPath = (dir, segment) => path.join(dir, `seg-${String(segment.index).padStart(3, '0')}-${segment.start}-${segment.end}.mp4`);

// Long videos render in ~90s chunks: they run in parallel and are the unit a resumed render skips
export const LONG_CHUNK_FRAMES = 2700;

export function scriptChunkCount(scriptFrames, envChunks = Number(process.env.RENDER_SCRIPT_CHUNKS) || 0) {
    if (envChunks > 0) return envChunks;
    return scriptFrames > LONG_CHUNK_FRAMES * 3 ? Math.ceil(scriptFrames / LONG_CHUNK_FRAMES) : 1;
}

/**
 * Work dir for a render. With `resumeDir` it persists across attempts and keeps finished segments,
 * as long as the render input is unchanged (input hash in resume.json); otherwise it is a temp dir.
 */
function openWorkDir(resumeDir, input) {
    if (!resumeDir) return { dir: fs.mkdtempSync(path.join(cacheDirs.tmp, 'job-')), persistent: false };
    const hash = crypto.createHash('sha1').update(JSON.stringify(input)).digest('hex');
    const manifest = path.join(resumeDir, 'resume.json');
    let previous = null;
    try {
        previous = JSON.parse(fs.readFileSync(manifest, 'utf8')).hash;
    } catch { /* first attempt */ }
    if (previous !== hash) fs.rmSync(resumeDir, { recursive: true, force: true });
    fs.mkdirSync(resumeDir, { recursive: true });
    fs.writeFileSync(manifest, JSON.stringify({ hash }));
    return { dir: resumeDir, persistent: true };
}

async function runPool(items, limit, fn) {
    const results = new Array(items.length);
    let next = 0;
    const worker = async () => {
        while (next < items.length) {
            const i = next++;
            results[i] = await fn(items[i]);
        }
    };
    await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
    return results;
}

/**
 * Render a full video locally.
 * @param {object} input same shape as the old Remotion MainComposition inputProps
 * @param {{ outputPath: string, onProgress?: (p: {stage: string, progress: number, framesDone?: number, totalFrames?: number, fps?: number}) => void,
 *   signal?: AbortSignal, resumeDir?: string, keepIntermediates?: boolean }} options
 *   `resumeDir`: keep finished segments there so a failed/cancelled render resumes; removed on success
 *   unless `keepIntermediates`.
 */
export async function renderVideo(input, { outputPath, onProgress = () => { }, signal, resumeDir = null, keepIntermediates = false } = {}) {
    if (!outputPath) throw new Error('outputPath is required');
    const startedAt = Date.now();
    const spec = parseRenderSpec(input);
    const timeline = buildTimeline(spec, FPS);
    const caps = capsForCodec(await probeCapabilities(), spec.videoCodec);
    ensureCacheDirs();
    const { dir: workDir, persistent } = openWorkDir(resumeDir, input);
    let succeeded = false;
    const report = (stage, progress, extra = {}) => onProgress({ stage, progress: Math.max(0, Math.min(1, progress)), ...extra });

    try {
        report('assets', 0);
        const visualFilter = spec.visual_filter && VISUAL_FILTERS[spec.visual_filter] !== undefined ? spec.visual_filter : 'none';
        const visualCss = VISUAL_FILTERS[visualFilter] || null;
        const captionFontFamily = spec.font || 'Jellee';
        const hookFontFamily = spec.hookStyle?.font || captionFontFamily;
        const needHook = timeline.hookFrames > 0;
        const hookVariant = spec.hookStyle?.animation || spec.hook_animation_type || 'fall';
        const format = spec.format === 'landscape' ? 'landscape' : 'portrait';
        const { width, height } = frameSize(format);
        // Gameplay has HUD text, so landscape backgrounds are not mirrored unless asked
        const mirror = spec.mirrorBackground ?? format === 'portrait';
        // rawBackground: clips play exactly as they are in the file (no grade, filter or mirror)
        const rawBackground = !!spec.rawBackground;

        const [captionFontFile, hookFontFile, avatarFile, badgeFile, emojiFrameFiles, clips, hookAudio, scriptAudio, musicAudio] = await Promise.all([
            resolveFont(captionFontFamily, spec.fontUrl),
            resolveFont(hookFontFamily, spec.fontUrl),
            needHook ? fetchAssetOrNull(spec.channelImage) : null,
            needHook ? fetchAssetOrNull(BADGE_URL) : null,
            needHook && caps.libvpx ? prepareEmojiSet(hookEmojiPixelSize(hookVariant, spec.hookStyle)) : [],
            prepareBackgroundClips(backgroundRefsFromSpec(spec.backgroundVideoPath), {
                concurrency: Number(process.env.RENDER_PREP_CONCURRENCY) || 6,
                colorFilter: visualCss,
                width,
                height,
                mirror,
                raw: rawBackground,
                onProgress: p => report('preparing_backgrounds', p),
            }),
            timeline.audio.hook ? fetchAssetOrNull(timeline.audio.hook.src) : null,
            timeline.audio.script ? fetchAssetOrNull(timeline.audio.script.src) : null,
            timeline.audio.music ? fetchAssetOrNull(timeline.audio.music.src) : null,
        ]);
        if (signal?.aborted) throw new Error('Render cancelled');
        if (clips.length === 0) console.warn('[Render] No background clips available; using a black background');
        const assetsSeconds = (Date.now() - startedAt) / 1000;

        const captions = new CaptionRenderer({
            fontFamily: registerFont(captionFontFile) || 'sans-serif',
            size: spec.subtitle_size || 64,
            stroke: spec.stroke_size ?? 8,
            animation: timeline.animation,
            colorFilter: visualCss,
            look: timeline.captionLook,
            frameWidth: width,
            frameHeight: height,
            // a custom font file keeps the old faux bold
            embolden: !!spec.fontUrl || !NATIVE_BOLD_FONTS.has(captionFontFamily),
        });
        const bandHeight = captions.bandHeight(timeline.scriptCues);
        const band = { height: bandHeight, y: captions.bandTop(bandHeight) };

        let hookCard = null;
        if (needHook) {
            const [avatar, badge, emojiFrames] = await Promise.all([
                loadImageOrNull(avatarFile),
                loadImageOrNull(badgeFile),
                Promise.all(emojiFrameFiles.map(files => Promise.all(files.map(loadImageOrNull))
                    .then(images => images.filter(Boolean)))),
            ]);
            hookCard = new HookCard({
                variant: hookVariant,
                channelName: spec.channelName,
                hookText: spec.hookText,
                fontFamily: registerFont(hookFontFile) || 'sans-serif',
                hookStyle: spec.hookStyle,
                avatar,
                badge,
                emojiFrames,
                audioDurationInSeconds: spec.audioDurationInSeconds,
                fps: FPS,
                colorFilter: visualCss,
                embolden: !!spec.fontUrl || !NATIVE_BOLD_FONTS.has(hookFontFamily),
                frameWidth: width,
                frameHeight: height,
            });
        }

        const ctaFrames = spec.ctaArrow ? Math.min(Math.round(spec.ctaArrow.seconds * FPS), timeline.totalFrames - timeline.hookFrames) : 0;
        const segments = planSegments(timeline, { scriptChunks: scriptChunkCount(timeline.totalFrames - timeline.hookFrames), ctaFrames });
        const totalFrames = timeline.totalFrames;
        // Segments finished by an earlier attempt are reused as they are
        const finished = new Set(segments.filter(seg => fs.existsSync(segmentPath(workDir, seg))).map(seg => seg.index));
        let framesDone = segments.filter(seg => finished.has(seg.index)).reduce((sum, seg) => sum + seg.end - seg.start, 0);
        const resumedFrames = framesDone;
        const renderStartedAt = Date.now();
        const progressDetail = () => {
            const elapsed = (Date.now() - renderStartedAt) / 1000;
            return { framesDone, totalFrames, fps: elapsed > 0 ? (framesDone - resumedFrames) / elapsed : 0 };
        };
        if (resumedFrames > 0) console.log(`[Render] Resuming: ${finished.size}/${segments.length} segments already rendered`);
        report('rendering', framesDone / totalFrames, progressDetail());
        const ctx = {
            timeline,
            clips,
            captions,
            hookCard,
            ctaArrow: ctaFrames > 0 ? new CtaArrow({ frameWidth: width, frameHeight: height }) : null,
            bitrate: spec.videoBitrate || null,
            backgroundStartFrame: Math.max(0, Math.round(spec.backgroundStartFrame || 0)),
            caps,
            band,
            // Without background clips the black fallback must still be filtered in ffmpeg
            colorFilter: clips.length === 0 ? cssFilterToFfmpeg(visualCss) : null,
            visualFilter,
            fxImage: filterOverlayImage(visualFilter, { width, height }),
            width,
            height,
            workDir,
            signal,
            onFrame: () => {
                framesDone++;
                if (framesDone % 15 === 0 || framesDone === totalFrames) report('rendering', framesDone / totalFrames, progressDetail());
            },
        };

        const audioFile = path.join(workDir, 'audio.m4a');
        const audioJob = runFfmpeg(buildAudioArgs(timeline.audio, {
            totalSeconds: timeline.durationSeconds,
            files: { hook: nonEmptyFile(hookAudio), script: nonEmptyFile(scriptAudio), music: nonEmptyFile(musicAudio) },
            output: audioFile,
        }), { signal });
        audioJob.catch(() => { });

        // The hardware encoder is the ceiling (~210 fps H.264 / ~288 HEVC at 1080p on M3); 4 chunks keep it busy
        const concurrency = Math.max(1, Number(process.env.RENDER_CONCURRENCY) || 4);
        const segmentFiles = await runPool(segments, concurrency, segment => (finished.has(segment.index)
            ? segmentPath(workDir, segment)
            : renderSegment(ctx, segment)));
        await audioJob;

        report('finalizing', 0);
        const segmentList = path.join(workDir, 'segments.txt');
        fs.writeFileSync(segmentList, concatListContent(segmentFiles));
        fs.mkdirSync(path.dirname(outputPath), { recursive: true });
        const tmpOutput = path.join(workDir, 'final.mp4');
        await runFfmpeg(buildFinalizeArgs({ segmentList, audioFile, totalSeconds: timeline.durationSeconds, output: tmpOutput }), { signal });
        fs.copyFileSync(tmpOutput, outputPath);
        report('finalizing', 1);

        const seconds = (Date.now() - startedAt) / 1000;
        const encodeSeconds = seconds - assetsSeconds;
        console.log(`[Render] ${totalFrames} frames (${timeline.durationSeconds.toFixed(1)}s) rendered in ${seconds.toFixed(1)}s `
            + `(assets ${assetsSeconds.toFixed(1)}s, render ${encodeSeconds.toFixed(1)}s = ${(totalFrames / encodeSeconds).toFixed(0)} fps, `
            + `encoder=${caps.videotoolbox ? 'videotoolbox' : 'software'})`);
        succeeded = true;
        return { outputPath, durationSeconds: timeline.durationSeconds, frames: totalFrames, renderSeconds: seconds, resumedFrames };
    } finally {
        // A persistent dir survives failures (that is what makes resume work); temp dirs always go
        if (!persistent || (succeeded && !keepIntermediates)) fs.rmSync(workDir, { recursive: true, force: true });
    }
}

export { probeCapabilities } from './ffmpeg.js';
