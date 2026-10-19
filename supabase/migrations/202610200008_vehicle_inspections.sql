begin;
alter table public.staff_memberships drop constraint staff_memberships_role_check, add constraint staff_memberships_role_check check(role in ('super_admin','admin','office_admin','inspector','sales','account','customer'));


create or replace function public.e2_update_staff(target_user uuid,new_role text,new_active boolean,expected_revision bigint) returns void
language plpgsql security definer set search_path='' as $$
declare prior public.staff_memberships;
begin
  -- Serialize role changes and recheck the caller after acquiring the lock.
  perform pg_advisory_xact_lock(20260913,4);
  if not public.e2_is_super_admin() then raise exception 'Super Admin access required'; end if;
  if new_role is null or new_role not in ('super_admin','admin','office_admin','inspector','sales','account','customer') or new_active is null then raise exception 'Choose a valid role and status'; end if;
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
  if new_role is null or new_role not in ('super_admin','admin','office_admin','inspector','sales','account','customer') then raise exception 'Choose a valid role'; end if;
  select id into target from auth.users where lower(email)=lower(trim(target_email));
  if target is null then raise exception 'Create or invite this Auth account first'; end if;
  if exists(select 1 from public.staff_memberships where user_id=target) then raise exception 'This account is already listed. Edit its existing permissions.'; end if;
  insert into public.staff_memberships(user_id,role,active) values(target,new_role,true);
  insert into public.staff_access_audit(actor,target_user,action,next_role,next_active) values(auth.uid(),target,'ADD_USER',new_role,true);
  return target;
end;
$$;

-- Inspector work is internal; it never changes publication, sales, or customer data.
create or replace function public.e2_can_read_stock() returns boolean
language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.staff_memberships where user_id=auth.uid() and active and role in ('super_admin','admin','sales','inspector'));
$$;
create function public.e2_can_inspect() returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.staff_memberships where user_id=auth.uid() and active and role in ('super_admin','admin','inspector'));
$$;
create table public.e2_vehicle_inspections (
 id uuid primary key,
 vehicle_id uuid not null references public.vehicles(id),
 assigned_to uuid not null references public.staff_memberships(user_id),
 status text not null default 'Pending inspection' check(status in ('Pending inspection','Inspecting','Repair required','Repair booked','In repair','Ready','Cancelled')),
 checklist jsonb not null default '{"engine":"unchecked","transmission":"unchecked","brakes":"unchecked","tyres":"unchecked","body":"unchecked","electrical":"unchecked","road_test":"unchecked"}',
 findings text not null default '' check(length(findings)<=4000),
 workshop text not null default '' check(length(workshop)<=200),
 repair_date date,
 repair_time time,
 repair_notes text not null default '' check(length(repair_notes)<=4000),
 completion_notes text not null default '' check(length(completion_notes)<=2000),
 created_by uuid not null references public.staff_memberships(user_id),
 revision bigint not null default 1,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 closed_at timestamptz,
 check(repair_time is null or repair_date is not null)
);
create unique index inspection_one_open_per_vehicle on public.e2_vehicle_inspections(vehicle_id) where status not in ('Ready','Cancelled');
create index inspection_work_queue on public.e2_vehicle_inspections(status,repair_date);
create table public.e2_vehicle_inspection_events (
 id uuid primary key default gen_random_uuid(),
 inspection_id uuid not null references public.e2_vehicle_inspections(id),
 actor uuid not null references public.staff_memberships(user_id),
 action text not null,
 snapshot jsonb not null,
 created_at timestamptz not null default now()
);
alter table public.e2_vehicle_inspections enable row level security;
alter table public.e2_vehicle_inspection_events enable row level security;
revoke all on public.e2_vehicle_inspections,public.e2_vehicle_inspection_events from public,anon,authenticated;
grant select on public.e2_vehicle_inspections,public.e2_vehicle_inspection_events to authenticated;
grant all on public.e2_vehicle_inspections,public.e2_vehicle_inspection_events to service_role;
create policy inspection_staff_read on public.e2_vehicle_inspections for select to authenticated using(public.e2_can_inspect());
create policy inspection_history_read on public.e2_vehicle_inspection_events for select to authenticated using(public.e2_can_inspect());

create function public.e2_inspection_workspace() returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
 if not public.e2_can_inspect() then raise exception 'Active Inspector or Admin access required.';end if;
 return jsonb_build_object(
 'staff',coalesce((select jsonb_agg(jsonb_build_object('id',m.user_id,'name',coalesce(nullif(p.display_name,''),'E2 staff'),'role',m.role) order by p.display_name,m.user_id) from public.staff_memberships m left join public.staff_profiles p on p.user_id=m.user_id where m.active and m.role in ('inspector','admin','super_admin')),'[]'::jsonb),
 'vehicles',coalesce((select jsonb_agg(jsonb_build_object('id',v.id,'plate',v.plate,'label',concat_ws(' ',v.brand,v.model,v.variant),'year',v.year,'stock_status',v.stock_status) order by v.plate) from public.vehicles v),'[]'::jsonb),
 'jobs',coalesce((select jsonb_agg(to_jsonb(i) order by i.updated_at desc,i.id) from public.e2_vehicle_inspections i),'[]'::jsonb));
end;$$;

