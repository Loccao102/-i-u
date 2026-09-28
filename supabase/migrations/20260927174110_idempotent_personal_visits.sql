create or replace function public.add_personal_visit_if_new(
  p_owner_key text,
  p_id uuid,
  p_place_id text,
  p_rating_stars integer,
  p_visited_at timestamptz,
  p_window_minutes integer default 120
)
returns jsonb
language plpgsql
set search_path to ''
as $function$
declare
  v_row public.visits%rowtype;
  v_window interval;
begin
  if p_window_minutes < 1 or p_window_minutes > 1440 then
    raise exception 'invalid visit dedupe window';
  end if;

  if p_rating_stars is not null and (p_rating_stars < 1 or p_rating_stars > 5) then
    raise exception 'invalid rating stars';
  end if;

  v_window := p_window_minutes * interval '1 minute';

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtext(p_owner_key || ':' || p_place_id)::bigint
  );

  select *
  into v_row
  from public.visits
  where owner_key = p_owner_key
    and place_id = p_place_id
    and visited_at between p_visited_at - v_window and p_visited_at + v_window
  order by visited_at desc
  limit 1
  for update;

  if found then
    if p_rating_stars is not null and v_row.rating_stars is null then
      update public.visits
      set rating_stars = p_rating_stars
      where owner_key = p_owner_key
        and id = v_row.id
      returning *
      into v_row;
    end if;

    return jsonb_build_object(
      'created', false,
      'visit', jsonb_build_object(
        'id', v_row.id,
        'placeId', v_row.place_id,
        'visitedAt', v_row.visited_at,
        'ratingStars', v_row.rating_stars
      )
    );
  end if;

  insert into public.visits (
    owner_key,
    id,
    place_id,
    visited_at,
    rating_stars
  )
  values (
    p_owner_key,
    p_id,
    p_place_id,
    p_visited_at,
    p_rating_stars
  )
  returning *
  into v_row;

  return jsonb_build_object(
    'created', true,
    'visit', jsonb_build_object(
      'id', v_row.id,
      'placeId', v_row.place_id,
      'visitedAt', v_row.visited_at,
      'ratingStars', v_row.rating_stars
    )
  );
end;
$function$;

revoke all on function public.add_personal_visit_if_new(
  text, uuid, text, integer, timestamptz, integer
) from public, anon, authenticated;

grant execute on function public.add_personal_visit_if_new(
  text, uuid, text, integer, timestamptz, integer
) to service_role;
