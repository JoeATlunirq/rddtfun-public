import { createCanvas, Path2D } from '@napi-rs/canvas';
import { WIDTH, HEIGHT } from '../constants.js';
import { wrapText } from './captions.js';
import { hookAccentWordCount } from '../styles.js';
import { hookAnimationState, awardFrameIndex, PRESET_VARIANTS } from '../hookAnimation.js';

export { fallAnimationState, floatAnimationState, presetHookAnimationState, hookAnimationState } from '../hookAnimation.js';

/** Card size multiplier from the hook style (clamped like the spec). */
export function hookCardScale(style) {
    return Math.max(0.6, Math.min(1.6, Number(style?.scale) || 1));
}

/** Award emoji size in output pixels, so frames can be prepared at exactly that size. */
export function hookEmojiPixelSize(variant, style) {
    return Math.round((variant === 'float' ? 60 : 45) * hookCardScale(style));
}

export const HEART_PATH = 'M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z';
export const BUBBLE_PATH = 'M33.468 67.184C15.014 67.184 0 52.17 0 33.715S15.014.246 33.468.246c18.455 0 33.469 15.014 33.469 33.469 0 5.621-1.421 11.161-4.116 16.076l4.608 17.2-16.849-4.516c-5.172 3.084-11.069 4.709-17.112 4.709zm0-62.938C17.219 4.246 4 17.466 4 33.715s13.219 29.469 29.468 29.469c5.582 0 11.021-1.574 15.729-4.554l.74-.468 11.835 3.171-3.243-12.1.419-.72c2.609-4.484 3.988-9.602 3.988-14.799 0-16.248-13.219-29.468-29.468-29.468z';
export const SHARE_PATH = 'M20 13v4.5c0 3.0577-4 3-8 3s-8 .0577-8-3V13M12 3v12M12 3l4 4M12 3 8 7';

// Remotion renders with box-sizing: border-box, so width/minHeight include padding + border.
const CARD_WIDTH = 800;
const PAD_X = 15;
const PAD_Y = 10;
const BORDER = 1;
const CONTENT_WIDTH = CARD_WIDTH - PAD_X * 2 - BORDER * 2;
const MIN_CONTENT_HEIGHT = 275 - PAD_Y * 2 - BORDER * 2;
const MARGIN = 48; // room for box-shadow and blur around the card bitmap


/** `${color}88`-style CSS concatenation is only valid for 6-digit hex colors. */
function withHexAlpha(color, alpha, fallback) {
    if (typeof color !== 'string') return fallback;
    return /^#[0-9a-f]{6}$/i.test(color.trim()) ? `${color.trim()}${alpha}` : fallback;
}


function fontMetrics(ctx, font) {
    ctx.font = font;
    const m = ctx.measureText('Hg');
    const size = parseFloat(font);
    const ascent = m.fontBoundingBoxAscent || size * 0.93;
    const descent = m.fontBoundingBoxDescent || size * 0.24;
    return { ascent, descent, normal: ascent + descent };
}

function roundRectPath(ctx, x, y, w, h, r) {
    const radius = Math.max(0, Math.min(r, w / 2, h / 2));
    ctx.beginPath();
    ctx.roundRect(x, y, w, h, radius);
}

function drawCover(ctx, image, x, y, w, h) {
    const scale = Math.max(w / image.width, h / image.height);
    const sw = w / scale;
    const sh = h / scale;
    ctx.drawImage(image, (image.width - sw) / 2, (image.height - sh) / 2, sw, sh, x, y, w, h);
}

const TITLE_SIZE = 45;
const TITLE_MIN_SIZE = 20;
// Largest share of the frame height the card may fill; fall grows the card to 1.08x, so this stays on screen
const MAX_CARD_FRAME_SHARE = 0.92;

/**
 * Title font size and lines: the normal 45px when they fit `maxHeight`, otherwise the largest size
 * that does (the hook is narrated in full, so text is never cut). Stops at TITLE_MIN_SIZE.
 */
export function fitHookTitle(ctx, text, { family, maxWidth, maxHeight, lineHeight }) {
    let size = TITLE_SIZE;
    let lines;
    for (; size >= TITLE_MIN_SIZE; size--) {
        ctx.font = `${size}px ${family}`;
        lines = wrapText(ctx, text, maxWidth);
        if (lines.length * size * lineHeight <= maxHeight) break;
    }
    return { size: Math.max(size, TITLE_MIN_SIZE), lines };
}

/**
 * Builds the static hook card once and draws it per frame with the emoji clips and the
 * fall/float transform. Layout mirrors the CSS box model of the old components.
 */
