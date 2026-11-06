import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { splitTextIntoBatches, removeSilence, getAudioDuration } from '../utils/audioUtils.js';
import { transcribeWithGroq, isGroqConfigured } from './groqTranscribeService.js';

/**
 * Local TTS through an OpenAI-compatible speech server: by default the
 * Pocket TTS server in backend/local-tts (http://localhost:3910); VoiceStudio
 * or vLLM/SGLang-Omni work too. Built for 40–50 min long-form scripts: the text is
 * split into ~900-char chunks, each chunk is synthesized, silence-trimmed and
 * transcribed for word timings, and the chunks are concatenated with a short
 * constant gap so the seams sound like a normal sentence pause.
 *
 * Every finished chunk leaves `chunk-NNN.wav` (trimmed audio) and
 * `chunk-NNN.json` (text hash, duration, chunk-relative words) in `workDir`,
 * so calling again with the same workDir skips the finished chunks.
 */

const execFileAsync = promisify(execFile);

export const DEFAULT_LOCAL_TTS_URL = 'http://localhost:3910';
const FPS = 30;
const CHUNK_CHARS = 900;
const GAP_SEC = 0.2;
// Pauses longer than PAUSE_MIN_SEC are cut down to PAUSE_KEEP_SEC; measured on Pocket TTS output
// this removes ~15% of the audio and leaves no pause over ~0.27 s.
const PAUSE_MIN_SEC = 0.15;
const PAUSE_KEEP_SEC = 0.12;
const SILENCE_DB = -35;

function authHeaders(apiKey) {
    return apiKey ? { Authorization: `Bearer ${apiKey}` } : {};
}

function normalizeBaseUrl(baseUrl) {
    return (baseUrl || DEFAULT_LOCAL_TTS_URL).replace(/\/+$/, '');
}

function throwIfAborted(signal) {
    if (signal?.aborted) {
        throw signal.reason instanceof Error ? signal.reason : new Error('Local TTS cancelled');
    }
}

function hashText(text) {
    return crypto.createHash('sha1').update(text).digest('hex');
}

const pad = (i) => String(i).padStart(3, '0');

/** Lists the server's voices (cloned voices plus built-in/alias voices). */
export async function listLocalVoices({ baseUrl, apiKey } = {}) {
    const res = await fetch(`${normalizeBaseUrl(baseUrl)}/v1/audio/voices`, { headers: authHeaders(apiKey) });
    if (!res.ok) throw new Error(`Local TTS voices ${res.status}: ${(await res.text().catch(() => '')).slice(0, 200)}`);
    const data = await res.json();
    return data.voices || [];
}

/**
 * Synthesizes one chunk (≤4096 chars) and writes a wav to outPath. `references` (Fish Drama 3:
 * [{ audio_path, text }]) clones a voice from a clip instead of a server-side voice id;
 * `headers` adds auth such as Modal's proxy-auth keys.
 */
export async function synthesizeChunk(text, outPath, { baseUrl, apiKey, voice, engine, speed, signal, references, headers } = {}) {
    const body = references
        ? { input: text, references, response_format: 'wav' }
        : { input: text, voice: voice || 'default', response_format: 'wav', speed: speed || 1.0 };
    if (engine && !references) body.model = engine;

    const res = await fetch(`${normalizeBaseUrl(baseUrl)}/v1/audio/speech`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders(apiKey), ...(headers || {}) },
        body: JSON.stringify(body),
        signal,
    });
    if (!res.ok) {
        const detail = await res.text().catch(() => '');
        throw new Error(`Local TTS speech ${res.status}: ${detail.slice(0, 300)}`);
    }
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length < 1000) throw new Error('Local TTS returned an empty audio file');
    // Write then rename, so a crash never leaves a half-written chunk that looks finished.
    fs.writeFileSync(outPath + '.part', buf);
    fs.renameSync(outPath + '.part', outPath);
}

/**
 * Word timings from the local server's Whisper. Same shape as transcribeWithGroq:
 * { text, words: [{ text, start, end }] } in seconds.
 */
