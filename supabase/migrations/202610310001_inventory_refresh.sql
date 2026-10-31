begin;
-- Transactional dirty marker, not a copy of vehicle/customer records. Disabled
-- until the worker, repository workflow and narrowly scoped credential are approved.
create table public.e2_inventory_refresh (
 singleton boolean primary key default true check(singleton),
 enabled boolean not null default false,
 revision bigint not null default 1,
 deployed_revision bigint not null default 0,
 first_dirty_at timestamptz default now(),
 changed_at timestamptz not null default now(),
 available_at timestamptz not null default now(),
 dispatch_id uuid,
 dispatch_revision bigint,
 dispatched_at timestamptz,
 lease_id uuid,
 lease_until timestamptz,
 attempts integer not null default 0,
 last_issue text,
 last_deployed_at timestamptz
);
insert into public.e2_inventory_refresh(singleton) values(true);
create table public.e2_inventory_refresh_dispatches (
 id uuid primary key default gen_random_uuid(),
 token_hash text not null,
 expires_at timestamptz not null default now()+interval '5 minutes',
 claimed_at timestamptz
);
alter table public.e2_inventory_refresh enable row level security;
alter table public.e2_inventory_refresh_dispatches enable row level security;
revoke all on public.e2_inventory_refresh,public.e2_inventory_refresh_dispatches from public,anon,authenticated;
grant all on public.e2_inventory_refresh,public.e2_inventory_refresh_dispatches to service_role;

create function public.e2_mark_inventory_dirty() returns trigger
language plpgsql security definer set search_path='' as $$
declare visible boolean;
begin
 if tg_table_name='vehicles' then
  visible:=(tg_op<>'INSERT' and old.publication='published') or (tg_op<>'DELETE' and new.publication='published');
  -- Includes direct SQL/import/admin/RPC changes, not just the browser save path.
  if tg_op='UPDATE' and to_jsonb(old)=to_jsonb(new) then return null; end if;
 else
  visible:=exists(select 1 from public.vehicles where publication='published' and
   id in (case when tg_op<>'INSERT' then old.vehicle_id end,case when tg_op<>'DELETE' then new.vehicle_id end));
 end if;
 if visible then
  update public.e2_inventory_refresh set revision=revision+1,
   first_dirty_at=coalesce(first_dirty_at,now()),changed_at=now(),
   available_at=case when dispatch_id is null then least(available_at,now()+interval '30 seconds') else available_at end
   where singleton;
 end if;
 return null;
end;
$$;
create trigger e2_inventory_changed after insert or update or delete on public.vehicles
 for each row execute function public.e2_mark_inventory_dirty();
create trigger e2_inventory_photo_changed after insert or update or delete on public.vehicle_photos
 for each row execute function public.e2_mark_inventory_dirty();
revoke all on function public.e2_mark_inventory_dirty() from public,anon,authenticated,service_role;

-- Same database-created, one-use capability pattern as the existing import and
-- viewing workers. There is no GitHub credential in SQL or in the event payload.
create function public.e2_dispatch_inventory_refresh() returns void
language plpgsql security definer set search_path='' as $$
declare token text; dispatch uuid;
begin
 perform pg_advisory_xact_lock(20261031,1);
 if not (select enabled from public.e2_inventory_refresh where singleton) then return; end if;
 delete from public.e2_inventory_refresh_dispatches where expires_at<now()-interval '1 day';
 if exists(select 1 from public.e2_inventory_refresh_dispatches where claimed_at is null and expires_at>now()) then return; end if;
 -- Daily reconciliation is a recovery path. Committed mutations are the primary trigger.
 update public.e2_inventory_refresh set revision=revision+1,first_dirty_at=now(),changed_at=now(),available_at=now()
  where singleton and revision=deployed_revision and dispatch_id is null and last_deployed_at<now()-interval '1 day';
 if not exists(select 1 from public.e2_inventory_refresh where singleton and available_at<=now()
  and (dispatch_id is not null or revision>deployed_revision)) then return; end if;
 token:='e2refresh_'||replace(gen_random_uuid()::text||gen_random_uuid()::text,'-','');
 insert into public.e2_inventory_refresh_dispatches(token_hash) values(encode(sha256(convert_to(token,'UTF8')),'hex')) returning id into dispatch;
 perform net.http_post(url:='https://gkppiuuwsecojcnvkzjl.supabase.co/functions/v1/e2-inventory-refresh',
  headers:=jsonb_build_object('Content-Type','application/json','Authorization','Bearer '||token),
  body:=jsonb_build_object('dispatch_id',dispatch),timeout_milliseconds:=50000);
