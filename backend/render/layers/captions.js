import { createCanvas } from '@napi-rs/canvas';
import { interpolate } from '../easing.js';
import { WIDTH, HEIGHT } from '../constants.js';
import { MOTION_BLUR_OVERLAP_FRAMES } from '../timeline.js';
import { normalizeCaptionLook, transformCaptionText, CAPTION_POSITION_Y } from '../styles.js';

const SIDE_PADDING = 40; // h1 padding: 0 40px
const clampOpt = { extrapolateRight: 'clamp' };

// Chrome paints -webkit-text-stroke with miter joins and a miter limit of 4.
const STROKE_JOIN = 'miter';
const MITER_LIMIT = 4;

// Words are cut back to back (the previous word is gone on the next word's first frame), so an
// entry animation must never start invisible or every word change blinks. The old SubtitleCard
// faded scale/fade words in from opacity 0, which caused the reported caption flicker.
const FADE_START_OPACITY = 0.6;
// Motion-blur words enter stretched + blurred; starting at 0 left a blank frame wherever no
// previous word overlaps (frame 0, the hook->script handoff)
const MOTION_BLUR_START_OPACITY = 0.45;

// Largest scale / vertical travel each animation reaches, for sizing the caption band
const MAX_SCALE_Y = { 'motion-blur': 3, scale: 1.05, pop: 1.15, grow: 1.07, bounce: 1, punch: 1.6, shake: 1.1 };
const MAX_TRAVEL_Y = { slide: 20, bounce: 36, drop: 140 };
const SHAKE_MAX_DEG = 9;
// CapCut's motion-blur caption transition, measured frame by frame (30fps): words travel left to
// right. The incoming word eases in fast from far left (-1.15, -0.38, 0 x font size), the outgoing
// one drifts right (+0.26, +0.42) while fading, both with a light horizontal motion blur, and they
// cross-fade on the cut frame (both ~50% visible, still readable). Each word overlaps the next by
// 1 frame (CUE_OVERLAP_FRAMES). Offsets and blur sigma are fractions of the font size; index 0 is
// the cut frame, index 1 the frame next to it.
const SLIDE_BLUR_IN = [{ x: -1.15, opacity: 0.5, sigma: 0.05 }, { x: -0.38, opacity: 0.95, sigma: 0.03 }];
const SLIDE_BLUR_OUT = [{ x: 0.42, opacity: 0.5, sigma: 0.04 }, { x: 0.26, opacity: 0.95, sigma: 0.025 }];
const SLIDE_REST = { x: 0, opacity: 1, sigma: 0 };

// Blur swap, measured frame by frame on a viral shorts channel (30fps, ~71px caps): hard cut, no
// slide or fade. The outgoing group blurs out over its last 2 frames; the incoming group starts
// heavily blurred and slightly small, then sharpens and settles over 6 frames. Blur is mostly
// horizontal with a little vertical. sx/sy are Gaussian sigmas as fractions of the font size.
const BLUR_SWAP_OUT = [{ sx: 0.21, sy: 0.03, scale: 0.97 }, { sx: 0.085, sy: 0.015, scale: 1 }]; // last frame first
const BLUR_SWAP_IN = [
    { sx: 0.31, sy: 0.055, scale: 0.94 }, { sx: 0.12, sy: 0.04, scale: 0.94 }, { sx: 0.05, sy: 0.03, scale: 0.94 },
    { sx: 0.03, sy: 0.02, scale: 0.97 }, { sx: 0.02, sy: 0.015, scale: 0.97 }, { sx: 0.01, sy: 0.01, scale: 0.99 },
];
const BLUR_SWAP_REST = { sx: 0, sy: 0, scale: 1 };

