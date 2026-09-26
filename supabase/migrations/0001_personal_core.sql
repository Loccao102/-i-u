-- ĐiĐâu Supabase baseline
-- Personal-first, anonymous profile boundary stays in the Next.js server.
-- Run this in Supabase SQL Editor or with the Supabase CLI.

create schema if not exists extensions;
create extension if not exists postgis with schema extensions;

create table if not exists public.personal_places (
  owner_key text not null,
  id text not null,
  name text not null check (char_length(name) between 1 and 100),
  kind text not null,
  description text not null default '',
  latitude double precision not null check (latitude between -90 and 90),
  longitude double precision not null check (longitude between -180 and 180),
  location extensions.geography(point, 4326)
    generated always as (
      extensions.st_point(longitude, latitude)::extensions.geography
    ) stored,
  distance_km double precision not null default 0 check (distance_km >= 0),
  price_label text not null default '$$' check (price_label in ('$', '$$', '$$$')),
  average_for_two text not null default 'Chưa có dữ liệu',
  public_rating double precision not null default 0 check (public_rating between 0 and 5),
  match_score integer not null default 80 check (match_score between 0 and 100),
  community_note text not null default '',
  open_until text not null default 'Chưa rõ',
  best_time text not null default 'Chưa có dữ liệu',
  noise text not null default 'Vừa' check (noise in ('Yên', 'Vừa', 'Sôi động')),
  crowd text not null default 'Vừa' check (crowd in ('Vắng', 'Vừa', 'Đông')),
  tags text[] not null default '{}',
  scenarios text[] not null default '{}',
  note text not null default '',
  accent text not null default '#ff6b5e',
  source text not null default 'PERSONAL' check (source in ('PERSONAL', 'PROVIDER')),
  provider_id text,
  address text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (owner_key, id)
);

create index if not exists personal_places_owner_updated_idx
  on public.personal_places (owner_key, updated_at desc);

create index if not exists personal_places_location_gist_idx
  on public.personal_places using gist (location);

create table if not exists public.saved_places (
  owner_key text not null,
  place_id text not null,
  created_at timestamptz not null default now(),
  primary key (owner_key, place_id)
);

create table if not exists public.personal_ratings (
  owner_key text not null,
  place_id text not null,
  stars integer not null check (stars between 1 and 5),
  revisit text not null check (revisit in ('yes', 'maybe', 'no')),
  contexts text[] not null default '{}',
  note text not null default '',
  visited_at timestamptz not null,
  updated_at timestamptz not null default now(),
  primary key (owner_key, place_id)
);

create table if not exists public.visits (
  owner_key text not null,
  id uuid not null,
  place_id text not null,
  visited_at timestamptz not null default now(),
  rating_stars integer check (rating_stars between 1 and 5),
  created_at timestamptz not null default now(),
  primary key (owner_key, id)
);

create index if not exists visits_owner_date_idx
  on public.visits (owner_key, visited_at desc);

create table if not exists public.collections (
  owner_key text not null,
  id uuid not null,
  name text not null check (char_length(name) between 1 and 60),
  description text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (owner_key, id)
);

create table if not exists public.collection_places (
  owner_key text not null,
  collection_id uuid not null,
  place_id text not null,
  created_at timestamptz not null default now(),
  primary key (owner_key, collection_id, place_id),
  foreign key (owner_key, collection_id)
    references public.collections (owner_key, id)
    on delete cascade
);

create index if not exists collection_places_owner_place_idx
  on public.collection_places (owner_key, place_id);

-- Data API should not expose anonymous personal data.
alter table public.personal_places enable row level security;
alter table public.saved_places enable row level security;
alter table public.personal_ratings enable row level security;
alter table public.visits enable row level security;
alter table public.collections enable row level security;
alter table public.collection_places enable row level security;

revoke all on table public.personal_places from anon, authenticated;
revoke all on table public.saved_places from anon, authenticated;
revoke all on table public.personal_ratings from anon, authenticated;
revoke all on table public.visits from anon, authenticated;
revoke all on table public.collections from anon, authenticated;
revoke all on table public.collection_places from anon, authenticated;

grant all on table public.personal_places to service_role;
grant all on table public.saved_places to service_role;
grant all on table public.personal_ratings to service_role;
grant all on table public.visits to service_role;
grant all on table public.collections to service_role;
grant all on table public.collection_places to service_role;

-- Atomic delete for one personal/imported place and all personal signals.
create or replace function public.delete_personal_place(
  p_owner_key text,
  p_place_id text
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  deleted_count integer;
begin
  delete from public.collection_places
   where owner_key = p_owner_key and place_id = p_place_id;

  delete from public.saved_places
   where owner_key = p_owner_key and place_id = p_place_id;

  delete from public.personal_ratings
   where owner_key = p_owner_key and place_id = p_place_id;

  delete from public.visits
   where owner_key = p_owner_key and place_id = p_place_id;

  delete from public.personal_places
   where owner_key = p_owner_key and id = p_place_id;

  get diagnostics deleted_count = row_count;
  return deleted_count > 0;
end;
$$;

revoke all on function public.delete_personal_place(text, text) from public, anon, authenticated;
grant execute on function public.delete_personal_place(text, text) to service_role;

-- Geo-ready RPC for future server-side nearby discovery.
create or replace function public.nearby_personal_places(
  p_owner_key text,
  p_lat double precision,
  p_long double precision,
  p_limit integer default 100
)
returns table (
  id text,
  name text,
  latitude double precision,
  longitude double precision,
  distance_meters double precision
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    p.id,
    p.name,
    p.latitude,
    p.longitude,
    extensions.st_distance(
      p.location,
      extensions.st_point(p_long, p_lat)::extensions.geography
    ) as distance_meters
  from public.personal_places p
  where p.owner_key = p_owner_key
  order by p.location operator(extensions.<->)
    extensions.st_point(p_long, p_lat)::extensions.geography
  limit greatest(1, least(p_limit, 500));
$$;

revoke all on function public.nearby_personal_places(text, double precision, double precision, integer)
  from public, anon, authenticated;
grant execute on function public.nearby_personal_places(text, double precision, double precision, integer)
  to service_role;
