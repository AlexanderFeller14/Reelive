-- Nutzerprofile (1:1 zu auth.users, wird im Onboarding vom Client angelegt)
create table public.profiles (
  id           uuid primary key references auth.users (id) on delete cascade,
  username     text unique not null check (username ~ '^[a-z0-9_]{3,20}$'),
  display_name text not null check (char_length(display_name) between 1 and 40),
  avatar_key   text,
  created_at   timestamptz not null default now()
);

create type public.trip_status as enum ('active', 'revealed', 'archived');

-- Reiseprojekte. status wechselt NUR via Edge Function (Service-Role, Phase 5).
create table public.trips (
  id          uuid primary key default gen_random_uuid(),
  name        text not null check (char_length(name) between 1 and 80),
  cover_key   text,
  start_date  date not null,
  end_date    date not null,
  status      public.trip_status not null default 'active',
  revealed_at timestamptz,
  invite_code text unique not null default encode(gen_random_bytes(6), 'hex'),
  owner_id    uuid not null references public.profiles (id),
  plan        text not null default 'free',
  created_at  timestamptz not null default now(),
  check (end_date >= start_date),
  check ((status = 'active') = (revealed_at is null))
);

create table public.trip_members (
  trip_id   uuid not null references public.trips (id) on delete cascade,
  user_id   uuid not null references public.profiles (id) on delete cascade,
  role      text not null default 'member' check (role in ('owner', 'member')),
  joined_at timestamptz not null default now(),
  primary key (trip_id, user_id)
);

create index trip_members_user_idx on public.trip_members (user_id);
