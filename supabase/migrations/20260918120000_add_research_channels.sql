create table public.youtube_channels (
  channel_id text primary key,
  handle text,
  title text not null,
  thumbnail_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index youtube_channels_handle_idx
on public.youtube_channels (lower(handle))
where handle is not null;

create table public.research_groups (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null check (char_length(trim(name)) between 1 and 80),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, user_id)
);

create unique index research_groups_user_name_idx
on public.research_groups (user_id, lower(name));

create table public.research_group_channels (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  group_id uuid not null,
  channel_id text not null references public.youtube_channels(channel_id) on delete cascade,
  created_at timestamptz not null default now(),
  foreign key (group_id, user_id) references public.research_groups(id, user_id) on delete cascade,
  unique (group_id, channel_id)
);

create index research_groups_user_id_idx on public.research_groups(user_id);
create index research_group_channels_user_id_idx on public.research_group_channels(user_id);
create index research_group_channels_group_id_idx on public.research_group_channels(group_id);

create trigger youtube_channels_set_updated_at
before update on public.youtube_channels
for each row execute function public.set_updated_at();

create trigger research_groups_set_updated_at
before update on public.research_groups
for each row execute function public.set_updated_at();

alter table public.youtube_channels enable row level security;
alter table public.research_groups enable row level security;
alter table public.research_group_channels enable row level security;

create policy "Authenticated users can read YouTube channels"
on public.youtube_channels for select to authenticated
using (true);

create policy "Users can manage their research groups"
on public.research_groups for all to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

create policy "Users can manage their research group channels"
on public.research_group_channels for all to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);
