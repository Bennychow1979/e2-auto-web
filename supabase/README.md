# E2 inventory connection

## Status

The production entry points are `index.html`, `portal.html`, `showroom.html` and `car.html?id=<stable UUID>`.
The connected showroom is now the root homepage. The previous homepage is preserved as `homepage-before-domain.html`; the design demos remain separate from the live database.
On 2026-09-13 the owner connected E2 WEB Project (`gkppiuuwsecojcnvkzjl`, Singapore, Free plan).
The initial migration was applied through SQL Editor to an empty public schema. All four business tables have RLS enabled; `vehicle-photos` is private with the expected 3 MB WebP limit.
The owner created the first confirmed Auth user and that verified user was assigned active Admin membership. Public sign-up and anonymous sign-in are disabled. The Site URL is `https://e2auto.my/portal.html`. The redirect allowlist contains this exact URL and the previous GitHub Pages portal URL for the domain transition.
The browser now uses the project's publishable key. GitHub Pages deployment `14a24c75e46feaf25e9459878c032a3549c994fa` succeeded and the public showroom successfully queried the hosted database.
JMK882 has been created as a private draft using the supplied details, with 750,000 km explicitly unconfirmed. It has no vehicle photos yet and is not published.
The owner has signed in and uploaded/published Ford Ranger ALQ1667; the live portal shows its saved photos and published status. Unpublish verification remains pending. Production password-reset email delivery is also not yet verified.

## Connect the owner's project

1. In the **E2 WEB Project** Supabase dashboard, inspect existing public tables and buckets first. Apply `migrations/202609120001_inventory.sql` once using SQL Editor. It is transactional and intentionally does not overwrite existing tables. For later schema changes, add a new migration instead of re-running this file.
2. In Project Settings / API Keys, obtain the **publishable** key (`sb_publishable_…`) and Project URL. Set only those two public values in `e2-config.js`. Never use secret keys, service_role keys, database passwords or management access tokens in browser code, GitHub or chat.
3. Under Authentication / URL Configuration set the Site URL to `https://e2auto.my/portal.html` and add that exact URL to the allowed redirect list. Do not use broad wildcard redirects. Configure a production email provider before relying on password-reset mail; Supabase's default email delivery has testing restrictions.
4. Disable public sign-up for this staff-only phase. Create the owner's E2 Auth account in Authentication / Users. The owner enters and keeps the password. This is separate from signing into the Supabase dashboard with GitHub.
5. Assign the first Admin to the verified Auth user ID through SQL Editor, replacing the placeholder below. Never derive Admin access from browser data or user-editable Auth metadata.

```sql
insert into public.staff_memberships(user_id,role,active)
values ('REPLACE_WITH_VERIFIED_AUTH_USER_UUID'::uuid,'admin',true);
```

6. Deploy the public configuration with the website. Sign in at `portal.html`. Add a vehicle as a draft, upload an actual photo, preview, then explicitly publish. In a signed-out browser check that the same record appears on `showroom.html` and `car.html?id=…`. Reload to verify persistence. Move the vehicle to draft and verify signed-out access disappears.
7. The connected showroom was promoted to `index.html` on 2026-09-13. Its previous design is preserved in `homepage-before-domain.html`. See `../DOMAIN.md` for the custom-domain rollout.

## Permissions and data boundaries

- Anon and ordinary authenticated users: published vehicle fields and attached photos only.
- Active Sales: read shared stock, including drafts; no uploads or inventory changes.
- Active Admin: create/edit drafts, upload/remove photos, select a cover, rearrange photos, publish/unpublish, read audit records.
- Account is reserved; it has no private inventory or finance access in this phase. Customer accounts/workflows are not implemented yet.
- Clients cannot grant themselves membership or edit their role. Owner-managed membership deactivation takes effect on subsequent database requests, even with an existing Auth session.
- Inventory fields are public on publication. Customer documents, identity documents, bank details and internal notes must never be stored in these tables or the vehicle-photo bucket.
- No vehicle hard-delete UI. Move a listing to draft to withdraw it, retaining the record and stable ID.
- Updating a published record requires first moving it to draft. Optimistic timestamp checks prevent ordinary simultaneous field edits from silently overwriting one another.

## Photos

Apply `migrations/202609130003_photo_limit_30.sql` after the previous migrations to increase the limit from 20 to 30 without changing existing photos, their order or storage limits. Applied to E2 WEB Project on 2026-09-13.

Private `vehicle-photos` bucket; no public bucket bypass. The Storage SELECT policy follows the published vehicle relationship, with staff read access where permitted. The browser receives signed URLs valid for five minutes. A previously issued link or downloaded/cached photo cannot be instantly recalled after unpublishing.