create function public.e2_start_inspection(request_id uuid,car uuid,assignee uuid) returns public.e2_vehicle_inspections language plpgsql security definer set search_path='' as $$
declare result public.e2_vehicle_inspections;
begin
 perform pg_advisory_xact_lock(20261020,8);
 if not public.e2_can_inspect() then raise exception 'Active Inspector or Admin access required.';end if;
 if request_id is null or car is null or assignee is null then raise exception 'Choose a vehicle and responsible staff member.';end if;
 select * into result from public.e2_vehicle_inspections where id=request_id;
 if found then
  if result.vehicle_id<>car or result.assigned_to<>assignee or result.created_by<>auth.uid() then raise exception 'Request reference already used.';end if;
  return result;
 end if;
 if not exists(select 1 from public.vehicles where id=car) then raise exception 'Vehicle not found.';end if;
 if not exists(select 1 from public.staff_memberships where user_id=assignee and active and role in ('inspector','admin','super_admin')) then raise exception 'Choose an active Inspector or Admin.';end if;
 if exists(select 1 from public.e2_vehicle_inspections where vehicle_id=car and status not in ('Ready','Cancelled')) then raise exception 'This vehicle already has an open inspection. Open that record instead.';end if;
 insert into public.e2_vehicle_inspections(id,vehicle_id,assigned_to,created_by) values(request_id,car,assignee,auth.uid()) returning * into result;
 insert into public.e2_vehicle_inspection_events(inspection_id,actor,action,snapshot) values(request_id,auth.uid(),'Created',to_jsonb(result));
 return result;
end;$$;

create function public.e2_save_inspection(target uuid,expected_revision bigint,changes jsonb) returns public.e2_vehicle_inspections language plpgsql security definer set search_path='' as $$
declare prior public.e2_vehicle_inspections; result public.e2_vehicle_inspections; next_state text; checks jsonb; person uuid;
begin
 perform pg_advisory_xact_lock(20261020,8);
 if not public.e2_can_inspect() then raise exception 'Active Inspector or Admin access required.';end if;
 select * into prior from public.e2_vehicle_inspections where id=target for update;
 if not found then raise exception 'Inspection not found.';end if;
 if expected_revision is distinct from prior.revision then raise exception 'This inspection changed. Close and refresh before saving.';end if;
 if prior.status in ('Ready','Cancelled') then raise exception 'Closed inspections are kept as history. Start a new inspection.';end if;
 if changes is null or jsonb_typeof(changes)<>'object' or octet_length(changes::text)>15000 then raise exception 'Invalid inspection details.';end if;
 if exists(select 1 from jsonb_object_keys(changes) k where k not in ('assigned_to','status','checklist','findings','workshop','repair_date','repair_time','repair_notes','completion_notes')) then raise exception 'Unsupported inspection field.';end if;
 next_state:=changes->>'status';checks:=changes->'checklist';person:=(changes->>'assigned_to')::uuid;
 if next_state is null or next_state not in ('Pending inspection','Inspecting','Repair required','Repair booked','In repair','Ready','Cancelled') then raise exception 'Choose an inspection status.';end if;
 if person is distinct from prior.assigned_to or next_state not in ('Ready','Cancelled') then
  if not exists(select 1 from public.staff_memberships where user_id=person and active and role in ('inspector','admin','super_admin')) then raise exception 'Choose an active Inspector or Admin.';end if;
 end if;
 if checks is null or jsonb_typeof(checks)<>'object' then raise exception 'Complete the inspection checklist.';end if;
 if (select count(*) from jsonb_object_keys(checks))<>7 or not checks ?& array['engine','transmission','brakes','tyres','body','electrical','road_test'] then raise exception 'Complete the inspection checklist.';end if;
 if exists(select 1 from jsonb_each(checks) p where jsonb_typeof(p.value)<>'string' or p.value#>>'{}' not in ('unchecked','pass','attention','not_applicable')) then raise exception 'Choose a valid checklist result.';end if;
 if next_state in ('Repair required','Repair booked','In repair') and length(trim(coalesce(changes->>'findings','')))=0 then raise exception 'Describe the issues requiring repair.';end if;
 if next_state in ('Repair booked','In repair') and (length(trim(coalesce(changes->>'workshop','')))=0 or nullif(changes->>'repair_date','') is null) then raise exception 'Enter the workshop and repair date.';end if;
 if next_state='Ready' and (exists(select 1 from jsonb_each_text(checks) p where p.value in ('unchecked','attention')) or length(trim(coalesce(changes->>'completion_notes','')))=0) then raise exception 'Resolve checklist issues and record the final check before marking Ready.';end if;
 if next_state='Cancelled' and length(trim(coalesce(changes->>'completion_notes','')))=0 then raise exception 'Record the reason for cancellation.';end if;
 update public.e2_vehicle_inspections set assigned_to=person,status=next_state,checklist=checks,
 findings=trim(coalesce(changes->>'findings','')),workshop=trim(coalesce(changes->>'workshop','')),
 repair_date=nullif(changes->>'repair_date','')::date,repair_time=nullif(changes->>'repair_time','')::time,
 repair_notes=trim(coalesce(changes->>'repair_notes','')),completion_notes=trim(coalesce(changes->>'completion_notes','')),
 revision=revision+1,updated_at=now(),closed_at=case when next_state in ('Ready','Cancelled') then now() end
 where id=target returning * into result;
 insert into public.e2_vehicle_inspection_events(inspection_id,actor,action,snapshot) values(target,auth.uid(),next_state,to_jsonb(result));
 return result;
end;$$;
revoke all on function public.e2_can_inspect(),public.e2_inspection_workspace(),public.e2_start_inspection(uuid,uuid,uuid),public.e2_save_inspection(uuid,bigint,jsonb) from public,anon,authenticated;
grant execute on function public.e2_can_inspect(),public.e2_inspection_workspace(),public.e2_start_inspection(uuid,uuid,uuid),public.e2_save_inspection(uuid,bigint,jsonb) to authenticated;
commit;

