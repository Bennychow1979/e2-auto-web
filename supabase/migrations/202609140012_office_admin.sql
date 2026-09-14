begin;
alter table public.staff_memberships drop constraint staff_memberships_role_check, add constraint staff_memberships_role_check check(role in ('super_admin','admin','office_admin','sales','account','customer'));


create or replace function public.e2_update_staff(target_user uuid,new_role text,new_active boolean,expected_revision bigint) returns void
language plpgsql security definer set search_path='' as $$
declare prior public.staff_memberships;
begin
  -- Serialize role changes and recheck the caller after acquiring the lock.
  perform pg_advisory_xact_lock(20260913,4);
  if not public.e2_is_super_admin() then raise exception 'Super Admin access required'; end if;
  if new_role is null or new_role not in ('super_admin','admin','office_admin','sales','account','customer') or new_active is null then raise exception 'Choose a valid role and status'; end if;
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

create or replace function public.e2_add_staff_by_email(target_email text,new_role text) returns uuid
language plpgsql security definer set search_path='' as $$
declare target uuid;
begin
  perform pg_advisory_xact_lock(20260913,4);
  if not public.e2_is_super_admin() then raise exception 'Super Admin access required'; end if;
  if new_role is null or new_role not in ('super_admin','admin','office_admin','sales','account','customer') then raise exception 'Choose a valid role'; end if;
  select id into target from auth.users where lower(email)=lower(trim(target_email));
  if target is null then raise exception 'Create or invite this Auth account first'; end if;
  if exists(select 1 from public.staff_memberships where user_id=target) then raise exception 'This account is already listed. Edit its existing permissions.'; end if;
  insert into public.staff_memberships(user_id,role,active) values(target,new_role,true);
  insert into public.staff_access_audit(actor,target_user,action,next_role,next_active) values(auth.uid(),target,'ADD_USER',new_role,true);
  return target;
end;
$$;

create or replace function public.e2_loan_staff(sales uuid) returns boolean language sql stable security definer set search_path='' as $$
 select public.e2_is_super_admin() or exists(select 1 from public.staff_memberships where user_id=auth.uid() and user_id=sales and active and role in ('sales','admin','office_admin','super_admin'));
$$;

create or replace function public.e2_assign_loan(target uuid,sales uuid,expected_revision bigint) returns public.loan_applications language plpgsql security definer set search_path='' as $$
declare a public.loan_applications;
begin
 if not public.e2_is_super_admin() then raise exception 'Super Admin access required.';end if;
 select * into a from public.loan_applications where id=target and submitted_at is not null for update;
 if not found then raise exception 'Only submitted applications can be assigned.';end if;
 if a.revision is distinct from expected_revision then raise exception 'Application changed. Reload before assigning.';end if;
 if sales is not null and not exists(select 1 from public.staff_memberships where user_id=sales and active and role in ('sales','admin','office_admin','super_admin')) then raise exception 'Choose an active salesperson, Admin or Office Admin.';end if;
 update public.loan_applications set assigned_sales=sales,updated_at=now(),revision=revision+1 where id=target returning * into a;
 insert into public.loan_events(application_id,actor,event) values(target,auth.uid(),'Follow-up reassigned');
 return a;
end;$$;

create or replace function public.e2_intake_access(target uuid) returns boolean language sql stable security definer set search_path='' as $$select exists(select 1 from public.intake_submissions a join public.staff_memberships m on m.user_id=auth.uid() and m.active where a.id=target and a.submitted_at is not null and (m.role='super_admin' or (a.salesperson=m.user_id and m.role in ('sales','admin')) or (a.handed_at is not null and a.office_admin=m.user_id and m.role in ('admin','office_admin'))))$$;

create or replace function public.e2_intake_office_choices() returns table(user_id uuid,display_name text) language sql stable security definer set search_path='' as $$select m.user_id,coalesce(nullif(p.display_name,''),u.email) from public.staff_memberships m join auth.users u on u.id=m.user_id left join public.staff_profiles p on p.user_id=m.user_id where public.e2_intake_active_staff() and m.active and m.role in ('admin','office_admin','super_admin')$$;

create or replace function public.e2_intake_handoff(target uuid,office uuid,message text,expected_revision bigint) returns void language plpgsql security definer set search_path='' as $$declare a public.intake_submissions;begin
 select * into a from public.intake_submissions where id=target for update;
 if not public.e2_intake_active_staff() or not public.e2_intake_access(target) or not (public.e2_is_super_admin() or a.salesperson=auth.uid()) then raise exception 'Only the assigned salesperson or Super Admin can hand over.';end if;
 if a.revision is distinct from expected_revision then raise exception 'Record changed. Reload before saving.';end if;
 if a.status not in ('Received by Salesman','Needs information') then raise exception 'This application has already been handed over.';end if;
 if not exists(select 1 from public.staff_memberships where user_id=office and active and role in ('admin','office_admin','super_admin')) then raise exception 'Choose an active Office Admin.';end if;
 if message is null or length(trim(message)) not between 1 and 1000 then raise exception 'Add a handover note.';end if;
 update public.intake_submissions set office_admin=office,handed_at=now(),status='Sent to Office',updated_at=now(),revision=revision+1 where id=target;
 insert into public.intake_events(submission_id,actor,event,note) values(target,auth.uid(),'Sent to Office',trim(message));
end;$$;

-- Existing function grants are preserved by CREATE OR REPLACE. No account is assigned or promoted here.
commit;
