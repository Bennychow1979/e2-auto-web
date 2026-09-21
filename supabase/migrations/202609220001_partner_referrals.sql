begin;
-- E2 only. Partner identities belong to this project's Auth, never KeretaSB.
create table public.e2_partners (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references auth.users(id),
  display_name text not null check(length(trim(display_name)) between 1 and 100),
  code text not null unique check(code ~ '^[A-Z0-9]{6,24}$'),
  commission_cents integer not null check(commission_cents between 1 and 10000000),
  active boolean not null default true,
  revision bigint not null default 1,
  created_at timestamptz not null default now()
);
create table public.e2_referral_clicks (
  id uuid primary key default gen_random_uuid(),
  partner_id uuid not null references public.e2_partners(id),
  vehicle_id uuid not null references public.vehicles(id),
  visitor_id uuid not null,
  clicked_on date not null default current_date,
  created_at timestamptz not null default now(),
  unique(partner_id,vehicle_id,visitor_id,clicked_on)
);
create table public.e2_referral_leads (
  id uuid primary key default gen_random_uuid(),
  phone text not null unique check(phone ~ '^[1-9][0-9]{7,14}$'),
  customer_name text not null check(length(trim(customer_name)) between 1 and 100),
  partner_id uuid not null references public.e2_partners(id),
  vehicle_id uuid not null references public.vehicles(id),
  salesperson uuid references public.staff_memberships(user_id),
  status text not null default 'New Lead' check(status in ('New Lead','Viewed','Loan Submitted','Approved','Delivered')),
  commission_cents integer not null check(commission_cents between 1 and 10000000),
  contact_verified_at timestamptz,
  delivered_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  revision bigint not null default 1
);
create table public.e2_referral_requests (
  id uuid primary key,
  lead_id uuid not null references public.e2_referral_leads(id),
  vehicle_id uuid not null references public.vehicles(id),
  source text not null check(source in ('whatsapp','phone','viewing')),
  preferred_date date,
  preferred_time text check(preferred_time in ('Morning','Afternoon','Flexible')),
  privacy_version text not null default '2026-09-22',
  created_at timestamptz not null default now()
);
create table public.e2_referral_activities (
  id bigint generated always as identity primary key,
  lead_id uuid references public.e2_referral_leads(id),
  actor uuid,
  action text not null,
  details jsonb not null default '{}',
  created_at timestamptz not null default now()
);
create table public.e2_referral_commissions (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null unique references public.e2_referral_leads(id),
  partner_id uuid not null references public.e2_partners(id),
  amount_cents integer not null check(amount_cents between 1 and 10000000),
  currency text not null default 'MYR' check(currency='MYR'),
  status text not null default 'Pending' check(status in ('Pending','Approved','Paid')),
  approved_by uuid,
  approved_at timestamptz,
  paid_by uuid,
  paid_at timestamptz,
  payment_reference text,
  revision bigint not null default 1,
  created_at timestamptz not null default now()
);
create index on public.e2_referral_leads(partner_id);
create index on public.e2_referral_leads(salesperson);
create index on public.e2_referral_requests(lead_id,created_at);
create index on public.e2_referral_activities(lead_id);
create index on public.e2_referral_commissions(partner_id);

alter table public.e2_partners enable row level security;
alter table public.e2_referral_clicks enable row level security;
alter table public.e2_referral_leads enable row level security;
alter table public.e2_referral_requests enable row level security;
alter table public.e2_referral_activities enable row level security;
alter table public.e2_referral_commissions enable row level security;
revoke all on public.e2_partners,public.e2_referral_clicks,public.e2_referral_leads,public.e2_referral_requests,public.e2_referral_activities,public.e2_referral_commissions from public,anon,authenticated;
grant select on public.e2_partners,public.e2_referral_leads,public.e2_referral_requests,public.e2_referral_activities,public.e2_referral_commissions to authenticated;

create function public.e2_partner_id() returns uuid language sql stable security definer set search_path='' as $$
  select p.id from public.e2_partners p join auth.users u on u.id=p.user_id
  where p.user_id=auth.uid() and p.active and u.email_confirmed_at is not null;
$$;
create function public.e2_referral_access(target uuid) returns boolean language sql stable security definer set search_path='' as $$
  select public.e2_is_admin() or exists(select 1 from public.e2_referral_leads l
    join public.staff_memberships m on m.user_id=l.salesperson
    where l.id=target and m.user_id=auth.uid() and m.role='sales' and m.active);
