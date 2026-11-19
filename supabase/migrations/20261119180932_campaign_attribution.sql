-- Anonymous write-only campaign collection; private tables never exposed to clients.
create schema e2_campaign_private;
revoke all on schema e2_campaign_private from public;
create table e2_campaign_private.campaigns (
 campaign text not null, content text not null, format text not null,
 language text not null, scheduled_at timestamptz, is_test boolean not null default false,
 primary key(campaign,content)
);
create table e2_campaign_private.visits (
 id uuid primary key, token uuid not null unique default gen_random_uuid(), visitor_id uuid not null,
 campaign text not null, content text not null, landing_path text not null,
 consent_version text not null, created_at timestamptz not null default now(),
 foreign key(campaign,content) references e2_campaign_private.campaigns(campaign,content)
);
create index campaign_visits_created on e2_campaign_private.visits(created_at);
create index campaign_visits_visitor on e2_campaign_private.visits(visitor_id,created_at);
create table e2_campaign_private.registrations (
 user_id uuid primary key references auth.users(id) on delete cascade,
 visit_id uuid references e2_campaign_private.visits(id),
 started_at timestamptz not null, confirmed_at timestamptz
);
create index campaign_registrations_visit on e2_campaign_private.registrations(visit_id);
alter table e2_campaign_private.campaigns enable row level security;
alter table e2_campaign_private.visits enable row level security;
alter table e2_campaign_private.registrations enable row level security;
revoke all on all tables in schema e2_campaign_private from public,anon,authenticated;

insert into e2_campaign_private.campaigns(campaign,content,format,language,scheduled_at,is_test) values
 ('honda_week','22_zh_jazz','image','zh','2026-11-22 12:30+08',false),
 ('honda_week','23_ms_insight','image','ms','2026-11-23 20:30+08',false),
 ('honda_week','24_en_civic','image','en','2026-11-24 12:30+08',false),
 ('honda_week','25_zh_register','image','zh','2026-11-25 20:30+08',false),
 ('honda_week','26_ms_jazz','image','ms','2026-11-26 12:30+08',false),
 ('honda_week','27_en_weekend','image','en','2026-11-27 20:30+08',false),
 ('honda_week','28_zh_preferences','image','zh','2026-11-28 12:30+08',false),
 ('reels_week','22_wb7988d','video','zh','2026-11-22 20:30+08',false),
 ('reels_week','23_vqn8730','video','ms','2026-11-23 12:30+08',false),
 ('reels_week','24_vhm9399','video','en','2026-11-24 20:30+08',false),
 ('reels_week','25_bpn177','video','zh','2026-11-25 12:30+08',false),
 ('reels_week','26_xx2988','video','ms','2026-11-26 20:30+08',false),
 ('reels_week','27_wc7649y','video','en','2026-11-27 12:30+08',false),
 ('reels_week','28_jrx8921','video','zh','2026-11-28 20:30+08',false),
 ('tracking_qa','e2_tracking_smoke','test','en',null,true);

-- Intentionally anonymous: validates a bounded allowlist and writes only new
-- opaque visits. No customer lookup, read API, or caller-supplied event time.
create function e2_campaign_private.record_visit(request_id uuid,visitor uuid,campaign text,content text,landing_path text,consent_version text)
returns uuid language plpgsql security definer set search_path='' as $$
declare result uuid; req alias for $1; vid alias for $2; camp alias for $3; item alias for $4; path alias for $5; consent alias for $6;
begin
 if req is null or vid is null or camp is null or item is null or path is null or consent is distinct from '2026-11-20'
 or length(path)>200 or path !~ '^/(ms/|zh/)?(cars/[a-z0-9-]+/|used-cars/[a-z0-9-]+/|(showroom|customer|index)\.html)$'
 or not exists(select 1 from e2_campaign_private.campaigns c where c.campaign=camp and c.content=item) then return null; end if;
 perform pg_advisory_xact_lock(hashtext('e2-campaign-visits-'||current_date::text));
 select v.token into result from e2_campaign_private.visits v where v.id=req and v.visitor_id=vid and v.campaign=camp and v.content=item;
 if result is not null then return result; end if;
 if exists(select 1 from e2_campaign_private.visits v where v.id=req)
 or (select count(*) from e2_campaign_private.visits v where v.created_at>=current_date)>=20000
 or (select count(*) from e2_campaign_private.visits v where v.visitor_id=vid and v.created_at>=current_date)>=100 then return null; end if;
 insert into e2_campaign_private.visits(id,visitor_id,campaign,content,landing_path,consent_version)
 values(req,vid,camp,item,path,consent) returning token into result;
 return result;
