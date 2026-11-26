begin;
-- Deliberately stays closed until the independently managed sender is healthy.
alter table e2_otp_private.settings add column public_enabled boolean not null default false;
alter table e2_otp_private.settings add column suspended_until timestamptz;

create or replace function public.e2_aira_send_sms(event jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare cfg e2_otp_private.settings; p text; code text; fp text;
begin
 select * into cfg from e2_otp_private.settings where id=true for update;
 p:=ltrim(event#>>'{user,phone}','+'); code:=event#>>'{sms,otp}';
 if not cfg.enabled or (not cfg.public_enabled and cfg.pilot_until<=now())
    or cfg.worker_until<=now() or cfg.heartbeat is null or cfg.heartbeat<now()-interval '20 seconds'
    or cfg.suspended_until>now() then
  return '{"error":{"http_code":503,"message":"WhatsApp verification is unavailable. Please use email."}}'::jsonb;
 end if;
 if p is null or p !~ '^601[0-9]{8,9}$'
    or (not cfg.public_enabled and not exists(select 1 from e2_otp_private.allowed_phones where phone=p))
    or coalesce(event#>>'{user,phone_change}','')<>'' then
  return '{"error":{"http_code":403,"message":"This phone verification request is not supported."}}'::jsonb;
 end if;
 if code is null or code !~ '^[0-9]{6}$' then
  return '{"error":{"http_code":400,"message":"Invalid verification request."}}'::jsonb;
 end if;
 fp:=encode(extensions.hmac(p||':'||code,cfg.encryption_key,'sha256'),'hex');
 if exists(select 1 from e2_otp_private.jobs where phone=p and fingerprint=fp and expires_at>now() and state in ('queued','claimed','sent')) then return '{}'::jsonb; end if;
 if exists(select 1 from e2_otp_private.jobs where phone=p and created_at>now()-interval '60 seconds')
    or (select count(*) from e2_otp_private.jobs where phone=p and created_at>now()-interval '1 hour')>=5
    or (select count(*) from e2_otp_private.jobs where phone=p and created_at>now()-interval '1 day')>=20
    or (select count(*) from e2_otp_private.jobs where created_at>now()-interval '1 minute')>=6
    or (select count(*) from e2_otp_private.jobs where created_at>now()-interval '1 hour')>=60
    or (select count(*) from e2_otp_private.jobs where created_at>now()-interval '1 day')>=300
    or (select count(*) from e2_otp_private.jobs where state in ('queued','claimed') and expires_at>now())>=3 then
  return '{"error":{"http_code":429,"message":"Please wait before requesting another code, or use email."}}'::jsonb;
 end if;
 update e2_otp_private.jobs set state='expired',ciphertext=null where phone=p and state='queued';
 insert into e2_otp_private.jobs(phone,ciphertext,fingerprint)
 values(p,extensions.pgp_sym_encrypt(code,cfg.encryption_key,'cipher-algo=aes256'),fp);
 return '{}'::jsonb;
end;$$;
revoke all on function public.e2_aira_send_sms(jsonb) from public,anon,authenticated,service_role;
grant execute on function public.e2_aira_send_sms(jsonb) to supabase_auth_admin;

create or replace function public.e2_aira_worker(p_token text,p_action text,p_job uuid default null,p_ok boolean default false)
returns jsonb language plpgsql security definer set search_path='' as $$
declare cfg e2_otp_private.settings; job e2_otp_private.jobs;
begin
 select * into cfg from e2_otp_private.settings where id=true for update;
 if length(coalesce(p_token,''))<>64 or cfg.worker_hash='' or
    encode(extensions.digest(p_token,'sha256'),'hex')<>cfg.worker_hash or cfg.worker_until<=now() then
  raise exception 'Worker unavailable' using errcode='42501';
 end if;
 if p_action not in ('poll','ack','offline','heartbeat') or p_action is null then raise exception 'Invalid action'; end if;
 if p_action='offline' then update e2_otp_private.settings set heartbeat=null where id=true; return '{}'::jsonb; end if;
 -- An in-flight delivery may still acknowledge after the send switch closes.
 if p_action='ack' then
  update e2_otp_private.jobs set state=case when p_ok then 'sent' else 'failed' end,ciphertext=null
   where id=p_job and state='claimed';
  if found and not p_ok then
   update e2_otp_private.settings set heartbeat=null,suspended_until=now()+interval '60 seconds' where id=true;
  end if;
  return '{}'::jsonb;
 end if;
 if not cfg.enabled or (not cfg.public_enabled and cfg.pilot_until<=now()) or cfg.suspended_until>now() then return '{"paused":true}'::jsonb; end if;
 update e2_otp_private.settings set heartbeat=now() where id=true;
 if p_action='heartbeat' then return '{}'::jsonb; end if;
 update e2_otp_private.jobs set state='expired',ciphertext=null
 where ciphertext is not null and (expires_at<=now() or (state='claimed' and claimed_at<now()-interval '90 seconds'));
 delete from e2_otp_private.jobs where created_at<now()-interval '2 days';
 -- A second sender process must not claim while another delivery is in flight.
 if exists(select 1 from e2_otp_private.jobs where state='claimed') then return '{}'::jsonb; end if;
 select * into job from e2_otp_private.jobs where state='queued' and expires_at>now()+interval '70 seconds'
   and phone ~ '^601[0-9]{8,9}$'
   and (cfg.public_enabled or phone in(select phone from e2_otp_private.allowed_phones))
   order by created_at limit 1 for update skip locked;
 if not found then return '{}'::jsonb;end if;
 update e2_otp_private.jobs set state='claimed',claimed_at=now() where id=job.id;
 return jsonb_build_object('id',job.id,'phone',job.phone,'otp',extensions.pgp_sym_decrypt(job.ciphertext,cfg.encryption_key),'expires_at',job.expires_at);
end;$$;
revoke all on function public.e2_aira_worker(text,text,uuid,boolean) from public,anon,authenticated;
grant execute on function public.e2_aira_worker(text,text,uuid,boolean) to service_role;

-- Existing verified customers must retain password access during sender outages.
-- Editable profile/metadata phone numbers never grant authorization.
create or replace function public.e2_customer_allowed() returns boolean
language sql stable security definer set search_path='' as $$
 select exists(select 1 from auth.users u where u.id=auth.uid() and (
  u.email_confirmed_at is not null or
  (u.phone_confirmed_at is not null and u.phone ~ '^\+?601[0-9]{8,9}$' and exists(
    select 1 from e2_otp_private.settings s where s.id and (s.public_enabled or
      (s.enabled and s.pilot_until>now() and exists(select 1 from e2_otp_private.allowed_phones a where a.phone=ltrim(u.phone,'+'))))
  ))
 )) and not exists(select 1 from public.staff_memberships where user_id=auth.uid() and not active);
$$;
revoke all on function public.e2_customer_allowed() from public,anon;
grant execute on function public.e2_customer_allowed() to authenticated;
commit;
