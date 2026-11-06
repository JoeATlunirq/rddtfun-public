-- Fish Audio TTS Provider Support Migration
-- Adds columns for Fish Audio API key and TTS provider settings

-- Add fish_audio_api_key to user_settings table
ALTER TABLE user_settings 
ADD COLUMN IF NOT EXISTS fish_audio_api_key TEXT;

-- Add TTS provider columns to presets table (for audio presets)
ALTER TABLE presets 
ADD COLUMN IF NOT EXISTS tts_provider TEXT DEFAULT 'elevenlabs',
ADD COLUMN IF NOT EXISTS fish_audio_model_id TEXT,
ADD COLUMN IF NOT EXISTS fish_audio_model_name TEXT;

-- Add comment for documentation
COMMENT ON COLUMN user_settings.fish_audio_api_key IS 'Fish Audio API key for TTS';
COMMENT ON COLUMN presets.tts_provider IS 'TTS provider: elevenlabs or fish';
COMMENT ON COLUMN presets.fish_audio_model_id IS 'Fish Audio model/voice ID';
COMMENT ON COLUMN presets.fish_audio_model_name IS 'Fish Audio model/voice display name';
