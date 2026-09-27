-- Persist completed outing plans separately from the single active plan.

create table if not exists public.completed_personal_plans (
  id uuid primary key,
  owner_key text not null,
  plan jsonb not null,
  completed_stop_ids text[] not null default '{}',
  skipped_stop_ids text[] not null default '{}',
  started_at timestamptz not null,
  completed_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create index if not exists completed_personal_plans_owner_completed_idx
  on public.completed_personal_plans (owner_key, completed_at desc);

alter table public.completed_personal_plans enable row level security;

revoke all on table public.completed_personal_plans from anon, authenticated;
grant select, insert, delete
  on table public.completed_personal_plans
  to service_role;

drop policy if exists deny_client_access on public.completed_personal_plans;
create policy deny_client_access
  on public.completed_personal_plans
  for all
  to anon, authenticated
  using (false)
  with check (false);
