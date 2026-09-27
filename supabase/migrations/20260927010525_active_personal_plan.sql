create table if not exists public.active_personal_plans (
  owner_key text primary key,
  id uuid not null,
  plan jsonb not null,
  current_stop_index integer not null default 0,
  completed_stop_ids text[] not null default '{}',
  skipped_stop_ids text[] not null default '{}',
  started_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint active_personal_plans_current_stop_nonnegative
    check (current_stop_index >= 0),
  constraint active_personal_plans_max_progress_items
    check (
      cardinality(completed_stop_ids) <= 3
      and cardinality(skipped_stop_ids) <= 3
    )
);

alter table public.active_personal_plans enable row level security;

revoke all on table public.active_personal_plans from anon, authenticated;
grant select, insert, update, delete
  on table public.active_personal_plans
  to service_role;

drop policy if exists deny_client_access on public.active_personal_plans;
create policy deny_client_access
  on public.active_personal_plans
  for all
  to anon, authenticated
  using (false)
  with check (false);

alter table public.active_personal_plans
  drop constraint if exists active_personal_plans_plan_shape;

alter table public.active_personal_plans
  add constraint active_personal_plans_plan_shape
  check (
    jsonb_typeof(plan) = 'object'
    and jsonb_typeof(plan -> 'stops') = 'array'
    and jsonb_array_length(plan -> 'stops') between 1 and 3
    and current_stop_index < jsonb_array_length(plan -> 'stops')
  );

alter table public.active_personal_plans
  drop constraint if exists active_personal_plans_progress_disjoint;

alter table public.active_personal_plans
  add constraint active_personal_plans_progress_disjoint
  check (not (completed_stop_ids && skipped_stop_ids));

create or replace function public.advance_active_personal_plan(
  p_owner_key text,
  p_action text
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_row public.active_personal_plans%rowtype;
  v_stop_count integer;
  v_stop_id text;
  v_next_index integer;
  v_completed text[];
  v_skipped text[];
begin
  if p_action not in ('complete', 'skip') then
    raise exception 'invalid action';
  end if;

  select *
  into v_row
  from public.active_personal_plans
  where owner_key = p_owner_key
  for update;

  if not found then
    return jsonb_build_object(
      'finished', false,
      'notFound', true
    );
  end if;

  v_stop_count := jsonb_array_length(v_row.plan -> 'stops');

  if v_stop_count < 1 or v_row.current_stop_index >= v_stop_count then
    delete from public.active_personal_plans
    where owner_key = p_owner_key;

    return jsonb_build_object(
      'finished', true,
      'notFound', false
    );
  end if;

  v_stop_id := v_row.plan #>> array[
    'stops',
    v_row.current_stop_index::text,
    'placeId'
  ];

  v_completed := v_row.completed_stop_ids;
  v_skipped := v_row.skipped_stop_ids;

  if p_action = 'complete' then
    if not (v_stop_id = any(v_completed)) then
      v_completed := array_append(v_completed, v_stop_id);
    end if;
  else
    if not (v_stop_id = any(v_skipped)) then
      v_skipped := array_append(v_skipped, v_stop_id);
    end if;
  end if;

  v_next_index := v_row.current_stop_index + 1;

  if v_next_index >= v_stop_count then
    delete from public.active_personal_plans
    where owner_key = p_owner_key;

    return jsonb_build_object(
      'finished', true,
      'notFound', false,
      'action', p_action,
      'stopId', v_stop_id
    );
  end if;

  update public.active_personal_plans
  set current_stop_index = v_next_index,
      completed_stop_ids = v_completed,
      skipped_stop_ids = v_skipped,
      updated_at = now()
  where owner_key = p_owner_key
  returning *
  into v_row;

  return jsonb_build_object(
    'finished', false,
    'notFound', false,
    'action', p_action,
    'stopId', v_stop_id,
    'activePlan', jsonb_build_object(
      'id', v_row.id,
      'plan', v_row.plan,
      'currentStopIndex', v_row.current_stop_index,
      'completedStopIds', v_row.completed_stop_ids,
      'skippedStopIds', v_row.skipped_stop_ids,
      'startedAt', v_row.started_at,
      'updatedAt', v_row.updated_at
    )
  );
end;
$$;

revoke all on function public.advance_active_personal_plan(text, text)
  from public, anon, authenticated;

grant execute on function public.advance_active_personal_plan(text, text)
  to service_role;
