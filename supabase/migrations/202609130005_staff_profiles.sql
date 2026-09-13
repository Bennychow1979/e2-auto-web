begin;
create function public.e2_profile_active(target text) returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.staff_memberships where user_id::text=target and active and role in ('super_admin','admin','sales','account'));
$$;
create function public.e2_profile_editor(target text) returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.staff_memberships actor join public.staff_memberships subject on subject.user_id::text=target where actor.user_id=auth.uid() and actor.active and actor.role in ('super_admin','admin','sales','account') and subject.role in ('super_admin','admin','sales','account') and (actor.role='super_admin' or (actor.user_id=subject.user_id and subject.active)));
$$;
revoke all on function public.e2_profile_active(text),public.e2_profile_editor(text) from public;
grant execute on function public.e2_profile_active(text),public.e2_profile_editor(text) to anon,authenticated;
create table public.staff_profiles(
 user_id uuid primary key references public.staff_memberships(user_id) on delete cascade,
 display_name text not null check(length(trim(display_name)) between 1 and 80),
 position text not null default '' check(length(position)<=80),
 whatsapp text not null default '' check(whatsapp='' or whatsapp ~ '^[1-9][0-9]{7,14}$'),
 languages text not null default '' check(length(languages)<=160),
 bio text not null default '' check(length(bio)<=600),
 photo_path text,
 is_public boolean not null default false,
 revision bigint not null default 1,
 updated_at timestamptz not null default now(),
 check(photo_path is null or (split_part(photo_path,'/',1)=user_id::text and photo_path ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}\.webp$'))
);
alter table public.staff_profiles enable row level security;
revoke all on public.staff_profiles from anon,authenticated;
grant select on public.staff_profiles to anon,authenticated;
create policy profile_read on public.staff_profiles for select to anon,authenticated using (public.e2_profile_editor(user_id::text) or (is_public and public.e2_profile_active(user_id::text)));
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types) values('staff-photos','staff-photos',false,1048576,array['image/webp']);
create policy staff_photo_read on storage.objects for select to anon,authenticated using(bucket_id='staff-photos' and (public.e2_profile_editor(split_part(name,'/',1)) or exists(select 1 from public.staff_profiles p where p.photo_path=name and p.is_public and public.e2_profile_active(p.user_id::text))));
create policy staff_photo_upload on storage.objects for insert to authenticated with check(bucket_id='staff-photos' and name ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}\.webp$' and public.e2_profile_editor(split_part(name,'/',1)));
create policy staff_photo_delete on storage.objects for delete to authenticated using(bucket_id='staff-photos' and public.e2_profile_editor(split_part(name,'/',1)) and not exists(select 1 from public.staff_profiles p where p.photo_path=name));
create function public.e2_save_profile(target uuid,details jsonb,expected_revision bigint) returns public.staff_profiles language plpgsql security definer set search_path='' as $$
declare prior public.staff_profiles; saved public.staff_profiles; photo text;
begin
 perform pg_advisory_xact_lock(hashtextextended(target::text,5));
 if not public.e2_profile_editor(target::text) then raise exception 'You cannot edit this staff profile'; end if;
 select * into prior from public.staff_profiles where user_id=target for update;
 if expected_revision is distinct from coalesce(prior.revision,0) then raise exception 'Profile changed in another session. Reload before saving.'; end if;
 photo=nullif(details->>'photo_path','');
 if photo is not null and (split_part(photo,'/',1)<>target::text or not exists(select 1 from storage.objects where bucket_id='staff-photos' and name=photo)) then raise exception 'Upload this staff member''s photo before saving'; end if;
 insert into public.staff_profiles(user_id,display_name,position,whatsapp,languages,bio,photo_path)
 values(target,trim(details->>'display_name'),trim(coalesce(details->>'position','')),trim(coalesce(details->>'whatsapp','')),trim(coalesce(details->>'languages','')),trim(coalesce(details->>'bio','')),photo)
 on conflict(user_id) do update set display_name=excluded.display_name,position=excluded.position,whatsapp=excluded.whatsapp,languages=excluded.languages,bio=excluded.bio,photo_path=excluded.photo_path,is_public=false,revision=staff_profiles.revision+1,updated_at=now()
 returning * into saved;
 insert into public.staff_access_audit(actor,target_user,action) values(auth.uid(),target,'SAVE_PROFILE');
 return saved;
end; $$;
create function public.e2_publish_profile(target uuid,visible boolean,expected_revision bigint) returns public.staff_profiles language plpgsql security definer set search_path='' as $$
declare prior public.staff_profiles; saved public.staff_profiles;
begin
 perform pg_advisory_xact_lock(hashtextextended(target::text,5));
 if not public.e2_is_super_admin() then raise exception 'Only Super Admin can publish staff profiles'; end if;
 select * into prior from public.staff_profiles where user_id=target for update;
 if not found then raise exception 'Save the profile first'; end if;
 if expected_revision is distinct from prior.revision then raise exception 'Profile changed in another session. Reload before publishing.'; end if;
 if visible is null then raise exception 'Choose a visibility'; end if;
 if visible and (not public.e2_profile_active(target::text) or prior.whatsapp='') then raise exception 'An active staff account and WhatsApp number are required to publish'; end if;
 update public.staff_profiles set is_public=visible,revision=revision+1,updated_at=now() where user_id=target returning * into saved;
 insert into public.staff_access_audit(actor,target_user,action) values(auth.uid(),target,case when visible then 'PUBLISH_PROFILE' else 'HIDE_PROFILE' end);
 return saved;
end; $$;
revoke all on function public.e2_save_profile(uuid,jsonb,bigint),public.e2_publish_profile(uuid,boolean,bigint) from public;
grant execute on function public.e2_save_profile(uuid,jsonb,bigint),public.e2_publish_profile(uuid,boolean,bigint) to authenticated;
commit;

