import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { pipeline } from 'stream/promises';
import { Readable } from 'stream';
import {
    CACHE_DIR, PUBLIC_DIR, ASSET_BASE_URL, FONT_FILES, DEFAULT_FONT_FILE, EMOJI_URLS,
    BACKGROUND_GRADE, PREPARED_CLIP_VERSION, PREPARED_GOP, FPS, WIDTH, HEIGHT,
} from './constants.js';
import { cssFilterToFfmpeg } from './cssFilters.js';
import { runFfmpeg, probeCapabilities, countFrames, videoEncoderArgs, probeVideoStream } from './ffmpeg.js';

const dirs = {
    downloads: path.join(CACHE_DIR, 'downloads'),
    clips: path.join(CACHE_DIR, 'clips'),
    emoji: path.join(CACHE_DIR, 'emoji'),
    generated: path.join(CACHE_DIR, 'generated'),
    tmp: path.join(CACHE_DIR, 'tmp'),
};

export function ensureCacheDirs() {
    Object.values(dirs).forEach(d => fs.mkdirSync(d, { recursive: true }));
    return dirs;
}

export const cacheDirs = dirs;

const sha1 = s => crypto.createHash('sha1').update(s).digest('hex');

// Signed URLs carry expiring query params; strip them so the cache key is stable.
function cacheKeyForUrl(url) {
    try {
        const u = new URL(url);
        for (const key of [...u.searchParams.keys()]) {
            if (/^x-amz-/i.test(key) || key === 'token') u.searchParams.delete(key);
        }
        return sha1(u.toString());
    } catch {
        return sha1(url);
    }
}

/** Resolve a local path for an asset reference (absolute path, file:// URL, /public path or http URL). */
export function localPathFor(ref) {
    if (!ref) return null;
    if (ref.startsWith('file://')) return decodeURIComponent(new URL(ref).pathname);
    if (/^https?:\/\//i.test(ref)) {
        const u = new URL(ref);
        if (['localhost', '127.0.0.1'].includes(u.hostname)) {
            const candidate = path.join(PUBLIC_DIR, decodeURIComponent(u.pathname));
            if (fs.existsSync(candidate)) return candidate;
        }
        return null;
    }
    if (path.isAbsolute(ref) && fs.existsSync(ref)) return ref;
    const publicCandidate = path.join(PUBLIC_DIR, ref.replace(/^\/+/, ''));
    if (fs.existsSync(publicCandidate)) return publicCandidate;
    return null;
}

const inflight = new Map();

