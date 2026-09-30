begin;

-- Only translated display copy lives here. The original vehicles row is never rewritten.
create table public.vehicle_description_translations (
  vehicle_id uuid primary key references public.vehicles(id) on delete cascade,
  source_text text not null check (length(source_text) between 1 and 5000),
  source_language text not null check (source_language in ('en','ms','zh')),
  en text not null check (length(en) between 1 and 20000),
  ms text not null check (length(ms) between 1 and 20000),
  zh text not null check (length(zh) between 1 and 20000),
  translated_at timestamptz not null default now()
);
alter table public.vehicle_description_translations enable row level security;
revoke all on public.vehicle_description_translations from public,anon,authenticated;
grant select on public.vehicle_description_translations to anon,authenticated;
grant all on public.vehicle_description_translations to service_role;
create policy current_visible_description on public.vehicle_description_translations for select to anon,authenticated
  using (exists(select 1 from public.vehicles v where v.id=vehicle_id and v.description=source_text
    and (v.publication='published' or (select public.e2_can_read_stock()))));

create table public.vehicle_translation_settings (
  singleton boolean primary key default true check(singleton),
  enabled boolean not null default false
);
insert into public.vehicle_translation_settings default values;
alter table public.vehicle_translation_settings enable row level security;
revoke all on public.vehicle_translation_settings from public,anon,authenticated;
grant all on public.vehicle_translation_settings to service_role;

