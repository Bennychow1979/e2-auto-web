begin;
-- Use saved records and immutable history as the shared workshop directory.
-- No new production records are created; cancelled/finished work keeps its names.
create function public.e2_inspection_workshops() returns jsonb
language plpgsql stable security definer set search_path='' as $$
begin
 if not public.e2_can_inspect() then
  raise exception 'Active Inspector or Admin access required.';
 end if;
 return coalesce((
  select jsonb_agg(name order by lower(name),name)
  from (
   select min(name) as name from (
    select trim(regexp_replace(workshop,'[[:space:]]+',' ','g')) as name
    from public.e2_vehicle_inspections
    union all
    select trim(regexp_replace(snapshot->>'workshop','[[:space:]]+',' ','g'))
    from public.e2_vehicle_inspection_events
   ) saved
   where name is not null and name<>''
   group by lower(name)
  ) unique_names
 ),'[]'::jsonb);
end;
$$;
revoke all on function public.e2_inspection_workshops() from public,anon,authenticated;
grant execute on function public.e2_inspection_workshops() to authenticated;
commit;
