
begin;
create table public.intake_links(id uuid primary key default gen_random_uuid(),vehicle_id uuid not null references public.vehicles(id),salesperson uuid not null references public.staff_memberships(user_id),active boolean not null default true,expires_at timestamptz not null default now()+interval '14 days',created_at timestamptz not null default now());
create table public.intake_submissions(id uuid primary key default gen_random_uuid(),link_id uuid not null references public.intake_links(id),write_hash bytea not null,vehicle_id uuid not null references public.vehicles(id),salesperson uuid not null references public.staff_memberships(user_id),office_admin uuid references public.staff_memberships(user_id),vehicle_summary jsonb not null,applicant_type text not null check(applicant_type in ('worker','self_employed')),details jsonb not null default '{}' check(jsonb_typeof(details)='object' and octet_length(details::text)<=30000),status text not null default 'Preparing' check(status in ('Preparing','Received by Salesman','Needs information','Sent to Office','Submitted to financier','Outcome recorded')),created_at timestamptz not null default now(),expires_at timestamptz not null default now()+interval '2 hours',submitted_at timestamptz,handed_at timestamptz,updated_at timestamptz not null default now(),revision bigint not null default 1,privacy_version text,privacy_accepted_at timestamptz,unique(link_id,write_hash));
create index intake_received on public.intake_submissions(salesperson,submitted_at desc);
create index intake_office on public.intake_submissions(office_admin,handed_at desc);
create table public.intake_files(id uuid primary key,submission_id uuid not null references public.intake_submissions(id) on delete cascade,category text not null check(category in ('ic_front','ic_back','driving_license','payslip','bank_statement','epf','company_bank_statement')),filename text not null check(length(filename) between 1 and 160),mime_type text not null check(mime_type in ('image/jpeg','image/png','application/pdf')),byte_size bigint not null check(byte_size between 1 and 10485760),covered_months text[] not null default '{}',path text unique not null,state text not null default 'uploading' check(state in ('uploading','ready','removing')),created_at timestamptz not null default now(),check(path=submission_id::text||'/'||id::text));
create index intake_files_submission on public.intake_files(submission_id);
create table public.intake_events(id bigint generated always as identity primary key,submission_id uuid not null references public.intake_submissions(id) on delete cascade,actor uuid references auth.users(id),event text not null,note text not null default '' check(length(note)<=1000),created_at timestamptz not null default now());
alter table public.intake_links enable row level security;alter table public.intake_submissions enable row level security;alter table public.intake_files enable row level security;alter table public.intake_events enable row level security;
revoke all on public.intake_links,public.intake_submissions,public.intake_files,public.intake_events from public,anon,authenticated;
grant select on public.intake_links,public.intake_submissions,public.intake_files,public.intake_events to authenticated;
grant all on public.intake_links,public.intake_submissions,public.intake_files,public.intake_events to service_role;
create function public.e2_intake_active_staff() returns boolean language sql stable security definer set search_path='' as $$select exists(select 1 from public.staff_memberships where user_id=auth.uid() and active and role in ('super_admin','admin','sales'))$$;
create function public.e2_intake_access(target uuid) returns boolean language sql stable security definer set search_path='' as $$select exists(select 1 from public.intake_submissions a join public.staff_memberships m on m.user_id=auth.uid() and m.active where a.id=target and a.submitted_at is not null and (m.role='super_admin' or (a.salesperson=m.user_id and m.role in ('sales','admin')) or (a.handed_at is not null and a.office_admin=m.user_id and m.role='admin')))$$;
create policy intake_links_staff on public.intake_links for select to authenticated using(public.e2_intake_active_staff() and (salesperson=auth.uid() or public.e2_is_super_admin()));
create policy intake_submissions_staff on public.intake_submissions for select to authenticated using(public.e2_intake_access(id));
create policy intake_files_staff on public.intake_files for select to authenticated using(state='ready' and public.e2_intake_access(submission_id));
create policy intake_events_staff on public.intake_events for select to authenticated using(public.e2_intake_access(submission_id));
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types) values('intake-documents','intake-documents',false,10485760,array['image/jpeg','image/png','application/pdf']);
create function public.e2_intake_file_read(object_path text) returns boolean language sql stable security definer set search_path='' as $$select exists(select 1 from public.intake_files where path=object_path and state='ready' and public.e2_intake_access(submission_id))$$;
create policy intake_storage_staff_read on storage.objects for select to authenticated using(bucket_id='intake-documents' and public.e2_intake_file_read(name));
create function public.e2_create_intake_link(vehicle uuid) returns public.intake_links language plpgsql security definer set search_path='' as $$declare l public.intake_links;begin
 if not public.e2_intake_active_staff() then raise exception 'Staff sign in required.';end if;
 if not exists(select 1 from public.vehicles where id=vehicle and publication='published' and stock_status='Available') then raise exception 'Choose an available published car.';end if;
 perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text,140011));
 select * into l from public.intake_links where vehicle_id=vehicle and salesperson=auth.uid() and active and expires_at>now()+interval '1 day' order by created_at desc limit 1;
 if found then return l;end if;
 if (select count(*) from public.intake_links where salesperson=auth.uid() and created_at>now()-interval '1 day')>=30 then raise exception 'Daily invitation limit reached.';end if;
 insert into public.intake_links(vehicle_id,salesperson) values(vehicle,auth.uid()) returning * into l;return l;
