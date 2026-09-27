-- Archive the final active-plan snapshot and delete the active row
-- in one database transaction.

create or replace function public.advance_active_personal_plan(
  p_owner_key text,
  p_action text,
  p_expected_index integer
)
returns jsonb
language plpgsql
set search_path to ''
as $function$
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

  if p_expected_index < 0 then
    raise exception 'invalid expected index';
  end if;

  select *
  into v_row
  from public.active_personal_plans
  where owner_key = p_owner_key
  for update;

  if not found then
    return jsonb_build_object(
      'finished', false,
      'notFound', true,
      'stale', false
    );
  end if;

  if v_row.current_stop_index <> p_expected_index then
    return jsonb_build_object(
      'finished', false,
      'notFound', false,
      'stale', true,
      'currentStopIndex', v_row.current_stop_index
    );
  end if;

  v_stop_count := jsonb_array_length(v_row.plan -> 'stops');

  if v_stop_count < 1 or v_row.current_stop_index >= v_stop_count then
    insert into public.completed_personal_plans (
      id, owner_key, plan, completed_stop_ids, skipped_stop_ids,
      started_at, completed_at
    ) values (
      v_row.id, p_owner_key, v_row.plan,
      v_row.completed_stop_ids, v_row.skipped_stop_ids,
      v_row.started_at, now()
    )
    on conflict (owner_key, id) do update set
      plan = excluded.plan,
      completed_stop_ids = excluded.completed_stop_ids,
      skipped_stop_ids = excluded.skipped_stop_ids,
      started_at = excluded.started_at,
      completed_at = excluded.completed_at;

    delete from public.active_personal_plans
    where owner_key = p_owner_key;

    return jsonb_build_object(
      'finished', true,
      'notFound', false,
      'stale', false
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
    insert into public.completed_personal_plans (
      id, owner_key, plan, completed_stop_ids, skipped_stop_ids,
      started_at, completed_at
    ) values (
      v_row.id, p_owner_key, v_row.plan,
      v_completed, v_skipped,
      v_row.started_at, now()
    )
    on conflict (owner_key, id) do update set
      plan = excluded.plan,
      completed_stop_ids = excluded.completed_stop_ids,
      skipped_stop_ids = excluded.skipped_stop_ids,
      started_at = excluded.started_at,
      completed_at = excluded.completed_at;

    delete from public.active_personal_plans
    where owner_key = p_owner_key;

    return jsonb_build_object(
      'finished', true,
      'notFound', false,
      'stale', false,
      'action', p_action,
      'stopId', v_stop_id
    );
  end if;

  update public.active_personal_plans
  set current_stop_index = v_next_index,
      completed_stop_ids = v_completed,
      skipped_stop_ids = v_skipped,
      updated_at = now()
  where owner_key = p_owner_key;

  return jsonb_build_object(
    'finished', false,
    'notFound', false,
    'stale', false,
    'action', p_action,
    'stopId', v_stop_id
  );
end;
$function$;
