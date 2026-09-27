-- Planner telemetry is derived/non-user-content data.
-- Reset the early counters once because the original generated_count
-- included rerolls, so legacy rows cannot be mixed with the new semantics.

delete from public.personal_planner_metrics;
