begin;
-- Cron/net are installed separately by the project administrator. No provider keys
-- are stored in cron commands; each request gets a one-use, five-minute capability.
create table public.vehicle_import_schedule (
  singleton boolean primary key default true check(singleton),
  enabled boolean not null default false,
  actor_id uuid not null references auth.users(id),
  updated_at timestamptz not null default now()
);
create table public.vehicle_import_runs (
  id uuid primary key default gen_random_uuid(),
  run_kind text not null check(run_kind in ('daily','test')),
  scheduled_day date not null,
  actor_id uuid not null references auth.users(id),
  status text not null check(status in ('queued','running','completed','failed')),
  batches integer not null default 0,
  summary jsonb not null default '{"created":[],"blocked":[]}'::jsonb,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  lease_until timestamptz not null default now()+interval '10 minutes'
);
create unique index vehicle_import_once_daily on public.vehicle_import_runs(scheduled_day) where run_kind='daily';
create table public.vehicle_import_dispatches (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.vehicle_import_runs(id),
  token_hash text not null,
  expires_at timestamptz not null default now()+interval '5 minutes',
  claimed_at timestamptz,
  completed_at timestamptz,
  request_id bigint
);
alter table public.vehicle_import_schedule enable row level security;
alter table public.vehicle_import_runs enable row level security;
alter table public.vehicle_import_dispatches enable row level security;
revoke all on public.vehicle_import_schedule,public.vehicle_import_runs,public.vehicle_import_dispatches from public,anon,authenticated;
grant all on public.vehicle_import_schedule,public.vehicle_import_runs,public.vehicle_import_dispatches to service_role;
grant select on public.vehicle_import_schedule,public.vehicle_import_runs to authenticated;
create policy admin_read_import_schedule on public.vehicle_import_schedule for select to authenticated using (
  exists(select 1 from public.staff_memberships where user_id=(select auth.uid()) and active and role in ('super_admin','admin')));
create policy admin_read_import_runs on public.vehicle_import_runs for select to authenticated using (
  exists(select 1 from public.staff_memberships where user_id=(select auth.uid()) and active and role in ('super_admin','admin')));

create function public.e2_dispatch_import(target_run uuid) returns void language plpgsql security definer set search_path='' as $$
declare token text; dispatch_id uuid; request bigint;
begin
  -- UUIDs use OS randomness. Two UUIDs supply >240 random bits; plaintext is never returned.
  token:='e2job_'||replace(gen_random_uuid()::text||gen_random_uuid()::text,'-','');
  insert into public.vehicle_import_dispatches(run_id,token_hash)
    values(target_run,encode(sha256(convert_to(token,'UTF8')),'hex')) returning id into dispatch_id;
  select net.http_post(
    url:='https://gkppiuuwsecojcnvkzjl.supabase.co/functions/v1/e2-vehicle-import',
    headers:=jsonb_build_object('Content-Type','application/json','Authorization','Bearer '||token),
    body:=jsonb_build_object('action','scheduled','dispatch_id',dispatch_id),timeout_milliseconds:=120000) into request;
  update public.vehicle_import_dispatches set request_id=request where id=dispatch_id;
  update public.vehicle_import_runs set status='queued',lease_until=now()+interval '10 minutes' where id=target_run;
end;
$$;
revoke all on function public.e2_dispatch_import(uuid) from public,anon,authenticated,service_role;

create function public.e2_start_scheduled_import(kind text default 'daily') returns uuid language plpgsql security definer set search_path='' as $$
declare config public.vehicle_import_schedule%rowtype; run_id uuid; today date:=(now() at time zone 'Asia/Kuala_Lumpur')::date;
begin
  perform pg_advisory_xact_lock(21092026);
  if kind not in ('daily','test') then raise exception 'Invalid run kind'; end if;
  select * into config from public.vehicle_import_schedule where singleton;
  if not found or not config.enabled then return null; end if;
  select id into run_id from public.vehicle_import_runs where status in ('queued','running') and lease_until>now() order by started_at desc limit 1;
  if found then return run_id; end if;
  if kind='daily' then
    select id into run_id from public.vehicle_import_runs where run_kind='daily' and scheduled_day=today;
    if found then return run_id; end if;
  end if;
  insert into public.vehicle_import_runs(run_kind,scheduled_day,actor_id,status) values(kind,today,config.actor_id,'queued') returning id into run_id;
  if not exists(select 1 from public.staff_memberships where user_id=config.actor_id and active and role in ('super_admin','admin')) then
    update public.vehicle_import_runs set status='failed',finished_at=now(),summary=summary||'{"error":"Scheduled import administrator is inactive or no longer has permission."}'::jsonb where id=run_id;
    return run_id;
  end if;
  perform public.e2_dispatch_import(run_id);
  return run_id;