/** Box sizes whose 3 successive passes approximate a Gaussian of `sigma` (Kovesi). */
function gaussianBoxes(sigma) {
    const ideal = Math.sqrt((12 * sigma * sigma) / 3 + 1);
    let lower = Math.floor(ideal);
    if (lower % 2 === 0) lower--;
    const upper = lower + 2;
    const m = Math.round((12 * sigma * sigma - 3 * lower * lower - 12 * lower - 9) / (-4 * lower - 4));
    return [0, 1, 2].map(i => (i < m ? lower : upper));
}

/** In-place horizontal box blur of premultiplied RGBA rows (running sum, edges clamp to transparent). */
function boxBlurCols(src, dst, w, h, radius) {
    const norm = 1 / (radius * 2 + 1);
    const stride = w * 4;
    for (let x = 0; x < w; x++) {
        for (let c = 0; c < 4; c++) {
            const col = x * 4 + c;
            let sum = 0;
            for (let y = -radius; y <= radius; y++) if (y >= 0 && y < h) sum += src[y * stride + col];
            for (let y = 0; y < h; y++) {
                dst[y * stride + col] = sum * norm;
                const add = y + radius + 1;
                const sub = y - radius;
                if (add < h) sum += src[add * stride + col];
                if (sub >= 0) sum -= src[sub * stride + col];
            }
        }
    }
}

function boxBlurRows(src, dst, w, h, radius) {
    const norm = 1 / (radius * 2 + 1);
    for (let y = 0; y < h; y++) {
        const row = y * w * 4;
        for (let c = 0; c < 4; c++) {
            let sum = 0;
            for (let x = -radius; x <= radius; x++) if (x >= 0 && x < w) sum += src[row + x * 4 + c];
            for (let x = 0; x < w; x++) {
                dst[row + x * 4 + c] = sum * norm;
                const add = x + radius + 1;
                const sub = x - radius;
                if (add < w) sum += src[row + add * 4 + c];
                if (sub >= 0) sum -= src[row + sub * 4 + c];
            }
        }
    }
}

const charCount = text => Array.from(String(text)).length;

/**
 * Per-frame animation state, ported from SubtitleCard.tsx (minus the blank first frame).
 * `textLength` is only used by typewriter (number of characters revealed).
 */
