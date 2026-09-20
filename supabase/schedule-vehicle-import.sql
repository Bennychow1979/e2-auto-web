-- Run as project database administrator after migration 202609210002 and the Edge deployment.
-- Reuses the existing E2 administrator; no new account or broad API key is created.
begin;
insert into public.vehicle_import_schedule(singleton,enabled,actor_id)
  select true,true,u.id from auth.users u join public.staff_memberships s on s.user_id=u.id
  where lower(u.email)='bennychow1979@gmail.com' and s.active and s.role in ('super_admin','admin')
  on conflict(singleton) do update set enabled=true,actor_id=excluded.actor_id,updated_at=now();
do $$ begin
  if not exists(select 1 from public.vehicle_import_schedule where singleton and enabled) then raise exception 'Active E2 administrator not found'; end if;
end $$;
-- Cron is UTC: 01:00 UTC = 09:00 Asia/Kuala_Lumpur.
select cron.schedule('e2-vehicle-import-daily','0 1 * * *',$$select public.e2_start_scheduled_import('daily');$$);
-- Database-only timeout cleanup: no Drive/network requests and no model invocation.
select cron.schedule('e2-vehicle-import-watchdog','*/15 * * * *',$$select public.e2_expire_import_runs();$$);
commit;
