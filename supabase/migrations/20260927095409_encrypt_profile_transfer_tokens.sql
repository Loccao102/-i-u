-- Harden one-time profile transfer:
-- store only ciphertext and remove each row atomically when redeemed.

delete from public.profile_transfer_codes;

alter table public.profile_transfer_codes
  drop constraint if exists profile_transfer_codes_token_check;

alter table public.profile_transfer_codes
  rename column profile_token to token_ciphertext;

alter table public.profile_transfer_codes
  drop column if exists used_at;
