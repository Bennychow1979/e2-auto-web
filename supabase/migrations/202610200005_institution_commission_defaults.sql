-- Owner-confirmed commission-based personal applicant default; separate from salary/company.
begin;
alter table public.e2_finance_institution_drafts
 add column commission_documents text[] not null default array['ic_front','ic_back','driving_licence','payslips','personal_bank']::text[],
 add column commission_payslip_months integer default 6 check(commission_payslip_months between 1 and 60),
 add column commission_bank_months integer default 6 check(commission_bank_months between 1 and 60),
 add constraint institution_commission_document_keys check(commission_documents <@ array['ic_front','ic_back','driving_licence','payslips','personal_bank','epf','employment','tax','ssm','company_bank','financials','vehicle']::text[] and array_position(commission_documents,null) is null);
update public.e2_finance_institution_drafts set checklist_confirmed=false,revision=revision+1,updated_at=now();
create or replace function public.e2_save_institution_draft(institution_name text,expected_revision bigint,payload jsonb)
returns public.e2_finance_institution_drafts language plpgsql security definer set search_path='' as $$
declare saved public.e2_finance_institution_drafts; docs text[]; company_docs text[]; commission_docs text[];begin
 if not public.e2_is_super_admin() then raise exception 'Active Super Admin access required.';end if;
 if payload is null or jsonb_typeof(payload)<>'object' then raise exception 'Invalid draft configuration.';end if;
 if exists(select 1 from jsonb_object_keys(payload) k where k not in ('portal_url','email_to','required_documents','company_documents','commission_documents','commission_payslip_months','commission_bank_months','salary_payslip_months','salary_bank_months','company_bank_months','document_notes','other_documents','checklist_confirmed','blacklist_policy','guarantor_policy','max_loan_years','max_vehicle_age_at_end'))
 or not (payload ?& array['portal_url','email_to','required_documents','company_documents','commission_documents','commission_payslip_months','commission_bank_months','salary_payslip_months','salary_bank_months','company_bank_months','document_notes','other_documents','checklist_confirmed','blacklist_policy','guarantor_policy','max_loan_years','max_vehicle_age_at_end'])
 then raise exception 'Invalid draft fields. Activation is not supported.';end if;
 if jsonb_typeof(payload->'commission_documents') is distinct from 'array' or jsonb_typeof(payload->'company_documents') is distinct from 'array' or jsonb_typeof(payload->'required_documents') is distinct from 'array' or jsonb_typeof(payload->'document_notes') is distinct from 'string'
 or jsonb_typeof(payload->'other_documents') is distinct from 'string' or jsonb_typeof(payload->'checklist_confirmed') is distinct from 'boolean'
 or jsonb_typeof(payload->'portal_url') not in ('string','null') or jsonb_typeof(payload->'email_to') not in ('string','null') then raise exception 'Invalid draft value types.';end if;
 if exists(select 1 from jsonb_array_elements(payload->'commission_documents') value where jsonb_typeof(value)<>'string') or exists(select 1 from jsonb_array_elements(payload->'required_documents') value where jsonb_typeof(value)<>'string') or exists(select 1 from jsonb_array_elements(payload->'company_documents') value where jsonb_typeof(value)<>'string') then raise exception 'Invalid document selection.';end if;
 if jsonb_typeof(payload->'commission_payslip_months') not in ('number','null') or jsonb_typeof(payload->'commission_bank_months') not in ('number','null') or jsonb_typeof(payload->'salary_payslip_months') not in ('number','null') or jsonb_typeof(payload->'salary_bank_months') not in ('number','null') or jsonb_typeof(payload->'company_bank_months') not in ('number','null') or jsonb_typeof(payload->'guarantor_policy') is distinct from 'string' or jsonb_typeof(payload->'blacklist_policy') is distinct from 'string' or jsonb_typeof(payload->'max_loan_years') not in ('number','null') or jsonb_typeof(payload->'max_vehicle_age_at_end') not in ('number','null') then raise exception 'Invalid institution rules.';end if;
 select coalesce(array_agg(distinct value order by value),'{}'::text[]) into docs from jsonb_array_elements_text(payload->'required_documents');
 select coalesce(array_agg(distinct value order by value),'{}'::text[]) into company_docs from jsonb_array_elements_text(payload->'company_documents');
 select coalesce(array_agg(distinct value order by value),'{}'::text[]) into commission_docs from jsonb_array_elements_text(payload->'commission_documents');
 select * into saved from public.e2_finance_institution_drafts where name=institution_name for update;
 if not found or expected_revision is null or saved.revision is distinct from expected_revision then raise exception 'Draft changed. Reload and review before saving.';end if;
 update public.e2_finance_institution_drafts set portal_url=nullif(btrim(payload->>'portal_url'),''),email_to=nullif(btrim(payload->>'email_to'),''),
 required_documents=docs,company_documents=company_docs,commission_documents=commission_docs,commission_payslip_months=(payload->>'commission_payslip_months')::integer,commission_bank_months=(payload->>'commission_bank_months')::integer,salary_payslip_months=(payload->>'salary_payslip_months')::integer,salary_bank_months=(payload->>'salary_bank_months')::integer,company_bank_months=(payload->>'company_bank_months')::integer,document_notes=btrim(payload->>'document_notes'),other_documents=btrim(payload->>'other_documents'),
 guarantor_policy=payload->>'guarantor_policy',blacklist_policy=payload->>'blacklist_policy',max_loan_years=(payload->>'max_loan_years')::integer,max_vehicle_age_at_end=(payload->>'max_vehicle_age_at_end')::integer,checklist_confirmed=(payload->>'checklist_confirmed')::boolean,revision=revision+1,updated_at=now()
 where name=institution_name returning * into saved;
 return saved;
end;$$;
commit;
