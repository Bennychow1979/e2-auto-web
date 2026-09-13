begin;
create table public.loan_applications(
 id uuid primary key default gen_random_uuid(),customer_id uuid not null references auth.users(id) on delete cascade,
 vehicle_id uuid not null references public.vehicles(id),assigned_sales uuid references public.staff_memberships(user_id),
 vehicle_summary jsonb not null,details jsonb not null default '{}',last_step integer not null default 0 check(last_step between 0 and 6),
 status text not null default 'Draft' check(status in ('Draft','Submitted to E2','Needs information','Ready for financier','Submitted to financier','Outcome recorded','Withdrawn')),
 privacy_version text not null default '2026-09-14' check(privacy_version='2026-09-14'),privacy_accepted_at timestamptz not null default now(),
 submitted_at timestamptz,confirmed_at timestamptz,created_at timestamptz not null default now(),updated_at timestamptz not null default now(),revision bigint not null default 1,
 check(jsonb_typeof(details)='object' and octet_length(details::text)<=30000)
);
create index loan_customer_updated on public.loan_applications(customer_id,updated_at desc);
create index loan_sales_updated on public.loan_applications(assigned_sales,updated_at desc) where submitted_at is not null;
create function public.e2_loan_staff(sales uuid) returns boolean language sql stable security definer set search_path='' as $$
 select public.e2_is_super_admin() or exists(select 1 from public.staff_memberships where user_id=auth.uid() and user_id=sales and active and role in ('sales','admin','super_admin'));
$$;
revoke all on function public.e2_loan_staff(uuid) from public,anon,authenticated;
grant execute on function public.e2_loan_staff(uuid) to authenticated;
alter table public.loan_applications enable row level security;
revoke all on public.loan_applications from anon,authenticated;
grant select on public.loan_applications to authenticated;
create policy loan_owner on public.loan_applications for select to authenticated using(customer_id=auth.uid() and public.e2_customer_allowed());
create policy loan_followup on public.loan_applications for select to authenticated using(submitted_at is not null and public.e2_loan_staff(assigned_sales));

create table public.loan_events(
 id bigint generated always as identity primary key,application_id uuid not null references public.loan_applications(id) on delete cascade,
 actor uuid references auth.users(id),event text not null,note text not null default '' check(length(note)<=1000),created_at timestamptz not null default now()
);
alter table public.loan_events enable row level security;
revoke all on public.loan_events from anon,authenticated;
grant select on public.loan_events to authenticated;
create policy visible_loan_events on public.loan_events for select to authenticated using(exists(select 1 from public.loan_applications a where a.id=application_id));

create function public.e2_start_loan(vehicle uuid,sales uuid default null,accept_privacy boolean default false) returns public.loan_applications language plpgsql security definer set search_path='' as $$
declare v public.vehicles; a public.loan_applications;
begin
 if not public.e2_customer_allowed() then raise exception 'Confirm your email and sign in.';end if;
 if accept_privacy is distinct from true then raise exception 'Read and accept the loan privacy notice before creating a draft.';end if;
 select * into v from public.vehicles where id=vehicle and publication='published' and stock_status='Available';
 if not found then raise exception 'This vehicle is not currently available for a new application.';end if;
 if sales is not null and not exists(select 1 from public.staff_profiles p join public.staff_memberships m on m.user_id=p.user_id where p.user_id=sales and p.is_public and m.active and m.role in ('sales','admin','super_admin')) then raise exception 'This salesperson is not available. Choose E2 team or a current salesperson.';end if;
 perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text,140008));
 select * into a from public.loan_applications where customer_id=auth.uid() and vehicle_id=vehicle and status not in ('Withdrawn','Outcome recorded') order by created_at desc limit 1;
 if found then return a;end if;
 if (select count(*) from public.loan_applications where customer_id=auth.uid() and status not in ('Withdrawn','Outcome recorded'))>=10 then raise exception 'You have 10 active applications. Contact E2 before starting another.';end if;
 insert into public.loan_applications(customer_id,vehicle_id,assigned_sales,vehicle_summary) values(auth.uid(),vehicle,sales,jsonb_build_object('name',v.brand||' '||v.model,'plate',v.plate,'year',v.year,'variant',v.variant,'price',v.price)) returning * into a;
 return a;
end;$$;
revoke all on function public.e2_start_loan(uuid,uuid,boolean) from public,anon,authenticated;
grant execute on function public.e2_start_loan(uuid,uuid,boolean) to authenticated;

-- e2_validate_loan_details is defined in the following migration and required before enabling the UI.
commit;
