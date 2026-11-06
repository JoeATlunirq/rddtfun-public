// YouTube thumbnail for long-form videos: one big Reddit card on white, like the big story
// channels use (avatar, channel name + badge, award row, the full title as large as it fits,
// 99+ / Share footer). 1280x720 PNG.
import fs from 'fs';
import path from 'path';
import { createCanvas, Path2D } from '@napi-rs/canvas';
import { BADGE_URL, NATIVE_BOLD_FONTS } from './constants.js';
import { fetchAssetOrNull, resolveFont, prepareEmojiSet } from './assets.js';
import { wrapText } from './layers/captions.js';
import { HEART_PATH, BUBBLE_PATH, SHARE_PATH } from './layers/hookCard.js';
import { registerFont, loadImageOrNull } from './index.js';

export const THUMB_WIDTH = 1280;
export const THUMB_HEIGHT = 720;
// Layout measured from QuokkaReads thumbnails (1280x720): 150px avatar top-left, bold name +
// badge, award stickers below the name, then the full title in heavy type filling the card.
const AVATAR_X = 10;
const AVATAR_Y = 10;
const AVATAR = 150;
const TEXT_X = 30;
const NAME_SIZE = 48;
const AWARD = 40;
const FOOTER_H = 44;
const TITLE_TOP = 166;
const TITLE_MAX = 124;
const TITLE_MIN = 30;
const LINE_HEIGHT = 1.17;

