begin;
-- This is a conservative spending allowance, not a provider invoice. Reserve
-- RM0.03 BEFORE each single, bounded GPT-4.1-mini call; never refund on timeouts.
-- 166 attempts = RM4.98 maximum per Malaysia calendar month. Failed/unclear
-- photos retain their receipt so an uncertain retry cannot spend again.
create table public.drive_mileage_budget (
 month date primary key,
 reserved_sen integer not null default 0 check(reserved_sen between 0 and 500)
);
create table public.drive_mileage_receipts (
 id uuid primary key default gen_random_uuid(),
 vehicle_id uuid not null references public.vehicles(id),
 actor_id uuid not null references auth.users(id),
 plate text not null, folder_id text not null, file_id text not null,
 checksum text not null check(checksum ~ '^[a-f0-9]{32}$'),
 budget_month date not null references public.drive_mileage_budget(month),
 reserved_sen integer not null default 3 check(reserved_sen=3),
 expected_version timestamptz not null, previous_mileage integer, applied_version timestamptz,
 status text not null default 'claimed' check(status in ('claimed','applied','review')),
 reading integer check(reading between 0 and 999999), issue text,
 input_tokens integer not null default 0, output_tokens integer not null default 0,
 created_at timestamptz not null default now(), finished_at timestamptz,
 unique(vehicle_id,checksum)
);
create index drive_mileage_receipts_actor on public.drive_mileage_receipts(actor_id);
create index drive_mileage_receipts_month on public.drive_mileage_receipts(budget_month);
alter table public.drive_mileage_budget enable row level security;
alter table public.drive_mileage_receipts enable row level security;
revoke all on public.drive_mileage_budget,public.drive_mileage_receipts from public,anon,authenticated;
grant select on public.drive_mileage_budget,public.drive_mileage_receipts to authenticated;
grant all on public.drive_mileage_budget,public.drive_mileage_receipts to service_role;
create policy admin_read_mileage_budget on public.drive_mileage_budget for select to authenticated using (
 exists(select 1 from public.staff_memberships where user_id=(select auth.uid()) and active and role in ('super_admin','admin')));
create policy admin_read_mileage_receipts on public.drive_mileage_receipts for select to authenticated using (
 exists(select 1 from public.staff_memberships where user_id=(select auth.uid()) and active and role in ('super_admin','admin')));