end;$$;
create function public.e2_revoke_intake_link(target uuid) returns void language plpgsql security definer set search_path='' as $$begin
 if not public.e2_intake_active_staff() then raise exception 'Staff sign in required.';end if;
 update public.intake_links set active=false where id=target and (salesperson=auth.uid() or public.e2_is_super_admin());if not found then raise exception 'Invitation unavailable.';end if;
end;$$;
create function public.e2_intake_context(invite uuid) returns jsonb language plpgsql security definer set search_path='' as $$declare result jsonb;begin
 select jsonb_build_object('vehicle',jsonb_build_object('id',v.id,'name',v.brand||' '||v.model,'variant',v.variant,'year',v.year,'plate',v.plate,'price',v.price),'contact',jsonb_build_object('name',coalesce(nullif(p.display_name,''),'E2 team'),'whatsapp',case when p.is_public then p.whatsapp else null end),'expires_at',l.expires_at) into result from public.intake_links l join public.vehicles v on v.id=l.vehicle_id join public.staff_memberships m on m.user_id=l.salesperson left join public.staff_profiles p on p.user_id=m.user_id where l.id=invite and l.active and l.expires_at>now() and m.active and m.role in ('sales','admin','super_admin') and v.publication='published' and v.stock_status='Available';
 if result is null then raise exception 'This invitation is unavailable. Ask your salesperson for a new link.';end if;return result;
end;$$;
create function public.e2_intake_begin(invite uuid,nonce uuid,kind text) returns jsonb language plpgsql security definer set search_path='' as $$declare a public.intake_submissions;l public.intake_links;c jsonb;begin
 if nonce is null or kind is null or kind not in ('worker','self_employed') then raise exception 'Choose your applicant type.';end if;
 c:=public.e2_intake_context(invite);select * into l from public.intake_links where id=invite;
 perform pg_advisory_xact_lock(140011,1);
 select * into a from public.intake_submissions where link_id=invite and write_hash=sha256(convert_to(nonce::text,'UTF8'));
 if found then if a.applicant_type<>kind or (a.submitted_at is null and a.expires_at<now()) then raise exception 'Upload session expired or changed. Reopen the invitation.';end if;return jsonb_build_object('id',a.id,'received',a.submitted_at is not null);end if;
 if (select count(*) from public.intake_submissions where link_id=invite and created_at>now()-interval '1 hour')>=10 or (select count(*) from public.intake_submissions where salesperson=l.salesperson and created_at>now()-interval '1 day')>=50 or (select count(*) from public.intake_submissions where created_at>now()-interval '1 hour')>=100 then raise exception 'Too many requests. Please try later or contact your salesperson.';end if;
 insert into public.intake_submissions(link_id,write_hash,vehicle_id,salesperson,vehicle_summary,applicant_type) values(invite,sha256(convert_to(nonce::text,'UTF8')),l.vehicle_id,l.salesperson,c->'vehicle',kind) returning * into a;
 return jsonb_build_object('id',a.id,'received',false);
end;$$;
create function public.e2_intake_session(target uuid,nonce uuid,allow_received boolean default false) returns public.intake_submissions language plpgsql security definer set search_path='' as $$declare a public.intake_submissions;begin
 select * into a from public.intake_submissions where id=target and write_hash=sha256(convert_to(nonce::text,'UTF8')) for update;
 if not found then raise exception 'Upload session unavailable.';end if;
 if a.submitted_at is not null then if allow_received then return a;else raise exception 'These details have already been submitted.';end if;end if;
 if a.expires_at<now() then raise exception 'Upload session expired. Reopen the invitation.';end if;
 perform public.e2_intake_context(a.link_id);return a;
