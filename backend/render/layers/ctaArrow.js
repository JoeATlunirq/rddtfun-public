import { WIDTH, HEIGHT } from '../constants.js';

// Copied from QuokkaReads promo shorts (measured frame by frame, scaled to 1080x1920): a flat
// red-orange arrow pointing straight down at YouTube's related-video link, bottom left, bobbing
// up and down. Fractions of the frame; `top`/`bottom` are the resting (mid-bob) position.
export const CTA_ARROW = {
    centerX: 175 / 1080,
    top: 1263 / 1920,
    bottom: 1551 / 1920,
    headWidth: 185 / 1080,
    shaftWidth: 84 / 1080,
    headHeight: 128 / 1920,
    bobAmplitude: 36 / 1920, // ±36 px
    bobPeriodFrames: 16, // ~0.53 s at 30 fps
};

/** Vertical offset (fraction of frame height, up is negative) at a frame of the CTA. Starts mid-bob moving up, like theirs. */
export function ctaArrowBob(frame) {
    return -CTA_ARROW.bobAmplitude * Math.sin((2 * Math.PI * frame) / CTA_ARROW.bobPeriodFrames);
}

/** "Full story linked below" arrow, shown only while the CTA line is spoken. */
export class CtaArrow {
    constructor({ frameWidth = WIDTH, frameHeight = HEIGHT, color = '#FD3000' } = {}) {
        this.w = frameWidth;
        this.h = frameHeight;
        this.color = color;
    }

    /** Arrow outline (tip at the bottom) in frame pixels at a frame of the CTA. */
    points(frame = 0) {
        const dy = this.h * ctaArrowBob(frame);
        const cx = this.w * CTA_ARROW.centerX;
        const top = this.h * CTA_ARROW.top + dy;
        const tip = this.h * CTA_ARROW.bottom + dy;
        const headTop = tip - this.h * CTA_ARROW.headHeight;
        const shaft = (this.w * CTA_ARROW.shaftWidth) / 2;
        const head = (this.w * CTA_ARROW.headWidth) / 2;
        return [
            [cx - shaft, top], [cx + shaft, top], [cx + shaft, headTop], [cx + head, headTop],
            [cx, tip], [cx - head, headTop], [cx - shaft, headTop],
        ];
    }

    draw(ctx, frame) {
        ctx.save();
        ctx.beginPath();
        this.points(frame).forEach(([x, y], i) => (i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y)));
        ctx.closePath();
        // Soft drop shadow so the arrow doesn't blend into bright or red gameplay
        ctx.shadowColor = 'rgba(0, 0, 0, 0.55)';
        ctx.shadowBlur = this.h * 0.008;
        ctx.shadowOffsetY = this.h * 0.004;
        ctx.fillStyle = this.color;
        ctx.fill();
        ctx.restore();
    }
}
