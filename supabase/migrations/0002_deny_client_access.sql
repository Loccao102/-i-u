do $$
declare
  t text;
begin
  foreach t in array array[
    'personal_places',
    'saved_places',
    'personal_ratings',
    'visits',
    'collections',
    'collection_places'
  ]
  loop
    execute format('drop policy if exists deny_client_access on public.%I', t);
    execute format(
      'create policy deny_client_access on public.%I for all to anon, authenticated using (false) with check (false)',
      t
    );
  end loop;
end
$$;
