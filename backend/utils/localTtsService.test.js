import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { offsetChunkWords, synthesizeLong } from '../services/localTtsService.js';

function fakeDeps(calls) {
    // The fake "audio" file holds its text, so the fake Whisper can read it back.
    return {
        synthesizeChunk: async (text, outPath) => {
            calls.synth.push(text);
            fs.writeFileSync(outPath, text);
        },
        trimChunk: async (rawPath, outPath) => fs.copyFileSync(rawPath, outPath),
        getAudioDuration: async () => 2,
        transcribeWithLocal: async (wavPath) => ({
            words: fs.readFileSync(wavPath, 'utf8').split(/\s+/).map((t, i) => ({ text: t, start: i * 0.3, end: i * 0.3 + 0.25 })),
        }),
        transcribeWithGroq: async () => { throw new Error('unused'); },
        concatChunks: async (paths, outPath) => {
            calls.concat.push(paths);
            fs.writeFileSync(outPath, 'full');
        },
        changeTempo: async (inPath, outPath, tempo) => {
            calls.tempo = tempo;
            fs.copyFileSync(inPath, outPath);
        },
    };
}

const SCRIPT = 'One two three four. Five six seven eight. Nine ten eleven twelve.';

test('offsetChunkWords shifts each chunk by prior durations plus gaps', () => {
    const words = offsetChunkWords([
        { durationSec: 2, words: [{ text: 'a', start: 0, end: 0.5 }, { text: 'b', start: 1, end: 1.9 }] },
        { durationSec: 1, words: [{ text: 'c', start: 0, end: 0.4 }] },
    ], { fps: 30, gapSec: 0.5 });
    assert.deepEqual(words.map(w => w.startFrame), [0, 30, 75]);
    assert.equal(words[2].endFrame, 87);
});

test('offsetChunkWords keeps start frames strictly increasing across seams', () => {
    // Whisper sometimes reports words past the trimmed chunk end, or zero-length words.
    const words = offsetChunkWords([
        { durationSec: 1, words: [{ text: 'a', start: 0, end: 0 }, { text: 'b', start: 0, end: 1.4 }] },
        { durationSec: 1, words: [{ text: 'c', start: 0, end: 0.2 }, { text: 'd', start: 0.2, end: 0.2 }] },
    ], { fps: 30, gapSec: 0 });
    for (let i = 1; i < words.length; i++) {
        assert.ok(words[i].startFrame > words[i - 1].startFrame, `word ${i} starts after word ${i - 1}`);
        assert.ok(words[i].startFrame >= words[i - 1].endFrame, `word ${i} does not overlap`);
    }
    for (const w of words) assert.ok(w.endFrame > w.startFrame);
});

test('synthesizeLong returns concatenated, strictly increasing words', async () => {
    const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'localtts-'));
    const calls = { synth: [], concat: [] };
    const progress = [];
    const result = await synthesizeLong(SCRIPT, {
        workDir, chunkChars: 25, gapSec: 0.25, deps: fakeDeps(calls), onChunk: p => progress.push(p),
    });
    assert.equal(calls.synth.length, 3);
    assert.equal(result.words.length, 12);
    assert.equal(result.durationSec, 2 * 3 + 0.25 * 2);
    for (let i = 1; i < result.words.length; i++) {
        assert.ok(result.words[i].startFrame > result.words[i - 1].startFrame);
    }
    // Chunk 2 starts at 2s + 0.25s gap = frame 68 (rounded from 67.5).
    assert.equal(result.words[4].startFrame, 68);
    assert.equal(progress.at(-1).charsDone, progress.at(-1).charsTotal);
    fs.rmSync(workDir, { recursive: true, force: true });
});

