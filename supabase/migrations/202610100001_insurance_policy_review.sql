-- Development-only insurance-policy review. Apply only after separate backend
-- approval and hosted isolation/backup checks. No OCR provider or account grants.
begin;
create table public.insurance_policy_documents(
 id uuid primary key default gen_random_uuid(),case_id uuid not null references public.finance_cases(id),
 uploaded_by uuid not null references auth.users(id),filename text not null check(length(filename) between 1 and 160),
 mime_type text not null check(mime_type in ('application/pdf','image/jpeg','image/png')),
 byte_size bigint not null check(byte_size between 1 and 10485760),client_sha256 text not null check(client_sha256~'^[0-9a-f]{64}$'),
 path text unique not null,state text not null default 'uploading' check(state in ('uploading','ready')),
 extraction jsonb,created_at timestamptz not null default now(),ready_at timestamptz,
 unique(case_id,client_sha256),unique(case_id,id),check(path=case_id::text||'/'||id::text),
 check((state='uploading' and extraction is null and ready_at is null) or (state='ready' and extraction is not null and ready_at is not null))
);
create table public.insurance_policy_records(
 case_id uuid primary key references public.finance_cases(id),fields jsonb not null default '{}',
 provenance jsonb not null default '{}',revision bigint not null default 1,
 updated_by uuid not null references auth.users(id),updated_at timestamptz not null default now()
);
create table public.insurance_policy_events(
 id bigint generated always as identity primary key,case_id uuid not null references public.finance_cases(id),
 document_id uuid not null,actor uuid not null references auth.users(id),event text not null,
 before_fields jsonb not null default '{}',after_fields jsonb not null default '{}',provenance jsonb not null default '{}',
 note text not null default '',created_at timestamptz not null default now(),
 foreign key(case_id,document_id) references public.insurance_policy_documents(case_id,id)
);
create index insurance_policy_event_case on public.insurance_policy_events(case_id,id);
alter table public.insurance_policy_documents enable row level security;
alter table public.insurance_policy_records enable row level security;
alter table public.insurance_policy_events enable row level security;
revoke all on public.insurance_policy_documents,public.insurance_policy_records,public.insurance_policy_events from public,anon,authenticated,service_role;
grant select on public.insurance_policy_documents,public.insurance_policy_records,public.insurance_policy_events to authenticated;

create function public.e2_policy_can_write(target uuid) returns boolean language sql stable security definer set search_path='' as $$
 select public.e2_finance_case_access(target) and exists(select 1 from public.finance_cases c join public.staff_memberships m on m.user_id=auth.uid() and m.active
 where c.id=target and (m.role='super_admin' or (c.handed_at is not null and c.office_admin=m.user_id and m.role in ('office_admin','admin'))));
$$;
create policy insurance_document_read on public.insurance_policy_documents for select to authenticated using(public.e2_finance_case_access(case_id) and (state='ready' or (uploaded_by=auth.uid() and public.e2_policy_can_write(case_id))));
create policy insurance_record_read on public.insurance_policy_records for select to authenticated using(public.e2_finance_case_access(case_id));
create policy insurance_event_read on public.insurance_policy_events for select to authenticated using(public.e2_finance_case_access(case_id));
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types) values('insurance-policies','insurance-policies',false,10485760,array['application/pdf','image/jpeg','image/png']);
create function public.e2_policy_storage(object_path text,operation text) returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.insurance_policy_documents d where d.path=object_path and public.e2_finance_case_access(d.case_id) and
 ((operation='read' and (d.state='ready' or (d.uploaded_by=auth.uid() and public.e2_policy_can_write(d.case_id)))) or
 (operation='upload' and d.state='uploading' and d.uploaded_by=auth.uid() and public.e2_policy_can_write(d.case_id))));
$$;
create policy insurance_file_read on storage.objects for select to authenticated using(bucket_id='insurance-policies' and public.e2_policy_storage(name,'read'));
create policy insurance_file_upload on storage.objects for insert to authenticated with check(bucket_id='insurance-policies' and public.e2_policy_storage(name,'upload'));
-- No UPDATE/DELETE policy: originals cannot be replaced or removed by staff.