end;$$;
create function public.e2_intake_prepare_file(target uuid,nonce uuid,file_id uuid,doc_category text,file_name text,file_mime text,file_bytes bigint,months text[]) returns public.intake_files language plpgsql security definer set search_path='' as $$declare a public.intake_submissions;f public.intake_files;begin
 a:=public.e2_intake_session(target,nonce);perform pg_advisory_xact_lock(140011,2);
 if months is null or exists(select 1 from unnest(months) m where m is null or m !~ '^[0-9]{4}-(0[1-9]|1[0-2])$' or m>to_char(current_date,'YYYY-MM') or m<to_char(current_date-interval '17 months','YYYY-MM')) or cardinality(months)<>(select count(distinct m) from unnest(months) m) then raise exception 'Choose valid, distinct statement months.';end if;
 if not (doc_category in ('ic_front','ic_back','driving_license') or (a.applicant_type='worker' and doc_category in ('payslip','bank_statement','epf')) or (a.applicant_type='self_employed' and doc_category='company_bank_statement')) then raise exception 'This file does not match your checklist.';end if;
 if doc_category in ('payslip','bank_statement','company_bank_statement') then if cardinality(months) not between 1 and (case when doc_category='company_bank_statement' then 6 else 3 end) then raise exception 'Select the months covered.';end if;elsif cardinality(months)<>0 then raise exception 'Months are only needed for income statements.';end if;
 select * into f from public.intake_files where id=file_id;
 if found then if f.state='removing' then raise exception 'File removal is in progress.';end if;if f.submission_id<>target or f.category<>doc_category or f.filename<>file_name or f.mime_type<>file_mime or f.byte_size<>file_bytes or f.covered_months<>months then raise exception 'File changed. Remove it and select again.';end if;return f;end if;
 if (select count(*) from public.intake_files where submission_id=target)>=30 then raise exception 'Maximum 30 files per application.';end if;
 if (select coalesce(sum(byte_size),0) from public.intake_files where created_at>now()-interval '1 day')+file_bytes>2147483648 then raise exception 'Uploads are temporarily busy. Contact your salesperson.';end if;
 insert into public.intake_files(id,submission_id,category,filename,mime_type,byte_size,covered_months,path) values(file_id,target,doc_category,file_name,file_mime,file_bytes,months,target::text||'/'||file_id::text) returning * into f;return f;
end;$$;
create function public.e2_intake_finish_file(target uuid,nonce uuid,file_id uuid) returns boolean language plpgsql security definer set search_path='' as $$declare a public.intake_submissions;f public.intake_files;m jsonb;begin
 a:=public.e2_intake_session(target,nonce);select * into f from public.intake_files where id=file_id and submission_id=target;if not found or f.state='removing' then raise exception 'File unavailable.';end if;
 select metadata into m from storage.objects where bucket_id='intake-documents' and name=f.path;
 if m is null or m->>'mimetype' is distinct from f.mime_type or (m->>'size')::bigint is distinct from f.byte_size then raise exception 'File upload incomplete. Try again.';end if;
 update public.intake_files set state='ready' where id=f.id;return true;
end;$$;
create function public.e2_intake_remove_file(target uuid,nonce uuid,file_id uuid) returns text language plpgsql security definer set search_path='' as $$declare a public.intake_submissions;f public.intake_files;begin
 a:=public.e2_intake_session(target,nonce);select * into f from public.intake_files where id=file_id and submission_id=target;
 if not found then return null;end if;update public.intake_files set state='removing' where id=f.id;return f.path;
end;$$;