$$;
create policy partner_read on public.e2_partners for select to authenticated using(public.e2_is_admin() or id=public.e2_partner_id());
create policy lead_read on public.e2_referral_leads for select to authenticated using(public.e2_referral_access(id));
create policy request_read on public.e2_referral_requests for select to authenticated using(public.e2_referral_access(lead_id));
create policy activity_read on public.e2_referral_activities for select to authenticated using(public.e2_is_admin() or public.e2_referral_access(lead_id));
create policy commission_read on public.e2_referral_commissions for select to authenticated using(public.e2_is_admin() or partner_id=public.e2_partner_id());

-- Admin attaches a separately created, confirmed E2 Auth account; no credentials in tables.
create function public.e2_save_partner(target_email text, partner_name text, rate_cents integer, enabled boolean, expected_revision bigint)
returns uuid language plpgsql security definer set search_path='' as $$
declare target uuid; prior public.e2_partners; saved uuid;
begin
  perform pg_advisory_xact_lock(20260922,1);
  if not public.e2_is_admin() then raise exception 'Admin access required'; end if;
  select id into target from auth.users where lower(email)=lower(trim(target_email)) and email_confirmed_at is not null;
  if target is null then raise exception 'Create and confirm a dedicated E2 Partner Auth account first'; end if;
  if exists(select 1 from public.staff_memberships where user_id=target) or exists(select 1 from public.customer_profiles where user_id=target)
    then raise exception 'Use a separate Partner account, not a staff or customer account'; end if;
  select * into prior from public.e2_partners where user_id=target for update;
  if expected_revision is distinct from coalesce(prior.revision,0) then raise exception 'Partner changed. Refresh first'; end if;
  insert into public.e2_partners(user_id,display_name,code,commission_cents,active)
    values(target,trim(partner_name),'E2'||upper(substr(replace(gen_random_uuid()::text,'-',''),1,16)),rate_cents,enabled)
    on conflict(user_id) do update set display_name=excluded.display_name,commission_cents=excluded.commission_cents,active=excluded.active,revision=e2_partners.revision+1
    returning id into saved;
  insert into public.e2_referral_activities(actor,action,details) values(auth.uid(),'PARTNER_SAVED',jsonb_build_object('partner_id',saved,'rate_cents',rate_cents,'active',enabled));
  return saved;
end;
$$;

-- Only a name/code is public. Counts are deduplicated browser visits, not verified people.
create function public.e2_track_partner_click(ref_code text, car_id uuid, visitor uuid)
returns table(display_name text, code text) language plpgsql security definer set search_path='' as $$
declare p public.e2_partners;
begin
  if ref_code is null or length(ref_code)>24 or visitor is null then return; end if;
  select * into p from public.e2_partners where e2_partners.code=upper(ref_code) and active;
  if p.id is null or not exists(select 1 from public.vehicles where id=car_id and publication='published') then return; end if;
  perform pg_advisory_xact_lock(hashtext(p.id::text),20260922);
  -- Bounded daily storage. This is not a bot-proof analytics service.
  if (select count(*) from public.e2_referral_clicks where partner_id=p.id and clicked_on=current_date)<10000 then
    insert into public.e2_referral_clicks(partner_id,vehicle_id,visitor_id) values(p.id,car_id,visitor) on conflict do nothing;
  end if;
  return query select p.display_name,p.code;
end;
$$;

create function public.e2_submit_referral(request_id uuid, ref_code text, car_id uuid, customer_name text, customer_phone text,
  enquiry_source text, consent boolean, sales_id uuid default null, view_date date default null, view_time text default null)
