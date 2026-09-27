-- completed plan history uses upsert for archive/import, so service role
-- needs UPDATE in addition to SELECT/INSERT/DELETE.

grant update
  on table public.completed_personal_plans
  to service_role;
