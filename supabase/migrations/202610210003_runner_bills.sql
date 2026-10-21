begin;
alter table public.staff_memberships drop constraint staff_memberships_role_check;
alter table public.staff_memberships add constraint staff_memberships_role_check
 check(role in ('super_admin','admin','office_admin','inspector','runner','sales','account','customer'));

create function public.e2_ops_role() returns text language sql stable security definer set search_path='' as $$
 select role from public.staff_memberships where user_id=auth.uid() and active;
$$;
create table public.e2_runner_jobs(
 id uuid primary key,
 vehicle_id uuid not null references public.vehicles(id),
 assigned_to uuid not null references public.staff_memberships(user_id),
 kind text not null check(kind in ('puspakom','carsome_pickup','carro_pickup','send_invoice','workshop','delivery','other')),
 origin text not null check(length(trim(origin)) between 1 and 200),
 destination text not null check(length(trim(destination)) between 1 and 200),
 appointment_at timestamptz,
 instructions text not null default '' check(length(instructions)<=2000),
 status text not null default 'assigned' check(status in ('assigned','car_out','arrived','returning','collected','car_in','delivering','completed','cancelled')),
 last_mileage integer check(last_mileage between 0 and 2147483647),
 revision bigint not null default 1,
 dispatch_version bigint not null default 1,
 dispatched_at timestamptz not null default now(),
 accepted_at timestamptz,
 created_by uuid not null references public.staff_memberships(user_id),
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now()
);
create unique index runner_one_active_trip on public.e2_runner_jobs(vehicle_id)
 where kind<>'send_invoice' and status not in ('car_in','completed','cancelled');
create index runner_assigned_jobs on public.e2_runner_jobs(assigned_to,updated_at desc);
create table public.e2_ops_claims(
 id uuid primary key,
 kind text not null check(kind in ('petrol','repair')),
 job_id uuid references public.e2_runner_jobs(id),
 inspection_id uuid references public.e2_vehicle_inspections(id),
 supplier text not null check(length(trim(supplier)) between 1 and 200),
 invoice_no text not null default '' check(length(invoice_no)<=100),
 expense_date date not null,
 amount numeric(12,2) not null check(amount>0 and amount<=9999999),
 description text not null default '' check(length(description)<=2000),
 status text not null default 'draft' check(status in ('draft','submitted','returned','approved','verified','paid')),
 review_note text not null default '' check(length(review_note)<=1000),
 approved_by uuid references public.staff_memberships(user_id),
 approved_at timestamptz,
 verified_by uuid references public.staff_memberships(user_id),
 verified_at timestamptz,
 paid_by uuid references public.staff_memberships(user_id),
 paid_at timestamptz,
 payment_date date,
 payment_reference text check(length(payment_reference)<=150),
 revision bigint not null default 1,
 created_by uuid not null references public.staff_memberships(user_id),
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 check((kind='petrol' and job_id is not null and inspection_id is null) or
       (kind='repair' and inspection_id is not null and job_id is null))
);
create table public.e2_ops_files(
 id uuid primary key,
 job_id uuid references public.e2_runner_jobs(id),
 claim_id uuid references public.e2_ops_claims(id),
 kind text not null check(kind in ('appointment','job_sheet','handover','invoice_copy','receipt','invoice','payment')),
 filename text not null check(length(filename) between 1 and 160),
 mime_type text not null check(mime_type in ('application/pdf','image/jpeg','image/png','image/webp')),
 byte_size bigint not null check(byte_size between 1 and 10485760),
 path text not null unique,
 state text not null default 'uploading' check(state in ('uploading','ready')),
 created_by uuid not null references public.staff_memberships(user_id),
 created_at timestamptz not null default now(),
 check((job_id is not null and claim_id is null and kind in ('appointment','job_sheet','handover','invoice_copy')) or
       (claim_id is not null and job_id is null and kind in ('receipt','invoice','payment')))
);
create table public.e2_ops_events(
 id uuid primary key default gen_random_uuid(),
 job_id uuid references public.e2_runner_jobs(id),
 claim_id uuid references public.e2_ops_claims(id),
 actor uuid not null references public.staff_memberships(user_id),
 action text not null,
 detail jsonb not null,
 created_at timestamptz not null default now(),
 check((job_id is null)<>(claim_id is null))
);

