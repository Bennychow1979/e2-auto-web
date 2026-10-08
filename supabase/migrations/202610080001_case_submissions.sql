-- Internal tracking only. These RPCs never contact a financier, send email, or store credentials.
-- Existing untracked sources retain their legacy workflow. Tracking explicitly opts a submitted
-- source into the checked workflow; generic handoff/progress RPCs cannot bypass it thereafter.
begin;

create table public.finance_institutions (
 id uuid primary key default gen_random_uuid(), name text not null check(length(btrim(name)) between 1 and 120),
 kind text not null check(kind in ('bank','credit_company')), portal_url text, email_to text,
 required_documents text[] not null default '{}', active boolean not null default true,
 revision bigint not null default 1, created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
-- Explicit, revocable global access to submitted financing sources and case dispatch only.
-- No memberships or capabilities are seeded; display names are never authorization keys.
create table public.finance_dispatchers (
 user_id uuid primary key references public.staff_memberships(user_id), active boolean not null default true,
 revision bigint not null default 1, updated_at timestamptz not null default now()
);
create table public.finance_cases (
 id uuid primary key default gen_random_uuid(), intake_id uuid unique references public.intake_submissions(id),
 loan_id uuid unique references public.loan_applications(id), case_name text not null check(length(btrim(case_name)) between 1 and 160),
 salesperson uuid references public.staff_memberships(user_id), coordinator uuid references public.staff_memberships(user_id), office_admin uuid references public.staff_memberships(user_id),
 handed_at timestamptz, handoff_note text not null default '',
 review_state text not null default 'pending' check(review_state in ('pending','needs_information','complete')),
 missing_items text[] not null default '{}', review_note text not null default '',
 content_revision bigint not null default 1, reviewed_content_revision bigint, reviewed_by uuid references auth.users(id), reviewed_at timestamptz,
 selected_application_id uuid, selection_evidence text, selected_by uuid references auth.users(id), selected_at timestamptz,
 revision bigint not null default 1, created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 check(num_nonnulls(intake_id,loan_id)=1), check(handed_at is null or office_admin is not null or coordinator is not null),
 check(review_state<>'complete' or (reviewed_by is not null and reviewed_at is not null and reviewed_content_revision=content_revision and cardinality(missing_items)=0))
);
create table public.finance_applications (
 id uuid primary key default gen_random_uuid(), case_id uuid not null references public.finance_cases(id),
 institution_id uuid not null references public.finance_institutions(id), institution_name text not null, institution_revision bigint not null,
 assignee uuid not null references public.staff_memberships(user_id), channel text not null check(channel in ('portal','email')),
 portal_url text, email_to text, email_subject text not null default '' check(length(email_subject)<=200 and email_subject !~ E'[\\r\\n]'),
 email_body text not null default '' check(length(email_body)<=12000), attachment_ids uuid[] not null default '{}', attachment_manifest jsonb not null default '[]' check(jsonb_typeof(attachment_manifest)='array'),
 missing_documents text[] not null default '{}', note text not null default '' check(length(note)<=2000),
 status text not null default 'draft' check(status in ('draft','ready','submitted','under_review','needs_information','approved','rejected','withdrawn')),
 reviewed_at timestamptz, reviewed_by uuid references auth.users(id), reviewed_content_revision bigint, review_note text,
 submitted_at timestamptz, submitted_by uuid references auth.users(id), external_reference text, submission_evidence text,
 offer_amount numeric(14,2) check(offer_amount>0 and offer_amount<=100000000),
 offer_rate numeric(7,4) check(offer_rate>=0 and offer_rate<=100),
 offer_tenure_months integer check(offer_tenure_months between 1 and 120),
 revision bigint not null default 1, created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 unique(case_id,id),
 check((status in ('draft','ready') and submitted_at is null) or (status not in ('draft','ready') and submitted_at is not null and submitted_by is not null and length(btrim(external_reference)) between 1 and 200 and length(btrim(submission_evidence)) between 10 and 2000)),
 check(status<>'approved' or (offer_amount is not null and offer_rate is not null and offer_tenure_months is not null))
);
alter table public.finance_cases add constraint finance_selected_same_case foreign key(id,selected_application_id) references public.finance_applications(case_id,id);
create index finance_applications_case on public.finance_applications(case_id,created_at);
create table public.finance_events (
 id bigint generated always as identity primary key, case_id uuid not null references public.finance_cases(id),
 application_id uuid references public.finance_applications(id), actor uuid references auth.users(id),
 event text not null, note text not null default '', evidence jsonb not null default '{}', created_at timestamptz not null default now()
);
create index finance_events_case on public.finance_events(case_id,id);
alter table public.finance_dispatchers enable row level security;
alter table public.finance_institutions enable row level security;
alter table public.finance_cases enable row level security;
alter table public.finance_applications enable row level security;
alter table public.finance_events enable row level security;
revoke all on public.finance_dispatchers,public.finance_institutions,public.finance_cases,public.finance_applications,public.finance_events from public,anon,authenticated;
grant select on public.finance_dispatchers,public.finance_institutions,public.finance_cases,public.finance_applications,public.finance_events to authenticated;

create function public.e2_finance_active_staff() returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.staff_memberships where user_id=auth.uid() and active and role in ('super_admin','admin','sales','office_admin'));
$$;
create function public.e2_finance_is_dispatcher() returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.finance_dispatchers d join public.staff_memberships m on m.user_id=d.user_id where d.user_id=auth.uid() and d.active and m.active and m.role in ('office_admin','admin','super_admin'));
$$;
create policy finance_dispatchers_read on public.finance_dispatchers for select to authenticated using(public.e2_finance_active_staff());
create function public.e2_configure_finance_dispatcher(target uuid,enabled boolean,expected_revision bigint) returns public.finance_dispatchers language plpgsql security definer set search_path='' as $$
declare d public.finance_dispatchers;prior boolean;begin
 if not public.e2_is_super_admin() then raise exception 'Super Admin access required.';end if;
 if enabled is null or not exists(select 1 from public.staff_memberships where user_id=target and active and role in ('office_admin','admin','super_admin')) then raise exception 'Choose an active Office Admin, Admin or Super Admin.';end if;
 perform pg_advisory_xact_lock(hashtextextended(target::text,610081));
 select * into d from public.finance_dispatchers where user_id=target for update;prior:=d.active;
 if found then
  if expected_revision is null or expected_revision is distinct from d.revision then raise exception 'Dispatcher capability changed. Reload before saving.';end if;
  update public.finance_dispatchers set active=enabled,revision=revision+1,updated_at=now() where user_id=target returning * into d;
 else
  if expected_revision is not null then raise exception 'New capability must not provide a revision.';end if;
  insert into public.finance_dispatchers(user_id,active) values(target,enabled) returning * into d;
 end if;
 insert into public.staff_access_audit(actor,target_user,action,previous_active,next_active) values(auth.uid(),target,'FINANCE_DISPATCHER',prior,enabled);return d;
end;$$;
create function public.e2_finance_case_access(target uuid) returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.finance_cases c join public.staff_memberships m on m.user_id=auth.uid() and m.active
 where c.id=target and (m.role='super_admin' or public.e2_finance_is_dispatcher() or (m.user_id=c.salesperson and m.role in ('sales','admin')) or (c.handed_at is not null and m.user_id=c.office_admin and m.role in ('office_admin','admin')))
 and (exists(select 1 from public.intake_submissions s where s.id=c.intake_id and s.submitted_at is not null) or exists(select 1 from public.loan_applications s where s.id=c.loan_id and s.submitted_at is not null)));
