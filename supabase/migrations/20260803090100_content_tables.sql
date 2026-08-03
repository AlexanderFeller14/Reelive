create type public.post_type as enum ('photo', 'video');
create type public.upload_status as enum ('pending', 'uploaded');

-- Ein eingesendeter Moment. Chronologie IMMER über captured_at (Gerätezeit).
create table public.posts (
  id            uuid primary key default gen_random_uuid(),
  trip_id       uuid not null references public.trips (id) on delete cascade,
  author_id     uuid not null references public.profiles (id) on delete cascade,
  type          public.post_type not null,
  storage_key   text not null,
  thumb_key     text,
  duration_s    numeric check (duration_s is null or duration_s between 0 and 30),
  caption       text check (caption is null or char_length(caption) <= 120),
  captured_at   timestamptz not null,
  captured_tz   text not null,
  lat           double precision check (lat is null or lat between -90 and 90),
  lng           double precision check (lng is null or lng between -180 and 180),
  place_name    text,
  upload_status public.upload_status not null default 'pending',
  created_at    timestamptz not null default now()
);

create index posts_trip_captured_idx on public.posts (trip_id, captured_at);

create table public.reactions (
  post_id    uuid not null references public.posts (id) on delete cascade,
  user_id    uuid not null references public.profiles (id) on delete cascade,
  emoji      text not null check (char_length(emoji) <= 16),
  created_at timestamptz not null default now(),
  primary key (post_id, user_id, emoji)
);

create table public.comments (
  id         uuid primary key default gen_random_uuid(),
  post_id    uuid not null references public.posts (id) on delete cascade,
  user_id    uuid not null references public.profiles (id) on delete cascade,
  text       text not null check (char_length(text) between 1 and 500),
  created_at timestamptz not null default now()
);

-- Öffentliche Recap-Links (Auflösung nur via Edge Function, Phase 6)
create table public.share_links (
  token      text primary key default encode(gen_random_bytes(16), 'hex'),
  trip_id    uuid not null references public.trips (id) on delete cascade,
  expires_at timestamptz,
  revoked    boolean not null default false,
  created_at timestamptz not null default now()
);

-- Moderations-Pflicht für den Store
create table public.reports (
  id          uuid primary key default gen_random_uuid(),
  post_id     uuid not null references public.posts (id) on delete cascade,
  reporter_id uuid not null references public.profiles (id) on delete cascade,
  reason      text not null check (char_length(reason) between 1 and 500),
  created_at  timestamptz not null default now()
);