create index ops_claim_job_status on public.e2_ops_claims(job_id,status);
create index ops_claim_creator on public.e2_ops_claims(created_by,updated_at desc);
create index ops_files_job on public.e2_ops_files(job_id,created_at desc);
create index ops_files_claim on public.e2_ops_files(claim_id,created_at desc);
create index ops_events_job on public.e2_ops_events(job_id,created_at desc);
create index ops_events_claim on public.e2_ops_events(claim_id,created_at desc);

create function public.e2_ops_job_read(target uuid) returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.e2_runner_jobs j where j.id=target and (
 public.e2_ops_role() in ('super_admin','admin') or
 (public.e2_ops_role()='runner' and j.assigned_to=auth.uid()) or
 (public.e2_ops_role()='account' and exists(select 1 from public.e2_ops_claims c where c.job_id=j.id and c.status in ('approved','verified','paid')))));
$$;
create function public.e2_ops_job_write(target uuid) returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.e2_runner_jobs j where j.id=target and j.status not in ('car_in','completed','cancelled') and
 (public.e2_ops_role() in ('super_admin','admin') or (public.e2_ops_role()='runner' and j.assigned_to=auth.uid())));
$$;
create function public.e2_ops_claim_read(target uuid) returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.e2_ops_claims c where c.id=target and (
 public.e2_ops_role() in ('super_admin','admin') or
 (public.e2_ops_role()='account' and c.status in ('approved','verified','paid')) or
 (public.e2_ops_role()='inspector' and c.kind='repair' and c.created_by=auth.uid()) or
 (public.e2_ops_role()='runner' and c.kind='petrol' and c.created_by=auth.uid() and
 exists(select 1 from public.e2_runner_jobs j where j.id=c.job_id and j.assigned_to=auth.uid()))));
$$;
create function public.e2_ops_claim_write(target uuid) returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.e2_ops_claims c where c.id=target and c.status in ('draft','returned') and
 c.created_by=auth.uid() and public.e2_ops_claim_read(c.id) and public.e2_ops_role() in ('runner','inspector','admin','super_admin'));
$$;
create function public.e2_ops_file_read(object_name text) returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.e2_ops_files f where f.path=object_name and
 (f.state='ready' or f.created_by=auth.uid()) and
 (public.e2_ops_job_read(f.job_id) or public.e2_ops_claim_read(f.claim_id)));
$$;
create function public.e2_ops_file_write(object_name text) returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.e2_ops_files f where f.path=object_name and f.state='uploading' and f.created_by=auth.uid() and
 ((f.job_id is not null and public.e2_ops_job_write(f.job_id)) or
 (f.kind<>'payment' and public.e2_ops_claim_write(f.claim_id)) or
 (f.kind='payment' and public.e2_ops_role()='account' and exists(select 1 from public.e2_ops_claims c where c.id=f.claim_id and c.status='verified'))));
$$;
alter table public.e2_runner_jobs enable row level security;
alter table public.e2_ops_claims enable row level security;
alter table public.e2_ops_files enable row level security;
alter table public.e2_ops_events enable row level security;
revoke all on public.e2_runner_jobs,public.e2_ops_claims,public.e2_ops_files,public.e2_ops_events from public,anon,authenticated;
grant select on public.e2_runner_jobs,public.e2_ops_claims,public.e2_ops_files,public.e2_ops_events to authenticated;
grant all on public.e2_runner_jobs,public.e2_ops_claims,public.e2_ops_files,public.e2_ops_events to service_role;
create policy runner_read on public.e2_runner_jobs for select to authenticated using(public.e2_ops_job_read(id));
create policy ops_claim_read on public.e2_ops_claims for select to authenticated using(public.e2_ops_claim_read(id));
create policy ops_file_read on public.e2_ops_files for select to authenticated using(public.e2_ops_file_read(path));
create policy ops_event_read on public.e2_ops_events for select to authenticated using(public.e2_ops_job_read(job_id) or public.e2_ops_claim_read(claim_id));
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
 values('operations-files','operations-files',false,10485760,array['application/pdf','image/jpeg','image/png','image/webp']);
