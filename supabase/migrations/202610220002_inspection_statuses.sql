begin;
-- Preserve prior values in immutable history before consolidating active statuses.
insert into public.e2_vehicle_inspection_events(inspection_id,actor,action,snapshot)
 select id,created_by,'Status consolidation: previous record',to_jsonb(i) from public.e2_vehicle_inspections i where status in ('Inspecting','Repair required','Repair booked');
update public.e2_vehicle_inspections set status=case when status='Inspecting' then 'Pending inspection' else 'In repair' end,revision=revision+1,updated_at=now() where status in ('Inspecting','Repair required','Repair booked');
alter table public.e2_vehicle_inspections drop constraint e2_vehicle_inspections_status_check,
 add constraint e2_vehicle_inspections_status_check check(status in ('Pending inspection','In repair','Ready','Cancelled'));
-- Cancelled is read-only historical compatibility; the save RPC accepts only the three current choices.
create or replace function public.e2_save_inspection(target uuid,expected_revision bigint,changes jsonb) returns public.e2_vehicle_inspections language plpgsql security definer set search_path='' as $$
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
 if next_state is null or next_state not in ('Pending inspection','In repair','Ready') then raise exception 'Choose an inspection status.';end if;
 if person is distinct from prior.assigned_to or next_state not in ('Ready','Cancelled') then
  if not exists(select 1 from public.staff_memberships where user_id=person and active and role in ('inspector','admin','super_admin')) then raise exception 'Choose an active Inspector or Admin.';end if;
 end if;
 if checks is null or jsonb_typeof(checks)<>'object' then raise exception 'Complete the inspection checklist.';end if;
 -- A pre-release tab can still save its seven checks. Preserve newly recorded
 -- results; missing new checks remain unchecked and cannot be marked Ready.
 if (select count(*) from jsonb_object_keys(checks))=7 and checks ?& array['engine','transmission','brakes','tyres','body','electrical','road_test'] then
  checks:=checks||jsonb_build_object('windscreen',coalesce(prior.checklist->>'windscreen','unchecked'),'cushion',coalesce(prior.checklist->>'cushion','unchecked'));
 end if;
 if (select count(*) from jsonb_object_keys(checks))<>9 or not checks ?& array['cushion','windscreen','engine','transmission','brakes','tyres','body','electrical','road_test'] then raise exception 'Complete the inspection checklist.';end if;
 if exists(select 1 from jsonb_each(checks) p where jsonb_typeof(p.value)<>'string' or p.value#>>'{}' not in ('unchecked','pass','attention','not_applicable')) then raise exception 'Choose a valid checklist result.';end if;
 if next_state in ('Repair required','Repair booked','In repair') and length(trim(coalesce(changes->>'findings','')))=0 then raise exception 'Describe the issues requiring repair.';end if;
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

do $$declare src text;begin
 src:=pg_get_functiondef('public.e2_inspection_workspace()'::regprocedure);
 if position('''stock_status'',v.stock_status' in src)=0 then raise exception 'Inspection workspace changed'; end if;
 src:=replace(src,'''stock_status'',v.stock_status','''stock_status'',v.stock_status,''lifecycle_state'',v.lifecycle_state');
 src:=replace(src,'from public.vehicles v)','from public.vehicles v where v.lifecycle_state in (''active'',''archived''))');execute src;
end$$;
commit;