$$;
create policy finance_case_read on public.finance_cases for select to authenticated using(public.e2_finance_case_access(id));
create policy finance_application_read on public.finance_applications for select to authenticated using(public.e2_finance_case_access(case_id));
create policy finance_event_read on public.finance_events for select to authenticated using(public.e2_finance_case_access(case_id));
create policy finance_institution_read on public.finance_institutions for select to authenticated using(public.e2_finance_active_staff());

-- Internal lock order is source, case, application. Customer document RPCs already lock source first.
create function public.e2_finance_lock_case(target uuid,expected bigint,access_mode text) returns public.finance_cases language plpgsql security definer set search_path='' as $$
declare c public.finance_cases;begin
 select * into c from public.finance_cases where id=target;
 if not found or not public.e2_finance_case_access(target) then raise exception 'Assigned case access required.';end if;
 if c.intake_id is not null then perform 1 from public.intake_submissions where id=c.intake_id for update;else perform 1 from public.loan_applications where id=c.loan_id for update;end if;
 select * into c from public.finance_cases where id=target for update;
 if not public.e2_finance_case_access(target) then raise exception 'Assigned case access required.';end if;
 if expected is not null and expected is distinct from c.revision then raise exception 'Case changed. Reload before saving.';end if;
 if access_mode='sales' and not coalesce((public.e2_is_super_admin() or (c.salesperson=auth.uid() and exists(select 1 from public.staff_memberships where user_id=auth.uid() and active and role in ('sales','admin')))) ,false) then raise exception 'Only the assigned Salesman or Super Admin can review and hand over.';end if;
 if access_mode='office' and not coalesce((public.e2_is_super_admin() or (c.office_admin=auth.uid() and c.handed_at is not null and exists(select 1 from public.staff_memberships where user_id=auth.uid() and active and role in ('office_admin','admin')))) ,false) then raise exception 'Assigned Office Admin access required.';end if;
 if access_mode='dispatch' and not coalesce((public.e2_is_super_admin() or public.e2_finance_is_dispatcher()) ,false) then raise exception 'Configured case coordinator access required.';end if;
 if access_mode='either' and not (public.e2_is_super_admin() or exists(select 1 from public.staff_memberships m where m.user_id=auth.uid() and m.active and ((m.user_id=c.salesperson and m.role in ('sales','admin')) or (c.handed_at is not null and m.user_id=c.office_admin and m.role in ('office_admin','admin'))))) then raise exception 'Assigned Salesman or Submission Admin access required to edit the case.';end if;
 return c;
end;$$;
create function public.e2_finance_lock_application(target uuid,expected bigint) returns public.finance_applications language plpgsql security definer set search_path='' as $$
declare a public.finance_applications;begin
 select * into a from public.finance_applications where id=target;
 if not found then raise exception 'Application unavailable.';end if;
 perform public.e2_finance_lock_case(a.case_id,null,'office');
 select * into a from public.finance_applications where id=target for update;
 if expected is null or expected is distinct from a.revision then raise exception 'Application changed. Reload before saving.';end if;
 return a;
end;$$;
create function public.e2_finance_text_list(items text[]) returns boolean language sql immutable set search_path='' as $$
 select items is not null and cardinality(items)<=40 and not exists(select 1 from unnest(items) i where i is null or length(btrim(i)) not between 1 and 200);
$$;
create function public.e2_finance_safe_url(url text) returns boolean language sql immutable set search_path='' as $$
 -- HTTPS DNS hosts only; never credentials, local/IP destinations, fragments, whitespace, or control characters.
 select url is null or (length(url)<=2000 and url ~ '^https://([A-Za-z0-9]([A-Za-z0-9-]*[A-Za-z0-9])?\.)+[A-Za-z]{2,63}(:443)?(/[^[:space:]#]*)?$' and url !~ '[[:cntrl:]]' and lower(url) !~ '^https://([^/]*\.)?(localhost|local|internal|test|invalid|example)(:443)?(/|$)' and lower(url) !~ '^https://[^/]*\.(localhost|local|internal)(:443)?(/|$)' and url !~ '%(0[aAdD]|00)');
$$;
create function public.e2_finance_safe_email(address text) returns boolean language sql immutable set search_path='' as $$
 select address is null or (length(address)<=254 and address !~ '[[:space:][:cntrl:]]' and address ~ '^[A-Za-z0-9.!#$%&''*+/=?^_`{|}~-]+@[A-Za-z0-9]([A-Za-z0-9-]*[A-Za-z0-9])?(\.[A-Za-z0-9]([A-Za-z0-9-]*[A-Za-z0-9])?)+$');
$$;
alter table public.finance_institutions add check(public.e2_finance_safe_url(portal_url)),add check(public.e2_finance_safe_email(email_to)),add check(public.e2_finance_text_list(required_documents));
alter table public.finance_applications add check(public.e2_finance_safe_url(portal_url)),add check(public.e2_finance_safe_email(email_to)),add check(public.e2_finance_text_list(missing_documents));
alter table public.finance_cases add check(public.e2_finance_text_list(missing_items));

create function public.e2_finance_files(target uuid) returns table(id uuid,category text,covered_months text[],path text,bucket text,filename text,mime_type text,byte_size bigint) language sql stable security definer set search_path='' as $$
 select d.id,d.category,d.covered_months,d.path,'loan-documents'::text,d.filename,d.mime_type,d.byte_size from public.loan_documents d join public.finance_cases c on c.loan_id=d.application_id
 join storage.objects o on o.bucket_id='loan-documents' and o.name=d.path
 where c.id=target and d.state='ready' and d.removed_at is null and o.metadata->>'mimetype'=d.mime_type and o.metadata->>'size'=d.byte_size::text
 union all
 select d.id,d.category,d.covered_months,d.path,'intake-documents'::text,d.filename,d.mime_type,d.byte_size from public.intake_files d join public.finance_cases c on c.intake_id=d.submission_id
 join storage.objects o on o.bucket_id='intake-documents' and o.name=d.path
 where c.id=target and d.state='ready' and o.metadata->>'mimetype'=d.mime_type and o.metadata->>'size'=d.byte_size::text;
$$;
create function public.e2_finance_required_missing(target uuid) returns text[] language plpgsql stable security definer set search_path='' as $$
declare c public.finance_cases;kind text;vehicle uuid;result text[]:='{}';v_category text;need integer;coverage integer;begin
 select * into c from public.finance_cases where id=target;
 if c.loan_id is not null then select applicant_type,vehicle_id into kind,vehicle from public.loan_applications where id=c.loan_id;
 else select applicant_type,vehicle_id into kind,vehicle from public.intake_submissions where id=c.intake_id;end if;
 if vehicle is null then result:=array_append(result,'Choose a vehicle');end if;
 if kind is null then result:=array_append(result,'Choose applicant type');end if;
 foreach v_category in array array['ic_front','ic_back','driving_license'] loop
  if not exists(select 1 from public.e2_finance_files(target) f where f.category=v_category) then result:=array_append(result,v_category||': ready file required');end if;
 end loop;
 if kind='worker' then
  if not exists(select 1 from public.e2_finance_files(target) f where f.category='epf') then result:=array_append(result,'epf: ready file required');end if;
 end if;
 foreach v_category in array case when kind='worker' then array['payslip','bank_statement'] when kind='self_employed' then array['company_bank_statement'] else array[]::text[] end loop
  need:=case when v_category='company_bank_statement' then 6 else 3 end;
  select count(distinct m)::integer into coverage from public.e2_finance_files(target) f cross join lateral unnest(f.covered_months) m
   where f.category=v_category and m ~ '^[0-9]{4}-(0[1-9]|1[0-2])$' and m<=to_char(current_date,'YYYY-MM') and m>=to_char(current_date-interval '17 months','YYYY-MM');
  if coverage<need then result:=array_append(result,v_category||': '||need||' distinct recent months required');end if;
 end loop;
 return result;