create policy ops_file_insert on storage.objects for insert to authenticated with check(bucket_id='operations-files' and public.e2_ops_file_write(name));
create policy ops_file_download on storage.objects for select to authenticated using(bucket_id='operations-files' and public.e2_ops_file_read(name));

create function public.e2_save_runner_job(request_id uuid,expected_revision bigint,details jsonb)
 returns public.e2_runner_jobs language plpgsql security definer set search_path='' as $$
declare prior public.e2_runner_jobs; result public.e2_runner_jobs;
begin
 perform pg_advisory_xact_lock(20261021,3);
 if coalesce(public.e2_ops_role(),'') not in ('super_admin','admin') then raise exception 'Admin access required.';end if;
 if details is null or jsonb_typeof(details)<>'object' or octet_length(details::text)>6000 or
 exists(select 1 from jsonb_object_keys(details) k where k not in ('vehicle_id','assigned_to','kind','origin','destination','appointment_at','instructions')) then raise exception 'Invalid job details.';end if;
 if not exists(select 1 from public.staff_memberships where user_id=(details->>'assigned_to')::uuid and active and role='runner') then raise exception 'Choose an active Runner.';end if;
 select * into prior from public.e2_runner_jobs where id=request_id for update;
 if found then
  if expected_revision is null then
   if prior.created_by=auth.uid() and prior.vehicle_id=(details->>'vehicle_id')::uuid and prior.assigned_to=(details->>'assigned_to')::uuid and prior.kind=details->>'kind' and prior.origin=trim(details->>'origin') and prior.destination=trim(details->>'destination') and prior.appointment_at is not distinct from nullif(details->>'appointment_at','')::timestamptz and prior.instructions=coalesce(details->>'instructions','') then return prior;end if;
   raise exception 'Job reference already used.';
  end if;
  if prior.revision<>expected_revision or prior.status<>'assigned' then raise exception 'Job changed or already started. Refresh before editing.';end if;
  if prior.vehicle_id<>(details->>'vehicle_id')::uuid or prior.kind<>details->>'kind' then raise exception 'Vehicle and job type cannot change.';end if;
  update public.e2_runner_jobs set assigned_to=(details->>'assigned_to')::uuid,origin=trim(details->>'origin'),destination=trim(details->>'destination'),
   appointment_at=nullif(details->>'appointment_at','')::timestamptz,instructions=coalesce(details->>'instructions',''),revision=revision+1,updated_at=now(),
   dispatch_version=dispatch_version+1,dispatched_at=now(),accepted_at=null
   where id=request_id returning * into result;
 else
  if expected_revision is not null then raise exception 'Job not found.';end if;
  insert into public.e2_runner_jobs(id,vehicle_id,assigned_to,kind,origin,destination,appointment_at,instructions,created_by)
   values(request_id,(details->>'vehicle_id')::uuid,(details->>'assigned_to')::uuid,details->>'kind',trim(details->>'origin'),trim(details->>'destination'),
    nullif(details->>'appointment_at','')::timestamptz,coalesce(details->>'instructions',''),auth.uid()) returning * into result;
 end if;
 insert into public.e2_ops_events(job_id,actor,action,detail) values(result.id,auth.uid(),'Job saved',to_jsonb(result));
 return result;
end;$$;

create function public.e2_accept_runner_job(target uuid,expected_revision bigint)
 returns public.e2_runner_jobs language plpgsql security definer set search_path='' as $$
declare prior public.e2_runner_jobs; result public.e2_runner_jobs;
begin
 select * into prior from public.e2_runner_jobs where id=target for update;
 if not found or public.e2_ops_role() is distinct from 'runner' or prior.assigned_to is distinct from auth.uid() then raise exception 'Only the assigned active Runner can accept this job.';end if;
 if prior.status<>'assigned' then raise exception 'This job has already started or closed.';end if;
 if prior.accepted_at is not null and (expected_revision=prior.revision or expected_revision=prior.revision-1) then return prior;end if;
 if prior.revision is distinct from expected_revision then raise exception 'Job changed. Refresh and review the latest details before accepting.';end if;
 update public.e2_runner_jobs set accepted_at=now(),updated_at=now(),revision=revision+1 where id=target returning * into result;
 insert into public.e2_ops_events(job_id,actor,action,detail) values(target,auth.uid(),'Runner accepted',jsonb_build_object('accepted_at',result.accepted_at,'dispatch_version',result.dispatch_version));
 return result;
