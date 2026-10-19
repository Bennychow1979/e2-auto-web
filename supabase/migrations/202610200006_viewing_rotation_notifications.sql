begin;

-- Persist rotation independently from personal-link leads and notification retries.
create table public.e2_viewing_rotation (
  user_id uuid primary key references public.staff_memberships(user_id),
  enabled boolean not null default true,
  last_turn bigint not null default 0,
  updated_at timestamptz not null default now()
);
create table public.e2_viewing_delivery_settings (
  singleton boolean primary key default true check(singleton),
  notifications_enabled boolean not null default false,
  turn_number bigint not null default 0
);
insert into public.e2_viewing_delivery_settings(singleton) values(true);
create table public.e2_viewing_notifications (
  viewing_id uuid primary key references public.e2_viewings(id),
  status text not null default 'pending' check(status in ('pending','sending','sent','failed','uncertain','skipped')),
  attempts integer not null default 0,
  available_at timestamptz not null default now(),
  lease_id uuid,
  lease_until timestamptz,
  message_id bigint,
  issue text,
  created_at timestamptz not null default now(),
  sent_at timestamptz
);
create index e2_viewing_notification_queue on public.e2_viewing_notifications(available_at) where status='pending';
alter table public.e2_viewing_rotation enable row level security;
alter table public.e2_viewing_delivery_settings enable row level security;
alter table public.e2_viewing_notifications enable row level security;
revoke all on public.e2_viewing_rotation,public.e2_viewing_delivery_settings,public.e2_viewing_notifications from public,anon,authenticated;
grant all on public.e2_viewing_rotation,public.e2_viewing_delivery_settings,public.e2_viewing_notifications to service_role;
grant select on public.e2_viewing_notifications to authenticated;
create policy viewing_notification_admin_read on public.e2_viewing_notifications for select to authenticated using(public.e2_is_admin());

create function public.e2_viewing_rotation_settings() returns jsonb
language plpgsql stable security definer set search_path='' as $$
begin
  if not public.e2_is_admin() then raise exception 'Admin access required'; end if;
  return jsonb_build_object(
    'notifications_enabled',(select notifications_enabled from public.e2_viewing_delivery_settings where singleton),
    'roster',coalesce((select jsonb_agg(to_jsonb(s) order by s.last_turn,s.display_name,s.user_id) from (
      select m.user_id,coalesce(p.display_name,'E2 staff · '||left(m.user_id::text,8)) display_name,
        m.active,coalesce(r.enabled,true) enabled,coalesce(r.last_turn,0) last_turn
      from public.staff_memberships m left join public.staff_profiles p on p.user_id=m.user_id
      left join public.e2_viewing_rotation r on r.user_id=m.user_id where m.role='sales'
    ) s),'[]'::jsonb));
end;
$$;
create function public.e2_set_viewing_rotation(target uuid, participating boolean) returns void
language plpgsql security definer set search_path='' as $$
begin
  if not public.e2_is_admin() then raise exception 'Admin access required'; end if;
  if participating is null then raise exception 'Choose rotation availability'; end if;
  perform pg_advisory_xact_lock(20261001,2);
  if not exists(select 1 from public.staff_memberships where user_id=target and role='sales') then raise exception 'Choose a Sales account'; end if;
  insert into public.e2_viewing_rotation(user_id,enabled) values(target,participating)
    on conflict(user_id) do update set enabled=excluded.enabled,updated_at=now();
end;
$$;

-- Only invoked inside the submission transaction, after idempotency/validation.
create function public.e2_next_viewing_salesperson() returns uuid
language plpgsql security definer set search_path='' as $$
declare recipient uuid; next_turn bigint;
begin
  perform pg_advisory_xact_lock(20261001,2);
  select m.user_id into recipient from public.staff_memberships m
    left join public.e2_viewing_rotation r on r.user_id=m.user_id
    left join public.staff_profiles p on p.user_id=m.user_id
    where m.active and m.role='sales' and coalesce(r.enabled,true)
    order by coalesce(r.last_turn,0),coalesce(p.display_name,'E2 staff · '||left(m.user_id::text,8)),m.user_id
    limit 1 for share of m;
  if recipient is null then return null; end if;
  update public.e2_viewing_delivery_settings set turn_number=turn_number+1 where singleton returning turn_number into next_turn;
  insert into public.e2_viewing_rotation(user_id,last_turn) values(recipient,next_turn)
    on conflict(user_id) do update set last_turn=excluded.last_turn,updated_at=now();
  return recipient;
end;
$$;

