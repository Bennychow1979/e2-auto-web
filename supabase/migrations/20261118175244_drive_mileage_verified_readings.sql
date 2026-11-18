begin;
-- Two independent bounded reads per attempt, 6 sen reserved before either call.
alter table public.drive_mileage_receipts drop constraint drive_mileage_receipts_reserved_sen_check;
alter table public.drive_mileage_receipts add constraint drive_mileage_receipts_reserved_sen_check check(reserved_sen in (3,6));
alter table public.drive_mileage_receipts alter column reserved_sen set default 6;
alter table public.drive_mileage_receipts add column verification jsonb;
create or replace function public.e2_claim_drive_mileage(actor_id uuid,target uuid,expected_version timestamptz,plate_key text,folder text,file_id text,checksum text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v public.vehicles%rowtype; receipt uuid; month_key date:=date_trunc('month',now() at time zone 'Asia/Kuala_Lumpur')::date; spent integer;
begin
 if not exists(select 1 from public.staff_memberships s where s.user_id=actor_id and s.active and s.role in ('admin','super_admin')) then raise exception 'Admin access required';end if;
 if checksum is null or checksum !~ '^[a-f0-9]{32}$' or folder is null or folder !~ '^[A-Za-z0-9_-]{10,200}$' or file_id is null or file_id !~ '^[A-Za-z0-9_-]{10,200}$' then raise exception 'Invalid photo source';end if;
 select * into v from public.vehicles where id=target for update;
 if not found or v.publication<>'draft' or v.lifecycle_state<>'active' or v.mileage_confirmed or v.updated_at is distinct from expected_version or regexp_replace(upper(v.plate),'[^A-Z0-9]','','g') is distinct from plate_key then return jsonb_build_object('status','changed');end if;
 if exists(select 1 from public.drive_mileage_receipts r where r.vehicle_id=target and r.checksum=e2_claim_drive_mileage.checksum) then return jsonb_build_object('status','unchanged');end if;
 insert into public.drive_mileage_budget(month) values(month_key) on conflict do nothing;
 select reserved_sen into spent from public.drive_mileage_budget where month=month_key for update;
 if spent+6>500 then return jsonb_build_object('status','budget');end if;
 update public.drive_mileage_budget set reserved_sen=reserved_sen+6 where month=month_key;
 insert into public.drive_mileage_receipts(vehicle_id,actor_id,plate,folder_id,file_id,checksum,budget_month,expected_version,previous_mileage,reserved_sen)
 values(target,actor_id,v.plate,folder,file_id,checksum,month_key,expected_version,v.mileage,6) returning id into receipt;
 return jsonb_build_object('status','claimed','id',receipt);
end;$$;
revoke all on function public.e2_claim_drive_mileage(uuid,uuid,timestamptz,text,text,text,text) from public,anon,authenticated;
grant execute on function public.e2_claim_drive_mileage(uuid,uuid,timestamptz,text,text,text,text) to service_role;

create function public.e2_finish_drive_mileage_verified(claim_id uuid,actor_id uuid,reading integer,issue text,verification jsonb,input_tokens integer default 0,output_tokens integer default 0)
returns jsonb language plpgsql security definer set search_path='' as $$
declare r public.drive_mileage_receipts%rowtype; v public.vehicles%rowtype; problem text:=left(issue,300); outcome text:='review'; applied_stamp timestamptz; checked boolean:=false; evidence jsonb;
begin
 -- Lock vehicles before receipts, matching the claim order.
 select * into r from public.drive_mileage_receipts where id=claim_id;
 if not found or r.actor_id is distinct from actor_id then raise exception 'Unknown mileage claim';end if;
 select * into v from public.vehicles where id=r.vehicle_id for update;
 select * into r from public.drive_mileage_receipts where id=claim_id for update;
 if r.status<>'claimed' then return jsonb_build_object('status',r.status,'issue',r.issue);end if;
 if jsonb_typeof(verification)='array' and jsonb_array_length(verification)=2 and octet_length(verification::text)<2000 then
  checked:=true;
  for evidence in select value from jsonb_array_elements(verification) loop
   if not coalesce(evidence->'clear'='true'::jsonb and evidence->>'unit'='km' and evidence->>'display'='odometer'
      and evidence->'reading'=to_jsonb(reading) and evidence->>'digits' ~ '^[0-9]{1,6}$'
      and coalesce(nullif(ltrim(evidence->>'digits','0'),''),'0')=reading::text
      and evidence->'digit_count'=to_jsonb(length(evidence->>'digits')),false) then checked:=false;end if;
  end loop;
  checked:=checked and verification->0->>'digits'=verification->1->>'digits';
 end if;
 if not exists(select 1 from public.staff_memberships s where s.user_id=actor_id and s.active and s.role in ('admin','super_admin')) then problem:='Administrator no longer active';
 elsif v.publication<>'draft' or v.lifecycle_state<>'active' or v.mileage_confirmed or v.updated_at is distinct from r.expected_version or v.plate is distinct from r.plate then problem:='Vehicle changed or mileage already confirmed; review manually';
 elsif reading is null or reading not between 0 and 999999 then problem:=coalesce(problem,'Odometer reading unclear; review M photo');
 elsif not checked then problem:='Two clear independent odometer readings required; review M photo manually';
 elsif v.mileage is not null and reading<v.mileage then problem:='Reading lower than existing mileage; review manually';
 elsif v.mileage is not null and reading<>v.mileage and not exists(select 1 from public.drive_mileage_receipts previous where previous.vehicle_id=v.id and previous.status='applied' and previous.reading=v.mileage and previous.applied_version=v.updated_at) then problem:='Existing manually entered mileage differs; review manually';
 end if;
 if problem is null then
  perform set_config('request.jwt.claim.sub',actor_id::text,true);
  update public.vehicles set mileage=reading,mileage_confirmed=true where id=v.id returning updated_at into applied_stamp;
  insert into public.inventory_audit(actor,entity,action,row_id) values(actor_id,'vehicles','IMPORT_MILEAGE_DRAFT_VERIFIED',v.id);
  outcome:='applied';
 end if;
 update public.drive_mileage_receipts set status=outcome,reading=case when e2_finish_drive_mileage_verified.reading between 0 and 999999 then e2_finish_drive_mileage_verified.reading else null end,
  verification=case when checked then e2_finish_drive_mileage_verified.verification else null end,issue=problem,finished_at=now(),applied_version=applied_stamp,input_tokens=greatest(0,least(coalesce(e2_finish_drive_mileage_verified.input_tokens,0),100000)),output_tokens=greatest(0,least(coalesce(e2_finish_drive_mileage_verified.output_tokens,0),10000)) where id=claim_id;
 return jsonb_build_object('status',outcome,'issue',problem);
end;$$;
revoke all on function public.e2_finish_drive_mileage_verified(uuid,uuid,integer,text,jsonb,integer,integer) from public,anon,authenticated;
grant execute on function public.e2_finish_drive_mileage_verified(uuid,uuid,integer,text,jsonb,integer,integer) to service_role;

commit;