create function public.e2_validate_intake_details(input jsonb,complete boolean,price numeric) returns jsonb language plpgsql immutable set search_path='' as $fn$
declare schema constant jsonb:=$schema${"deposit":{"label":"Preferred deposit (RM)","type":"number","required":true,"max":150},"tenure":{"label":"Preferred tenure","type":["3 years","4 years","5 years","6 years","7 years","8 years","9 years"],"required":true,"max":150},"name":{"label":"Full name","type":"text","required":true,"max":150},"ic":{"label":"I/C number","type":"text","required":true,"max":150},"old_ic":{"label":"Old I/C number","type":"text","required":false,"max":150},"phone":{"label":"Mobile / WhatsApp","type":"tel","required":true,"max":150},"email":{"label":"Email","type":"email","required":false,"max":150},"marital":{"label":"Marital status","type":["Single","Married","Divorced","Widowed"],"required":true,"max":150},"phone_model":{"label":"Phone model","type":"text","required":false,"max":150},"address":{"label":"Current home address","type":"textarea","required":true,"max":300},"since":{"label":"Living here since","type":"year","required":true,"max":150},"housing":{"label":"Current residence","type":["Rented / Sewa","Parents\u2019 home / Rumah ibu bapa","Own home / Rumah sendiri"],"required":true,"max":150},"hometown":{"label":"Hometown address","type":"textarea","required":true,"max":300},"company":{"label":"Company name","type":"text","required":true,"max":150},"position":{"label":"Position","type":"text","required":true,"max":150},"work_years":{"label":"Years employed","type":"number","required":true,"max":150},"work_months":{"label":"Additional months","type":"months","required":false,"max":150},"office_address":{"label":"Office address","type":"textarea","required":true,"max":300},"office_phone":{"label":"Office telephone","type":"tel","required":true,"max":150},"interview":{"label":"Best time for an interview call","type":["9:00 am \u2013 12:00 pm","12:00 pm \u2013 2:00 pm","2:00 pm \u2013 5:00 pm","Please arrange with me"],"required":true,"max":150},"marriage_cert":{"label":"Marriage certificate available?","type":["Yes","No","Not applicable"],"required":true,"max":150},"birth_cert":{"label":"Birth certificate available?","type":["Yes","No","Not applicable"],"required":true,"max":150},"credit":{"label":"Known credit / overdue debt issues?","type":["No known issues","Yes","Not sure"],"required":true,"max":150},"debt":{"label":"Outstanding amount (RM)","type":"number","required":false,"max":150},"e1_name":{"label":"Full name","type":"text","required":true,"max":150},"e1_phone":{"label":"Phone number","type":"tel","required":true,"max":150},"e1_relation":{"label":"Relationship","type":["Spouse","Parent","Sibling","Relative","Friend","Other"],"required":true,"max":150},"e1_ic":{"label":"I/C number","type":"text","required":false,"max":150},"e1_address":{"label":"Address","type":"textarea","required":false,"max":300},"e1_position":{"label":"Occupation / position","type":"text","required":false,"max":150},"e2_name":{"label":"Full name","type":"text","required":true,"max":150},"e2_phone":{"label":"Phone number","type":"tel","required":true,"max":150},"e2_relation":{"label":"Relationship","type":["Spouse","Parent","Sibling","Relative","Friend","Other"],"required":true,"max":150},"e2_ic":{"label":"I/C number","type":"text","required":false,"max":150},"e2_address":{"label":"Address","type":"textarea","required":false,"max":300},"e2_position":{"label":"Occupation / position","type":"text","required":false,"max":150},"guarantor":{"label":"Is a guarantor needed?","type":["Not requested","Yes","Not sure"],"required":true,"max":150},"g_name":{"label":"Full name","type":"text","required":true,"max":150},"g_ic":{"label":"I/C number","type":"text","required":true,"max":150},"g_old_ic":{"label":"Old I/C number","type":"text","required":false,"max":150},"g_phone":{"label":"Mobile / WhatsApp","type":"tel","required":true,"max":150},"g_email":{"label":"Email","type":"email","required":false,"max":150},"g_marital":{"label":"Marital status","type":["Single","Married","Divorced","Widowed"],"required":true,"max":150},"g_phone_model":{"label":"Phone model","type":"text","required":false,"max":150},"g_relation":{"label":"Relationship with hirer","type":["Spouse","Parent","Sibling","Relative","Other"],"required":true,"max":150},"g_address":{"label":"Current home address","type":"textarea","required":true,"max":300},"g_since":{"label":"Living here since","type":"year","required":true,"max":150},"g_housing":{"label":"Current residence","type":["Rented / Sewa","Parents\u2019 home / Rumah ibu bapa","Own home / Rumah sendiri"],"required":true,"max":150},"g_hometown":{"label":"Hometown address","type":"textarea","required":true,"max":300},"g_company":{"label":"Company name","type":"text","required":true,"max":150},"g_position":{"label":"Position","type":"text","required":true,"max":150},"g_work_years":{"label":"Years employed","type":"number","required":true,"max":150},"g_work_months":{"label":"Additional months","type":"months","required":false,"max":150},"g_office_address":{"label":"Office address","type":"textarea","required":true,"max":300},"g_office_phone":{"label":"Office telephone","type":"tel","required":true,"max":150},"g_interview":{"label":"Best time for an interview call","type":["9:00 am \u2013 12:00 pm","12:00 pm \u2013 2:00 pm","2:00 pm \u2013 5:00 pm","Please arrange with me"],"required":true,"max":150},"g_marriage_cert":{"label":"Marriage certificate available?","type":["Yes","No","Not applicable"],"required":true,"max":150},"g_birth_cert":{"label":"Birth certificate available?","type":["Yes","No","Not applicable"],"required":true,"max":150},"g_credit":{"label":"Known credit / overdue debt issues?","type":["No known issues","Yes","Not sure"],"required":true,"max":150},"g_debt":{"label":"Outstanding amount (RM)","type":"number","required":false,"max":150}}$schema$::jsonb; clean jsonb:='{}'; k text; value text; spec jsonb; enabled boolean;
begin
 if jsonb_typeof(input) is distinct from 'object' or octet_length(input::text)>30000 then raise exception 'Enter valid application details.';end if;
 for k in select jsonb_object_keys(input) loop
  if not schema ? k then raise exception 'Unknown application field: %',k;end if;
  if jsonb_typeof(input->k) is distinct from 'string' then raise exception 'Invalid field format: %',k;end if;
 end loop;
 for k,spec in select * from jsonb_each(schema) loop
  enabled:=(left(k,2)<>'g_' or input->>'guarantor'='Yes') and (k<>'debt' or input->>'credit'='Yes') and (k<>'g_debt' or input->>'g_credit'='Yes');
  if enabled is not true then continue;end if;
  value:=trim(coalesce(input->>k,''));
  if complete and (spec->>'required')::boolean and value='' then raise exception 'Complete: %',spec->>'label';end if;
  if length(value)>(spec->>'max')::int then raise exception 'Field is too long: %',spec->>'label';end if;
  if value<>'' then
   if jsonb_typeof(spec->'type')='array' and not (spec->'type') ? value then raise exception 'Choose a valid option: %',spec->>'label';end if;
   if spec->>'type' in ('number','months','year') then
    if value !~ '^[0-9]{1,9}$' then raise exception 'Enter a whole positive number: %',spec->>'label';end if;
    if (k='deposit' and value::numeric>price) or (spec->>'type'='months' and value::int>11) or (spec->>'type'='year' and value::int not between 1940 and 2100) or (k like '%work_years' and value::int>80) then raise exception 'Number outside range: %',spec->>'label';end if;
   end if;
   if complete and spec->>'type'='email' and value !~ '^[^ @]+@[^ @]+[.][^ @]+$' then raise exception 'Enter a valid email.';end if;
   if complete and spec->>'type'='tel' and regexp_replace(value,'[^0-9]','','g') !~ '^[0-9]{8,15}$' then raise exception 'Enter a valid telephone number.';end if;
  end if;
  clean:=clean||jsonb_build_object(k,value);
 end loop;
 return clean;
