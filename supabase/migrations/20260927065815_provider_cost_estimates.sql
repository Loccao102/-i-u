-- Track where place cost data came from so provider estimates do not
-- contaminate the user's learned spending profile.

alter table public.personal_places
  add column if not exists cost_source text not null default 'unknown';

alter table public.personal_places
  add column if not exists cost_confidence integer not null default 0;

alter table public.personal_places
  drop constraint if exists personal_places_cost_source_check;

alter table public.personal_places
  add constraint personal_places_cost_source_check
  check (cost_source in ('unknown', 'user', 'provider_estimate'));

alter table public.personal_places
  drop constraint if exists personal_places_cost_confidence_check;

alter table public.personal_places
  add constraint personal_places_cost_confidence_check
  check (cost_confidence between 0 and 100);

-- Before provider estimates existed, any non-empty cost was user-entered.
update public.personal_places
set
  cost_source = 'user',
  cost_confidence = 100
where cost_source = 'unknown'
  and average_for_two <> 'Chưa có dữ liệu';
