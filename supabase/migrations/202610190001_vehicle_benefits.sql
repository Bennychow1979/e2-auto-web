begin;

-- Additive only: existing/imported vehicles receive no badges by default.
alter table public.vehicles
  add column factory_warranty boolean not null default false,
  add column factory_warranty_expires date,
  add column factory_warranty_km integer,
  add column factory_warranty_unlimited boolean not null default false,
  add column factory_warranty_terms text not null default '',
  add column third_party_warranty text not null default 'none',
  add column warranty_provider text not null default '',
  add column warranty_package text not null default '',
  add column warranty_months integer,
  add column warranty_km integer,
  add column warranty_unlimited boolean not null default false,
  add column warranty_price numeric(12,2),
  add column warranty_coverage text not null default '',
  add column warranty_terms text not null default '',
  add column full_service_record boolean not null default false,
  add constraint vehicle_benefit_values check (
    third_party_warranty in ('none','included','available')
    and (factory_warranty_km is null or factory_warranty_km>0)
    and (warranty_km is null or warranty_km>0)
    and (warranty_months is null or warranty_months between 1 and 120)
    and (warranty_price is null or warranty_price between 0 and 9999999)
    and length(warranty_provider)<=160 and length(warranty_package)<=160
    and length(factory_warranty_terms)<=2000 and length(warranty_coverage)<=2000 and length(warranty_terms)<=2000
    and (not factory_warranty or (factory_warranty_expires is not null and factory_warranty_expires between date '2000-01-01' and date '2100-12-31' and (factory_warranty_unlimited or factory_warranty_km is not null)))
    and (third_party_warranty='none' or (length(trim(warranty_provider))>0 and length(trim(warranty_package))>0 and warranty_months is not null and (warranty_unlimited or warranty_km is not null)))
  );

-- Preserve all existing RLS, mileage guards, audit triggers and draft-only editing.
-- The extra guard also stops import/service integrations assigning badges automatically.
create function public.e2_validate_vehicle_benefits() returns trigger
language plpgsql security definer set search_path='' as $$
declare changed boolean; factory_changed boolean;
begin
  if tg_op='INSERT' then
    changed:=new.factory_warranty or new.third_party_warranty<>'none' or new.full_service_record
      or new.factory_warranty_expires is not null or new.factory_warranty_km is not null or new.factory_warranty_unlimited or new.factory_warranty_terms<>''
      or new.warranty_provider<>'' or new.warranty_package<>'' or new.warranty_months is not null or new.warranty_km is not null or new.warranty_unlimited or new.warranty_price is not null or new.warranty_coverage<>'' or new.warranty_terms<>'';
    factory_changed:=new.factory_warranty;
  else
    changed:=row(new.factory_warranty,new.factory_warranty_expires,new.factory_warranty_km,new.factory_warranty_unlimited,new.factory_warranty_terms,new.third_party_warranty,new.warranty_provider,new.warranty_package,new.warranty_months,new.warranty_km,new.warranty_unlimited,new.warranty_price,new.warranty_coverage,new.warranty_terms,new.full_service_record)
      is distinct from row(old.factory_warranty,old.factory_warranty_expires,old.factory_warranty_km,old.factory_warranty_unlimited,old.factory_warranty_terms,old.third_party_warranty,old.warranty_provider,old.warranty_package,old.warranty_months,old.warranty_km,old.warranty_unlimited,old.warranty_price,old.warranty_coverage,old.warranty_terms,old.full_service_record);
    factory_changed:=row(new.factory_warranty,new.factory_warranty_expires,new.factory_warranty_km,new.factory_warranty_unlimited)
      is distinct from row(old.factory_warranty,old.factory_warranty_expires,old.factory_warranty_km,old.factory_warranty_unlimited);
  end if;
  if changed and not public.e2_is_admin() then raise exception 'Admin or Super Admin verification is required for warranty and service labels' using errcode='42501'; end if;
  if factory_changed and new.factory_warranty then
    if new.factory_warranty_expires is null or new.factory_warranty_expires<(now() at time zone 'Asia/Kuala_Lumpur')::date then
      raise exception 'Enter a current factory warranty expiry date'; end if;
    if not new.factory_warranty_unlimited and (new.factory_warranty_km is null or not new.mileage_confirmed or new.mileage is null or new.mileage>=new.factory_warranty_km) then
      raise exception 'Verify mileage below the factory warranty limit, or confirm unlimited mileage'; end if;
  end if;
  return new;
end;
$$;
revoke all on function public.e2_validate_vehicle_benefits() from public,anon,authenticated;
create trigger validate_vehicle_benefits before insert or update on public.vehicles
  for each row execute function public.e2_validate_vehicle_benefits();
notify pgrst,'reload schema';
commit;
