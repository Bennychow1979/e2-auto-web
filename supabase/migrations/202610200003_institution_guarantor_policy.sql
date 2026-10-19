-- Separate conditional guarantor requirements from the normal document checklist.
begin;
alter table public.e2_finance_institution_drafts add column guarantor_policy text not null default 'pending'
 check(guarantor_policy in ('pending','case_by_case','required','not_required'));
-- Preserve any explicit legacy guarantor requirement; leave all other rows pending.
update public.e2_finance_institution_drafts set guarantor_policy=case when 'guarantor'=any(required_documents) then 'required' else 'pending' end,
 required_documents=array_remove(required_documents,'guarantor'),revision=revision+1,updated_at=now();
alter table public.e2_finance_institution_drafts add constraint institution_guarantor_separate check(not ('guarantor'=any(required_documents)));
create or replace function public.e2_save_institution_draft(institution_name text,expected_revision bigint,payload jsonb)
returns public.e2_finance_institution_drafts language plpgsql security definer set search_path='' as $$
declare saved public.e2_finance_institution_drafts; docs text[];begin
 if not public.e2_is_super_admin() then raise exception 'Active Super Admin access required.';end if;
 if payload is null or jsonb_typeof(payload)<>'object' then raise exception 'Invalid draft configuration.';end if;
 if exists(select 1 from jsonb_object_keys(payload) k where k not in ('portal_url','email_to','required_documents','document_notes','other_documents','checklist_confirmed','blacklist_policy','guarantor_policy','max_loan_years','max_vehicle_age_at_end'))
 or not (payload ?& array['portal_url','email_to','required_documents','document_notes','other_documents','checklist_confirmed','blacklist_policy','guarantor_policy','max_loan_years','max_vehicle_age_at_end'])
 then raise exception 'Invalid draft fields. Activation is not supported.';end if;
 if jsonb_typeof(payload->'required_documents') is distinct from 'array' or jsonb_typeof(payload->'document_notes') is distinct from 'string'
 or jsonb_typeof(payload->'other_documents') is distinct from 'string' or jsonb_typeof(payload->'checklist_confirmed') is distinct from 'boolean'
 or jsonb_typeof(payload->'portal_url') not in ('string','null') or jsonb_typeof(payload->'email_to') not in ('string','null') then raise exception 'Invalid draft value types.';end if;
 if exists(select 1 from jsonb_array_elements(payload->'required_documents') value where jsonb_typeof(value)<>'string') then raise exception 'Invalid document selection.';end if;
 if jsonb_typeof(payload->'guarantor_policy') is distinct from 'string' or jsonb_typeof(payload->'blacklist_policy') is distinct from 'string' or jsonb_typeof(payload->'max_loan_years') not in ('number','null') or jsonb_typeof(payload->'max_vehicle_age_at_end') not in ('number','null') then raise exception 'Invalid institution rules.';end if;
 select coalesce(array_agg(distinct value order by value),'{}'::text[]) into docs from jsonb_array_elements_text(payload->'required_documents');
 select * into saved from public.e2_finance_institution_drafts where name=institution_name for update;
 if not found or expected_revision is null or saved.revision is distinct from expected_revision then raise exception 'Draft changed. Reload and review before saving.';end if;
 update public.e2_finance_institution_drafts set portal_url=nullif(btrim(payload->>'portal_url'),''),email_to=nullif(btrim(payload->>'email_to'),''),
 required_documents=docs,document_notes=btrim(payload->>'document_notes'),other_documents=btrim(payload->>'other_documents'),
 guarantor_policy=payload->>'guarantor_policy',blacklist_policy=payload->>'blacklist_policy',max_loan_years=(payload->>'max_loan_years')::integer,max_vehicle_age_at_end=(payload->>'max_vehicle_age_at_end')::integer,checklist_confirmed=(payload->>'checklist_confirmed')::boolean,revision=revision+1,updated_at=now()
 where name=institution_name returning * into saved;
 return saved;
end;$$;
commit;
