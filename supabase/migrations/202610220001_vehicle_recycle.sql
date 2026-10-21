begin;
alter table public.vehicles
 add column lifecycle_state text not null default 'active' check(lifecycle_state in ('active','trash','archived','purging')),
 add column lifecycle_reason text not null default '' check(length(lifecycle_reason)<=500),
 add column lifecycle_at timestamptz,
 add column lifecycle_revision bigint not null default 1,
 add constraint inactive_vehicle_private check(lifecycle_state='active' or publication='draft');

create table public.vehicle_lifecycle_audit(
 id bigint generated always as identity primary key, vehicle_id uuid not null, plate text not null,
 actor uuid not null, action text not null, reason text not null default '', details jsonb not null default '{}', occurred_at timestamptz not null default now()
);
alter table public.vehicle_lifecycle_audit enable row level security;
revoke all on public.vehicle_lifecycle_audit from public,anon,authenticated;
grant select on public.vehicle_lifecycle_audit to authenticated;
create policy managers_read_vehicle_lifecycle on public.vehicle_lifecycle_audit for select to authenticated using(public.e2_is_admin());
-- Minimal tombstone prevents a scheduled importer silently recreating a purged plate.
create table public.vehicle_purged_plates(plate_key text primary key,vehicle_id uuid not null,deleted_at timestamptz not null default now());
alter table public.vehicle_purged_plates enable row level security;
revoke all on public.vehicle_purged_plates from public,anon,authenticated;

