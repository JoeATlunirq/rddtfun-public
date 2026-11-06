import { FPS } from './constants.js';
import { normalizeCaptionLook, applyCaptionHighlights, applyCaptionPalette } from './styles.js';

export const MOTION_BLUR_OVERLAP_FRAMES = 5;
// Frames each word stays on screen past the next word's start, for animations that animate the
// outgoing word too (motion-blur exit, CapCut slide crossfade)
export const CUE_OVERLAP_FRAMES = { 'motion-blur': MOTION_BLUR_OVERLAP_FRAMES, 'blur-in': 1 };
export const CAPTION_ANIMATIONS = ['scale', 'slide', 'fade', 'motion-blur', 'pop', 'bounce', 'grow', 'blur-in', 'blur-swap', 'drop', 'shake', 'typewriter', 'punch', 'none'];

/**
 * Word cues for one Series.Sequence, ported from SubtitleComposition.tsx.
 * Frames are relative to the sequence start.
 */
export function buildCaptionCues({ text = '', wordTimings = [], sequenceFrames, animation = 'scale', framesPerWord = 30 }) {
    if (wordTimings.length > 0) {
        return wordTimings.map(word => {
            const original = word.endFrame - word.startFrame;
            return {
                text: word.text,
                color: word.color,
                start: word.startFrame,
                duration: original + (CUE_OVERLAP_FRAMES[animation] || 0),
            };
        });
    }
    const words = String(text).split(' ');
    const duration = sequenceFrames || words.length * framesPerWord;
    const perWord = Math.ceil(duration / words.length);
    return words.map((word, index) => ({ text: word, color: undefined, start: index * perWord, duration: perWord }));
}

/**
 * Stretch cues so captions cover every frame of [from, to): the first cue starts at `from`, each
 * cue lasts until the next one starts (plus `overlap` frames, so motion-blur exits still cross-fade
 * into the next word), and the last runs to `to`. Only ever extends. Covers the silence before the
 * first word, pauses, the hook->script handoff and the tail after the last word, on every render path.
 */
export function fillCueGaps(cues, from, to, overlap = 0) {
    if (cues.length === 0) return cues;
    const sorted = [...cues].sort((a, b) => a.start - b.start);
    return sorted.map((cue, i) => {
        const start = i === 0 ? Math.min(cue.start, from) : cue.start;
        const next = sorted[i + 1];
        const end = Math.max(cue.start + cue.duration, (next ? next.start : to) + overlap);
        return { ...cue, start, duration: end - start };
    });
}

/**
 * For single-audio-block renders the word timings start at t=0 of the full audio,
 * but the script sequence starts after the hook (MainComposition.tsx).
 */
export function offsetSingleBlockTimings(wordTimings, isSingleAudioBlock, hookSplitTime, fps = FPS) {
    if (!isSingleAudioBlock || !(hookSplitTime > 0)) return wordTimings;
    const offset = Math.ceil(hookSplitTime * fps);
    return wordTimings
        .map(w => ({ ...w, startFrame: Math.max(0, w.startFrame - offset), endFrame: Math.max(0, w.endFrame - offset) }))
        .filter(w => w.endFrame > 0);
}

/**
 * Resolve the whole video timeline: sequence bounds, absolute caption cues and the audio plan.
 */
export function buildTimeline(spec, fps = FPS) {
    const hookSeconds = Number(spec.audioDurationInSeconds) || 0;
    const scriptSeconds = Number(spec.scriptAudioDurationInSeconds) || 0;
    const hookFrames = Math.ceil(hookSeconds * fps);
    const scriptFrames = Math.ceil(scriptSeconds * fps);
    const totalFrames = Math.ceil(fps * (hookSeconds + scriptSeconds));
    if (!(totalFrames > 0)) throw new Error(`Invalid total duration: hook=${hookSeconds}s script=${scriptSeconds}s`);

    const animation = CAPTION_ANIMATIONS.includes(spec.captionAnimation) ? spec.captionAnimation : 'scale';
    const captionLook = normalizeCaptionLook(spec.captionLook);
    const overlap = CUE_OVERLAP_FRAMES[animation] || 0;
    const scriptEnd = Math.min(totalFrames, hookFrames + scriptFrames);

    const toAbsolute = (cues, from, to) => cues
        .map(c => ({ ...c, start: c.start + from, from, to }))
        .filter(c => c.duration > 0 && c.start < to && c.start + c.duration > from);

    const hookWordTimings = spec.hookWordTimings || [];
    const hookEnd = Math.min(hookFrames, totalFrames);
    // Captions run under the hook when the card sits at the top (or floats); without word timings
    // (e.g. hook transcription failed) the hook text is spaced evenly instead of leaving it blank
    const hookVariant = spec.hookStyle?.animation || spec.hook_animation_type;
    const captionsUnderHook = hookWordTimings.length > 0
        || ((spec.hookStyle?.hookTopPosition || hookVariant === 'float') && String(spec.hookText || '').trim() !== '');
    const hookCues = captionsUnderHook && hookEnd > 0
        ? applyCaptionHighlights(applyCaptionPalette(fillCueGaps(toAbsolute(buildCaptionCues({
            text: String(spec.hookText || '').trim(),
            wordTimings: hookWordTimings,
            sequenceFrames: hookEnd,
            animation,
        }), 0, hookEnd), 0, hookEnd, overlap), captionLook, 7), captionLook)
        : [];

    const scriptCues = applyCaptionHighlights(applyCaptionPalette(fillCueGaps(toAbsolute(buildCaptionCues({
        text: spec.subtitleText || '',
        wordTimings: offsetSingleBlockTimings(spec.wordTimings || [], spec.isSingleAudioBlock, spec.hookSplitTime, fps),
        sequenceFrames: scriptFrames,
        animation,
    }), hookFrames, scriptEnd), hookFrames, scriptEnd, overlap), captionLook, 1), captionLook);

    const single = !!spec.isSingleAudioBlock;
    const splitFrames = Math.ceil((spec.hookSplitTime || hookSeconds) * fps);
    const hookAudioFrames = single ? Math.min(hookFrames, splitFrames) : hookFrames;

    const audio = {
        hook: spec.audioUrl ? { src: spec.audioUrl, at: 0, offset: 0, duration: Math.min(hookAudioFrames, totalFrames) / fps } : null,
        script: spec.scriptAudioUrl && scriptEnd > hookFrames ? {
            src: spec.scriptAudioUrl,
            at: hookFrames / fps,
            offset: single ? splitFrames / fps : 0,
            duration: (scriptEnd - hookFrames) / fps,
        } : null,
        music: spec.has_background_music && spec.backgroundMusicUrl ? {
            src: spec.backgroundMusicUrl,
            volume: spec.background_music_volume ?? 0.015,
        } : null,
    };

    return {
        fps,
        hookFrames: Math.min(hookFrames, totalFrames),
        scriptFrames,
        totalFrames,
        durationSeconds: totalFrames / fps,
        animation,
        captionLook,
        hookCues,
        scriptCues,
        audio,
    };
}

