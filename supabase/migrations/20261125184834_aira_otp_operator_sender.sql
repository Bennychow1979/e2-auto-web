begin;
create or replace function public.e2_aira_worker(p_token text,p_action text,p_job uuid default null,p_ok boolean default false)
returns jsonb language plpgsql security definer set search_path='' as $$
declare cfg e2_otp_private.settings; job e2_otp_private.jobs;
begin
 select * into cfg from e2_otp_private.settings where id=true for update;
 if length(coalesce(p_token,''))<>64 or cfg.worker_hash='' or
    encode(extensions.digest(p_token,'sha256'),'hex')<>cfg.worker_hash or cfg.worker_until<=now() then
  raise exception 'Worker unavailable' using errcode='42501';
 end if;
 if p_action not in ('poll','ack','offline') or p_action is null then raise exception 'Invalid action'; end if;
 if p_action='offline' then
  update e2_otp_private.settings set heartbeat=null where id=true;
  return '{}'::jsonb;
 end if;
 if not cfg.enabled or cfg.pilot_until<=now() then return '{"paused":true}'::jsonb; end if;
 update e2_otp_private.jobs set state='expired',ciphertext=null
 where ciphertext is not null and (expires_at<=now() or (state='claimed' and claimed_at<now()-interval '90 seconds'));
 delete from e2_otp_private.jobs where created_at<now()-interval '2 days';
 if p_action='ack' then
  update e2_otp_private.jobs set state=case when p_ok then 'sent' else 'failed' end,ciphertext=null
   where id=p_job and state='claimed';
  if not p_ok then update e2_otp_private.settings set heartbeat=null where id=true;end if;
  return '{}'::jsonb;
 end if;
 update e2_otp_private.settings set heartbeat=now() where id=true;
 select * into job from e2_otp_private.jobs where state='queued' and expires_at>now()+interval '20 seconds'
   and phone in(select phone from e2_otp_private.allowed_phones)
   order by created_at limit 1 for update skip locked;
 if not found then return '{}'::jsonb;end if;
 update e2_otp_private.jobs set state='claimed',claimed_at=now() where id=job.id;
 return jsonb_build_object('id',job.id,'phone',job.phone,'otp',extensions.pgp_sym_decrypt(job.ciphertext,cfg.encryption_key),'expires_at',job.expires_at);
end;$$;
revoke all on function public.e2_aira_worker(text,text,uuid,boolean) from public,anon,authenticated;
grant execute on function public.e2_aira_worker(text,text,uuid,boolean) to service_role;


commit;