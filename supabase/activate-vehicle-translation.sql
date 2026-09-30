-- Apply only after deploying e2-translate-vehicle and setting OPENAI_API_KEY in Edge secrets.
-- Existing pg_net / pg_cron extensions from the inventory importer are reused.
begin;
do $$ begin
  if to_regnamespace('net') is null or to_regnamespace('cron') is null then
    raise exception 'Enable pg_net and pg_cron before activating translation';
  end if;
end $$;
update public.vehicle_translation_settings set enabled=true where singleton;
-- Recover jobs that were queued before API configuration was finished.
update public.vehicle_translation_jobs set status='pending',attempts=0,error_code=null,next_attempt_at=now()
  where status='failed' and error_code in ('configuration_required','billing_required');
select cron.schedule('e2-vehicle-description-translations','* * * * *',
  $$select public.e2_retry_pending_vehicle_translations();$$);
select public.e2_retry_pending_vehicle_translations();
commit;
