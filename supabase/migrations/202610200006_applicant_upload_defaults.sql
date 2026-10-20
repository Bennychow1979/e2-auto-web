-- Applicant defaults; no files deleted, no institution activation.
begin;
alter table public.loan_applications drop constraint loan_applications_applicant_type_check;
alter table public.loan_applications add constraint loan_applications_applicant_type_check check(applicant_type in ('worker','commission','self_employed'));
alter table public.intake_submissions drop constraint intake_submissions_applicant_type_check;
alter table public.intake_submissions add constraint intake_submissions_applicant_type_check check(applicant_type in ('worker','commission','self_employed'));
alter table public.loan_documents drop constraint loan_documents_category_check;
alter table public.loan_documents add constraint loan_documents_category_check check(category in ('ic_front','ic_back','driving_license','payslip','bank_statement','epf','company_bank_statement','ssm'));
alter table public.intake_files drop constraint intake_files_category_check;
alter table public.intake_files add constraint intake_files_category_check check(category in ('ic_front','ic_back','driving_license','payslip','bank_statement','epf','company_bank_statement','ssm'));
create or replace function public.e2_set_applicant_type(target uuid,kind text,expected_revision bigint) returns public.loan_applications language plpgsql security definer set search_path='' as $$
declare a public.loan_applications;begin
 select * into a from public.loan_applications where id=target for update;
 if not found or a.customer_id is distinct from auth.uid() or not public.e2_doc_access(target,true) then raise exception 'Only the applicant can change this upload checklist.';end if;
 if a.revision is distinct from expected_revision then raise exception 'Application changed. Reload before saving.';end if;
 if kind is null or kind not in ('worker','commission','self_employed') then raise exception 'Choose Salary, Commission-based or Self-employed / Business owner.';end if;
 update public.loan_applications set applicant_type=kind,revision=revision+1,updated_at=now() where id=target returning * into a;return a;
end;$$;

create or replace function public.e2_reserve_document(target uuid,doc_category text,file_name text,file_mime text,file_bytes bigint,months text[],accept_notice boolean) returns public.loan_documents language plpgsql security definer set search_path='' as $$
declare a public.loan_applications;d public.loan_documents;new_id uuid:=gen_random_uuid();begin
 select * into a from public.loan_applications where id=target for update;
 if not found or a.customer_id is distinct from auth.uid() or not public.e2_doc_access(target,true) then raise exception 'Only the applicant can upload at this application stage.';end if;
 if accept_notice is distinct from true then raise exception 'Accept the document privacy notice before uploading.';end if;
 if a.applicant_type is null then raise exception 'Choose your applicant type first.';end if;
 if doc_category is null or not (doc_category in ('ic_front','ic_back','driving_license') or (a.applicant_type='worker' and doc_category in ('payslip','bank_statement','epf')) or (a.applicant_type='commission' and doc_category in ('payslip','bank_statement')) or (a.applicant_type='self_employed' and doc_category in ('ssm','company_bank_statement'))) then raise exception 'This document is not part of your checklist.';end if;
 if months is null or exists(select 1 from unnest(months) m where m is null or m !~ '^[0-9]{4}-(0[1-9]|1[0-2])$') or cardinality(months)<>(select count(distinct m) from unnest(months) m) then raise exception 'Choose valid, distinct statement months.';end if;
 if exists(select 1 from unnest(months) m where m>to_char(current_date,'YYYY-MM') or m<to_char(current_date-interval '17 months','YYYY-MM')) then raise exception 'Choose statement months within the latest 18 months.';end if;
 if doc_category in ('payslip','bank_statement','company_bank_statement') then
  if cardinality(months) not between 1 and (case when doc_category='company_bank_statement' or a.applicant_type='commission' then 6 else 3 end) then raise exception 'Select the months covered by this file.';end if;
 elsif cardinality(months)<>0 then raise exception 'Months are only needed for payslips or bank statements.';end if;
 if (select count(*) from public.loan_documents where application_id=target and removed_at is null)>=30 then raise exception 'Maximum 30 files per application. Remove an old file or combine pages into a PDF.';end if;
 insert into public.loan_documents(id,application_id,category,filename,mime_type,byte_size,covered_months,path) values(new_id,target,doc_category,trim(file_name),file_mime,file_bytes,months,target::text||'/'||new_id::text) returning * into d;
 update public.loan_applications set revision=revision+1,updated_at=now() where id=target;return d;