create or replace function public.e2_submit_viewing(request_id uuid, customer_name text, customer_phone text,
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
  -- Personal links keep their owner without using a rotation turn.
  if sales_id is null then recipient:=public.e2_next_viewing_salesperson(); end if;
  if referral_code is not null and car_id is not null then
    referral_id:=public.e2_submit_referral(request_id,referral_code,car_id,customer_name,phone_key,'viewing',true,recipient,view_date,
      case when view_time<time '12:00' then 'Morning' else 'Afternoon' end);
  end if;
  insert into public.e2_viewings(id,customer_name,phone,vehicle_id,vehicle_label,preferred_date,preferred_time,locale,salesperson,
    ref_code,referral_request_id,submission_fingerprint)
    values(request_id,trim(customer_name),phone_key,car_id,car_label,view_date,view_time,lang,recipient,referral_code,referral_id,fingerprint);
  insert into public.e2_viewing_events(viewing_id,action,details) values(request_id,'REQUESTED',
    jsonb_build_object('assignment_source',case when sales_id is not null then 'personal_link' when recipient is not null then 'rotation' else 'unassigned' end,'assigned_sales',recipient));
  return jsonb_build_object('id',request_id,'status','Requested','preferred_date',view_date,'preferred_time',view_time);
end;
$$;

create function public.e2_enqueue_viewing_notification() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  if (select notifications_enabled from public.e2_viewing_delivery_settings where singleton) then
    insert into public.e2_viewing_notifications(viewing_id) values(new.id) on conflict do nothing;
  end if;
  return new;
end;
$$;
create trigger e2_queue_new_viewing after insert on public.e2_viewings for each row execute function public.e2_enqueue_viewing_notification();

-- A lease that expires may already have delivered to Telegram: do not blindly resend.
create function public.e2_claim_viewing_notification() returns jsonb
language plpgsql security definer set search_path='' as $$
declare job public.e2_viewing_notifications; result jsonb;
begin
  update public.e2_viewing_notifications set status='uncertain',issue='Delivery receipt missing; check the channel before retrying.'
    where status='sending' and lease_until<now();
  if not (select notifications_enabled from public.e2_viewing_delivery_settings where singleton) then return null; end if;
  select * into job from public.e2_viewing_notifications where status='pending' and available_at<=now()
    order by available_at,created_at,viewing_id limit 1 for update skip locked;
  if not found then return null; end if;
  update public.e2_viewing_notifications set status='sending',attempts=attempts+1,lease_id=gen_random_uuid(),lease_until=now()+interval '5 minutes'
    where viewing_id=job.viewing_id returning * into job;
  select jsonb_build_object('viewing_id',v.id,'lease_id',job.lease_id,'attempts',job.attempts,
    'customer_name',v.customer_name,'vehicle_label',v.vehicle_label,
    'date',coalesce(v.confirmed_date,v.preferred_date),'time',coalesce(v.confirmed_time,v.preferred_time),
    'salesperson',v.salesperson,'sales_name',coalesce(p.display_name,'E2 staff · '||left(v.salesperson::text,8)),
    'status',v.status) into result from public.e2_viewings v left join public.staff_profiles p on p.user_id=v.salesperson where v.id=job.viewing_id;
  return result;
end;
$$;
create function public.e2_finish_viewing_notification(target uuid, lease uuid, outcome text, telegram_message bigint default null, retry_seconds integer default 60, failure_code text default null) returns boolean
language plpgsql security definer set search_path='' as $$
declare job public.e2_viewing_notifications;
begin
  if outcome is null or outcome not in ('sent','retry','failed','uncertain','skipped') then raise exception 'Invalid delivery outcome'; end if;
  if outcome='sent' and (telegram_message is null or telegram_message<=0) then raise exception 'Delivery receipt required'; end if;
  select * into job from public.e2_viewing_notifications where viewing_id=target and lease_id=lease and status='sending' for update;
  if not found then return false; end if;
  update public.e2_viewing_notifications set
    status=case when outcome='retry' then case when attempts<5 then 'pending' else 'failed' end else outcome end,
    available_at=now()+make_interval(secs=>greatest(1,least(coalesce(retry_seconds,60),86400))),
    message_id=telegram_message,sent_at=case when outcome='sent' then now() end,
    issue=case when outcome in ('sent','skipped') then null else case failure_code
      when 'rate_limit' then 'Telegram rate limit; retry scheduled.'
      when 'telegram_rejected' then 'Telegram rejected delivery; check Bot and channel permissions.'
      when 'not_configured' then 'Telegram is not configured.'
      else 'Delivery not confirmed; check the channel before retrying.' end end,
    lease_until=null
    where viewing_id=target;
  return true;
end;
$$;
create function public.e2_retry_viewing_notification(target uuid) returns void
language plpgsql security definer set search_path='' as $$
begin
  if not public.e2_is_admin() then raise exception 'Admin access required'; end if;
  update public.e2_viewing_notifications set status='pending',attempts=0,available_at=now(),lease_id=null,lease_until=null,issue=null
    where viewing_id=target and status in ('failed','uncertain');
  if not found then raise exception 'Only failed or uncertain notifications can be retried'; end if;
  insert into public.e2_viewing_events(viewing_id,actor,action) values(target,auth.uid(),'NOTIFICATION_RETRY');
end;
$$;

revoke all on function public.e2_next_viewing_salesperson(),public.e2_enqueue_viewing_notification() from public,anon,authenticated,service_role;
revoke all on function public.e2_viewing_rotation_settings(),public.e2_set_viewing_rotation(uuid,boolean),public.e2_retry_viewing_notification(uuid) from public,anon,authenticated;
grant execute on function public.e2_viewing_rotation_settings(),public.e2_set_viewing_rotation(uuid,boolean),public.e2_retry_viewing_notification(uuid) to authenticated;
revoke all on function public.e2_claim_viewing_notification(),public.e2_finish_viewing_notification(uuid,uuid,text,bigint,integer,text) from public,anon,authenticated;
grant execute on function public.e2_claim_viewing_notification(),public.e2_finish_viewing_notification(uuid,uuid,text,bigint,integer,text) to service_role;
commit;
