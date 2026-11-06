// Landscape (16:9) gameplay clip library for long-form videos.
// Sources: a local folder (LANDSCAPE_CLIPS_DIR, default backend/public/background-videos-16x9)
// and/or an S3 prefix (LANDSCAPE_CLIPS_PREFIX, default Clips/Gameplay16x9/). Long gameplay
// sessions are preferred over many short clips: each clip is prepared (transcoded) once per size.
import fs from 'fs';
import path from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { fileURLToPath } from 'url';
import { ListObjectsV2Command } from '@aws-sdk/client-s3';

const execFileAsync = promisify(execFile);
const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const LANDSCAPE_CLIPS_DIR = process.env.LANDSCAPE_CLIPS_DIR
    || path.join(__dirname, '..', 'public', 'background-videos-16x9');
export const LANDSCAPE_CLIPS_PREFIX = process.env.LANDSCAPE_CLIPS_PREFIX || 'Clips/Gameplay16x9/';

const VIDEO_EXT = /\.(mp4|mov|mkv|webm)$/i;
const durationCache = new Map();

async function probeDuration(ref) {
    if (durationCache.has(ref)) return durationCache.get(ref);
    try {
        const { stdout } = await execFileAsync('ffprobe', [
            '-v', 'error', '-rw_timeout', '15000000',
            '-show_entries', 'format=duration', '-of', 'default=noprint_wrappers=1:nokey=1', ref,
        ], { timeout: 20000 });
        const duration = parseFloat(stdout);
        const value = Number.isFinite(duration) && duration > 0 ? duration : null;
        durationCache.set(ref, value);
        return value;
    } catch {
        return null;
    }
}

function shuffle(items, random = Math.random) {
    const out = [...items];
    for (let i = out.length - 1; i > 0; i--) {
        const j = Math.floor(random() * (i + 1));
        [out[i], out[j]] = [out[j], out[i]];
    }
    return out;
}

/**
 * Pick clips (shuffled, each used once per cycle) until they cover `targetSeconds`.
 * The renderer loops the list if it still runs short.
 */
export function pickClipSequence(clips, targetSeconds, random = Math.random) {
    const usable = clips.filter(c => c.duration > 0);
    if (usable.length === 0) return [];
    const sequence = [];
    let covered = 0;
    while (covered < targetSeconds) {
        for (const clip of shuffle(usable, random)) {
            sequence.push(clip);
            covered += clip.duration;
            if (covered >= targetSeconds) break;
        }
    }
    return sequence;
}

async function listLocalClips(dir) {
    if (!fs.existsSync(dir)) return [];
    const files = fs.readdirSync(dir).filter(f => VIDEO_EXT.test(f)).map(f => path.join(dir, f));
    const durations = await Promise.all(files.map(probeDuration));
    return files.map((ref, i) => ({ ref, duration: durations[i] })).filter(c => c.duration);
}

async function listS3Clips({ s3Client, bucket, baseUrl, prefix }) {
    if (!s3Client) return [];
    const keys = [];
    let token;
    do {
        const page = await s3Client.send(new ListObjectsV2Command({ Bucket: bucket, Prefix: prefix, ContinuationToken: token }));
        for (const obj of page.Contents || []) if (obj.Key && VIDEO_EXT.test(obj.Key)) keys.push(obj.Key);
        token = page.IsTruncated ? page.NextContinuationToken : undefined;
    } while (token);
    const clips = [];
    for (let i = 0; i < keys.length; i += 8) {
        const batch = keys.slice(i, i + 8).map(key => `${baseUrl}/${key}`);
        const durations = await Promise.all(batch.map(probeDuration));
        batch.forEach((ref, j) => durations[j] && clips.push({ ref, duration: durations[j] }));
    }
    return clips;
}

/**
 * Background clip refs (local paths or URLs) covering `targetSeconds` of 16:9 gameplay.
 * Throws a clear error when the library is empty, since a long video without gameplay is useless.
 */
export async function getLandscapeBackgroundVideos(targetSeconds, { s3Client = null, bucket, baseUrl, dir = LANDSCAPE_CLIPS_DIR, prefix = LANDSCAPE_CLIPS_PREFIX } = {}) {
    const [local, remote] = await Promise.all([
        listLocalClips(dir),
        listS3Clips({ s3Client, bucket, baseUrl, prefix }).catch(error => {
            console.warn(`[Backgrounds] S3 landscape library unavailable: ${error.message}`);
            return [];
        }),
    ]);
    const clips = [...local, ...remote];
    if (clips.length === 0) {
        throw new Error(`No 16:9 gameplay clips found. Add videos to ${dir}${s3Client ? ` or s3://${bucket}/${prefix}` : ''}.`);
    }
    return pickClipSequence(clips, targetSeconds).map(c => c.ref);
}