create table public.vehicle_translation_jobs (
  vehicle_id uuid primary key references public.vehicles(id) on delete cascade,
  source_text text not null check (length(source_text)<=5000),
  source_hash text not null,
  status text not null check (status in ('empty','pending','queued','processing','ready','failed')),
  attempts integer not null default 0 check (attempts between 0 and 3),
  error_code text,
  token_hash text,
  lease_until timestamptz,
  next_attempt_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.vehicle_translation_jobs enable row level security;
revoke all on public.vehicle_translation_jobs from public,anon,authenticated;
grant select(vehicle_id,source_text,status,attempts,error_code,updated_at) on public.vehicle_translation_jobs to authenticated;
grant all on public.vehicle_translation_jobs to service_role;
create policy admin_translation_status on public.vehicle_translation_jobs for select to authenticated
  using ((select public.e2_is_admin()));

-- One-use, short-lived capabilities. No API key is placed in the database or HTTP receipts.
create function public.e2_dispatch_vehicle_translation(target uuid) returns void
language plpgsql security definer set search_path='' as $$
declare job public.vehicle_translation_jobs%rowtype; token text;
begin
  select * into job from public.vehicle_translation_jobs where vehicle_id=target for update;
  if not found or job.status<>'pending' or job.attempts>=3 or job.next_attempt_at>now() then return; end if;
  if not exists(select 1 from public.vehicle_translation_settings where singleton and enabled) then
    update public.vehicle_translation_jobs set error_code='setup_required' where vehicle_id=target;
    return;
  end if;
  token:='e2tr_'||replace(gen_random_uuid()::text||gen_random_uuid()::text,'-','');
  update public.vehicle_translation_jobs set status='queued',attempts=attempts+1,error_code=null,
    token_hash=encode(sha256(convert_to(token,'UTF8')),'hex'),lease_until=now()+interval '2 minutes',updated_at=now()
    where vehicle_id=target;
  begin
    perform net.http_post(
      url:='https://gkppiuuwsecojcnvkzjl.supabase.co/functions/v1/e2-translate-vehicle',
      headers:=jsonb_build_object('Content-Type','application/json','Authorization','Bearer '||token),
      body:=jsonb_build_object('vehicle_id',target,'source_hash',job.source_hash),timeout_milliseconds:=60000);
  exception when others then
    -- A translation outage must never roll back a successfully saved vehicle.
    update public.vehicle_translation_jobs set status=case when attempts>=3 then 'failed' else 'pending' end,
      token_hash=null,lease_until=null,error_code='dispatch_failed',next_attempt_at=now()+interval '5 minutes'
      where vehicle_id=target;
  end;
end;
$$;
revoke all on function public.e2_dispatch_vehicle_translation(uuid) from public,anon,authenticated,service_role;

create function public.e2_queue_vehicle_translation() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  if tg_op='UPDATE' and new.description is not distinct from old.description then return new; end if;
  delete from public.vehicle_description_translations where vehicle_id=new.id;
  insert into public.vehicle_translation_jobs(vehicle_id,source_text,source_hash,status)
    values(new.id,new.description,encode(sha256(convert_to(new.description,'UTF8')),'hex'),
      case when length(trim(new.description))=0 then 'empty' else 'pending' end)
    on conflict(vehicle_id) do update set source_text=excluded.source_text,source_hash=excluded.source_hash,
      status=excluded.status,attempts=0,error_code=null,token_hash=null,lease_until=null,next_attempt_at=now(),updated_at=now();
  perform public.e2_dispatch_vehicle_translation(new.id);
  return new;
end;
$$;
revoke all on function public.e2_queue_vehicle_translation() from public,anon,authenticated,service_role;
create trigger queue_vehicle_translation after insert or update of description on public.vehicles
  for each row execute function public.e2_queue_vehicle_translation();

create function public.e2_claim_vehicle_translation(target uuid,source text,token text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare job public.vehicle_translation_jobs%rowtype;
begin
  select * into job from public.vehicle_translation_jobs where vehicle_id=target for update;
  if not found or job.status<>'queued' or job.source_hash is distinct from source or job.lease_until<=now()
    or token !~ '^e2tr_[a-f0-9]{64}$' or job.token_hash is distinct from encode(sha256(convert_to(token,'UTF8')),'hex')
    or not exists(select 1 from public.vehicle_translation_settings where singleton and enabled) then return null; end if;
  update public.vehicle_translation_jobs set status='processing',lease_until=now()+interval '2 minutes',updated_at=now()
    where vehicle_id=target;
  return jsonb_build_object('source_text',job.source_text,'source_hash',job.source_hash);
end;
$$;
revoke all on function public.e2_claim_vehicle_translation(uuid,text,text) from public,anon,authenticated;
grant execute on function public.e2_claim_vehicle_translation(uuid,text,text) to service_role;

create function public.e2_finish_vehicle_translation(target uuid,source text,token text,output jsonb,failure text default null) returns boolean
language plpgsql security definer set search_path='' as $$
declare job public.vehicle_translation_jobs%rowtype; current_source text; lang text; text_value text;
begin
  -- Use the same parent-then-job lock order as a description save.
  select description into current_source from public.vehicles where id=target for update;
  if not found then return false; end if;
  select * into job from public.vehicle_translation_jobs where vehicle_id=target for update;
  if not found or job.status<>'processing' or job.source_hash is distinct from source or job.source_text<>current_source
    or job.lease_until<=now() or job.token_hash is distinct from encode(sha256(convert_to(token,'UTF8')),'hex')
    or not exists(select 1 from public.vehicle_translation_settings where singleton and enabled) then return false; end if;
  if failure is null then
    if output is null or jsonb_typeof(output)<>'object' or coalesce(output->>'source_language','') not in ('en','ms','zh') then
      raise exception 'Invalid translation output';
    end if;
    foreach lang in array array['en','ms','zh'] loop
      text_value:=output->>lang;
      if coalesce(jsonb_typeof(output->lang),'')<>'string' or text_value is null or length(trim(text_value))=0 or length(text_value)>20000 then
        raise exception 'Incomplete translation output';
      end if;
    end loop;
    if output->>(output->>'source_language')<>job.source_text then raise exception 'Original language must be preserved'; end if;
    insert into public.vehicle_description_translations(vehicle_id,source_text,source_language,en,ms,zh)
      values(target,job.source_text,output->>'source_language',output->>'en',output->>'ms',output->>'zh')
      on conflict(vehicle_id) do update set source_text=excluded.source_text,source_language=excluded.source_language,
        en=excluded.en,ms=excluded.ms,zh=excluded.zh,translated_at=now();
    update public.vehicle_translation_jobs set status='ready',error_code=null,token_hash=null,lease_until=null,updated_at=now()
      where vehicle_id=target;
  else
    if failure not in ('configuration_required','billing_required','rate_limited','upstream_error','network_error','invalid_output','refused') then failure:='upstream_error'; end if;
    update public.vehicle_translation_jobs set
      status=case when attempts<3 and failure in ('rate_limited','upstream_error','network_error','invalid_output') then 'pending' else 'failed' end,
      error_code=failure,token_hash=null,lease_until=null,next_attempt_at=now()+interval '5 minutes',updated_at=now()
      where vehicle_id=target;
  end if;
  return true;
end;
$$;
revoke all on function public.e2_finish_vehicle_translation(uuid,text,text,jsonb,text) from public,anon,authenticated;
grant execute on function public.e2_finish_vehicle_translation(uuid,text,text,jsonb,text) to service_role;

create function public.e2_retry_vehicle_translation(target uuid) returns void
language plpgsql security definer set search_path='' as $$
declare job public.vehicle_translation_jobs%rowtype;
begin
  if not public.e2_is_admin() then raise exception 'Admin access required'; end if;
  if not exists(select 1 from public.vehicle_translation_settings where singleton and enabled) then raise exception 'Automatic translation setup is not complete'; end if;
  select * into job from public.vehicle_translation_jobs where vehicle_id=target for update;
  if not found or job.status in ('ready','empty') then return; end if;
  if job.status in ('queued','processing') and job.lease_until>now() then return; end if;
  if job.updated_at>now()-interval '1 minute' then raise exception 'Please wait one minute before retrying'; end if;
  update public.vehicle_translation_jobs set status='pending',attempts=0,next_attempt_at=now(),token_hash=null,lease_until=null,updated_at=now()
    where vehicle_id=target;
  perform public.e2_dispatch_vehicle_translation(target);
end;
$$;
revoke all on function public.e2_retry_vehicle_translation(uuid) from public,anon;
grant execute on function public.e2_retry_vehicle_translation(uuid) to authenticated;

create function public.e2_retry_pending_vehicle_translations() returns integer
language plpgsql security definer set search_path='' as $$
declare job record; dispatched integer:=0;
begin
  if not exists(select 1 from public.vehicle_translation_settings where singleton and enabled) then return 0; end if;
  for job in select vehicle_id,attempts from public.vehicle_translation_jobs
    where (status='pending' and next_attempt_at<=now()) or (status in ('queued','processing') and lease_until<=now())
    order by updated_at limit 5 for update skip locked loop
    update public.vehicle_translation_jobs set status=case when job.attempts>=3 then 'failed' else 'pending' end,
      error_code=case when job.attempts>=3 then 'network_error' else error_code end,token_hash=null,lease_until=null
      where vehicle_id=job.vehicle_id;
    if job.attempts<3 then perform public.e2_dispatch_vehicle_translation(job.vehicle_id); dispatched:=dispatched+1; end if;
  end loop;
  return dispatched;
end;
$$;
revoke all on function public.e2_retry_pending_vehicle_translations() from public,anon,authenticated,service_role;

-- Backfill queues only. Activation and API credentials are deliberately separate.
insert into public.vehicle_translation_jobs(vehicle_id,source_text,source_hash,status,error_code)
  select id,description,encode(sha256(convert_to(description,'UTF8')),'hex'),
    case when length(trim(description))=0 then 'empty' else 'pending' end,
    case when length(trim(description))=0 then null else 'setup_required' end from public.vehicles;
commit;