create function public.e2_policy_valid_fields(value jsonb) returns boolean language plpgsql immutable set search_path='' as $$
declare k text;v text;parsed date;begin
 if value is null or jsonb_typeof(value)<>'object' then return false;end if;
 for k,v in select key,val#>>'{}' from jsonb_each(value) as x(key,val) loop
  if k not in ('insurer','policy_number','registration','insured_name','sum_insured','premium','ncd','inception','expiry') or jsonb_typeof(value->k)<>'string' or length(v) not between 1 and 160 or v<>btrim(v) or v~'[[:cntrl:]]' then return false;end if;
  if k in ('sum_insured','premium','ncd') then
   if v!~'^(0|[1-9][0-9]*)(\.[0-9]{1,2})?$' then return false;end if;
   if v::numeric>(case when k='ncd' then 100 else 100000000 end) then return false;end if;
  elsif k in ('inception','expiry') then
   if v!~'^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then return false;end if;
   begin parsed:=v::date;exception when others then return false;end;
   if parsed<date '1900-01-01' or parsed>date '2100-12-31' or to_char(parsed,'YYYY-MM-DD')<>v then return false;end if;
  elsif k='registration' and v!~'^[A-Z0-9]{1,30}$' then return false;
  end if;
 end loop;
 return not(value ? 'inception' and value ? 'expiry' and value->>'expiry'<value->>'inception');
end;$$;
create function public.e2_policy_valid_extraction(value jsonb) returns boolean language plpgsql immutable set search_path='' as $$
declare k text;f jsonb;begin
 if value is null or jsonb_typeof(value)<>'object' or octet_length(value::text)>16000 or value->>'version' is distinct from 'local-policy-text-v1' or value->>'mode' not in ('text_pdf','manual_image','manual_scanned_pdf') or value->>'mode' is null or jsonb_typeof(value->'fields') is distinct from 'object' then return false;end if;
 if exists(select 1 from jsonb_object_keys(value) as entry(top_key) where entry.top_key not in ('version','mode','fields')) or (select count(*) from jsonb_object_keys(value->'fields'))<>9 then return false;end if;
 for k,f in select * from jsonb_each(value->'fields') loop
  if k not in ('insurer','policy_number','registration','insured_name','sum_insured','premium','ncd','inception','expiry') or jsonb_typeof(f)<>'object' or exists(select 1 from jsonb_object_keys(f) x where x not in ('value','issue','page','excerpt')) then return false;end if;
  if not(f ?& array['value','issue','page','excerpt']) or jsonb_typeof(f->'issue')<>'string' or length(f->>'issue')>240 or jsonb_typeof(f->'excerpt')<>'string' or length(f->>'excerpt')>240 then return false;end if;
  if f->'value'<>'null'::jsonb and not public.e2_policy_valid_fields(jsonb_build_object(k,f->'value')) then return false;end if;
  if f->'page'<>'null'::jsonb and (jsonb_typeof(f->'page')<>'number' or (f->>'page')!~'^[0-9]+$') then return false;end if;
  if f->'page'<>'null'::jsonb and (f->>'page')::int not between 1 and 20 then return false;end if;
  if value->>'mode'<>'text_pdf' and f->'value'<>'null'::jsonb then return false;end if;
 end loop;
 return true;
end;$$;

create function public.e2_reserve_policy(target uuid,expected_case_revision bigint,file_name text,file_mime text,file_bytes bigint,file_sha256 text) returns public.insurance_policy_documents language plpgsql security definer set search_path='' as $$
declare d public.insurance_policy_documents;new_id uuid:=gen_random_uuid();begin
 if expected_case_revision is null then raise exception 'Case revision required.';end if;
 perform public.e2_finance_lock_case(target,expected_case_revision,'office');
 select * into d from public.insurance_policy_documents where case_id=target and client_sha256=file_sha256 for update;
 if found then
  if d.state='uploading' and d.uploaded_by<>auth.uid() then raise exception 'This file has an incomplete upload by another staff member.';end if;
  if d.byte_size is distinct from file_bytes or d.mime_type is distinct from file_mime then raise exception 'Duplicate fingerprint has conflicting file metadata.';end if;
  return d;
 end if;
 if (select count(*) from public.insurance_policy_documents where case_id=target)>=20 then raise exception 'Maximum 20 policy originals per case. Ask for a reviewed retention cleanup.';end if;
 insert into public.insurance_policy_documents(id,case_id,uploaded_by,filename,mime_type,byte_size,client_sha256,path)
 values(new_id,target,auth.uid(),btrim(file_name),file_mime,file_bytes,file_sha256,target::text||'/'||new_id::text) returning * into d;return d;
