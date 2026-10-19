-- Owner-requested institution preparation only. Does not install or enable financing cases.
-- Only existing Active Super Admins can read/edit these non-customer configuration drafts.
begin;
create table public.e2_finance_institution_drafts (
 name text primary key check(length(btrim(name)) between 1 and 120),
 portal_url text check(portal_url is null or (length(portal_url)<=1000 and portal_url ~ '^https://[^[:space:]@#]+$')),
 email_to text check(email_to is null or (length(email_to)<=254 and email_to ~ '^[^[:space:]@,;<>]+@[^[:space:]@,;<>]+\.[^[:space:]@,;<>]+$')),
 required_documents text[] not null default '{}',
 document_notes text not null default '' check(length(document_notes)<=3000),
 other_documents text not null default '' check(length(other_documents)<=3000),
 checklist_confirmed boolean not null default false,
 active boolean not null default false check(active=false),
 revision bigint not null default 1,
 updated_at timestamptz not null default now(),
 check(required_documents <@ array['ic_front','ic_back','driving_licence','payslips','personal_bank','epf','employment','tax','ssm','company_bank','financials','guarantor','vehicle']::text[]),
 check(array_position(required_documents,null) is null)
);
alter table public.e2_finance_institution_drafts enable row level security;
revoke all on public.e2_finance_institution_drafts from public,anon,authenticated,service_role;
grant select on public.e2_finance_institution_drafts to authenticated;
create policy institution_drafts_super_admin_read on public.e2_finance_institution_drafts for select to authenticated using(public.e2_is_super_admin());

create function public.e2_save_institution_draft(institution_name text,expected_revision bigint,payload jsonb)
returns public.e2_finance_institution_drafts language plpgsql security definer set search_path='' as $$
declare saved public.e2_finance_institution_drafts; docs text[];begin
 if not public.e2_is_super_admin() then raise exception 'Active Super Admin access required.';end if;
 if payload is null or jsonb_typeof(payload)<>'object' then raise exception 'Invalid draft configuration.';end if;
 if exists(select 1 from jsonb_object_keys(payload) k where k not in ('portal_url','email_to','required_documents','document_notes','other_documents','checklist_confirmed'))
 or not (payload ?& array['portal_url','email_to','required_documents','document_notes','other_documents','checklist_confirmed'])
 then raise exception 'Invalid draft fields. Activation is not supported.';end if;
 if jsonb_typeof(payload->'required_documents') is distinct from 'array' or jsonb_typeof(payload->'document_notes') is distinct from 'string'
 or jsonb_typeof(payload->'other_documents') is distinct from 'string' or jsonb_typeof(payload->'checklist_confirmed') is distinct from 'boolean'
 or jsonb_typeof(payload->'portal_url') not in ('string','null') or jsonb_typeof(payload->'email_to') not in ('string','null') then raise exception 'Invalid draft value types.';end if;
 if exists(select 1 from jsonb_array_elements(payload->'required_documents') value where jsonb_typeof(value)<>'string') then raise exception 'Invalid document selection.';end if;
 select coalesce(array_agg(distinct value order by value),'{}'::text[]) into docs from jsonb_array_elements_text(payload->'required_documents');
 select * into saved from public.e2_finance_institution_drafts where name=institution_name for update;
 if not found or expected_revision is null or saved.revision is distinct from expected_revision then raise exception 'Draft changed. Reload and review before saving.';end if;
 update public.e2_finance_institution_drafts set portal_url=nullif(btrim(payload->>'portal_url'),''),email_to=nullif(btrim(payload->>'email_to'),''),
 required_documents=docs,document_notes=btrim(payload->>'document_notes'),other_documents=btrim(payload->>'other_documents'),
 checklist_confirmed=(payload->>'checklist_confirmed')::boolean,revision=revision+1,updated_at=now()
 where name=institution_name returning * into saved;
 return saved;
end;$$;
revoke all on function public.e2_save_institution_draft(text,bigint,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.e2_save_institution_draft(text,bigint,jsonb) to authenticated;

insert into public.e2_finance_institution_drafts(name) values
 ('AEON Credit'),('Chailease Credit'),('GFS Credit'),('X Star Credit'),('Carsome Credit'),('FS Credit'),('Elk Credit'),
 ('Maybank'),('Public Bank'),('AmBank'),('CIMB Bank'),('HLB Bank'),('Bank Muamalat');
commit;
