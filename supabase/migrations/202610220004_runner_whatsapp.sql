begin;
-- Private verified dispatch contacts. Not public sales profiles; no direct client access.
create table public.e2_runner_notification_contacts(
 user_id uuid primary key references public.staff_memberships(user_id),
 whatsapp text not null check(whatsapp ~ '^[1-9][0-9]{7,14}$'),
 verified_by uuid not null references public.staff_memberships(user_id),
 verified_at timestamptz not null default now()
);
alter table public.e2_runner_notification_contacts enable row level security;
revoke all on public.e2_runner_notification_contacts from anon,authenticated;

create function public.e2_verify_runner_whatsapp(target uuid,phone text) returns void
language plpgsql security definer set search_path='' as $$
begin
 perform pg_advisory_xact_lock(20260913,4);
 if coalesce(public.e2_ops_role(),'') not in ('super_admin','admin') then raise exception 'Admin access required';end if;
 if not exists(select 1 from public.staff_memberships where user_id=target and active and role='runner') then raise exception 'Active Runner required';end if;
 insert into public.e2_runner_notification_contacts(user_id,whatsapp,verified_by) values(target,phone,auth.uid())
 on conflict(user_id) do update set whatsapp=excluded.whatsapp,verified_by=auth.uid(),verified_at=now();
end $$;

create function public.e2_prepare_runner_whatsapp(target uuid,expected_revision bigint) returns jsonb
language plpgsql security definer set search_path='' as $$
declare j public.e2_runner_jobs; contact public.e2_runner_notification_contacts;
begin
 perform pg_advisory_xact_lock(20260913,4);
 if coalesce(public.e2_ops_role(),'') not in ('super_admin','admin','account') then raise exception 'Admin or Account access required';end if;
 select * into j from public.e2_runner_jobs where id=target for share;
 if j.id is null then raise exception 'Job unavailable';end if;
 if expected_revision is distinct from j.revision then raise exception 'Job changed. Refresh before notifying / 任务已变更，请刷新';end if;
 if j.status<>'assigned' or j.accepted_at is not null then raise exception 'This job is not awaiting acceptance / 此任务无需催接单';end if;
 if not exists(select 1 from public.staff_memberships where user_id=j.assigned_to and active and role='runner') then raise exception 'Runner unavailable';end if;
 select * into contact from public.e2_runner_notification_contacts where user_id=j.assigned_to;
 return jsonb_build_object('phone',contact.whatsapp,'verified_at',contact.verified_at,
 'job',to_jsonb(j)||jsonb_build_object('plate',(select plate from public.vehicles where id=j.vehicle_id),
 'runner_name',coalesce((select display_name from public.staff_profiles where user_id=j.assigned_to),'Runner')));
end $$;
revoke all on function public.e2_verify_runner_whatsapp(uuid,text),public.e2_prepare_runner_whatsapp(uuid,bigint) from public,anon;
grant execute on function public.e2_verify_runner_whatsapp(uuid,text),public.e2_prepare_runner_whatsapp(uuid,bigint) to authenticated;
-- Pin verification to the displayed job and contact version, so a stale dialog
-- cannot verify a different Runner after reassignment or overwrite another Admin.
create function public.e2_verify_job_runner_whatsapp(target uuid,expected_revision bigint,phone text,confirmed boolean,expected_verified_at timestamptz) returns jsonb
language plpgsql security definer set search_path='' as $$
declare prepared jsonb; runner uuid; prior timestamptz;
begin
 perform pg_advisory_xact_lock(20260913,4);
 if coalesce(public.e2_ops_role(),'') not in ('super_admin','admin') then raise exception 'Admin access required';end if;
 if confirmed is distinct from true then raise exception 'Confirm this number belongs to the Runner / 请先确认号码属于此 Runner';end if;
 prepared:=public.e2_prepare_runner_whatsapp(target,expected_revision);
 runner:=(prepared->'job'->>'assigned_to')::uuid;
 select verified_at into prior from public.e2_runner_notification_contacts where user_id=runner;
 if prior is distinct from expected_verified_at then raise exception 'Contact changed. Reopen the notification / 号码已被修改，请重新打开通知';end if;
 perform public.e2_verify_runner_whatsapp(runner,phone);
 return public.e2_prepare_runner_whatsapp(target,expected_revision);
end $$;
revoke all on function public.e2_verify_job_runner_whatsapp(uuid,bigint,text,boolean,timestamptz) from public,anon;
grant execute on function public.e2_verify_job_runner_whatsapp(uuid,bigint,text,boolean,timestamptz) to authenticated;
commit;
