import fs from 'fs';
import path from 'path';
import { createCanvas } from '@napi-rs/canvas';
import { WIDTH, HEIGHT } from '../constants.js';
import { cacheDirs, ensureCacheDirs } from '../assets.js';

const ASSET_VERSION = 1;

// Small deterministic PRNG (mulberry32) so generated textures are identical across runs.
function mulberry32(seed) {
    let a = seed >>> 0;
    return () => {
        a = (a + 0x6D2B79F5) >>> 0;
        let t = a;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

/**
 * Fractal value noise approximating SVG feTurbulence type=fractalNoise numOctaves=3, as used by the
 * old VHS / old-film overlays. One channel set per RGBA, values in [0,1].
 */
function fractalNoiseChannel(size, cellPx, seed) {
    const out = new Float32Array(size * size);
    const octaves = 3;
    let amplitude = 1;
    let total = 0;
    for (let o = 0; o < octaves; o++) {
        const cell = cellPx / (2 ** o);
        const grid = Math.ceil(size / cell) + 2;
        const rand = mulberry32(seed * 31 + o);
        const lattice = new Float32Array(grid * grid);
        for (let i = 0; i < lattice.length; i++) lattice[i] = rand() * 2 - 1;
        for (let y = 0; y < size; y++) {
            const gy = y / cell;
            const y0 = Math.floor(gy);
            const ty = gy - y0;
            const sy = ty * ty * (3 - 2 * ty);
            for (let x = 0; x < size; x++) {
                const gx = x / cell;
                const x0 = Math.floor(gx);
                const tx = gx - x0;
                const sx = tx * tx * (3 - 2 * tx);
                const a = lattice[y0 * grid + x0];
                const b = lattice[y0 * grid + x0 + 1];
                const c = lattice[(y0 + 1) * grid + x0];
                const d = lattice[(y0 + 1) * grid + x0 + 1];
                out[y * size + x] += amplitude * (a + (b - a) * sx + (c - a + (a - b + d - c) * sx) * sy);
            }
        }
        total += amplitude;
        amplitude /= 2;
    }
    for (let i = 0; i < out.length; i++) out[i] = Math.min(1, Math.max(0, (out[i] / total + 1) / 2));
    return out;
}

function noiseOverlayPng({ opacity, contrast, seed }, width, height) {
    // The SVG tile has a 1:1 intrinsic ratio and no size, so CSS renders it as a 1080x1080 tile.
    // baseFrequency 0.8 on a 200-unit viewBox => ~6.75px features at 1080px.
    const tile = Math.min(width, height);
    const cellPx = (tile / 200) / 0.8;
    const channels = [0, 1, 2, 3].map(c => fractalNoiseChannel(tile, cellPx, seed + c));
    const tileCanvas = createCanvas(tile, tile);
    const tctx = tileCanvas.getContext('2d');
    const img = tctx.createImageData(tile, tile);
    const contrastOf = v => Math.min(1, Math.max(0, (v - 0.5) * contrast + 0.5));
    for (let i = 0; i < tile * tile; i++) {
        img.data[i * 4] = contrastOf(channels[0][i]) * 255;
        img.data[i * 4 + 1] = contrastOf(channels[1][i]) * 255;
        img.data[i * 4 + 2] = contrastOf(channels[2][i]) * 255;
        img.data[i * 4 + 3] = channels[3][i] * opacity * 255;
    }
    tctx.putImageData(img, 0, 0);
    const canvas = createCanvas(width, height);
    const ctx = canvas.getContext('2d');
    for (let y = 0; y < height; y += tile) for (let x = 0; x < width; x += tile) ctx.drawImage(tileCanvas, x, y);
    return canvas.toBuffer('image/png');
}

function crtOverlayPng(width, height) {
    const canvas = createCanvas(width, height);
    const ctx = canvas.getContext('2d');
    // repeating-linear-gradient(0deg, rgba(0,0,0,.15) 0-1px, transparent 2-4px), 4px period
    for (let y = 0; y < height; y += 4) {
        ctx.fillStyle = 'rgba(0,0,0,0.15)';
        ctx.fillRect(0, height - y - 1, width, 1);
        ctx.fillStyle = 'rgba(0,0,0,0.075)';
        ctx.fillRect(0, height - y - 2, width, 1);
    }
    // radial-gradient(circle, transparent 60%, rgba(0,0,0,0.4) 100%), farthest-corner radius
    const radius = Math.hypot(width / 2, height / 2);
    const g = ctx.createRadialGradient(width / 2, height / 2, 0, width / 2, height / 2, radius);
    g.addColorStop(0, 'rgba(0,0,0,0)');
    g.addColorStop(0.6, 'rgba(0,0,0,0)');
    g.addColorStop(1, 'rgba(0,0,0,0.4)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, width, height);
    return canvas.toBuffer('image/png');
}

const GENERATORS = {
    'crt': (w, h) => crtOverlayPng(w, h),
    'vhs': (w, h) => noiseOverlayPng({ opacity: 0.10, contrast: 1.5, seed: 11 }, w, h),
    'old-film': (w, h) => noiseOverlayPng({ opacity: 0.15, contrast: 1, seed: 23 }, w, h),
};

/** Path to the static overlay image for a visual filter, generated once and cached. */
export function filterOverlayImage(visualFilter, { width = WIDTH, height = HEIGHT } = {}) {
    const generate = GENERATORS[visualFilter];
    if (!generate) return null;
    ensureCacheDirs();
    const size = width === WIDTH && height === HEIGHT ? '' : `-${width}x${height}`;
    const file = path.join(cacheDirs.generated, `${visualFilter}-v${ASSET_VERSION}${size}.png`);
    if (!fs.existsSync(file)) {
        const tmp = `${file}.${process.pid}.tmp`;
        fs.writeFileSync(tmp, generate(width, height));
        fs.renameSync(tmp, file);
    }
    return file;
}
