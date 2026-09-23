-- Staff intake only. Existing vehicle invitations and Partner referrals are unchanged.
begin;
alter table public.intake_links alter column vehicle_id drop not null;
alter table public.intake_submissions alter column vehicle_id drop not null;
create or replace function public.e2_create_intake_link(vehicle uuid) returns public.intake_links language plpgsql security definer set search_path='' as $$declare l public.intake_links;begin
 if not public.e2_intake_active_staff() then raise exception 'Staff sign in required.';end if;
 if vehicle is not null and not exists(select 1 from public.vehicles where id=vehicle and publication='published' and stock_status='Available') then raise exception 'Choose an available published car.';end if;
 perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text,140011));
 select * into l from public.intake_links where vehicle_id is not distinct from vehicle and salesperson=auth.uid() and active and expires_at>now()+interval '1 day' order by created_at desc limit 1;
 if found then return l;end if;
 if (select count(*) from public.intake_links where salesperson=auth.uid() and created_at>now()-interval '1 day')>=30 then raise exception 'Daily invitation limit reached.';end if;
 insert into public.intake_links(vehicle_id,salesperson) values(vehicle,auth.uid()) returning * into l;return l;
end;$$;
create or replace function public.e2_intake_context(invite uuid) returns jsonb language plpgsql security definer set search_path='' as $$declare result jsonb;begin
 select jsonb_build_object('vehicle',jsonb_build_object('id',v.id,'name',coalesce(v.brand||' '||v.model,'Not decided yet'),'variant',v.variant,'year',v.year,'plate',v.plate,'price',v.price),'contact',jsonb_build_object('name',coalesce(nullif(p.display_name,''),'E2 team'),'whatsapp',case when p.is_public then p.whatsapp else null end),'expires_at',l.expires_at) into result from public.intake_links l left join public.vehicles v on v.id=l.vehicle_id join public.staff_memberships m on m.user_id=l.salesperson left join public.staff_profiles p on p.user_id=m.user_id where l.id=invite and l.active and l.expires_at>now() and m.active and m.role in ('sales','admin','super_admin') and (l.vehicle_id is null or (v.publication='published' and v.stock_status='Available'));
 if result is null then raise exception 'This invitation is unavailable. Ask your salesperson for a new link.';end if;return result;
end;$$;
create function public.e2_intake_assign_vehicle(target uuid,vehicle uuid,expected_revision bigint) returns void language plpgsql security definer set search_path='' as $$
declare a public.intake_submissions;v public.vehicles;
begin
 select * into a from public.intake_submissions where id=target for update;
 if not public.e2_intake_active_staff() or not public.e2_intake_access(target) or not (public.e2_is_super_admin() or a.salesperson=auth.uid()) then raise exception 'Only the assigned salesperson or Super Admin can select the vehicle.';end if;
 if a.revision is distinct from expected_revision then raise exception 'Record changed. Reload before saving.';end if;
 if a.vehicle_id is not null or a.handed_at is not null or a.status not in ('Received by Salesman','Needs information') then raise exception 'Vehicle selection is no longer available.';end if;
 select * into v from public.vehicles where id=vehicle and publication='published' and stock_status='Available' for share;
 if not found then raise exception 'Choose an available published car.';end if;
 update public.intake_submissions set vehicle_id=v.id,vehicle_summary=jsonb_build_object('id',v.id,'name',v.brand||' '||v.model,'variant',v.variant,'year',v.year,'plate',v.plate,'price',v.price),updated_at=now(),revision=revision+1 where id=target;
 insert into public.intake_events(submission_id,actor,event,note) values(target,auth.uid(),'Vehicle selected',v.plate||' · '||v.brand||' '||v.model||'. Customer answers are unchanged; confirm deposit and financing preferences with the customer.');
end;$$;
revoke all on function public.e2_intake_assign_vehicle(uuid,uuid,bigint) from public,anon,authenticated;
grant execute on function public.e2_intake_assign_vehicle(uuid,uuid,bigint) to authenticated;
create or replace function public.e2_intake_handoff(target uuid,office uuid,message text,expected_revision bigint) returns void language plpgsql security definer set search_path='' as $$declare a public.intake_submissions;begin
 select * into a from public.intake_submissions where id=target for update;
 if not public.e2_intake_active_staff() or not public.e2_intake_access(target) or not (public.e2_is_super_admin() or a.salesperson=auth.uid()) then raise exception 'Only the assigned salesperson or Super Admin can hand over.';end if;
 if a.revision is distinct from expected_revision then raise exception 'Record changed. Reload before saving.';end if;
 if a.status not in ('Received by Salesman','Needs information') then raise exception 'This application has already been handed over.';end if;
 if a.vehicle_id is null then raise exception 'Choose a vehicle before handing over to Office Admin.';end if;
 if not exists(select 1 from public.staff_memberships where user_id=office and active and role in ('admin','office_admin','super_admin')) then raise exception 'Choose an active Office Admin.';end if;
 if message is null or length(trim(message)) not between 1 and 1000 then raise exception 'Add a handover note.';end if;
 update public.intake_submissions set office_admin=office,handed_at=now(),status='Sent to Office',updated_at=now(),revision=revision+1 where id=target;
 insert into public.intake_events(submission_id,actor,event,note) values(target,auth.uid(),'Sent to Office',trim(message));
end;$$;
commit;