returns uuid language plpgsql security definer set search_path='' as $$
declare p public.e2_partners; l public.e2_referral_leads; phone_key text; recipient uuid; prior public.e2_referral_requests;
begin
  if consent is distinct from true then raise exception 'Please agree to the contact notice'; end if;
  if request_id is null or ref_code is null or length(ref_code)>24 or customer_phone is null or length(customer_phone)>32 or customer_phone !~ '^\+?[0-9 ()-]+$'
    or customer_name is null or length(trim(customer_name)) not between 1 and 100 or enquiry_source is null or enquiry_source not in ('whatsapp','phone','viewing')
    then raise exception 'Enter a valid name, phone number and enquiry'; end if;
  phone_key:=regexp_replace(customer_phone,'[^0-9]','','g');
  if phone_key like '00%' then phone_key:=substr(phone_key,3); end if;
  if phone_key like '0%' then phone_key:='60'||substr(phone_key,2); end if;
  if phone_key !~ '^[1-9][0-9]{7,14}$' then raise exception 'Enter your phone number with country code'; end if;
  if enquiry_source='viewing' and (view_date is null or view_date<(now() at time zone 'Asia/Kuala_Lumpur')::date or view_date>(now() at time zone 'Asia/Kuala_Lumpur')::date+90 or view_time is null or view_time not in ('Morning','Afternoon','Flexible'))
    then raise exception 'Choose a viewing preference within 90 days'; end if;
  perform pg_advisory_xact_lock(hashtext(phone_key),20260922);
  select * into prior from public.e2_referral_requests where id=request_id;
  if found then
    if not exists(select 1 from public.e2_referral_leads where id=prior.lead_id and phone=phone_key) then raise exception 'Use a new enquiry reference'; end if;
    return request_id;
  end if;
  select * into p from public.e2_partners where code=upper(ref_code) and active for share;
  if p.id is null then raise exception 'This Partner link is no longer active. Contact E2 directly'; end if;
  if not exists(select 1 from public.vehicles where id=car_id and publication='published' and stock_status='Available') then raise exception 'Vehicle is unavailable. Contact E2 directly'; end if;
  select user_id into recipient from public.staff_memberships where user_id=sales_id and active and role in ('sales','admin','super_admin');
  select * into l from public.e2_referral_leads where phone=phone_key for update;
  if l.id is null then
    -- First identified enquiry wins. Neither later links nor a different car overwrite it.
    insert into public.e2_referral_leads(phone,customer_name,partner_id,vehicle_id,salesperson,commission_cents)
      values(phone_key,trim(customer_name),p.id,car_id,recipient,p.commission_cents) returning * into l;
    insert into public.e2_referral_activities(lead_id,action) values(l.id,'REFERRAL_LOCKED');
  end if;
  if (select count(*) from public.e2_referral_requests where lead_id=l.id and created_at>now()-interval '1 hour')>=5 then raise exception 'Too many enquiries. Please contact E2 directly'; end if;
  insert into public.e2_referral_requests(id,lead_id,vehicle_id,source,preferred_date,preferred_time)
    values(request_id,l.id,car_id,enquiry_source,case when enquiry_source='viewing' then view_date end,case when enquiry_source='viewing' then view_time end);
  insert into public.e2_referral_activities(lead_id,action,details) values(l.id,'ENQUIRY_RECEIVED',jsonb_build_object('request_id',request_id,'vehicle_id',car_id,'source',enquiry_source));
  -- Never disclose an existing customer's ID, name, stage or original referrer to callers.
  return request_id;
end;
$$;

create function public.e2_progress_referral(target uuid, next_status text, expected_revision bigint, confirm_contact boolean default false,
  assigned_sales uuid default null, selected_vehicle uuid default null)
returns void language plpgsql security definer set search_path='' as $$
declare l public.e2_referral_leads; stages text[]:=array['New Lead','Viewed','Loan Submitted','Approved','Delivered'];
begin
  select * into l from public.e2_referral_leads where id=target for update;
  if l.id is null or not public.e2_referral_access(target) then raise exception 'Lead access required'; end if;
  if expected_revision is distinct from l.revision then raise exception 'Lead changed. Refresh first'; end if;
  if next_status is null or array_position(stages,next_status) is null or array_position(stages,next_status)<array_position(stages,l.status)
    or array_position(stages,next_status)>array_position(stages,l.status)+1 then raise exception 'Move to the next stage in order'; end if;
  if l.status='Delivered' then raise exception 'Delivered lead is closed'; end if;
  if next_status='Delivered' and not public.e2_is_admin() then raise exception 'Admin must confirm delivery'; end if;
  if next_status<>'New Lead' and l.contact_verified_at is null and confirm_contact is distinct from true then raise exception 'Confirm that you contacted this customer first'; end if;
  if assigned_sales is distinct from l.salesperson then
    if not public.e2_is_admin() then raise exception 'Admin must assign sales'; end if;
    if assigned_sales is not null and not exists(select 1 from public.staff_memberships where user_id=assigned_sales and active and role in ('sales','admin','super_admin')) then raise exception 'Choose active sales staff'; end if;
  end if;
  if selected_vehicle is not null and not exists(select 1 from public.vehicles where id=selected_vehicle) then raise exception 'Vehicle not found'; end if;
  update public.e2_referral_leads set status=next_status,salesperson=assigned_sales,vehicle_id=coalesce(selected_vehicle,vehicle_id),
    contact_verified_at=case when confirm_contact is true then coalesce(contact_verified_at,now()) else contact_verified_at end,
    delivered_at=case when next_status='Delivered' then now() else null end,updated_at=now(),revision=revision+1 where id=target;
  insert into public.e2_referral_activities(lead_id,actor,action,details) values(target,auth.uid(),'LEAD_UPDATED',jsonb_build_object('from',l.status,'to',next_status,'salesperson',assigned_sales,'vehicle_id',coalesce(selected_vehicle,l.vehicle_id),'contact_confirmed',confirm_contact));
  if next_status='Delivered' then
    insert into public.e2_referral_commissions(lead_id,partner_id,amount_cents) values(l.id,l.partner_id,l.commission_cents);
  end if;
