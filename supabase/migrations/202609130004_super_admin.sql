begin;

alter table public.staff_memberships drop constraint staff_memberships_role_check,
  add constraint staff_memberships_role_check check (role in ('super_admin','admin','sales','account','customer'));
alter table public.staff_memberships add column revision bigint not null default 1;

create function public.e2_is_super_admin() returns boolean
language sql stable security definer set search_path='' as $$
  select exists(select 1 from public.staff_memberships where user_id=auth.uid() and role='super_admin' and active);
$$;
revoke all on function public.e2_is_super_admin() from public;
grant execute on function public.e2_is_super_admin() to authenticated;

create or replace function public.e2_is_admin() returns boolean
language sql stable security definer set search_path='' as $$
  select exists(select 1 from public.staff_memberships where user_id=auth.uid() and role in ('super_admin','admin') and active);
$$;
create or replace function public.e2_can_read_stock() returns boolean
language sql stable security definer set search_path='' as $$
  select exists(select 1 from public.staff_memberships where user_id=auth.uid() and role in ('super_admin','admin','sales') and active);
$$;

create table public.staff_access_audit (
  id bigint generated always as identity primary key,
  actor uuid not null,
  target_user uuid,
  action text not null,
  previous_role text,
  next_role text,
  previous_active boolean,
  next_active boolean,
  occurred_at timestamptz not null default now()
);
alter table public.staff_access_audit enable row level security;
revoke all on public.staff_access_audit from anon, authenticated;
grant select on public.staff_access_audit to authenticated;
create policy super_admin_audit on public.staff_access_audit for select to authenticated
  using ((select public.e2_is_super_admin()));

create function public.e2_list_staff() returns table(user_id uuid,email text,role text,active boolean,revision bigint,email_confirmed boolean)
language plpgsql security definer set search_path='' as $$
begin
  if not public.e2_is_super_admin() then raise exception 'Super Admin access required'; end if;
  return query select m.user_id,u.email::text,m.role,m.active,m.revision,u.email_confirmed_at is not null
    from public.staff_memberships m join auth.users u on u.id=m.user_id order by lower(u.email);
end;
$$;

create function public.e2_update_staff(target_user uuid,new_role text,new_active boolean,expected_revision bigint) returns void
language plpgsql security definer set search_path='' as $$
declare prior public.staff_memberships;
begin
  -- Serialize role changes and recheck the caller after acquiring the lock.
  perform pg_advisory_xact_lock(20260913,4);
  if not public.e2_is_super_admin() then raise exception 'Super Admin access required'; end if;
  if new_role is null or new_role not in ('super_admin','admin','sales','account','customer') or new_active is null then raise exception 'Choose a valid role and status'; end if;
  select * into prior from public.staff_memberships where user_id=target_user for update;
  if not found then raise exception 'User not found'; end if;
  if expected_revision is distinct from prior.revision then raise exception 'Permissions changed in another session. Refresh before saving.'; end if;
  if prior.role='super_admin' and prior.active and (new_role<>'super_admin' or not new_active)
    and (select count(*) from public.staff_memberships where role='super_admin' and active)=1 then
    raise exception 'Keep at least one active Super Admin';
  end if;
  if target_user=auth.uid() then raise exception 'Another Super Admin must change your own access'; end if;
  update public.staff_memberships set role=new_role,active=new_active,revision=revision+1 where user_id=target_user;
  insert into public.staff_access_audit(actor,target_user,action,previous_role,next_role,previous_active,next_active)
    values(auth.uid(),target_user,'UPDATE_ACCESS',prior.role,new_role,prior.active,new_active);
end;
$$;

create function public.e2_add_staff_by_email(target_email text,new_role text) returns uuid
language plpgsql security definer set search_path='' as $$
declare target uuid;
begin
  perform pg_advisory_xact_lock(20260913,4);
  if not public.e2_is_super_admin() then raise exception 'Super Admin access required'; end if;
  if new_role is null or new_role not in ('super_admin','admin','sales','account','customer') then raise exception 'Choose a valid role'; end if;
  select id into target from auth.users where lower(email)=lower(trim(target_email));
  if target is null then raise exception 'Create or invite this Auth account first'; end if;
  if exists(select 1 from public.staff_memberships where user_id=target) then raise exception 'This account is already listed. Edit its existing permissions.'; end if;
  insert into public.staff_memberships(user_id,role,active) values(target,new_role,true);
  insert into public.staff_access_audit(actor,target_user,action,next_role,next_active) values(auth.uid(),target,'ADD_USER',new_role,true);
  return target;
end;
$$;

create function public.e2_check_invite() returns void
language plpgsql security definer set search_path='' as $$
begin
  perform pg_advisory_xact_lock(20260913,4);
  if not public.e2_is_super_admin() then raise exception 'Super Admin access required'; end if;
  if (select count(*) from public.staff_access_audit where actor=auth.uid() and action='INVITE_ATTEMPT' and occurred_at>now()-interval '1 hour')>=20 then raise exception 'Invitation limit reached. Try again later.'; end if;
  insert into public.staff_access_audit(actor,action) values(auth.uid(),'INVITE_ATTEMPT');
end;
$$;

revoke all on function public.e2_list_staff(), public.e2_update_staff(uuid,text,boolean,bigint),
  public.e2_add_staff_by_email(text,text), public.e2_check_invite() from public;
grant execute on function public.e2_list_staff(), public.e2_update_staff(uuid,text,boolean,bigint),
  public.e2_add_staff_by_email(text,text), public.e2_check_invite() to authenticated;

-- Owner elevation is a separate, explicitly reviewed step. No account is promoted here.
commit;