export async function transcribeWithLocal(audioPath, { baseUrl, apiKey, signal } = {}) {
    const form = new FormData();
    const type = path.extname(audioPath).toLowerCase() === '.mp3' ? 'audio/mpeg' : 'audio/wav';
    form.append('file', new Blob([fs.readFileSync(audioPath)], { type }), path.basename(audioPath));
    form.append('model', 'whisper-1');
    form.append('response_format', 'verbose_json');
    form.append('timestamp_granularities[]', 'word');

    const res = await fetch(`${normalizeBaseUrl(baseUrl)}/v1/audio/transcriptions`, {
        method: 'POST',
        headers: authHeaders(apiKey),
        body: form,
        signal,
    });
    if (!res.ok) {
        const detail = await res.text().catch(() => '');
        throw new Error(`Local transcription ${res.status}: ${detail.slice(0, 300)}`);
    }
    const data = await res.json();
    const words = (data.words || [])
        .map(w => ({ text: (w.word ?? w.text ?? '').trim(), start: Number(w.start), end: Number(w.end) }))
        .filter(w => w.text !== '' && Number.isFinite(w.start) && Number.isFinite(w.end));
    if (words.length === 0) throw new Error('Local transcription returned no word timestamps');
    return { text: data.text || words.map(w => w.text).join(' '), words };
}

/** Evenly spread words over the chunk; last resort when both Whispers fail. */
export function estimateWordTimings(text, durationSec) {
    const tokens = text.split(/\s+/).filter(Boolean);
    const step = durationSec / Math.max(tokens.length, 1);
    return tokens.map((t, i) => ({ text: t, start: i * step, end: (i + 1) * step }));
}

/**
 * Turns per-chunk word timings (seconds, chunk-relative) into one frame-based
 * list relative to the concatenated audio. Chunk i starts at the sum of the
 * previous durations plus one gap per seam. `tempo` > 1 means the joined audio
 * was sped up by that factor, so every time is divided by it. Words never
 * overlap and start frames strictly increase, even across seams.
 */
export function offsetChunkWords(chunks, { fps = FPS, gapSec = GAP_SEC, tempo = 1, leadSec = 0 } = {}) {
    const out = [];
    let offset = leadSec;
    let prevEnd = 0;
    chunks.forEach((chunk, ci) => {
        if (ci > 0) offset += gapSec;
        for (const w of chunk.words || []) {
            let startFrame = Math.round((offset + w.start) / tempo * fps);
            let endFrame = Math.round((offset + w.end) / tempo * fps);
            if (out.length > 0) startFrame = Math.max(startFrame, prevEnd);
            endFrame = Math.max(endFrame, startFrame + 1);
            out.push({ text: w.text, startFrame, endFrame });
            prevEnd = endFrame;
        }
        offset += chunk.durationSec;
    });
    return out;
}

async function trimChunk(rawPath, outPath) {
    const ok = await removeSilence(rawPath, outPath, SILENCE_DB, {
        startThreshold: SILENCE_DB,
        stopThreshold: SILENCE_DB,
        startDuration: 0.05,
        stopDuration: PAUSE_MIN_SEC,
        stopSilence: PAUSE_KEEP_SEC,
        detectionMethod: 'rms',
        startPeriods: 1,
        stopPeriods: -1,
    });
    if (!ok) fs.copyFileSync(rawPath, outPath);
}

async function concatChunks(chunkPaths, outPath, gapSec, leadSec = 0) {
    const dir = path.dirname(outPath);
    const { stdout } = await execFileAsync('ffprobe', ['-v', 'error', '-select_streams', 'a:0',
        '-show_entries', 'stream=sample_rate', '-of', 'default=nw=1:nk=1', chunkPaths[0]]);
    const sampleRate = parseInt(stdout.trim(), 10) || 24000;
    const gapPath = path.join(dir, 'gap.wav');
    await execFileAsync('ffmpeg', ['-y', '-v', 'error', '-f', 'lavfi', '-i', `anullsrc=r=${sampleRate}:cl=mono`,
        '-t', String(gapSec), '-c:a', 'pcm_s16le', gapPath]);

    const lines = [];
    if (leadSec > 0) {
        const leadPath = path.join(dir, 'lead.wav');
        await execFileAsync('ffmpeg', ['-y', '-v', 'error', '-f', 'lavfi', '-i', `anullsrc=r=${sampleRate}:cl=mono`,
            '-t', String(leadSec), '-c:a', 'pcm_s16le', leadPath]);
        lines.push(`file '${leadPath.replace(/'/g, "'\\''")}'`);
    }
    chunkPaths.forEach((p, i) => {
        if (i > 0 && gapSec > 0) lines.push(`file '${gapPath}'`);
        lines.push(`file '${p.replace(/'/g, "'\\''")}'`);
    });
    const listPath = path.join(dir, 'concat.txt');
    fs.writeFileSync(listPath, lines.join('\n'));
    await execFileAsync('ffmpeg', ['-y', '-v', 'error', '-f', 'concat', '-safe', '0', '-i', listPath,
        '-ac', '1', '-ar', String(sampleRate), '-c:a', 'pcm_s16le', outPath], { maxBuffer: 16 * 1024 * 1024 });
}

