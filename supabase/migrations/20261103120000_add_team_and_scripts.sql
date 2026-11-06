-- Team members (Settings → Team) and the Script board (/scripts).
--
-- A workspace is one account owner's data (owner_id = that user's auth id). The owner
-- invites people by email with a role; the invite is claimed through a one-time link.
-- Roles: editor (everything but the team), scriptwriter (adds scripts, edits their own
-- until they reach "To Post"), viewer (read only). The owner role is implicit.
--
-- The backend reaches these tables with the service key and enforces roles itself, so
-- RLS only lets owners touch their own rows directly. Additive and safe on a live
-- database; until it runs, the backend keeps everything in backend/data/team_scripts.json.

create table public.team_members (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  owner_email text,
  user_id uuid references auth.users(id) on delete cascade,
  email text not null check (char_length(email) between 3 and 320),
  role text not null check (role in ('editor', 'scriptwriter', 'viewer')),
  invite_token text unique,
  accepted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index team_members_owner_email_idx on public.team_members (owner_id, lower(email));
create index team_members_user_id_idx on public.team_members (user_id);

create table public.script_boards (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  name text not null check (char_length(trim(name)) between 1 and 80),
  channel_profile_id uuid references public.channel_profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index script_boards_owner_id_idx on public.script_boards (owner_id);

create table public.scripts (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  board_id uuid not null references public.script_boards(id) on delete cascade,
  number integer not null,
  title text not null default '',
  status text not null default 'scripting'
    check (status in ('scripting', 'to_edit', 'to_post', 'posted')),
  format text not null default 'short' check (format in ('short', 'long')),
  hook text not null default '',
  body text not null default '',
  tags text[] not null default '{}',
  edited_video_url text,
  source_video_url text,
  post_date date,
  goal text,
  performance text check (performance in ('flop', 'average', 'good', 'viral')),
  author_id uuid references auth.users(id) on delete set null,
  author_email text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index scripts_board_id_idx on public.scripts (board_id);
create index scripts_owner_id_idx on public.scripts (owner_id);

create table public.script_comments (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  script_id uuid not null references public.scripts(id) on delete cascade,
  author_id uuid references auth.users(id) on delete set null,
  author_email text,
  body text not null check (char_length(trim(body)) between 1 and 4000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index script_comments_script_id_idx on public.script_comments (script_id);

create trigger team_members_set_updated_at
before update on public.team_members
for each row execute function public.set_updated_at();

create trigger script_boards_set_updated_at
before update on public.script_boards
for each row execute function public.set_updated_at();

create trigger scripts_set_updated_at
before update on public.scripts
for each row execute function public.set_updated_at();

create trigger script_comments_set_updated_at
before update on public.script_comments
for each row execute function public.set_updated_at();

alter table public.team_members enable row level security;
alter table public.script_boards enable row level security;
alter table public.scripts enable row level security;
alter table public.script_comments enable row level security;

create policy "Owners can manage their team"
on public.team_members for all to authenticated
using ((select auth.uid()) = owner_id)
with check ((select auth.uid()) = owner_id);

create policy "Owners can manage their script boards"
on public.script_boards for all to authenticated
using ((select auth.uid()) = owner_id)
with check ((select auth.uid()) = owner_id);

create policy "Owners can manage their scripts"
on public.scripts for all to authenticated
using ((select auth.uid()) = owner_id)
with check ((select auth.uid()) = owner_id);

create policy "Owners can manage their script comments"
on public.script_comments for all to authenticated
using ((select auth.uid()) = owner_id)
with check ((select auth.uid()) = owner_id);
