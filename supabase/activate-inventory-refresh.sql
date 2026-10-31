-- REVIEWED LOCAL PROPOSAL ONLY. Run after separate production/security approval,
-- worker deployment and owner-managed GitHub credential setup. No secrets here.
begin;
do $$begin
 if not exists(select 1 from pg_extension where extname='pg_net') or
    not exists(select 1 from pg_extension where extname='pg_cron') then
  raise exception 'Existing pg_net and pg_cron are required; do not install silently';
 end if;
 if exists(select 1 from cron.job where jobname='e2-inventory-refresh') then
  raise exception 'Inventory refresh job already exists; inspect it before activation';
 end if;
end;$$;
update public.e2_inventory_refresh set enabled=true,revision=revision+1,first_dirty_at=coalesce(first_dirty_at,now()),changed_at=now(),available_at=now() where singleton;
select cron.schedule('e2-inventory-refresh','* * * * *','select public.e2_dispatch_inventory_refresh();');
commit;