end;$$;

create function public.e2_open_finance_case(source_kind text,source_id uuid) returns public.finance_cases language plpgsql security definer set search_path='' as $$
declare c public.finance_cases;sales uuid;office uuid;handed timestamptz;title text;begin
 if source_kind='intake' then
  select salesperson,office_admin,handed_at,coalesce(nullif(details->>'name',''),'Guest enquiry') into sales,office,handed,title from public.intake_submissions where id=source_id and submitted_at is not null for update;
  if not found or not public.e2_intake_access(source_id) then raise exception 'Submitted source access required.';end if;
 elsif source_kind='loan' then
  select assigned_sales,coalesce(nullif(details->>'name',''),'Registered application') into sales,title from public.loan_applications where id=source_id and submitted_at is not null for update;
  if not found or not public.e2_finance_source_loan_access(source_id) then raise exception 'Submitted source access required.';end if;
 else raise exception 'Choose intake or loan source.';end if;
 if not public.e2_finance_active_staff() then raise exception 'Staff access required.';end if;
 -- An old loan assigned directly to Office Admin must first be reassigned to a Salesman by Super Admin.
 if not exists(select 1 from public.staff_memberships where user_id=sales and active and role in ('sales','admin','super_admin')) then raise exception 'Assign an active Salesman before starting case tracking.';end if;
 select * into c from public.finance_cases where (source_kind='intake' and intake_id=source_id) or (source_kind='loan' and loan_id=source_id);
 if found then if not public.e2_finance_case_access(c.id) then raise exception 'Assigned case access required.';end if;return c;end if;
 if source_kind='intake' and handed is not null then raise exception 'Legacy handed-over case needs reviewed coordinator migration before starting new tracking. Its existing workflow remains available.';end if;
 insert into public.finance_cases(intake_id,loan_id,case_name,salesperson,office_admin,handed_at)
 values(case when source_kind='intake' then source_id end,case when source_kind='loan' then source_id end,left(title,140)||' financing',sales,office,handed) returning * into c;
 insert into public.finance_events(case_id,actor,event,note) values(c.id,auth.uid(),'case_opened','Internal financing tracking started. Existing source remains private.');return c;
end;$$;
-- Explicit, one-source adoption only. Never infer this from a read or normal Start action.
-- Preserve the old handover and assigned Admin; the new checked workflow starts unreviewed.
create function public.e2_adopt_legacy_finance_case(source_kind text,source_id uuid,expected_source_revision bigint,reason text) returns public.finance_cases language plpgsql security definer set search_path='' as $$
declare s public.intake_submissions;c public.finance_cases;begin
 if not (public.e2_is_super_admin() or public.e2_finance_is_dispatcher()) then raise exception 'Configured case coordinator or Super Admin access required.';end if;
 if source_kind is distinct from 'intake' then raise exception 'Explicit legacy adoption supports handed-over guest intake only.';end if;
 if expected_source_revision is null then raise exception 'Source revision required.';end if;
 if length(btrim(coalesce(reason,''))) not between 10 and 2000 then raise exception 'Add a legacy adoption reason between 10 and 2000 characters.';end if;
 select * into s from public.intake_submissions where id=source_id and submitted_at is not null for update;
 if not found or s.handed_at is null then raise exception 'Choose a submitted legacy guest source with an existing handover.';end if;
 if s.revision is distinct from expected_source_revision then raise exception 'Source changed. Reload before adopting the legacy handover.';end if;
 if exists(select 1 from public.finance_cases where intake_id=source_id) then raise exception 'This source is already tracked. Open its existing financing workspace.';end if;
 if not exists(select 1 from public.staff_memberships where user_id=s.salesperson and active and role in ('sales','admin','super_admin')) then raise exception 'Assign an active Salesman before adopting the legacy handover.';end if;
 if not exists(select 1 from public.staff_memberships where user_id=s.office_admin and active and role in ('office_admin','admin','super_admin')) then raise exception 'An existing active Submission Admin assignment is required before legacy adoption.';end if;
 insert into public.finance_cases(intake_id,case_name,salesperson,coordinator,office_admin,handed_at,handoff_note)
 values(s.id,left(coalesce(nullif(s.details->>'name',''),'Guest enquiry'),140)||' financing',s.salesperson,auth.uid(),s.office_admin,s.handed_at,btrim(reason)) returning * into c;
 insert into public.finance_events(case_id,actor,event,note,evidence)
 values(c.id,auth.uid(),'legacy_case_adopted',btrim(reason),jsonb_build_object('source_kind','intake','source_id',s.id,'source_revision',s.revision,'previous_source_status',s.status,'salesperson',s.salesperson,'office_admin',s.office_admin,'handed_at',s.handed_at,'coordinator',auth.uid(),'fresh_sales_review_required',true));
 return c;
end;$$;
create function public.e2_rename_finance_case(target uuid,case_name text,expected_revision bigint) returns public.finance_cases language plpgsql security definer set search_path='' as $$
declare c public.finance_cases;begin
 if expected_revision is null then raise exception 'Case revision required.';end if;
 c:=public.e2_finance_lock_case(target,expected_revision,'either');
 if case_name is null or length(btrim(case_name)) not between 1 and 160 then raise exception 'Use a case name between 1 and 160 characters.';end if;
 update public.finance_cases set case_name=btrim(e2_rename_finance_case.case_name),revision=revision+1,updated_at=now() where id=target returning * into c;
 insert into public.finance_events(case_id,actor,event,note) values(target,auth.uid(),'case_renamed',c.case_name);return c;
end;$$;
create function public.e2_review_finance_case(target uuid,expected_revision bigint,details_checked boolean,documents_checked boolean,missing_items text[],review_note text) returns public.finance_cases language plpgsql security definer set search_path='' as $$
declare c public.finance_cases;missing text[];complete boolean;begin
 if expected_revision is null then raise exception 'Case revision required.';end if;
 c:=public.e2_finance_lock_case(target,expected_revision,'sales');
 if not public.e2_finance_text_list(missing_items) or length(btrim(coalesce(review_note,''))) not between 1 and 2000 then raise exception 'Add a review note and valid missing items.';end if;
 select coalesce(array_agg(distinct x),'{}'::text[]) into missing from unnest(missing_items||public.e2_finance_required_missing(target)) x;
 complete:=details_checked is true and documents_checked is true and cardinality(missing)=0;
 if complete then
  if c.loan_id is not null then perform public.e2_validate_loan_details(s.details,true,(s.vehicle_summary->>'price')::numeric) from public.loan_applications s where s.id=c.loan_id;
  else perform public.e2_validate_intake_details(s.details,true,(s.vehicle_summary->>'price')::numeric) from public.intake_submissions s where s.id=c.intake_id;end if;
 end if;
 if not complete and cardinality(missing)=0 then missing:=array['Salesman must confirm customer details and document readability/completeness'];end if;
 update public.finance_cases set review_state=case when complete then 'complete' else 'needs_information' end,
 missing_items=missing,review_note=btrim(e2_review_finance_case.review_note),reviewed_by=auth.uid(),reviewed_at=now(),
 reviewed_content_revision=case when complete then content_revision else null end,revision=revision+1,updated_at=now() where id=target returning * into c;
 if complete and c.handed_at is not null then
  -- Rechecking a correction closes the customer edit window without routing the case again.
  if c.loan_id is not null then update public.loan_applications set status=case when c.selected_application_id is not null then 'Outcome recorded' when exists(select 1 from public.finance_applications a where a.case_id=target and a.submitted_at is not null) then 'Submitted to financier' else 'Ready for financier' end,revision=revision+1,updated_at=now() where id=c.loan_id;
  else update public.intake_submissions set status=case when c.selected_application_id is not null then 'Outcome recorded' when exists(select 1 from public.finance_applications a where a.case_id=target and a.submitted_at is not null) then 'Submitted to financier' else 'Sent to Office' end,revision=revision+1,updated_at=now() where id=c.intake_id;end if;
 end if;
 if not complete then
  update public.finance_applications set status='draft',reviewed_at=null,reviewed_by=null,reviewed_content_revision=null,review_note=null,revision=revision+1,updated_at=now() where case_id=target and submitted_at is null;
  if c.loan_id is not null then update public.loan_applications set status='Needs information',revision=revision+1,updated_at=now() where id=c.loan_id;
  else update public.intake_submissions set status='Needs information',revision=revision+1,updated_at=now() where id=c.intake_id;end if;
 end if;
 insert into public.finance_events(case_id,actor,event,note,evidence) values(target,auth.uid(),case when complete then 'sales_review_complete' else 'missing_information' end,btrim(review_note),jsonb_build_object('content_revision',c.content_revision,'missing_items',missing,'details_checked',details_checked is true,'documents_checked',documents_checked is true));
 return c;
