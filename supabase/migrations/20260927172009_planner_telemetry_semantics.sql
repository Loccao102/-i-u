alter table public.personal_planner_metrics
  add column if not exists initial_generated_count integer not null default 0
    check (initial_generated_count >= 0),
  add column if not exists rerolled_count integer not null default 0
    check (rerolled_count >= 0),
  add column if not exists generation_failed_count integer not null default 0
    check (generation_failed_count >= 0),
  add column if not exists canceled_count integer not null default 0
    check (canceled_count >= 0);

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
  if p_metric not in (
    'generated_initial',
    'rerolled',
    'generation_failed',
    'started',
    'completed',
    'replayed',
    'canceled'
  ) then
    raise exception 'invalid planner metric';
  end if;

  insert into public.personal_planner_metrics (
    owner_key,
    day,
    generated_count,
    initial_generated_count,
    rerolled_count,
    generation_failed_count,
    started_count,
    completed_count,
    replayed_count,
    canceled_count,
    updated_at
  )
  values (
    p_owner_key,
    v_day,
    case when p_metric in ('generated_initial','rerolled') then 1 else 0 end,
    case when p_metric = 'generated_initial' then 1 else 0 end,
    case when p_metric = 'rerolled' then 1 else 0 end,
    case when p_metric = 'generation_failed' then 1 else 0 end,
    case when p_metric = 'started' then 1 else 0 end,
    case when p_metric = 'completed' then 1 else 0 end,
    case when p_metric = 'replayed' then 1 else 0 end,
    case when p_metric = 'canceled' then 1 else 0 end,
    now()
  )
  on conflict (owner_key, day) do update set
    generated_count =
      public.personal_planner_metrics.generated_count +
      case when p_metric in ('generated_initial','rerolled') then 1 else 0 end,
    initial_generated_count =
      public.personal_planner_metrics.initial_generated_count +
      case when p_metric = 'generated_initial' then 1 else 0 end,
    rerolled_count =
      public.personal_planner_metrics.rerolled_count +
      case when p_metric = 'rerolled' then 1 else 0 end,
    generation_failed_count =
      public.personal_planner_metrics.generation_failed_count +
      case when p_metric = 'generation_failed' then 1 else 0 end,
    started_count =
      public.personal_planner_metrics.started_count +
      case when p_metric = 'started' then 1 else 0 end,
    completed_count =
      public.personal_planner_metrics.completed_count +
      case when p_metric = 'completed' then 1 else 0 end,
    replayed_count =
      public.personal_planner_metrics.replayed_count +
      case when p_metric = 'replayed' then 1 else 0 end,
    canceled_count =
      public.personal_planner_metrics.canceled_count +
      case when p_metric = 'canceled' then 1 else 0 end,
    updated_at = now();
end;
$function$;

revoke all on function public.increment_personal_planner_metric(text, text)
  from public, anon, authenticated;
grant execute on function public.increment_personal_planner_metric(text, text)
  to service_role;
