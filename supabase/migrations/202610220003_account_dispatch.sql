begin;
-- Account can dispatch and read jobs. Movement, bill approval and vehicle creation
-- keep their existing permissions; this does not turn Account into Admin.
create or replace function public.e2_ops_job_read(target uuid) returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.e2_runner_jobs j where j.id=target and (
 public.e2_ops_role() in ('super_admin','admin','account') or
 (public.e2_ops_role()='runner' and j.assigned_to=auth.uid())));
$$;
do $$declare src text;begin
 src:=pg_get_functiondef('public.e2_save_runner_job(uuid,bigint,jsonb)'::regprocedure);
 if position('not in (''super_admin'',''admin'')' in src)=0 then raise exception 'Dispatch permission definition changed'; end if;
 src:=replace(src,'not in (''super_admin'',''admin'')','not in (''super_admin'',''admin'',''account'')');
 src:=replace(src,'Admin access required.','Admin or Account access required.');execute src;
 src:=pg_get_functiondef('public.e2_operations_workspace()'::regprocedure);
 if position('actor_role in (''super_admin'',''admin'')' in src)=0 then raise exception 'Dispatch workspace changed';end if;
 src:=replace(src,'actor_role in (''super_admin'',''admin'')','actor_role in (''super_admin'',''admin'',''account'')');execute src;
end$$;
commit;
