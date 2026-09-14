begin;
alter table public.loan_applications add column applicant_type text check(applicant_type in ('worker','self_employed'));
create table public.loan_documents(
 id uuid primary key default gen_random_uuid(),application_id uuid not null references public.loan_applications(id) on delete cascade,
 category text not null check(category in ('ic_front','ic_back','driving_license','payslip','bank_statement','epf','company_bank_statement')),
 filename text not null check(length(filename) between 1 and 160),mime_type text not null check(mime_type in ('image/jpeg','image/png','application/pdf')),
 byte_size bigint not null check(byte_size between 1 and 10485760),covered_months text[] not null default '{}',
 path text unique not null,state text not null default 'uploading' check(state in ('uploading','ready')),
 created_at timestamptz not null default now(),removed_at timestamptz,
 privacy_version text not null default '2026-09-14-documents',privacy_accepted_at timestamptz not null default now(),
 check(path=application_id::text||'/'||id::text),check(cardinality(covered_months)<=6)
);
create index loan_documents_application on public.loan_documents(application_id);
alter table public.loan_documents enable row level security;
revoke all on public.loan_documents from public,anon,authenticated;
grant select on public.loan_documents to authenticated;
create function public.e2_doc_access(target uuid,edit boolean default false) returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.loan_applications a where a.id=target and ((a.customer_id=auth.uid() and public.e2_customer_allowed() and (not edit or a.status in ('Draft','Submitted to E2','Needs information'))) or (not edit and a.submitted_at is not null and public.e2_loan_staff(a.assigned_sales))));
$$;
create policy loan_doc_read on public.loan_documents for select to authenticated using (
 exists(select 1 from public.loan_applications a where a.id=application_id and a.customer_id=auth.uid() and public.e2_customer_allowed()) or (state='ready' and removed_at is null and public.e2_doc_access(application_id,false))
);
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types) values('loan-documents','loan-documents',false,10485760,array['image/jpeg','image/png','application/pdf']);
create function public.e2_doc_storage(object_path text,operation text) returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.loan_documents d join public.loan_applications a on a.id=d.application_id where d.path=object_path and (
 (operation='read' and ((a.customer_id=auth.uid() and public.e2_customer_allowed()) or (d.state='ready' and d.removed_at is null and a.submitted_at is not null and public.e2_loan_staff(a.assigned_sales)))) or
 (operation='upload' and d.state='uploading' and d.removed_at is null and a.customer_id=auth.uid() and public.e2_customer_allowed() and a.status in ('Draft','Submitted to E2','Needs information')) or
 (operation='delete' and (d.state='uploading' or d.removed_at is not null) and a.customer_id=auth.uid() and public.e2_customer_allowed())
 ));
$$;
create policy loan_file_read on storage.objects for select to authenticated using(bucket_id='loan-documents' and public.e2_doc_storage(name,'read'));
create policy loan_file_upload on storage.objects for insert to authenticated with check(bucket_id='loan-documents' and public.e2_doc_storage(name,'upload'));
create policy loan_file_delete on storage.objects for delete to authenticated using(bucket_id='loan-documents' and public.e2_doc_storage(name,'delete'));
create function public.e2_set_applicant_type(target uuid,kind text,expected_revision bigint) returns public.loan_applications language plpgsql security definer set search_path='' as $$
declare a public.loan_applications;begin
 select * into a from public.loan_applications where id=target for update;
 if not found or a.customer_id is distinct from auth.uid() or not public.e2_doc_access(target,true) then raise exception 'Only the applicant can change this upload checklist.';end if;
 if a.revision is distinct from expected_revision then raise exception 'Application changed. Reload before saving.';end if;
 if kind is null or kind not in ('worker','self_employed') then raise exception 'Choose Worker or Self-employed / Business owner.';end if;
 if a.applicant_type is distinct from kind and exists(select 1 from public.loan_documents where application_id=target and removed_at is null) then raise exception 'Remove the existing files before changing the checklist type.';end if;
 update public.loan_applications set applicant_type=kind,revision=revision+1,updated_at=now() where id=target returning * into a;return a;