end;$fn$;
revoke all on function public.e2_validate_intake_details(jsonb,boolean,numeric) from public,anon,authenticated;

create function public.e2_intake_submit(target uuid,nonce uuid,input jsonb,consent boolean,accurate boolean,contacts boolean) returns jsonb language plpgsql security definer set search_path='' as $$declare a public.intake_submissions;clean jsonb;begin
 a:=public.e2_intake_session(target,nonce,true);if a.submitted_at is not null then return jsonb_build_object('reference',a.id,'received',true);end if;
 if consent is distinct from true or accurate is distinct from true or contacts is distinct from true then raise exception 'Confirm your details, privacy notice and contacts permission.';end if;
 clean:=public.e2_validate_intake_details(input,true,(a.vehicle_summary->>'price')::numeric);
 if exists(select 1 from public.intake_files where submission_id=target and state<>'ready') then raise exception 'Finish or remove incomplete uploads before submitting.';end if;
 update public.intake_submissions set details=clean,status='Received by Salesman',submitted_at=now(),privacy_version='2026-09-14-guest',privacy_accepted_at=now(),updated_at=now(),revision=revision+1 where id=target;
 insert into public.intake_events(submission_id,event,note) values(target,'Received by Salesman','Customer-provided details. Identity has not been verified by this website.');return jsonb_build_object('reference',target,'received',true);
