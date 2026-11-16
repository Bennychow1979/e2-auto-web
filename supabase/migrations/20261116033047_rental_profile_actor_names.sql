begin;

-- Keep the authenticated UUID as the audit identity. Names are server-derived
-- snapshots, never trusted from browser headers or mutable payment JSON.
alter table public.rental_audit add column actor_display_name text;

create function public.rental_identity() returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare result jsonb;
begin
 if auth.uid() is null or public.rental_ok() is not true then
  raise exception 'Rental access denied' using errcode='42501';
 end if;
 select jsonb_build_object('user_id',u.id,'display_name',
  coalesce(nullif(btrim(p.display_name),''),nullif(btrim(u.email),''),u.id::text))
 into result from auth.users u left join public.staff_profiles p on p.user_id=u.id
 where u.id=auth.uid();
 if result is null then raise exception 'Rental access denied' using errcode='42501'; end if;
 return result;
end $$;

create or replace function public.rental_audit_fn() returns trigger
language plpgsql security definer set search_path='' as $$
declare actor_name text;
begin
 select coalesce(nullif(btrim(p.display_name),''),nullif(btrim(u.email),''))
 into actor_name from auth.users u left join public.staff_profiles p on p.user_id=u.id
 where u.id=auth.uid();
 insert into public.rental_audit(actor,actor_display_name,tbl,row_id,action,old,new)
 values(auth.uid(),actor_name,tg_table_name,
  coalesce(to_jsonb(new)->>'id',to_jsonb(old)->>'id',to_jsonb(new)->>'user_id',to_jsonb(old)->>'user_id'),
  tg_op,to_jsonb(old),to_jsonb(new));
 return null;
end $$;

-- Additive API keeps cached older viewers working. The original list function
-- enforces Super Admin, pagination and filtering before names are resolved.
create function public.rental_audit_list_v2(p_before bigint default null,p_plate text default '',p_limit integer default 20)
returns table(id text,at timestamptz,actor uuid,actor_email text,tbl text,row_id text,action text,plate text,kind text,actor_display_name text)
language sql stable security definer set search_path='' as $$
 select l.*,coalesce(nullif(btrim(a.actor_display_name),''),nullif(btrim(p.display_name),''),l.actor_email)
 from public.rental_audit_list(p_before,p_plate,p_limit) l
 join public.rental_audit a on a.id=l.id::bigint
 left join public.staff_profiles p on p.user_id=l.actor
 order by a.id desc;
$$;

revoke all on function public.rental_identity(),public.rental_audit_list_v2(bigint,text,integer) from public,anon,authenticated;
grant execute on function public.rental_identity(),public.rental_audit_list_v2(bigint,text,integer) to authenticated;
revoke all on function public.rental_audit_fn() from public,anon,authenticated;
commit;
