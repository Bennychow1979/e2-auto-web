begin;

-- Shared by rental_save and rental_move_plate, while their existing row locks
-- are held. No new public RPC or grants; legacy rows without the workflow flag
-- keep their existing loan-data rules until they opt into the new form.
create function public.rental_validate_booking(prior jsonb, proposed jsonb)
returns void language plpgsql security invoker set search_path='' as $$
declare
 pending boolean; tracked boolean; booking jsonb; prior_booking jsonb;
 hist jsonb; prior_hist jsonb; entry jsonb; archived jsonb; last_live jsonb;
 hands jsonb; pays jsonb; i integer; amount numeric;
begin
 prior=coalesce(prior,'{}'::jsonb);
 if proposed ? 'pending_disbursement' and jsonb_typeof(proposed->'pending_disbursement')<>'boolean' then
  raise exception 'Invalid pending disbursement flag';
 end if;
 if prior ? 'pending_disbursement' and not proposed ? 'pending_disbursement' then
  raise exception 'Keep the disbursement state when saving';
 end if;
 pending=coalesce(proposed->>'pending_disbursement','false')='true';
 tracked=prior ? 'pending_disbursement' or proposed ? 'pending_disbursement';
 pays=coalesce(proposed->'payments','[]'::jsonb);
 hands=coalesce(nullif(proposed->'handovers','null'::jsonb),'[]'::jsonb);
 if jsonb_typeof(pays)<>'array' or jsonb_typeof(hands)<>'array' then raise exception 'Invalid payment or handover list'; end if;
 if pending then
  if jsonb_array_length(pays)>0 or exists(select 1 from jsonb_array_elements(hands) h where coalesce(nullif(h->>'type',''),case when upper(coalesce(h->>'to','')||' '||coalesce(h->>'note',''))~'REPO|RETURN|BTC|STOCK|SHOWROOM|BACK' then 'IN' else 'OUT' end)='OUT' and coalesce(h->>'void','false')<>'true') then
   raise exception 'Loan not disbursed: cannot record payments or rent out';
  end if;
 elsif tracked then
  if coalesce(proposed->>'account_no','')!~'^[0-9]+$' or nullif(proposed->>'first_payment_date','') is null then
   raise exception 'Complete account number and first payment date before disbursement';
  end if;
  perform public.rental_date(proposed->>'first_payment_date');
 end if;

 booking=nullif(proposed->'booking','null'::jsonb);
 prior_booking=nullif(prior->'booking','null'::jsonb);
 hist=coalesce(proposed->'booking_history','[]'::jsonb);
 prior_hist=coalesce(prior->'booking_history','[]'::jsonb);
 if jsonb_typeof(hist)<>'array' or jsonb_typeof(prior_hist)<>'array' then raise exception 'Invalid booking history'; end if;
 -- Existing cancellation/conversion evidence is append-only.
 if jsonb_array_length(hist)<jsonb_array_length(prior_hist) then raise exception 'Keep booking history'; end if;
 for i in 0..jsonb_array_length(prior_hist)-1 loop
  if hist->i is distinct from prior_hist->i then raise exception 'Keep booking history'; end if;
 end loop;
 select h.value into last_live from jsonb_array_elements(hands) with ordinality h(value,ord)
  where coalesce(h.value->>'void','false')<>'true' order by h.ord desc limit 1;
 if booking is not null then
  if jsonb_typeof(booking)<>'object' or jsonb_typeof(booking->'deposit') is distinct from 'number'
     or nullif(btrim(booking->>'to'),'') is null or nullif(btrim(booking->>'phone'),'') is null
     or nullif(booking->>'date','') is null then raise exception 'Booking needs a renter, phone, date and positive deposit'; end if;
  if (booking->>'deposit')::numeric<=0 then raise exception 'Booking deposit must be positive'; end if;
  perform public.rental_date(booking->>'date');
  if last_live->>'type'='OUT' then raise exception 'Convert or cancel the booking before rent-out'; end if;
  if prior_booking is null and (not pending or proposed->>'car_status' in ('RETURNED','OWNER TAKE BACK','REDEEM','AUCTIONED','LOST')) then
   raise exception 'New bookings require an active pending vehicle';
  end if;
 end if;
 if prior_booking is not null and prior_booking is distinct from booking then
  select h.value into archived from jsonb_array_elements(hist) with ordinality h(value,ord)
   where h.ord>jsonb_array_length(prior_hist) and h.value @> prior_booking
     and h.value->>'status' in ('CANCELLED','CONVERTED') order by h.ord desc limit 1;
  if archived is null then raise exception 'Archive the original booking before clearing or replacing it'; end if;
  if archived->>'status'='CONVERTED' then
   if pending or last_live->>'type' is distinct from 'OUT'
      or last_live->'deposit' is distinct from prior_booking->'deposit'
      or jsonb_typeof(proposed->'actual_rent') is distinct from 'number'
      or proposed->'actual_rent' is distinct from last_live->'rent'
      or hands is not distinct from coalesce(prior->'handovers','[]'::jsonb) then
    raise exception 'Booking conversion needs a rent-out and matching total upfront';
   end if;
  end if;
 end if;
 -- Deposit remains part of the total even when the handover is edited later.
 for entry in select value from jsonb_array_elements(hands) loop
  if nullif(entry->'deposit','null'::jsonb) is not null then
   if jsonb_typeof(entry->'deposit')<>'number' or jsonb_typeof(entry->'rent') is distinct from 'number' then
    raise exception 'Total upfront must include the booking deposit';
   end if;
   amount=(entry->>'deposit')::numeric;
   if amount<=0 or (entry->>'rent')::numeric<amount then raise exception 'Total upfront must include the booking deposit'; end if;
  end if;
 end loop;
