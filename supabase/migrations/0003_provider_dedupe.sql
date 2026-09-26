create unique index if not exists personal_places_owner_provider_unique_idx
  on public.personal_places (owner_key, source, provider_id)
  where source = 'PROVIDER' and provider_id is not null;