/** Speeds audio up by `tempo` without changing pitch (ffmpeg atempo, valid 0.5–2.0 per stage). */
async function changeTempo(inPath, outPath, tempo) {
    await execFileAsync('ffmpeg', ['-y', '-v', 'error', '-i', inPath, '-af', `atempo=${tempo}`,
        '-c:a', 'pcm_s16le', outPath], { maxBuffer: 16 * 1024 * 1024 });
}

const defaultDeps = {
    synthesizeChunk,
    trimChunk,
    transcribeWithLocal,
    transcribeWithGroq,
    getAudioDuration,
    concatChunks,
    changeTempo,
};

/**
 * @param {string} text  full script
 * @param {object} opts
 * @param {string} opts.workDir   persistent dir; finished chunks are reused on re-runs
 * @param {string} [opts.baseUrl] speech server URL (default http://localhost:3910)
 * @param {string} [opts.apiKey]  bearer key, if the server needs one
 * @param {string} [opts.voice]   voice id of the clone (Pocket: reference clip name)
 * @param {string} [opts.engine]  sent as `model` when set; servers that host one model ignore it
 * @param {number} [opts.speed]  sent to the server; Pocket TTS ignores it
 * @param {number} [opts.tempo=1]  speeds the joined audio up (pitch kept), e.g. 1.3; word timings follow
 * @param {string} [opts.asrBaseUrl]  Whisper server when speech comes from elsewhere (default: baseUrl)
 * @param {Array} [opts.references]  clone-by-reference voice (Fish Drama 3), sent instead of `voice`
 * @param {object} [opts.headers]  extra request headers for the speech server (e.g. Modal proxy auth)
 * @param {number} [opts.leadSec=0]  silence before the first chunk (a part that continues a story starts with the seam gap)
 * @param {AbortSignal} [opts.signal]
 * @param {(p: {index, total, charsDone, charsTotal, audioSeconds}) => void} [opts.onChunk]
 * @param {boolean} [opts.transcribe=true]  false skips word timings (callers that transcribe later)
 * @param {string} [opts.groqApiKey]  Groq fallback for word timings
 * @param {number} [opts.concurrency]  chunks in flight (default LOCAL_TTS_CONCURRENCY or 5): the Pocket server runs 4 TTS
 *   workers, and one more keeps Whisper busy on finished chunks
 * @returns {Promise<{audioPath: string, durationSec: number, words: Array<{text, startFrame, endFrame}>}>}
 */
