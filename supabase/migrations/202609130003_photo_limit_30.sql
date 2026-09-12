begin;

alter table public.vehicle_photos
  drop constraint vehicle_photos_position_check,
  add constraint vehicle_photos_position_check check (position between 0 and 29);

create or replace function public.e2_validate_photo() returns trigger
language plpgsql security definer set search_path = '' as $$
declare state text;
begin
  -- Lock the parent to serialize uploads/removal with publication.
  select publication into state from public.vehicles
    where id = coalesce(new.vehicle_id, old.vehicle_id) for update;
  if state is distinct from 'draft' then raise exception 'Move vehicle to draft before changing photos'; end if;
  if tg_op = 'INSERT' then
    if split_part(new.path,'/',1) <> new.vehicle_id::text or not exists
      (select 1 from storage.objects where bucket_id = 'vehicle-photos' and name = new.path)
      then raise exception 'Upload the photo before attaching it to this vehicle'; end if;
    if (select count(*) from public.vehicle_photos where vehicle_id = new.vehicle_id) >= 30
      then raise exception 'Maximum 30 photos per vehicle'; end if;
    return new;
  end if;
  return old;
end;
$$;
revoke all on function public.e2_validate_photo() from public;

commit;