export class HookCard {
    constructor({ variant = 'fall', channelName = '', hookText = '', fontFamily, hookStyle, avatar, badge, emojiFrames = [], audioDurationInSeconds, fps, colorFilter = null, embolden = true, frameWidth = WIDTH, frameHeight = HEIGHT }) {
        this.variant = ['float', ...PRESET_VARIANTS].includes(variant) ? variant : 'fall';
        this.colorFilter = colorFilter;
        this.audioDurationInSeconds = audioDurationInSeconds;
        this.fps = fps;
        this.emojiFrames = emojiFrames;
        const style = hookStyle || null;
        const titleColor = style?.titleColor || '#1a1a1a';
        const mutedColor = style?.titleColor ? withHexAlpha(style.titleColor, '88', '#888888') : '#888888';
        const borderColor = style ? withHexAlpha(style.titleColor, '44', null) : '#000000';
        const family = `"${fontFamily}", sans-serif`;
        const isFloat = this.variant === 'float';
        // Card is laid out in CSS px and rasterized at `k` so a larger card stays sharp
        let k = hookCardScale(style);
        const accentColor = typeof style?.accentColor === 'string' && style.accentColor ? style.accentColor : null;
        const accentWords = accentColor ? hookAccentWordCount(hookText, style?.accentMode) : 0;
        const fauxBold = embolden ? 1 : 0;

        const measure = createCanvas(4, 4).getContext('2d');
        const nameFont = `40px ${family}`;
        const counterFont = `28px ${family}`;
        const nameM = fontMetrics(measure, nameFont);
        const counterM = fontMetrics(measure, counterFont);

        // Header
        const avatarRing = isFloat && style ? 2 : 0;
        const avatarBox = 116;
        const avatarInner = avatarBox - avatarRing * 2;
        const emojiSize = isFloat ? 60 : 45;
        const emojiGap = isFloat ? 0 : 2;
        const badgeH = 40;
        const badgeW = badge ? (badge.width / badge.height) * badgeH : 0;
        const nameRowH = Math.max(nameM.normal, badge ? badgeH : 0);
        const titleColX = avatarBox + 15;
        const nameRowY = 10;
        const emojiRowY = nameRowY + nameRowH + 2 - 5;
        const headerH = Math.max(avatarBox, emojiRowY + emojiSize);

        const titleY = headerH + 3;

        // Footer: paddingTop 10 + icon rows (paddingTop 10, bottom: 10px relative shift)
        const rowH = Math.max(40, counterM.normal);
        const footerH = 10 + 10 + rowH;

        // Title (h2): margin 3px 0 0 6px, width 95%, line-height 0.9 (styles may open it up).
        // Long hooks shrink so the card stays inside the frame.
        const titleLineRatio = Math.max(0.8, Math.min(1.6, Number(style?.titleLineHeight) || 0.9));
        const cardTop = style?.hookTopPosition ? Math.round(frameHeight * 0.15) : null;
        const maxCardPx = cardTop === null ? frameHeight * MAX_CARD_FRAME_SHARE : frameHeight * 0.96 - cardTop;
        const { size: titleSize, lines: titleLines } = fitHookTitle(measure, hookText, {
            family,
            maxWidth: CONTENT_WIDTH * 0.95,
            maxHeight: maxCardPx / k - (titleY + footerH + PAD_Y * 2 + BORDER * 2),
            lineHeight: titleLineRatio,
        });
        const titleFont = `${titleSize}px ${family}`;
        const titleM = fontMetrics(measure, titleFont);
        const titleLineH = titleSize * titleLineRatio;
        const contentH = Math.max(MIN_CONTENT_HEIGHT, titleY + titleLines.length * titleLineH + footerH);
        const footerTop = contentH - footerH;
        const rowY = footerTop + 10 + 10 - 10;

        this.cardW = CONTENT_WIDTH + PAD_X * 2 + BORDER * 2;
        this.cardH = contentH + PAD_Y * 2 + BORDER * 2;
        // Very long hooks can still overflow at the smallest font: shrink the whole card as the last resort
        k = Math.min(k, maxCardPx / this.cardH);
        this.k = k;
        this.titleSize = titleSize;
        this.left = (frameWidth - this.cardW * k) / 2;
        // "Hook at top" sits 15% down the frame (288px on the 1920px portrait frame)
        this.top = cardTop ?? (frameHeight - this.cardH * k) / 2;
        // Rows the resting card can reach (the fall animation grows it to 1.08x around its center)
        const reach = ((this.cardH * k) / 2) * 1.08;
        this.span = { top: this.top + (this.cardH * k) / 2 - reach, bottom: this.top + (this.cardH * k) / 2 + reach };
        const radius = style?.borderRadius ?? 50;

        const canvas = createCanvas(Math.ceil((this.cardW + MARGIN * 2) * k), Math.ceil((this.cardH + MARGIN * 2) * k));
        const ctx = canvas.getContext('2d');
        ctx.scale(k, k);
        const ox = MARGIN;
        const oy = MARGIN;

        // box-shadow: 10px 10px 10px rgba(0,0,0,0.5), painted outside the border box only
        ctx.save();
        ctx.shadowColor = 'rgba(0, 0, 0, 0.5)';
        ctx.shadowOffsetX = 10;
        ctx.shadowOffsetY = 10;
        ctx.shadowBlur = 10;
        ctx.fillStyle = '#000';
        roundRectPath(ctx, ox, oy, this.cardW, this.cardH, radius);
        ctx.fill();
        ctx.restore();
        ctx.save();
        ctx.globalCompositeOperation = 'destination-out';
        roundRectPath(ctx, ox, oy, this.cardW, this.cardH, radius);
        ctx.fill();
        ctx.restore();

        // Background + border
        ctx.fillStyle = style?.backgroundColor || '#ffffff';
        roundRectPath(ctx, ox, oy, this.cardW, this.cardH, radius);
        ctx.fill();
        if (borderColor) {
            ctx.strokeStyle = borderColor;
            ctx.lineWidth = BORDER;
            roundRectPath(ctx, ox + 0.5, oy + 0.5, this.cardW - 1, this.cardH - 1, radius - 0.5);
            ctx.stroke();
        }

        // overflow: hidden clips content to the padding box
        ctx.save();
        roundRectPath(ctx, ox + BORDER, oy + BORDER, this.cardW - BORDER * 2, this.cardH - BORDER * 2, radius - BORDER);
        ctx.clip();
        const cx = ox + BORDER + PAD_X;
        const cy = oy + BORDER + PAD_Y;
        this.contentOrigin = { x: cx, y: cy };

        // Avatar (background-size: cover, round)
        const ax = cx + avatarRing;
        const ay = cy + avatarRing;
        if (avatarRing) {
            const ring = withHexAlpha(style.titleColor, '22', null);
            if (ring) {
                ctx.fillStyle = ring;
                ctx.beginPath();
                ctx.arc(cx + avatarBox / 2, cy + avatarBox / 2, avatarBox / 2, 0, Math.PI * 2);
                ctx.fill();
            }
        }
        ctx.save();
        ctx.beginPath();
        ctx.arc(ax + avatarInner / 2, ay + avatarInner / 2, avatarInner / 2, 0, Math.PI * 2);
        ctx.clip();
        if (avatar) drawCover(ctx, avatar, ax, ay, avatarInner, avatarInner);
        else {
            ctx.fillStyle = '#FF4500';
            ctx.fillRect(ax, ay, avatarInner, avatarInner);
        }
        ctx.restore();

        // The old components used font-weight 700/500; Chrome synthesized faux bold by
        // dilating glyphs ~size/48 px. Draw the same dilation as a fill-coloured stroke.
        const drawText = (text, tx, ty, color, embolden) => {
            if (embolden * fauxBold > 0) {
                ctx.strokeStyle = color;
                ctx.lineWidth = embolden * 2;
                ctx.strokeText(text, tx, ty);
            }
            ctx.fillStyle = color;
            ctx.fillText(text, tx, ty);
        };

        // Channel name + verified badge
        ctx.font = nameFont;
        ctx.textBaseline = 'alphabetic';
        const nameX = cx + titleColX;
        const nameY = cy + nameRowY;
        const nameTextY = nameY + (nameRowH - nameM.normal) / 2 + nameM.ascent;
        drawText(channelName, nameX, nameTextY, titleColor, 40 / 48);
        if (badge) {
            const nameW = ctx.measureText(channelName).width;
            ctx.drawImage(badge, nameX + nameW + 5, nameY + (nameRowH - badgeH) / 2, badgeW, badgeH);
        }

        // "•••" overflow menu, top right (dark-mode Reddit/X look)
        if (style?.menuDots) {
            ctx.fillStyle = titleColor;
            const dotY = nameY + nameRowH / 2;
            for (let i = 0; i < 3; i++) {
                ctx.beginPath();
                ctx.arc(cx + CONTENT_WIDTH - 30 - i * 22, dotY, 6.5, 0, Math.PI * 2);
                ctx.fill();
            }
        }

        // Post title
        ctx.font = titleFont;
        const titleTop = cy + titleY;
        const titleHalfLeading = (titleLineH - titleM.normal) / 2;
        let wordIndex = 0;
        titleLines.forEach((line, i) => {
            const baseline = titleTop + i * titleLineH + titleHalfLeading + titleM.ascent;
            const words = line.split(' ');
            if (wordIndex >= accentWords) {
                drawText(line, cx + 6, baseline, titleColor, titleSize / 48);
                wordIndex += words.length;
                return;
            }
            // Accent words (keep trailing punctuation in the title color, like the channels do)
            let x = cx + 6;
            words.forEach((word, j) => {
                const pieces = wordIndex < accentWords
                    ? [[word.replace(/[,.:;!?]+$/, ''), accentColor], [word.match(/[,.:;!?]+$/)?.[0] || '', titleColor]]
                    : [[word, titleColor]];
                if (j < words.length - 1) pieces.push([' ', titleColor]);
                for (const [piece, color] of pieces) {
                    if (!piece) continue;
                    drawText(piece, x, baseline, color, titleSize / 48);
                    x += ctx.measureText(piece).width;
                }
                wordIndex++;
            });
        });

        // Footer icons
        const iconY = cy + rowY + (rowH - 40) / 2;
        const textY = cy + rowY + (rowH - counterM.normal) / 2 + counterM.ascent;
        ctx.font = counterFont;
        const drawIcon = (path, viewBox, x, mode, width) => {
            ctx.save();
            ctx.translate(x, iconY);
            ctx.scale(40 / viewBox, 40 / viewBox);
            const p = new Path2D(path);
            if (mode === 'fill') {
                ctx.fillStyle = mutedColor;
                ctx.fill(p);
            } else {
                ctx.strokeStyle = mutedColor;
                ctx.lineWidth = width;
                ctx.lineCap = 'round';
                ctx.lineJoin = 'round';
                ctx.stroke(p);
            }
            ctx.restore();
        };
        const drawCounter = (text, x) => {
            drawText(text, x, textY, mutedColor, 28 / 48);
            return ctx.measureText(text).width;
        };
        let x = cx + 20;
        drawIcon(HEART_PATH, 24, x, 'stroke', 2);
        x += 50 + drawCounter('99+', x + 50) + 20;
        drawIcon(BUBBLE_PATH, 67.429, x, 'fill');
        drawCounter('99+', x + 50);
        const shareTextW = ctx.measureText('Share').width;
        const shareX = cx + CONTENT_WIDTH - 100 - (40 + 10 + shareTextW);
        drawIcon(SHARE_PATH, 24, shareX, 'stroke', 1.5);
        drawCounter('Share', shareX + 50);
        ctx.restore();

        this.staticCanvas = canvas;
        this.frameCanvas = createCanvas(canvas.width, canvas.height);
        this.emojiLayout = { x: cx + titleColX, y: cy + emojiRowY, size: emojiSize, gap: emojiGap };
    }

