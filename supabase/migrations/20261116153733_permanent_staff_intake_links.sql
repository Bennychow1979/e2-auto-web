begin;
-- Owner-authorized policy: future staff invitations do not expire by date.
-- Existing account, role, revocation and vehicle-availability checks remain.
alter table public.intake_links alter column expires_at set default 'infinity'::timestamptz;
update public.intake_links set expires_at='infinity'::timestamptz
where source='staff' and active and expires_at<>'infinity'::timestamptz;
-- Deliberately do not change active=false or any ownership/vehicle field.
commit;
