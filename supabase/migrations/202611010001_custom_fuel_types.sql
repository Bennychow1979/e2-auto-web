-- Allow staff to save additional fuel types without changing access permissions.
-- Existing vehicle values are preserved. Safe to run again.
begin;
alter table public.vehicles drop constraint if exists vehicles_fuel_type_check;
alter table public.vehicles add constraint vehicles_fuel_type_check check (
  fuel_type is null or (
    char_length(fuel_type) between 1 and 40
    and fuel_type = btrim(fuel_type)
    and fuel_type !~ '[[:cntrl:]]'
    and upper(fuel_type) <> '__MANUAL__'
  )
);
commit;