end;$$;

create or replace function public.e2_intake_begin(invite uuid,nonce uuid,kind text) returns jsonb language plpgsql security definer set search_path='' as $$declare a public.intake_submissions;l public.intake_links;c jsonb;begin
 if nonce is null or kind is null or kind not in ('worker','commission','self_employed') then raise exception 'Choose your applicant type.';end if;
 c:=public.e2_intake_context(invite);select * into l from public.intake_links where id=invite;
 perform pg_advisory_xact_lock(140011,1);
 select * into a from public.intake_submissions where link_id=invite and write_hash=sha256(convert_to(nonce::text,'UTF8'));
 if found then if a.applicant_type<>kind or (a.submitted_at is null and a.expires_at<now()) then raise exception 'Upload session expired or changed. Reopen the invitation.';end if;return jsonb_build_object('id',a.id,'received',a.submitted_at is not null);end if;
 if (select count(*) from public.intake_submissions where link_id=invite and created_at>now()-interval '1 hour')>=10 or (select count(*) from public.intake_submissions where salesperson=l.salesperson and created_at>now()-interval '1 day')>=50 or (select count(*) from public.intake_submissions where created_at>now()-interval '1 hour')>=100 then raise exception 'Too many requests. Please try later or contact your salesperson.';end if;
 insert into public.intake_submissions(link_id,write_hash,vehicle_id,salesperson,vehicle_summary,applicant_type) values(invite,sha256(convert_to(nonce::text,'UTF8')),l.vehicle_id,l.salesperson,c->'vehicle',kind) returning * into a;
 return jsonb_build_object('id',a.id,'received',false);
end;$$;

create or replace function public.e2_intake_prepare_file(target uuid,nonce uuid,file_id uuid,doc_category text,file_name text,file_mime text,file_bytes bigint,months text[]) returns public.intake_files language plpgsql security definer set search_path='' as $$declare a public.intake_submissions;f public.intake_files;begin
 a:=public.e2_intake_session(target,nonce);perform pg_advisory_xact_lock(140011,2);
 if months is null or exists(select 1 from unnest(months) m where m is null or m !~ '^[0-9]{4}-(0[1-9]|1[0-2])$' or m>to_char(current_date,'YYYY-MM') or m<to_char(current_date-interval '17 months','YYYY-MM')) or cardinality(months)<>(select count(distinct m) from unnest(months) m) then raise exception 'Choose valid, distinct statement months.';end if;
 if doc_category is null or not (doc_category in ('ic_front','ic_back','driving_license') or (a.applicant_type='worker' and doc_category in ('payslip','bank_statement','epf')) or (a.applicant_type='commission' and doc_category in ('payslip','bank_statement')) or (a.applicant_type='self_employed' and doc_category in ('ssm','company_bank_statement'))) then raise exception 'This file does not match your checklist.';end if;
 if doc_category in ('payslip','bank_statement','company_bank_statement') then if cardinality(months) not between 1 and (case when doc_category='company_bank_statement' or a.applicant_type='commission' then 6 else 3 end) then raise exception 'Select the months covered.';end if;elsif cardinality(months)<>0 then raise exception 'Months are only needed for income statements.';end if;
 select * into f from public.intake_files where id=file_id;
 if found then if f.state='removing' then raise exception 'File removal is in progress.';end if;if f.submission_id<>target or f.category<>doc_category or f.filename<>file_name or f.mime_type<>file_mime or f.byte_size<>file_bytes or f.covered_months<>months then raise exception 'File changed. Remove it and select again.';end if;return f;end if;
 if (select count(*) from public.intake_files where submission_id=target)>=30 then raise exception 'Maximum 30 files per application.';end if;
 if (select coalesce(sum(byte_size),0) from public.intake_files where created_at>now()-interval '1 day')+file_bytes>2147483648 then raise exception 'Uploads are temporarily busy. Contact your salesperson.';end if;
 insert into public.intake_files(id,submission_id,category,filename,mime_type,byte_size,covered_months,path) values(file_id,target,doc_category,file_name,file_mime,file_bytes,months,target::text||'/'||file_id::text) returning * into f;return f;
end;$$;
commit;
