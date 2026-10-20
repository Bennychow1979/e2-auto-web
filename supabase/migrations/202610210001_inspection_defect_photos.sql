begin;
alter table public.e2_vehicle_inspections alter column checklist set default '{"engine":"unchecked","transmission":"unchecked","brakes":"unchecked","tyres":"unchecked","body":"unchecked","electrical":"unchecked","road_test":"unchecked","windscreen":"unchecked","cushion":"unchecked"}';
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
 if next_state is null or next_state not in ('Pending inspection','Inspecting','Repair required','Repair booked','In repair','Ready','Cancelled') then raise exception 'Choose an inspection status.';end if;
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
-- Private evidence belongs to an inspection; it is never a public vehicle photo.
create table public.e2_inspection_photos (
 id uuid primary key,
 inspection_id uuid not null references public.e2_vehicle_inspections(id),
 category text not null check(category in ('engine','transmission','brakes','tyres','body','electrical','road_test','windscreen','cushion','other')),
 caption text not null default '' check(length(caption)<=500),
 filename text not null check(length(filename) between 1 and 160),
 mime_type text not null check(mime_type in ('image/jpeg','image/png','image/webp')),
 byte_size bigint not null check(byte_size between 1 and 10485760),
 path text not null unique,
 state text not null default 'uploading' check(state in ('uploading','ready')),
 created_by uuid not null references public.staff_memberships(user_id),
 created_at timestamptz not null default now()
);
alter table public.e2_inspection_photos enable row level security;
revoke all on public.e2_inspection_photos from public,anon,authenticated;
grant select on public.e2_inspection_photos to authenticated;
grant all on public.e2_inspection_photos to service_role;
create policy inspection_photo_read on public.e2_inspection_photos for select to authenticated using(public.e2_can_inspect());
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
 values('inspection-defects','inspection-defects',false,10485760,array['image/jpeg','image/png','image/webp']);

create function public.e2_reserve_inspection_photo(request_id uuid,target uuid,photo_category text,photo_caption text,file_name text,file_mime text,file_bytes bigint)
 returns public.e2_inspection_photos language plpgsql security definer set search_path='' as $$
declare job public.e2_vehicle_inspections; photo public.e2_inspection_photos;
begin
 if not public.e2_can_inspect() then raise exception 'Active Inspector or Admin access required.';end if;
 select * into job from public.e2_vehicle_inspections where id=target for update;
 if not found or job.status in ('Ready','Cancelled') then raise exception 'Choose an open inspection.';end if;
 if request_id is null or photo_category is null or file_name is null or file_mime is null or file_bytes is null then raise exception 'Complete the photo details.';end if;
 select * into photo from public.e2_inspection_photos where id=request_id;
 if found then
  if photo.inspection_id<>target or photo.created_by<>auth.uid() or photo.category<>photo_category or photo.caption<>coalesce(photo_caption,'') or photo.filename<>file_name or photo.mime_type<>file_mime or photo.byte_size<>file_bytes then raise exception 'Photo reference already used.';end if;
  return photo;
 end if;
 if (select count(*) from public.e2_inspection_photos where inspection_id=target)>=30 then raise exception 'Maximum 30 photos per inspection.';end if;
 insert into public.e2_inspection_photos(id,inspection_id,category,caption,filename,mime_type,byte_size,path,created_by)
 values(request_id,target,photo_category,coalesce(photo_caption,''),file_name,file_mime,file_bytes,target::text||'/'||request_id::text,auth.uid()) returning * into photo;
 return photo;
end;$$;

create function public.e2_inspection_photo_upload_allowed(object_name text) returns boolean language sql stable security definer set search_path='' as $$
 select public.e2_can_inspect() and exists(select 1 from public.e2_inspection_photos p join public.e2_vehicle_inspections i on i.id=p.inspection_id where p.path=object_name and p.state='uploading' and p.created_by=auth.uid() and i.status not in ('Ready','Cancelled'));
$$;
create function public.e2_inspection_photo_read_allowed(object_name text) returns boolean language sql stable security definer set search_path='' as $$
 select public.e2_can_inspect() and exists(select 1 from public.e2_inspection_photos where path=object_name and (state='ready' or created_by=auth.uid()));
$$;
create policy inspection_defect_insert on storage.objects for insert to authenticated
 with check(bucket_id='inspection-defects' and public.e2_inspection_photo_upload_allowed(name));
create policy inspection_defect_read on storage.objects for select to authenticated
 using(bucket_id='inspection-defects' and public.e2_inspection_photo_read_allowed(name));
-- No update/delete grants: archived evidence cannot be silently replaced.
create function public.e2_finish_inspection_photo(photo_id uuid) returns public.e2_inspection_photos language plpgsql security definer set search_path='' as $$
declare photo public.e2_inspection_photos; meta jsonb; target uuid; job public.e2_vehicle_inspections;
begin
 if not public.e2_can_inspect() then raise exception 'Active Inspector or Admin access required.';end if;
 select inspection_id into target from public.e2_inspection_photos where id=photo_id;
 select * into job from public.e2_vehicle_inspections where id=target for update;
 select * into photo from public.e2_inspection_photos where id=photo_id for update;
 if not found or photo.created_by<>auth.uid() then raise exception 'Photo upload unavailable.';end if;
 if photo.state='ready' then return photo;end if;
 if job.status in ('Ready','Cancelled') then raise exception 'Inspection is closed; photo has not been archived.';end if;
 select metadata into meta from storage.objects where bucket_id='inspection-defects' and name=photo.path;
 if meta is null or (meta->>'size')::bigint is distinct from photo.byte_size or meta->>'mimetype' is distinct from photo.mime_type then raise exception 'Photo upload incomplete or metadata mismatch.';end if;
 update public.e2_inspection_photos set state='ready' where id=photo_id returning * into photo;
 insert into public.e2_vehicle_inspection_events(inspection_id,actor,action,snapshot) values(photo.inspection_id,auth.uid(),'Defect photo archived',jsonb_build_object('photo_id',photo.id,'category',photo.category,'findings',photo.caption));
 return photo;
end;$$;
revoke all on function public.e2_reserve_inspection_photo(uuid,uuid,text,text,text,text,bigint),public.e2_finish_inspection_photo(uuid),public.e2_inspection_photo_upload_allowed(text),public.e2_inspection_photo_read_allowed(text) from public,anon,authenticated;
grant execute on function public.e2_reserve_inspection_photo(uuid,uuid,text,text,text,text,bigint),public.e2_finish_inspection_photo(uuid),public.e2_inspection_photo_upload_allowed(text),public.e2_inspection_photo_read_allowed(text) to authenticated;
commit;
