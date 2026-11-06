// Pre-builds the render cache for the gameplay clip libraries, so jobs never wait on clip prep.
// Each clip is converted once per (frame size, mirror, visual filter), exactly the cache entry a
// render looks up; already-cached clips are skipped.
//
//   npm run clips:warm                        # LANDSCAPE_CLIPS_DIR (16:9) + PROMO_CLIPS_DIR (9:16)
//   npm run clips:warm -- --filter vibrant    # also for a channel's visual filter
//   npm run clips:warm -- --concurrency 3
import fs from 'fs';
import path from 'path';
import { parseArgs } from 'util';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import { prepareBackgroundClip, preparedClipKey, cacheDirs, ensureCacheDirs } from './assets.js';
import { frameSize } from './constants.js';
import { VISUAL_FILTERS } from './cssFilters.js';

dotenv.config({ path: path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../.env') });

const { values } = parseArgs({
    options: {
        filter: { type: 'string', default: 'none' },
        concurrency: { type: 'string', default: '2' },
    },
});
const colorFilter = VISUAL_FILTERS[values.filter] || null;
const VIDEO_EXT = /\.(mp4|mov|webm|mkv)$/i;

// Long-form gameplay keeps its HUD readable (no mirror); promo shorts mirror like other shorts.
const libraries = [
    { dir: process.env.LANDSCAPE_CLIPS_DIR, format: 'landscape', mirror: false },
    { dir: process.env.PROMO_CLIPS_DIR, format: 'portrait', mirror: true },
].filter(l => l.dir && fs.existsSync(l.dir));

if (libraries.length === 0) {
    console.error('No clip folders found. Set LANDSCAPE_CLIPS_DIR and/or PROMO_CLIPS_DIR in .env.');
    process.exit(1);
}

ensureCacheDirs();
const jobs = libraries.flatMap(({ dir, format, mirror }) => {
    const { width, height } = frameSize(format);
    return fs.readdirSync(dir).filter(f => VIDEO_EXT.test(f)).sort().map(f => {
        const ref = path.join(dir, f);
        const opts = { colorFilter, width, height, mirror };
        const cached = fs.existsSync(path.join(cacheDirs.clips, `${preparedClipKey(ref, opts)}.mp4.json`));
        return { ref, format, opts, cached };
    });
});

const todo = jobs.filter(j => !j.cached);
console.log(`[warm] ${jobs.length} clips, ${jobs.length - todo.length} already cached, ${todo.length} to prepare (filter: ${values.filter})`);
const started = Date.now();
let done = 0;
let next = 0;
const worker = async () => {
    while (next < todo.length) {
        const job = todo[next++];
        const t = Date.now();
        try {
            await prepareBackgroundClip(job.ref, job.opts);
            console.log(`[warm] ${++done}/${todo.length} ${job.format} ${path.basename(job.ref)} in ${((Date.now() - t) / 1000).toFixed(0)}s`);
        } catch (error) {
            console.warn(`[warm] ${++done}/${todo.length} failed ${path.basename(job.ref)}: ${error.message}`);
        }
    }
};
await Promise.all(Array.from({ length: Math.max(1, Number(values.concurrency) || 2) }, worker));
console.log(`[warm] done in ${((Date.now() - started) / 60000).toFixed(1)} min`);