create function public.e2_vehicle_dependencies(target uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare r record; n bigint; result jsonb:='{}';
begin
 if not public.e2_is_admin() then raise exception 'Admin access required'; end if;
 -- Discover real FK dependencies, including future business tables. Never delete history.
 for r in select c.conrelid::regclass as tbl,a.attname as col from pg_catalog.pg_constraint c
  join pg_catalog.pg_attribute a on a.attrelid=c.conrelid and a.attnum=c.conkey[1]
  where c.contype='f' and c.confrelid='public.vehicles'::regclass
  and c.conrelid not in ('public.vehicle_photos'::regclass,'public.vehicle_drive_photos'::regclass,'public.vehicle_import_jobs'::regclass)
  and c.conrelid::regclass::text not in ('vehicle_description_translations','vehicle_translation_jobs','public.vehicle_description_translations','public.vehicle_translation_jobs')
 loop
  execute format('select count(*) from %s where %I=$1',r.tbl,r.col) into n using target;
  if n>0 then result:=result||jsonb_build_object(r.tbl::text,n); end if;
 end loop;
 return result;
end;$$;

create function public.e2_guard_vehicle_lifecycle() returns trigger language plpgsql security definer set search_path='' as $$
declare internal boolean:=coalesce(current_setting('e2.lifecycle_target',true),'')=coalesce(new.id,old.id)::text;
begin
 if tg_op='INSERT' then
  if new.lifecycle_state<>'active' or new.lifecycle_revision<>1 or new.lifecycle_reason<>'' or new.lifecycle_at is not null then raise exception 'Use vehicle lifecycle actions'; end if;
  if exists(select 1 from public.vehicle_purged_plates where plate_key=regexp_replace(upper(new.plate),'[^A-Z0-9]','','g')) then raise exception 'This plate was permanently deleted; manual review is required'; end if;
 elsif tg_op='UPDATE' then
  if not internal and (old.lifecycle_state<>'active' or (new.lifecycle_state,new.lifecycle_reason,new.lifecycle_at,new.lifecycle_revision) is distinct from (old.lifecycle_state,old.lifecycle_reason,old.lifecycle_at,old.lifecycle_revision)) then raise exception 'Restore vehicle before editing; use lifecycle actions'; end if;
 elsif not internal or old.lifecycle_state<>'purging' then raise exception 'Use Super Admin permanent deletion';
 end if;
 return coalesce(new,old);
end;$$;
create trigger aa_vehicle_lifecycle before insert or update or delete on public.vehicles for each row execute function public.e2_guard_vehicle_lifecycle();
create function public.e2_bump_vehicle_revision() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if coalesce(current_setting('e2.lifecycle_target',true),'')<>new.id::text then new.lifecycle_revision:=old.lifecycle_revision+1; end if;
 return new;
end;$$;
revoke all on function public.e2_bump_vehicle_revision() from public,anon,authenticated;
create trigger zz_lifecycle_revision before update on public.vehicles for each row execute function public.e2_bump_vehicle_revision();

-- Serialize new links with lifecycle transitions using the SAME parent row lock.
-- Updates to historical records keep working; changing their vehicle does not.
create function public.e2_guard_vehicle_reference() returns trigger language plpgsql security definer set search_path='' as $$
declare target uuid; state text;
begin
 target:=(to_jsonb(new)->>tg_argv[0])::uuid;
 if target is null then return new; end if;
 if tg_op='UPDATE' and (to_jsonb(old)->>tg_argv[0]) is not distinct from (to_jsonb(new)->>tg_argv[0]) then return new; end if;
 select lifecycle_state into state from public.vehicles where id=target for update;
 if state is distinct from 'active' then raise exception 'Vehicle is in recycle bin or archived. Restore it before creating new records'; end if;
 return new;
end;$$;
do $$declare r record;begin
 for r in select c.conrelid::regclass as tbl,a.attname as col from pg_catalog.pg_constraint c join pg_catalog.pg_attribute a on a.attrelid=c.conrelid and a.attnum=c.conkey[1]
 where c.contype='f' and c.confrelid='public.vehicles'::regclass loop
  execute format('create trigger aa_vehicle_reference before insert or update of %I on %s for each row execute function public.e2_guard_vehicle_reference(%L)',r.col,r.tbl,r.col);
 end loop;
end$$;

create function public.e2_vehicle_lifecycle(target uuid,operation text,expected_revision bigint default null,note text default '',confirm_plate text default '') returns jsonb
language plpgsql security definer set search_path='' as $$
declare v public.vehicles; deps jsonb; next_state text; paths jsonb; r record;
begin
 -- Same lock as membership updates prevents revocation races.
 perform pg_advisory_xact_lock(20260913,4);
 if not public.e2_is_admin() then raise exception 'Admin access required'; end if;
 select * into v from public.vehicles where id=target for update;
 if not found then raise exception 'Vehicle not found. Refresh inventory'; end if;
 deps:=public.e2_vehicle_dependencies(target);
 if operation='inspect' then return jsonb_build_object('vehicle',to_jsonb(v),'dependencies',deps); end if;
 if expected_revision is distinct from v.lifecycle_revision then raise exception 'Vehicle changed. Refresh before retrying'; end if;
 if operation not in ('remove','restore','purge_begin','purge_finish') or operation is null then raise exception 'Invalid lifecycle action'; end if;
 perform set_config('e2.lifecycle_target',target::text,true);
 if operation='remove' then
  if v.lifecycle_state<>'active' then raise exception 'Vehicle is already removed from active stock'; end if;
  if length(trim(coalesce(note,''))) not between 1 and 500 then raise exception 'Enter a reason (1-500 characters)'; end if;
  next_state:=case when deps='{}'::jsonb then 'trash' else 'archived' end;
  -- Existing publication trigger requires moving to draft before changing details.
  update public.vehicles set publication='draft' where id=target;
  update public.vehicles set lifecycle_state=next_state,lifecycle_reason=trim(note),lifecycle_at=now(),lifecycle_revision=lifecycle_revision+1 where id=target;
 elsif operation='restore' then
  if v.lifecycle_state not in ('trash','archived') then raise exception 'Only recycled or archived vehicles can be restored'; end if;
  update public.vehicles set lifecycle_state='active',lifecycle_reason='',lifecycle_at=null,lifecycle_revision=lifecycle_revision+1,publication='draft' where id=target;
  next_state:='active';
 else
  if not public.e2_is_super_admin() then raise exception 'Super Admin access required'; end if;
  if confirm_plate is distinct from v.plate then raise exception 'Plate confirmation does not match'; end if;
  if deps<>'{}'::jsonb then raise exception 'Vehicle has business records. Archive only; permanent deletion is prohibited'; end if;
  if v.lifecycle_state not in ('trash','purging') then raise exception 'Move vehicle to recycle bin before permanent deletion'; end if;
  if operation='purge_begin' then
   update public.vehicles set lifecycle_state='purging',lifecycle_revision=lifecycle_revision+1,lifecycle_at=now() where id=target;
   next_state:='purging';
  else
   if v.lifecycle_state<>'purging' then raise exception 'Begin permanent deletion first'; end if;
   if exists(select 1 from storage.objects where bucket_id='vehicle-photos' and split_part(name,'/',1)=target::text) then raise exception 'Uploaded photo cleanup is incomplete. Retry permanent deletion'; end if;
   insert into public.vehicle_purged_plates(plate_key,vehicle_id) values(regexp_replace(upper(v.plate),'[^A-Z0-9]','','g'),target);
   -- Only technical metadata is removed; business dependencies were rejected above.
   delete from public.vehicle_photos where vehicle_id=target;
   delete from public.vehicle_drive_photos where vehicle_id=target;
   update public.vehicle_import_jobs set vehicle_id=null where vehicle_id=target;
   delete from public.vehicles where id=target;
   next_state:='deleted';
  end if;
 end if;
 insert into public.vehicle_lifecycle_audit(vehicle_id,plate,actor,action,reason,details) values(target,v.plate,auth.uid(),operation,coalesce(note,''),jsonb_build_object('from',v.lifecycle_state,'to',next_state,'dependencies',deps));
 select coalesce(jsonb_agg(name),'[]') into paths from storage.objects where bucket_id='vehicle-photos' and split_part(name,'/',1)=target::text;
 perform set_config('e2.lifecycle_target','',true);
 return jsonb_build_object('id',target,'state',next_state,'revision',v.lifecycle_revision+1,'paths',case when next_state='purging' then paths else '[]'::jsonb end);
end;$$;
revoke all on function public.e2_vehicle_dependencies(uuid),public.e2_guard_vehicle_lifecycle(),public.e2_guard_vehicle_reference(),public.e2_vehicle_lifecycle(uuid,text,bigint,text,text) from public,anon,authenticated;
grant execute on function public.e2_vehicle_lifecycle(uuid,text,bigint,text,text) to authenticated;

-- Staff need historical stock for their existing work; only managers see trash.
drop policy visible_stock on public.vehicles;
create policy visible_stock on public.vehicles for select to anon,authenticated using (
 (lifecycle_state='active' and (publication='published' or public.e2_can_read_stock())) or
 (lifecycle_state='archived' and public.e2_can_read_stock()) or
 (lifecycle_state in ('trash','purging') and public.e2_is_admin())
);
-- The ordinary photo-removal policy requires an unlinked row. Purge cleanup is
-- deliberately narrow and keeps photo metadata until Storage confirms removal.
-- Lock the parent for Storage writes too: an in-flight upload must finish before
-- removal inspects its cleanup paths, or see the new state and be rejected.
create function public.e2_storage_vehicle_lifecycle(object_name text,allow_purge boolean default false) returns boolean language plpgsql security definer set search_path='' as $$
declare state text;
begin
 select lifecycle_state into state from public.vehicles where id::text=split_part(object_name,'/',1) for update;
 return coalesce(state='active' or (allow_purge and state='purging' and public.e2_is_super_admin()),false);
end;$$;
revoke all on function public.e2_storage_vehicle_lifecycle(text,boolean) from public,anon,authenticated;
grant execute on function public.e2_storage_vehicle_lifecycle(text,boolean) to authenticated;
create policy super_admin_purge_storage on storage.objects for delete to authenticated using (
 bucket_id='vehicle-photos' and public.e2_is_super_admin() and exists(select 1 from public.vehicles where id::text=split_part(name,'/',1) and lifecycle_state='purging')
);
create policy lifecycle_storage_upload on storage.objects as restrictive for insert to authenticated with check (
 bucket_id<>'vehicle-photos' or public.e2_storage_vehicle_lifecycle(name,false)
);
create policy lifecycle_storage_delete on storage.objects as restrictive for delete to authenticated using (
 bucket_id<>'vehicle-photos' or public.e2_storage_vehicle_lifecycle(name,true)
);
create policy lifecycle_storage_update on storage.objects as restrictive for update to authenticated using (
 bucket_id<>'vehicle-photos' or public.e2_storage_vehicle_lifecycle(name,false)
) with check (
 bucket_id<>'vehicle-photos' or public.e2_storage_vehicle_lifecycle(name,false)
);
-- Block ordinary unlink/upload/reorder while removed. Purge may delete metadata.
create function public.e2_guard_inactive_photo() returns trigger language plpgsql security definer set search_path='' as $$
declare target uuid:=coalesce(new.vehicle_id,old.vehicle_id); state text;
begin
 select lifecycle_state into state from public.vehicles where id=target for update;
 if state is distinct from 'active' and not(tg_op='DELETE' and coalesce(current_setting('e2.lifecycle_target',true),'')=target::text and state='purging') then raise exception 'Restore vehicle before changing photos'; end if;
 return coalesce(new,old);
end;$$;
revoke all on function public.e2_guard_inactive_photo() from public,anon,authenticated;
create trigger ab_inactive_photo before insert or update or delete on public.vehicle_photos for each row execute function public.e2_guard_inactive_photo();

-- Keep historical job joins intact; only NEW dispatch vehicle choices are filtered.
do $$declare src text;begin
 src:=pg_get_functiondef('public.e2_operations_workspace()'::regprocedure);
 if position('from public.vehicles v where actor_role' in src)=0 then raise exception 'Operations workspace definition changed'; end if;
 src:=replace(src,'from public.vehicles v where actor_role','from public.vehicles v where v.lifecycle_state=''active'' and actor_role'); execute src;
 src:=pg_get_functiondef('public.e2_import_drive_vehicle(uuid,text,text,text,jsonb)'::regprocedure);
 if position('if target.publication<>' in src)=0 then raise exception 'Importer definition changed'; end if;
 src:=replace(src,'if target.publication<>','if target.lifecycle_state<>''active'' or target.publication<>');
 src:=replace(src,'lock table public.vehicles in share row exclusive mode;', 'lock table public.vehicles in share row exclusive mode; if exists(select 1 from public.vehicle_purged_plates tombstone where tombstone.plate_key=any(aliases)) then return jsonb_build_object(''status'',''existing'',''vehicle_id'',null); end if;'); execute src;
end$$;
commit;