end;$$;
create function public.e2_handoff_finance_case(target uuid,office uuid,message text,expected_revision bigint) returns public.finance_cases language plpgsql security definer set search_path='' as $$
declare c public.finance_cases;begin
 if expected_revision is null then raise exception 'Case revision required.';end if;
 c:=public.e2_finance_lock_case(target,expected_revision,'sales');
 if c.handed_at is not null then raise exception 'This case is already handed over. Only a configured case coordinator may reassign the Submission Admin.';end if;
 if c.review_state<>'complete' or c.reviewed_content_revision is distinct from c.content_revision or cardinality(public.e2_finance_required_missing(target))>0 then raise exception 'Complete the current Salesman review and missing documents before handover.';end if;
 if not exists(select 1 from public.finance_dispatchers d join public.staff_memberships m on m.user_id=d.user_id where d.user_id=office and d.active and m.active and m.role in ('admin','office_admin','super_admin')) then raise exception 'Choose an active configured case coordinator.';end if;
 if length(btrim(coalesce(message,''))) not between 1 and 2000 then raise exception 'Add a handover note.';end if;
 update public.finance_cases set coordinator=office,office_admin=null,handed_at=now(),handoff_note=btrim(message),revision=revision+1,updated_at=now() where id=target;
 update public.finance_applications set status='draft',reviewed_at=null,reviewed_by=null,reviewed_content_revision=null,review_note=null,revision=revision+1,updated_at=now() where case_id=target and submitted_at is null;
 if c.intake_id is not null then update public.intake_submissions set office_admin=null,handed_at=now(),status='Sent to Office',revision=revision+1,updated_at=now() where id=c.intake_id;
 else update public.loan_applications set status='Ready for financier',revision=revision+1,updated_at=now() where id=c.loan_id;end if;
 select * into c from public.finance_cases where id=target;
 insert into public.finance_events(case_id,actor,event,note,evidence) values(target,auth.uid(),'coordinator_handoff',btrim(message),jsonb_build_object('coordinator',office,'content_revision',c.content_revision));return c;
end;$$;

create function public.e2_assign_finance_admin(target uuid,office uuid,message text,expected_revision bigint) returns public.finance_cases language plpgsql security definer set search_path='' as $$
declare c public.finance_cases;prior uuid;begin
 if expected_revision is null then raise exception 'Case revision required.';end if;
 c:=public.e2_finance_lock_case(target,expected_revision,'dispatch');prior:=c.office_admin;
 if c.handed_at is null then raise exception 'Salesman handover required before assigning a Submission Admin.';end if;
 if not exists(select 1 from public.staff_memberships where user_id=office and active and role in ('office_admin','admin','super_admin')) then raise exception 'Choose an active Submission Admin.';end if;
 if length(btrim(coalesce(message,''))) not between 1 and 2000 then raise exception 'Add an assignment note.';end if;
 update public.finance_cases set office_admin=office,revision=revision+1,updated_at=now() where id=target;
 if c.intake_id is not null then update public.intake_submissions set office_admin=office,revision=revision+1,updated_at=now() where id=c.intake_id;end if;
 update public.finance_applications set status='draft',reviewed_at=null,reviewed_by=null,reviewed_content_revision=null,review_note=null,revision=revision+1,updated_at=now() where case_id=target and submitted_at is null;
 select * into c from public.finance_cases where id=target;
 insert into public.finance_events(case_id,actor,event,note,evidence) values(target,auth.uid(),'submission_admin_assigned',btrim(message),jsonb_build_object('previous_admin',prior,'office_admin',office,'coordinator',c.coordinator));return c;
end;$$;

create function public.e2_save_finance_institution(target uuid,payload jsonb,expected_revision bigint) returns public.finance_institutions language plpgsql security definer set search_path='' as $$
declare i public.finance_institutions;docs text[];begin
 if not public.e2_is_super_admin() then raise exception 'Super Admin access required.';end if;
 if payload is null or jsonb_typeof(payload)<>'object' or exists(select 1 from jsonb_object_keys(payload) k where k not in ('name','kind','portal_url','email_to','required_documents','active')) then raise exception 'Invalid institution configuration.';end if;
 if jsonb_typeof(coalesce(payload->'required_documents','[]'))<>'array' or exists(select 1 from jsonb_array_elements(coalesce(payload->'required_documents','[]')) x where jsonb_typeof(x)<>'string') then raise exception 'Use a list of required documents.';end if;
 select coalesce(array_agg(x),'{}'::text[]) into docs from jsonb_array_elements_text(coalesce(payload->'required_documents','[]')) x;
 if target is null then
  if expected_revision is not null then raise exception 'New institution must not provide a revision.';end if;
  insert into public.finance_institutions(name,kind,portal_url,email_to,required_documents,active)
   values(btrim(payload->>'name'),payload->>'kind',nullif(btrim(payload->>'portal_url'),''),nullif(btrim(payload->>'email_to'),''),docs,coalesce((payload->>'active')::boolean,true)) returning * into i;
 else
  select * into i from public.finance_institutions where id=target for update;
  if not found or expected_revision is null or i.revision is distinct from expected_revision then raise exception 'Institution changed. Reload before saving.';end if;
  update public.finance_institutions set name=btrim(payload->>'name'),kind=payload->>'kind',portal_url=nullif(btrim(payload->>'portal_url'),''),email_to=nullif(btrim(payload->>'email_to'),''),required_documents=docs,active=coalesce((payload->>'active')::boolean,true),revision=revision+1,updated_at=now() where id=target returning * into i;
 end if;
 return i;
