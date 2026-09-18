begin;

-- Existing records remain uploaded photos, in their original order.
alter table public.vehicle_photos add column source text not null default 'upload'
  check (source in ('upload','drive'));
create table public.vehicle_drive_photos (
  photo_id uuid primary key references public.vehicle_photos(id) on delete cascade deferrable initially deferred,
  vehicle_id uuid not null references public.vehicles(id),
  folder_id text not null check (folder_id ~ '^[A-Za-z0-9_-]{10,200}$'),
  file_id text not null check (file_id ~ '^[A-Za-z0-9_-]{10,200}$'),
  checksum text not null check (checksum ~ '^[a-f0-9]{32}$'),
  mime_type text not null check (mime_type in ('image/jpeg','image/png','image/webp')),
  size_bytes bigint not null check (size_bytes between 1 and 20971520),
  unique (vehicle_id,file_id),
  unique (vehicle_id,checksum)
);
alter table public.vehicle_drive_photos enable row level security;
revoke all on public.vehicle_drive_photos from public,anon,authenticated;
grant all on public.vehicle_drive_photos to service_role;

create or replace function public.e2_validate_photo() returns trigger
language plpgsql security definer set search_path='' as $$
declare state text;
begin
  select publication into state from public.vehicles
    where id=coalesce(new.vehicle_id,old.vehicle_id) for update;
  if state is distinct from 'draft' then raise exception 'Move vehicle to draft before changing photos'; end if;
  if tg_op='INSERT' then
    if split_part(new.path,'/',1)<>new.vehicle_id::text then raise exception 'Invalid photo path'; end if;
    if new.source='upload' and not exists
      (select 1 from storage.objects where bucket_id='vehicle-photos' and name=new.path)
      then raise exception 'Upload the photo before attaching it to this vehicle'; end if;
    if new.source='drive' and (new.path<>new.vehicle_id::text||'/'||new.id::text||'.drive' or not exists
      (select 1 from public.vehicle_drive_photos where photo_id=new.id and vehicle_id=new.vehicle_id))
      then raise exception 'Use the Google Drive photo service'; end if;
    if (select count(*) from public.vehicle_photos where vehicle_id=new.vehicle_id)>=30
      then raise exception 'Maximum 30 photos per vehicle'; end if;
    return new;
  end if;
  return old;
end;
$$;

create or replace function public.e2_validate_vehicle() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  if tg_op='UPDATE' then
    if new.id<>old.id or new.created_at<>old.created_at then raise exception 'Vehicle identity cannot change'; end if;
    if old.publication='published' and
      (to_jsonb(new)-'publication'-'updated_at')<>(to_jsonb(old)-'publication'-'updated_at')
      then raise exception 'Move vehicle to draft before editing'; end if;
  end if;
  if new.publication='published' and not exists (
    select 1 from public.vehicle_photos p where p.vehicle_id=new.id and (
      (p.source='upload' and exists(select 1 from storage.objects o where o.bucket_id='vehicle-photos' and o.name=p.path))
      or (p.source='drive' and exists(select 1 from public.vehicle_drive_photos d where d.photo_id=p.id))))
    then raise exception 'Add at least one real vehicle photo before publishing'; end if;
  new.updated_at=clock_timestamp();
  return new;
end;
$$;

-- Only the Edge service can attach files after checking Google access, the root folder,
-- exact plate and the selected file checksums. Recheck actor and draft under a lock.
create function public.e2_attach_drive_photos(actor_id uuid,target_vehicle uuid,expected_plate text,items jsonb)
returns integer language plpgsql security definer set search_path='' as $$
declare state text; plate_now text; item jsonb; photo uuid; pos integer; added integer:=0; old_checksum text;
begin
  if not exists(select 1 from public.staff_memberships where user_id=actor_id and active and role in ('super_admin','admin'))
    then raise exception 'Admin access required'; end if;
  select publication,plate into state,plate_now from public.vehicles where id=target_vehicle for update;
  if state is distinct from 'draft' then raise exception 'Move vehicle to draft before adding photos'; end if;
  if plate_now is distinct from expected_plate then raise exception 'Vehicle details changed. Reload the folder.'; end if;
  if jsonb_typeof(items) is distinct from 'array' or jsonb_array_length(items) not between 1 and 30
    then raise exception 'Select between 1 and 30 photos'; end if;
  for item in select value from jsonb_array_elements(items) loop
    select checksum into old_checksum from public.vehicle_drive_photos
      where vehicle_id=target_vehicle and file_id=item->>'file_id';
    if found then
      if old_checksum is distinct from item->>'checksum' then raise exception 'A linked file changed. Remove its old link before adding it again.'; end if;
      continue;
    end if;
    if exists(select 1 from public.vehicle_drive_photos where vehicle_id=target_vehicle and checksum=item->>'checksum') then continue; end if;
    select n into pos from generate_series(0,29) n where not exists
      (select 1 from public.vehicle_photos where vehicle_id=target_vehicle and position=n) order by n limit 1;
    if pos is null then raise exception 'Maximum 30 photos per vehicle'; end if;
    photo:=gen_random_uuid();
    insert into public.vehicle_drive_photos(photo_id,vehicle_id,folder_id,file_id,checksum,mime_type,size_bytes)
      values(photo,target_vehicle,item->>'folder_id',item->>'file_id',item->>'checksum',item->>'mime_type',(item->>'size_bytes')::bigint);
    insert into public.vehicle_photos(id,vehicle_id,path,position,source)
      values(photo,target_vehicle,target_vehicle::text||'/'||photo::text||'.drive',pos,'drive');
    insert into public.inventory_audit(actor,entity,action,row_id) values(actor_id,'vehicle_photos','LINK_DRIVE',photo);
    added:=added+1;
  end loop;
  return added;
end;
$$;
revoke all on function public.e2_attach_drive_photos(uuid,uuid,text,jsonb) from public,anon,authenticated;
grant execute on function public.e2_attach_drive_photos(uuid,uuid,text,jsonb) to service_role;
commit;
