create or replace function public.cast_group_poll_vote(
  p_slug text,
  p_voter_key text,
  p_place_id text
)
returns void
language plpgsql
security invoker
set search_path to ''
as $function$
declare
  v_poll public.group_polls%rowtype;
begin
  select *
  into v_poll
  from public.group_polls
  where slug = p_slug
  for update;

  if not found then
    raise exception 'GROUP_POLL_NOT_FOUND';
  end if;

  if v_poll.closed_at is not null or v_poll.expires_at <= pg_catalog.now() then
    raise exception 'GROUP_POLL_CLOSED';
  end if;

  if p_place_id is null
     or pg_catalog.char_length(pg_catalog.btrim(p_place_id)) < 1
     or not exists (
       select 1
       from pg_catalog.jsonb_array_elements(v_poll.candidates) as candidate
       where candidate ->> 'placeId' = p_place_id
     ) then
    raise exception 'INVALID_BODY';
  end if;

  insert into public.group_poll_votes (
    poll_id,
    voter_key,
    place_id,
    updated_at
  )
  values (
    v_poll.id,
    p_voter_key,
    p_place_id,
    pg_catalog.now()
  )
  on conflict (poll_id, voter_key) do update set
    place_id = excluded.place_id,
    updated_at = excluded.updated_at;
end;
$function$;

revoke all on function public.cast_group_poll_vote(text, text, text)
  from public, anon, authenticated;

grant execute on function public.cast_group_poll_vote(text, text, text)
  to service_role;
