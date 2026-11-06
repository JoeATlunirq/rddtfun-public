import fs from 'fs';
import path from 'path';

/**
 * Groq speech-to-text — drop-in replacement for ElevenLabs `scribe_v1`.
 *
 * Groq exposes Whisper behind an OpenAI-compatible endpoint and returns
 * word-level timestamps, which is the only thing this pipeline needs STT for.
 * ElevenLabs charges per minute of audio for the same job; Groq's free tier
 * covers it.
 *
 * Returns the ElevenLabs response shape so processTranscriptionResponse()
 * upstream needs no changes:
 *     { text, words: [{ text, start, end }] }
 *
 * Env-gated: with no key configured this module is inert and the caller falls
 * back to ElevenLabs, so existing deployments behave identically.
 */

const GROQ_URL = 'https://api.groq.com/openai/v1/audio/transcriptions';
const DEFAULT_MODEL = process.env.GROQ_STT_MODEL || 'whisper-large-v3-turbo';

// Groq rejects uploads above 25MB on the free tier.
const MAX_BYTES = 25 * 1024 * 1024;

export function getGroqApiKey(userKey) {
    return userKey || process.env.GROQ_API_KEY || null;
}

export function isGroqConfigured(userKey) {
    return Boolean(getGroqApiKey(userKey));
}

/**
 * @param {string} audioPath  local path to the audio file
 * @param {string} [userKey]  per-user key from user_settings; falls back to env
 * @returns {Promise<{text: string, words: Array<{text: string, start: number, end: number}>}>}
 */
export async function transcribeWithGroq(audioPath, userKey) {
    const apiKey = getGroqApiKey(userKey);
    if (!apiKey) throw new Error('Groq API key is not configured');

    if (!fs.existsSync(audioPath)) {
        throw new Error(`Audio file not found: ${audioPath}`);
    }

    const { size } = fs.statSync(audioPath);
    if (size === 0) throw new Error('Audio file is empty');
    if (size > MAX_BYTES) {
        throw new Error(`Audio is ${(size / 1048576).toFixed(1)}MB, over Groq's 25MB limit`);
    }

    const form = new FormData();
    const buf = fs.readFileSync(audioPath);
    const ext = path.extname(audioPath).toLowerCase();
    const mime = ext === '.wav' ? 'audio/wav'
        : ext === '.m4a' ? 'audio/mp4'
            : ext === '.flac' ? 'audio/flac'
                : 'audio/mpeg';

    form.append('file', new Blob([buf], { type: mime }), path.basename(audioPath));
    form.append('model', DEFAULT_MODEL);
    form.append('response_format', 'verbose_json');
    form.append('timestamp_granularities[]', 'word');

    console.log(`[Groq] Transcribing ${path.basename(audioPath)} (${(size / 1048576).toFixed(2)}MB) with ${DEFAULT_MODEL}`);

    const res = await fetch(GROQ_URL, {
        method: 'POST',
        headers: { Authorization: `Bearer ${apiKey}` },
        body: form,
    });

    if (!res.ok) {
        const detail = await res.text().catch(() => '');
        throw new Error(`Groq STT ${res.status}: ${detail.slice(0, 300)}`);
    }

    const data = await res.json();

    if (!Array.isArray(data.words) || data.words.length === 0) {
        throw new Error('Groq returned no word timestamps');
    }

    // Groq/Whisper uses `word`; ElevenLabs uses `text`. Normalise to `text`.
    const words = data.words
        .map(w => ({
            text: w.word ?? w.text ?? '',
            start: Number(w.start),
            end: Number(w.end),
        }))
        .filter(w => w.text.trim() !== '' && Number.isFinite(w.start) && Number.isFinite(w.end));

    if (words.length === 0) throw new Error('Groq word list was empty after normalisation');

    console.log(`[Groq] ${words.length} words, ${words[words.length - 1].end.toFixed(1)}s`);

    return { text: data.text || words.map(w => w.text).join(' '), words };
}