export function captionAnimationState(relativeFrame, duration, animationType, textLength = 1) {
    let scale = 1;
    let scaleX = 1;
    let scaleY = 1;
    let translateY = 0;
    let opacity = 1;
    let blur = 0;
    let smear = 0;
    let rotation = 0;
    let reveal = null;
    let slideX = 0;
    let smearY = 0;

    if (animationType === 'scale') {
        scale = interpolate(relativeFrame, [0, 4, 8], [0.8, 1.05, 1], clampOpt);
    } else if (animationType === 'slide') {
        translateY = interpolate(relativeFrame, [0, 5], [20, 0], clampOpt);
    } else if (animationType === 'motion-blur') {
        const exitStart = duration - MOTION_BLUR_OVERLAP_FRAMES;
        if (relativeFrame >= exitStart) {
            const exitProgress = relativeFrame - exitStart;
            blur = interpolate(exitProgress, [0, MOTION_BLUR_OVERLAP_FRAMES], [0, 10], clampOpt);
            scaleY = interpolate(exitProgress, [0, MOTION_BLUR_OVERLAP_FRAMES], [1, 2.5], clampOpt);
            scaleX = interpolate(exitProgress, [0, MOTION_BLUR_OVERLAP_FRAMES], [1, 0.8], clampOpt);
            opacity = interpolate(exitProgress, [0, 2, MOTION_BLUR_OVERLAP_FRAMES], [1, 1, 0], clampOpt);
        } else {
            scaleY = interpolate(relativeFrame, [0, 4], [3, 1], clampOpt);
            scaleX = interpolate(relativeFrame, [0, 4], [0.6, 1], clampOpt);
            blur = interpolate(relativeFrame, [0, 3], [10, 0], clampOpt);
            opacity = interpolate(relativeFrame, [0, 2], [MOTION_BLUR_START_OPACITY, 1], clampOpt);
        }
    } else if (animationType === 'fade') {
        opacity = interpolate(relativeFrame, [0, 3], [FADE_START_OPACITY, 1], clampOpt);
    } else if (animationType === 'pop') {
        // punchy overshoot, starts big enough to read on the first frame
        scale = interpolate(relativeFrame, [0, 3, 6], [0.7, 1.15, 1], clampOpt);
    } else if (animationType === 'bounce') {
        translateY = interpolate(relativeFrame, [0, 4, 7], [36, -8, 0], clampOpt);
        scale = interpolate(relativeFrame, [0, 4], [0.9, 1], clampOpt);
    } else if (animationType === 'grow') {
        // slow push-in for the whole time the word is on screen
        scale = interpolate(relativeFrame, [0, Math.max(1, duration)], [0.97, 1.07], clampOpt);
    } else if (animationType === 'blur-in') {
        const f = Math.max(0, Math.floor(relativeFrame));
        const fromEnd = Math.max(1, duration) - 1 - f;
        const enter = SLIDE_BLUR_IN[f] || SLIDE_REST;
        const exit = SLIDE_BLUR_OUT[fromEnd] || SLIDE_REST;
        slideX = enter.x + exit.x;
        opacity = Math.min(enter.opacity, exit.opacity);
        smear = Math.max(enter.sigma, exit.sigma);
    } else if (animationType === 'blur-swap') {
        const f = Math.max(0, Math.floor(relativeFrame));
        const fromEnd = Math.max(1, duration) - 1 - f;
        const enter = BLUR_SWAP_IN[f] || BLUR_SWAP_REST;
        const exit = BLUR_SWAP_OUT[fromEnd] || BLUR_SWAP_REST;
        smear = Math.max(enter.sx, exit.sx);
        smearY = Math.max(enter.sy, exit.sy);
        scale = Math.min(enter.scale, exit.scale);
    } else if (animationType === 'drop') {
        // CapCut "drop in": falls from above, small overshoot past its spot
        translateY = interpolate(relativeFrame, [0, 5, 8], [-140, 10, 0], clampOpt);
    } else if (animationType === 'shake') {
        // CapCut "shake": decaying wobble while it settles
        const t = Math.min(1, relativeFrame / 10);
        rotation = relativeFrame < 10 ? SHAKE_MAX_DEG * Math.sin(relativeFrame * 1.6) * (1 - t) : 0;
        scale = interpolate(relativeFrame, [0, 3], [1.1, 1], clampOpt);
    } else if (animationType === 'typewriter') {
        // letters appear one by one over the first ~60% of the word (at least 1 char, so no blank frame)
        const perChar = Math.max(0.5, Math.min(2, (Math.max(1, duration) * 0.6) / Math.max(1, textLength)));
        reveal = Math.max(1, Math.min(textLength, Math.floor(relativeFrame / perChar) + 1));
    } else if (animationType === 'punch') {
        // CapCut "zoom out": slams in from big and slightly blurred
        scale = interpolate(relativeFrame, [0, 4], [1.6, 1], { ...clampOpt, easing: t => 1 - (1 - t) ** 3 });
        blur = interpolate(relativeFrame, [0, 3], [4, 0], clampOpt);
    }
    return { scale, scaleX, scaleY, translateY, opacity, blur, smear, rotation, reveal, slideX, smearY };
}

export function wrapText(ctx, text, maxWidth) {
    const words = String(text).split(/\s+/).filter(Boolean);
    if (words.length === 0) return [''];
    const lines = [];
    let line = words[0];
    for (let i = 1; i < words.length; i++) {
        const candidate = `${line} ${words[i]}`;
        if (ctx.measureText(candidate).width <= maxWidth) line = candidate;
        else {
            lines.push(line);
            line = words[i];
        }
    }
    lines.push(line);
    return lines;
}

const even = n => Math.ceil(n / 2) * 2;

