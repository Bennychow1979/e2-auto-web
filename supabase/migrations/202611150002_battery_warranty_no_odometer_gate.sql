begin;

-- Battery cover can be extended individually. Keep legacy km values intact,
-- but no longer require them or compare them with the vehicle odometer.
alter table public.vehicles drop constraint vehicle_battery_warranty_values;
alter table public.vehicles add constraint vehicle_battery_warranty_values check (
  (battery_warranty_km is null or battery_warranty_km > 0)
  and length(battery_warranty_terms) <= 2000
  and (not battery_warranty or (
    battery_warranty_expires is not null
    and battery_warranty_expires between date '2000-01-01' and date '2100-12-31'
  ))
);

create or replace function public.e2_validate_battery_warranty() returns trigger
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
  end if;
  return new;
end;
$$;
revoke all on function public.e2_validate_battery_warranty() from public,anon,authenticated;
notify pgrst,'reload schema';
commit;
