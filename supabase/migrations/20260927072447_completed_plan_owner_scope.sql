-- Allow the same completed-plan UUID to be imported into a different
-- anonymous owner profile without a cross-owner primary-key collision.

alter table public.completed_personal_plans
  drop constraint if exists completed_personal_plans_pkey;

alter table public.completed_personal_plans
  add constraint completed_personal_plans_pkey
  primary key (owner_key, id);