Input limit: 30 JPG/PNG/WebP photos per vehicle, 20 MB each. Browser conversion produces WebP up to 1920 px at quality 0.84, capped at 3 MB. Original metadata is not copied to the canvas export. The database enforces the 30 slots; the bucket enforces MIME and byte limits. Set-cover and photo reordering are Admin-only database functions, serialized with publication. Apply `migrations/202609130002_photo_order.sql` after the initial migration; it was applied to E2 WEB Project on 2026-09-13. Drag a photo with a mouse, or drag its handle with touch/pen, to any position. Edge scrolling supports long galleries; Escape or a cancelled pointer restores the starting order. Earlier / Later buttons remain available for keyboard use. Dropping a photo saves the complete order once on a draft, with position zero as the cover. The reorder operation validates the complete photo set and expected prior order, rejecting stale concurrent edits. Published listings must move to draft before photo changes.

Upload order is object first, then photo metadata; publication requires an attached existing object. Removal detaches metadata before deleting the stored object. Interrupted uploads or failed cleanup can leave private orphan objects; review and remove these through the Storage dashboard after confirming no `vehicle_photos.path` references them. Never delete the Storage SQL rows directly, because that does not clean up the underlying file.

This first production slice supports photos. Video remains in the preserved design demo; production video upload requires its own byte limits, resumable upload flow and storage/egress review.

## Validation

Local PostgreSQL-compatible tests exercise anonymous / Admin / Sales / Account / ordinary user / revoked Admin access, photo publication rules, immutable stable IDs, mileage validation and cover permissions. Storage API delivery and real Auth/email behaviour must still be checked against the hosted project.

Local browser checks use an isolated test adapter, never shipped to GitHub Pages, to exercise form/save/upload/publish/showroom/detail/unpublish. They do not prove real authentication or hosted persistence.

Before enabling actual staff, verify: failed login, sign-out, session restore, owner password reset, role revocation, direct API rejection for unauthorized writes, anonymous draft/photo isolation, publish visibility, unpublish visibility, cover change, upload failure and retry, duplicate plate rejection, zero/unknown/unconfirmed mileage, phone layout, and the owner-approved first real listing.

For production operation, choose a backup plan for **both database and Storage files**, test restoration, configure email delivery, review account recovery/MFA options and monitor storage/egress. Supabase database backups alone do not contain the photo file contents.

## Users and permissions

Migration `202609130004_super_admin.sql` was applied to E2 WEB Project on 2026-09-13. It adds Super Admin user management without elevating any account automatically. Owner elevation remains a separate reviewed operation.

`team.html` requires an active Super Admin and lists only server-authorized membership data. Super Admin can invite users, attach existing Auth accounts, change roles and deactivate access. Admin retains full inventory management; Salesman has shared inventory read access. Account and Customer currently see published stock only; accounting and customer workflows are not implemented yet. Inactive memberships lose private data access on subsequent requests.

Role changes are serialized, revision checked and audited. Direct client writes to memberships remain forbidden. The final active Super Admin cannot be removed, and changing one's own role requires another Super Admin.

Deploy `functions/e2-invite-user/index.ts` as `e2-invite-user`. This function was deployed on 2026-09-13 with legacy JWT verification enabled. It verifies the caller with Auth and an active Super Admin database check on every request. Service credentials stay in the function's managed environment. Invitation attempts are limited to 20 per hour per Super Admin. Successful email delivery is followed by a role-assignment RPC that rechecks the caller and refuses to overwrite existing membership; if assignment fails, use Add existing E2 account after reviewing the user list.

The SMTP sender is `e2autosdnbhd@gmail.com`; its App Password is managed only in the Supabase dashboard and must never be stored here. The owner saved SMTP settings on 2026-09-13. Add the exact Auth redirect `https://e2auto.my/accept-invite.html` (configured). Recipients set their own password on that page. No production invitation email has yet been sent or delivery verified. The handler's `status` action validates endpoint access without sending email; verify this using a real Super Admin session before first invitation.

`npm test` includes 47 inventory checks with the new migration, 40 staff permission checks and 10 mock invitation-handler checks. Local browser fixtures verified default Salesman role, protected own account, role editing, invitation failure messaging and phone layout. Mock checks do not establish hosted email delivery.

## Official references

- https://supabase.com/docs/guides/database/postgres/row-level-security
- https://supabase.com/docs/guides/storage/security/access-control
- https://supabase.com/docs/guides/getting-started/api-keys
- https://supabase.com/docs/reference/javascript/auth-signinwithpassword
- https://supabase.com/docs/reference/javascript/auth-resetpasswordforemail
