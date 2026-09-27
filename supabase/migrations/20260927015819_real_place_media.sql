alter table public.personal_places
  add column if not exists google_place_id text;

create unique index if not exists personal_places_owner_google_place_unique_idx
  on public.personal_places (owner_key, google_place_id)
  where google_place_id is not null;

create table if not exists public.place_user_photos (
  owner_key text not null,
  id uuid not null,
  place_id text not null,
  storage_path text not null,
  caption text not null default '',
  created_at timestamptz not null default now(),
  primary key (owner_key, id),
  unique (owner_key, storage_path),
  foreign key (owner_key, place_id)
    references public.personal_places (owner_key, id)
    on delete cascade,
  check (char_length(caption) <= 180)
);

create index if not exists place_user_photos_owner_place_idx
  on public.place_user_photos (owner_key, place_id, created_at desc);

alter table public.place_user_photos enable row level security;

revoke all on table public.place_user_photos from anon, authenticated;
grant select, insert, update, delete
  on table public.place_user_photos
  to service_role;

drop policy if exists deny_client_access on public.place_user_photos;
create policy deny_client_access
  on public.place_user_photos
  for all
  to anon, authenticated
  using (false)
  with check (false);

create or replace function public.delete_personal_place(
  p_owner_key text,
  p_place_id text
)
returns boolean
language plpgsql
security invoker
set search_path = ''
as $$
declare
  deleted_count integer;
begin
  delete from public.place_user_photos
   where owner_key = p_owner_key and place_id = p_place_id;

  delete from public.collection_places
   where owner_key = p_owner_key and place_id = p_place_id;

  delete from public.saved_places
   where owner_key = p_owner_key and place_id = p_place_id;

  delete from public.personal_ratings
   where owner_key = p_owner_key and place_id = p_place_id;

  delete from public.visits
   where owner_key = p_owner_key and place_id = p_place_id;

  delete from public.personal_places
   where owner_key = p_owner_key and id = p_place_id;

  get diagnostics deleted_count = row_count;
  return deleted_count > 0;
end;
$$;

revoke all on function public.delete_personal_place(text, text)
  from public, anon, authenticated;
grant execute on function public.delete_personal_place(text, text)
  to service_role;