end;$$;
create function public.e2_save_finance_application(target uuid,application_id uuid,payload jsonb,expected_revision bigint) returns public.finance_applications language plpgsql security definer set search_path='' as $$
declare c public.finance_cases;a public.finance_applications;i public.finance_institutions;attached uuid[];missing text[];manifest jsonb;begin
 c:=public.e2_finance_lock_case(target,null,'office');
 if c.handed_at is null or c.review_state<>'complete' or c.reviewed_content_revision is distinct from c.content_revision then raise exception 'Current Salesman review and Office handover required.';end if;
 if payload is null or jsonb_typeof(payload)<>'object' or exists(select 1 from jsonb_object_keys(payload) k where k not in ('institution_id','assignee','channel','email_subject','email_body','attachment_ids','missing_documents','note')) then raise exception 'Invalid application fields.';end if;
 if jsonb_typeof(coalesce(payload->'attachment_ids','[]'))<>'array' or jsonb_typeof(coalesce(payload->'missing_documents','[]'))<>'array' then raise exception 'Use document lists.';end if;
 if exists(select 1 from jsonb_array_elements(coalesce(payload->'attachment_ids','[]')) x where jsonb_typeof(x)<>'string') or exists(select 1 from jsonb_array_elements(coalesce(payload->'missing_documents','[]')) x where jsonb_typeof(x)<>'string') then raise exception 'Use document text lists.';end if;
 select coalesce(array_agg(x::uuid),'{}'::uuid[]) into attached from jsonb_array_elements_text(coalesce(payload->'attachment_ids','[]')) x;
 select coalesce(array_agg(x),'{}'::text[]) into missing from jsonb_array_elements_text(coalesce(payload->'missing_documents','[]')) x;
 if cardinality(attached)>30 or cardinality(attached)<>(select count(distinct x) from unnest(attached) x) or exists(select 1 from unnest(attached) x where not exists(select 1 from public.e2_finance_files(target) f where f.id=x)) then raise exception 'Select only current ready documents from this case.';end if;
 select coalesce(jsonb_agg(to_jsonb(f) order by f.id),'[]'::jsonb) into manifest from public.e2_finance_files(target) f where f.id=any(attached);
 select * into i from public.finance_institutions where id=(payload->>'institution_id')::uuid and active for share;
 if not found then raise exception 'Choose an active institution.';end if;
 if not exists(select 1 from public.staff_memberships where user_id=(payload->>'assignee')::uuid and active and role in ('office_admin','admin','super_admin')) then raise exception 'Choose an active submission assignee.';end if;
 if payload->>'channel'='email' and i.email_to is null then raise exception 'Configure a recipient before choosing email.';end if;
 if payload->>'channel'='portal' and i.portal_url is null then raise exception 'Configure a secure HTTPS portal before choosing portal.';end if;
 if application_id is null then
  if expected_revision is not null then raise exception 'New application must not provide a revision.';end if;
  insert into public.finance_applications(case_id,institution_id,institution_name,institution_revision,assignee,channel,portal_url,email_to,email_subject,email_body,attachment_ids,attachment_manifest,missing_documents,note)
  values(target,i.id,i.name,i.revision,(payload->>'assignee')::uuid,payload->>'channel',i.portal_url,i.email_to,coalesce(payload->>'email_subject',''),coalesce(payload->>'email_body',''),attached,manifest,missing,coalesce(payload->>'note','')) returning * into a;
 else
  select * into a from public.finance_applications where id=application_id and case_id=target for update;
  if not found or expected_revision is null or a.revision is distinct from expected_revision then raise exception 'Application changed. Reload before saving.';end if;
  if a.submitted_at is not null then raise exception 'Submitted content is immutable. Record a follow-up outcome instead.';end if;
  update public.finance_applications set institution_id=i.id,institution_name=i.name,institution_revision=i.revision,assignee=(payload->>'assignee')::uuid,channel=payload->>'channel',portal_url=i.portal_url,email_to=i.email_to,
   email_subject=coalesce(payload->>'email_subject',''),email_body=coalesce(payload->>'email_body',''),attachment_ids=attached,attachment_manifest=manifest,missing_documents=missing,note=coalesce(payload->>'note',''),
   status='draft',reviewed_at=null,reviewed_by=null,reviewed_content_revision=null,review_note=null,revision=revision+1,updated_at=now() where id=application_id returning * into a;
 end if;
 insert into public.finance_events(case_id,application_id,actor,event,note) values(target,a.id,auth.uid(),'application_draft_saved','Internal preparation only. Nothing was sent.');return a;
end;$$;
create function public.e2_review_finance_application(target uuid,expected_revision bigint,review_note text) returns public.finance_applications language plpgsql security definer set search_path='' as $$
declare c public.finance_cases;a public.finance_applications;begin
 a:=public.e2_finance_lock_application(target,expected_revision);select * into c from public.finance_cases where id=a.case_id;
 if a.submitted_at is not null then raise exception 'This application has already been submitted.';end if;
 if c.handed_at is null or c.review_state<>'complete' or c.reviewed_content_revision is distinct from c.content_revision or cardinality(public.e2_finance_required_missing(c.id))>0 then raise exception 'Refresh the Salesman review before preparing submission.';end if;
 if cardinality(a.missing_documents)>0 then raise exception 'Resolve application missing documents before submission review.';end if;
 if not exists(select 1 from public.staff_memberships where user_id=a.assignee and active and role in ('office_admin','admin','super_admin')) then raise exception 'Choose an active submission assignee.';end if;
 perform 1 from public.finance_institutions where id=a.institution_id and active and revision=a.institution_revision for share;
 if not found then raise exception 'Institution changed or is inactive. Save and review the current destination.';end if;
 if exists(select 1 from unnest(a.attachment_ids) x where not exists(select 1 from public.e2_finance_files(c.id) f where f.id=x)) then raise exception 'Attachment changed. Save a current document selection.';end if;
 if a.channel='email' and (a.email_to is null or length(btrim(a.email_subject))=0 or length(btrim(a.email_body))=0 or cardinality(a.attachment_ids)=0) then raise exception 'Review recipient, subject, body and at least one selected attachment.';end if;
 if a.channel='portal' and a.portal_url is null then raise exception 'Configure a secure portal.';end if;
 if length(btrim(coalesce(review_note,''))) not between 10 and 2000 then raise exception 'Record how the destination, contents and documents were reviewed.';end if;
 update public.finance_applications set status='ready',reviewed_at=now(),reviewed_by=auth.uid(),reviewed_content_revision=c.content_revision,review_note=btrim(e2_review_finance_application.review_note),revision=revision+1,updated_at=now() where id=target returning * into a;
 insert into public.finance_events(case_id,application_id,actor,event,note,evidence) values(c.id,a.id,auth.uid(),'submission_reviewed',btrim(review_note),jsonb_build_object('content_revision',c.content_revision,'channel',a.channel,'email_to',a.email_to,'portal_url',a.portal_url,'attachment_ids',a.attachment_ids,'attachment_manifest',a.attachment_manifest,'institution_revision',a.institution_revision));return a;
