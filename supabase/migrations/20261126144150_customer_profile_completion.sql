begin;

-- Row creation during registration is not an explicit press of Save.
alter table public.customer_profiles add column profile_saved_at timestamptz;
comment on column public.customer_profiles.profile_saved_at is
  'First successful explicit profile Save. NULL means registration bootstrap only or unknown legacy completion.';

-- The old client only auto-created revision 1 with name and phone. Do not
-- guess completion for indistinguishable legacy name/phone-only revision 1.
update public.customer_profiles set profile_saved_at=updated_at
where revision>1 or state<>'' or city<>'' or language<>''
  or budget_min is not null or budget_max is not null or desired_car<>''
  or purchase_timeline<>'' or payment_preference<>'' or trade_in<>'' or trade_in_details<>'';

create function public.e2_complete_customer_profile(
  details jsonb, expected_revision bigint, accept_privacy boolean default false
) returns public.customer_profiles
language plpgsql security definer set search_path='' as $$
declare saved public.customer_profiles; target uuid:=auth.uid();
begin
  if target is null or not public.e2_customer_allowed() then
    raise exception 'Sign in with an active verified customer account.';
  end if;
  -- Reuse validation, consent, ownership, locking and optimistic concurrency.
  -- Both writes are in the same transaction; failed saves cannot mark completion.
  saved:=public.e2_save_customer_profile(details,expected_revision,accept_privacy);
  update public.customer_profiles
    set profile_saved_at=coalesce(profile_saved_at,now())
    where user_id=target returning * into saved;
  return saved;
end;
$$;
revoke all on function public.e2_complete_customer_profile(jsonb,bigint,boolean) from public,anon;
grant execute on function public.e2_complete_customer_profile(jsonb,bigint,boolean) to authenticated;
commit;
