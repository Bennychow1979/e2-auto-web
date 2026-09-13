begin;
create function public.e2_save_loan(target uuid,details jsonb,step integer,expected_revision bigint) returns public.loan_applications language plpgsql security definer set search_path='' as $$
declare a public.loan_applications; clean jsonb;
begin
 if not public.e2_customer_allowed() then raise exception 'Confirm your email and sign in.';end if;
 select * into a from public.loan_applications where id=target and customer_id=auth.uid() for update;
 if not found then raise exception 'Application not available.';end if;
 if a.status not in ('Draft','Needs information') then raise exception 'This submitted application is read-only. E2 can request an update if needed.';end if;
 if a.revision is distinct from expected_revision then raise exception 'This application changed in another session. Reload before saving.';end if;
 if step is null or step not between 0 and 6 then raise exception 'Invalid application step.';end if;
 clean:=public.e2_validate_loan_details(details,false,(a.vehicle_summary->>'price')::numeric);
 update public.loan_applications set details=clean,last_step=step,updated_at=now(),revision=revision+1 where id=target returning * into a;
 return a;
end;$$;
create function public.e2_submit_loan(target uuid,expected_revision bigint,confirm_details boolean,confirm_contacts boolean) returns public.loan_applications language plpgsql security definer set search_path='' as $$
declare a public.loan_applications; clean jsonb;
begin
 if not public.e2_customer_allowed() then raise exception 'Confirm your email and sign in.';end if;
 select * into a from public.loan_applications where id=target and customer_id=auth.uid() for update;
 if not found then raise exception 'Application not available.';end if;
 if a.status not in ('Draft','Needs information') then raise exception 'This application has already been submitted.';end if;
 if a.revision is distinct from expected_revision then raise exception 'Application changed. Reload before submitting.';end if;
 if confirm_details is distinct from true or confirm_contacts is distinct from true then raise exception 'Confirm your details and permission to provide contact and guarantor information.';end if;
 if not exists(select 1 from public.vehicles where id=a.vehicle_id and publication='published' and stock_status='Available') then raise exception 'Vehicle availability changed. Contact E2 before submitting.';end if;
 clean:=public.e2_validate_loan_details(a.details,true,(a.vehicle_summary->>'price')::numeric);
 update public.loan_applications set details=clean,status='Submitted to E2',last_step=6,submitted_at=coalesce(submitted_at,now()),confirmed_at=now(),updated_at=now(),revision=revision+1 where id=target returning * into a;
 insert into public.loan_events(application_id,actor,event) values(target,auth.uid(),'Submitted to E2');
 return a;
end;$$;
create function public.e2_update_loan_status(target uuid,next_status text,message text,expected_revision bigint) returns public.loan_applications language plpgsql security definer set search_path='' as $$
declare a public.loan_applications;
begin
 select * into a from public.loan_applications where id=target and submitted_at is not null for update;
 if not found or not public.e2_loan_staff(a.assigned_sales) then raise exception 'Application follow-up access required.';end if;
 if a.revision is distinct from expected_revision then raise exception 'Application changed. Reload before updating.';end if;
 if next_status is null or not ((a.status='Submitted to E2' and next_status in ('Needs information','Ready for financier')) or (a.status='Ready for financier' and next_status in ('Needs information','Submitted to financier')) or (a.status='Submitted to financier' and next_status in ('Needs information','Outcome recorded'))) then raise exception 'This status change is not available.';end if;
 if length(trim(coalesce(message,''))) not between 1 and 1000 then raise exception 'Add a short customer-facing explanation or actual outcome.';end if;
 update public.loan_applications set status=next_status,updated_at=now(),revision=revision+1 where id=target returning * into a;
 insert into public.loan_events(application_id,actor,event,note) values(target,auth.uid(),next_status,trim(message));
 return a;
end;$$;
create function public.e2_assign_loan(target uuid,sales uuid,expected_revision bigint) returns public.loan_applications language plpgsql security definer set search_path='' as $$
declare a public.loan_applications;
begin
 if not public.e2_is_super_admin() then raise exception 'Super Admin access required.';end if;
 select * into a from public.loan_applications where id=target and submitted_at is not null for update;
 if not found then raise exception 'Only submitted applications can be assigned.';end if;
 if a.revision is distinct from expected_revision then raise exception 'Application changed. Reload before assigning.';end if;
 if sales is not null and not exists(select 1 from public.staff_memberships where user_id=sales and active and role in ('sales','admin','super_admin')) then raise exception 'Choose an active salesperson or Admin.';end if;
 update public.loan_applications set assigned_sales=sales,updated_at=now(),revision=revision+1 where id=target returning * into a;
 insert into public.loan_events(application_id,actor,event) values(target,auth.uid(),'Follow-up reassigned');
 return a;
end;$$;
revoke all on function public.e2_save_loan(uuid,jsonb,integer,bigint),public.e2_submit_loan(uuid,bigint,boolean,boolean),public.e2_update_loan_status(uuid,text,text,bigint),public.e2_assign_loan(uuid,uuid,bigint) from public,anon,authenticated;
grant execute on function public.e2_save_loan(uuid,jsonb,integer,bigint),public.e2_submit_loan(uuid,bigint,boolean,boolean),public.e2_update_loan_status(uuid,text,text,bigint),public.e2_assign_loan(uuid,uuid,bigint) to authenticated;
commit;