end;$$;
create function public.e2_record_finance_submission(target uuid,expected_revision bigint,submitted_at timestamptz,external_reference text,evidence text) returns public.finance_applications language plpgsql security definer set search_path='' as $$
declare c public.finance_cases;a public.finance_applications;begin
 a:=public.e2_finance_lock_application(target,expected_revision);select * into c from public.finance_cases where id=a.case_id;
 if a.status<>'ready' or a.submitted_at is not null or a.reviewed_at is null then raise exception 'Review the prepared application before recording actual submission.';end if;
 if c.review_state<>'complete' or a.reviewed_content_revision is distinct from c.content_revision or c.reviewed_content_revision is distinct from c.content_revision or cardinality(public.e2_finance_required_missing(c.id))>0 then raise exception 'Source changed. Repeat the Salesman and submission reviews.';end if;
 if exists(select 1 from unnest(a.attachment_ids) x where not exists(select 1 from public.e2_finance_files(c.id) f where f.id=x)) then raise exception 'An attachment is no longer available.';end if;
 perform 1 from public.finance_institutions where id=a.institution_id and active and revision=a.institution_revision for share;
 if not found or not exists(select 1 from public.staff_memberships where user_id=a.assignee and active and role in ('office_admin','admin','super_admin')) then raise exception 'Institution changed or the institution/assignee is inactive. Save and review the current destination.';end if;
 if submitted_at is null or submitted_at>now()+interval '5 minutes' or submitted_at<(select coalesce(s.submitted_at,l.submitted_at) from public.finance_cases f left join public.intake_submissions s on s.id=f.intake_id left join public.loan_applications l on l.id=f.loan_id where f.id=c.id) then raise exception 'Submission time must follow source receipt and cannot be more than five minutes in the future.';end if;
 if length(btrim(coalesce(external_reference,''))) not between 1 and 200 or length(btrim(coalesce(evidence,''))) not between 10 and 2000 then raise exception 'Add the external reference and explicit evidence of the human submission.';end if;
 update public.finance_applications set status='submitted',submitted_at=e2_record_finance_submission.submitted_at,submitted_by=auth.uid(),external_reference=btrim(e2_record_finance_submission.external_reference),submission_evidence=btrim(evidence),revision=revision+1,updated_at=now() where id=target returning * into a;
 if c.loan_id is not null then update public.loan_applications set status='Submitted to financier',revision=revision+1,updated_at=now() where id=c.loan_id;
 else update public.intake_submissions set status='Submitted to financier',revision=revision+1,updated_at=now() where id=c.intake_id;end if;
 insert into public.finance_events(case_id,application_id,actor,event,note,evidence) values(c.id,a.id,auth.uid(),'actual_submission_recorded',btrim(evidence),jsonb_build_object('submitted_at',submitted_at,'external_reference',external_reference,'channel',a.channel,'email_to',a.email_to,'portal_url',a.portal_url,'attachment_ids',a.attachment_ids,'attachment_manifest',a.attachment_manifest,'institution_revision',a.institution_revision,'content_revision',c.content_revision,'reviewed_by',a.reviewed_by,'reviewed_at',a.reviewed_at));return a;
end;$$;
create function public.e2_record_finance_outcome(target uuid,expected_revision bigint,next_status text,missing_documents text[],offer_amount numeric,offer_rate numeric,offer_tenure_months integer,note text) returns public.finance_applications language plpgsql security definer set search_path='' as $$
declare a public.finance_applications;c public.finance_cases;begin
 a:=public.e2_finance_lock_application(target,expected_revision);select * into c from public.finance_cases where id=a.case_id;
 if a.submitted_at is null then raise exception 'Record actual submission before its outcome.';end if;
 if c.selected_application_id=a.id then raise exception 'The selected offer is locked. Record a different customer selection before changing this offer.';end if;
 if next_status is null or next_status not in ('under_review','needs_information','approved','rejected','withdrawn') then raise exception 'Choose a supported financier outcome.';end if;
 if not public.e2_finance_text_list(missing_documents) or length(btrim(coalesce(note,''))) not between 10 and 2000 then raise exception 'Record the actual follow-up or decision and valid missing documents.';end if;
 if next_status='needs_information' and cardinality(missing_documents)=0 then raise exception 'List the financier requested documents or information.';end if;
 if next_status='approved' and (offer_amount is null or offer_rate is null or offer_tenure_months is null or cardinality(missing_documents)>0) then raise exception 'An approved offer requires amount, annual rate, tenure and no unresolved missing documents.';end if;
 update public.finance_applications set status=next_status,missing_documents=e2_record_finance_outcome.missing_documents,
  offer_amount=case when next_status='approved' then e2_record_finance_outcome.offer_amount else null end,
  offer_rate=case when next_status='approved' then e2_record_finance_outcome.offer_rate else null end,
  offer_tenure_months=case when next_status='approved' then e2_record_finance_outcome.offer_tenure_months else null end,
  note=btrim(e2_record_finance_outcome.note),revision=revision+1,updated_at=now() where id=target returning * into a;
 insert into public.finance_events(case_id,application_id,actor,event,note,evidence) values(a.case_id,a.id,auth.uid(),'financier_'||next_status,btrim(note),jsonb_build_object('missing_documents',a.missing_documents,'offer_amount',a.offer_amount,'offer_rate',a.offer_rate,'offer_tenure_months',a.offer_tenure_months));return a;
end;$$;
create function public.e2_select_finance_offer(target uuid,application_id uuid,expected_revision bigint,expected_application_revision bigint,customer_instruction text) returns public.finance_cases language plpgsql security definer set search_path='' as $$
declare c public.finance_cases;a public.finance_applications;begin
 if expected_revision is null then raise exception 'Case revision required.';end if;
 c:=public.e2_finance_lock_case(target,expected_revision,'office');
 if c.review_state<>'complete' then raise exception 'Refresh the Salesman review before recording the final choice.';end if;
 select * into a from public.finance_applications where id=application_id and case_id=target for update;
 if not found or a.status<>'approved' or a.submitted_at is null then raise exception 'Select an approved offer from this case.';end if;
 if expected_application_revision is null or expected_application_revision is distinct from a.revision then raise exception 'Offer changed. Reload and confirm the current offer terms.';end if;
 if length(btrim(coalesce(customer_instruction,''))) not between 10 and 2000 then raise exception 'Record the customer instruction, including how and when the choice was confirmed.';end if;
 update public.finance_cases set selected_application_id=application_id,selection_evidence=btrim(customer_instruction),selected_by=auth.uid(),selected_at=now(),revision=revision+1,updated_at=now() where id=target returning * into c;
 if c.loan_id is not null then update public.loan_applications set status='Outcome recorded',revision=revision+1,updated_at=now() where id=c.loan_id;
 else update public.intake_submissions set status='Outcome recorded',revision=revision+1,updated_at=now() where id=c.intake_id;end if;
 insert into public.finance_events(case_id,application_id,actor,event,note,evidence) values(target,a.id,auth.uid(),'customer_offer_selected',btrim(customer_instruction),jsonb_build_object('institution_id',a.institution_id,'institution_name',a.institution_name,'offer_amount',a.offer_amount,'offer_rate',a.offer_rate,'offer_tenure_months',a.offer_tenure_months,'application_revision',a.revision));return c;
end;$$;