/** Mix a #rgb/#rrggbb color toward white (neon tube core). Other formats pass through. */
function lighten(color, amount) {
    const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(String(color).trim());
    if (!m) return color;
    const hex = m[1].length === 3 ? m[1].split('').map(c => c + c).join('') : m[1];
    const channel = i => Math.round(parseInt(hex.slice(i, i + 2), 16) + (255 - parseInt(hex.slice(i, i + 2), 16)) * amount);
    return `rgb(${channel(0)}, ${channel(2)}, ${channel(4)})`;
}

export class CaptionRenderer {
    constructor({ fontFamily, size = 64, stroke = 8, animation = 'scale', defaultColor = '#FFFFFF', colorFilter = null, look = null, embolden = true, frameWidth = WIDTH, frameHeight = HEIGHT }) {
        this.frameWidth = frameWidth;
        this.frameHeight = frameHeight;
        this.maxTextWidth = frameWidth - SIDE_PADDING * 2;
        this.colorFilter = colorFilter || 'none';
        this.font = `${size}px "${fontFamily}", sans-serif`;
        this.size = size;
        this.strokeWidth = stroke * 2;
        // The old components used font-weight 700; Chrome synthesized faux bold from the
        // weight-400 font files by dilating glyphs ~size/48 px. Skia cannot embolden, so
        // the same dilation is drawn as a fill-coloured stroke under the fill.
        // Fonts that ship a heavy weight skip it.
        this.embolden = embolden ? size / 48 : 0;
        this.look = normalizeCaptionLook(look);
        this.centerY = Math.round(frameHeight * CAPTION_POSITION_Y[this.look.position]);
        this.opticalShift = 0;
        // hard = offset drop shadow, soft = dark glow
        this.shadow = this.look.shadow === 'hard'
            ? { color: 'rgba(0, 0, 0, 0.9)', x: Math.round(size * 0.06), y: Math.round(size * 0.07), blur: 0, passes: 1 }
            : this.look.shadow === 'soft'
                ? { color: 'rgba(0, 0, 0, 0.85)', x: 0, y: Math.round(size * 0.03), blur: Math.round(size * 0.18), passes: 2 }
                : null;
        if (this.look.shadow === 'neon') this.shadow = { color: null, x: 0, y: 0, blur: Math.round(size * 0.22), passes: 2, neon: true };
        this.shadowPad = this.shadow ? Math.max(this.shadow.x, this.shadow.y) + this.shadow.blur * 2 + 2 : 0;
        // Highlight box behind the caption (padding/radius in px)
        this.box = this.look.boxColor
            ? { color: this.look.boxColor, padX: Math.round(size * 0.28), padY: Math.round(size * 0.12), radius: Math.round(size * 0.22) }
            : null;
        this.boxPad = this.box ? this.box.padX : 0;
        this.animation = animation;
        this.defaultColor = defaultColor;
        this.cache = new Map();
        this.measureCtx = createCanvas(4, 4).getContext('2d');
        this.measureCtx.font = this.font;
        const m = this.measureCtx.measureText('Hg');
        this.ascent = m.fontBoundingBoxAscent || size * 0.93;
        this.descent = m.fontBoundingBoxDescent || size * 0.24;
        this.lineHeight = this.ascent + this.descent; // line-height: normal
        if (this.look.opticalCenter) {
            // The line box centers on the font's ascent/descent, which leaves letters off center by a
            // font-dependent amount. Put the middle of the letters (halfway between the capital and
            // lowercase centers) on the center line instead. One baseline for all words, so they don't bounce.
            const capHeight = this.measureCtx.measureText('H').actualBoundingBoxAscent || size * 0.72;
            const xHeight = this.measureCtx.measureText('x').actualBoundingBoxAscent || size * 0.52;
            this.opticalShift = Math.round((capHeight + xHeight) / 4 - (this.ascent - this.descent) / 2);
        }
    }

    displayText(text) {
        return transformCaptionText(text, this.look.textCase);
    }