end;$$;
revoke all on function public.e2_accept_runner_job(uuid,bigint) from public,anon,authenticated;
grant execute on function public.e2_accept_runner_job(uuid,bigint) to authenticated;

create function public.e2_move_runner_job(target uuid,expected_revision bigint,next_status text,mileage integer,note text)
 returns public.e2_runner_jobs language plpgsql security definer set search_path='' as $$
declare prior public.e2_runner_jobs; result public.e2_runner_jobs; allowed text;
begin
 select * into prior from public.e2_runner_jobs where id=target for update;
 if not found or not public.e2_ops_job_write(target) then raise exception 'This job is not available to you.';end if;
 if prior.revision is distinct from expected_revision then raise exception 'Job changed. Refresh before updating.';end if;
 if prior.accepted_at is null and next_status is distinct from 'cancelled' then raise exception 'Runner must confirm acceptance before starting this job.';end if;
 allowed:=case prior.status when 'assigned' then case when prior.kind in ('carsome_pickup','carro_pickup') then 'collected' when prior.kind='send_invoice' then 'delivering' else 'car_out' end when 'car_out' then 'arrived' when 'arrived' then 'returning' when 'returning' then 'car_in' when 'collected' then 'car_in' when 'delivering' then 'completed' end;
 if next_status is null or (next_status is distinct from allowed and not(next_status='cancelled' and public.e2_ops_role() in ('admin','super_admin') and length(trim(coalesce(note,'')))>0)) then raise exception 'Invalid movement sequence; cancellation needs Admin and a reason.';end if;
 if length(coalesce(note,''))>1000 or mileage<0 or mileage<prior.last_mileage then raise exception 'Check mileage and notes.';end if;
 update public.e2_runner_jobs set status=next_status,last_mileage=coalesce(mileage,last_mileage),revision=revision+1,updated_at=now() where id=target returning * into result;
 insert into public.e2_ops_events(job_id,actor,action,detail) values(target,auth.uid(),next_status,jsonb_build_object('mileage',mileage,'note',coalesce(note,'')));
 return result;
end;$$;

create function public.e2_save_ops_claim(request_id uuid,expected_revision bigint,details jsonb)
 returns public.e2_ops_claims language plpgsql security definer set search_path='' as $$
