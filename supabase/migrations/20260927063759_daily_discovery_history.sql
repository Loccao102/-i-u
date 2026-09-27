-- Daily discovery history for cross-device/profile-level novelty.
-- Provider POIs may not be persisted yet, so place_keys intentionally has no FK.

create table if not exists public.daily_discoveries (
  owner_key text not null,
  day date not null,
  kind text not null check (kind in ('place', 'route')),
  place_keys text[] not null,
  scenario text null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (owner_key, day, kind),
  constraint daily_discoveries_place_keys_count
    check (cardinality(place_keys) between 1 and 3),
  constraint daily_discoveries_scenario_check
    check (
      scenario is null
      or scenario in ('date', 'friends', 'food', 'coffee', 'fun', 'chill')
    )
);

create index if not exists daily_discoveries_owner_day_idx
  on public.daily_discoveries (owner_key, day desc);

alter table public.daily_discoveries enable row level security;

revoke all on table public.daily_discoveries from anon, authenticated;
grant select, insert, update, delete
  on table public.daily_discoveries
  to service_role;

drop policy if exists deny_client_access on public.daily_discoveries;
create policy deny_client_access
  on public.daily_discoveries
  for all
  to anon, authenticated
  using (false)
  with check (false);
