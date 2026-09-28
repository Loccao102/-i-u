create table if not exists public.group_polls (
  id uuid primary key default gen_random_uuid(),
  owner_key text not null,
  slug text not null unique,
  title text not null
    check (char_length(title) between 1 and 80),
  candidates jsonb not null
    check (
      jsonb_typeof(candidates) = 'array'
      and jsonb_array_length(candidates) between 2 and 3
    ),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '24 hours'),
  closed_at timestamptz
);

create index if not exists group_polls_owner_created_idx
  on public.group_polls (owner_key, created_at desc);

create index if not exists group_polls_expires_idx
  on public.group_polls (expires_at);

create table if not exists public.group_poll_votes (
  poll_id uuid not null
    references public.group_polls(id) on delete cascade,
  voter_key text not null,
  place_id text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (poll_id, voter_key)
);

create index if not exists group_poll_votes_poll_place_idx
  on public.group_poll_votes (poll_id, place_id);

alter table public.group_polls enable row level security;
alter table public.group_poll_votes enable row level security;

revoke all on table public.group_polls from anon, authenticated;
revoke all on table public.group_poll_votes from anon, authenticated;

grant select, insert, update, delete
  on table public.group_polls
  to service_role;

grant select, insert, update, delete
  on table public.group_poll_votes
  to service_role;

drop policy if exists deny_client_access on public.group_polls;
create policy deny_client_access
  on public.group_polls
  for all
  to anon, authenticated
  using (false)
  with check (false);

drop policy if exists deny_client_access on public.group_poll_votes;
create policy deny_client_access
  on public.group_poll_votes
  for all
  to anon, authenticated
  using (false)
  with check (false);