create function public.e2_finance_workspace(target uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare c public.finance_cases;result jsonb;begin
 if not public.e2_finance_case_access(target) then raise exception 'Assigned case access required.';end if;
 select * into c from public.finance_cases where id=target;
 select jsonb_build_object('case',to_jsonb(c),
  'source',case when c.loan_id is not null then (select to_jsonb(s) from public.loan_applications s where s.id=c.loan_id) else (select to_jsonb(s)-'write_hash' from public.intake_submissions s where s.id=c.intake_id) end,
  'files',case when c.loan_id is not null then coalesce((select jsonb_agg(to_jsonb(d) order by d.created_at,d.id) from public.loan_documents d where d.application_id=c.loan_id and d.state='ready' and d.removed_at is null),'[]'::jsonb) else coalesce((select jsonb_agg(to_jsonb(d) order by d.created_at,d.id) from public.intake_files d where d.submission_id=c.intake_id and d.state='ready'),'[]'::jsonb) end,
  'applications',coalesce((select jsonb_agg(to_jsonb(a) order by a.created_at,a.id) from public.finance_applications a where a.case_id=target),'[]'::jsonb),
  'institutions',coalesce((select jsonb_agg(to_jsonb(i) order by i.name) from public.finance_institutions i where i.active or public.e2_is_super_admin() or exists(select 1 from public.finance_applications a where a.case_id=target and a.institution_id=i.id)),'[]'::jsonb),
  'history',coalesce((select jsonb_agg(to_jsonb(e) order by e.id desc) from public.finance_events e where e.case_id=target),'[]'::jsonb),
  'staff',coalesce((select jsonb_agg(jsonb_build_object('user_id',m.user_id,'display_name',coalesce(nullif(p.display_name,''),'E2 staff'),'role',m.role,'active',m.active,'is_dispatcher',m.active and m.role in ('office_admin','admin','super_admin') and exists(select 1 from public.finance_dispatchers d where d.user_id=m.user_id and d.active)) order by coalesce(p.display_name,'E2 staff'),m.user_id) from public.staff_memberships m left join public.staff_profiles p on p.user_id=m.user_id where (m.active and m.role in ('office_admin','admin','super_admin')) or m.user_id=c.salesperson or m.user_id=c.office_admin or m.user_id=c.coordinator or exists(select 1 from public.finance_applications a where a.case_id=target and a.assignee=m.user_id)),'[]'::jsonb),
  'required_missing',to_jsonb(public.e2_finance_required_missing(target))) into result;
 return result;
end;$$;

-- Content changes invalidate both checks, including replace/remove/upload and storage mutations.
-- Submission and customer-selection facts are retained in append-only history, never rewritten.
create function public.e2_finance_invalidate_case(target uuid,reason text) returns void language plpgsql security definer set search_path='' as $$
begin
 update public.finance_cases set content_revision=content_revision+1,review_state='pending',reviewed_content_revision=null,reviewed_by=null,reviewed_at=null,
  review_note='',missing_items=array[reason],revision=revision+1,updated_at=now() where id=target;
 if not found then return;end if;
 update public.finance_applications set status='draft',reviewed_at=null,reviewed_by=null,reviewed_content_revision=null,review_note=null,revision=revision+1,updated_at=now() where case_id=target and submitted_at is null;
 insert into public.finance_events(case_id,actor,event,note) values(target,auth.uid(),'source_changed',reason);
end;$$;
create function public.e2_finance_source_changed() returns trigger language plpgsql security definer set search_path='' as $$
declare c public.finance_cases;sales uuid;changed boolean;begin
 if tg_table_name='loan_applications' then
  select * into c from public.finance_cases where loan_id=new.id;
  sales:=new.assigned_sales;
  changed:=new.details is distinct from old.details or new.applicant_type is distinct from old.applicant_type or new.vehicle_id is distinct from old.vehicle_id or new.vehicle_summary is distinct from old.vehicle_summary or new.assigned_sales is distinct from old.assigned_sales;
 else
  select * into c from public.finance_cases where intake_id=new.id;
  sales:=new.salesperson;
  changed:=new.details is distinct from old.details or new.applicant_type is distinct from old.applicant_type or new.vehicle_id is distinct from old.vehicle_id or new.vehicle_summary is distinct from old.vehicle_summary or new.salesperson is distinct from old.salesperson;
 end if;
 if c.id is null then return new;end if;
 if new.submitted_at is null then raise exception 'A tracked source must remain submitted.';end if;
 if c.salesperson is distinct from sales then update public.finance_cases set salesperson=sales,revision=revision+1,updated_at=now() where id=c.id;end if;
 if tg_table_name='intake_submissions' then
  if c.office_admin is distinct from new.office_admin or c.handed_at is distinct from new.handed_at then
   update public.finance_cases set office_admin=new.office_admin,handed_at=new.handed_at,revision=revision+1,updated_at=now() where id=c.id;
  end if;
 end if;
 if changed or (new.status='Needs information' and old.status is distinct from new.status and c.review_state='complete') then
  perform public.e2_finance_invalidate_case(c.id,'Customer details, vehicle, assignment or requested information changed. Repeat the Salesman check.');
 end if;
 return new;
end;$$;
create trigger finance_loan_source_changed after update on public.loan_applications for each row execute function public.e2_finance_source_changed();
create trigger finance_intake_source_changed after update on public.intake_submissions for each row execute function public.e2_finance_source_changed();
create function public.e2_finance_document_changed() returns trigger language plpgsql security definer set search_path='' as $$
declare c uuid;source uuid;begin
 if tg_table_name='loan_documents' then
  source:=case when tg_op='DELETE' then old.application_id else new.application_id end;
  select id into c from public.finance_cases where loan_id=source;
 else
  source:=case when tg_op='DELETE' then old.submission_id else new.submission_id end;
  select id into c from public.finance_cases where intake_id=source;
 end if;
 if c is not null then perform public.e2_finance_invalidate_case(c,'Source documents changed. Repeat the Salesman and submission checks.');end if;
 return case when tg_op='DELETE' then old else new end;
end;$$;
create trigger finance_loan_document_changed after insert or update or delete on public.loan_documents for each row execute function public.e2_finance_document_changed();
create trigger finance_intake_document_changed after insert or update or delete on public.intake_files for each row execute function public.e2_finance_document_changed();
create function public.e2_finance_storage_changed() returns trigger language plpgsql security definer set search_path='' as $$
declare c record;old_bucket text;new_bucket text;old_path text;new_path text;begin
 if tg_op='UPDATE' and (to_jsonb(old)->'bucket_id') is not distinct from (to_jsonb(new)->'bucket_id') and (to_jsonb(old)->'name') is not distinct from (to_jsonb(new)->'name') and (to_jsonb(old)->'metadata') is not distinct from (to_jsonb(new)->'metadata') and (to_jsonb(old)->'version') is not distinct from (to_jsonb(new)->'version') and (to_jsonb(old)->'updated_at') is not distinct from (to_jsonb(new)->'updated_at') then return new;end if;
 if tg_op<>'INSERT' then old_bucket:=old.bucket_id;old_path:=old.name;end if;
 if tg_op<>'DELETE' then new_bucket:=new.bucket_id;new_path:=new.name;end if;
 if coalesce(old_bucket,'') not in ('loan-documents','intake-documents') and coalesce(new_bucket,'') not in ('loan-documents','intake-documents') then return case when tg_op='DELETE' then old else new end;end if;
 for c in select distinct f.id from public.finance_cases f left join public.loan_documents d on d.application_id=f.loan_id left join public.intake_files i on i.submission_id=f.intake_id
 where (old_bucket='loan-documents' and d.path=old_path) or (new_bucket='loan-documents' and d.path=new_path) or (old_bucket='intake-documents' and i.path=old_path) or (new_bucket='intake-documents' and i.path=new_path) loop
  perform public.e2_finance_invalidate_case(c.id,'Stored document changed. Repeat the Salesman and submission checks.');
 end loop;
 return case when tg_op='DELETE' then old else new end;
end;$$;
create trigger finance_storage_changed after insert or update or delete on storage.objects for each row execute function public.e2_finance_storage_changed();

-- Configured coordinators read every submitted guest source, including untracked ones.
-- All other staff retain their original assigned-only scope; unsubmitted drafts stay private.
-- The receiving coordinator on a case is routing/audit history, not a global access boundary.
create or replace function public.e2_intake_access(target uuid) returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.intake_submissions a join public.staff_memberships m on m.user_id=auth.uid() and m.active where a.id=target and a.submitted_at is not null and (m.role='super_admin' or public.e2_finance_is_dispatcher() or (a.salesperson=m.user_id and m.role in ('sales','admin')) or (a.handed_at is not null and a.office_admin=m.user_id and m.role in ('admin','office_admin')) or exists(select 1 from public.finance_cases c where c.intake_id=a.id and public.e2_finance_case_access(c.id))));
$$;

-- Submitted registered sources, ready documents and their existing event policies share
-- the same global-coordinator or assigned-only read boundary. Customer ownership and
-- untracked legacy assignments are preserved; e2_loan_staff is deliberately not broadened,
-- because legacy mutation RPCs also use it.
create function public.e2_finance_loan_access(target uuid) returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.finance_cases c where c.loan_id=target and public.e2_finance_case_access(c.id));
$$;
create function public.e2_finance_source_loan_access(target uuid) returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.loan_applications a where a.id=target and a.submitted_at is not null and
  (public.e2_finance_is_dispatcher() or case when exists(select 1 from public.finance_cases c where c.loan_id=a.id) then public.e2_finance_loan_access(a.id) else public.e2_loan_staff(a.assigned_sales) end));
