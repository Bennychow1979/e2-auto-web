begin;

create table public.staff_memberships (
  user_id uuid primary key references auth.users(id) on delete cascade,
  role text not null check (role in ('admin','sales','account')),
  active boolean not null default true
);
alter table public.staff_memberships enable row level security;
create policy own_membership on public.staff_memberships for select to authenticated
  using (user_id = (select auth.uid()));
revoke all on public.staff_memberships from anon, authenticated;
grant select on public.staff_memberships to authenticated;

create function public.e2_is_admin() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists(select 1 from public.staff_memberships
    where user_id = (select auth.uid()) and role = 'admin' and active);
$$;
create function public.e2_can_read_stock() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists(select 1 from public.staff_memberships
    where user_id = (select auth.uid()) and role in ('admin','sales') and active);
$$;
revoke all on function public.e2_is_admin(), public.e2_can_read_stock() from public;
grant execute on function public.e2_is_admin(), public.e2_can_read_stock() to anon, authenticated;

create table public.vehicles (
  id uuid primary key default gen_random_uuid(),
  plate text not null unique check (plate ~ '^[A-Z0-9-]{1,20}$'),
  brand text not null check (length(trim(brand)) between 1 and 80),
  model text not null check (length(trim(model)) between 1 and 100),
  variant text not null check (length(trim(variant)) between 1 and 120),
  year integer not null check (year between 1900 and 2100),
  engine_litres numeric(3,1) not null check (engine_litres between 0 and 20),
  transmission text not null check (transmission in ('Auto','Manual','CVT','DCT','Single-speed')),
  fuel_type text not null check (fuel_type in ('PETROL','DIESEL','HYBRID','ELECTRIC')),
  mileage integer check (mileage >= 0),
  mileage_confirmed boolean not null default false,
  price numeric(12,2) not null check (price > 0 and price <= 9999999),
  body_type text not null default '' check (length(body_type) <= 60),
  description text not null default '' check (length(description) <= 5000),
  stock_status text not null default 'Available' check (stock_status in ('Available','Reserved','Sold')),
  publication text not null default 'draft' check (publication in ('draft','published')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (not mileage_confirmed or mileage is not null)
);
create index vehicles_publication on public.vehicles(publication, created_at desc);
alter table public.vehicles enable row level security;
create policy visible_stock on public.vehicles for select to anon, authenticated
  using (publication = 'published' or (select public.e2_can_read_stock()));
create policy admin_insert_stock on public.vehicles for insert to authenticated
  with check ((select public.e2_is_admin()) and publication = 'draft');
create policy admin_update_stock on public.vehicles for update to authenticated
  using ((select public.e2_is_admin())) with check ((select public.e2_is_admin()));
revoke all on public.vehicles from anon, authenticated;
grant select on public.vehicles to anon, authenticated;
grant insert, update on public.vehicles to authenticated;

create table public.vehicle_photos (
  id uuid primary key default gen_random_uuid(),
  vehicle_id uuid not null references public.vehicles(id),
  path text not null unique,
  position integer not null check (position between 0 and 19),
  created_at timestamptz not null default now(),
  constraint vehicle_photo_order unique (vehicle_id, position) deferrable initially immediate
);
alter table public.vehicle_photos enable row level security;
create policy visible_photos on public.vehicle_photos for select to anon, authenticated
  using (exists(select 1 from public.vehicles v where v.id = vehicle_id));
create policy admin_insert_photo on public.vehicle_photos for insert to authenticated
  with check ((select public.e2_is_admin()) and exists
    (select 1 from public.vehicles v where v.id = vehicle_id and publication = 'draft'));
create policy admin_delete_photo on public.vehicle_photos for delete to authenticated
  using ((select public.e2_is_admin()) and exists
    (select 1 from public.vehicles v where v.id = vehicle_id and publication = 'draft'));
revoke all on public.vehicle_photos from anon, authenticated;
grant select on public.vehicle_photos to anon, authenticated;
grant insert, delete on public.vehicle_photos to authenticated;

insert into storage.buckets (id,name,public,file_size_limit,allowed_mime_types)
values ('vehicle-photos','vehicle-photos',false,3145728,array['image/webp']);

create policy e2_photo_read on storage.objects for select to anon, authenticated
  using (bucket_id = 'vehicle-photos' and (
    (select public.e2_is_admin()) or exists
      (select 1 from public.vehicle_photos p where p.path = name)));
create policy e2_photo_upload on storage.objects for insert to authenticated
  with check (bucket_id = 'vehicle-photos' and (select public.e2_is_admin())
    and name ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}\.webp$'
    and exists(select 1 from public.vehicles v
      where v.id::text = split_part(name,'/',1) and v.publication = 'draft'));
