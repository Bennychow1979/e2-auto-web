begin;

-- Independent of whole-vehicle factory cover; no inference or backfill.
alter table public.vehicles
  add column battery_warranty boolean not null default false,
  add column battery_warranty_expires date,
  add column battery_warranty_km integer,
  add column battery_warranty_terms text not null default '',
  add constraint vehicle_battery_warranty_values check (
    (battery_warranty_km is null or battery_warranty_km > 0)
    and length(battery_warranty_terms) <= 2000
    and (not battery_warranty or (
      battery_warranty_expires is not null
      and battery_warranty_expires between date '2000-01-01' and date '2100-12-31'
      and battery_warranty_km is not null
    ))
  );

-- Existing RLS, draft-only edits, mileage checks, audit and publication triggers stay in force.
create function public.e2_validate_battery_warranty() returns trigger
language plpgsql security definer set search_path='' as $$
declare changed boolean;
begin
  if tg_op='INSERT' then
    changed := new.battery_warranty or new.battery_warranty_expires is not null
      or new.battery_warranty_km is not null or new.battery_warranty_terms <> '';
  else
    changed := row(new.battery_warranty,new.battery_warranty_expires,new.battery_warranty_km,new.battery_warranty_terms)
      is distinct from row(old.battery_warranty,old.battery_warranty_expires,old.battery_warranty_km,old.battery_warranty_terms);
  end if;
  if changed and not public.e2_is_admin() then
    raise exception 'Admin or Super Admin verification is required for battery warranty' using errcode='42501';
  end if;
  if changed and new.battery_warranty then
    if new.battery_warranty_expires is null or new.battery_warranty_expires < (now() at time zone 'Asia/Kuala_Lumpur')::date then
      raise exception 'Enter a current battery warranty expiry date';
    end if;
    if new.battery_warranty_km is null or not new.mileage_confirmed or new.mileage is null or new.mileage >= new.battery_warranty_km then
      raise exception 'Verify mileage below the battery warranty odometer limit';
    end if;
  end if;
  return new;
end;
$$;
revoke all on function public.e2_validate_battery_warranty() from public,anon,authenticated;
create trigger validate_battery_warranty before insert or update on public.vehicles
  for each row execute function public.e2_validate_battery_warranty();
notify pgrst,'reload schema';
commit;