end;$$;
create function public.e2_reserve_document(target uuid,doc_category text,file_name text,file_mime text,file_bytes bigint,months text[],accept_notice boolean) returns public.loan_documents language plpgsql security definer set search_path='' as $$
declare a public.loan_applications;d public.loan_documents;new_id uuid:=gen_random_uuid();begin
 select * into a from public.loan_applications where id=target for update;
 if not found or a.customer_id is distinct from auth.uid() or not public.e2_doc_access(target,true) then raise exception 'Only the applicant can upload at this application stage.';end if;
 if accept_notice is distinct from true then raise exception 'Accept the document privacy notice before uploading.';end if;
 if a.applicant_type is null then raise exception 'Choose your applicant type first.';end if;
 if doc_category is null or not (doc_category in ('ic_front','ic_back','driving_license') or (a.applicant_type='worker' and doc_category in ('payslip','bank_statement','epf')) or (a.applicant_type='self_employed' and doc_category='company_bank_statement')) then raise exception 'This document is not part of your checklist.';end if;
 if months is null or exists(select 1 from unnest(months) m where m is null or m !~ '^[0-9]{4}-(0[1-9]|1[0-2])$') or cardinality(months)<>(select count(distinct m) from unnest(months) m) then raise exception 'Choose valid, distinct statement months.';end if;
 if exists(select 1 from unnest(months) m where m>to_char(current_date,'YYYY-MM') or m<to_char(current_date-interval '17 months','YYYY-MM')) then raise exception 'Choose statement months within the latest 18 months.';end if;
 if doc_category in ('payslip','bank_statement','company_bank_statement') then
  if cardinality(months) not between 1 and (case when doc_category='company_bank_statement' then 6 else 3 end) then raise exception 'Select the months covered by this file.';end if;
 elsif cardinality(months)<>0 then raise exception 'Months are only needed for payslips or bank statements.';end if;
 if (select count(*) from public.loan_documents where application_id=target and removed_at is null)>=30 then raise exception 'Maximum 30 files per application. Remove an old file or combine pages into a PDF.';end if;
 insert into public.loan_documents(id,application_id,category,filename,mime_type,byte_size,covered_months,path) values(new_id,target,doc_category,trim(file_name),file_mime,file_bytes,months,target::text||'/'||new_id::text) returning * into d;
 update public.loan_applications set revision=revision+1,updated_at=now() where id=target;return d;
end;$$;
create function public.e2_finish_document(document_id uuid,replaces uuid default null) returns public.loan_documents language plpgsql security definer set search_path='' as $$
declare d public.loan_documents;a public.loan_applications;meta jsonb;begin
 select * into d from public.loan_documents where id=document_id;
 select * into a from public.loan_applications where id=d.application_id for update;
 select * into d from public.loan_documents where id=document_id for update;
 if d.id is null or a.customer_id is distinct from auth.uid() or not public.e2_doc_access(a.id,true) or d.removed_at is not null then raise exception 'Upload no longer available.';end if;
 if d.state='ready' then return d;end if;
 select metadata into meta from storage.objects where bucket_id='loan-documents' and name=d.path;
 if meta is null or (meta->>'size')::bigint is distinct from d.byte_size or meta->>'mimetype' is distinct from d.mime_type then raise exception 'Upload is incomplete or file metadata changed. Retry the upload.';end if;
 if replaces is not null then
  update public.loan_documents set removed_at=now() where id=replaces and application_id=d.application_id and category=d.category and state='ready' and removed_at is null;
  if not found then raise exception 'Original file changed. Reload before replacing it.';end if;
 end if;
 update public.loan_documents set state='ready' where id=d.id returning * into d;
 update public.loan_applications set revision=revision+1,updated_at=now() where id=a.id;
 if a.submitted_at is not null then insert into public.loan_events(application_id,actor,event,note) values(a.id,auth.uid(),'Document uploaded',d.category);end if;
 return d;
end;$$;
create function public.e2_remove_document(document_id uuid) returns void language plpgsql security definer set search_path='' as $$
declare d public.loan_documents;a public.loan_applications;begin
 select * into d from public.loan_documents where id=document_id;
 select * into a from public.loan_applications where id=d.application_id for update;
 select * into d from public.loan_documents where id=document_id for update;
 if d.id is null or a.customer_id is distinct from auth.uid() or not public.e2_customer_allowed() then raise exception 'Only the applicant can remove this file.';end if;
 if d.state='ready' and d.removed_at is null and not public.e2_doc_access(a.id,true) then raise exception 'Files are read-only at this application stage. Ask E2 to request an update.';end if;
 update public.loan_documents set removed_at=coalesce(removed_at,now()) where id=d.id;
 update public.loan_applications set revision=revision+1,updated_at=now() where id=a.id;
 if a.submitted_at is not null and d.state='ready' and d.removed_at is null then insert into public.loan_events(application_id,actor,event,note) values(a.id,auth.uid(),'Document removed',d.category);end if;
end;$$;
revoke all on function public.e2_doc_access(uuid,boolean),public.e2_doc_storage(text,text),public.e2_set_applicant_type(uuid,text,bigint),public.e2_reserve_document(uuid,text,text,text,bigint,text[],boolean),public.e2_finish_document(uuid,uuid),public.e2_remove_document(uuid) from public,anon,authenticated;
grant execute on function public.e2_doc_access(uuid,boolean),public.e2_doc_storage(text,text),public.e2_set_applicant_type(uuid,text,bigint),public.e2_reserve_document(uuid,text,text,text,bigint,text[],boolean),public.e2_finish_document(uuid,uuid),public.e2_remove_document(uuid) to authenticated;
commit;