end;
$$;
create function public.e2_claim_inventory_refresh_dispatch(dispatch uuid,token text) returns boolean
language plpgsql security definer set search_path='' as $$
begin
 if token is null or token !~ '^e2refresh_[a-f0-9]{64}$' then return false; end if;
 update public.e2_inventory_refresh_dispatches set claimed_at=now() where id=dispatch and claimed_at is null and expires_at>now()
  and token_hash=encode(sha256(convert_to(token,'UTF8')),'hex');
 return found;
end;
$$;
create function public.e2_claim_inventory_refresh() returns jsonb
language plpgsql security definer set search_path='' as $$
declare s public.e2_inventory_refresh; action text;
begin
 select * into s from public.e2_inventory_refresh where singleton for update;
 if not s.enabled or s.available_at>now() or s.lease_until>now() then return null; end if;
 if s.dispatch_id is not null and s.dispatched_at<now()-interval '30 minutes' then
  update public.e2_inventory_refresh set dispatch_id=null,dispatch_revision=null,dispatched_at=null,
   lease_id=null,lease_until=null,available_at=now()+make_interval(secs=>least(3600,60*power(2,least(attempts,6)))::integer),
   last_issue='publication_timeout' where singleton;
  return null;
 end if;
 if s.dispatch_id is null then
  if s.revision<=s.deployed_revision or s.first_dirty_at>now()-interval '30 seconds' then return null; end if;
  action:='dispatch';
  update public.e2_inventory_refresh set dispatch_id=gen_random_uuid(),dispatch_revision=revision,
   dispatched_at=now(),attempts=attempts+1,last_issue='awaiting_publication' where singleton;
 else action:='check'; end if;
 -- Persist the attempt before sending. An interrupted/ambiguous request is checked
 -- against the live receipt, never immediately retried as though it did not run.
 update public.e2_inventory_refresh set lease_id=gen_random_uuid(),lease_until=now()+interval '55 seconds',
  available_at=now()+interval '1 minute' where singleton returning * into s;
 return jsonb_build_object('action',action,'lease',s.lease_id,'dispatch',s.dispatch_id,
  'revision',s.dispatch_revision::text,'started_at',s.dispatched_at);
end;
$$;
create function public.e2_finish_inventory_refresh(lease uuid,dispatch uuid,outcome text,retry_seconds integer default 0) returns boolean
language plpgsql security definer set search_path='' as $$
declare s public.e2_inventory_refresh;
begin
 if outcome not in ('deployed','waiting','dispatched','uncertain','rejected','unconfigured','build_failed') then raise exception 'Invalid refresh outcome'; end if;
 if retry_seconds is null or retry_seconds<0 or retry_seconds>86400 then raise exception 'Invalid retry delay'; end if;
 select * into s from public.e2_inventory_refresh where singleton for update;
 if lease is null or dispatch is null or s.lease_until is null or s.lease_id is distinct from lease or s.dispatch_id is distinct from dispatch or s.lease_until<now() then return false; end if;
 if outcome='deployed' then
  update public.e2_inventory_refresh set deployed_revision=greatest(deployed_revision,dispatch_revision),last_deployed_at=now(),
   first_dirty_at=case when revision<=dispatch_revision then null else first_dirty_at end,
   dispatch_id=null,dispatch_revision=null,dispatched_at=null,attempts=0,last_issue=null,available_at=now() where singleton;
 elsif outcome in ('rejected','unconfigured','build_failed') then
  update public.e2_inventory_refresh set dispatch_id=null,dispatch_revision=null,dispatched_at=null,
   available_at=now()+make_interval(secs=>greatest(retry_seconds,least(3600,60*power(2,least(attempts,6))))::integer),last_issue=outcome where singleton;
 else
  update public.e2_inventory_refresh set available_at=now()+interval '1 minute',
   last_issue=case when outcome='uncertain' then 'dispatch_uncertain' else last_issue end where singleton;
 end if;
 update public.e2_inventory_refresh set lease_id=null,lease_until=null where singleton;
 return true;
end;
$$;
revoke all on function public.e2_dispatch_inventory_refresh() from public,anon,authenticated,service_role;
revoke all on function public.e2_claim_inventory_refresh_dispatch(uuid,text),public.e2_claim_inventory_refresh(),public.e2_finish_inventory_refresh(uuid,uuid,text,integer) from public,anon,authenticated;
grant execute on function public.e2_claim_inventory_refresh_dispatch(uuid,text),public.e2_claim_inventory_refresh(),public.e2_finish_inventory_refresh(uuid,uuid,text,integer) to service_role;
-- No schedule or enablement here: production activation requires separate approval.
commit;
