create table if not exists public.personal_planner_metrics (
  owner_key text not null,
  day date not null,
  generated_count integer not null default 0
    check (generated_count >= 0),
  started_count integer not null default 0
    check (started_count >= 0),
  completed_count integer not null default 0
    check (completed_count >= 0),
  replayed_count integer not null default 0
    check (replayed_count >= 0),
  updated_at timestamptz not null default now(),
  primary key (owner_key, day)
);

create index if not exists personal_planner_metrics_owner_day_idx
  on public.personal_planner_metrics (owner_key, day desc);

alter table public.personal_planner_metrics enable row level security;

revoke all on table public.personal_planner_metrics from anon, authenticated;
grant select, insert, update, delete
  on table public.personal_planner_metrics
  to service_role;

drop policy if exists deny_client_access
  on public.personal_planner_metrics;
create policy deny_client_access
  on public.personal_planner_metrics
  for all
  to anon, authenticated
  using (false)
  with check (false);

create or replace function public.increment_personal_planner_metric(
  p_owner_key text,
  p_metric text
)
returns void
language plpgsql
set search_path to ''
as $function$
declare
  v_day date :=
    (now() at time zone 'Asia/Ho_Chi_Minh')::date;
begin
  if p_metric not in ('generated','started','completed','replayed') then
    raise exception 'invalid planner metric';
  end if;

  insert into public.personal_planner_metrics (
    owner_key,
    day,
    generated_count,
    started_count,
    completed_count,
    replayed_count,
    updated_at
  )
  values (
    p_owner_key,
    v_day,
    case when p_metric = 'generated' then 1 else 0 end,
    case when p_metric = 'started' then 1 else 0 end,
    case when p_metric = 'completed' then 1 else 0 end,
    case when p_metric = 'replayed' then 1 else 0 end,
    now()
  )
  on conflict (owner_key, day) do update set
    generated_count =
      public.personal_planner_metrics.generated_count +
      case when p_metric = 'generated' then 1 else 0 end,
    started_count =
      public.personal_planner_metrics.started_count +
      case when p_metric = 'started' then 1 else 0 end,
    completed_count =
      public.personal_planner_metrics.completed_count +
      case when p_metric = 'completed' then 1 else 0 end,
    replayed_count =
      public.personal_planner_metrics.replayed_count +
      case when p_metric = 'replayed' then 1 else 0 end,
    updated_at = now();
end;
$function$;

revoke all on function public.increment_personal_planner_metric(text, text)
  from public, anon, authenticated;
grant execute on function public.increment_personal_planner_metric(text, text)
  to service_role;
