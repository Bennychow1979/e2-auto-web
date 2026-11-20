-- Atomic plate correction. The plate is the record id, so a correction moves the
-- record: one new row under the new id, the old row kept as car_status MOVED.
-- Both writes happen in this single function call (one transaction); any failure
-- rolls back both, so there can never be two live records for one car.
-- rental_save is replaced below to freeze MOVED records and share plate checks.
-- No table/schema layout changes or existing-record rewrites.
begin;

create function public.rental_move_plate(p_old_id text,p_new_id text,p_new_plate text,p_revision bigint,p_patch jsonb default '{}'::jsonb)
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
