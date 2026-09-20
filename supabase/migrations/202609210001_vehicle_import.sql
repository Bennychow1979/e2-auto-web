begin;
-- Private receipts contain only permitted sale fields, source IDs and review requirements.
create table public.vehicle_import_jobs (
  folder_id text primary key check (folder_id ~ '^[A-Za-z0-9_-]{10,200}$'),
  fingerprint text not null,
  status text not null check (status in ('blocked','completed')),
  plate text,
  issue text,
  vehicle_id uuid references public.vehicles(id),
  source_fingerprint text,
  source_sheet text,
  source_row integer,
  review_notes jsonb,
  updated_at timestamptz not null default now()
);
alter table public.vehicle_import_jobs enable row level security;
revoke all on public.vehicle_import_jobs from public,anon,authenticated;
grant all on public.vehicle_import_jobs to service_role;
grant select on public.vehicle_import_jobs to authenticated;
create policy admin_read_import_receipts on public.vehicle_import_jobs for select to authenticated using (
  exists(select 1 from public.staff_memberships where user_id=(select auth.uid()) and active and role in ('super_admin','admin'))
);
-- A stale concurrent scan cannot downgrade a committed receipt to a blocked candidate.
create function public.e2_keep_completed_import() returns trigger language plpgsql set search_path='' as $$
begin
  if old.status='completed' and new.status<>'completed' then return null; end if;
  return new;
end;
$$;
revoke all on function public.e2_keep_completed_import() from public;
create trigger keep_completed_import before update on public.vehicle_import_jobs
  for each row execute function public.e2_keep_completed_import();

create function public.e2_import_drive_vehicle(actor_id uuid,folder text,stamp text,source_stamp text,plan jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare car uuid; plate_key text; added integer; receipt public.vehicle_import_jobs%rowtype;
begin
  if not exists(select 1 from public.staff_memberships where user_id=actor_id and active and role in ('super_admin','admin'))
    then raise exception 'Admin access required'; end if;
  plate_key:=plan->'vehicle'->>'plate';
  if plate_key !~ '^[A-Z0-9]{2,20}$' or plate_key in ('W2133A','FC9555')
    then raise exception 'Plate requires manual resolution'; end if;
  if jsonb_typeof(plan->'items') is distinct from 'array' or jsonb_array_length(plan->'items') not between 1 and 30
    then raise exception 'Select between 1 and 30 photos'; end if;
  if exists(select 1 from jsonb_array_elements(plan->'items') i where i->>'folder_id' is distinct from folder)
    then raise exception 'Photo folder mismatch'; end if;
  -- Serializes against ordinary portal inserts/updates too, not just this importer.
  lock table public.vehicles in share row exclusive mode;
  select * into receipt from public.vehicle_import_jobs where folder_id=folder for update;
  if receipt.status='completed' then return jsonb_build_object('status','existing','vehicle_id',receipt.vehicle_id); end if;
  select id into car from public.vehicles where regexp_replace(upper(plate),'[^A-Z0-9]','','g')=plate_key limit 1;
  if car is not null then return jsonb_build_object('status','existing','vehicle_id',car); end if;
  perform set_config('request.jwt.claim.sub',actor_id::text,true);
  insert into public.vehicles(plate,brand,model,variant,year,engine_litres,transmission,fuel_type,mileage,mileage_confirmed,price,publication,stock_status)
    values(plate_key,plan->'vehicle'->>'brand',plan->'vehicle'->>'model','',
      (plan->'vehicle'->>'year')::integer,(plan->'vehicle'->>'engine_litres')::numeric,
      plan->'vehicle'->>'transmission','PETROL',null,false,(plan->'vehicle'->>'price')::numeric,'draft','Available') returning id into car;
  added:=public.e2_attach_drive_photos(actor_id,car,plate_key,plan->'items');
  if added<>jsonb_array_length(plan->'items') then raise exception 'Photo count mismatch; import rolled back'; end if;
  insert into public.vehicle_import_jobs(folder_id,fingerprint,status,plate,vehicle_id,source_fingerprint,source_sheet,source_row,review_notes)
    values(folder,stamp,'completed',plate_key,car,source_stamp,plan->>'sheet',(plan->>'row')::integer,plan->'review')
    on conflict(folder_id) do update set fingerprint=excluded.fingerprint,status='completed',plate=excluded.plate,
      vehicle_id=excluded.vehicle_id,source_fingerprint=excluded.source_fingerprint,source_sheet=excluded.source_sheet,
      source_row=excluded.source_row,review_notes=excluded.review_notes,issue=null,updated_at=now();
  insert into public.inventory_audit(actor,entity,action,row_id) values(actor_id,'vehicles','IMPORT_DRIVE_DRAFT',car);
  return jsonb_build_object('status','created','vehicle_id',car,'photos',added);
end;
$$;
revoke all on function public.e2_import_drive_vehicle(uuid,text,text,text,jsonb) from public,anon,authenticated;
grant execute on function public.e2_import_drive_vehicle(uuid,text,text,text,jsonb) to service_role;
commit;