end $$;
revoke all on function public.rental_validate_booking(jsonb,jsonb) from public,anon,authenticated;

-- Preserve both RPC signatures, authorization, locking, revisions and audit.
create or replace function public.rental_move_plate(p_old_id text,p_new_id text,p_new_plate text,p_revision bigint,p_patch jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare prior jsonb; rev bigint; who jsonb; entry jsonb; next_data jsonb; old_plate text; new_row jsonb; old_row jsonb; first_id text; second_id text;
begin
 if not public.rental_ok() then raise exception 'Rental permission required' using errcode='42501'; end if;
 if p_revision is null or p_revision<0 or p_patch is null or jsonb_typeof(p_patch)<>'object' then raise exception 'Invalid rental update'; end if;
 if p_old_id is null or p_new_id is null or p_new_id!~'^[A-Z0-9][A-Z0-9-]{0,39}$' then raise exception 'Invalid vehicle id'; end if;
 if p_old_id=p_new_id then raise exception 'New plate is the same as the current plate'; end if;
 if nullif(btrim(p_new_plate),'') is null or upper(regexp_replace(p_new_plate,'[^A-Za-z0-9]','','g'))<>replace(p_new_id,'-','') then raise exception 'Plate and vehicle id do not match'; end if;
 if p_patch ? 'plate' or p_patch ? 'payments' or p_patch ? 'handovers' or p_patch ? 'history' or p_patch ? 'car_status' or p_patch ? 'moved_to' then raise exception 'Patch may not change plate, payments, handovers, history or status'; end if;
 -- All contract-writing RPCs take this lock first. It serializes the small rental
 -- ledger's writes so aliases of a plate cannot race through separate id locks.
 perform pg_advisory_xact_lock(hashtextextended('rental:contracts:plate-identity',0));
 -- lock both ids in a fixed order so two concurrent moves cannot deadlock
 first_id=least(p_old_id,p_new_id); second_id=greatest(p_old_id,p_new_id);
 perform pg_advisory_xact_lock(hashtextextended('rental:contracts:'||first_id,0));
 perform pg_advisory_xact_lock(hashtextextended('rental:contracts:'||second_id,0));
 select data,revision into prior,rev from public.rental_contracts where id=p_old_id for update;
 if prior is null then raise exception 'Record not found'; end if;
 if rev<>p_revision then raise exception 'Record changed. Refresh and try again; your change was not saved.' using errcode='40001'; end if;
 if prior->>'car_status'='MOVED' then raise exception 'This record was already moved to %',coalesce(prior->>'moved_to','another plate'); end if;
 if exists(select 1 from public.rental_contracts where id=p_new_id or
   (id<>p_old_id and coalesce(data->>'car_status','')<>'MOVED' and
    upper(regexp_replace(data->>'plate','[^A-Za-z0-9]','','g'))=replace(p_new_id,'-','')))
 then raise exception 'New plate already exists' using errcode='23505'; end if;
 who=public.rental_identity(); old_plate=prior->>'plate';
 entry=jsonb_build_object('at',to_char(clock_timestamp() at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),'by',who->>'display_name','by_id',who->>'user_id');
 next_data=(prior||p_patch)-'_rental_revision'
   ||jsonb_build_object('plate',upper(btrim(p_new_plate)),'plate_changed_from',old_plate,'plate_changed_at',entry->>'at','updated_at',entry->>'at',
     'history',(coalesce(case when jsonb_typeof(prior->'history')='array' then prior->'history' end,'[]'::jsonb))||jsonb_build_array(entry||jsonb_build_object('action','车牌由 '||old_plate||' 改为 '||upper(btrim(p_new_plate)))));
 if next_data->>'pay_reference'=old_plate then next_data=next_data||jsonb_build_object('pay_reference',upper(btrim(p_new_plate))); end if;
 perform public.rental_validate_booking(prior,next_data);
 insert into public.rental_contracts(id,data) values(p_new_id,next_data)
  returning jsonb_build_object('id',id,'data',data,'revision',revision) into new_row;
 update public.rental_contracts set data=data||jsonb_build_object('car_status','MOVED','moved_to',p_new_id,'moved_at',entry->>'at',
   'history',(coalesce(case when jsonb_typeof(data->'history')='array' then data->'history' end,'[]'::jsonb))||jsonb_build_array(entry||jsonb_build_object('action','车牌改为 '||upper(btrim(p_new_plate))||'，记录已搬到 '||p_new_id)))
  where id=p_old_id returning jsonb_build_object('id',id,'data',data,'revision',revision) into old_row;
 return jsonb_build_object('moved_from',old_row,'record',new_row);
end $$;
revoke all on function public.rental_move_plate(text,text,text,bigint,jsonb) from public,anon;
grant execute on function public.rental_move_plate(text,text,text,bigint,jsonb) to authenticated;

-- Preserve the existing signature, authorization, revision and audit behavior.
create or replace function public.rental_save(p_table text,p_id text,p_data jsonb,p_revision bigint,p_merge boolean default false)
returns jsonb language plpgsql security definer set search_path='' as $$
declare prior jsonb; rev bigint; result jsonb; next_data jsonb;
begin
 if not public.rental_ok() then raise exception 'Rental permission required' using errcode='42501'; end if;
 if p_revision is null or p_revision<0 or p_merge is null or p_data is null or jsonb_typeof(p_data)<>'object' then raise exception 'Invalid rental update'; end if;
 if p_table not in ('contracts','settings') or p_table is null then raise exception 'Unknown rental table'; end if;
 -- Same first lock as rental_move_plate: even alternate plate spellings serialize.
 if p_table='contracts' then
  perform pg_advisory_xact_lock(hashtextextended('rental:contracts:plate-identity',0));
 end if;
 perform pg_advisory_xact_lock(hashtextextended('rental:'||p_table||':'||p_id,0));
 if p_table='contracts' then select data,revision into prior,rev from public.rental_contracts where id=p_id for update;
 else select data,revision into prior,rev from public.rental_settings where id=p_id for update; end if;
 if coalesce(rev,0)<>p_revision or (p_merge and rev is null) then raise exception 'Record changed. Refresh and try again; your change was not saved.' using errcode='40001'; end if;
 next_data=case when p_merge then prior||p_data else p_data end - '_rental_revision';
 if p_table='contracts' then
  if prior->>'car_status'='MOVED' then raise exception 'This record was already moved to %',coalesce(prior->>'moved_to','another plate'); end if;
  if next_data->>'car_status'='MOVED' or next_data ? 'moved_to' then raise exception 'Use rental_move_plate to move a record'; end if;
  if nullif(upper(regexp_replace(next_data->>'plate','[^A-Za-z0-9]','','g')),'') is null then raise exception 'Vehicle plate required'; end if;
  if prior is not null and prior->>'plate' is distinct from next_data->>'plate' then raise exception 'Vehicle plate cannot change'; end if;
  if jsonb_typeof(coalesce(next_data->'payments','[]'))<>'array' or jsonb_typeof(coalesce(nullif(next_data->'handovers','null'),'[]'))<>'array' then raise exception 'Invalid payment or handover list'; end if;
  if exists(select 1 from public.rental_contracts where id<>p_id and coalesce(data->>'car_status','')<>'MOVED'
    and upper(regexp_replace(data->>'plate','[^A-Za-z0-9]','','g'))=upper(regexp_replace(next_data->>'plate','[^A-Za-z0-9]','','g')))
  then raise exception 'Vehicle plate already exists' using errcode='23505'; end if;
  perform public.rental_validate_booking(prior,next_data);
  insert into public.rental_contracts(id,data) values(p_id,next_data) on conflict(id) do update set data=excluded.data
  returning jsonb_build_object('id',id,'data',data,'revision',revision) into result;
 else
  insert into public.rental_settings(id,data) values(p_id,next_data) on conflict(id) do update set data=excluded.data
  returning jsonb_build_object('id',id,'data',data,'revision',revision) into result;
 end if;
 return result;
end $$;
revoke all on function public.rental_save(text,text,jsonb,bigint,boolean) from public,anon;
grant execute on function public.rental_save(text,text,jsonb,bigint,boolean) to authenticated;

commit;
