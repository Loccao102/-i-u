create table if not exists public.profile_transfer_codes (
  code_hash text primary key,
  owner_key text not null,
  profile_token text not null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  used_at timestamptz null,
  constraint profile_transfer_codes_token_check
    check (profile_token ~ '^[a-f0-9]{64}$'),
  constraint profile_transfer_codes_expiry_check
    check (expires_at > created_at)
);

create index if not exists profile_transfer_codes_owner_idx
  on public.profile_transfer_codes (owner_key, expires_at desc);

alter table public.profile_transfer_codes enable row level security;

revoke all on table public.profile_transfer_codes from anon, authenticated;
grant select, insert, update, delete
  on table public.profile_transfer_codes
  to service_role;

drop policy if exists deny_client_access
  on public.profile_transfer_codes;

create policy deny_client_access
  on public.profile_transfer_codes
  for all
  to anon, authenticated
  using (false)
  with check (false);
