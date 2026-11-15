begin;

-- Rental permissions are separate grants. Existing staff roles/auth are read only.
create table public.rental_access (
 user_id uuid primary key references auth.users(id) on delete cascade,
 enabled boolean not null default false,
 revision bigint not null default 1,
 updated_at timestamptz not null default now(),
 updated_by uuid references auth.users(id)
);
alter table public.rental_access enable row level security;
revoke all on public.rental_access from public,anon,authenticated;

create function public.rental_ok() returns boolean language sql stable security definer set search_path='' as $$
 select auth.uid() is not null and exists (
  select 1 from public.staff_memberships m where m.user_id=auth.uid() and m.active
  and (m.role='super_admin' or (m.role in ('admin','office_admin') and exists (
   select 1 from public.rental_access a where a.user_id=m.user_id and a.enabled)))
 );
$$;
revoke all on function public.rental_ok() from public,anon;
grant execute on function public.rental_ok() to authenticated;

create function public.rental_date(v text) returns date language plpgsql immutable set search_path='' as $$
begin
 if v is null or v='' then return null; end if;
 if v !~ '^\d{4}-\d{2}-\d{2}$' then raise exception 'Use an ISO date YYYY-MM-DD'; end if;
 return make_date(substr(v,1,4)::int,substr(v,6,2)::int,substr(v,9,2)::int);
end $$;
revoke all on function public.rental_date(text) from public,anon,authenticated;

create table public.rental_contracts (
 id text primary key check(id ~ '^[A-Z0-9-]{1,60}$'),
 data jsonb not null check(jsonb_typeof(data)='object' and octet_length(data::text)<=200000),
 revision bigint not null default 1,
 updated_at timestamptz not null default now(), updated_by uuid references auth.users(id),
 plate text generated always as (data->>'plate') stored,
 owner_name text generated always as (data->>'owner_name') stored,
 owner_phone text generated always as (data->>'owner_phone') stored,
 agent text generated always as (data->>'agent') stored,
 financier text generated always as (data->>'financier') stored,
 account_no text generated always as (data->>'account_no') stored,
 loan_amount numeric generated always as (nullif(data->>'loan_amount','')::numeric) stored,
 monthly numeric generated always as (nullif(data->>'monthly','')::numeric) stored,
 tenure int generated always as (nullif(data->>'tenure','')::int) stored,
 first_payment_date date generated always as (public.rental_date(data->>'first_payment_date')) stored,
 car_status text generated always as (data->>'car_status') stored,
 gps boolean generated always as ((data->>'gps')::boolean) stored,
 spare_key boolean generated always as ((data->>'spare_key')::boolean) stored,
 target_price numeric generated always as (nullif(data->>'target_price','')::numeric) stored,
 adv_installment numeric generated always as (nullif(data->>'adv_installment','')::numeric) stored,
 adv_status text generated always as (data->>'adv_status') stored,
 check_note text generated always as (data->>'check_note') stored
);
create table public.rental_settings (
 id text primary key check(id='lists'), data jsonb not null check(jsonb_typeof(data)='object' and octet_length(data::text)<=100000),
 revision bigint not null default 1, updated_at timestamptz not null default now(), updated_by uuid references auth.users(id)
);
create table public.rental_audit (
 id bigint generated always as identity primary key, at timestamptz not null default now(),
 actor uuid, tbl text not null, row_id text not null, action text not null, old jsonb, new jsonb
);
alter table public.rental_contracts enable row level security;
alter table public.rental_settings enable row level security;
alter table public.rental_audit enable row level security;
revoke all on public.rental_contracts,public.rental_settings,public.rental_audit from public,anon,authenticated;
grant select on public.rental_contracts,public.rental_settings,public.rental_audit to authenticated;
create policy rental_contracts_read on public.rental_contracts for select to authenticated using((select public.rental_ok()));
create policy rental_settings_read on public.rental_settings for select to authenticated using((select public.rental_ok()));
create policy rental_audit_read on public.rental_audit for select to authenticated using((select public.e2_is_super_admin()));

create function public.rental_stamp() returns trigger language plpgsql set search_path='' as $$
begin
 new.updated_at=clock_timestamp(); new.updated_by=auth.uid();
 if tg_op='UPDATE' then new.revision=old.revision+1; else new.revision=1; end if;
 return new;
end $$;
create function public.rental_audit_fn() returns trigger language plpgsql security definer set search_path='' as $$
begin
 insert into public.rental_audit(actor,tbl,row_id,action,old,new)
 values(auth.uid(),tg_table_name,coalesce(to_jsonb(new)->>'id',to_jsonb(old)->>'id',to_jsonb(new)->>'user_id',to_jsonb(old)->>'user_id'),tg_op,to_jsonb(old),to_jsonb(new));
 return null;
end $$;
revoke all on function public.rental_stamp(),public.rental_audit_fn() from public,anon,authenticated;
create trigger rental_contracts_stamp before insert or update on public.rental_contracts for each row execute function public.rental_stamp();
create trigger rental_settings_stamp before insert or update on public.rental_settings for each row execute function public.rental_stamp();
create trigger rental_access_stamp before insert or update on public.rental_access for each row execute function public.rental_stamp();
create trigger rental_contracts_audit after insert or update or delete on public.rental_contracts for each row execute function public.rental_audit_fn();
create trigger rental_settings_audit after insert or update or delete on public.rental_settings for each row execute function public.rental_audit_fn();
create trigger rental_access_audit after insert or update or delete on public.rental_access for each row execute function public.rental_audit_fn();

