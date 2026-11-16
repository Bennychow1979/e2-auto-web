begin;
alter table public.intake_links add column source text not null default 'staff' check(source in ('staff','aira'));
alter table public.intake_submissions add column source text not null default 'staff' check(source in ('staff','aira'));
create unique index intake_one_aira_entry on public.intake_links(source) where source='aira';
create index intake_submissions_source_date on public.intake_submissions(source,submitted_at desc) where submitted_at is not null;

-- Retain the previously distributed URL, owner and revocation switch.
-- This is the explicitly identified AIRA invitation, not every staff invitation.
do $$ begin
 update public.intake_links set source='aira',expires_at='infinity'::timestamptz
 where id='2700f7df-7787-4a18-b1bb-eaba47882537' and vehicle_id is null;
 if not found then raise exception 'Expected generic AIRA invitation is missing'; end if;
end $$;
update public.intake_submissions set source='aira' where link_id='2700f7df-7787-4a18-b1bb-eaba47882537';

create function public.e2_intake_stamp_source() returns trigger
language plpgsql security definer set search_path='' as $$ begin
 select l.source into new.source from public.intake_links l where l.id=new.link_id;
 return new;
end $$;
create trigger intake_submission_source before insert on public.intake_submissions
for each row execute function public.e2_intake_stamp_source();
revoke all on function public.e2_intake_stamp_source() from public,anon,authenticated;

create function public.e2_intake_public_entry(entry text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare link uuid; result jsonb;
begin
 if entry is distinct from 'aira' then raise exception 'Open a valid invitation.'; end if;
 select id into link from public.intake_links where source='aira';
 result:=public.e2_intake_context(link);
 return result||jsonb_build_object('invite',link,'source','aira');
end $$;
revoke all on function public.e2_intake_public_entry(text) from public,anon,authenticated;
grant execute on function public.e2_intake_public_entry(text) to service_role;

create function public.e2_intake_total_file_limit() returns trigger
language plpgsql security definer set search_path='' as $$ begin
 perform 1 from public.intake_submissions where id=new.submission_id for update;
 if (select coalesce(sum(byte_size),0) from public.intake_files where submission_id=new.submission_id)+new.byte_size>104857600 then
  raise exception 'Maximum 100 MB of files per application.';
 end if;
 return new;
end $$;
create trigger intake_file_total_limit before insert on public.intake_files
for each row execute function public.e2_intake_total_file_limit();
revoke all on function public.e2_intake_total_file_limit() from public,anon,authenticated;

-- Shared counters survive Edge restarts and cannot be reset by removing files.
-- No IP addresses, document names, customer details or write nonces are retained.
create schema e2_intake_private;
revoke all on schema e2_intake_private from public,anon,authenticated;
create table e2_intake_private.rate_windows(scope text not null,subject text not null,window_at timestamptz not null,used bigint not null,primary key(scope,subject,window_at));
alter table e2_intake_private.rate_windows enable row level security;
revoke all on e2_intake_private.rate_windows from public,anon,authenticated;
create function public.e2_intake_rate_check(scope text,subject text default '',cost bigint default 1) returns jsonb
language plpgsql security definer set search_path='' as $$
declare seconds integer; maximum bigint; window_start timestamptz; consumed bigint; retry integer;
begin
 if scope='request' then seconds:=60;maximum:=240;
 elsif scope='upload_bytes' then seconds:=86400;maximum:=2147483648;
 elsif scope='upload_session' then seconds:=3600;maximum:=60;
 else raise exception 'Invalid rate scope';end if;
 if cost is null or cost<1 or (scope<>'upload_bytes' and cost<>1) or (scope='upload_bytes' and cost>10485760) then raise exception 'Invalid rate cost';end if;
 if scope='upload_session' then
  if subject is null or subject !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then raise exception 'Invalid rate subject';end if;
 else subject:='global';end if;
 window_start:=to_timestamp(floor(extract(epoch from now())/seconds)*seconds);
 retry:=greatest(1,ceil(extract(epoch from window_start+make_interval(secs=>seconds)-now()))::integer);
 perform pg_advisory_xact_lock(140011,10);
 delete from e2_intake_private.rate_windows where window_at<now()-interval '2 days';
 insert into e2_intake_private.rate_windows as rw values(scope,subject,window_start,cost)
 on conflict on constraint rate_windows_pkey do update set used=least(rw.used+excluded.used,maximum+1)
 returning used into consumed;
 return jsonb_build_object('allowed',consumed<=maximum,'retry_after',retry);
end $$;
revoke all on function public.e2_intake_rate_check(text,text,bigint) from public,anon,authenticated;
grant execute on function public.e2_intake_rate_check(text,text,bigint) to service_role;
create or replace function public.e2_create_intake_link(vehicle uuid) returns public.intake_links language plpgsql security definer set search_path='' as $$declare l public.intake_links;begin
 if not public.e2_intake_active_staff() then raise exception 'Staff sign in required.';end if;
 if vehicle is not null and not exists(select 1 from public.vehicles where id=vehicle and publication='published' and stock_status='Available') then raise exception 'Choose an available published car.';end if;
 perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text,140011));
 select * into l from public.intake_links where source='staff' and vehicle_id is not distinct from vehicle and salesperson=auth.uid() and active and expires_at>now()+interval '1 day' order by created_at desc limit 1;
 if found then return l;end if;
 if (select count(*) from public.intake_links where salesperson=auth.uid() and created_at>now()-interval '1 day')>=30 then raise exception 'Daily invitation limit reached.';end if;
 insert into public.intake_links(vehicle_id,salesperson) values(vehicle,auth.uid()) returning * into l;return l;
end;$$;

commit;
