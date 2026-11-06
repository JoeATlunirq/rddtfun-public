create extension if not exists pgcrypto;

create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create table public.signup_codes (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  max_uses integer not null default 1 check (max_uses > 0),
  current_uses integer not null default 0 check (current_uses >= 0 and current_uses <= max_uses),
  expires_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.user_settings (
  user_id uuid primary key references auth.users(id) on delete cascade,
  elevenlabs_api_key text,
  fish_audio_api_key text,
  trendy_bot_api_key text,
  telegram_user_id text,
  openai_api_key text,
  claude_api_key text,
  youtube_api_key_1 text,
  youtube_api_key_2 text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.presets (
  id text primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  type text not null check (type in ('audio', 'caption_style', 'hook_style', 'visual_filter')),
  name text not null,
  voice_id text,
  voice_name text,
  voice_gender text check (voice_gender is null or voice_gender in ('male', 'female')),
  threshold_db double precision,
  min_duration double precision,
  target_duration double precision,
  left_padding double precision,
  right_padding double precision,
  add_background_music boolean not null default false,
  music_volume_db double precision,
  custom_music_url text,
  hook text,
  script text,
  caption_style jsonb,
  hook_style jsonb,
  tts_provider text default 'elevenlabs' check (tts_provider is null or tts_provider in ('elevenlabs', 'fish')),
  fish_audio_model_id text,
  fish_audio_model_name text,
  visual_filter text default 'none' check (visual_filter is null or visual_filter in ('none', 'vibrant', 'dark', 'warm', 'cool')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, name, type)
);

create table public.channel_profiles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  nickname text,
  image_url text,
  font text not null default 'Roboto',
  font_url text,
  style text not null default 'single' check (style in ('single', 'grouped', 'uppercase')),
  background_video_type text not null default 'cooking',
  hook_animation_type text not null default 'fall' check (hook_animation_type in ('fall', 'float')),
  subtitle_size integer not null default 64 check (subtitle_size > 0),
  stroke_size integer not null default 8 check (stroke_size >= 0),
  voice_id text,
  has_background_music boolean not null default false,
  background_music_volume double precision not null default 0.015,
  pitch_up boolean not null default false,
  audio_speed double precision not null default 1,
  platform text,
  language text,
  caption_preset_id text references public.presets(id) on delete set null,
  male_voice_preset_id text references public.presets(id) on delete set null,
  female_voice_preset_id text references public.presets(id) on delete set null,
  hook_style_preset_id text references public.presets(id) on delete set null,
  visual_filter_preset_id text references public.presets(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, name)
);

create table public.videos (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  profile_id uuid references public.channel_profiles(id) on delete set null,
  title text not null,
  hook_text text,
  script_text text,
  thumbnail_url text,
  video_url text not null,
  duration double precision not null default 0 check (duration >= 0),
  status text not null default 'completed',
  channel_name text,
  views bigint not null default 0 check (views >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index presets_user_id_idx on public.presets(user_id);
create index presets_user_type_idx on public.presets(user_id, type);
create index channel_profiles_user_id_idx on public.channel_profiles(user_id);
create index videos_user_created_at_idx on public.videos(user_id, created_at desc);
create index signup_codes_code_idx on public.signup_codes(code);

create trigger signup_codes_set_updated_at
before update on public.signup_codes
for each row execute function public.set_updated_at();

create trigger user_settings_set_updated_at
before update on public.user_settings
for each row execute function public.set_updated_at();

create trigger presets_set_updated_at
before update on public.presets
for each row execute function public.set_updated_at();

create trigger channel_profiles_set_updated_at
before update on public.channel_profiles
for each row execute function public.set_updated_at();

create trigger videos_set_updated_at
before update on public.videos
for each row execute function public.set_updated_at();

alter table public.signup_codes enable row level security;
alter table public.user_settings enable row level security;
alter table public.presets enable row level security;
alter table public.channel_profiles enable row level security;
alter table public.videos enable row level security;

create policy "Users can read their settings"
on public.user_settings for select to authenticated
using ((select auth.uid()) = user_id);

create policy "Users can update their settings"
on public.user_settings for update to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

create policy "Users can insert their settings"
on public.user_settings for insert to authenticated
with check ((select auth.uid()) = user_id);

create policy "Users can manage their presets"
on public.presets for all to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

create policy "Users can manage their channel profiles"
on public.channel_profiles for all to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

create policy "Users can manage their videos"
on public.videos for all to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

create or replace function public.consume_signup_code(invite_code text)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  claimed_id uuid;
begin
  update public.signup_codes
  set current_uses = current_uses + 1
  where code = invite_code
    and current_uses < max_uses
    and (expires_at is null or expires_at > now())
  returning id into claimed_id;

  return claimed_id is not null;
end;
$$;

revoke all on function public.consume_signup_code(text) from public, anon, authenticated;
grant execute on function public.consume_signup_code(text) to service_role;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  ('profile-images', 'profile-images', true, 10485760, array['image/jpeg', 'image/png', 'image/webp']),
  ('background-music', 'background-music', true, 52428800, array['audio/mpeg', 'audio/wav', 'audio/x-wav', 'audio/mp4'])
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

create policy "Public profile images are readable"
on storage.objects for select to public
using (bucket_id = 'profile-images');

create policy "Public background music is readable"
on storage.objects for select to public
using (bucket_id = 'background-music');

create policy "Users can upload profile images"
on storage.objects for insert to authenticated
with check (
  bucket_id = 'profile-images'
  and (storage.foldername(name))[1] = (select auth.uid())::text
);

create policy "Users can manage their profile images"
on storage.objects for update to authenticated
using (
  bucket_id = 'profile-images'
  and (storage.foldername(name))[1] = (select auth.uid())::text
)
with check (
  bucket_id = 'profile-images'
  and (storage.foldername(name))[1] = (select auth.uid())::text
);

create policy "Users can delete their profile images"
on storage.objects for delete to authenticated
using (
  bucket_id = 'profile-images'
  and (storage.foldername(name))[1] = (select auth.uid())::text
);

create policy "Users can upload background music"
on storage.objects for insert to authenticated
with check (
  bucket_id = 'background-music'
  and (storage.foldername(name))[1] = (select auth.uid())::text
);

create policy "Users can manage their background music"
on storage.objects for update to authenticated
using (
  bucket_id = 'background-music'
  and (storage.foldername(name))[1] = (select auth.uid())::text
)
with check (
  bucket_id = 'background-music'
  and (storage.foldername(name))[1] = (select auth.uid())::text
);

create policy "Users can delete their background music"
on storage.objects for delete to authenticated
using (
  bucket_id = 'background-music'
  and (storage.foldername(name))[1] = (select auth.uid())::text
);