create function public.rental_list_access() returns table(user_id uuid,email text,role text,active boolean,enabled boolean,revision bigint)
language plpgsql security definer set search_path='' as $$
begin
 if not public.e2_is_super_admin() then raise exception 'Super Admin required' using errcode='42501'; end if;
 return query select m.user_id,u.email::text,m.role,m.active,coalesce(a.enabled,false),coalesce(a.revision,0)
 from public.staff_memberships m join auth.users u on u.id=m.user_id left join public.rental_access a on a.user_id=m.user_id
 where m.role in ('admin','office_admin') or a.user_id is not null order by lower(u.email);
end $$;
create function public.rental_set_access(p_user uuid,p_enabled boolean,p_revision bigint) returns void
language plpgsql security definer set search_path='' as $$
declare prior public.rental_access;
begin
 if not public.e2_is_super_admin() then raise exception 'Super Admin required' using errcode='42501'; end if;
 if p_enabled is null or p_revision is null then raise exception 'Invalid permission change'; end if;
 perform pg_advisory_xact_lock(hashtextextended('rental_access:'||p_user::text,0));
 if p_enabled and not exists(select 1 from public.staff_memberships where user_id=p_user and active and role in ('admin','office_admin')) then raise exception 'Choose an active Admin or Office Admin'; end if;
 select * into prior from public.rental_access where user_id=p_user for update;
 if coalesce(prior.revision,0)<>p_revision then raise exception 'Permissions changed. Refresh before saving.' using errcode='40001'; end if;
 insert into public.rental_access(user_id,enabled) values(p_user,p_enabled)
 on conflict(user_id) do update set enabled=excluded.enabled;
end $$;

-- Writes use revisions so a stale tab cannot overwrite another payment/handover.
create function public.rental_save(p_table text,p_id text,p_data jsonb,p_revision bigint,p_merge boolean default false)
returns jsonb language plpgsql security definer set search_path='' as $$
declare prior jsonb; rev bigint; result jsonb; next_data jsonb;
begin
 if not public.rental_ok() then raise exception 'Rental permission required' using errcode='42501'; end if;
 if p_revision is null or p_revision<0 or p_merge is null or p_data is null or jsonb_typeof(p_data)<>'object' then raise exception 'Invalid rental update'; end if;
 if p_table not in ('contracts','settings') or p_table is null then raise exception 'Unknown rental table'; end if;
 perform pg_advisory_xact_lock(hashtextextended('rental:'||p_table||':'||p_id,0));
 if p_table='contracts' then select data,revision into prior,rev from public.rental_contracts where id=p_id for update;
 else select data,revision into prior,rev from public.rental_settings where id=p_id for update; end if;
 if coalesce(rev,0)<>p_revision or (p_merge and rev is null) then raise exception 'Record changed. Refresh and try again; your change was not saved.' using errcode='40001'; end if;
 next_data=case when p_merge then prior||p_data else p_data end - '_rental_revision';
 if p_table='contracts' then
  if nullif(btrim(next_data->>'plate'),'') is null then raise exception 'Vehicle plate required'; end if;
  if prior is not null and prior->>'plate' is distinct from next_data->>'plate' then raise exception 'Vehicle plate cannot change'; end if;
  if jsonb_typeof(coalesce(next_data->'payments','[]'))<>'array' or jsonb_typeof(coalesce(nullif(next_data->'handovers','null'),'[]'))<>'array' then raise exception 'Invalid payment or handover list'; end if;
  insert into public.rental_contracts(id,data) values(p_id,next_data) on conflict(id) do update set data=excluded.data
  returning jsonb_build_object('id',id,'data',data,'revision',revision) into result;
 else
  insert into public.rental_settings(id,data) values(p_id,next_data) on conflict(id) do update set data=excluded.data
  returning jsonb_build_object('id',id,'data',data,'revision',revision) into result;
 end if;
 return result;
end $$;
revoke all on function public.rental_list_access(),public.rental_set_access(uuid,boolean,bigint),public.rental_save(text,text,jsonb,bigint,boolean) from public,anon;
grant execute on function public.rental_list_access(),public.rental_set_access(uuid,boolean,bigint),public.rental_save(text,text,jsonb,bigint,boolean) to authenticated;
grant all on public.rental_access,public.rental_contracts,public.rental_settings,public.rental_audit to service_role;
grant usage,select on sequence public.rental_audit_id_seq to service_role;

create view public.rental_contracts_flat with(security_invoker=true) as
select id,plate,owner_name,owner_phone,agent,financier,account_no,loan_amount,monthly,tenure,first_payment_date,car_status,gps,spare_key,target_price,adv_installment,adv_status,check_note,
 coalesce((data->>'paid_count_excel')::int,0)+jsonb_array_length(coalesce(data->'payments','[]')) as paid_count,
 updated_at,updated_by,revision from public.rental_contracts;
revoke all on public.rental_contracts_flat from public,anon,authenticated;
grant select on public.rental_contracts_flat to authenticated,service_role;
insert into public.rental_settings(id,data) values('lists','{"agents":[],"financiers":[],"partners":[]}');
do $$ begin
 if exists(select 1 from pg_publication where pubname='supabase_realtime') then
  alter publication supabase_realtime add table public.rental_contracts,public.rental_settings;
 end if;
end $$;
commit;