$$;
drop policy loan_followup on public.loan_applications;
create policy loan_followup on public.loan_applications for select to authenticated using(public.e2_finance_source_loan_access(id));
create or replace function public.e2_doc_access(target uuid,edit boolean default false) returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.loan_applications a where a.id=target and ((a.customer_id=auth.uid() and public.e2_customer_allowed() and (not edit or a.status in ('Draft','Submitted to E2','Needs information'))) or (not edit and a.submitted_at is not null and public.e2_finance_source_loan_access(a.id))));
$$;
create or replace function public.e2_doc_storage(object_path text,operation text) returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.loan_documents d join public.loan_applications a on a.id=d.application_id where d.path=object_path and (
 (operation='read' and ((a.customer_id=auth.uid() and public.e2_customer_allowed()) or (d.state='ready' and d.removed_at is null and a.submitted_at is not null and public.e2_finance_source_loan_access(a.id)))) or
 (operation='upload' and d.state='uploading' and d.removed_at is null and a.customer_id=auth.uid() and public.e2_customer_allowed() and a.status in ('Draft','Submitted to E2','Needs information')) or
 (operation='delete' and (d.state='uploading' or d.removed_at is not null) and a.customer_id=auth.uid() and public.e2_customer_allowed())
 ));
$$;

-- Preserve untracked legacy behavior behind non-callable implementation functions.
alter function public.e2_intake_handoff(uuid,uuid,text,bigint) rename to e2_legacy_intake_handoff;
alter function public.e2_intake_progress(uuid,text,text,bigint) rename to e2_legacy_intake_progress;
alter function public.e2_update_loan_status(uuid,text,text,bigint) rename to e2_legacy_update_loan_status;
alter function public.e2_assign_loan(uuid,uuid,bigint) rename to e2_legacy_assign_loan;
revoke all on function public.e2_legacy_intake_handoff(uuid,uuid,text,bigint),public.e2_legacy_intake_progress(uuid,text,text,bigint),public.e2_legacy_update_loan_status(uuid,text,text,bigint),public.e2_legacy_assign_loan(uuid,uuid,bigint) from public,anon,authenticated,service_role;
create function public.e2_intake_handoff(target uuid,office uuid,message text,expected_revision bigint) returns void language plpgsql security definer set search_path='' as $$begin
 perform 1 from public.intake_submissions where id=target for update;
 if exists(select 1 from public.finance_cases where intake_id=target) then raise exception 'Use the financing workspace to complete the Salesman review and handover.';end if;
 perform public.e2_legacy_intake_handoff(target,office,message,expected_revision);
end;$$;
create function public.e2_intake_progress(target uuid,next_status text,message text,expected_revision bigint) returns void language plpgsql security definer set search_path='' as $$
declare s public.intake_submissions;sales_actor boolean;office_actor boolean;begin
 select * into s from public.intake_submissions where id=target for update;
 if exists(select 1 from public.finance_cases where intake_id=target) then raise exception 'Use the financing workspace to record checked progress and actual submission evidence.';end if;
 -- Check the actor for this operation, even when both historical assignment IDs match.
 -- Global reads must never revive a former Salesman or Office role after demotion.
 sales_actor:=public.e2_is_super_admin() or exists(select 1 from public.staff_memberships m where m.user_id=auth.uid() and m.active and m.user_id=s.salesperson and m.role in ('sales','admin'));
 office_actor:=public.e2_is_super_admin() or exists(select 1 from public.staff_memberships m where m.user_id=auth.uid() and m.active and s.handed_at is not null and m.user_id=s.office_admin and m.role in ('office_admin','admin'));
 if not (case next_status when 'Needs information' then sales_actor or office_actor when 'Received by Salesman' then sales_actor when 'Submitted to financier' then office_actor when 'Outcome recorded' then office_actor else false end) then raise exception 'Assigned Salesman or Submission Admin access required for this progress change.';end if;
 perform public.e2_legacy_intake_progress(target,next_status,message,expected_revision);
end;$$;
create function public.e2_update_loan_status(target uuid,next_status text,message text,expected_revision bigint) returns public.loan_applications language plpgsql security definer set search_path='' as $$begin
 perform 1 from public.loan_applications where id=target for update;
 if exists(select 1 from public.finance_cases where loan_id=target) then raise exception 'Use the financing workspace to record checked progress and actual submission evidence.';end if;
 return public.e2_legacy_update_loan_status(target,next_status,message,expected_revision);
end;$$;
create function public.e2_assign_loan(target uuid,sales uuid,expected_revision bigint) returns public.loan_applications language plpgsql security definer set search_path='' as $$begin
 perform 1 from public.loan_applications where id=target for update;
 if exists(select 1 from public.finance_cases where loan_id=target) and not exists(select 1 from public.staff_memberships where user_id=sales and active and role in ('sales','admin','super_admin')) then raise exception 'Tracked cases require an active Salesman; Office Admin is assigned separately by handover.';end if;
 return public.e2_legacy_assign_loan(target,sales,expected_revision);
end;$$;

-- Explicit deny-list first, including Supabase projects with permissive default function grants.
do $$declare f record;begin
 for f in select oid::regprocedure sig from pg_proc where pronamespace='public'::regnamespace and (proname like 'e2_finance_%' or proname in ('e2_configure_finance_dispatcher','e2_assign_finance_admin','e2_open_finance_case','e2_adopt_legacy_finance_case','e2_rename_finance_case','e2_review_finance_case','e2_handoff_finance_case','e2_save_finance_institution','e2_save_finance_application','e2_review_finance_application','e2_record_finance_submission','e2_record_finance_outcome','e2_select_finance_offer','e2_intake_handoff','e2_intake_progress','e2_update_loan_status','e2_assign_loan')) loop
 execute format('revoke all on function %s from public,anon,authenticated,service_role',f.sig);
 end loop;
end$$;
grant execute on function public.e2_finance_active_staff(),public.e2_finance_is_dispatcher(),public.e2_configure_finance_dispatcher(uuid,boolean,bigint),public.e2_assign_finance_admin(uuid,uuid,text,bigint),public.e2_finance_case_access(uuid),public.e2_finance_loan_access(uuid),public.e2_finance_source_loan_access(uuid),public.e2_finance_workspace(uuid),
 public.e2_open_finance_case(text,uuid),public.e2_adopt_legacy_finance_case(text,uuid,bigint,text),public.e2_rename_finance_case(uuid,text,bigint),public.e2_review_finance_case(uuid,bigint,boolean,boolean,text[],text),public.e2_handoff_finance_case(uuid,uuid,text,bigint),
 public.e2_save_finance_institution(uuid,jsonb,bigint),public.e2_save_finance_application(uuid,uuid,jsonb,bigint),public.e2_review_finance_application(uuid,bigint,text),
 public.e2_record_finance_submission(uuid,bigint,timestamptz,text,text),public.e2_record_finance_outcome(uuid,bigint,text,text[],numeric,numeric,integer,text),public.e2_select_finance_offer(uuid,uuid,bigint,bigint,text),
 public.e2_intake_handoff(uuid,uuid,text,bigint),public.e2_intake_progress(uuid,text,text,bigint),public.e2_update_loan_status(uuid,text,text,bigint),public.e2_assign_loan(uuid,uuid,bigint) to authenticated;
commit;