/** Download (once) and return a local file path for any asset reference. */
export async function fetchAsset(ref) {
    const local = localPathFor(ref);
    if (local) return local;
    if (!/^https?:\/\//i.test(ref || '')) throw new Error(`Asset not found: ${ref}`);

    ensureCacheDirs();
    const ext = path.extname(new URL(ref).pathname).slice(0, 8) || '.bin';
    const target = path.join(dirs.downloads, `${cacheKeyForUrl(ref)}${ext}`);
    if (fs.existsSync(target)) return target;
    if (inflight.has(target)) return inflight.get(target);

    const job = (async () => {
        const tmp = `${target}.${process.pid}.${Date.now()}.part`;
        const res = await fetch(ref);
        if (!res.ok || !res.body) throw new Error(`Download failed (${res.status}) for ${new URL(ref).pathname}`);
        await pipeline(Readable.fromWeb(res.body), fs.createWriteStream(tmp));
        fs.renameSync(tmp, target);
        return target;
    })().finally(() => inflight.delete(target));
    inflight.set(target, job);
    return job;
}

export async function fetchAssetOrNull(ref) {
    if (!ref) return null;
    try {
        return await fetchAsset(ref);
    } catch (error) {
        console.warn(`[Render] Asset unavailable (${error.message})`);
        return null;
    }
}

/** Same font resolution as the old compositions: custom fontUrl > bucket mapping > Roboto Bold. */
export function fontUrlFor(family, fontUrl) {
    if (fontUrl) return fontUrl;
    const file = FONT_FILES[family] || DEFAULT_FONT_FILE;
    return /^https?:\/\//.test(file) ? file : `${ASSET_BASE_URL}/${file}`;
}

export async function resolveFont(family, fontUrl) {
    const url = fontUrlFor(family, fontUrl);
    let file = await fetchAssetOrNull(url);
    if (!file && url !== `${ASSET_BASE_URL}/${DEFAULT_FONT_FILE}`) {
        file = await fetchAssetOrNull(`${ASSET_BASE_URL}/${DEFAULT_FONT_FILE}`);
    }
    if (!file) {
        const bundled = path.join(PUBLIC_DIR, 'fonts', 'Roboto-Bold.ttf');
        file = fs.existsSync(bundled) ? bundled : null;
    }
    return file;
}

// Bump when the emoji frame pipeline changes so stale cache entries are rebuilt
const EMOJI_FRAMES_VERSION = 2;

/**
 * Decode a transparent webm into RGBA PNG frames at the composition fps (cached).
 * With `size`, frames are pre-scaled to exactly the pixels they are drawn at (Lanczos in
 * premultiplied alpha so edges don't pick up dark fringes): Skia's per-frame 3x downscale
 * of the 160px sources looked jagged.
 */
export async function prepareEmojiFrames(url, size = null) {
    ensureCacheDirs();
    const px = size > 0 ? Math.round(size) : null;
    const source = await fetchAsset(url);
    // Keyed by file contents so rebuilt award files (same path) are re-prepared
    const contentKey = sha1(fs.readFileSync(source));
    const outDir = path.join(dirs.emoji, `${contentKey}${px ? `-${px}px-v${EMOJI_FRAMES_VERSION}` : ''}`);
    const done = path.join(outDir, '.done');
    if (fs.existsSync(done)) return listFrames(outDir);

    const tmpDir = `${outDir}.${process.pid}.tmp`;
    fs.rmSync(tmpDir, { recursive: true, force: true });
    fs.mkdirSync(tmpDir, { recursive: true });
    const scale = px ? `,format=rgba,premultiply=inplace=1,scale=${px}:${px}:flags=lanczos,unpremultiply=inplace=1` : '';
    await runFfmpeg(['-c:v', 'libvpx-vp9', '-i', source, '-vf', `fps=${FPS}${scale}`, '-pix_fmt', 'rgba', path.join(tmpDir, '%04d.png')]);
    fs.writeFileSync(path.join(tmpDir, '.done'), '');
    fs.rmSync(outDir, { recursive: true, force: true });
    fs.renameSync(tmpDir, outDir);
    return listFrames(outDir);
}

function listFrames(dir) {
    return fs.readdirSync(dir).filter(f => f.endsWith('.png')).sort().map(f => path.join(dir, f));
}

export async function prepareEmojiSet(size = null) {
    return Promise.all(EMOJI_URLS.map(async url => {
        try {
            return await prepareEmojiFrames(url, size);
        } catch (error) {
            console.warn(`[Render] Emoji clip unavailable: ${error.message}`);
            return [];
        }
    }));
}

/**
 * Convert a background clip into a uniform, render-ready file: cover crop to the frame size
 * (1080x1920 by default), 30fps, optionally mirrored, color graded, fixed keyframe interval. The
 * visual filter's color transform is baked in too (it is a per-pixel color map, so filtering
 * before compositing the overlay is equivalent). Done once per source clip, size, mirror and filter.
 */
/** Cache key of a prepared clip. Portrait mirrored clips keep their old key; other sizes/mirror settings get their own. */
export function preparedClipKey(ref, { colorFilter = null, width = WIDTH, height = HEIGHT, mirror = true, raw = false } = {}) {
    const variant = (width === WIDTH && height === HEIGHT && mirror ? '' : `|${width}x${height}|${mirror ? 'm' : 'n'}`) + (raw ? '|raw' : '');
    return sha1(`${localPathFor(ref) || cacheKeyForUrl(ref)}|v${PREPARED_CLIP_VERSION}|${colorFilter || ''}${variant}`);
}

/**
 * `raw`: use the clip as it is in the file, with no grade, filter or mirror. A local clip already at
 * the frame size and 30fps is used directly with no re-encode; anything else only gets resized.
 */
export async function prepareBackgroundClip(ref, { colorFilter = null, width = WIDTH, height = HEIGHT, mirror = true, raw = false } = {}) {
    ensureCacheDirs();
    if (raw) {
        colorFilter = null;
        mirror = false;
        const local = localPathFor(ref);
        if (local) {
            const stream = await probeVideoStream(local);
            if (stream.width === width && stream.height === height && Math.abs(stream.fps - FPS) < 0.01 && stream.pixFmt === 'yuv420p') {
                return { path: local, frames: await countFrames(local) };
            }
        }
    }
    const key = preparedClipKey(ref, { colorFilter, width, height, mirror, raw });
    const target = path.join(dirs.clips, `${key}.mp4`);
    const meta = `${target}.json`;
    if (fs.existsSync(meta) && fs.existsSync(target)) return { path: target, ...JSON.parse(fs.readFileSync(meta, 'utf8')) };
    if (inflight.has(target)) return inflight.get(target);

    const job = (async () => {
        const source = await fetchAsset(ref);
        const caps = await probeCapabilities();
        const grade = raw ? null : cssFilterToFfmpeg(BACKGROUND_GRADE, colorFilter);
        const vf = [
            `fps=${FPS}`,
            `scale=${width}:${height}:force_original_aspect_ratio=increase:flags=bicubic`,
            `crop=${width}:${height}`,
            ...(mirror ? ['hflip'] : []),
            grade || 'format=yuv420p',
            'setsar=1',
        ].join(',');
        const tmp = `${target}.${process.pid}.tmp.mp4`;
        await runFfmpeg([
            ...(caps.videotoolboxDecode ? ['-hwaccel', 'videotoolbox'] : []),
            '-i', source, '-an', '-vf', vf,
            ...videoEncoderArgs(caps, { bitrate: '20M', gop: PREPARED_GOP }),
            tmp,
        ]);
        const frames = await countFrames(tmp);
        if (!(frames > 0)) throw new Error('Prepared clip has no frames');
        fs.renameSync(tmp, target);
        fs.writeFileSync(meta, JSON.stringify({ frames }));
        return { path: target, frames };
    })().finally(() => inflight.delete(target));
    inflight.set(target, job);
    return job;
}

/** Prepare clips with bounded concurrency, skipping broken ones. */
export async function prepareBackgroundClips(refs, { concurrency = 3, onProgress, colorFilter = null, width = WIDTH, height = HEIGHT, mirror = true, raw = false } = {}) {
    const results = new Array(refs.length).fill(null);
    let next = 0;
    let done = 0;
    const worker = async () => {
        while (next < refs.length) {
            const i = next++;
            try {
                results[i] = await prepareBackgroundClip(refs[i], { colorFilter, width, height, mirror, raw });
            } catch (error) {
                console.warn(`[Render] Skipping background clip: ${error.message}`);
            }
            onProgress?.(++done / refs.length);
        }
    };
    await Promise.all(Array.from({ length: Math.min(concurrency, refs.length) }, worker));
    return results.filter(Boolean);
}

export function backgroundRefsFromSpec(backgroundVideoPath) {
    const list = Array.isArray(backgroundVideoPath) ? backgroundVideoPath : [backgroundVideoPath];
    return list.map(item => (typeof item === 'string' ? item : item?.path)).filter(Boolean);
}
