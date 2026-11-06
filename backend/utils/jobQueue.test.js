import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { createJobQueue, estimateRemainingSeconds } from '../services/jobQueue.js';

const tmpDir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'jobs-'));
const tick = () => new Promise(r => setTimeout(r, 5));

test('jobs run their steps in order, record outputs and finish', async () => {
    const order = [];
    const pipeline = [
        { id: 'a', label: 'A', run: async (job, ctx) => { order.push('a'); ctx.progress(0.5); ctx.setOutput('x', 1); } },
        { id: 'b', label: 'B', run: async () => { order.push('b'); } },
    ];
    const q = createJobQueue({ dir: tmpDir(), pipeline });
    const job = q.submit({ title: 't' }, { userId: 'u1' });
    await q.idle();
    const done = q.get(job.id);
    assert.equal(done.status, 'done');
    assert.deepEqual(order, ['a', 'b']);
    assert.deepEqual(done.outputs, { x: 1 });
    assert.deepEqual(done.steps.map(s => s.status), ['done', 'done']);
    assert.equal(q.list('u1').length, 1);
    assert.equal(q.list('someone-else').length, 0);
});

test('internal data stays out of get and list but is readable with dataOf', async () => {
    const q = createJobQueue({ dir: tmpDir(), pipeline: [{ id: 'a', label: 'A', run: async (job, ctx) => { ctx.setData('secret', 1); } }] });
    const job = q.submit({}, { userId: 'u1' });
    await q.idle();
    assert.equal(q.get(job.id).data, undefined);
    assert.equal(q.list('u1')[0].data, undefined);
    assert.deepEqual(q.dataOf(job.id), { secret: 1 });
});

test('a failed job retries from the failed step, keeping finished ones', async () => {
    let attempts = 0;
    const ran = [];
    const pipeline = [
        { id: 'tts', label: 'TTS', run: async () => { ran.push('tts'); } },
        { id: 'render', label: 'Render', run: async () => { ran.push('render'); if (++attempts === 1) throw new Error('ffmpeg crashed'); } },
    ];
    const q = createJobQueue({ dir: tmpDir(), pipeline });
    const job = q.submit({});
    await q.idle();
    assert.equal(q.get(job.id).status, 'failed');
    assert.equal(q.get(job.id).error, 'ffmpeg crashed');
    q.retry(job.id);
    await q.idle();
    assert.equal(q.get(job.id).status, 'done');
    assert.deepEqual(ran, ['tts', 'render', 'render']);
});

test('cancel aborts the running step; a job left running by a crash resumes on restart', async () => {
    const dir = tmpDir();
    const pipeline = [
        { id: 'slow', label: 'Slow', run: async (job, ctx) => {
            for (let i = 0; i < 1000; i++) {
                if (ctx.signal.aborted) throw new Error('aborted');
                await tick();
            }
        } },
    ];
    const q = createJobQueue({ dir, pipeline });
    const job = q.submit({});
    await tick();
    assert.equal(q.get(job.id).status, 'running');
    q.cancel(job.id);
    await q.idle();
    assert.equal(q.get(job.id).status, 'cancelled');
    assert.equal(q.get(job.id).error, null);

    // simulate a crash mid-run: the file says running, a new queue instance picks it back up
    const file = path.join(dir, job.id, 'job.json');
    const saved = JSON.parse(fs.readFileSync(file, 'utf8'));
    saved.status = 'running';
    saved.steps[0].status = 'running';
    fs.writeFileSync(file, JSON.stringify(saved));
    const resumed = createJobQueue({ dir, pipeline: [{ id: 'slow', label: 'Slow', run: async () => { } }] });
    assert.equal(resumed.get(job.id).status, 'queued');
    resumed.start();
    await resumed.idle();
    assert.equal(resumed.get(job.id).status, 'done');
});

test('ETA extrapolates the running step and adds estimates for the rest', () => {
    const now = 1_000_000;
    const pipeline = [
        { id: 'tts', estimateSeconds: () => 600 },
        { id: 'render', estimateSeconds: job => job.input.frames / 200 },
        { id: 'thumb', estimateSeconds: () => 1 },
    ];
    const job = {
        input: { frames: 90_000 },
        steps: [
            { id: 'tts', status: 'running', progress: 0.25, startedAt: now - 100_000 },
            { id: 'render', status: 'pending' },
            { id: 'thumb', status: 'pending' },
        ],
    };
    // 100s for 25% -> 300s left, + 450s render + 1s
    assert.equal(estimateRemainingSeconds(job, pipeline, now), 751);
    job.steps[0] = { id: 'tts', status: 'done' };
    assert.equal(estimateRemainingSeconds(job, pipeline, now), 451);
});