/** "my parents skipped my surgery" -> "My Parents Skipped My Surgery" (keeps existing capitals). */
export function toTitleCase(title) {
    return String(title || '').replace(/(^|[\s"([/-])([a-z])/g, (_, lead, ch) => lead + ch.toUpperCase());
}

/**
 * Largest title font size (TITLE_MAX..TITLE_MIN) whose wrapped lines fit `maxWidth` x `maxHeight`,
 * so short titles grow to fill the card instead of leaving empty space.
 */
export function fitTitle(ctx, title, { family, maxWidth, maxHeight }) {
    for (let size = TITLE_MAX; size >= TITLE_MIN; size -= 2) {
        ctx.font = `${size}px ${family}`;
        const lines = wrapText(ctx, title, maxWidth);
        if (lines.length * size * LINE_HEIGHT <= maxHeight) return { size, lines };
    }
    ctx.font = `${TITLE_MIN}px ${family}`;
    const lines = wrapText(ctx, title, maxWidth);
    const maxLines = Math.max(1, Math.floor(maxHeight / (TITLE_MIN * LINE_HEIGHT)));
    if (lines.length <= maxLines) return { size: TITLE_MIN, lines };
    // still too long: cut and add an ellipsis
    const kept = lines.slice(0, maxLines);
    kept[maxLines - 1] = `${kept[maxLines - 1].replace(/[\s,.;:!?]+\S*$/, '')}...`;
    return { size: TITLE_MIN, lines: kept };
}

/** Pure drawing step (no network/disk), so layout can be tested with stub images. */
export function drawThumbnail({ title, channelName, family, embolden, avatar, badge, awards = [], titleColor = '#0f0f0f', mutedColor = '#1a1a1a' }) {
    const canvas = createCanvas(THUMB_WIDTH, THUMB_HEIGHT);
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, THUMB_WIDTH, THUMB_HEIGHT);
    const text = (value, x, y, size, color) => {
        ctx.font = `${size}px ${family}`;
        if (embolden) {
            ctx.strokeStyle = color;
            ctx.lineWidth = (size / 48) * 2;
            ctx.lineJoin = 'round';
            ctx.strokeText(value, x, y);
        }
        ctx.fillStyle = color;
        ctx.fillText(value, x, y);
        return ctx.measureText(value).width;
    };

    // Avatar
    ctx.save();
    ctx.beginPath();
    ctx.arc(AVATAR_X + AVATAR / 2, AVATAR_Y + AVATAR / 2, AVATAR / 2, 0, Math.PI * 2);
    ctx.clip();
    if (avatar) {
        const s = Math.max(AVATAR / avatar.width, AVATAR / avatar.height);
        ctx.drawImage(avatar, AVATAR_X + (AVATAR - avatar.width * s) / 2, AVATAR_Y + (AVATAR - avatar.height * s) / 2, avatar.width * s, avatar.height * s);
    } else {
        ctx.fillStyle = '#FF4500';
        ctx.fillRect(AVATAR_X, AVATAR_Y, AVATAR, AVATAR);
    }
    ctx.restore();

    // Name + badge, award row
    const colX = AVATAR_X + AVATAR + 20;
    const nameBaseline = 74;
    const nameW = text(channelName, colX, nameBaseline, NAME_SIZE, titleColor);
    if (badge) ctx.drawImage(badge, colX + nameW + 10, nameBaseline - 40, (badge.width / badge.height) * 44, 44);
    // Award art is pale and blends into white; a tight dark shadow outlines it like sticker art
    ctx.save();
    ctx.shadowColor = 'rgba(0, 0, 0, 0.55)';
    ctx.shadowBlur = 4;
    ctx.shadowOffsetY = 1.5;
    awards.forEach((image, i) => image && ctx.drawImage(image, colX + i * (AWARD + 6), nameBaseline + 22, AWARD, AWARD));
    ctx.restore();

    // Title: the largest size that fills the space between the header and the footer
    const titleBottom = THUMB_HEIGHT - FOOTER_H - 4;
    const { size, lines } = fitTitle(ctx, title, { family, maxWidth: THUMB_WIDTH - TEXT_X * 2, maxHeight: titleBottom - TITLE_TOP });
    lines.forEach((line, i) => text(line, TEXT_X, TITLE_TOP + size * 0.93 + i * size * LINE_HEIGHT, size, titleColor));

    // Footer: heart 99+  bubble 99+ ...... share Share
    const iconY = THUMB_HEIGHT - FOOTER_H + 4;
    const icon = (pathData, viewBox, x, mode, width) => {
        ctx.save();
        ctx.translate(x, iconY);
        ctx.scale(30 / viewBox, 30 / viewBox);
        const p = new Path2D(pathData);
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
    const footerBaseline = iconY + 25;
    icon(HEART_PATH, 24, TEXT_X, 'stroke', 2.2);
    const likeW = text('99+', TEXT_X + 38, footerBaseline, 28, mutedColor);
    icon(BUBBLE_PATH, 67.429, TEXT_X + 38 + likeW + 26, 'fill');
    text('99+', TEXT_X + 38 + likeW + 64, footerBaseline, 28, mutedColor);
    ctx.font = `28px ${family}`;
    const shareW = ctx.measureText('Share').width;
    icon(SHARE_PATH, 24, THUMB_WIDTH - TEXT_X - shareW - 38, 'stroke', 1.8);
    text('Share', THUMB_WIDTH - TEXT_X - shareW, footerBaseline, 28, mutedColor);
    return { canvas, titleSize: size, titleLines: lines.length };
}

/** Render the thumbnail PNG for a video: Inter ExtraBold (QuokkaReads look), Title Case title, award row. */
export async function renderThumbnail({ title, channelName = '', channelImage = null, font = 'Inter ExtraBold', fontUrl = null, outputPath }) {
    const [fontFile, avatarFile, badgeFile, awardSets] = await Promise.all([
        resolveFont(font, fontUrl),
        fetchAssetOrNull(channelImage),
        fetchAssetOrNull(BADGE_URL),
        prepareEmojiSet(AWARD).catch(() => []),
    ]);
    const family = `"${registerFont(fontFile) || 'sans-serif'}", sans-serif`;
    const [avatar, badge, ...awards] = await Promise.all([
        loadImageOrNull(avatarFile),
        loadImageOrNull(badgeFile),
        ...awardSets.map(frames => loadImageOrNull(frames?.[0])),
    ]);
    const { canvas } = drawThumbnail({ title: toTitleCase(title), channelName, family, embolden: !fontUrl && !NATIVE_BOLD_FONTS.has(font), avatar, badge, awards });
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    fs.writeFileSync(outputPath, canvas.toBuffer('image/png'));
    return outputPath;
}
