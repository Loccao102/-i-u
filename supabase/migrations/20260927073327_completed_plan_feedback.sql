-- Explicit post-plan feedback distinguishes "finished" from "enjoyed".

alter table public.completed_personal_plans
  add column if not exists outcome_rating integer null,
  add column if not exists would_repeat boolean null,
  add column if not exists feedback_note text null,
  add column if not exists feedback_at timestamptz null;

alter table public.completed_personal_plans
  drop constraint if exists completed_personal_plans_outcome_rating_check;

alter table public.completed_personal_plans
  add constraint completed_personal_plans_outcome_rating_check
  check (outcome_rating is null or outcome_rating between 1 and 5);

alter table public.completed_personal_plans
  drop constraint if exists completed_personal_plans_feedback_note_length_check;

alter table public.completed_personal_plans
  add constraint completed_personal_plans_feedback_note_length_check
  check (feedback_note is null or char_length(feedback_note) <= 300);