    layout(text) {
        const lines = wrapText(this.measureCtx, text, this.maxTextWidth);
        const widths = lines.map(l => this.measureCtx.measureText(l).width);
        return { lines, widths, width: Math.max(...widths), height: lines.length * this.lineHeight };
    }

    /** Offscreen bitmap of a word (stroke + fill), cached per text/color. Even-sized so 1:1 draws stay pixel aligned. */
    wordBitmap(text, color) {
        text = this.displayText(text);
        const key = `${text}\u0000${color}`;
        let entry = this.cache.get(key);
        if (entry) {
            this.cache.delete(key);
            this.cache.set(key, entry);
            return entry;
        }
        const { lines, width, height } = this.layout(text);
        const pad = Math.ceil(this.strokeWidth / 2 + this.embolden) + 4 + this.shadowPad + this.boxPad;
        const w = even(width + pad * 2);
        const h = even(height + pad * 2);
        let canvas = createCanvas(w, h);
        const ctx = canvas.getContext('2d');
        ctx.font = this.font;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'alphabetic';
        ctx.lineJoin = this.look.strokeJoin === 'round' ? 'round' : STROKE_JOIN;
        ctx.miterLimit = MITER_LIMIT;
        const top = (h - height) / 2;
        // Neon: near-white tube core, the word color goes into the glow
        const fill = this.shadow?.neon ? lighten(color, 0.7) : color;
        if (this.box) {
            ctx.fillStyle = this.box.color;
            ctx.beginPath();
            ctx.roundRect((w - width) / 2 - this.box.padX, top - this.box.padY, width + this.box.padX * 2, height + this.box.padY * 2, this.box.radius);
            ctx.fill();
        }
        lines.forEach((line, i) => {
            const baseline = top + i * this.lineHeight + this.ascent;
            if (this.strokeWidth > 0) {
                // outline grows with the emboldened glyph so the black band keeps its width
                ctx.lineWidth = this.strokeWidth + this.embolden * 2;
                ctx.strokeStyle = 'black';
                ctx.strokeText(line, w / 2, baseline);
            }
            ctx.lineWidth = this.embolden * 2;
            ctx.strokeStyle = fill;
            ctx.strokeText(line, w / 2, baseline);
            ctx.fillStyle = fill;
            ctx.fillText(line, w / 2, baseline);
        });
        // Shadow the finished glyphs in one draw so the fill never shadows its own outline
        if (this.shadow) {
            const shadowed = createCanvas(w, h);
            const sctx = shadowed.getContext('2d');
            if (this.shadow.neon) {
                // faint dark halo first so the glow still reads on bright footage
                sctx.shadowColor = 'rgba(0, 0, 0, 0.55)';
                sctx.shadowBlur = Math.round(this.size * 0.1);
                sctx.drawImage(canvas, 0, 0);
            }
            sctx.shadowColor = this.shadow.color || color;
            sctx.shadowOffsetX = this.shadow.x;
            sctx.shadowOffsetY = this.shadow.y;
            sctx.shadowBlur = this.shadow.blur;
            for (let i = 0; i < this.shadow.passes; i++) sctx.drawImage(canvas, 0, 0);
            sctx.shadowColor = 'transparent';
            sctx.drawImage(canvas, 0, 0);
            canvas = shadowed;
        }
        // The visual filter is a per-pixel color map; bake it once instead of filtering every draw.
        let display = canvas;
        if (this.colorFilter !== 'none') {
            display = createCanvas(w, h);
            const dctx = display.getContext('2d');
            dctx.filter = this.colorFilter;
            dctx.drawImage(canvas, 0, 0);
        }
        entry = { canvas, display, w, h, blurred: new Map() };
        this.cache.set(key, entry);
        if (this.cache.size > 96) this.cache.delete(this.cache.keys().next().value);
        return entry;
    }

