-- Per-user channel list for the Aura rank page (/aura).
--
-- Each element is { channelId, handle, title, thumbnailUrl }, resolved through
-- ViewStats when the user adds a handle in Settings → Aura.
--
-- Additive and safe on a live database. Until this runs, the backend keeps the
-- list in backend/data/aura_settings.json instead.

alter table public.user_settings
add column if not exists aura_handles jsonb not null default '[]'::jsonb;