end;
$$;
revoke all on function public.e2_start_scheduled_import(text) from public,anon,authenticated,service_role;

create function public.e2_claim_scheduled_import(dispatch uuid,token text) returns jsonb language plpgsql security definer set search_path='' as $$
declare job public.vehicle_import_dispatches%rowtype; run public.vehicle_import_runs%rowtype;
begin
  select * into job from public.vehicle_import_dispatches where id=dispatch;
  if not found or job.claimed_at is not null or job.expires_at<=now() or job.token_hash<>encode(sha256(convert_to(token,'UTF8')),'hex') then return null; end if;
  select * into run from public.vehicle_import_runs where id=job.run_id for update;
  if run.status<>'queued' or run.lease_until<=now() then return null; end if;
  if not exists(select 1 from public.vehicle_import_schedule where singleton and enabled and actor_id=run.actor_id)
    or not exists(select 1 from public.staff_memberships where user_id=run.actor_id and active and role in ('super_admin','admin')) then return null; end if;
  update public.vehicle_import_dispatches set claimed_at=now() where id=dispatch and claimed_at is null and expires_at>now();
  if not found then return null; end if;
  update public.vehicle_import_runs set status='running',lease_until=now()+interval '10 minutes',batches=batches+1 where id=run.id;
  return jsonb_build_object('run_id',run.id,'actor_id',run.actor_id,'dispatch_id',dispatch);
end;
$$;
revoke all on function public.e2_claim_scheduled_import(uuid,text) from public,anon,authenticated;
grant execute on function public.e2_claim_scheduled_import(uuid,text) to service_role;

create function public.e2_finish_scheduled_import(dispatch uuid,result jsonb) returns void language plpgsql security definer set search_path='' as $$
declare job public.vehicle_import_dispatches%rowtype; run public.vehicle_import_runs%rowtype; failure text;
begin
  select * into job from public.vehicle_import_dispatches where id=dispatch;
  if not found or job.claimed_at is null or job.completed_at is not null then return; end if;
  select * into run from public.vehicle_import_runs where id=job.run_id for update;
  if run.status<>'running' then return; end if;
  update public.vehicle_import_dispatches set completed_at=now(),token_hash='' where id=dispatch and completed_at is null;
  if not found then return; end if;
  failure:=result->>'error';
  if not exists(select 1 from public.vehicle_import_schedule where singleton and enabled and actor_id=run.actor_id) then failure:='Automatic import is disabled.'; end if;
  if coalesce((result->>'remaining')::integer,0)>0 and (run.batches>=100 or run.started_at<now()-interval '45 minutes') then failure:='Batch limit reached. Review the remaining folders.'; end if;
  update public.vehicle_import_runs set summary=jsonb_build_object(
    'created',coalesce(summary->'created','[]'::jsonb)||coalesce(result->'created','[]'::jsonb),
    'blocked',coalesce(summary->'blocked','[]'::jsonb)||coalesce(result->'blocked','[]'::jsonb),
    'existing',result->'existing','unchanged',result->'unchanged','remaining',result->'remaining','error',failure)
    where id=run.id;
  if failure is not null then
    update public.vehicle_import_runs set status='failed',finished_at=now() where id=run.id;
  elsif coalesce((result->>'remaining')::integer,0)>0 then
    perform public.e2_dispatch_import(run.id);
  else
    update public.vehicle_import_runs set status='completed',finished_at=now() where id=run.id;
  end if;
end;
$$;
revoke all on function public.e2_finish_scheduled_import(uuid,jsonb) from public,anon,authenticated;
grant execute on function public.e2_finish_scheduled_import(uuid,jsonb) to service_role;

create function public.e2_expire_import_runs() returns integer language plpgsql security definer set search_path='' as $$
declare expired integer;
begin
  update public.vehicle_import_runs set status='failed',finished_at=now(),summary=summary||'{"error":"Scheduled request did not complete. Saved drafts remain safe; check the latest import receipts."}'::jsonb
    where status in ('queued','running') and lease_until<=now();
  get diagnostics expired=row_count;
  delete from public.vehicle_import_dispatches where expires_at<now()-interval '7 days';
  return expired;
end;
$$;
revoke all on function public.e2_expire_import_runs() from public,anon,authenticated,service_role;
commit;
