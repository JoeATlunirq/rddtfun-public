-- Adds a local TTS provider: VoiceStudio running on this machine (or another
-- one on the LAN), with voice cloning, via its OpenAI-compatible API.
--
-- Everything here is additive and optional. With no local URL set the app
-- uses http://localhost:3900, and presets that don't pick 'local' are
-- unaffected.

-- 1. Per-user VoiceStudio endpoint and optional bearer key
alter table public.user_settings
add column if not exists local_tts_url text,
add column if not exists local_tts_api_key text;

-- 2. Allow 'vibi' and 'local' as TTS providers on presets
alter table public.presets
drop constraint if exists presets_tts_provider_check;

alter table public.presets
add constraint presets_tts_provider_check
check (tts_provider is null or tts_provider in ('elevenlabs', 'fish', 'vibi', 'local'));

-- 3. VoiceStudio voice profile (the clone) and engine, mirroring the vibi_* columns
alter table public.presets
add column if not exists local_voice_id text,
add column if not exists local_voice_name text,
add column if not exists local_engine text;
