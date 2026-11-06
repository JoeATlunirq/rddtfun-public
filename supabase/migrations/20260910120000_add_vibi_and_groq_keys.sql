-- Adds two cheaper providers alongside the existing ones.
--
--   Vibi (api.vibi.pro) — TTS alternative to ElevenLabs
--   Groq Whisper       — word-level caption timings, replacing ElevenLabs
--                        scribe_v1 which bills per minute of audio
--
-- Everything here is additive and optional. With no keys set the app falls
-- back to ElevenLabs exactly as before, so this is safe on a live database.

-- 1. Per-user API keys
alter table public.user_settings
add column if not exists vibi_api_key text,
add column if not exists groq_api_key text;

-- 2. Allow 'vibi' as a TTS provider on presets
alter table public.presets
drop constraint if exists presets_tts_provider_check;

alter table public.presets
add constraint presets_tts_provider_check
check (tts_provider is null or tts_provider in ('elevenlabs', 'fish', 'vibi'));

-- 3. Vibi voice/model selection, mirroring the fish_audio_* columns
alter table public.presets
add column if not exists vibi_voice_id text,
add column if not exists vibi_voice_name text,
add column if not exists vibi_model_id text;