end;$$;
create function public.e2_finish_policy(target uuid,document_id uuid,expected_case_revision bigint,extraction jsonb) returns public.insurance_policy_documents language plpgsql security definer set search_path='' as $$
declare d public.insurance_policy_documents;meta jsonb;begin
 if expected_case_revision is null then raise exception 'Case revision required.';end if;
 perform public.e2_finance_lock_case(target,expected_case_revision,'office');
 select * into d from public.insurance_policy_documents where id=document_id and case_id=target for update;
 if not found then raise exception 'Policy document unavailable in this case.';end if;
 if d.state='ready' then return d;end if;
 if d.uploaded_by<>auth.uid() then raise exception 'Only the uploader can finish this upload.';end if;
 if not public.e2_policy_valid_extraction(extraction) then raise exception 'Invalid local extraction evidence.';end if;
 select metadata into meta from storage.objects where bucket_id='insurance-policies' and name=d.path;
 if meta is null or (meta->>'size')::bigint is distinct from d.byte_size or meta->>'mimetype' is distinct from d.mime_type then raise exception 'Upload incomplete or metadata changed. Select the same file to retry.';end if;
 if (d.mime_type<>'application/pdf' and extraction->>'mode'<>'manual_image') or (d.mime_type='application/pdf' and extraction->>'mode'='manual_image') then raise exception 'Extraction mode does not match document type.';end if;
 update public.insurance_policy_documents set state='ready',ready_at=now(),extraction=e2_finish_policy.extraction where id=d.id returning * into d;
 insert into public.insurance_policy_events(case_id,document_id,actor,event,note) values(target,d.id,auth.uid(),'original_uploaded','Original retained. Local suggestions are unverified; no case fields saved.');return d;
end;$$;

create function public.e2_save_policy_review(target uuid,document_id uuid,expected_case_revision bigint,expected_revision bigint,patch jsonb,replace_fields text[],reviewed boolean,case_confirmed boolean,note text) returns public.insurance_policy_records language plpgsql security definer set search_path='' as $$
declare c public.finance_cases;d public.insurance_policy_documents;r public.insurance_policy_records;prior jsonb;merged jsonb;origins jsonb;selected_origins jsonb:='{}';k text;plate text;begin
 if expected_case_revision is null or expected_revision is null then raise exception 'Case and policy revisions required.';end if;
 c:=public.e2_finance_lock_case(target,expected_case_revision,'office');
 select * into d from public.insurance_policy_documents where id=document_id and case_id=target and state='ready' for share;
 if not found then raise exception 'Choose a ready original from this case.';end if;
 perform 1 from storage.objects where bucket_id='insurance-policies' and name=d.path and metadata->>'size'=d.byte_size::text and metadata->>'mimetype'=d.mime_type for share;
 if not found then raise exception 'Original policy file is unavailable or changed. Restore it through the approved recovery process before review.';end if;
 if reviewed is distinct from true or case_confirmed is distinct from true or length(btrim(coalesce(note,''))) not between 10 and 1000 then raise exception 'Check the original, confirm the case and record a review note.';end if;
 if not public.e2_policy_valid_fields(patch) or patch='{}'::jsonb then raise exception 'Select valid reviewed policy fields. Blank values cannot overwrite saved values.';end if;
 if replace_fields is null or cardinality(replace_fields)>9 or exists(select 1 from unnest(replace_fields) key where key is null or not(patch ? key)) then raise exception 'Replacement confirmation must name selected fields only.';end if;
 select * into r from public.insurance_policy_records where case_id=target for update;
 if expected_revision is distinct from coalesce(r.revision,0) then raise exception 'Policy changed. Reload and review the latest values before saving.';end if;
 prior:=coalesce(r.fields,'{}');origins:=coalesce(r.provenance,'{}');merged:=prior||patch;
 if not public.e2_policy_valid_fields(merged) then raise exception 'Reviewed dates or policy values conflict with existing fields.';end if;
 if c.loan_id is not null then select vehicle_summary->>'plate' into plate from public.loan_applications where id=c.loan_id;
 else select vehicle_summary->>'plate' into plate from public.intake_submissions where id=c.intake_id;end if;
 if patch ? 'registration' and coalesce(plate,'')<>'' and patch->>'registration'<>regexp_replace(upper(plate),'[[:space:]-]','','g') then raise exception 'Vehicle registration differs from this case. Choose the correct case and policy.';end if;
 for k in select jsonb_object_keys(patch) loop
  if prior ? k and prior->k is distinct from patch->k and not(k=any(replace_fields)) then raise exception 'Explicit replacement confirmation required for %.',k;end if;
  selected_origins:=selected_origins||jsonb_build_object(k,jsonb_build_object('document_id',d.id,'reviewed_by',auth.uid(),'reviewed_at',now(),'parser_version',d.extraction->>'version','method',case when d.extraction->'fields'->k->'value'=patch->k then 'reviewed_local_suggestion' else 'manual_review' end,'source',d.extraction->'fields'->k));
 end loop;
 insert into public.insurance_policy_records(case_id,fields,provenance,revision,updated_by) values(target,merged,origins||selected_origins,1,auth.uid())
 on conflict(case_id) do update set fields=excluded.fields,provenance=excluded.provenance,revision=insurance_policy_records.revision+1,updated_by=auth.uid(),updated_at=now() returning * into r;
 insert into public.insurance_policy_events(case_id,document_id,actor,event,before_fields,after_fields,provenance,note)
 values(target,d.id,auth.uid(),'review_saved',prior,merged,selected_origins,btrim(note));return r;