    state(frame) {
        return hookAnimationState(this.variant, frame, this.audioDurationInSeconds, this.fps);
    }

    draw(ctx, frame) {
        const s = this.state(frame);
        if (s.scale <= 0 || s.opacity <= 0) return;

        const k = this.k;
        const fctx = this.frameCanvas.getContext('2d');
        fctx.clearRect(0, 0, this.frameCanvas.width, this.frameCanvas.height);
        fctx.drawImage(this.staticCanvas, 0, 0);
        const { x, y, size, gap } = this.emojiLayout;
        const px = Math.round(size * k);
        fctx.imageSmoothingQuality = 'high';
        this.emojiFrames.forEach((frames, i) => {
            if (!frames?.length) return;
            const image = frames[awardFrameIndex(frame, frames.length)];
            // Frames are prepared at `px`; whole-pixel placement keeps the 1:1 draw unresampled
            const exact = image.width === px && image.height === px;
            fctx.imageSmoothingEnabled = !exact;
            fctx.drawImage(image, Math.round((x + i * (size + gap)) * k), Math.round(y * k), px, px);
        });
        fctx.imageSmoothingEnabled = true;

        ctx.save();
        ctx.globalAlpha = s.opacity;
        // Element blur first, then the composition-wide visual filter (VisualFilterContainer)
        const filters = [s.blur > 0.001 ? `blur(${s.blur}px)` : null, this.colorFilter].filter(Boolean);
        if (filters.length) ctx.filter = filters.join(' ');
        if (Math.abs(s.scale - 1) < 1e-6 && !s.rotation) {
            // At rest the card bitmap is copied 1:1 on whole pixels; a fractional origin would
            // resample (soften) the text and award frames on every frame
            ctx.imageSmoothingEnabled = false;
            ctx.drawImage(this.frameCanvas, Math.round(this.left - MARGIN * k), Math.round(this.top - MARGIN * k + s.translateY));
            ctx.restore();
            return;
        }
        ctx.translate(this.left + (this.cardW * k) / 2, this.top + (this.cardH * k) / 2);
        ctx.translate(0, s.translateY);
        ctx.rotate((s.rotation * Math.PI) / 180);
        ctx.scale(s.scale, s.scale);
        ctx.imageSmoothingQuality = 'high';
        ctx.drawImage(this.frameCanvas, -((this.cardW / 2 + MARGIN) * k), -((this.cardH / 2 + MARGIN) * k));
        ctx.restore();
    }
}