/**
 * Same result as cuesAtFrame, for frames visited in increasing order (one render segment):
 * keeps the cues sorted by start and a small active set, so a 50-minute video (~8k cues,
 * ~90k frames) no longer scans every cue on every frame. Going backwards restarts the scan.
 */
export function createCueCursor(cues) {
    const sorted = cues.map((cue, index) => ({ cue, index })).sort((a, b) => a.cue.start - b.cue.start || a.index - b.index);
    let next = 0;
    let active = [];
    let lastFrame = -Infinity;
    return frame => {
        if (frame < lastFrame) {
            next = 0;
            active = [];
        }
        lastFrame = frame;
        while (next < sorted.length && sorted[next].cue.start <= frame) active.push(sorted[next++]);
        active = active.filter(({ cue }) => frame < cue.start + cue.duration);
        // original order, like cuesAtFrame (later cues draw on top)
        return active
            .filter(({ cue }) => frame >= cue.from && frame < cue.to)
            .sort((a, b) => a.index - b.index)
            .map(({ cue }) => cue);
    };
}

export function cuesAtFrame(cues, frame) {
    const visible = [];
    for (const cue of cues) {
        if (frame >= cue.from && frame < cue.to && frame >= cue.start && frame < cue.start + cue.duration) {
            visible.push(cue);
        }
    }
    return visible;
}

/**
 * Which prepared background clips cover frames [start, end) of the background timeline.
 * Clips play back to back (like the old Series of OffthreadVideos) and loop if they run short.
 * Returns the clip files to concat and how many frames to skip in the first one.
 */
export function backgroundWindow(clips, start, end) {
    const usable = clips.filter(c => c.frames > 0);
    if (usable.length === 0) return null;
    const cycle = usable.reduce((sum, c) => sum + c.frames, 0);
    let position = Math.floor(start / cycle) * cycle;
    let index = 0;
    while (position + usable[index].frames <= start) {
        position += usable[index].frames;
        index = (index + 1) % usable.length;
    }
    const trimStart = start - position;
    const files = [];
    let covered = position;
    while (covered < end) {
        files.push(usable[index].path);
        covered += usable[index].frames;
        index = (index + 1) % usable.length;
    }
    return { files, trimStart };
}

/**
 * Split the timeline into render segments: the hook needs a full-frame overlay,
 * the script only needs the caption band. Long script ranges are split into chunks
 * that start on prepared-clip keyframes when possible.
 */
export function planSegments({ hookFrames, totalFrames }, { scriptChunks = 1, minChunkFrames = 150, ctaFrames = 0 } = {}) {
    const segments = [];
    if (hookFrames > 0) segments.push({ kind: 'hook', start: 0, end: hookFrames });
    // The CTA (promo short ending) needs a full-frame overlay like the hook, so it gets its own segment
    const ctaStart = Math.max(hookFrames, totalFrames - Math.max(0, Math.round(ctaFrames)));
    const scriptLength = ctaStart - hookFrames;
    if (scriptLength > 0) {
        const chunks = Math.max(1, Math.min(scriptChunks, Math.floor(scriptLength / minChunkFrames) || 1));
        const size = Math.ceil(scriptLength / chunks);
        for (let start = hookFrames; start < ctaStart; start += size) {
            segments.push({ kind: 'script', start, end: Math.min(ctaStart, start + size) });
        }
    }
    if (ctaStart < totalFrames) segments.push({ kind: 'cta', start: ctaStart, end: totalFrames });
    return segments.map((s, index) => ({ ...s, index }));
}
