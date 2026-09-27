create table if not exists public.public_itinerary_shares (
  slug text primary key,
  owner_key text not null,
  plan jsonb not null,
  source_kind text not null
    check (source_kind in ('generated','active','completed')),
  source_plan_id uuid null,
  created_at timestamptz not null default now(),
  revoked_at timestamptz null,
  constraint public_itinerary_shares_slug_check
    check (slug ~ '^[A-Za-z0-9_-]{12,32}$')
);

create index if not exists public_itinerary_shares_owner_created_idx
  on public.public_itinerary_shares (owner_key, created_at desc);

alter table public.public_itinerary_shares enable row level security;

revoke all on table public.public_itinerary_shares from anon, authenticated;
grant select, insert, update, delete
  on table public.public_itinerary_shares
  to service_role;

drop policy if exists deny_client_access
  on public.public_itinerary_shares;

create policy deny_client_access
  on public.public_itinerary_shares
  for all
  to anon, authenticated
  using (false)
  with check (false);
