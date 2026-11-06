ALTER TABLE channel_profiles
ADD COLUMN visual_filter_preset_id TEXT REFERENCES presets(id);
