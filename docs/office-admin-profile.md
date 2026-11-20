# Office Admin profiles and navigation

Office Admin was introduced after the original staff-profile allowlists. The
profile editor, database checks and Users screen omitted the role, and the loan
page explicitly hid its profile link. Portal correctly routed Office Admin to
customer intake, but that destination had no link to their profile.

Active Office Admin staff can now create and edit their own staff profile using
the existing revision-checked, audited RPC and private portrait storage. Super
Admin can select their profile from Users or the profile picker. Saving keeps
the profile private; only Super Admin can publish it. No account roles, names,
photos, case assignments or existing profiles are created or changed by the
migration. Employees enter their own details on first use.

Customer intake remains their landing workspace. Its navigation links to
registered applications and My Profile, and the profile sidebar returns to the
office workspace. Registered applications and financing-case pages provide the
same navigation. Inventory and user administration access remain unchanged.

Frontend profile eligibility is shared between the profile and Users screens in
`staffProfileRoles`. The database migration extends only the existing profile
checks. Office Admin RLS tests cover private reads, portraits, cross-user writes,
stale revisions, deactivation, explicit publication and unchanged business access.
Browser tests cover first save, reload, portrait upload, retry, navigation and
Super Admin editing on desktop and mobile.

Deploy `20261120044221_office_admin_profiles.sql` before publishing the frontend.
Verify the two affected accounts can edit their own profile but not another
employee's, and still have no inventory-management or user-administration powers.
The configurable per-user permission design is a separate future change.
