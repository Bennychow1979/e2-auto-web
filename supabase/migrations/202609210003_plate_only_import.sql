begin;
-- Registration-only matching; explicit source aliases also prevent duplicate imports.
alter table public.vehicle_import_jobs add column source_plate_aliases text[] not null default array[]::text[];
create or replace function public.e2_import_drive_vehicle(actor_id uuid,folder text,stamp text,source_stamp text,plan jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare car uuid; plate_key text; aliases text[]; added integer; receipt public.vehicle_import_jobs%rowtype;
begin
  if not exists(select 1 from public.staff_memberships where user_id=actor_id and active and role in ('super_admin','admin'))
    then raise exception 'Admin access required'; end if;
  plate_key:=plan->'vehicle'->>'plate';
  if plate_key !~ '^[A-Z0-9]{2,20}$' or plate_key='W2133A'
    then raise exception 'Plate requires manual resolution'; end if;
  if plan ? 'plate_aliases' and jsonb_typeof(plan->'plate_aliases') is distinct from 'array'
    then raise exception 'Invalid registration aliases'; end if;
  select array_agg(distinct a) into aliases from jsonb_array_elements_text(coalesce(plan->'plate_aliases',jsonb_build_array(plate_key))) a;
  if aliases is null or not(plate_key=any(aliases)) or cardinality(aliases)>10
    or exists(select 1 from unnest(aliases) a where a is null or a !~ '^[A-Z0-9]{2,20}$' or a !~ '[A-Z]' or a !~ '[0-9]')
    then raise exception 'Invalid registration aliases'; end if;
  if jsonb_typeof(plan->'items') is distinct from 'array' or jsonb_array_length(plan->'items') not between 1 and 30
    then raise exception 'Select between 1 and 30 photos'; end if;
  if exists(select 1 from jsonb_array_elements(plan->'items') i where i->>'folder_id' is distinct from folder)
    then raise exception 'Photo folder mismatch'; end if;
  -- Serializes against ordinary portal inserts/updates too, not just this importer.
  lock table public.vehicles in share row exclusive mode;
  select * into receipt from public.vehicle_import_jobs where folder_id=folder for update;
  if receipt.status='completed' then return jsonb_build_object('status','existing','vehicle_id',receipt.vehicle_id); end if;
  select id into car from public.vehicles where regexp_replace(upper(plate),'[^A-Z0-9]','','g')=any(aliases) limit 1;
  if car is not null then return jsonb_build_object('status','existing','vehicle_id',car); end if;
  select vehicle_id into car from public.vehicle_import_jobs
    where status='completed' and source_plate_aliases && aliases and vehicle_id is not null limit 1;
  if car is not null then return jsonb_build_object('status','existing','vehicle_id',car); end if;
  perform set_config('request.jwt.claim.sub',actor_id::text,true);
  insert into public.vehicles(plate,brand,model,variant,year,engine_litres,transmission,fuel_type,mileage,mileage_confirmed,price,publication,stock_status)
    values(plate_key,plan->'vehicle'->>'brand',plan->'vehicle'->>'model','',
      (plan->'vehicle'->>'year')::integer,(plan->'vehicle'->>'engine_litres')::numeric,
      plan->'vehicle'->>'transmission','PETROL',null,false,(plan->'vehicle'->>'price')::numeric,'draft','Available') returning id into car;
  added:=public.e2_attach_drive_photos(actor_id,car,plate_key,plan->'items');
  if added<>jsonb_array_length(plan->'items') then raise exception 'Photo count mismatch; import rolled back'; end if;
  insert into public.vehicle_import_jobs(folder_id,fingerprint,status,plate,vehicle_id,source_fingerprint,source_sheet,source_row,review_notes,source_plate_aliases)
    values(folder,stamp,'completed',plate_key,car,source_stamp,plan->>'sheet',(plan->>'row')::integer,plan->'review',aliases)
    on conflict(folder_id) do update set fingerprint=excluded.fingerprint,status='completed',plate=excluded.plate,
      vehicle_id=excluded.vehicle_id,source_fingerprint=excluded.source_fingerprint,source_sheet=excluded.source_sheet,
      source_row=excluded.source_row,review_notes=excluded.review_notes,source_plate_aliases=excluded.source_plate_aliases,issue=null,updated_at=now();
  insert into public.inventory_audit(actor,entity,action,row_id) values(actor_id,'vehicles','IMPORT_DRIVE_DRAFT',car);
  return jsonb_build_object('status','created','vehicle_id',car,'photos',added);
end;
$$;
revoke all on function public.e2_import_drive_vehicle(uuid,text,text,text,jsonb) from public,anon,authenticated;
grant execute on function public.e2_import_drive_vehicle(uuid,text,text,text,jsonb) to service_role;
commit;
