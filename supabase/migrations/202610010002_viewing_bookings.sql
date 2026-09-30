begin;

-- Public visitors can submit a request, never browse customer details.
create table public.e2_viewings (
  id uuid primary key,
  customer_name text not null check(length(customer_name) between 1 and 100),
  phone text not null check(phone ~ '^[1-9][0-9]{7,14}$'),
  vehicle_id uuid references public.vehicles(id),
  vehicle_label text,
  preferred_date date not null,
  preferred_time time not null,
  locale text not null check(locale in ('en','ms','zh')),
  salesperson uuid references public.staff_memberships(user_id),
  ref_code text,
  referral_request_id uuid references public.e2_referral_requests(id),
  submission_fingerprint text not null,
  status text not null default 'Requested' check(status in ('Requested','Confirmed','Completed','Cancelled')),
  confirmed_date date,
  confirmed_time time,
  contact_verified_at timestamptz,
  staff_note text not null default '' check(length(staff_note)<=1000),
  privacy_version text not null default 'viewing-2026-10-01',
  consent_at timestamptz not null default now(),
  revision bigint not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check((confirmed_date is null)=(confirmed_time is null)),
  check(status not in ('Confirmed','Completed') or (confirmed_date is not null and contact_verified_at is not null))
);
create index viewings_phone_created on public.e2_viewings(phone,created_at);
create index viewings_created on public.e2_viewings(created_at);
create index viewings_sales_date on public.e2_viewings(salesperson,preferred_date);
create table public.e2_viewing_events (
  id uuid primary key default gen_random_uuid(),
  viewing_id uuid not null references public.e2_viewings(id),
  actor uuid,
  action text not null,
  details jsonb not null default '{}',
  created_at timestamptz not null default now()
);
create index viewing_events_parent on public.e2_viewing_events(viewing_id,created_at);
alter table public.e2_viewings enable row level security;
alter table public.e2_viewing_events enable row level security;
revoke all on public.e2_viewings, public.e2_viewing_events from public,anon,authenticated;
grant select on public.e2_viewings, public.e2_viewing_events to authenticated;
grant all on public.e2_viewings, public.e2_viewing_events to service_role;

create function public.e2_viewing_access(target uuid) returns boolean
language sql stable security definer set search_path='' as $$
  select public.e2_is_admin() or exists(
    select 1 from public.e2_viewings v join public.staff_memberships m on m.user_id=v.salesperson
    where v.id=target and m.user_id=auth.uid() and m.active and m.role='sales');
$$;
create policy viewing_read on public.e2_viewings for select to authenticated using(public.e2_viewing_access(id));
create policy viewing_event_read on public.e2_viewing_events for select to authenticated using(public.e2_viewing_access(viewing_id));

create function public.e2_viewing_assignees() returns table(user_id uuid,display_name text)
language plpgsql stable security definer set search_path='' as $$
begin
  if not public.e2_is_admin() then raise exception 'Admin access required'; end if;
  return query select m.user_id,coalesce(p.display_name,'E2 staff · '||left(m.user_id::text,8))
    from public.staff_memberships m left join public.staff_profiles p on p.user_id=m.user_id
    where m.active and m.role in ('sales','admin','super_admin') order by p.display_name nulls last,m.user_id;
end;
$$;

create function public.e2_viewing_slot_valid(day date, slot time) returns boolean
language sql immutable set search_path='' as $$
  select day is not null and slot is not null and extract(second from slot)=0 and extract(minute from slot) in (0,30)
    and case when extract(dow from day)=0 then slot between time '10:00' and time '16:30'
    else slot between time '09:30' and time '18:00' end;
$$;