declare prior public.e2_ops_claims; result public.e2_ops_claims; job public.e2_runner_jobs;
begin
 perform pg_advisory_xact_lock(20261021,4);
 if details is null or jsonb_typeof(details)<>'object' or octet_length(details::text)>6000 or exists(select 1 from jsonb_object_keys(details) k where k not in ('kind','job_id','inspection_id','supplier','invoice_no','expense_date','amount','description')) then raise exception 'Invalid expense details.';end if;
 if details->>'kind'='petrol' then
  select * into job from public.e2_runner_jobs where id=(details->>'job_id')::uuid for update;
  if not found or job.status='cancelled' or public.e2_ops_role() is distinct from 'runner' or job.assigned_to<>auth.uid() then raise exception 'Petrol claims must belong to your assigned job.';end if;
 elsif details->>'kind'='repair' then
  if coalesce(public.e2_ops_role(),'') not in ('inspector','admin','super_admin') then raise exception 'Inspector or Admin access required for repair bills.';end if;
 else raise exception 'Choose petrol or repair.';
 end if;
 select * into prior from public.e2_ops_claims where id=request_id for update;
 if found then
  if prior.created_by<>auth.uid() or not public.e2_ops_claim_read(prior.id) then raise exception 'This expense is not available to you.';end if;
  if prior.kind<>details->>'kind' or prior.job_id is distinct from nullif(details->>'job_id','')::uuid or prior.inspection_id is distinct from nullif(details->>'inspection_id','')::uuid then raise exception 'Expense ownership cannot change.';end if;
  if expected_revision is null then
   if prior.supplier=trim(details->>'supplier') and prior.invoice_no=trim(coalesce(details->>'invoice_no','')) and prior.expense_date=(details->>'expense_date')::date and prior.amount=(details->>'amount')::numeric and prior.description=coalesce(details->>'description','') then return prior;end if;
   raise exception 'Expense reference already used.';
  end if;
  if not public.e2_ops_claim_write(prior.id) or prior.revision<>expected_revision then raise exception 'Expense changed or submitted. Refresh before editing.';end if;
  update public.e2_ops_claims set supplier=trim(details->>'supplier'),invoice_no=trim(coalesce(details->>'invoice_no','')),expense_date=(details->>'expense_date')::date,
   amount=(details->>'amount')::numeric,description=coalesce(details->>'description',''),revision=revision+1,updated_at=now()
   where id=request_id returning * into result;
 else
  if expected_revision is not null then raise exception 'Expense not found.';end if;
  insert into public.e2_ops_claims(id,kind,job_id,inspection_id,supplier,invoice_no,expense_date,amount,description,created_by)
   values(request_id,details->>'kind',nullif(details->>'job_id','')::uuid,nullif(details->>'inspection_id','')::uuid,trim(details->>'supplier'),
   trim(coalesce(details->>'invoice_no','')),(details->>'expense_date')::date,(details->>'amount')::numeric,coalesce(details->>'description',''),auth.uid()) returning * into result;
 end if;
 if result.expense_date>(now() at time zone 'Asia/Kuala_Lumpur')::date then raise exception 'Expense date cannot be in the future.';end if;
 insert into public.e2_ops_events(claim_id,actor,action,detail) values(result.id,auth.uid(),'Expense saved',to_jsonb(result));
 return result;
end;$$;

create function public.e2_action_ops_claim(target uuid,expected_revision bigint,action text,note text,payment_date date,payment_reference text)
 returns public.e2_ops_claims language plpgsql security definer set search_path='' as $$
declare prior public.e2_ops_claims; result public.e2_ops_claims; next_state text;
begin
 select * into prior from public.e2_ops_claims where id=target for update;
 if not found or not public.e2_ops_claim_read(target) then raise exception 'Expense unavailable.';end if;
 if prior.revision is distinct from expected_revision then raise exception 'Expense changed. Refresh before continuing.';end if;
 if length(coalesce(note,''))>1000 then raise exception 'Review note is too long.';end if;
 if action='submit' and public.e2_ops_claim_write(target) then
  if not exists(select 1 from public.e2_ops_files where claim_id=target and state='ready' and kind=case prior.kind when 'repair' then 'invoice' else 'receipt' end) then raise exception 'Upload and archive the invoice or receipt first.';end if;
  next_state:='submitted';
 elsif action in ('approve','return') and prior.status='submitted' and public.e2_ops_role() in ('super_admin','admin') then
  if action='return' and length(trim(coalesce(note,'')))=0 then raise exception 'Explain what needs correcting.';end if;
  next_state:=case action when 'approve' then 'approved' else 'returned' end;
 elsif action='verify' and prior.status='approved' and public.e2_ops_role()='account' then next_state:='verified';
 elsif action='query' and prior.status in ('approved','verified') and public.e2_ops_role()='account' then
  if length(trim(coalesce(note,'')))=0 then raise exception 'Explain the payment query.';end if;
  next_state:='submitted';
 elsif action='paid' and prior.status='verified' and public.e2_ops_role()='account' then
  if payment_date is null or payment_date>(now() at time zone 'Asia/Kuala_Lumpur')::date or length(trim(coalesce(payment_reference,'')))=0 or length(payment_reference)>150 then raise exception 'Enter the actual payment date and reference.';end if;
  if not exists(select 1 from public.e2_ops_files where claim_id=target and kind='payment' and state='ready' and created_at>=prior.verified_at) then raise exception 'Upload payment evidence before recording Paid.';end if;
  next_state:='paid';
 else raise exception 'This action is not allowed for your role or the current status.';
 end if;
 update public.e2_ops_claims c set status=next_state,review_note=coalesce(note,''),
  approved_by=case when action='approve' then auth.uid() when action in ('submit','return','query') then null else c.approved_by end,
  approved_at=case when action='approve' then now() when action in ('submit','return','query') then null else c.approved_at end,
  verified_by=case when action='verify' then auth.uid() when action in ('submit','return','query') then null else c.verified_by end,
  verified_at=case when action='verify' then now() when action in ('submit','return','query') then null else c.verified_at end,
  paid_by=case when action='paid' then auth.uid() else c.paid_by end,paid_at=case when action='paid' then now() else c.paid_at end,
  payment_date=case when action='paid' then e2_action_ops_claim.payment_date else c.payment_date end,
  payment_reference=case when action='paid' then trim(e2_action_ops_claim.payment_reference) else c.payment_reference end,
  revision=c.revision+1,updated_at=now() where c.id=target returning * into result;
 insert into public.e2_ops_events(claim_id,actor,action,detail) values(target,auth.uid(),action,to_jsonb(result));
 return result;