end;$$;
create function public.e2_policy_workspace(target uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare c public.finance_cases;source jsonb;begin
 if not public.e2_finance_case_access(target) then raise exception 'Assigned case access required.';end if;
 select * into c from public.finance_cases where id=target;
 if c.loan_id is not null then select jsonb_build_object('name',details->>'name','plate',vehicle_summary->>'plate') into source from public.loan_applications where id=c.loan_id;
 else select jsonb_build_object('name',details->>'name','plate',vehicle_summary->>'plate') into source from public.intake_submissions where id=c.intake_id;end if;
 return jsonb_build_object('case',jsonb_build_object('id',c.id,'revision',c.revision,'case_name',c.case_name,'source_kind',case when c.loan_id is not null then 'loan' else 'intake' end,'source_id',coalesce(c.loan_id,c.intake_id)),
 'source',source,'can_write',public.e2_policy_can_write(target),
 'record',(select to_jsonb(r) from public.insurance_policy_records r where case_id=target),
 'documents',coalesce((select jsonb_agg(to_jsonb(d) order by d.created_at desc,d.id) from public.insurance_policy_documents d where case_id=target and (state='ready' or (uploaded_by=auth.uid() and public.e2_policy_can_write(target)))),'[]'),
 'history',coalesce((select jsonb_agg(to_jsonb(e) order by e.id desc) from public.insurance_policy_events e where case_id=target),'[]'));
end;$$;
revoke all on function public.e2_policy_can_write(uuid),public.e2_policy_storage(text,text),public.e2_policy_valid_fields(jsonb),public.e2_policy_valid_extraction(jsonb),public.e2_reserve_policy(uuid,bigint,text,text,bigint,text),public.e2_finish_policy(uuid,uuid,bigint,jsonb),public.e2_save_policy_review(uuid,uuid,bigint,bigint,jsonb,text[],boolean,boolean,text),public.e2_policy_workspace(uuid) from public,anon,authenticated,service_role;
grant execute on function public.e2_policy_can_write(uuid),public.e2_policy_storage(text,text),public.e2_reserve_policy(uuid,bigint,text,text,bigint,text),public.e2_finish_policy(uuid,uuid,bigint,jsonb),public.e2_save_policy_review(uuid,uuid,bigint,bigint,jsonb,text[],boolean,boolean,text),public.e2_policy_workspace(uuid) to authenticated;
commit;