    // CSS applies filter: blur() in the element's local space (before transforms), so blur the bitmap first.
    blurredBitmap(entry, blur) {
        const key = blur.toFixed(3);
        let canvas = entry.blurred.get(key);
        if (canvas) return { canvas, pad: Math.ceil(blur * 3) };
        const pad = Math.ceil(blur * 3);
        canvas = createCanvas(entry.w + pad * 2, entry.h + pad * 2);
        const ctx = canvas.getContext('2d');
        // Element blur first, then the container's visual filter (same order as the CSS tree)
        ctx.filter = this.colorFilter === 'none' ? `blur(${blur}px)` : `blur(${blur}px) ${this.colorFilter}`;
        ctx.drawImage(entry.canvas, pad, pad);
        if (entry.blurred.size > 16) entry.blurred.delete(entry.blurred.keys().next().value);
        entry.blurred.set(key, canvas);
        return { canvas, pad };
    }

    /**
     * Directional Gaussian blur of the finished word (outline + fill together, so colored words dim
     * the way the references do). Sigmas are in output pixels; 3 box passes per axis in premultiplied alpha.
     */
    smearedBitmap(entry, sigma, sigmaY = 0) {
        const key = `s${sigma.toFixed(2)}:${sigmaY.toFixed(2)}`;
        const pad = Math.ceil(sigma * 3);
        const padY = Math.ceil(sigmaY * 3);
        let canvas = entry.blurred.get(key);
        if (canvas) return { canvas, padX: pad, padY };
        const w = entry.w + pad * 2;
        const h = entry.h + padY * 2;
        canvas = createCanvas(w, h);
        const ctx = canvas.getContext('2d');
        ctx.drawImage(entry.display, pad, padY);
        const image = ctx.getImageData(0, 0, w, h);
        const px = image.data;
        let a = new Float32Array(px.length);
        for (let i = 0; i < px.length; i += 4) {
            const alpha = px[i + 3] / 255;
            a[i] = px[i] * alpha;
            a[i + 1] = px[i + 1] * alpha;
            a[i + 2] = px[i + 2] * alpha;
            a[i + 3] = px[i + 3];
        }
        let b = new Float32Array(px.length);
        if (sigma > 0.3) {
            for (const size of gaussianBoxes(sigma)) {
                boxBlurRows(a, b, w, h, (size - 1) / 2);
                [a, b] = [b, a];
            }
        }
        if (sigmaY > 0.3) {
            for (const size of gaussianBoxes(sigmaY)) {
                boxBlurCols(a, b, w, h, (size - 1) / 2);
                [a, b] = [b, a];
            }
        }
        for (let i = 0; i < px.length; i += 4) {
            const alpha = a[i + 3];
            const inv = alpha > 0 ? 255 / alpha : 0;
            px[i] = a[i] * inv;
            px[i + 1] = a[i + 1] * inv;
            px[i + 2] = a[i + 2] * inv;
            px[i + 3] = alpha;
        }
        ctx.putImageData(image, 0, 0);
        if (entry.blurred.size > 16) entry.blurred.delete(entry.blurred.keys().next().value);
        entry.blurred.set(key, canvas);
        return { canvas, padX: pad, padY };
    }

    /** Vertical band (centered on the caption position) that can contain every caption state. */
    bandHeight(cues) {
        let maxBlock = this.lineHeight;
        let maxWidth = 0;
        const seen = new Set();
        for (const cue of cues) {
            if (seen.has(cue.text)) continue;
            seen.add(cue.text);
            const block = this.layout(this.displayText(cue.text));
            maxBlock = Math.max(maxBlock, block.height);
            maxWidth = Math.max(maxWidth, block.width);
        }
        const maxScaleY = MAX_SCALE_Y[this.animation] || 1;
        const blurPad = this.animation === 'motion-blur' ? 30
            : this.animation === 'punch' ? 12
                : this.animation === 'blur-swap' ? Math.ceil(BLUR_SWAP_IN[0].sy * this.size * 3) : 0;
        // a rotated word reaches further up/down by half its width * sin(angle)
        const rotationReach = this.animation === 'shake' ? (maxWidth / 2) * Math.sin((SHAKE_MAX_DEG * Math.PI) / 180) : 0;
        const travel = (MAX_TRAVEL_Y[this.animation] || 0) + rotationReach;
        const half = (maxBlock / 2 + this.strokeWidth + 8 + blurPad + this.shadowPad + (this.box?.padY || 0)) * maxScaleY + travel + Math.abs(this.opticalShift);
        return Math.min(this.frameHeight, Math.ceil((half * 2) / 4) * 4);
    }