end;$$;

create function public.e2_reserve_ops_file(request_id uuid,job_id uuid,claim_id uuid,file_kind text,file_name text,file_mime text,file_bytes bigint)
 returns public.e2_ops_files language plpgsql security definer set search_path='' as $$
declare result public.e2_ops_files; c public.e2_ops_claims;
begin
 if job_id is not null then
  perform 1 from public.e2_runner_jobs j where j.id=job_id for update;
  if claim_id is not null or not public.e2_ops_job_write(job_id) then raise exception 'Job upload unavailable.';end if;
 else
  select * into c from public.e2_ops_claims where id=claim_id for update;
  if not found then raise exception 'Expense unavailable.';end if;
  if file_kind='payment' then
   if public.e2_ops_role() is distinct from 'account' or c.status<>'verified' then raise exception 'Account verification is required first.';end if;
  elsif not public.e2_ops_claim_write(claim_id) or file_kind<>(case c.kind when 'repair' then 'invoice' else 'receipt' end) then
   raise exception 'Only the expense owner can upload the required evidence before submission.';
  end if;
 end if;
 select * into result from public.e2_ops_files where id=request_id;
 if found then
  if result.created_by<>auth.uid() or result.job_id is distinct from job_id or result.claim_id is distinct from claim_id or result.kind is distinct from file_kind or result.filename is distinct from file_name or result.mime_type is distinct from file_mime or result.byte_size is distinct from file_bytes then raise exception 'File reference already used.';end if;
  return result;
 end if;
 if (select count(*) from public.e2_ops_files f where (e2_reserve_ops_file.job_id is not null and f.job_id=e2_reserve_ops_file.job_id) or (e2_reserve_ops_file.claim_id is not null and f.claim_id=e2_reserve_ops_file.claim_id))>=50 then raise exception 'Maximum 50 files per job or expense.';end if;
 insert into public.e2_ops_files(id,job_id,claim_id,kind,filename,mime_type,byte_size,path,created_by)
  values(request_id,job_id,claim_id,file_kind,file_name,file_mime,file_bytes,coalesce(job_id,claim_id)::text||'/'||request_id::text,auth.uid()) returning * into result;
 return result;
end;$$;
create function public.e2_finish_ops_file(file_id uuid) returns public.e2_ops_files language plpgsql security definer set search_path='' as $$
declare f public.e2_ops_files; meta jsonb;
begin
 -- Take the same parent lock used by submit/move to serialize archiving.
 select * into f from public.e2_ops_files where id=file_id;
 if f.job_id is not null then perform 1 from public.e2_runner_jobs where id=f.job_id for update;
 else perform 1 from public.e2_ops_claims where id=f.claim_id for update;end if;
 select * into f from public.e2_ops_files where id=file_id for update;
 if not found or f.created_by<>auth.uid() or not public.e2_ops_file_read(f.path) then raise exception 'File unavailable.';end if;
 if f.state='ready' then return f;end if;
 if not public.e2_ops_file_write(f.path) then raise exception 'Upload is no longer allowed.';end if;
 select metadata into meta from storage.objects where bucket_id='operations-files' and name=f.path;
 if meta is null or (meta->>'size')::bigint is distinct from f.byte_size or meta->>'mimetype' is distinct from f.mime_type then raise exception 'Upload incomplete or file metadata mismatch.';end if;
 update public.e2_ops_files set state='ready' where id=file_id returning * into f;
 insert into public.e2_ops_events(job_id,claim_id,actor,action,detail) values(f.job_id,f.claim_id,auth.uid(),'File archived',jsonb_build_object('file_id',f.id,'kind',f.kind,'filename',f.filename));
 return f;
