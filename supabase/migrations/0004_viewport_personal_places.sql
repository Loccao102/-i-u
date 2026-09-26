create or replace function public.viewport_personal_places(
  p_owner_key text,
  p_west double precision,
  p_south double precision,
  p_east double precision,
  p_north double precision,
  p_limit integer default 500
)
returns table (
  id text,
  latitude double precision,
  longitude double precision
)
language sql
stable
security invoker
set search_path = ''
as $$
  select
    p.id,
    p.latitude,
    p.longitude
  from public.personal_places p
  where p.owner_key = p_owner_key
    and extensions.st_intersects(
      p.location,
      extensions.st_setsrid(
        extensions.st_makeenvelope(
          least(p_west, p_east),
          least(p_south, p_north),
          greatest(p_west, p_east),
          greatest(p_south, p_north)
        ),
        4326
      )::extensions.geography
    )
  order by p.updated_at desc
  limit greatest(1, least(p_limit, 1000));
$$;

revoke all on function public.viewport_personal_places(
  text, double precision, double precision, double precision, double precision, integer
) from public, anon, authenticated;

grant execute on function public.viewport_personal_places(
  text, double precision, double precision, double precision, double precision, integer
) to service_role;
