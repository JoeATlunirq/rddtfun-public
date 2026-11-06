// Long-form video + linked promo short, as job-queue steps (see jobQueue.js):
// prepare -> long video (narrated in parts; each part renders while the next is narrated, and the
// promo short is voiced and rendered alongside) -> narrate short + render short (only if that
// failed) -> thumbnail -> save. Every step resumes from its work dir.
import fs from 'fs';
import crypto from 'crypto';
import path from 'path';
import { promisify } from 'util';
import { execFile } from 'child_process';
import { fileURLToPath } from 'url';
import {
    splitTextIntoBatches, generateAudio, generateFishAudio, removeSilence, getAudioDuration,
    transcribeAudio, applyTimeStretch, ELEVENLABS_MODEL_ID,
} from '../utils/audioUtils.js';
import { getSpeedFactorForMaximum, selectTargetDuration } from '../utils/durationUtils.js';
import { generateVibiAudio } from './vibiService.js';
import { sanitizeWordTimings } from '../utils/captionUtils.js';
import { captionLookFromStyle } from '../render/styles.js';
import { renderVideo } from '../render/index.js';
import { renderThumbnail, toTitleCase } from '../render/thumbnail.js';
import { getLandscapeBackgroundVideos } from './backgroundLibrary.js';

const execFileAsync = promisify(execFile);
const FPS = 30;
export const CTA_LINE = 'If you want to see the Full story its on my channel and linked below.';
// Narration pace used for estimates before any audio exists (~15 chars/s of speech)
export const CHARS_PER_AUDIO_SECOND = 15;
// Speed assumptions for ETAs until a job has measured its own
const DEFAULT_TTS_CHARS_PER_SECOND = { local: 120, elevenlabs: 120, fish: 120, vibi: 80 };
const DEFAULT_RENDER_FPS = { portrait: 190, landscape: 280 };
// The long script is narrated and rendered in parts of about this many characters (~5 min of
// video): part N renders while part N+1 is narrated, so the job takes ~max(TTS, render), not the sum.
const LONG_PART_CHARS = Number(process.env.LONGFORM_PART_CHARS) || 7000;
// Silence between two parts, the same seam the local narrator leaves between its chunks
const PART_GAP_SEC = 0.2;
const PART_RENDERS = Number(process.env.LONGFORM_PART_RENDERS) || 2;
const PART_NARRATIONS = Number(process.env.LONGFORM_PART_NARRATIONS) || 2;
const NARRATION_CHUNK_CHARS = 1200;

const camel = s => s.replace(/_([a-z])/g, (_, c) => c.toUpperCase());
const camelKeys = row => Object.fromEntries(Object.entries(row || {}).map(([k, v]) => [camel(k), v]));

// A closing sentence that points at the channel. "The full story came out" alone is still story.
const CTA_SENTENCE = /\b(link(ed)? below|(on|in) (my|the|our) (channel|bio|description)|channel (linked )?below|full story (is )?(on|in|below|linked|at))\b/i;

/**
 * Separates a promo script's closing CTA from the story. The script's own CTA wording is kept;
 * without one the story gets CTA_LINE. A closing quote around the CTA stays with the story.
 */
