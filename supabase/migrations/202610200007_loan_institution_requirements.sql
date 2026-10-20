-- Staff selects a reviewed active institution for an existing submitted loan.
-- Draft institution settings stay private; activation is deliberately not provided here.
begin;
alter table public.loan_applications add column document_requirements jsonb;
alter table public.loan_documents drop constraint loan_documents_category_check;
alter table public.loan_documents add constraint loan_documents_category_check check(category in ('ic_front','ic_back','driving_license','payslip','bank_statement','epf','company_bank_statement','ssm','employment','tax','financials','vehicle','guarantor'));

create function public.e2_loan_institution_choices(target uuid) returns table(name text,available boolean)
language plpgsql stable security definer set search_path='' as $$
declare a public.loan_applications;begin
 select * into a from public.loan_applications where id=target;
 if not found or a.submitted_at is null or not public.e2_loan_staff(a.assigned_sales) then raise exception 'Assigned staff access required.';end if;
 return query select d.name,(d.active and d.checklist_confirmed and d.guarantor_policy<>'pending' and btrim(d.other_documents)='') from public.e2_finance_institution_drafts d order by d.name;
end;$$;

create function public.e2_set_loan_institution(target uuid,institution_name text,guarantor_needed boolean,expected_revision bigint)
returns public.loan_applications language plpgsql security definer set search_path='' as $$
declare a public.loan_applications; d public.e2_finance_institution_drafts; keys text[]; k text; mapped text; n integer; items jsonb:='[]';begin
 select * into a from public.loan_applications where id=target for update;
 if not found or a.submitted_at is null or not public.e2_loan_staff(a.assigned_sales) then raise exception 'Assigned staff access required.';end if;
 if a.status not in ('Submitted to E2','Needs information') then raise exception 'Request information before changing document requirements.';end if;
 if expected_revision is null or a.revision is distinct from expected_revision then raise exception 'Application changed. Reload before saving.';end if;
 if a.applicant_type is null then raise exception 'Applicant must choose their employment type first.';end if;
 select * into d from public.e2_finance_institution_drafts where name=institution_name for share;
 if not found or not d.active or not d.checklist_confirmed or d.guarantor_policy='pending' or btrim(d.other_documents)<>'' then raise exception 'Institution requirements are not ready. Do not use an unconfirmed or inactive institution.';end if;
 if guarantor_needed is null or (d.guarantor_policy='required' and not guarantor_needed) or (d.guarantor_policy='not_required' and guarantor_needed) then raise exception 'Review this institution’s guarantor requirement.';end if;
 keys:=case a.applicant_type when 'worker' then d.required_documents when 'commission' then d.commission_documents when 'self_employed' then d.company_documents end;
 if coalesce(cardinality(keys),0)=0 then raise exception 'Institution checklist is empty.';end if;
 foreach k in array keys loop
  mapped:=case k when 'driving_licence' then 'driving_license' when 'payslips' then 'payslip' when 'personal_bank' then 'bank_statement' when 'company_bank' then 'company_bank_statement' else k end;
  n:=case k when 'payslips' then case when a.applicant_type='commission' then d.commission_payslip_months else d.salary_payslip_months end when 'personal_bank' then case when a.applicant_type='commission' then d.commission_bank_months else d.salary_bank_months end when 'company_bank' then d.company_bank_months else 0 end;
  if n is null or n<0 or n>6 or (k in ('payslips','personal_bank','company_bank') and n=0) then raise exception 'Statement period needs review (1–6 months supported).';end if;
  items:=items||jsonb_build_array(jsonb_build_object('key',mapped,'months',n));
 end loop;
 if guarantor_needed then items:=items||jsonb_build_array(jsonb_build_object('key','guarantor','months',0));end if;
 update public.loan_applications set document_requirements=jsonb_build_object('institution',d.name,'institution_revision',d.revision,'applicant_type',a.applicant_type,'items',items,'guarantor_needed',guarantor_needed,'selected_at',now(),'selected_by',auth.uid()),revision=revision+1,updated_at=now() where id=target returning * into a;
 insert into public.loan_events(application_id,actor,event,note) values(target,auth.uid(),'Document requirements selected',d.name);
 return a;
end;$$;