create function public.e2_claim_drive_mileage(actor_id uuid,target uuid,expected_version timestamptz,plate_key text,folder text,file_id text,checksum text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v public.vehicles%rowtype; receipt uuid; month_key date:=date_trunc('month',now() at time zone 'Asia/Kuala_Lumpur')::date; spent integer;
begin
 if not exists(select 1 from public.staff_memberships s where s.user_id=actor_id and s.active and s.role in ('admin','super_admin')) then raise exception 'Admin access required';end if;
 if checksum is null or checksum !~ '^[a-f0-9]{32}$' or folder is null or folder !~ '^[A-Za-z0-9_-]{10,200}$' or file_id is null or file_id !~ '^[A-Za-z0-9_-]{10,200}$' then raise exception 'Invalid photo source';end if;
 select * into v from public.vehicles where id=target for update;
 if not found or v.publication<>'draft' or v.mileage_confirmed or v.updated_at is distinct from expected_version or regexp_replace(upper(v.plate),'[^A-Z0-9]','','g') is distinct from plate_key then return jsonb_build_object('status','changed');end if;
 if exists(select 1 from public.drive_mileage_receipts r where r.vehicle_id=target and r.checksum=e2_claim_drive_mileage.checksum) then return jsonb_build_object('status','unchanged');end if;
 insert into public.drive_mileage_budget(month) values(month_key) on conflict do nothing;
 select reserved_sen into spent from public.drive_mileage_budget where month=month_key for update;
 if spent+3>500 then return jsonb_build_object('status','budget');end if;
 update public.drive_mileage_budget set reserved_sen=reserved_sen+3 where month=month_key;
 insert into public.drive_mileage_receipts(vehicle_id,actor_id,plate,folder_id,file_id,checksum,budget_month,expected_version,previous_mileage)
 values(target,actor_id,v.plate,folder,file_id,checksum,month_key,expected_version,v.mileage) returning id into receipt;
 return jsonb_build_object('status','claimed','id',receipt);
end;$$;
revoke all on function public.e2_claim_drive_mileage(uuid,uuid,timestamptz,text,text,text,text) from public,anon,authenticated;
grant execute on function public.e2_claim_drive_mileage(uuid,uuid,timestamptz,text,text,text,text) to service_role;

create function public.e2_finish_drive_mileage(claim_id uuid,actor_id uuid,reading integer,issue text,input_tokens integer default 0,output_tokens integer default 0)
returns jsonb language plpgsql security definer set search_path='' as $$
declare r public.drive_mileage_receipts%rowtype; v public.vehicles%rowtype; problem text:=left(issue,300); outcome text:='review'; applied_stamp timestamptz;
begin
 -- Lock vehicles before receipts, matching the claim order.
 select * into r from public.drive_mileage_receipts where id=claim_id;
 if not found or r.actor_id is distinct from actor_id then raise exception 'Unknown mileage claim';end if;
 select * into v from public.vehicles where id=r.vehicle_id for update;
 select * into r from public.drive_mileage_receipts where id=claim_id for update;
 if r.status<>'claimed' then return jsonb_build_object('status',r.status,'issue',r.issue);end if;
 if not exists(select 1 from public.staff_memberships s where s.user_id=actor_id and s.active and s.role in ('admin','super_admin')) then problem:='Administrator no longer active';
 elsif v.publication<>'draft' or v.mileage_confirmed or v.updated_at is distinct from r.expected_version or v.plate is distinct from r.plate then problem:='Vehicle changed or mileage already confirmed; review manually';
 elsif reading is null or reading not between 0 and 999999 then problem:=coalesce(problem,'Odometer reading unclear; review M photo');
 elsif v.mileage is not null and reading<v.mileage then problem:='Reading lower than existing mileage; review manually';
 elsif v.mileage is not null and reading<>v.mileage and not exists(select 1 from public.drive_mileage_receipts previous where previous.vehicle_id=v.id and previous.status='applied' and previous.reading=v.mileage and previous.applied_version=v.updated_at) then problem:='Existing manually entered mileage differs; review manually';
 end if;
 if problem is null then
  perform set_config('request.jwt.claim.sub',actor_id::text,true);
  update public.vehicles set mileage=reading,mileage_confirmed=false where id=v.id returning updated_at into applied_stamp;
  insert into public.inventory_audit(actor,entity,action,row_id) values(actor_id,'vehicles','IMPORT_MILEAGE_DRAFT',v.id);
  outcome:='applied';
 end if;
 update public.drive_mileage_receipts set status=outcome,reading=case when e2_finish_drive_mileage.reading between 0 and 999999 then e2_finish_drive_mileage.reading else null end,
  issue=problem,finished_at=now(),applied_version=applied_stamp,input_tokens=greatest(0,least(coalesce(e2_finish_drive_mileage.input_tokens,0),100000)),output_tokens=greatest(0,least(coalesce(e2_finish_drive_mileage.output_tokens,0),10000)) where id=claim_id;
 return jsonb_build_object('status',outcome,'issue',problem);
end;$$;
revoke all on function public.e2_finish_drive_mileage(uuid,uuid,integer,text,integer,integer) from public,anon,authenticated;
grant execute on function public.e2_finish_drive_mileage(uuid,uuid,integer,text,integer,integer) to service_role;
create or replace function public.e2_finish_scheduled_import(dispatch uuid,result jsonb) returns void language plpgsql security definer set search_path='' as $$
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
    'mileage',jsonb_build_object('updated',coalesce(summary->'mileage'->'updated','[]'::jsonb)||coalesce(result->'mileage'->'updated','[]'::jsonb),'review',coalesce(summary->'mileage'->'review','[]'::jsonb)||coalesce(result->'mileage'->'review','[]'::jsonb),'budget_paused',coalesce(result->'mileage'->'budget_paused','false'::jsonb),'error',result->'mileage'->'error'),
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


commit;
