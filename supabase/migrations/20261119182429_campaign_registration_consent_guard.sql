-- Only record registrations with a valid consented campaign visit.
create or replace function e2_campaign_private.capture_registration() returns trigger
language plpgsql security definer set search_path='' as $$
declare linked uuid;
begin
 if TG_OP='INSERT' then
  if new.raw_user_meta_data->>'e2_customer_signup' is distinct from 'true' then return new; end if;
  if coalesce(new.raw_user_meta_data->>'e2_campaign_token','') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then
   select v.id into linked from e2_campaign_private.visits v
   where v.token=(new.raw_user_meta_data->>'e2_campaign_token')::uuid and v.created_at>=now()-interval '30 days' and v.created_at<=now();
  end if;
  if linked is null then return new; end if;
  insert into e2_campaign_private.registrations(user_id,visit_id,started_at,confirmed_at)
  values(new.id,linked,now(),new.email_confirmed_at) on conflict(user_id) do nothing;
 elsif old.email_confirmed_at is null and new.email_confirmed_at is not null then
  update e2_campaign_private.registrations set confirmed_at=new.email_confirmed_at where user_id=new.id and confirmed_at is null;
 end if;
 return new;
exception when others then
 -- Analytics must never break account creation or email verification. No PII.
 raise warning 'E2 campaign registration capture failed: %',SQLSTATE;
 return new;
end $$;
revoke all on function e2_campaign_private.capture_registration() from public,anon,authenticated;