end;
$$;

create function public.e2_pay_referral(target uuid, next_status text, expected_revision bigint, reference text default null)
returns void language plpgsql security definer set search_path='' as $$
declare c public.e2_referral_commissions;
begin
  if not public.e2_is_admin() then raise exception 'Admin access required'; end if;
  select * into c from public.e2_referral_commissions where id=target for update;
  if c.id is null or c.revision is distinct from expected_revision then raise exception 'Commission changed. Refresh first'; end if;
  if not exists(select 1 from public.e2_referral_leads where id=c.lead_id and status='Delivered' and contact_verified_at is not null) then raise exception 'Verified delivery required'; end if;
  if not ((c.status='Pending' and next_status='Approved') or (c.status='Approved' and next_status='Paid')) or next_status is null then raise exception 'Approve before marking paid'; end if;
  if next_status='Paid' and (reference is null or length(trim(reference)) not between 1 and 120) then raise exception 'Enter the actual payment reference'; end if;
  update public.e2_referral_commissions set status=next_status,revision=revision+1,
    approved_by=case when next_status='Approved' then auth.uid() else approved_by end,approved_at=case when next_status='Approved' then now() else approved_at end,
    paid_by=case when next_status='Paid' then auth.uid() else paid_by end,paid_at=case when next_status='Paid' then now() else paid_at end,
    payment_reference=case when next_status='Paid' then trim(reference) else null end where id=target;
  insert into public.e2_referral_activities(lead_id,actor,action,details) values(c.lead_id,auth.uid(),'COMMISSION_'||upper(next_status),jsonb_build_object('commission_id',c.id));
end;
$$;

create function public.e2_partner_summary() returns jsonb language plpgsql stable security definer set search_path='' as $$
declare p uuid:=public.e2_partner_id();
begin
  if p is null then raise exception 'Active Partner account required'; end if;
  return jsonb_build_object('clicks',(select count(*) from public.e2_referral_clicks where partner_id=p),
    'leads',coalesce((select jsonb_agg(jsonb_build_object('id',id,'status',status,'created_at',created_at) order by created_at desc) from public.e2_referral_leads where partner_id=p),'[]'::jsonb));
end;
$$;

create function public.e2_partner_accounts() returns table(id uuid,email text,display_name text,code text,commission_cents integer,active boolean,revision bigint)
language plpgsql stable security definer set search_path='' as $$
begin
  if not public.e2_is_admin() then raise exception 'Admin access required'; end if;
  return query select p.id,u.email::text,p.display_name,p.code,p.commission_cents,p.active,p.revision
    from public.e2_partners p join auth.users u on u.id=p.user_id order by p.created_at,p.id;
end;
$$;
create function public.e2_referral_partner_labels() returns table(id uuid,display_name text)
language sql stable security definer set search_path='' as $$
  select p.id,p.display_name from public.e2_partners p where public.e2_is_admin() or exists(
    select 1 from public.e2_referral_leads l where l.partner_id=p.id and public.e2_referral_access(l.id));
$$;

-- Explicit grants withstand Supabase's default function privileges.
revoke all on function public.e2_partner_id(),public.e2_referral_access(uuid),public.e2_save_partner(text,text,integer,boolean,bigint),
 public.e2_track_partner_click(text,uuid,uuid),public.e2_submit_referral(uuid,text,uuid,text,text,text,boolean,uuid,date,text),
 public.e2_progress_referral(uuid,text,bigint,boolean,uuid,uuid),public.e2_pay_referral(uuid,text,bigint,text),public.e2_partner_summary(),public.e2_partner_accounts(),public.e2_referral_partner_labels() from public,anon,authenticated;
grant execute on function public.e2_partner_id(),public.e2_referral_access(uuid),public.e2_save_partner(text,text,integer,boolean,bigint),
 public.e2_progress_referral(uuid,text,bigint,boolean,uuid,uuid),public.e2_pay_referral(uuid,text,bigint,text),public.e2_partner_summary(),public.e2_partner_accounts(),public.e2_referral_partner_labels() to authenticated;
grant execute on function public.e2_track_partner_click(text,uuid,uuid),public.e2_submit_referral(uuid,text,uuid,text,text,text,boolean,uuid,date,text) to anon,authenticated;
commit;
