create table if not exists public.recommendation_feedback (
  owner_key text not null,
  place_id text not null,
  reason text not null check (
    reason in (
      'not_taste',
      'not_now',
      'too_far',
      'too_expensive'
    )
  ),
  scenario text null check (
    scenario is null or scenario in (
      'date',
      'friends',
      'food',
      'coffee',
      'fun',
      'chill'
    )
  ),
  distance_km double precision null check (
    distance_km is null or (
      distance_km >= 0 and distance_km <= 50000
    )
  ),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (owner_key, place_id),
  foreign key (owner_key, place_id)
    references public.personal_places (owner_key, id)
    on delete cascade
);

create index if not exists
  recommendation_feedback_owner_updated_idx
  on public.recommendation_feedback (
    owner_key,
    updated_at desc
  );

alter table public.recommendation_feedback
  enable row level security;

revoke all on table public.recommendation_feedback
  from public, anon, authenticated;

grant select, insert, update, delete
  on table public.recommendation_feedback
  to service_role;

drop policy if exists deny_client_access
  on public.recommendation_feedback;

create policy deny_client_access
  on public.recommendation_feedback
  for all
  to anon, authenticated
  using (false)
  with check (false);
