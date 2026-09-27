create or replace function public.start_active_personal_plan(
  p_owner_key text,
  p_id uuid,
  p_plan jsonb
)
returns jsonb
language plpgsql
set search_path to ''
as $function$
declare
  v_row public.active_personal_plans%rowtype;
begin
  -- Serialize starts for one anonymous profile, including the no-row case.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtext(p_owner_key)::bigint
  );

  select *
  into v_row
  from public.active_personal_plans
  where owner_key = p_owner_key
  for update;

  if found
     and v_row.plan = p_plan
     and v_row.current_stop_index = 0
     and cardinality(v_row.completed_stop_ids) = 0
     and cardinality(v_row.skipped_stop_ids) = 0 then
    return jsonb_build_object(
      'created', false,
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
  end if;

  insert into public.active_personal_plans (
    owner_key,
    id,
    plan,
    current_stop_index,
    completed_stop_ids,
    skipped_stop_ids,
    started_at,
    updated_at
  )
  values (
    p_owner_key,
    p_id,
    p_plan,
    0,
    '{}',
    '{}',
    now(),
    now()
  )
  on conflict (owner_key) do update set
    id = excluded.id,
    plan = excluded.plan,
    current_stop_index = 0,
    completed_stop_ids = '{}',
    skipped_stop_ids = '{}',
    started_at = excluded.started_at,
    updated_at = excluded.updated_at
  returning *
  into v_row;

  return jsonb_build_object(
    'created', true,
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
$function$;

revoke all on function public.start_active_personal_plan(text, uuid, jsonb)
  from public, anon, authenticated;
grant execute on function public.start_active_personal_plan(text, uuid, jsonb)
  to service_role;