test('synthesizeLong resumes by skipping finished chunks', async () => {
    const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'localtts-'));
    const first = { synth: [], concat: [] };
    const firstResult = await synthesizeLong(SCRIPT, { workDir, chunkChars: 25, deps: fakeDeps(first) });

    // Simulate a crash after chunk 0: remove chunk 1's outputs.
    fs.rmSync(path.join(workDir, 'chunk-001.wav'));
    fs.rmSync(path.join(workDir, 'chunk-001.json'));

    const second = { synth: [], concat: [] };
    const progress = [];
    const secondResult = await synthesizeLong(SCRIPT, {
        workDir, chunkChars: 25, deps: fakeDeps(second), onChunk: p => progress.push(p),
    });
    assert.deepEqual(second.synth, [first.synth[1]]);
    assert.equal(progress.length, 3, 'skipped chunks still report progress');
    assert.deepEqual(secondResult.words, firstResult.words);
    fs.rmSync(workDir, { recursive: true, force: true });
});

test('synthesizeLong regenerates a chunk whose text changed', async () => {
    const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'localtts-'));
    await synthesizeLong(SCRIPT, { workDir, chunkChars: 25, deps: fakeDeps({ synth: [], concat: [] }) });
    const calls = { synth: [], concat: [] };
    await synthesizeLong(SCRIPT.replace('Five', 'Fifty'), { workDir, chunkChars: 25, deps: fakeDeps(calls) });
    assert.equal(calls.synth.length, 1);
    assert.match(calls.synth[0], /Fifty/);
    fs.rmSync(workDir, { recursive: true, force: true });
});

test('synthesizeLong retries estimated timings without re-synthesizing', async () => {
    const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'localtts-'));
    const failing = fakeDeps({ synth: [], concat: [] });
    failing.transcribeWithLocal = async () => { throw new Error('whisper down'); };
    await synthesizeLong(SCRIPT, { workDir, chunkChars: 25, deps: failing });
    const meta = JSON.parse(fs.readFileSync(path.join(workDir, 'chunk-000.json'), 'utf8'));
    assert.equal(meta.timingSource, 'estimated');

    const calls = { synth: [], concat: [] };
    await synthesizeLong(SCRIPT, { workDir, chunkChars: 25, deps: fakeDeps(calls) });
    assert.equal(calls.synth.length, 0, 'audio is reused');
    const retried = JSON.parse(fs.readFileSync(path.join(workDir, 'chunk-000.json'), 'utf8'));
    assert.equal(retried.timingSource, 'local');
    fs.rmSync(workDir, { recursive: true, force: true });
});

test('offsetChunkWords divides times by the tempo', () => {
    const words = offsetChunkWords([
        { durationSec: 2, words: [{ text: 'a', start: 1.3, end: 2.6 }] },
        { durationSec: 1, words: [{ text: 'b', start: 0, end: 0.65 }] },
    ], { fps: 30, gapSec: 0.6, tempo: 1.3 });
    assert.deepEqual(words.map(w => [w.startFrame, w.endFrame]), [[30, 60], [60, 75]]);
});

test('synthesizeLong speeds the joined audio up and scales duration and words', async () => {
    const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'localtts-'));
    const calls = { synth: [], concat: [] };
    const normal = await synthesizeLong(SCRIPT, { workDir, chunkChars: 25, gapSec: 0.2, deps: fakeDeps(calls) });
    const fast = await synthesizeLong(SCRIPT, { workDir, chunkChars: 25, gapSec: 0.2, tempo: 1.25, deps: fakeDeps(calls) });
    assert.equal(calls.tempo, 1.25);
    assert.ok(Math.abs(fast.durationSec - normal.durationSec / 1.25) < 1e-9);
    assert.equal(fast.words.at(-1).startFrame, Math.round(normal.words.at(-1).startFrame / 1.25));
    fs.rmSync(workDir, { recursive: true, force: true });
});

test('synthesizeLong stops when the signal is aborted', async () => {
    const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'localtts-'));
    const controller = new AbortController();
    controller.abort(new Error('cancelled by user'));
    await assert.rejects(
        synthesizeLong(SCRIPT, { workDir, chunkChars: 25, signal: controller.signal, deps: fakeDeps({ synth: [], concat: [] }) }),
        /cancelled by user/
    );
    fs.rmSync(workDir, { recursive: true, force: true });
});
