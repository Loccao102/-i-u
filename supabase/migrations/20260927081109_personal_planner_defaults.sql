-- Persist the planner controls that represent stable personal defaults.
-- Browser roles stay denied; the Next.js server accesses this via the secret key.

create table if not exists public.personal_planner_defaults (
  owner_key text primary key,
  route_mode text not null default 'motorcycle',
  budget_for_two integer not null default 700000,
  max_distance_km integer not null default 5,
  duration_hours integer not null default 4,
  updated_at timestamptz not null default now(),
  constraint personal_planner_defaults_route_mode_check
    check (route_mode in ('motorcycle', 'drive', 'walk')),
  constraint personal_planner_defaults_budget_check
    check (budget_for_two between 100000 and 10000000),
  constraint personal_planner_defaults_distance_check
    check (max_distance_km in (3, 5, 8, 12)),
  constraint personal_planner_defaults_duration_check
    check (duration_hours in (2, 3, 4))
);

alter table public.personal_planner_defaults enable row level security;

revoke all on table public.personal_planner_defaults
  from anon, authenticated;

grant select, insert, update, delete
  on table public.personal_planner_defaults
  to service_role;

drop policy if exists deny_client_access
  on public.personal_planner_defaults;

create policy deny_client_access
  on public.personal_planner_defaults
  for all
  to anon, authenticated
  using (false)
  with check (false);