export function splitCta(script) {
    const text = String(script || '').trim();
    const sentences = text.match(/[^.!?]+[.!?]*["'”’)\]]*\s*/g) || [];
    let count = 0;
    while (count < 2 && count < sentences.length && CTA_SENTENCE.test(sentences[sentences.length - 1 - count])) count++;
    if (count === 0) return { story: /[.!?]["'”’)\]]*$/.test(text) ? text : `${text}.`, cta: CTA_LINE };
    const raw = sentences.slice(-count).join('').trim();
    const closers = raw.match(/["'”’)\]]+$/)?.[0] || '';
    const story = sentences.slice(0, -count).join('').trim();
    return { story: `${story}${closers}`, cta: raw.slice(0, raw.length - closers.length).trim() };
}

/** Promo shorts end with the CTA line (added if the script doesn't already say it). */
export function withCtaLine(script) {
    const { story, cta } = splitCta(script);
    return `${story} ${cta}`.trim();
}

const speechTokens = text => String(text || '').toLowerCase().match(/[a-z0-9']+/g) || [];

/** Whether the transcript of a voiced CTA contains most of its words (TTS can drop or garble a line). */
export function ctaWasSpoken(cta, words) {
    const heard = new Set(speechTokens((words || []).map(w => w.text).join(' ')));
    const expected = speechTokens(cta);
    return expected.length > 0 && expected.filter(t => heard.has(t)).length / expected.length >= 0.6;
}

const CTA_WORD = /^(full|story|channel|linked|link|below|part)$/i;
const CTA_FALLBACK_SECONDS = 3.5;

/**
 * How long the CTA arrow shows: from the first word of the closing CTA sentence ("Full story on my
 * channel linked below.") to the end of the script audio, like the competitor's arrow that appears
 * only while the CTA is spoken. Falls back to 3.5 s when the timings don't contain a CTA sentence.
 */
export function ctaArrowSeconds(words, scriptSeconds, fps = FPS) {
    const list = (words || []).filter(w => String(w.text || '').trim());
    if (list.length === 0) return CTA_FALLBACK_SECONDS;
    const clean = w => w.text.replace(/[^a-z]/gi, '').toLowerCase();
    // "Full story ..." near the end marks the CTA directly
    let start = -1;
    for (let i = list.length - 2; i >= Math.max(0, list.length - 16); i--) {
        if (clean(list[i]) === 'full' && clean(list[i + 1]) === 'story') { start = i; break; }
    }
    // Otherwise the CTA is the last sentence: it starts after the last sentence end before the final word
    if (start < 0) {
        start = 0;
        for (let i = list.length - 2; i >= 0; i--) {
            if (/[.!?]["')\]]*$/.test(list[i].text.trim())) { start = i + 1; break; }
        }
    }
    const sentence = list.slice(start);
    if (sentence.length > 14 || !sentence.some(w => CTA_WORD.test(clean(w)))) return CTA_FALLBACK_SECONDS;
    const seconds = scriptSeconds - sentence[0].startFrame / fps;
    return Math.min(8, Math.max(1, seconds));
}

export const estimateAudioSeconds = text => String(text || '').length / CHARS_PER_AUDIO_SECOND;

// Finished-video pace of the local narrator at 1x after pause cutting: 49,865 chars came out as
// 2,030 s at 1.15x (24.6 chars/s), i.e. ~21.4 chars/s per unit of tempo
const LOCAL_CHARS_PER_SECOND_AT_1X = 21.4;
const localTempo = () => Number(process.env.LOCAL_TTS_TEMPO) || LOCAL_TTS_TEMPO;

/** Expected length of the finished video for `text` with this narrator (the page shows it before rendering). */
export function estimateVideoSeconds(text, provider) {
    const chars = String(text || '').length;
    return provider === 'local' ? chars / (LOCAL_CHARS_PER_SECOND_AT_1X * localTempo()) : chars / CHARS_PER_AUDIO_SECOND;
}

// Fish Drama reads ~17.5 chars/s at 1x (measured on 3 finished long videos)
const LONG_LOCAL_CHARS_PER_SECOND_AT_1X = 17.5;

/** Expected length of a long video, which always plays at longformTempo(). */
export function estimateLongVideoSeconds(text, provider) {
    const chars = String(text || '').length;
    return provider === 'local' ? chars / (LONG_LOCAL_CHARS_PER_SECOND_AT_1X * longformTempo()) : chars / CHARS_PER_AUDIO_SECOND;
}

// ---------------------------------------------------------------- config (channel, presets, keys)

async function loadPreset(deps, userId, id, type) {
    if (!id) return null;
    if (deps.supabase) {
        const { data } = await deps.supabase.from('presets').select('*').eq('id', id).eq('user_id', userId).eq('type', type).maybeSingle();
        if (data) return data;
    }
    const file = path.join(deps.dataDir, 'presets.json');
    if (!fs.existsSync(file)) return null;
    return JSON.parse(fs.readFileSync(file, 'utf8')).find(p => p.id === id && p.type === type) || null;
}

async function loadSettings(deps, userId) {
    const local = deps.getLocalSettings?.(userId) || {};
    let row = {};
    if (deps.supabase) {
        const { data } = await deps.supabase.from('user_settings').select('*').eq('user_id', userId).maybeSingle();
        row = data || {};
    }
    const pick = (snake, camelName) => row[snake] || local[camelName] || local[snake] || null;
    return {
        elevenlabsApiKey: pick('elevenlabs_api_key', 'elevenlabsApiKey'),
        fishAudioApiKey: pick('fish_audio_api_key', 'fishAudioApiKey'),
        openaiApiKey: pick('openai_api_key', 'openaiApiKey'),
        vibiApiKey: pick('vibi_api_key', 'vibiApiKey'),
        groqApiKey: pick('groq_api_key', 'groqApiKey') || process.env.GROQ_API_KEY || null,
        // Unset → localTtsService's default (the Pocket TTS server on :3910).
        localTtsUrl: pick('local_tts_url', 'localTtsUrl') || process.env.LOCAL_TTS_URL || null,
        localTtsApiKey: pick('local_tts_api_key', 'localTtsApiKey'),
    };
}

/** The hook a side opens with. Jobs from before each side had its own hook share `input.title`. */
export function hookFor(input, side) {
    return String(input?.[side]?.hook || input?.title || '').trim();
}

/** Everything a video side (short or long) needs to render, resolved once per job. */
async function loadSideConfig(deps, userId, side, channel) {
    const caption = await loadPreset(deps, userId, side.captionPresetId || channel?.caption_preset_id, 'caption_style');
    const hook = await loadPreset(deps, userId, side.hookStylePresetId || channel?.hook_style_preset_id, 'hook_style');
    const audio = await loadPreset(deps, userId, side.audioPresetId || channel?.female_voice_preset_id || channel?.male_voice_preset_id, 'audio');
    const style = caption?.caption_style || caption?.captionStyle || {};
    return {
        audio: audio ? camelKeys(audio) : null,
        caption: {
            font: style.font || channel?.font || 'Jellee',
            subtitleSize: style.subtitle_size || channel?.subtitle_size || 64,
            strokeSize: style.stroke_size ?? channel?.stroke_size ?? 8,
            color: style.color || '#FFFFFF',
            animation: style.caption_animation_type || 'scale',
            look: captionLookFromStyle(style),
        },
        hookStyle: hook?.hook_style || hook?.hookStyle || null,
        hookAnimation: channel?.hook_animation_type || 'fall',
        backgroundType: side.backgroundType || channel?.background_video_type || 'satisfying',
    };
}

// ---------------------------------------------------------------- narration

async function speakWithCloudProvider(text, preset, settings, voiceFallback) {
    const provider = preset?.ttsProvider || 'elevenlabs';
    if (provider === 'fish') return generateFishAudio(text, settings.fishAudioApiKey, preset.fishAudioModelId);
    if (provider === 'vibi') return generateVibiAudio(text, settings.vibiApiKey, preset.vibiVoiceId, preset.vibiModelId);
    return generateAudio(text, settings.elevenlabsApiKey, preset?.voiceId || voiceFallback, ELEVENLABS_MODEL_ID);
}

const LONGFORM_CAPTION_SCALE = 1.25;

// Speed-up for the local (Pocket TTS) narrator; LOCAL_TTS_TEMPO in .env overrides it.
export const LOCAL_TTS_TEMPO = 1.1;
// Long videos read faster than the voices' natural pace (pitch kept). LONGFORM_TEMPO in .env overrides it.
export const LONGFORM_TEMPO = 1.2;
export const longformTempo = () => Number(process.env.LONGFORM_TEMPO) || LONGFORM_TEMPO;

// ---------------------------------------------------------------- Fish Drama 3 (cloud)

export const FISH_DRAMA_ENGINE = 'fish-drama';
const VOICES_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'local-tts', 'voices');

/**
 * synthesizeLong options for Fish Drama 3 on Modal (backend/cloud-tts/fish_drama.py). The voice is
 * cloned from `<voice>.wav` on the fish-drama-voices volume plus its transcript, kept locally in
 * backend/local-tts/voices/<voice>.txt. Needs FISH_DRAMA_URL, MODAL_PROXY_KEY and MODAL_PROXY_SECRET.
 */
export function fishDramaOptions(voice = 'narrator') {
    const url = process.env.FISH_DRAMA_URL;
    if (!url) throw new Error('FISH_DRAMA_URL is not set: deploy backend/cloud-tts/fish_drama.py and add its URL to .env');
    const transcriptFile = path.join(VOICES_DIR, `${voice}.txt`);
    if (!fs.existsSync(transcriptFile)) throw new Error(`Missing ${transcriptFile}: the transcript of the ${voice} reference clip`);
    return {
        baseUrl: url,
        headers: { 'Modal-Key': process.env.MODAL_PROXY_KEY || '', 'Modal-Secret': process.env.MODAL_PROXY_SECRET || '' },
        references: [{ audio_path: `/voices/${voice}.wav`, text: fs.readFileSync(transcriptFile, 'utf8').trim() }],
        // One GPU serves many chunks at once; Fish reads at a natural pace, so no speed-up by default
        concurrency: Number(process.env.FISH_DRAMA_CONCURRENCY) || 16,
        tempo: Number(process.env.FISH_DRAMA_TEMPO) || 1,
    };
}

/**
 * Start booting the Fish Drama GPU container (~4 min cold start, mostly loading weights) without
 * waiting, so it overlaps the rest of the job instead of delaying the first TTS chunk.
 */
export function wakeFishDrama() {
    const url = process.env.FISH_DRAMA_URL;
    if (!url) return;
    fetch(`${url}/health`, {
        headers: { 'Modal-Key': process.env.MODAL_PROXY_KEY || '', 'Modal-Secret': process.env.MODAL_PROXY_SECRET || '' },
        signal: AbortSignal.timeout(900_000),
    }).catch(() => { });
}

/**
 * Narrate `text` into one audio file with 30fps word timings. Chunks are kept in `workDir` and
 * skipped on a re-run, so a failed or restarted job never pays for the same TTS twice.
 * The local provider (Pocket TTS server) does its own chunking in localTtsService.synthesizeLong.
 */
export async function narrate(text, { preset, settings, voiceFallback, workDir, signal, leadSec = 0, tempo = null, onChunk = () => { } }) {
    fs.mkdirSync(workDir, { recursive: true });
    if (preset?.ttsProvider === 'local') {
        let local;
        try {
            local = await import('./localTtsService.js');
        } catch {
            throw new Error('Local TTS is not set up yet: backend/services/localTtsService.js is missing');
        }
        if (preset.localEngine === FISH_DRAMA_ENGINE) {
            // Fish Drama 3 on Modal (serverless GPU): speech in the cloud, word timings from the local Whisper server
            return local.synthesizeLong(text, {
                ...fishDramaOptions(preset.localVoiceId),
                ...(tempo ? { tempo } : {}),
                // Never fall back to the Modal URL: it only does speech and rejects anything without proxy auth
                asrBaseUrl: settings.localTtsUrl || local.DEFAULT_LOCAL_TTS_URL,
                workDir, signal, onChunk, leadSec,
            });
        }
        return local.synthesizeLong(text, {
            baseUrl: settings.localTtsUrl, apiKey: settings.localTtsApiKey,
            voice: preset.localVoiceId, engine: preset.localEngine, speed: preset.speed,
            // Pocket TTS reads slowly; long-form has no length cap, so it is sped up instead.
            tempo: preset.tempo ?? tempo ?? (Number(process.env.LOCAL_TTS_TEMPO) || LOCAL_TTS_TEMPO),
            workDir, signal, onChunk, leadSec,
        });
    }

    const chunks = splitTextIntoBatches(text, NARRATION_CHUNK_CHARS);
    const charsTotal = chunks.reduce((sum, c) => sum + c.length, 0);
    const parts = [];
    let charsDone = 0;
    let offsetFrames = 0;
    for (let i = 0; i < chunks.length; i++) {
        if (signal?.aborted) throw new Error('cancelled');
        const base = path.join(workDir, `chunk-${String(i).padStart(4, '0')}`);
        const metaFile = `${base}.json`;
        let meta = fs.existsSync(metaFile) ? JSON.parse(fs.readFileSync(metaFile, 'utf8')) : null;
        if (!meta || meta.text !== chunks[i]) {
            const raw = `${base}.raw.mp3`;
            fs.writeFileSync(raw, await speakWithCloudProvider(chunks[i], preset, settings, voiceFallback));
            const trimmed = `${base}.mp3`;
            await removeSilence(raw, trimmed, preset?.thresholdDb ?? -35);
            fs.rmSync(raw, { force: true });
            const seconds = await getAudioDuration(trimmed);
            const words = await transcribeAudio(trimmed, settings.elevenlabsApiKey, settings.openaiApiKey, 'single', null, settings.groqApiKey);
            meta = { text: chunks[i], file: trimmed, seconds, words };
            fs.writeFileSync(metaFile, JSON.stringify(meta));
        }
        parts.push(meta);
        charsDone += chunks[i].length;
        onChunk({ index: i, total: chunks.length, charsDone, charsTotal, audioSeconds: parts.reduce((s, p) => s + p.seconds, 0) });
    }

    const words = [];
    for (const part of parts) {
        for (const w of part.words || []) words.push({ ...w, startFrame: w.startFrame + offsetFrames, endFrame: w.endFrame + offsetFrames });
        offsetFrames += Math.round(part.seconds * FPS);
    }
    const audioPath = path.join(workDir, 'narration.mp3');
    const list = path.join(workDir, 'chunks.txt');
    fs.writeFileSync(list, parts.map(p => `file '${p.file.replace(/'/g, "'\\''")}'`).join('\n') + '\n');
    await execFileAsync('ffmpeg', ['-y', '-v', 'error', '-f', 'concat', '-safe', '0', '-i', list, '-c', 'copy', audioPath]);
    return { audioPath, durationSec: await getAudioDuration(audioPath), words };
}

// ---------------------------------------------------------------- steps

/**
 * Word timings for captions under the hook card, from the narrated title. They show the card's own
 * words when Whisper heard the same number of words ("10", not "Ten"); otherwise what it heard.
 */
export function hookCaptionWords(hookText, words, color) {
    const shown = String(hookText || '').trim().split(/\s+/);
    const list = words || [];
    return list.map((w, i) => ({ ...w, text: shown.length === list.length ? shown[i] : w.text, color: w.color || color }));
}

function renderSpec({ job, config, narration, title, format, backgrounds, extra = {} }) {
    const { channel } = job.data;
    const spec = {
        channelName: channel?.name || 'Channel',
        channelImage: channel?.image_url || null,
        hookText: toTitleCase(title),
        audioUrl: narration.title.audioPath,
        audioDurationInSeconds: narration.title.durationSec,
        hook_animation_type: config.hookAnimation,
        hookStyle: config.hookStyle,
        subtitleText: narration.script.text || '',
        scriptAudioUrl: narration.script.audioPath,
        scriptAudioDurationInSeconds: narration.script.durationSec,
        wordTimings: sanitizeWordTimings(narration.script.words.map(w => ({ ...w, color: w.color || config.caption.color })), FPS) || [],
        backgroundVideoPath: backgrounds,
        font: config.caption.font,
        subtitle_size: config.caption.subtitleSize,
        stroke_size: config.caption.strokeSize,
        captionAnimation: config.caption.animation,
        captionLook: config.caption.look,
        format,
        // Long-form gameplay clips are used exactly as they are in the file: no grade, filter, mirror or re-encode
        rawBackground: true,
        ...extra,
    };
    // Same rule as regular shorts: only a top or floating card has captions running under it
    if (spec.hookStyle?.hookTopPosition || (spec.hookStyle?.animation || spec.hook_animation_type) === 'float') {
        spec.hookWordTimings = sanitizeWordTimings(hookCaptionWords(spec.hookText, narration.title.words, config.caption.color), FPS) || [];
    }
    return spec;
}

function renderProgress(ctx) {
    return p => {
        if (p.stage === 'rendering') ctx.progress(0.1 + 0.85 * p.progress, { framesDone: p.framesDone, totalFrames: p.totalFrames, fps: p.fps });
        else if (p.stage === 'finalizing') ctx.progress(0.95 + 0.05 * p.progress);
        else ctx.progress(0.1 * p.progress);
    };
}

/**
 * Speeds the title and script narration up by one shared factor when together they run past
 * `targetSeconds` (as server.js does for regular shorts); shorter audio is left at 1x. Word timings
 * are scaled to match.
 */
export async function fitToTarget(title, body, targetSeconds, workDir, stretch = applyTimeStretch) {
    const factor = getSpeedFactorForMaximum(title.durationSec + body.durationSec, targetSeconds);
    if (factor <= 1) return { title, body };
    console.log(`[Longform] promo short ${(title.durationSec + body.durationSec).toFixed(1)}s > ${targetSeconds}s target: ${factor.toFixed(3)}x`);
    const speedUp = async (narration, name) => {
        const out = path.join(workDir, `${name}-fit.mp3`); // applyTimeStretch always encodes mp3
        await stretch(narration.audioPath, out, factor);
        return {
            ...narration,
            audioPath: out,
            durationSec: narration.durationSec / factor,
            ...(narration.ctaStartSec != null ? { ctaStartSec: narration.ctaStartSec / factor } : {}),
            words: (narration.words || []).map(w => ({ ...w, startFrame: Math.round(w.startFrame / factor), endFrame: Math.round(w.endFrame / factor) })),
        };
    };
    return { title: await speedUp(title, 'title'), body: await speedUp(body, 'script') };
}

const CTA_GAP_SEC = 0.25;
const CTA_ATTEMPTS = 3;

/**
 * Voice the CTA on its own: Fish Drama can end a chunk early and drop its last sentence, which once
 * shipped a promo short without one. Whisper checks the line was really said, else it is voiced
 * again; a short without its CTA fails rather than being delivered.
 */
export async function voiceCta(cta, speak, options) {
    for (let attempt = 1; attempt <= CTA_ATTEMPTS; attempt++) {
        const voiced = await speak(cta, options);
        if (ctaWasSpoken(cta, voiced.words)) return voiced;
        console.warn(`[Longform] CTA not heard on attempt ${attempt}/${CTA_ATTEMPTS}: "${(voiced.words || []).map(w => w.text).join(' ')}"`);
        fs.rmSync(options.workDir, { recursive: true, force: true });
    }
    throw new Error(`The voice engine did not say the CTA line after ${CTA_ATTEMPTS} attempts: "${cta}"`);
}

/**
 * Captions for the CTA, from its known text spread over its audio by length. Whisper only confirms
 * the line was said: it misses the first word of a clip that starts abruptly ("Full" in "Full story").
 */
export function ctaCaptionWords(text, durationSec, startFrame = 0, fps = FPS) {
    const words = String(text).trim().split(/\s+/);
    const total = words.reduce((n, w) => n + w.length, 0);
    let chars = 0;
    return words.map(word => {
        const start = (chars / total) * durationSec;
        chars += word.length;
        return { text: word, startFrame: startFrame + Math.round(start * fps), endFrame: startFrame + Math.round((chars / total) * durationSec * fps) };
    });
}

/** Story + a short pause + CTA as one narration, recording where the CTA starts. */
async function joinCta(story, cta, text, workDir) {
    const audioPath = path.join(workDir, 'story-cta.wav');
    const voice = 'aresample=44100,aformat=sample_fmts=s16:channel_layouts=mono';
    await execFileAsync('ffmpeg', ['-y', '-v', 'error', '-i', story.audioPath, '-f', 'lavfi', '-t', String(CTA_GAP_SEC), '-i', 'anullsrc=r=44100:cl=mono', '-i', cta.audioPath,
        '-filter_complex', `[0:a]${voice}[s];[1:a]${voice}[g];[2:a]${voice}[c];[s][g][c]concat=n=3:v=0:a=1[a]`, '-map', '[a]', '-c:a', 'pcm_s16le', audioPath]);
    const ctaStartSec = story.durationSec + CTA_GAP_SEC;
    return {
        audioPath,
        durationSec: ctaStartSec + cta.durationSec,
        ctaStartSec,
        words: [...story.words, ...ctaCaptionWords(text, cta.durationSec, Math.round(ctaStartSec * FPS))],
    };
}

/**
 * Voice the promo short (title + story + CTA) and fit it to its audio preset's length. Runs alongside
 * the long video's narration (one GPU serves both); the narrate_short step re-runs it if that failed.
 */
async function narrateShort(job, deps, { signal, workDir, setData, onProgress = () => { } }) {
    const { settings, channel } = job.data;
    const config = job.data.config.short;
    const { story, cta } = splitCta(job.input.short.script);
    const common = { preset: config.audio, settings, voiceFallback: channel?.voice_id, signal };
    const speak = deps.narrate || narrate;
    let title = await speak(hookFor(job.input, 'short'), { ...common, workDir: path.join(workDir, 'title') });
    const started = Date.now();
    const storyVoice = await speak(story, {
        ...common,
        workDir: path.join(workDir, 'script'),
        onChunk: c => onProgress(c.charsDone / Math.max(1, c.charsTotal), {
            chunk: c.index + 1, chunks: c.total, charsPerSecond: c.charsDone / Math.max(1, (Date.now() - started) / 1000),
        }),
    });
    const ctaVoice = await voiceCta(cta, speak, { ...common, workDir: path.join(workDir, 'cta') });
    let body = await joinCta(storyVoice, ctaVoice, cta, workDir);
    // Same length rule as a regular short: title + story + CTA are sped up (pitch kept) to fit the
    // audio preset's target, or the length picked from its min-max range when the presets loaded
    const target = job.data.shortTargetSeconds ?? selectTargetDuration(config.audio);
    ({ title, body } = await fitToTarget(title, body, target, workDir));
    setData('shortNarration', {
        title: { audioPath: title.audioPath, durationSec: title.durationSec, words: title.words },
        script: { text: `${story} ${cta}`, audioPath: body.audioPath, durationSec: body.durationSec, ctaStartSec: body.ctaStartSec, words: body.words },
    });
}

const narrationEstimate = sideKey => job => {
    const provider = job.data?.config?.[sideKey]?.audio?.ttsProvider || 'elevenlabs';
    const chars = String(job.input?.[sideKey]?.script || '').length + hookFor(job.input, sideKey).length;
    return chars / (DEFAULT_TTS_CHARS_PER_SECOND[provider] || 60);
};

const renderEstimate = (sideKey, format) => job => {
    const seconds = job.data?.[`${sideKey}Narration`]?.script?.durationSec ?? estimateAudioSeconds(job.input?.[sideKey]?.script);
    return (seconds * FPS) / DEFAULT_RENDER_FPS[format] + 15;
};

/** Render settings that make the long video look like QuokkaReads (see the spec's look section). */
function longformLook(config) {
    return {
        // Light Reddit card like QuokkaReads, whatever colours the channel's short-form preset uses
        hookStyle: { borderRadius: 40, ...(config.hookStyle || {}), font: 'Inter ExtraBold', titleColor: '#111111', backgroundColor: '#ffffff', menuDots: false, scale: 1.6, hookTopPosition: false, titleLineHeight: 1.1 },
        // Captions ~25% bigger than the short-form preset, letters exactly on the frame's center line
        subtitle_size: Math.round((config.caption.subtitleSize || 64) * LONGFORM_CAPTION_SCALE),
        captionLook: { ...(config.caption.look || {}), position: 'center', opticalCenter: true },
        has_background_music: false,
        videoBitrate: process.env.LONGFORM_VIDEO_BITRATE || '6M',
        // The Apple hardware HEVC encoder is ~37% faster than H.264 at equal or better quality
        videoCodec: process.env.LONGFORM_VIDEO_CODEC || 'hevc',
    };
}

/** Background music from the audio preset, like a regular short (its custom track at its dB level). */
export function presetMusic(audio) {
    if (!audio?.addBackgroundMusic || !audio.customMusicUrl) return {};
    return { has_background_music: true, backgroundMusicUrl: audio.customMusicUrl, background_music_volume: Math.pow(10, (audio.musicVolumeDb ?? -18) / 20) };
}

/** The arrow shows exactly while the CTA is spoken: from the start of its audio to the end of the video. */
const arrowSeconds = script => (script.ctaStartSec != null
    ? script.durationSec - script.ctaStartSec
    : ctaArrowSeconds(script.words, script.durationSec)); // voiced before the CTA had its own audio

/** Render the promo short (9:16, CTA arrow). Shared by the long-video step (runs it alongside) and render_short. */
async function renderShortVideo(job, deps, { signal, workDir, onProgress = () => { }, setData, setOutput }) {
    const config = job.data.config.short;
    const narration = job.data.shortNarration;
    const seconds = narration.title.durationSec + narration.script.durationSec;
    const backgrounds = job.data.shortBackgrounds || await deps.getShortBackgrounds(config.backgroundType, seconds + 5);
    setData('shortBackgrounds', backgrounds);
    const outputPath = path.join(deps.publicDir, 'videos', `${job.id}-short.mp4`);
    await renderVideo(renderSpec({
        job, config, narration, title: hookFor(job.input, 'short'), format: 'portrait', backgrounds,
        extra: { ctaArrow: { seconds: arrowSeconds(narration.script) }, ...presetMusic(config.audio) },
    }), { outputPath, signal, resumeDir: path.join(workDir, 'render'), onProgress });
    setOutput('shortVideo', `/videos/${path.basename(outputPath)}`);
}

/** Losslessly join the rendered parts of the long video (same codec and settings, so stream copy). */
async function joinParts(partFiles, outputPath, workDir) {
    const list = path.join(workDir, 'parts.txt');
    fs.writeFileSync(list, partFiles.map(f => `file '${f.replace(/'/g, "'\\''")}'`).join('\n') + '\n');
    const tmp = path.join(workDir, 'joined.mp4');
    await execFileAsync('ffmpeg', ['-y', '-v', 'error', '-f', 'concat', '-safe', '0', '-i', list, '-c', 'copy', '-movflags', '+faststart', tmp]);
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    fs.renameSync(tmp, outputPath);
}

// ---------------------------------------------------------------- speed history (ETAs)

const speedFile = deps => path.join(deps.dataDir, 'longform-speed.json');

/** Measured speed of past long-video steps: script characters per second of wall time (last 5 jobs). */
export function longCharsPerSecond(deps) {
    try {
        const runs = JSON.parse(fs.readFileSync(speedFile(deps), 'utf8')).runs || [];
        const recent = runs.slice(-5);
        const chars = recent.reduce((n, r) => n + r.chars, 0);
        const seconds = recent.reduce((n, r) => n + r.seconds, 0);
        if (chars > 0 && seconds > 0) return chars / seconds;
    } catch { /* no history yet */ }
    return null;
}

function recordLongSpeed(deps, run) {
    if (!deps.dataDir || !(run.chars > 5000)) return;
    let runs = [];
    try {
        runs = JSON.parse(fs.readFileSync(speedFile(deps), 'utf8')).runs || [];
    } catch { /* first run */ }
    runs.push({ ...run, at: Date.now() });
    fs.writeFileSync(speedFile(deps), JSON.stringify({ runs: runs.slice(-20) }, null, 2));
}

// Before any job has been measured: a 70k-char (50-min) script at ~110 chars/s of wall time
const DEFAULT_LONG_CHARS_PER_SECOND = 110;

const longVideoEstimate = deps => job => {
    const chars = String(job.input?.long?.script || '').length;
    return chars / (longCharsPerSecond(deps) || DEFAULT_LONG_CHARS_PER_SECOND) + 15;
};

/**
 * Seconds left in the long-video step, from live rates. Narration and rendering overlap, so the
 * step ends at whichever finishes last: all remaining frames rendered, or the remaining narration
 * plus one part's render after it.
 */
export function longVideoEta({ charsDone, charsTotal, narrationSeconds, framesDone, framesNarrated, renderSeconds, partFrames, estimatedTotalFrames, historyCharsPerSecond }) {
    const narrRate = charsDone > 3000 && narrationSeconds > 5 ? charsDone / narrationSeconds : null;
    const fps = framesDone > 3000 && renderSeconds > 5 ? framesDone / renderSeconds : 230;
    // Total frames: extrapolate from the parts narrated so far once there are some
    const totalFrames = charsDone > 3000 && framesNarrated > 0
        ? (framesNarrated / charsDone) * charsTotal
        : estimatedTotalFrames;
    const narrationLeft = narrRate ? (charsTotal - charsDone) / narrRate : (charsTotal - charsDone) / ((historyCharsPerSecond || DEFAULT_LONG_CHARS_PER_SECOND) * 0.9);
    const renderLeft = Math.max(0, totalFrames - framesDone) / fps;
    const tail = charsDone < charsTotal ? partFrames / fps : 0;
    return Math.max(renderLeft, narrationLeft + tail) + 5;
}

/**
 * Narrate the long script in parts and render each part as soon as its audio exists, while the next
 * part is narrated (TTS is CPU-bound, rendering is bound by the hardware video encoder, so they
 * overlap almost for free). Parts continue the gameplay (backgroundStartFrame) and only the first
 * has the hook card; they are joined losslessly at the end. The promo short renders alongside.
 */
function longVideoStep(deps) {
    return async (job, ctx) => {
        const { settings, channel } = job.data;
        const config = job.data.config.long;
        const jobDir = path.dirname(ctx.workDir);
        const speak = deps.narrate || narrate;
        const common = { preset: config.audio, settings, voiceFallback: channel?.voice_id, signal: ctx.signal };

        // The promo short is voiced alongside the first parts (one GPU serves both) and rendered while
        // the encoder would otherwise wait for part 1's audio. A failure here is not fatal: the
        // narrate_short and render_short steps after this one retry it.
        const shortTask = (async () => {
            if (!job.data.shortNarration) {
                await narrateShort(job, deps, { signal: ctx.signal, workDir: path.join(jobDir, 'narrate_short'), setData: ctx.setData });
            }
            if (job.outputs.shortVideo && fs.existsSync(path.join(deps.publicDir, job.outputs.shortVideo))) return;
            await renderShortVideo(job, deps, {
                signal: ctx.signal, workDir: path.join(jobDir, 'render_short'), setData: ctx.setData, setOutput: ctx.setOutput,
            });
        })().catch(error => console.warn(`[Longform] promo short failed alongside the long video, its own steps will retry: ${error.message}`));

        // Nothing reports progress until the first chunk is voiced: say why on a cold Fish GPU
        if (config.audio?.localEngine === FISH_DRAMA_ENGINE) ctx.progress(0, { message: 'Starting voice GPU (up to ~3 min)' });
        const hook = hookFor(job.input, 'long');
        const tempo = longformTempo();
        const title = await speak(hook, { ...common, tempo, workDir: path.join(ctx.workDir, 'title') });
        const script = String(job.input.long.script).trim();
        const parts = splitTextIntoBatches(script, LONG_PART_CHARS).filter(p => p && p.trim());
        const charsTotal = parts.reduce((n, p) => n + p.length, 0);
        // Clips are picked before the length is known: the pre-audio estimate is on the long side,
        // and the clip list loops anyway
        const backgrounds = job.data.longBackgrounds
            || await getLandscapeBackgroundVideos(estimateAudioSeconds(script) * 1.2 + 30, deps.landscapeLibrary);
        ctx.setData('longBackgrounds', backgrounds);

        const started = Date.now();
        // partsVoiced / partsRendered: finished counts (shown as "voice 4/11 · video 2/11")
        const state = { charsDone: 0, framesDone: 0, framesTotal: 0, fps: 0, eta: null, etaAt: 0, partsVoiced: 0, partsRendered: 0 };
        const render = { running: 0, busySince: 0, busySeconds: 0 };
        const renderSeconds = () => render.busySeconds + (render.running ? (Date.now() - render.busySince) / 1000 : 0);
        const historyCharsPerSecond = longCharsPerSecond(deps);
        const estimatedTotalFrames = estimateLongVideoSeconds(script, config.audio?.ttsProvider || 'local') * FPS;
        // Progress and ETA come from the same model, so the bar and the countdown agree. The ETA is
        // smoothed (it counts down between updates and moves only part of the way to each new
        // estimate) so it doesn't jump with every chunk.
        const report = extra => {
            const now = Date.now();
            const target = longVideoEta({
                charsDone: state.charsDone, charsTotal, narrationSeconds: (now - started) / 1000,
                framesDone: state.framesDone, framesNarrated: state.framesTotal, renderSeconds: renderSeconds(),
                partFrames: (LONG_PART_CHARS / Math.max(1, charsTotal)) * estimatedTotalFrames,
                estimatedTotalFrames, historyCharsPerSecond,
            });
            if (state.eta == null) state.eta = target;
            else {
                const counted = Math.max(0, state.eta - (now - state.etaAt) / 1000);
                state.eta = counted + (target - counted) * 0.15;
            }
            state.etaAt = now;
            const elapsed = (now - started) / 1000;
            ctx.progress(elapsed / (elapsed + state.eta), {
                parts: parts.length, partsVoiced: state.partsVoiced, partsRendered: state.partsRendered,
                charsPerSecond: state.charsDone / Math.max(1, elapsed), fps: state.fps,
                etaSeconds: Math.round(state.eta), etaAt: now, ...extra,
            });
        };
        // Up to PART_RENDERS parts render at once: a ~5-min part has only 3-4 segments, too few to keep
        // the hardware encoder busy on its own
        const renders = [];
        const partFrames = [];
        let running = 0;
        const waiting = [];
        const acquire = () => (running < PART_RENDERS ? (running++, Promise.resolve()) : new Promise(r => waiting.push(r)));
        const release = () => (waiting.length ? waiting.shift()() : running--);
        // Wall time with at least one part rendering, for the measured fps
        const renderStarted = () => { if (render.running++ === 0) render.busySince = Date.now(); };
        const renderEnded = () => { if (--render.running === 0) render.busySeconds += (Date.now() - render.busySince) / 1000; };
        const framesDone = () => partFrames.reduce((sum, f) => sum + (f || 0), 0);
        let renderError = null;
        let startFrame = 0;
        let scriptSeconds = 0;
        const partFiles = [];

        // Narrate up to PART_NARRATIONS parts at once so the TTS workers never idle at a part's last chunk;
        // parts are still consumed in order (each part's gameplay offset needs the earlier parts' lengths)
        const partChars = parts.map(() => 0);
        const narrations = [];
        let nextNarration = 0;
        const startNarration = () => {
            if (nextNarration >= parts.length) return;
            const i = nextNarration++;
            narrations[i] = speak(parts[i], {
                ...common,
                tempo,
                workDir: path.join(ctx.workDir, `part-${String(i).padStart(3, '0')}`),
                leadSec: i > 0 ? PART_GAP_SEC : 0,
                onChunk: c => {
                    partChars[i] = c.charsDone;
                    state.charsDone = partChars.reduce((a, b) => a + b, 0);
                    report();
                },
            }).then(result => { state.partsVoiced++; return result; }).finally(startNarration);
            narrations[i].catch(() => { }); // awaited below, in order
        };
        for (let k = 0; k < PART_NARRATIONS; k++) startNarration();

        for (let i = 0; i < parts.length; i++) {
            if (renderError) break;
            const pad = String(i).padStart(3, '0');
            const body = await narrations[i];
            partChars[i] = parts[i].length;
            state.charsDone = partChars.reduce((a, b) => a + b, 0);
            scriptSeconds += body.durationSec;

            const hookSeconds = i === 0 ? title.durationSec : 0;
            // Same rounding as buildTimeline, so the next part's gameplay starts on the right frame
            const frames = Math.ceil(FPS * (hookSeconds + body.durationSec));
            const spec = renderSpec({
                job, config, title: hook, format: 'landscape', backgrounds,
                narration: { title, script: { text: parts[i], audioPath: body.audioPath, durationSec: body.durationSec, words: body.words } },
                extra: { ...longformLook(config), backgroundStartFrame: startFrame },
            });
            if (i > 0) Object.assign(spec, { hookText: '', audioUrl: null, audioDurationInSeconds: 0 });
            startFrame += frames;
            state.framesTotal += frames;

            const output = path.join(ctx.workDir, `part-${pad}.mp4`);
            partFiles.push(output);
            renders.push((async () => {
                await acquire();
                renderStarted();
                try {
                    if (renderError || fs.existsSync(output)) return;
                    await renderVideo(spec, {
                        outputPath: output, signal: ctx.signal, resumeDir: path.join(ctx.workDir, `render-${pad}`),
                        onProgress: p => {
                            if (p.stage !== 'rendering') return;
                            partFrames[i] = p.framesDone || 0;
                            state.framesDone = framesDone();
                            state.fps = p.fps || state.fps;
                            report();
                        },
                    });
                } finally {
                    partFrames[i] = frames;
                    state.framesDone = framesDone();
                    state.partsRendered++;
                    renderEnded();
                    release();
                }
            })().catch(error => { renderError = renderError || error; }));
        }
        await Promise.all(renders);
        if (renderError) throw renderError;

        const outputPath = path.join(deps.publicDir, 'videos', `${job.id}-long.mp4`);
        await joinParts(partFiles, outputPath, ctx.workDir);
        ctx.setData('longNarration', {
            title: { audioPath: title.audioPath, durationSec: title.durationSec, words: title.words },
            script: { text: script, durationSec: scriptSeconds, parts: parts.length },
        });
        ctx.setOutput('longVideo', `/videos/${path.basename(outputPath)}`);
        recordLongSpeed(deps, { chars: charsTotal, seconds: (Date.now() - started) / 1000, videoSeconds: title.durationSec + scriptSeconds });
        await shortTask;
    };
}

/** @param deps { supabase, dataDir, publicDir, getLocalSettings, getShortBackgrounds(category, seconds), landscapeLibrary, saveVideo, narrate? (override, tests) } */
export function createLongformPipeline(deps) {
    return [
        {
            id: 'prepare',
            label: 'Load presets',
            estimateSeconds: () => 2,
            run: async (job, ctx) => {
                let channel = null;
                if (job.input.channelId && deps.supabase) {
                    const { data } = await deps.supabase.from('channel_profiles').select('*').eq('id', job.input.channelId).eq('user_id', job.userId).maybeSingle();
                    channel = data;
                }
                ctx.setData('channel', channel);
                ctx.setData('settings', await loadSettings(deps, job.userId));
                const config = {
                    short: await loadSideConfig(deps, job.userId, job.input.short || {}, channel),
                    long: await loadSideConfig(deps, job.userId, job.input.long || {}, channel),
                };
                ctx.setData('config', config);
                // Promo short length, picked once so retries keep it (random within the preset's range if it has one)
                ctx.setData('shortTargetSeconds', selectTargetDuration(config.short.audio));
                if ([config.short, config.long].some(c => c.audio?.localEngine === FISH_DRAMA_ENGINE)) wakeFishDrama();
            },
        },
        { id: 'long_video', label: 'Voice + render long video (16:9), promo short alongside', estimateSeconds: longVideoEstimate(deps), run: longVideoStep(deps) },
        {
            id: 'narrate_short',
            label: 'Voice: promo short',
            // Usually already voiced alongside the long video; this only runs if that failed
            estimateSeconds: job => (job.data?.shortNarration ? 1 : narrationEstimate('short')(job)),
            run: async (job, ctx) => {
                if (job.data.shortNarration) return;
                await narrateShort(job, deps, { signal: ctx.signal, workDir: ctx.workDir, setData: ctx.setData, onProgress: ctx.progress });
            },
        },
        {
            id: 'render_short',
            label: 'Render promo short (9:16)',
            // Usually already rendered alongside the long video; this only runs if that failed
            estimateSeconds: job => (job.outputs?.shortVideo ? 1 : renderEstimate('short', 'portrait')(job)),
            run: async (job, ctx) => {
                if (job.outputs.shortVideo && fs.existsSync(path.join(deps.publicDir, job.outputs.shortVideo))) return;
                await renderShortVideo(job, deps, {
                    signal: ctx.signal, workDir: ctx.workDir, onProgress: renderProgress(ctx), setData: ctx.setData, setOutput: ctx.setOutput,
                });
            },
        },
        {
            id: 'thumbnail',
            label: 'Thumbnail',
            estimateSeconds: () => 3,
            run: async (job, ctx) => {
                const { channel, config } = job.data;
                const outputPath = path.join(deps.publicDir, 'images', 'thumbnails', `${job.id}-longform.png`);
                await renderThumbnail({
                    title: hookFor(job.input, 'long'), channelName: channel?.name || '', channelImage: channel?.image_url || null,
                    outputPath, // font: Inter ExtraBold, the competitor's thumbnail face
                });
                ctx.setOutput('thumbnail', `/images/thumbnails/${path.basename(outputPath)}`);
            },
        },
        {
            id: 'save',
            label: 'Save to library',
            estimateSeconds: () => 2,
            run: async (job, ctx) => {
                const { outputs } = job;
                // stable ids across retries so a re-run upserts instead of duplicating
                const ids = job.data.videoIds || { long: crypto.randomUUID(), short: crypto.randomUUID() };
                ctx.setData('videoIds', ids);
                const base = { user_id: job.userId, profile_id: job.input.channelId || null, status: 'completed', created_at: new Date().toISOString() };
                const hooks = { long: hookFor(job.input, 'long'), short: hookFor(job.input, 'short') };
                await deps.saveVideo?.({ ...base, id: ids.long, title: hooks.long, hook_text: hooks.long, script_text: job.input.long.script, video_url: outputs.longVideo, thumbnail_url: outputs.thumbnail, duration: job.data.longNarration.title.durationSec + job.data.longNarration.script.durationSec });
                await deps.saveVideo?.({ ...base, id: ids.short, title: hooks.short, hook_text: hooks.short, script_text: job.input.short.script, video_url: outputs.shortVideo, thumbnail_url: null, duration: job.data.shortNarration.title.durationSec + job.data.shortNarration.script.durationSec });
            },
        },
    ];
}
