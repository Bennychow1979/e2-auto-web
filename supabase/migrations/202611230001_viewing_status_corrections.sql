-- Allow authorized staff to correct saved statuses; preserve access, concurrency and confirmation checks.
-- No appointment rows are changed by this migration.
begin;
-- Completed may be a retrospective correction, without inventing prior customer agreement.
alter table public.e2_viewings drop constraint e2_viewings_check1;
alter table public.e2_viewings add constraint e2_viewings_check1 check(status <> 'Confirmed' or (confirmed_date is not null and contact_verified_at is not null));
create or replace function public.e2_update_viewing(target uuid, expected_revision bigint, next_status text, assigned_sales uuid,
  confirmed_day date default null, confirmed_slot time default null, confirm_contact boolean default false, note text default '')
returns void language plpgsql security definer set search_path='' as $$
declare v public.e2_viewings; is_admin boolean:=public.e2_is_admin();
begin
  select * into v from public.e2_viewings where id=target for update;
  if v.id is null or not public.e2_viewing_access(target) then raise exception 'Viewing access required'; end if;
  if expected_revision is distinct from v.revision then raise exception 'This request has changed. Refresh and try again.'; end if;
  if next_status is null or next_status not in ('Requested','Confirmed','Completed','Cancelled') or note is null or length(note)>1000
    then raise exception 'Choose a valid status and a note up to 1000 characters.'; end if;
  if not is_admin and assigned_sales is distinct from v.salesperson then raise exception 'Admin must assign sales'; end if;
  if assigned_sales is not null and not exists(select 1 from public.staff_memberships where user_id=assigned_sales and active and role in ('sales','admin','super_admin'))
    then raise exception 'Choose an active salesperson'; end if;
  if next_status='Confirmed' then
    if confirm_contact is distinct from true then raise exception 'Confirm that the customer agreed to this date and time.'; end if;
    if not public.e2_viewing_slot_valid(confirmed_day,confirmed_slot) or confirmed_day is null or confirmed_slot is null
      or confirmed_day>(now() at time zone 'Asia/Kuala_Lumpur')::date+90
      or ((confirmed_day+confirmed_slot) at time zone 'Asia/Kuala_Lumpur'<=now() and (v.status<>'Confirmed' or confirmed_day is distinct from v.confirmed_date or confirmed_slot is distinct from v.confirmed_time))
      then raise exception 'Choose a future appointment during viewing hours, within 90 days.'; end if;
    if v.vehicle_id is not null and not exists(select 1 from public.vehicles where id=v.vehicle_id and publication='published' and stock_status='Available')
      then raise exception 'This vehicle is no longer available. Discuss alternatives with the customer.'; end if;
  end if;
  update public.e2_viewings set status=next_status,salesperson=assigned_sales,staff_note=trim(note),
    confirmed_date=case when next_status='Confirmed' then confirmed_day when next_status='Requested' then null else v.confirmed_date end,
    confirmed_time=case when next_status='Confirmed' then confirmed_slot when next_status='Requested' then null else v.confirmed_time end,
    contact_verified_at=case when next_status='Confirmed' then now() when next_status='Requested' then null else v.contact_verified_at end,
    updated_at=now(),revision=revision+1 where id=target;
  insert into public.e2_viewing_events(viewing_id,actor,action,details) values(target,auth.uid(),'UPDATED',
    jsonb_build_object('previous_status',v.status,'status',next_status,'previous_confirmed_date',v.confirmed_date,'previous_confirmed_time',v.confirmed_time,'assigned_sales',assigned_sales,
      'confirmed_date',case when next_status='Confirmed' then confirmed_day when next_status='Requested' then null else v.confirmed_date end,
      'confirmed_time',case when next_status='Confirmed' then confirmed_slot when next_status='Requested' then null else v.confirmed_time end));
end;
$$;

notify pgrst,'reload schema';
commit;