create function public.e2_loan_document_requirements(target uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare a public.loan_applications; d public.e2_finance_institution_drafts;begin
 if not public.e2_doc_access(target,false) then raise exception 'Application access required.';end if;
 select * into a from public.loan_applications where id=target;
 if a.document_requirements is null then return jsonb_build_object('status','unassigned');end if;
 select * into d from public.e2_finance_institution_drafts where name=a.document_requirements->>'institution';
 if not found or not d.active or not d.checklist_confirmed or d.revision::text is distinct from a.document_requirements->>'institution_revision' or a.applicant_type is distinct from a.document_requirements->>'applicant_type' then
  return jsonb_build_object('status','review_required','institution',a.document_requirements->>'institution');
 end if;
 -- Only public checklist fields: no portal, email, blacklist rules or internal notes.
 return (a.document_requirements-'selected_by')||jsonb_build_object('status','selected');
end;$$;
revoke all on function public.e2_loan_institution_choices(uuid),public.e2_set_loan_institution(uuid,text,boolean,bigint),public.e2_loan_document_requirements(uuid) from public,anon,authenticated,service_role;
grant execute on function public.e2_loan_institution_choices(uuid),public.e2_set_loan_institution(uuid,text,boolean,bigint),public.e2_loan_document_requirements(uuid) to authenticated;

create or replace function public.e2_reserve_document(target uuid,doc_category text,file_name text,file_mime text,file_bytes bigint,months text[],accept_notice boolean) returns public.loan_documents language plpgsql security definer set search_path='' as $$
declare a public.loan_applications;d public.loan_documents;new_id uuid:=gen_random_uuid(); requirements jsonb; required_item jsonb;begin
 select * into a from public.loan_applications where id=target for update;
 if not found or a.customer_id is distinct from auth.uid() or not public.e2_doc_access(target,true) then raise exception 'Only the applicant can upload at this application stage.';end if;
 if accept_notice is distinct from true then raise exception 'Accept the document privacy notice before uploading.';end if;
 if a.applicant_type is null then raise exception 'Choose your applicant type first.';end if;
 requirements:=public.e2_loan_document_requirements(target);
 if requirements->>'status'='selected' then
  select value into required_item from jsonb_array_elements(requirements->'items') where value->>'key'=doc_category;
  if required_item is null then raise exception 'This document is not part of the selected institution checklist.';end if;
 else
 if doc_category is null or not (doc_category in ('ic_front','ic_back','driving_license') or (a.applicant_type='worker' and doc_category in ('payslip','bank_statement','epf')) or (a.applicant_type='commission' and doc_category in ('payslip','bank_statement')) or (a.applicant_type='self_employed' and doc_category in ('ssm','company_bank_statement'))) then raise exception 'This document is not part of your checklist.';end if;
 end if;
 if months is null or exists(select 1 from unnest(months) m where m is null or m !~ '^[0-9]{4}-(0[1-9]|1[0-2])$') or cardinality(months)<>(select count(distinct m) from unnest(months) m) then raise exception 'Choose valid, distinct statement months.';end if;
 if exists(select 1 from unnest(months) m where m>to_char(current_date,'YYYY-MM') or m<to_char(current_date-interval '17 months','YYYY-MM')) then raise exception 'Choose statement months within the latest 18 months.';end if;
 if doc_category in ('payslip','bank_statement','company_bank_statement') then
  if cardinality(months) not between 1 and (case when required_item is not null then least(6,(required_item->>'months')::integer) when doc_category='company_bank_statement' or a.applicant_type='commission' then 6 else 3 end) then raise exception 'Select the months covered by this file.';end if;
 elsif cardinality(months)<>0 then raise exception 'Months are only needed for payslips or bank statements.';end if;
 if (select count(*) from public.loan_documents where application_id=target and removed_at is null)>=30 then raise exception 'Maximum 30 files per application. Remove an old file or combine pages into a PDF.';end if;
 insert into public.loan_documents(id,application_id,category,filename,mime_type,byte_size,covered_months,path) values(new_id,target,doc_category,trim(file_name),file_mime,file_bytes,months,target::text||'/'||new_id::text) returning * into d;
 update public.loan_applications set revision=revision+1,updated_at=now() where id=target;return d;
end;$$;
commit;
