-- Spec is optional; retain a non-null string for existing readers.
-- No vehicle values, publication states, policies or grants are changed.
begin;
alter table public.vehicles drop constraint vehicles_variant_check;
alter table public.vehicles add constraint vehicles_variant_check
  check (length(trim(variant)) between 0 and 120);
alter table public.vehicles alter column variant set default '';
commit;
