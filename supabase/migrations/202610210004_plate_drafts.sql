begin;
-- A plate-first intake is explicit and private; ordinary and public records stay complete.
alter table public.vehicles add column import_pending boolean not null default false;
alter table public.vehicles
  alter column brand drop not null,
  alter column model drop not null,
  alter column year drop not null,
  alter column engine_litres drop not null,
  alter column transmission drop not null,
  alter column fuel_type drop not null,
  alter column price drop not null;
alter table public.vehicles add constraint vehicles_draft_completeness check (
  (import_pending and publication='draft') or
  (brand is not null and model is not null and year is not null and engine_litres is not null
   and transmission is not null and fuel_type is not null and price is not null)
);
alter table public.vehicles add constraint vehicles_pending_private check (not import_pending or publication='draft');
commit;
