begin;
create table public.customer_profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  full_name text not null check(length(trim(full_name)) between 1 and 100),
  phone text not null check(phone ~ '^[1-9][0-9]{7,14}$'),
  state text not null default '' check(length(state)<=60),
  city text not null default '' check(length(city)<=80),
  language text not null default '' check(language in ('','English','Bahasa Melayu','中文','தமிழ்','Other')),
  budget_min numeric(12,2) check(budget_min between 0 and 9999999),
  budget_max numeric(12,2) check(budget_max between 0 and 9999999),
  desired_car text not null default '' check(length(desired_car)<=200),
  purchase_timeline text not null default '' check(purchase_timeline in ('','Within 1 month','1–3 months','3–6 months','Just exploring')),
  payment_preference text not null default '' check(payment_preference in ('','Cash','Financing','Undecided')),
  trade_in text not null default '' check(trade_in in ('','Yes','No','Undecided')),
  trade_in_details text not null default '' check(length(trade_in_details)<=200),
  privacy_version text not null check(privacy_version='2026-09-13'),
  privacy_accepted_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  revision bigint not null default 1,
  check(budget_min is null or budget_max is null or budget_min<=budget_max)
);
alter table public.customer_profiles enable row level security;
revoke all on public.customer_profiles from anon,authenticated;
grant select on public.customer_profiles to authenticated;

create function public.e2_customer_allowed() returns boolean
language sql stable security definer set search_path='' as $$
  select exists(select 1 from auth.users where id=auth.uid() and email_confirmed_at is not null)
    and not exists(select 1 from public.staff_memberships where user_id=auth.uid() and not active);
$$;
revoke all on function public.e2_customer_allowed() from public;
grant execute on function public.e2_customer_allowed() to authenticated;
create policy customer_own_read on public.customer_profiles for select to authenticated
  using(user_id=(select auth.uid()) and (select public.e2_customer_allowed()));
create policy customer_admin_read on public.customer_profiles for select to authenticated
  using((select public.e2_is_admin()));

create function public.e2_save_customer_profile(details jsonb, expected_revision bigint, accept_privacy boolean default false)
returns public.customer_profiles language plpgsql security definer set search_path='' as $$
declare prior public.customer_profiles; saved public.customer_profiles; target uuid:=auth.uid();
begin
  if not public.e2_customer_allowed() then raise exception 'Confirm your email and sign in with an active account.';end if;
  if jsonb_typeof(details) is distinct from 'object' or octet_length(details::text)>6000 then raise exception 'Enter valid profile details.';end if;
  perform pg_advisory_xact_lock(hashtext(target::text),20260913);
  select * into prior from public.customer_profiles where user_id=target for update;
  if expected_revision is distinct from coalesce(prior.revision,0) then raise exception 'Your profile changed in another session. Reload before saving.';end if;
  if prior.user_id is null and accept_privacy is distinct from true then raise exception 'Read and accept the customer privacy notice.';end if;
  insert into public.customer_profiles(user_id,full_name,phone,state,city,language,budget_min,budget_max,desired_car,purchase_timeline,payment_preference,trade_in,trade_in_details,privacy_version)
  values(target,trim(coalesce(details->>'full_name','')),coalesce(details->>'phone',''),trim(coalesce(details->>'state','')),trim(coalesce(details->>'city','')),coalesce(details->>'language',''),nullif(details->>'budget_min','')::numeric,nullif(details->>'budget_max','')::numeric,trim(coalesce(details->>'desired_car','')),coalesce(details->>'purchase_timeline',''),coalesce(details->>'payment_preference',''),coalesce(details->>'trade_in',''),trim(coalesce(details->>'trade_in_details','')),'2026-09-13')
  on conflict(user_id) do update set full_name=excluded.full_name,phone=excluded.phone,state=excluded.state,city=excluded.city,language=excluded.language,budget_min=excluded.budget_min,budget_max=excluded.budget_max,desired_car=excluded.desired_car,purchase_timeline=excluded.purchase_timeline,payment_preference=excluded.payment_preference,trade_in=excluded.trade_in,trade_in_details=excluded.trade_in_details,updated_at=now(),revision=customer_profiles.revision+1
  returning * into saved;
  return saved;
end;
$$;
revoke all on function public.e2_save_customer_profile(jsonb,bigint,boolean) from public;
grant execute on function public.e2_save_customer_profile(jsonb,bigint,boolean) to authenticated;

create function public.e2_list_customers(search_text text default '', page_offset integer default 0)
returns table(user_id uuid,email text,profile jsonb)
language plpgsql stable security definer set search_path='' as $$
begin
  if not public.e2_is_admin() then raise exception 'Admin access required.';end if;
  if page_offset is null or page_offset<0 or length(coalesce(search_text,''))>100 then raise exception 'Invalid search.';end if;
  return query select c.user_id,u.email::text,to_jsonb(c) from public.customer_profiles c join auth.users u on u.id=c.user_id
    where coalesce(search_text,'')='' or strpos(lower(c.full_name||' '||c.phone||' '||u.email||' '||c.desired_car),lower(search_text))>0
    order by c.created_at desc,c.user_id limit 50 offset page_offset;
end;
$$;
revoke all on function public.e2_list_customers(text,integer) from public;
grant execute on function public.e2_list_customers(text,integer) to authenticated;
commit;
