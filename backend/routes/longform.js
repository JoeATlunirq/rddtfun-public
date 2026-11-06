// /api/longform — background jobs that make a long-form 16:9 video plus its linked promo short.
import express from 'express';
import path from 'path';
import { createJobQueue } from '../services/jobQueue.js';
import { createLongformPipeline, estimateLongVideoSeconds, estimateVideoSeconds, hookFor, longCharsPerSecond, withCtaLine } from '../services/longformPipeline.js';

const MAX_LONG_CHARS = 120_000;
const MAX_SHORT_CHARS = 8_000;

export function validateInput(body) {
    const shortScript = String(body.short?.script || '').trim();
    const longScript = String(body.long?.script || '').trim();
    if (!String(body.long?.hook || '').trim()) return 'Long video hook is required';
    if (!String(body.short?.hook || '').trim()) return 'Promo short hook is required';
    if (!shortScript) return 'Promo short script is required';
    if (!longScript) return 'Long video script is required';
    if (shortScript.length > MAX_SHORT_CHARS) return `Promo short script is over ${MAX_SHORT_CHARS.toLocaleString()} characters`;
    if (longScript.length > MAX_LONG_CHARS) return `Long script is over ${MAX_LONG_CHARS.toLocaleString()} characters`;
    return null;
}

/** Video length: the real narration length once it exists, else an estimate for the job's narrator. */
function videoSeconds(job, data, side) {
    const narration = data?.[`${side}Narration`];
    if (narration?.script?.durationSec) return narration.script.durationSec + (narration.title?.durationSec || 0);
    // Before `prepare` loads the presets the narrator is unknown; long-form jobs use the local voice
    const provider = data?.config?.[side]?.audio?.ttsProvider || 'local';
    const script = side === 'short' ? withCtaLine(job.input?.short?.script) : job.input?.[side]?.script;
    const estimate = side === 'long' ? estimateLongVideoSeconds : estimateVideoSeconds;
    const seconds = estimate(script, provider) + estimate(hookFor(job.input, side), provider);
    // The promo short is sped up to fit its preset's target length (picked when the presets load)
    const target = side === 'short' ? data?.shortTargetSeconds : null;
    return target ? Math.min(seconds, target) : seconds;
}

/** Job as the page sees it (internal data stays out; lengths come from it: real once narrated, estimated before). */
export function view(job, data) {
    if (!job) return null;
    return {
        id: job.id,
        status: job.status,
        error: job.error,
        title: hookFor(job.input, 'long'),
        shortTitle: hookFor(job.input, 'short'),
        steps: job.steps,
        outputs: job.outputs,
        etaSeconds: job.etaSeconds,
        createdAt: job.createdAt,
        updatedAt: job.updatedAt,
        estimates: {
            shortAudioSeconds: Math.round(videoSeconds(job, data, 'short')),
            longAudioSeconds: Math.round(videoSeconds(job, data, 'long')),
        },
    };
}

export function createLongformRouter(deps) {
    const queue = createJobQueue({
        dir: path.join(deps.dataDir, 'jobs'),
        pipeline: createLongformPipeline(deps),
    });
    queue.start(); // resume anything interrupted by a restart

    const toView = job => view(job, job && queue.dataOf(job.id));

    const router = express.Router();
    const owned = (req, res) => {
        const job = queue.get(req.params.id);
        if (!job || job.userId !== req.authUser?.id) {
            res.status(404).json({ error: 'Job not found' });
            return null;
        }
        return job;
    };

    router.post('/jobs', (req, res) => {
        const error = validateInput(req.body || {});
        if (error) return res.status(400).json({ error });
        const { channelId, short, long } = req.body;
        const job = queue.submit({
            channelId: channelId || null,
            short: { ...short, hook: String(short.hook).trim(), script: String(short.script).trim() },
            long: { ...long, hook: String(long.hook).trim(), script: String(long.script).trim() },
        }, { userId: req.authUser.id, kind: 'longform' });
        res.status(201).json({ job: toView(queue.get(job.id)) });
    });

    router.get('/jobs', (req, res) => {
        // speed: measured long-video throughput, so the page's "ready in" matches real jobs
        res.json({ jobs: queue.list(req.authUser.id).map(toView), speed: { longCharsPerSecond: longCharsPerSecond(deps) } });
    });

    router.get('/jobs/:id', (req, res) => {
        const job = owned(req, res);
        if (job) res.json({ job: toView(job) });
    });

    router.post('/jobs/:id/cancel', (req, res) => {
        if (!owned(req, res)) return;
        queue.cancel(req.params.id);
        res.json({ job: toView(queue.get(req.params.id)) });
    });

    router.post('/jobs/:id/retry', (req, res) => {
        if (!owned(req, res)) return;
        queue.retry(req.params.id);
        res.json({ job: toView(queue.get(req.params.id)) });
    });

    return router;
}
