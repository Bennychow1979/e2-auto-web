begin;
-- Follow the existing import worker's one-use capability pattern. No Bot secret in SQL.
create table public.e2_viewing_dispatches (
  id uuid primary key default gen_random_uuid(),
  token_hash text not null,
  expires_at timestamptz not null default now()+interval '5 minutes',
  claimed_at timestamptz
);
alter table public.e2_viewing_dispatches enable row level security;
revoke all on public.e2_viewing_dispatches from public,anon,authenticated;
grant all on public.e2_viewing_dispatches to service_role;

create function public.e2_dispatch_viewing_notifications() returns void
language plpgsql security definer set search_path='' as $$
declare token text; dispatch uuid;
begin
  perform pg_advisory_xact_lock(20261020,7);
  delete from public.e2_viewing_dispatches where expires_at<now()-interval '1 day';
  update public.e2_viewing_notifications set status='uncertain',issue='Delivery receipt missing; check the channel before retrying.'
    where status='sending' and lease_until<now();
  if not (select notifications_enabled from public.e2_viewing_delivery_settings where singleton)
    or not exists(select 1 from public.e2_viewing_notifications where status='pending' and available_at<=now()) then return; end if;
  if exists(select 1 from public.e2_viewing_dispatches where claimed_at is null and expires_at>now()) then return; end if;
  token:='e2view_'||replace(gen_random_uuid()::text||gen_random_uuid()::text,'-','');
  insert into public.e2_viewing_dispatches(token_hash) values(encode(sha256(convert_to(token,'UTF8')),'hex')) returning id into dispatch;
  perform net.http_post(
    url:='https://gkppiuuwsecojcnvkzjl.supabase.co/functions/v1/e2-viewing-notify',
    headers:=jsonb_build_object('Content-Type','application/json','Authorization','Bearer '||token),
    body:=jsonb_build_object('dispatch_id',dispatch),timeout_milliseconds:=120000);
end;
$$;
create function public.e2_claim_viewing_dispatch(dispatch uuid, token text) returns boolean
language plpgsql security definer set search_path='' as $$
begin
  if token is null or token !~ '^e2view_[a-f0-9]{64}$' then return false; end if;
  update public.e2_viewing_dispatches set claimed_at=now() where id=dispatch and claimed_at is null and expires_at>now()
    and token_hash=encode(sha256(convert_to(token,'UTF8')),'hex');
  return found;
end;
$$;
revoke all on function public.e2_dispatch_viewing_notifications() from public,anon,authenticated,service_role;
revoke all on function public.e2_claim_viewing_dispatch(uuid,text) from public,anon,authenticated;
grant execute on function public.e2_claim_viewing_dispatch(uuid,text) to service_role;
commit;
