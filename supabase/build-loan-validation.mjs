import fs from 'node:fs';
import {sections} from '../loan-fields.js';
const schema=Object.fromEntries(sections({guarantor:'Yes'}).flat().map(([key,label,sub,type,required])=>[key,{label,type,required:!!required,max:type==='textarea'?300:150}]));
const sql=`begin;
create function public.e2_validate_loan_details(input jsonb,complete boolean,price numeric) returns jsonb language plpgsql immutable set search_path='' as $fn$
declare schema constant jsonb:=$schema$${JSON.stringify(schema)}$schema$::jsonb; clean jsonb:='{}'; k text; value text; spec jsonb; enabled boolean;
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
revoke all on function public.e2_validate_loan_details(jsonb,boolean,numeric) from public,anon,authenticated;
commit;
`;
fs.writeFileSync('supabase/migrations/202609140008_loan_validation.sql',sql);
