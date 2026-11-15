begin;

-- Read-only audit APIs. The privileged join resolves account email without
-- granting client access to auth.users. Every call requires active Super Admin.
create function public.rental_audit_list(p_before bigint default null,p_plate text default '',p_limit integer default 20)
returns table(id text,at timestamptz,actor uuid,actor_email text,tbl text,row_id text,action text,plate text,kind text)
language plpgsql stable security definer set search_path='' as $$
begin
 if auth.uid() is null or public.e2_is_super_admin() is not true then
  raise exception 'Super Admin required' using errcode='42501';
 end if;
 if p_limit is null or p_limit<1 or p_limit>20 or length(coalesce(p_plate,''))>60 then
  raise exception 'Invalid audit filter' using errcode='22023';
 end if;
 return query
 select a.id::text,a.at,a.actor,u.email::text,a.tbl,a.row_id,a.action,
  case when a.tbl='rental_contracts' then coalesce(a.new->'data'->>'plate',a.old->'data'->>'plate',a.row_id) end,
  case when a.tbl='rental_access' then 'access'
       when a.tbl='rental_settings' then 'settings'
       when a.action='INSERT' then 'vehicle_added'
       when a.action='DELETE' then 'vehicle_deleted'
       when a.old->'data'->'payments' is distinct from a.new->'data'->'payments' then 'payment'
       when a.old->'data'->'handovers' is distinct from a.new->'data'->'handovers' then 'handover'
       else 'vehicle_updated' end
 from public.rental_audit a left join auth.users u on u.id=a.actor
 where (p_before is null or a.id<p_before)
 and (coalesce(btrim(p_plate),'')='' or (a.tbl='rental_contracts' and
  strpos(upper(coalesce(a.new->'data'->>'plate',a.old->'data'->>'plate',a.row_id)),upper(btrim(p_plate)))>0))
 order by a.id desc limit p_limit;
end $$;

create function public.rental_audit_detail(p_id bigint) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare result jsonb;
begin
 if auth.uid() is null or public.e2_is_super_admin() is not true then
  raise exception 'Super Admin required' using errcode='42501';
 end if;
 select jsonb_build_object('before',coalesce(a.old->'data',a.old),'after',coalesce(a.new->'data',a.new))
 into result from public.rental_audit a where a.id=p_id;
 if result is null then raise exception 'Audit record unavailable' using errcode='P0002'; end if;
 return result;
end $$;
revoke all on function public.rental_audit_list(bigint,text,integer),public.rental_audit_detail(bigint) from public,anon,authenticated;
grant execute on function public.rental_audit_list(bigint,text,integer),public.rental_audit_detail(bigint) to authenticated;
commit;
