begin;
create function public.e2_reorder_photos(target_vehicle uuid, ordered_ids uuid[], expected_ids uuid[]) returns void
language plpgsql security definer set search_path='' as $$
declare current_ids uuid[]; state text;
begin
  if not public.e2_is_admin() then raise exception 'Admin access required'; end if;
  select publication into state from public.vehicles where id=target_vehicle for update;
  if state is distinct from 'draft' then raise exception 'Move vehicle to draft before rearranging photos'; end if;
  select coalesce(array_agg(id order by position),array[]::uuid[]) into current_ids
    from public.vehicle_photos where vehicle_id=target_vehicle;
  if expected_ids is distinct from current_ids then
    raise exception 'Photos changed in another session. Refresh before rearranging.';
  end if;
  if ordered_ids is null or cardinality(ordered_ids)<>cardinality(current_ids)
    or array_position(ordered_ids,null) is not null
    or (select count(distinct id) from unnest(ordered_ids) id)<>cardinality(current_ids)
    or not (ordered_ids @> current_ids and current_ids @> ordered_ids) then
    raise exception 'The new order must include every photo exactly once';
  end if;
  set constraints public.vehicle_photo_order deferred;
  update public.vehicle_photos p set position=(o.ordinality-1)::integer
    from unnest(ordered_ids) with ordinality as o(id,ordinality)
    where p.id=o.id and p.vehicle_id=target_vehicle;
  set constraints public.vehicle_photo_order immediate;
  insert into public.inventory_audit(actor,entity,action,row_id)
    values(auth.uid(),'vehicle_photos','REORDER',target_vehicle);
end;
$$;
revoke all on function public.e2_reorder_photos(uuid,uuid[],uuid[]) from public;
grant execute on function public.e2_reorder_photos(uuid,uuid[],uuid[]) to authenticated;
commit;
