begin;

create schema if not exists e2_contact_private;
revoke all on schema e2_contact_private from public, anon, authenticated;
grant usage on schema e2_contact_private to service_role;

-- One bounded row; no customer, phone, IP address or credential is stored here.
create table e2_contact_private.rate_limit (
  singleton boolean primary key default true check (singleton),
  accepted_at timestamptz[] not null default '{}'
);
alter table e2_contact_private.rate_limit enable row level security;
revoke all on e2_contact_private.rate_limit from public, anon, authenticated;
grant select, update on e2_contact_private.rate_limit to service_role;
insert into e2_contact_private.rate_limit(singleton) values (true);

-- SECURITY INVOKER: only the Edge service role has table access and EXECUTE.
create function public.e2_viewing_contact_rate_slot() returns boolean
language plpgsql security invoker set search_path = '' as $$
declare times timestamptz[]; instant timestamptz;
begin
  select accepted_at into times from e2_contact_private.rate_limit where singleton for update;
  if not found then return false; end if;
  instant := clock_timestamp();
  select coalesce(array_agg(t), '{}'::timestamptz[]) into times
    from unnest(times) t where t > instant - interval '60 seconds';
  if cardinality(times) >= 60 then return false; end if;
  update e2_contact_private.rate_limit set accepted_at = array_append(times, instant) where singleton;
  return true;
end;
$$;
revoke all on function public.e2_viewing_contact_rate_slot() from public, anon, authenticated;
grant execute on function public.e2_viewing_contact_rate_slot() to service_role;

create function public.e2_verify_viewing_contact(target uuid, candidate_phone text) returns jsonb
language plpgsql security invoker set search_path = '' as $$
declare v public.e2_viewings; incoming text; stored text; matches boolean; verified boolean; result jsonb;
begin
  if candidate_phone is null or length(candidate_phone) > 128 then return jsonb_build_object('found', false); end if;
  incoming := regexp_replace(candidate_phone, '[^0-9]', '', 'g');
  if left(incoming, 1) = '0' then incoming := '6' || incoming; end if;
  if incoming !~ '^[1-9][0-9]{7,14}$' then return jsonb_build_object('found', false); end if;

  -- Lock the row so concurrent retries cannot duplicate the first verification.
  select * into v from public.e2_viewings where id = target for update;
  if not found or v.created_at < now() - interval '90 days' then return jsonb_build_object('found', false); end if;
  stored := regexp_replace(v.phone, '[^0-9]', '', 'g');
  if left(stored, 1) = '0' then stored := '6' || stored; end if;
  matches := incoming = stored;
  verified := v.contact_verified_at is not null;

  if matches and not verified then
    update public.e2_viewings set contact_verified_at = now(), updated_at = now(), revision = revision + 1 where id = target;
    insert into public.e2_viewing_events(viewing_id, action, details)
      values (target, 'contact_verified', jsonb_build_object('source', 'aira_whatsapp'));
  elsif not matches then
    insert into public.e2_viewing_events(viewing_id, action, details)
      values (target, 'contact_mismatch', jsonb_build_object('wa_last4', right(incoming, 4)));
  end if;
  result := jsonb_build_object('found', true, 'match', matches, 'already_verified', verified,
    'vehicle_label', v.vehicle_label, 'preferred_date', v.preferred_date);
  if not matches then result := result || jsonb_build_object('form_last4', right(stored, 4)); end if;
  return result;
end;
$$;
revoke all on function public.e2_verify_viewing_contact(uuid, text) from public, anon, authenticated;
grant execute on function public.e2_verify_viewing_contact(uuid, text) to service_role;

commit;