    /**
     * Caption center that keeps captions off a card spanning rows [top, bottom]: the normal position
     * when it is clear, else just below the card, else just above. Null if neither side has room.
     */
    centerAvoiding(top, bottom) {
        const half = this.lineHeight / 2 + this.strokeWidth / 2 + this.shadowPad + this.size * 0.15;
        const center = this.centerY + this.opticalShift;
        if (center + half <= top || center - half >= bottom) return this.centerY;
        if (bottom + half * 2 <= this.frameHeight) return Math.round(bottom + half - this.opticalShift);
        if (top - half * 2 >= 0) return Math.round(top - half - this.opticalShift);
        return null;
    }

    /** Top row of the caption band in frame coordinates. */
    bandTop(bandHeight) {
        return Math.max(0, Math.min(this.frameHeight - bandHeight, Math.round(this.centerY - bandHeight / 2)));
    }

    frameKey(cues, frame) {
        let key = '';
        for (const cue of cues) {
            const s = captionAnimationState(frame - cue.start, cue.duration, this.animation, charCount(cue.text));
            key += `${cue.start}:${s.scale.toFixed(4)}:${s.scaleX.toFixed(4)}:${s.scaleY.toFixed(4)}:${s.translateY.toFixed(3)}:`
                + `${s.opacity.toFixed(4)}:${s.blur.toFixed(3)}:${s.smear.toFixed(4)}:${s.smearY.toFixed(4)}:${s.slideX.toFixed(4)}:${s.rotation.toFixed(3)}:${s.reveal}|`;
        }
        return key;
    }

    /**
     * Draw all visible cues. `originY` is the canvas row that corresponds to frame row 0
     * (negative for the caption band canvas).
     */
    draw(ctx, cues, frame, originY = 0, centerY = this.centerY) {
        for (const cue of cues) {
            const length = charCount(cue.text);
            const state = captionAnimationState(frame - cue.start, cue.duration, this.animation, length);
            if (state.opacity <= 0) continue;
            const text = state.reveal !== null && state.reveal < length ? Array.from(String(cue.text)).slice(0, state.reveal).join('') : cue.text;
            const entry = this.wordBitmap(text, cue.color || this.defaultColor);
            let source = entry.display;
            let padX = 0;
            let padY = 0;
            if (state.blur > 0.001) {
                const blurred = this.blurredBitmap(entry, state.blur);
                source = blurred.canvas;
                padX = padY = blurred.pad;
            } else if (state.smear * this.size > 0.3 || state.smearY * this.size > 0.3) {
                ({ canvas: source, padX, padY } = this.smearedBitmap(entry, state.smear * this.size, state.smearY * this.size));
            }

            ctx.save();
            ctx.globalAlpha = state.opacity;
            ctx.translate(Math.round(this.frameWidth / 2 + state.slideX * this.size), centerY + this.opticalShift + originY);
            ctx.scale(state.scale, state.scale);
            ctx.translate(0, state.translateY);
            if (state.rotation) ctx.rotate((state.rotation * Math.PI) / 180);
            ctx.scale(state.scaleX, state.scaleY);
            const identity = state.scale === 1 && state.scaleX === 1 && state.scaleY === 1 && state.translateY === 0 && !state.rotation;
            ctx.imageSmoothingEnabled = !identity;
            ctx.imageSmoothingQuality = 'high';
            ctx.drawImage(source, -entry.w / 2 - padX, -entry.h / 2 - padY);
            ctx.restore();
        }
    }
}
