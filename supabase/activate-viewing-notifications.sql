-- Run ONLY after deploying e2-viewing-notify and configuring its Bot + private channel.
-- pg_cron and pg_net must already be installed. No credentials belong in this file.
begin;
update public.e2_viewing_delivery_settings set notifications_enabled=true where singleton;
select cron.schedule('e2-viewing-notifications','* * * * *',$$select public.e2_dispatch_viewing_notifications();$$);
commit;