create function public.e2_submit_viewing(request_id uuid, customer_name text, customer_phone text,
  view_date date, view_time time, consent boolean, car_id uuid default null, lang text default 'en',
  sales_id uuid default null, partner_code text default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare phone_key text; fingerprint text; prior public.e2_viewings; recipient uuid; car_label text;
  referral_id uuid; referral_code text:=nullif(upper(trim(partner_code)),''); local_today date:=(now() at time zone 'Asia/Kuala_Lumpur')::date;
begin
  if consent is distinct from true then raise exception 'BOOKING_CONSENT'; end if;
  if request_id is null or customer_name is null or length(trim(customer_name)) not between 1 and 100
    or customer_phone is null or length(customer_phone)>32 or customer_phone !~ '^\+?[0-9 ()-]+$'
    or lang is null or lang not in ('en','ms','zh') then raise exception 'BOOKING_DETAILS'; end if;
  phone_key:=regexp_replace(customer_phone,'[^0-9]','','g');
  if phone_key like '00%' then phone_key:=substr(phone_key,3); end if;
  if phone_key like '0%' then phone_key:='60'||substr(phone_key,2); end if;
  if phone_key !~ '^[1-9][0-9]{7,14}$' then raise exception 'BOOKING_PHONE'; end if;
  -- Hash is for exact retry matching, not authentication. No PII is returned.
  fingerprint:=md5(jsonb_build_array(trim(customer_name),phone_key,car_id,view_date,view_time,sales_id,referral_code)::text);
  perform pg_advisory_xact_lock(20261001,2);
  select * into prior from public.e2_viewings where id=request_id;
  if found then
    if prior.submission_fingerprint<>fingerprint then raise exception 'BOOKING_REFERENCE'; end if;
    return jsonb_build_object('id',prior.id,'status',prior.status,'preferred_date',prior.preferred_date,'preferred_time',prior.preferred_time,
      'confirmed_date',prior.confirmed_date,'confirmed_time',prior.confirmed_time);
  end if;
  if view_date is null or view_date<local_today or view_date>local_today+90 or not public.e2_viewing_slot_valid(view_date,view_time)
    or (view_date+view_time) at time zone 'Asia/Kuala_Lumpur'<=now() then raise exception 'BOOKING_TIME'; end if;
  if car_id is not null then
    select year||' '||brand||' '||model||case when coalesce(variant,'')<>'' then ' · '||variant else '' end into car_label
      from public.vehicles where id=car_id and publication='published' and stock_status='Available' for share;
    if not found then raise exception 'BOOKING_VEHICLE'; end if;
  end if;
  select user_id into recipient from public.staff_memberships where user_id=sales_id and active and role in ('sales','admin','super_admin');
  if sales_id is not null and recipient is null then raise exception 'BOOKING_SALES'; end if;
  if referral_code is not null and (referral_code !~ '^[A-Z0-9]{6,24}$' or not exists(select 1 from public.e2_partners p where p.code=referral_code and p.active))
    then raise exception 'BOOKING_REFERRAL'; end if;
  if (select count(*) from public.e2_viewings where phone=phone_key and created_at>now()-interval '1 hour')>=5
    or (select count(*) from public.e2_viewings where created_at>now()-interval '1 hour')>=200
    or (select count(*) from public.e2_viewings where created_at>now()-interval '1 day')>=1000 then raise exception 'BOOKING_LIMIT'; end if;
  if referral_code is not null and car_id is not null then
    referral_id:=public.e2_submit_referral(request_id,referral_code,car_id,customer_name,phone_key,'viewing',true,recipient,view_date,
      case when view_time<time '12:00' then 'Morning' else 'Afternoon' end);
  end if;
  insert into public.e2_viewings(id,customer_name,phone,vehicle_id,vehicle_label,preferred_date,preferred_time,locale,salesperson,
    ref_code,referral_request_id,submission_fingerprint)
    values(request_id,trim(customer_name),phone_key,car_id,car_label,view_date,view_time,lang,recipient,referral_code,referral_id,fingerprint);
  insert into public.e2_viewing_events(viewing_id,action) values(request_id,'REQUESTED');
  return jsonb_build_object('id',request_id,'status','Requested','preferred_date',view_date,'preferred_time',view_time);
end;
$$;

create function public.e2_update_viewing(target uuid, expected_revision bigint, next_status text, assigned_sales uuid,
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
  if v.status in ('Cancelled','Completed') and next_status<>v.status then raise exception 'Closed requests cannot be reopened. Create a new request.'; end if;
  if next_status='Completed' and v.status not in ('Confirmed','Completed') then raise exception 'Confirm the appointment before completing it.'; end if;
  if next_status='Requested' and v.status<>'Requested' then raise exception 'A confirmed request can only be completed or cancelled.'; end if;
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
    confirmed_date=case when next_status='Confirmed' then confirmed_day else v.confirmed_date end,
    confirmed_time=case when next_status='Confirmed' then confirmed_slot else v.confirmed_time end,
    contact_verified_at=case when next_status='Confirmed' then now() else v.contact_verified_at end,
    updated_at=now(),revision=revision+1 where id=target;
  insert into public.e2_viewing_events(viewing_id,actor,action,details) values(target,auth.uid(),'UPDATED',
    jsonb_build_object('previous_status',v.status,'status',next_status,'assigned_sales',assigned_sales,
      'confirmed_date',case when next_status='Confirmed' then confirmed_day else v.confirmed_date end,
      'confirmed_time',case when next_status='Confirmed' then confirmed_slot else v.confirmed_time end));
end;
$$;

revoke all on function public.e2_viewing_access(uuid),public.e2_viewing_assignees(),public.e2_viewing_slot_valid(date,time),
  public.e2_submit_viewing(uuid,text,text,date,time,boolean,uuid,text,uuid,text),
  public.e2_update_viewing(uuid,bigint,text,uuid,date,time,boolean,text) from public,anon,authenticated;
grant execute on function public.e2_viewing_access(uuid),public.e2_viewing_assignees(),public.e2_update_viewing(uuid,bigint,text,uuid,date,time,boolean,text) to authenticated;
grant execute on function public.e2_submit_viewing(uuid,text,text,date,time,boolean,uuid,text,uuid,text) to anon,authenticated;
notify pgrst,'reload schema';
commit;