create policy e2_photo_delete on storage.objects for delete to authenticated
  using (bucket_id = 'vehicle-photos' and (select public.e2_is_admin())
    and exists(select 1 from public.vehicles v
      where v.id::text = split_part(name,'/',1) and v.publication = 'draft')
    and not exists(select 1 from public.vehicle_photos p where p.path = name));

create function public.e2_validate_photo() returns trigger
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
    if (select count(*) from public.vehicle_photos where vehicle_id = new.vehicle_id) >= 20
      then raise exception 'Maximum 20 photos per vehicle'; end if;
    return new;
  end if;
  return old;
end;
$$;
revoke all on function public.e2_validate_photo() from public;
create trigger validate_vehicle_photo before insert or delete on public.vehicle_photos
  for each row execute function public.e2_validate_photo();

create function public.e2_validate_vehicle() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'UPDATE' then
    if new.id <> old.id or new.created_at <> old.created_at then
      raise exception 'Vehicle identity cannot change'; end if;
    if old.publication = 'published' and
      (to_jsonb(new) - 'publication' - 'updated_at') <> (to_jsonb(old) - 'publication' - 'updated_at') then
      raise exception 'Move vehicle to draft before editing'; end if;
  end if;
  if new.publication = 'published' and not exists
    (select 1 from public.vehicle_photos p join storage.objects o
      on o.bucket_id = 'vehicle-photos' and o.name = p.path where p.vehicle_id = new.id)
    then raise exception 'Add at least one real vehicle photo before publishing'; end if;
  new.updated_at = clock_timestamp();
  return new;
end;
$$;
revoke all on function public.e2_validate_vehicle() from public;
create trigger validate_vehicle before insert or update on public.vehicles
  for each row execute function public.e2_validate_vehicle();

create table public.inventory_audit (
  id bigint generated always as identity primary key,
  actor uuid,
  entity text not null,
  action text not null,
  row_id uuid not null,
  occurred_at timestamptz not null default now()
);
alter table public.inventory_audit enable row level security;
create policy admin_read_audit on public.inventory_audit for select to authenticated
  using ((select public.e2_is_admin()));
revoke all on public.inventory_audit from anon, authenticated;
grant select on public.inventory_audit to authenticated;
create function public.e2_audit_inventory() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.inventory_audit(actor,entity,action,row_id)
    values(auth.uid(),tg_table_name,tg_op,coalesce(new.id,old.id));
  return coalesce(new,old);
end;
$$;
revoke all on function public.e2_audit_inventory() from public;
create trigger audit_vehicle after insert or update on public.vehicles
  for each row execute function public.e2_audit_inventory();
create trigger audit_photo after insert or delete on public.vehicle_photos
  for each row execute function public.e2_audit_inventory();

create function public.e2_set_cover(photo_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare target uuid; state text;
begin
  if not public.e2_is_admin() then raise exception 'Admin access required'; end if;
  select vehicle_id into target from public.vehicle_photos where id = photo_id;
  if target is null then raise exception 'Photo not found'; end if;
  select publication into state from public.vehicles where id=target for update;
  if state <> 'draft' then raise exception 'Move vehicle to draft before changing cover'; end if;
  set constraints public.vehicle_photo_order deferred;
  with ordered as (select id, (row_number() over(order by (id=photo_id) desc,position)-1)::integer as pos
    from public.vehicle_photos where vehicle_id=target)
  update public.vehicle_photos p set position=ordered.pos from ordered where p.id=ordered.id;
  set constraints public.vehicle_photo_order immediate;
  insert into public.inventory_audit(actor,entity,action,row_id) values(auth.uid(),'vehicle_photos','SET_COVER',photo_id);
end;
$$;
revoke all on function public.e2_set_cover(uuid) from public;
grant execute on function public.e2_set_cover(uuid) to authenticated;
grant all on public.staff_memberships,public.vehicles,public.vehicle_photos,public.inventory_audit to service_role;
commit;