end;$$;

create function public.e2_operations_workspace() returns jsonb language plpgsql stable security definer set search_path='' as $$
declare actor_role text:=public.e2_ops_role();
begin
 if coalesce(actor_role,'') not in ('super_admin','admin','runner','inspector','account') then raise exception 'Active operations access required.';end if;
 return jsonb_build_object('role',actor_role,'user_id',auth.uid(),
 'locations',coalesce((select jsonb_agg(place order by place) from (select distinct on (lower(place)) place from (select trim(j.origin) place from public.e2_runner_jobs j union all select trim(j.destination) from public.e2_runner_jobs j union all select trim(e.detail->>'origin') from public.e2_ops_events e where e.action='Job saved' union all select trim(e.detail->>'destination') from public.e2_ops_events e where e.action='Job saved') saved where actor_role in ('super_admin','admin') and coalesce(place,'')<>'' order by lower(place),place) names),'[]'::jsonb),
 'vehicles',coalesce((select jsonb_agg(jsonb_build_object('id',v.id,'plate',v.plate,'label',concat_ws(' ',v.brand,v.model))) from public.vehicles v where actor_role in ('super_admin','admin')),'[]'::jsonb),
 'runners',coalesce((select jsonb_agg(jsonb_build_object('id',m.user_id,'name',coalesce(nullif(p.display_name,''),u.email,'Runner'))) from public.staff_memberships m join auth.users u on u.id=m.user_id left join public.staff_profiles p on p.user_id=m.user_id where m.active and m.role='runner' and actor_role in ('super_admin','admin')),'[]'::jsonb),
 'inspections',coalesce((select jsonb_agg(jsonb_build_object('id',i.id,'plate',v.plate,'workshop',i.workshop,'status',i.status)) from public.e2_vehicle_inspections i join public.vehicles v on v.id=i.vehicle_id where actor_role in ('super_admin','admin','inspector')),'[]'::jsonb),
 'jobs',coalesce((select jsonb_agg(to_jsonb(j)||jsonb_build_object('plate',v.plate,'vehicle_label',concat_ws(' ',v.brand,v.model),'runner_name',coalesce(nullif(p.display_name,''),'Runner')) order by j.updated_at desc) from public.e2_runner_jobs j join public.vehicles v on v.id=j.vehicle_id left join public.staff_profiles p on p.user_id=j.assigned_to where public.e2_ops_job_read(j.id)),'[]'::jsonb),
 'claims',coalesce((select jsonb_agg(to_jsonb(c)||jsonb_build_object('plate',v.plate,'submitted_name',coalesce(nullif(p.display_name,''),'E2 staff')) order by c.updated_at desc) from public.e2_ops_claims c left join public.e2_runner_jobs j on j.id=c.job_id left join public.e2_vehicle_inspections i on i.id=c.inspection_id join public.vehicles v on v.id=coalesce(j.vehicle_id,i.vehicle_id) left join public.staff_profiles p on p.user_id=c.created_by where public.e2_ops_claim_read(c.id)),'[]'::jsonb),
 'files',coalesce((select jsonb_agg(to_jsonb(f) order by f.created_at desc) from public.e2_ops_files f where public.e2_ops_file_read(f.path)),'[]'::jsonb),
 'events',coalesce((select jsonb_agg(to_jsonb(e)||jsonb_build_object('actor_name',coalesce(nullif(p.display_name,''),'Staff '||left(e.actor::text,8))) order by e.created_at desc) from public.e2_ops_events e left join public.staff_profiles p on p.user_id=e.actor where public.e2_ops_job_read(e.job_id) or public.e2_ops_claim_read(e.claim_id)),'[]'::jsonb));
