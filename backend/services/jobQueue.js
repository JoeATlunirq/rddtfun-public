// Persistent background job queue for long-running renders (long-form + promo short).
// Jobs are JSON files under `dir/<id>/job.json`, run one at a time in this process, survive the
// browser closing, and resume after a server restart: finished steps are skipped, and steps
// themselves resume from their own work dirs (TTS chunks, render segments).
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

export const JOB_STATUSES = ['queued', 'running', 'done', 'failed', 'cancelled'];

function writeJson(file, value) {
    const tmp = `${file}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(value, null, 2));
    fs.renameSync(tmp, file);
}

/**
 * Seconds left for a job. The running step extrapolates from its own progress; steps not started
 * use their `estimateSeconds(job)` (from work size and measured speeds).
 */
export function estimateRemainingSeconds(job, pipeline, now = Date.now()) {
    let total = 0;
    for (const def of pipeline) {
        const step = job.steps.find(s => s.id === def.id);
        if (!step || step.status === 'done' || step.status === 'skipped') continue;
        const estimate = Math.max(0, def.estimateSeconds?.(job) ?? 0);
        if (step.status === 'running' && Number.isFinite(step.detail?.etaSeconds)) {
            // The step models its own time left (e.g. overlapping narration and render); count it down
            total += Math.max(0, step.detail.etaSeconds - (now - (step.detail.etaAt || now)) / 1000);
        } else if (step.status === 'running' && step.progress > 0.02 && step.startedAt != null) {
            const elapsed = (now - step.startedAt) / 1000;
            total += (elapsed * (1 - step.progress)) / step.progress;
        } else if (step.status === 'running') {
            total += estimate * (1 - (step.progress || 0));
        } else {
            total += estimate;
        }
    }
    return Math.round(total);
}

/**
 * @param {{ dir: string, pipeline: {id: string, label: string, run: Function, estimateSeconds?: Function}[], onUpdate?: Function }} options
 * Each step's `run(job, ctx)` gets `ctx = { signal, workDir, progress(p, detail?), setOutput(key, value), setData(key, value) }`.
 */
export function createJobQueue({ dir, pipeline, onUpdate = () => { } }) {
    fs.mkdirSync(dir, { recursive: true });
    const jobs = new Map();
    const controllers = new Map();
    let running = null;

    const jobFile = id => path.join(dir, id, 'job.json');
    const save = job => {
        job.updatedAt = Date.now();
        job.etaSeconds = ['done', 'failed', 'cancelled'].includes(job.status) ? 0 : estimateRemainingSeconds(job, pipeline);
        writeJson(jobFile(job.id), job);
        onUpdate(job);
    };

    // Load existing jobs; anything that was running when the process died goes back in the queue
    for (const id of fs.existsSync(dir) ? fs.readdirSync(dir) : []) {
        try {
            const job = JSON.parse(fs.readFileSync(jobFile(id), 'utf8'));
            if (job.status === 'running') {
                job.status = 'queued';
                job.steps.forEach(s => { if (s.status === 'running') s.status = 'pending'; });
            }
            jobs.set(job.id, job);
        } catch { /* not a job dir */ }
    }

    function publicJob(job) {
        return job && { ...job, data: undefined };
    }

    async function runJob(job) {
        const controller = new AbortController();
        controllers.set(job.id, controller);
        job.status = 'running';
        job.error = null;
        save(job);
        try {
            for (const def of pipeline) {
                const step = job.steps.find(s => s.id === def.id);
                if (step.status === 'done' || step.status === 'skipped') continue;
                if (controller.signal.aborted) throw new Error('cancelled');
                step.status = 'running';
                step.startedAt = Date.now();
                step.progress = 0;
                save(job);
                const workDir = path.join(dir, job.id, def.id);
                fs.mkdirSync(workDir, { recursive: true });
                let lastSave = 0;
                const result = await def.run(job, {
                    signal: controller.signal,
                    workDir,
                    progress: (p, detail) => {
                        step.progress = Math.max(0, Math.min(1, p));
                        if (detail) step.detail = detail;
                        // throttle disk writes; progress is also kept in memory for polling
                        if (Date.now() - lastSave > 1000) {
                            lastSave = Date.now();
                            save(job);
                        }
                    },
                    setOutput: (key, value) => { job.outputs[key] = value; },
                    setData: (key, value) => { job.data[key] = value; },
                });
                step.status = result === 'skipped' ? 'skipped' : 'done';
                step.progress = 1;
                step.finishedAt = Date.now();
                save(job);
            }
            job.status = 'done';
        } catch (error) {
            const cancelled = controller.signal.aborted;
            job.status = cancelled ? 'cancelled' : 'failed';
            job.error = cancelled ? null : (error.message || String(error));
            job.steps.forEach(s => { if (s.status === 'running') s.status = cancelled ? 'pending' : 'failed'; });
            if (!cancelled) console.error(`[Jobs] ${job.id} failed:`, error);
        } finally {
            controllers.delete(job.id);
            save(job);
        }
    }

    async function pump() {
        if (running) return;
        const next = [...jobs.values()].filter(j => j.status === 'queued').sort((a, b) => a.createdAt - b.createdAt)[0];
        if (!next) return;
        running = runJob(next).finally(() => {
            running = null;
            setImmediate(pump);
        });
    }

    return {
        submit(input, { userId, kind = 'longform' } = {}) {
            const id = crypto.randomUUID();
            fs.mkdirSync(path.join(dir, id), { recursive: true });
            const job = {
                id, userId, kind, status: 'queued', error: null, input,
                steps: pipeline.map(def => ({ id: def.id, label: def.label, status: 'pending', progress: 0 })),
                outputs: {}, data: {}, createdAt: Date.now(), updatedAt: Date.now(),
            };
            jobs.set(id, job);
            save(job);
            pump();
            return publicJob(job);
        },
        get(id) {
            const job = jobs.get(id);
            if (!job) return null;
            return publicJob({ ...job, etaSeconds: ['done', 'failed', 'cancelled'].includes(job.status) ? 0 : estimateRemainingSeconds(job, pipeline) });
        },
        list(userId) {
            return [...jobs.values()]
                .filter(j => !userId || j.userId === userId)
                .sort((a, b) => b.createdAt - a.createdAt)
                .map(j => this.get(j.id));
        },
        /** A job's internal data (hidden from get and list, which go out to the page). */
        dataOf(id) {
            return jobs.get(id)?.data;
        },
        cancel(id) {
            const job = jobs.get(id);
            if (!job) return null;
            if (job.status === 'queued') {
                job.status = 'cancelled';
                save(job);
            } else if (job.status === 'running') {
                controllers.get(id)?.abort();
            }
            return publicJob(job);
        },
        /** Re-queue a failed or cancelled job; finished steps (and finished chunks inside steps) are kept. */
        retry(id) {
            const job = jobs.get(id);
            if (!job || !['failed', 'cancelled'].includes(job.status)) return publicJob(job);
            job.status = 'queued';
            job.error = null;
            job.steps.forEach(s => { if (s.status === 'failed') s.status = 'pending'; });
            save(job);
            pump();
            return publicJob(job);
        },
        start: pump,
        /** Resolves when the queue is idle (tests). */
        async idle() {
            while (running || [...jobs.values()].some(j => j.status === 'queued')) {
                await (running || new Promise(r => setImmediate(r)));
                await new Promise(r => setImmediate(r));
            }
        },
    };
}
