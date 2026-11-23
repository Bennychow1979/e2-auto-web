begin;

-- Preserve the view signature, grants and RLS behavior; no ledger rows change.
-- A voided payment stays on record but no longer counts as a paid instalment.
create or replace view public.rental_contracts_flat with (security_invoker=true) as
select id,plate,owner_name,owner_phone,agent,financier,account_no,loan_amount,monthly,tenure,first_payment_date,car_status,gps,spare_key,target_price,adv_installment,adv_status,check_note,
 coalesce((data->>'paid_count_excel')::int,0) +
   (select count(*)::int from jsonb_array_elements(coalesce(data->'payments','[]'::jsonb)) p
     where p->'void' is distinct from 'true'::jsonb) as paid_count,
 updated_at,updated_by,revision from public.rental_contracts;

commit;