end $$;
revoke all on function e2_campaign_private.record_visit(uuid,uuid,text,text,text,text) from public;
grant usage on schema e2_campaign_private to anon,authenticated;
grant execute on function e2_campaign_private.record_visit(uuid,uuid,text,text,text,text) to anon,authenticated;
create function public.e2_record_campaign_visit(request_id uuid,visitor uuid,campaign text,content text,landing_path text,consent_version text)
returns uuid language sql security invoker set search_path='' as $$
 select e2_campaign_private.record_visit(request_id,visitor,campaign,content,landing_path,consent_version);
$$;
revoke all on function public.e2_record_campaign_visit(uuid,uuid,text,text,text,text) from public;
grant execute on function public.e2_record_campaign_visit(uuid,uuid,text,text,text,text) to anon,authenticated;

-- Auth server controls the new identity and email_confirmed_at. Metadata is
-- only an attribution hint, never authorization. Freeze attribution on INSERT:
-- later metadata edits/login/email changes cannot create or reattribute a signup.
create function e2_campaign_private.capture_registration() returns trigger
language plpgsql security definer set search_path='' as $$
declare linked uuid;
begin
 if TG_OP='INSERT' then
  if new.raw_user_meta_data->>'e2_customer_signup' is distinct from 'true' then return new; end if;
  if coalesce(new.raw_user_meta_data->>'e2_campaign_token','') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then
   select v.id into linked from e2_campaign_private.visits v
   where v.token=(new.raw_user_meta_data->>'e2_campaign_token')::uuid and v.created_at>=now()-interval '30 days' and v.created_at<=now();
  end if;
  insert into e2_campaign_private.registrations(user_id,visit_id,started_at,confirmed_at)
  values(new.id,linked,now(),new.email_confirmed_at) on conflict(user_id) do nothing;
 elsif old.email_confirmed_at is null and new.email_confirmed_at is not null then
  update e2_campaign_private.registrations set confirmed_at=new.email_confirmed_at where user_id=new.id and confirmed_at is null;
 end if;
 return new;
exception when others then
 -- Analytics must never break account creation or email verification. No PII.
 raise warning 'E2 campaign registration capture failed: %',SQLSTATE;
 return new;
end $$;
revoke all on function e2_campaign_private.capture_registration() from public,anon,authenticated;
create trigger e2_campaign_registration after insert or update of email_confirmed_at on auth.users
for each row execute function e2_campaign_private.capture_registration();

create function public.e2_campaign_report(from_at timestamptz,until_at timestamptz,include_test boolean default false)
returns table(campaign text,content text,format text,language text,scheduled_at timestamptz,visits bigint,browsers bigint,registrations_started bigint,registrations_confirmed bigint)
language plpgsql security definer set search_path='' as $$
begin
 if auth.uid() is null or not public.e2_is_admin() then raise exception 'Admin required' using errcode='42501'; end if;
 if from_at is null or until_at is null or until_at<=from_at or until_at-from_at>interval '100 days' then raise exception 'Invalid report window'; end if;
 return query select c.campaign,c.content,c.format,c.language,c.scheduled_at,
 count(distinct v.id),count(distinct v.visitor_id),count(r.user_id) filter(where r.started_at<until_at),count(r.user_id) filter(where r.confirmed_at<until_at)
 from e2_campaign_private.campaigns c left join e2_campaign_private.visits v on (v.campaign,v.content)=(c.campaign,c.content) and v.created_at>=from_at and v.created_at<until_at
 left join e2_campaign_private.registrations r on r.visit_id=v.id
 where include_test or not c.is_test group by c.campaign,c.content,c.format,c.language,c.scheduled_at order by c.scheduled_at,c.content;
end $$;
revoke all on function public.e2_campaign_report(timestamptz,timestamptz,boolean) from public,anon;
grant execute on function public.e2_campaign_report(timestamptz,timestamptz,boolean) to authenticated;
