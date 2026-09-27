create or replace function public.delete_personal_profile(
  p_owner_key text
)
returns void
language plpgsql
set search_path to ''
as $function$
begin
  delete from public.collection_places where owner_key = p_owner_key;
  delete from public.saved_places where owner_key = p_owner_key;
  delete from public.personal_ratings where owner_key = p_owner_key;
  delete from public.visits where owner_key = p_owner_key;
  delete from public.recommendation_feedback where owner_key = p_owner_key;
  delete from public.place_user_photos where owner_key = p_owner_key;
  delete from public.active_personal_plans where owner_key = p_owner_key;
  delete from public.completed_personal_plans where owner_key = p_owner_key;
  delete from public.daily_discoveries where owner_key = p_owner_key;
  delete from public.personal_planner_defaults where owner_key = p_owner_key;
  delete from public.personal_planner_metrics where owner_key = p_owner_key;
  delete from public.profile_transfer_codes where owner_key = p_owner_key;
  delete from public.public_itinerary_shares where owner_key = p_owner_key;
  delete from public.collections where owner_key = p_owner_key;
  delete from public.personal_places where owner_key = p_owner_key;
end;
$function$;

revoke all on function public.delete_personal_profile(text)
  from public, anon, authenticated;
grant execute on function public.delete_personal_profile(text)
  to service_role;