end;$$;

revoke all on function public.e2_ops_role(),public.e2_ops_job_read(uuid),public.e2_ops_job_write(uuid),public.e2_ops_claim_read(uuid),public.e2_ops_claim_write(uuid),public.e2_ops_file_read(text),public.e2_ops_file_write(text),public.e2_save_runner_job(uuid,bigint,jsonb),public.e2_move_runner_job(uuid,bigint,text,integer,text),public.e2_save_ops_claim(uuid,bigint,jsonb),public.e2_action_ops_claim(uuid,bigint,text,text,date,text),public.e2_reserve_ops_file(uuid,uuid,uuid,text,text,text,bigint),public.e2_finish_ops_file(uuid),public.e2_operations_workspace() from public,anon,authenticated;
grant execute on function public.e2_ops_role(),public.e2_ops_job_read(uuid),public.e2_ops_job_write(uuid),public.e2_ops_claim_read(uuid),public.e2_ops_claim_write(uuid),public.e2_ops_file_read(text),public.e2_ops_file_write(text),public.e2_save_runner_job(uuid,bigint,jsonb),public.e2_move_runner_job(uuid,bigint,text,integer,text),public.e2_save_ops_claim(uuid,bigint,jsonb),public.e2_action_ops_claim(uuid,bigint,text,text,date,text),public.e2_reserve_ops_file(uuid,uuid,uuid,text,text,text,bigint),public.e2_finish_ops_file(uuid),public.e2_operations_workspace() to authenticated;
create or replace function public.e2_update_staff(target_user uuid,new_role text,new_active boolean,expected_revision bigint) returns void
language plpgsql security definer set search_path='' as $$
declare prior public.staff_memberships;
begin
  -- Serialize role changes and recheck the caller after acquiring the lock.
  perform pg_advisory_xact_lock(20260913,4);
  if not public.e2_is_super_admin() then raise exception 'Super Admin access required'; end if;
  if new_role is null or new_role not in ('super_admin','admin','office_admin','inspector','runner','sales','account','customer') or new_active is null then raise exception 'Choose a valid role and status'; end if;
  select * into prior from public.staff_memberships where user_id=target_user for update;
  if not found then raise exception 'User not found'; end if;
  if expected_revision is distinct from prior.revision then raise exception 'Permissions changed in another session. Refresh before saving.'; end if;
  if prior.role='super_admin' and prior.active and (new_role<>'super_admin' or not new_active)
    and (select count(*) from public.staff_memberships where role='super_admin' and active)=1 then
    raise exception 'Keep at least one active Super Admin';
  end if;
  if target_user=auth.uid() then raise exception 'Another Super Admin must change your own access'; end if;
  update public.staff_memberships set role=new_role,active=new_active,revision=revision+1 where user_id=target_user;
  insert into public.staff_access_audit(actor,target_user,action,previous_role,next_role,previous_active,next_active)
    values(auth.uid(),target_user,'UPDATE_ACCESS',prior.role,new_role,prior.active,new_active);
end;
$$;

create or replace function public.e2_add_staff_by_email(target_email text,new_role text) returns uuid
language plpgsql security definer set search_path='' as $$
declare target uuid;
begin
  perform pg_advisory_xact_lock(20260913,4);
  if not public.e2_is_super_admin() then raise exception 'Super Admin access required'; end if;
  if new_role is null or new_role not in ('super_admin','admin','office_admin','inspector','runner','sales','account','customer') then raise exception 'Choose a valid role'; end if;
  select id into target from auth.users where lower(email)=lower(trim(target_email));
  if target is null then raise exception 'Create or invite this Auth account first'; end if;
  if exists(select 1 from public.staff_memberships where user_id=target) then raise exception 'This account is already listed. Edit its existing permissions.'; end if;
  insert into public.staff_memberships(user_id,role,active) values(target,new_role,true);
  insert into public.staff_access_audit(actor,target_user,action,next_role,next_active) values(auth.uid(),target,'ADD_USER',new_role,true);
  return target;
end;
$$;


commit;
