/**
 * Vibi TTS provider (https://api.vibi.pro)
 *
 * Third TTS option alongside ElevenLabs and Fish Audio. Returns an audio Buffer
 * exactly like generateAudio()/generateFishAudio(), so callers are unchanged.
 *
 * Unlike ElevenLabs, Vibi is asynchronous:
 *     POST /v1/text-to-speech/{voice_id}  -> 202 { id, status: 'pending' }
 *     GET  /v1/history/{id}               -> poll until status 'completed'
 *     GET  result.audio_url               -> mp3 bytes
 *
 * Auth uses the same `xi-api-key` header as ElevenLabs.
 * Inert unless a key is supplied, so existing deployments are unaffected.
 */

const BASE_URL = process.env.VIBI_API_URL || 'https://api.vibi.pro';
const DEFAULT_PROVIDER = process.env.VIBI_PROVIDER || 'minimax';
const DEFAULT_MODEL = process.env.VIBI_MODEL_ID || 'speech-2.8-turbo';

const POLL_INTERVAL_MS = 2000;
const POLL_TIMEOUT_MS = 5 * 60 * 1000;

// speech-2.8-turbo accepts 10k; hd accepts 5k. Stay under the smaller one.
export const VIBI_MAX_CHARS = Number(process.env.VIBI_MAX_CHARS) || 5000;

export function getVibiApiKey(userKey) {
    return userKey || process.env.VIBI_API_KEY || null;
}

export function isVibiConfigured(userKey) {
    return Boolean(getVibiApiKey(userKey));
}

function headers(apiKey) {
    return { 'xi-api-key': apiKey, 'Content-Type': 'application/json' };
}

async function vibiGet(path, apiKey) {
    const res = await fetch(`${BASE_URL}${path}`, { headers: headers(apiKey) });
    if (!res.ok) {
        const body = await res.text().catch(() => '');
        throw new Error(`Vibi GET ${path} -> ${res.status}: ${body.slice(0, 200)}`);
    }
    return res.json();
}

/** Remaining credit balance, or null if the call fails. */
export async function getVibiBalance(userKey) {
    const apiKey = getVibiApiKey(userKey);
    if (!apiKey) return null;
    try {
        const me = await vibiGet('/v1/auth/me', apiKey);
        return me?.credit_balance ?? null;
    } catch (err) {
        console.error('[Vibi] balance check failed:', err.message);
        return null;
    }
}

/** Available models for a provider. */
export async function listVibiModels(userKey, provider = DEFAULT_PROVIDER) {
    const apiKey = getVibiApiKey(userKey);
    if (!apiKey) throw new Error('Vibi API key is not configured');
    return vibiGet(`/v1/models?provider=${encodeURIComponent(provider)}`, apiKey);
}

/**
 * Voices available for selection: the user's own clones first, then system voices.
 * Normalised to { voice_id, name, kind } so the UI has one shape to render.
 */
export async function listVibiVoices(userKey) {
    const apiKey = getVibiApiKey(userKey);
    if (!apiKey) throw new Error('Vibi API key is not configured');

    const normalise = (list, kind) =>
        (Array.isArray(list) ? list : list?.voices || list?.items || list?.data || [])
            .map(v => ({
                voice_id: v.voice_id || v.id,
                name: v.name || v.voice_name || v.display_name || 'Unnamed',
                kind,
                status: v.status ?? null,
            }))
            .filter(v => v.voice_id);

    const [cloned, system] = await Promise.allSettled([
        vibiGet('/v1/minimax/voices', apiKey),
        vibiGet('/v1/minimax/system-voices', apiKey),
    ]);

    const voices = [];
    if (cloned.status === 'fulfilled') {
        // Clones that are still processing or failed cannot be used yet.
        voices.push(...normalise(cloned.value, 'cloned').filter(v => !v.status || v.status === 'done'));
    } else {
        console.error('[Vibi] cloned voices failed:', cloned.reason?.message);
    }
    if (system.status === 'fulfilled') {
        voices.push(...normalise(system.value, 'system'));
    } else {
        console.error('[Vibi] system voices failed:', system.reason?.message);
    }

    console.log(`[Vibi] ${voices.length} voices available`);
    return voices;
}

/**
 * Generate speech and return the mp3 as a Buffer.
 *
 * @param {string} text
 * @param {string} apiKey        user's Vibi key (falls back to env)
 * @param {string} voiceId       Vibi voice id (uuid)
 * @param {string} [modelId]     defaults to speech-2.8-turbo
 * @param {object} [opts]        { provider, languageCode, speed, pitch, vol }
 * @returns {Promise<Buffer>}
 */
export async function generateVibiAudio(text, apiKey, voiceId, modelId, opts = {}) {
    const key = getVibiApiKey(apiKey);
    if (!key) throw new Error('Vibi API key is required');
    if (!voiceId) throw new Error('Vibi voice ID is required');
    if (!text || !text.trim()) throw new Error('Vibi received empty text');

    if (text.length > VIBI_MAX_CHARS) {
        throw new Error(`Text is ${text.length} chars, over the Vibi limit of ${VIBI_MAX_CHARS}`);
    }

    const payload = {
        text,
        provider: opts.provider || DEFAULT_PROVIDER,
        model_id: modelId || DEFAULT_MODEL,
        language_code: opts.languageCode || 'English',
        voice_settings: {
            speed: opts.speed ?? 1,
            pitch: opts.pitch ?? 0,
            vol: opts.vol ?? 1,
        },
        export_transcript: false,
    };

    console.log(`[Vibi] Submitting ${text.length} chars, voice ${voiceId}, model ${payload.model_id}`);

    const submitRes = await fetch(`${BASE_URL}/v1/text-to-speech/${encodeURIComponent(voiceId)}`, {
        method: 'POST',
        headers: headers(key),
        body: JSON.stringify(payload),
    });

    if (!submitRes.ok) {
        const body = await submitRes.text().catch(() => '');
        throw new Error(`Vibi submit ${submitRes.status}: ${body.slice(0, 300)}`);
    }

    const submitted = await submitRes.json();
    const taskId = submitted?.id;
    if (!taskId) throw new Error('Vibi did not return a task id');

    console.log(`[Vibi] Task ${taskId} accepted, polling...`);

    const started = Date.now();
    let task;

    while (Date.now() - started < POLL_TIMEOUT_MS) {
        await new Promise(r => setTimeout(r, POLL_INTERVAL_MS));
        task = await vibiGet(`/v1/history/${taskId}`, key);

        if (task.status === 'completed') break;
        if (task.status === 'failed') {
            throw new Error(`Vibi task failed: ${task.error || task.detail_error || 'unknown error'}`);
        }
    }

    if (!task || task.status !== 'completed') {
        throw new Error(`Vibi task ${taskId} did not complete within ${POLL_TIMEOUT_MS / 1000}s`);
    }

    const audioUrl = task?.result?.audio_url || task?.audio_url;
    if (!audioUrl) throw new Error('Vibi completed but returned no audio_url');

    const audioRes = await fetch(audioUrl);
    if (!audioRes.ok) throw new Error(`Vibi audio download failed: ${audioRes.status}`);

    const buffer = Buffer.from(await audioRes.arrayBuffer());

    const secs = ((Date.now() - started) / 1000).toFixed(1);
    console.log(`[Vibi] Done in ${secs}s — ${(buffer.length / 1024).toFixed(0)}KB, ${task.credits_deducted ?? '?'} credits for ${task.characters_used ?? text.length} chars`);

    return buffer;
}