export async function synthesizeLong(text, opts = {}) {
    const {
        workDir, signal, onChunk,
        transcribe = true,
        groqApiKey,
        concurrency = Number(process.env.LOCAL_TTS_CONCURRENCY) || 5,
        chunkChars = CHUNK_CHARS,
        gapSec = GAP_SEC,
        tempo: rawTempo = 1,
        leadSec = 0,
        deps: depOverrides,
    } = opts;
    const tempo = Math.min(2, Math.max(0.5, Number(rawTempo) || 1));
    const deps = { ...defaultDeps, ...depOverrides };
    if (!workDir) throw new Error('synthesizeLong needs a workDir');
    if (!text || !text.trim()) throw new Error('synthesizeLong needs text');
    fs.mkdirSync(workDir, { recursive: true });

    const pieces = splitTextIntoBatches(text.trim(), chunkChars).filter(p => p && p.trim());
    const total = pieces.length;
    const charsTotal = pieces.reduce((n, p) => n + p.length, 0);
    const results = new Array(total);
    let charsDone = 0;
    let audioSeconds = 0;
    let done = 0;

    const report = (index, chunk) => {
        charsDone += pieces[index].length;
        audioSeconds += chunk.durationSec;
        done += 1;
        onChunk?.({ index, total, charsDone, charsTotal, audioSeconds, done });
    };

    async function processChunk(index) {
        const piece = pieces[index];
        const wavPath = path.join(workDir, `chunk-${pad(index)}.wav`);
        const metaPath = path.join(workDir, `chunk-${pad(index)}.json`);
        const hash = hashText(piece);

        // Finished audio for this exact text is reused; only missing or estimated timings are redone.
        let durationSec = null;
        if (fs.existsSync(metaPath) && fs.existsSync(wavPath)) {
            try {
                const meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
                if (meta.hash === hash) {
                    if (!transcribe || (meta.words?.length && meta.timingSource !== 'estimated')) {
                        results[index] = { ...meta, path: wavPath };
                        report(index, meta);
                        return;
                    }
                    durationSec = meta.durationSec;
                }
            } catch {
                // Corrupt metadata; regenerate the chunk.
            }
        }

        const rawPath = path.join(workDir, `chunk-${pad(index)}.raw.wav`);
        if (durationSec === null) {
            throwIfAborted(signal);
            if (!fs.existsSync(rawPath)) {
                await deps.synthesizeChunk(piece, rawPath, { ...opts, signal });
            }
            throwIfAborted(signal);
            await deps.trimChunk(rawPath, wavPath);
            durationSec = await deps.getAudioDuration(wavPath);
        }

        let words = [];
        let timingSource = 'none';
        if (transcribe) {
            try {
                // A cloud narrator still gets word timings from the local Whisper server
                words = (await deps.transcribeWithLocal(wavPath, {
                    ...opts, baseUrl: opts.asrBaseUrl || opts.baseUrl, apiKey: opts.asrBaseUrl ? null : opts.apiKey, signal,
                })).words;
                timingSource = 'local';
            } catch (localErr) {
                throwIfAborted(signal);
                console.warn(`[LocalTTS] chunk ${index}: local Whisper failed (${localErr.message})`);
                if (isGroqConfigured(groqApiKey)) {
                    try {
                        words = (await deps.transcribeWithGroq(wavPath, groqApiKey)).words;
                        timingSource = 'groq';
                    } catch (groqErr) {
                        console.warn(`[LocalTTS] chunk ${index}: Groq failed (${groqErr.message})`);
                    }
                }
                if (words.length === 0) {
                    words = estimateWordTimings(piece, durationSec);
                    timingSource = 'estimated';
                }
            }
        }

        const meta = { hash, durationSec, words, timingSource };
        fs.writeFileSync(metaPath, JSON.stringify(meta));
        fs.rmSync(rawPath, { force: true });
        results[index] = { ...meta, path: wavPath };
        report(index, meta);
    }

    let next = 0;
    const workers = Array.from({ length: Math.max(1, Math.min(32, concurrency, total)) }, async () => {
        while (next < total) {
            const index = next++;
            await processChunk(index);
        }
    });
    await Promise.all(workers);
    throwIfAborted(signal);

    const joinedPath = path.join(workDir, 'joined.wav');
    await deps.concatChunks(results.map(r => r.path), joinedPath, gapSec, leadSec);
    const audioPath = path.join(workDir, 'full.wav');
    if (tempo !== 1) await deps.changeTempo(joinedPath, audioPath, tempo);
    else fs.copyFileSync(joinedPath, audioPath);
    const durationSec = (leadSec + results.reduce((s, r) => s + r.durationSec, 0) + gapSec * Math.max(0, total - 1)) / tempo;
    const words = transcribe ? offsetChunkWords(results, { fps: FPS, gapSec, tempo, leadSec }) : [];

    const estimated = results.filter(r => r.timingSource === 'estimated').length;
    if (estimated) console.warn(`[LocalTTS] ${estimated}/${total} chunks used estimated word timings`);
    console.log(`[LocalTTS] ${total} chunks, ${charsTotal} chars, ${durationSec.toFixed(1)}s audio at ${tempo}x`);

    return { audioPath, durationSec, words };
}
