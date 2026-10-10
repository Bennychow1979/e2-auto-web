-- Follow-up to 202610080001. No accounts, capabilities, institutions or grants are seeded.
-- Staff email is used only as a missing-profile label inside the existing authorized workspace.
-- CREATE OR REPLACE retains the existing function ACLs and all case access checks.
begin;

create or replace function public.e2_assign_finance_admin(target uuid,office uuid,message text,expected_revision bigint) returns public.finance_cases language plpgsql security definer set search_path='' as $$
declare c public.finance_cases;prior uuid;begin
 if expected_revision is null then raise exception 'Case revision required.';end if;
 c:=public.e2_finance_lock_case(target,expected_revision,'dispatch');prior:=c.office_admin;
 if c.handed_at is null then raise exception 'Salesman handover required before assigning a Submission Admin.';end if;
 if not exists(select 1 from public.staff_memberships where user_id=office and active and role in ('office_admin','admin','super_admin')) then raise exception 'Choose an active Submission Admin.';end if;
 -- Preserve reviews, source revisions and audit history when the assignment is unchanged.
 -- Authorization, row locking, revision and staff eligibility checks still run first.
 if prior is not distinct from office then return c;end if;
 if length(btrim(coalesce(message,''))) not between 1 and 2000 then raise exception 'Add an assignment note.';end if;
 update public.finance_cases set office_admin=office,revision=revision+1,updated_at=now() where id=target;
 if c.intake_id is not null then update public.intake_submissions set office_admin=office,revision=revision+1,updated_at=now() where id=c.intake_id;end if;
 update public.finance_applications set status='draft',reviewed_at=null,reviewed_by=null,reviewed_content_revision=null,review_note=null,revision=revision+1,updated_at=now() where case_id=target and submitted_at is null;
 select * into c from public.finance_cases where id=target;
 insert into public.finance_events(case_id,actor,event,note,evidence) values(target,auth.uid(),'submission_admin_assigned',btrim(message),jsonb_build_object('previous_admin',prior,'office_admin',office,'coordinator',c.coordinator));return c;
end;$$;

create or replace function public.e2_finance_workspace(target uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare c public.finance_cases;result jsonb;begin
 if not public.e2_finance_case_access(target) then raise exception 'Assigned case access required.';end if;
 select * into c from public.finance_cases where id=target;
 select jsonb_build_object('case',to_jsonb(c),
  'source',case when c.loan_id is not null then (select to_jsonb(s) from public.loan_applications s where s.id=c.loan_id) else (select to_jsonb(s)-'write_hash' from public.intake_submissions s where s.id=c.intake_id) end,
  'files',case when c.loan_id is not null then coalesce((select jsonb_agg(to_jsonb(d) order by d.created_at,d.id) from public.loan_documents d where d.application_id=c.loan_id and d.state='ready' and d.removed_at is null),'[]'::jsonb) else coalesce((select jsonb_agg(to_jsonb(d) order by d.created_at,d.id) from public.intake_files d where d.submission_id=c.intake_id and d.state='ready'),'[]'::jsonb) end,
  'applications',coalesce((select jsonb_agg(to_jsonb(a) order by a.created_at,a.id) from public.finance_applications a where a.case_id=target),'[]'::jsonb),
  'institutions',coalesce((select jsonb_agg(to_jsonb(i) order by i.name) from public.finance_institutions i where i.active or public.e2_is_super_admin() or exists(select 1 from public.finance_applications a where a.case_id=target and a.institution_id=i.id)),'[]'::jsonb),
  'history',coalesce((select jsonb_agg(to_jsonb(e) order by e.id desc) from public.finance_events e where e.case_id=target),'[]'::jsonb),
  'staff',coalesce((select jsonb_agg(jsonb_build_object('user_id',m.user_id,'display_name',coalesce(nullif(btrim(p.display_name),''),nullif(u.email,''),'Staff '||m.user_id::text),'role',m.role,'active',m.active,'is_dispatcher',m.active and m.role in ('office_admin','admin','super_admin') and exists(select 1 from public.finance_dispatchers d where d.user_id=m.user_id and d.active)) order by coalesce(nullif(btrim(p.display_name),''),nullif(u.email,''),m.user_id::text),m.user_id) from public.staff_memberships m left join public.staff_profiles p on p.user_id=m.user_id left join auth.users u on u.id=m.user_id where (m.active and m.role in ('office_admin','admin','super_admin')) or m.user_id=c.salesperson or m.user_id=c.office_admin or m.user_id=c.coordinator or exists(select 1 from public.finance_applications a where a.case_id=target and a.assignee=m.user_id)),'[]'::jsonb),
  'required_missing',to_jsonb(public.e2_finance_required_missing(target))) into result;
 return result;
end;$$;

commit;
