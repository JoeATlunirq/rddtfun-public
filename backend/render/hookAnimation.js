// Hook card animation states (pure frame math, no canvas) — shared by the renderer and the
// Presets page preview so the preview moves exactly like the final video.
import { interpolate, bezier } from './easing.js';

const easeGrow = bezier(0.8, 0, 0.2, 1);
const easeFall = bezier(0.87, 0, 0.13, 1);
const easeShrink = bezier(0.2, 0, 0.8, 1);
const easeOut = bezier(0.16, 1, 0.3, 1);
const easeIn = bezier(0.7, 0, 0.84, 0);
const easeOutBack = bezier(0.34, 1.56, 0.64, 1);

export const PRESET_VARIANTS = ['pop', 'zoom', 'fade', 'slide'];
const SLIDE_DISTANCE = 520;
const clampBoth = { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' };

// Award clips of at least 1.5s are real loops and play on repeat. Shorter one-shot clips play once
// and hold their last frame until a 2.4s cycle restarts them: re-looping them every half second
// read as vibrating.
export const AWARD_CYCLE_FRAMES = 72;
export const AWARD_LOOP_MIN_FRAMES = 45;

export function awardFrameIndex(frame, frameCount, cycle = AWARD_CYCLE_FRAMES) {
    if (!(frameCount > 0)) return 0;
    const f = Math.max(0, frame);
    if (frameCount >= AWARD_LOOP_MIN_FRAMES) return f % frameCount;
    return Math.min(f % cycle, frameCount - 1);
}

const uniqueSorted = arr => [...new Set(arr)].sort((a, b) => a - b);

/** HookVideo.tsx ("fall") animation, ported 1:1. */
export function fallAnimationState(frame, audioDurationInSeconds, fps) {
    const audioFrames = Math.ceil(audioDurationInSeconds * fps) - 2;
    let growthEndFrame = 12;
    let startFallingFrame = Math.max(growthEndFrame + 1, audioFrames - 15);
    if (startFallingFrame <= growthEndFrame) {
        if (audioFrames > 2) {
            growthEndFrame = Math.floor(audioFrames / 2);
            startFallingFrame = growthEndFrame + 1;
        } else {
            growthEndFrame = 0;
            startFallingFrame = audioFrames;
        }
    }
    if (startFallingFrame >= audioFrames) startFallingFrame = Math.max(0, audioFrames - 1);
    if (growthEndFrame >= startFallingFrame) growthEndFrame = Math.max(0, startFallingFrame - 1);
    if (growthEndFrame === 0 && startFallingFrame > 1) growthEndFrame = 1;

    const actualFallDuration = audioFrames - startFallingFrame;
    const blurPeakFrame = startFallingFrame + actualFallDuration * 0.5;

    const scaleRange = uniqueSorted([0, growthEndFrame, startFallingFrame]);
    const scale = scaleRange.length < 3 ? 1 : interpolate(frame, scaleRange, [0.7, 1, 1.08], {
        extrapolateRight: 'clamp',
        easing: t => (frame <= growthEndFrame ? easeGrow(t) : t),
    });

    const fallRange = [startFallingFrame, audioFrames];
    const canFall = audioFrames > startFallingFrame;
    const fall = (to) => {
        if (frame < startFallingFrame) return 0;
        if (!canFall) return frame >= audioFrames ? to : 0;
        return interpolate(frame, fallRange, [0, to], { extrapolateRight: 'clamp', easing: easeFall });
    };

    const blurRange = uniqueSorted([startFallingFrame, blurPeakFrame, audioFrames]);
    let blur = 0;
    if (frame >= startFallingFrame && blurRange.length >= 2) {
        blur = interpolate(frame, blurRange, blurRange.length === 3 ? [0, 5, 0] : [0, 0], {
            extrapolateRight: 'clamp',
            easing: easeFall,
        });
    }
    return { scale, translateY: fall(1285), rotation: fall(30), blur };
}

/** FloatingHookVideo.tsx ("float") animation, ported 1:1. */
export function floatAnimationState(frame, audioDurationInSeconds, fps) {
    const audioFrames = Math.ceil(audioDurationInSeconds * fps) - 2;
    let growthEndFrame = 12;
    let startShrinkingFrame = Math.max(growthEndFrame + 1, audioFrames - 4);
    if (startShrinkingFrame <= growthEndFrame) {
        if (audioFrames > 2) {
            growthEndFrame = Math.floor(audioFrames / 2);
            startShrinkingFrame = growthEndFrame + 1;
        } else {
            growthEndFrame = 0;
            startShrinkingFrame = audioFrames;
        }
    }
    if (startShrinkingFrame >= audioFrames) startShrinkingFrame = Math.max(0, audioFrames - 1);
    if (growthEndFrame >= startShrinkingFrame) growthEndFrame = Math.max(0, startShrinkingFrame - 1);
    if (growthEndFrame === 0 && startShrinkingFrame > 1) growthEndFrame = 1;

    const scaleRange = uniqueSorted([0, growthEndFrame, startShrinkingFrame, audioFrames]);
    let scale = 1;
    if (scaleRange.length >= 3) {
        const output = scaleRange.length === 3 ? [0.7, 1, 0] : [0.7, 1, 1.05, 0];
        scale = interpolate(frame, scaleRange, output, {
            extrapolateRight: 'clamp',
            easing: t => {
                if (frame <= growthEndFrame) return easeGrow(t);
                if (frame >= startShrinkingFrame) return easeShrink(t);
                return t;
            },
        });
    }

    const floating = frame >= growthEndFrame && frame < startShrinkingFrame;
    const phase = (frame - growthEndFrame) * ((2 * Math.PI * 1) / fps);
    const translateY = floating ? 15 * Math.sin(phase) : 0;
    const rotation = floating ? 0.75 * Math.sin(phase) : 0;

    const blurRange = uniqueSorted([startShrinkingFrame, audioFrames]);
    const blur = frame >= startShrinkingFrame && blurRange.length >= 2
        ? interpolate(frame, blurRange, [0, 3], { extrapolateRight: 'clamp', easing: easeShrink })
        : 0;
    return { scale, translateY, rotation, blur };
}

/**
 * Entry/exit animations modelled on the big Reddit story channels:
 * pop = quick overshoot in, shrink + fade out; zoom = slow push-in over the whole hook;
 * fade = card is up from frame 0 and fades out; slide = drops in from above, slides back up.
 * Every variant is gone by the same frame as fall/float (hook audio end - 2 frames).
 */
export function presetHookAnimationState(variant, frame, audioDurationInSeconds, fps) {
    const end = Math.max(1, Math.ceil(audioDurationInSeconds * fps) - 2);
    const exitFrames = Math.min(8, Math.floor(end / 3));
    const exit = exitFrames > 0
        ? interpolate(frame, [end - exitFrames, end], [0, 1], { ...clampBoth, easing: easeIn })
        : (frame >= end ? 1 : 0);
    const enterFrames = Math.max(1, Math.min(9, Math.floor(end / 3)));
    let scale = 1;
    let translateY = 0;
    let opacity = 1 - exit;
    if (variant === 'pop') {
        const peak = Math.max(1, Math.round(enterFrames * 0.55));
        scale = enterFrames > peak
            ? interpolate(frame, [0, peak, enterFrames], [0.6, 1.06, 1], clampBoth)
            : interpolate(frame, [0, enterFrames], [0.6, 1], clampBoth);
        scale *= 1 - 0.15 * exit;
    } else if (variant === 'zoom') {
        scale = interpolate(frame, [0, end], [0.88, 1], { ...clampBoth, easing: easeOut });
    } else if (variant === 'slide') {
        translateY = interpolate(frame, [0, enterFrames], [-SLIDE_DISTANCE, 0], { ...clampBoth, easing: easeOutBack })
            - SLIDE_DISTANCE * exit;
        opacity = 1 - exit * exit;
    }
    return { scale, translateY, rotation: 0, blur: 0, opacity };
}

export function hookAnimationState(variant, frame, audioDurationInSeconds, fps) {
    if (variant === 'float') return { ...floatAnimationState(frame, audioDurationInSeconds, fps), opacity: 1 };
    if (PRESET_VARIANTS.includes(variant)) return presetHookAnimationState(variant, frame, audioDurationInSeconds, fps);
    return { ...fallAnimationState(frame, audioDurationInSeconds, fps), opacity: 1 };
}
