#!/usr/bin/env node
// Builds the hook card award clips from source GIF/WebP files into 192px VP9+alpha WebM,
// written to backend/public/assets/hook-awards (renderer) and public/hook-awards (Presets preview).
// Usage: node backend/render/buildAwards.js <source-dir>
// Each HOOK_AWARDS entry (constants.js) names its source file without extension in `source`.
import fs from 'fs';
import { spawnSync } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';
import { runFfmpeg } from './ffmpeg.js';
import { HOOK_AWARDS } from './constants.js';

const SIZE = 192;
const STILL_SECONDS = 2;
// Visible content fills this share of the square, so every award reads at the same size
const CONTENT_FILL = 0.92;
const ALPHA_THRESHOLD = 24;

/** Union of the visible (alpha) area over all frames, as a centered square crop. */
function contentSquare(input) {
    const probe = spawnSync('ffprobe', ['-v', 'error', '-select_streams', 'v', '-show_entries', 'stream=width,height', '-of', 'csv=p=0', input], { encoding: 'utf8' });
    const [w, h] = probe.stdout.trim().split(',').map(Number);
    const raw = spawnSync('ffmpeg', ['-v', 'error', '-i', input, '-f', 'rawvideo', '-pix_fmt', 'rgba', 'pipe:1'], { maxBuffer: 1 << 30 }).stdout;
    let [x0, y0, x1, y1] = [w, h, -1, -1];
    for (let f = 0; f + w * h * 4 <= raw.length; f += w * h * 4) {
        for (let y = 0; y < h; y++) {
            for (let x = 0; x < w; x++) {
                if (raw[f + (y * w + x) * 4 + 3] < ALPHA_THRESHOLD) continue;
                if (x < x0) x0 = x;
                if (x > x1) x1 = x;
                if (y < y0) y0 = y;
                if (y > y1) y1 = y;
            }
        }
    }
    if (x1 < 0) return null;
    const side = Math.ceil(Math.max(x1 - x0 + 1, y1 - y0 + 1) / CONTENT_FILL);
    const cx = (x0 + x1 + 1) / 2;
    const cy = (y0 + y1 + 1) / 2;
    return { side, x: Math.round(cx - side / 2), y: Math.round(cy - side / 2), w, h };
}

const sourceDir = process.argv[2];
if (!sourceDir) {
    console.error('Usage: node backend/render/buildAwards.js <source-dir>');
    process.exit(1);
}

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const outputs = [path.join(root, 'backend/public/assets/hook-awards'), path.join(root, 'public/hook-awards')];
outputs.forEach(dir => fs.mkdirSync(dir, { recursive: true }));
const files = fs.readdirSync(sourceDir);

for (const award of HOOK_AWARDS) {
    const source = files.find(f => path.parse(f).name === award.source);
    if (!source) throw new Error(`Missing source for ${award.file} (expected ${award.source}.*)`);
    const input = path.join(sourceDir, source);
    const still = award.still;
    const target = path.join(outputs[0], award.file);
    // Square crop around the visible content (padded with transparency where it leaves the frame),
    // then scale in premultiplied alpha so GIF/WebP edges don't pick up dark or white fringes
    const box = contentSquare(input);
    const crop = box
        ? `format=rgba,pad=${box.w + box.side * 2}:${box.h + box.side * 2}:${box.side}:${box.side}:color=0x00000000,`
            + `crop=${box.side}:${box.side}:${box.x + box.side}:${box.y + box.side},`
        : 'format=rgba,';
    const scale = `${crop}premultiply=inplace=1,scale=${SIZE}:${SIZE}:flags=lanczos,unpremultiply=inplace=1,format=yuva420p`;
    await runFfmpeg([
        ...(still ? ['-loop', '1', '-t', String(STILL_SECONDS), '-framerate', '30'] : []),
        '-i', input,
        '-vf', scale,
        '-c:v', 'libvpx-vp9', '-pix_fmt', 'yuva420p', '-crf', '16', '-b:v', '0', '-auto-alt-ref', '0',
        '-an', '-y', target,
    ]);
    fs.copyFileSync(target, path.join(outputs[1], award.file));
    console.log(`${award.file} <- ${source} (${(fs.statSync(target).size / 1024).toFixed(0)} KB, content ${box ? `${box.side}px square` : 'full frame'})`);
}