end;$$;
create function public.e2_intake_office_choices() returns table(user_id uuid,display_name text) language sql stable security definer set search_path='' as $$select m.user_id,coalesce(nullif(p.display_name,''),u.email) from public.staff_memberships m join auth.users u on u.id=m.user_id left join public.staff_profiles p on p.user_id=m.user_id where public.e2_intake_active_staff() and m.active and m.role in ('admin','super_admin')$$;
create function public.e2_intake_handoff(target uuid,office uuid,message text,expected_revision bigint) returns void language plpgsql security definer set search_path='' as $$declare a public.intake_submissions;begin
 select * into a from public.intake_submissions where id=target for update;
 if not public.e2_intake_access(target) or not (public.e2_is_super_admin() or a.salesperson=auth.uid()) then raise exception 'Only the assigned salesperson or Super Admin can hand over.';end if;
 if a.revision is distinct from expected_revision then raise exception 'Record changed. Reload before saving.';end if;
 if a.status not in ('Received by Salesman','Needs information') then raise exception 'This application has already been handed over.';end if;
 if not exists(select 1 from public.staff_memberships where user_id=office and active and role in ('admin','super_admin')) then raise exception 'Choose an active Office Admin.';end if;
 if message is null or length(trim(message)) not between 1 and 1000 then raise exception 'Add a handover note.';end if;
 update public.intake_submissions set office_admin=office,handed_at=now(),status='Sent to Office',updated_at=now(),revision=revision+1 where id=target;
 insert into public.intake_events(submission_id,actor,event,note) values(target,auth.uid(),'Sent to Office',trim(message));
end;$$;
create function public.e2_intake_progress(target uuid,next_status text,message text,expected_revision bigint) returns void language plpgsql security definer set search_path='' as $$declare a public.intake_submissions;office boolean;begin
 select * into a from public.intake_submissions where id=target for update;if not public.e2_intake_access(target) then raise exception 'Assigned staff access required.';end if;
 if a.revision is distinct from expected_revision then raise exception 'Record changed. Reload before saving.';end if;
 office:=coalesce(public.e2_is_super_admin() or (a.office_admin=auth.uid() and a.handed_at is not null),false);
 if not ((next_status='Needs information' and a.status in ('Received by Salesman','Sent to Office','Submitted to financier') and (office or a.salesperson=auth.uid())) or (next_status='Received by Salesman' and a.status='Needs information' and (public.e2_is_super_admin() or a.salesperson=auth.uid())) or (next_status='Submitted to financier' and a.status='Sent to Office' and office) or (next_status='Outcome recorded' and a.status='Submitted to financier' and office)) then raise exception 'This progress change is not available.';end if;
 if message is null or length(trim(message)) not between 1 and 1000 then raise exception 'Add an actual follow-up note.';end if;
 update public.intake_submissions set status=next_status,updated_at=now(),revision=revision+1 where id=target;insert into public.intake_events(submission_id,actor,event,note) values(target,auth.uid(),next_status,trim(message));
end;$$;


create function public.e2_intake_forget_file(target uuid,nonce uuid,file_id uuid) returns void language plpgsql security definer set search_path='' as $$begin
 perform public.e2_intake_session(target,nonce);delete from public.intake_files f where id=file_id and submission_id=target and not exists(select 1 from storage.objects o where o.bucket_id='intake-documents' and o.name=f.path);end;$$;
create function public.e2_intake_expired_files() returns table(id uuid,path text) language sql stable security definer set search_path='' as $$select f.id,f.path from public.intake_files f join public.intake_submissions a on a.id=f.submission_id where a.submitted_at is null and a.expires_at<now()-interval '24 hours' order by f.created_at limit 30$$;
create function public.e2_intake_purge_expired(file_id uuid) returns void language sql security definer set search_path='' as $$delete from public.intake_files f using public.intake_submissions a where f.id=file_id and f.submission_id=a.id and a.submitted_at is null and a.expires_at<now()-interval '24 hours' and not exists(select 1 from storage.objects o where o.bucket_id='intake-documents' and o.name=f.path)$$;

do $$declare f record;begin for f in select oid::regprocedure sig from pg_proc where pronamespace='public'::regnamespace and (proname like 'e2_intake_%' or proname in ('e2_create_intake_link','e2_revoke_intake_link','e2_validate_intake_details')) loop execute format('revoke all on function %s from public,anon,authenticated',f.sig);execute format('grant execute on function %s to service_role',f.sig);end loop;end$$;
grant execute on function public.e2_intake_active_staff(),public.e2_intake_access(uuid),public.e2_intake_file_read(text),public.e2_create_intake_link(uuid),public.e2_revoke_intake_link(uuid),public.e2_intake_office_choices(),public.e2_intake_handoff(uuid,uuid,text,bigint),public.e2_intake_progress(uuid,text,text,bigint) to authenticated;
commit;
