begin;
create table public.saved_vehicles(
 user_id uuid not null references auth.users(id) on delete cascade,
 vehicle_id uuid not null references public.vehicles(id) on delete cascade,
 created_at timestamptz not null default now(),primary key(user_id,vehicle_id)
);
alter table public.saved_vehicles enable row level security;
revoke all on public.saved_vehicles from anon,authenticated;
grant select on public.saved_vehicles to authenticated;
create policy own_saved_vehicles on public.saved_vehicles for select to authenticated using(user_id=auth.uid() and public.e2_customer_allowed());
create function public.e2_save_vehicle(target uuid,keep boolean) returns boolean language plpgsql security definer set search_path='' as $$
begin
 if not public.e2_customer_allowed() then raise exception 'Confirm your email and sign in.';end if;
 if keep is null then raise exception 'Choose save or remove.';end if;
 perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text,140007));
 if keep then
  if not exists(select 1 from public.vehicles where id=target and publication='published') then raise exception 'This vehicle is no longer published.';end if;
  if not exists(select 1 from public.saved_vehicles where user_id=auth.uid() and vehicle_id=target) and (select count(*) from public.saved_vehicles where user_id=auth.uid())>=100 then raise exception 'Your shortlist is full. Remove a car before saving another.';end if;
  insert into public.saved_vehicles(user_id,vehicle_id) values(auth.uid(),target) on conflict do nothing;
 else delete from public.saved_vehicles where user_id=auth.uid() and vehicle_id=target;end if;
 return keep;
end;$$;
revoke all on function public.e2_save_vehicle(uuid,boolean) from public;
grant execute on function public.e2_save_vehicle(uuid,boolean) to authenticated;

commit;
