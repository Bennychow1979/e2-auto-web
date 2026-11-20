begin;
-- Extend the existing profile-only role checks. Preserve the owner/Super Admin
-- boundary, RLS policies, RPC revision checks and existing function grants.
-- This does not create profiles, publish them or change staff memberships.
create or replace function public.e2_profile_active(target text)
returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.staff_memberships
 where user_id::text=target and active
 and role in ('super_admin','admin','office_admin','sales','account'));
$$;

create or replace function public.e2_profile_editor(target text)
returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.staff_memberships actor
 join public.staff_memberships subject on subject.user_id::text=target
 where actor.user_id=auth.uid() and actor.active
 and actor.role in ('super_admin','admin','office_admin','sales','account')
 and subject.role in ('super_admin','admin','office_admin','sales','account')
 and (actor.role='super_admin' or (actor.user_id=subject.user_id and subject.active)));
$$;
commit;
