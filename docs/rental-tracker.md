# Rental instalment tracker

The private staff module is served at `/rental.html`. It is linked from the
Staff menus for authorized users and contains no embedded customer or contract data. The CSV supplied
by the owner is imported directly into Supabase and must never be committed,
included in a Pages artifact, cached in CI, or logged. The source ZIP also stays
outside the repository.

## Access

The owner's final requirement replaces the supplied shared access-code design.
Use the existing E2 staff login. An active Super Admin has access automatically.
An active Admin or Office Admin must additionally have an enabled `rental_access`
grant. All other roles, inactive staff, anonymous visitors and ungranted staff
are denied. No grants are seeded for Admin or Office Admin accounts.

From the rental page, Super Admin opens **权限管理 / Access**, then grants or
revokes an individual eligible account. Existing accounts can first be managed
through the existing Users & permissions page. This module does not invite users
or change their staff role. Sharing the page URL alone grants no data access.

RLS protects contract/settings reads and the invoker reporting view. Mutations
are restricted to checked RPCs; authenticated clients cannot write tables directly.
The grant RPC rechecks active Super Admin membership. Revocation, disabling or
demoting a user affects the next database request even with an existing JWT.
The client also checks permission on refresh, clears private rows/drawers on
sign-out or denial, and rechecks at least every 15 seconds while open. Previously
downloaded/copied data cannot be revoked.

## Data and compatibility

All new database objects use `rental_` names. Existing `staff_memberships`,
`auth.users`, `auth.uid()` and `e2_is_super_admin()` are referenced, not altered.
The page shares the existing `e2-staff-auth` session on its staff-only route;
public pages still do not inherit staff sessions. No service-role key or access
code appears in frontend code.

Security advisors flag the access table's intentional lack of direct-read
policies and the authenticated SECURITY DEFINER RPCs. The access table has no
client table grants; its checked RPCs require active Super Admin membership.
The other privileged RPCs check `rental_ok()` before any business access, use an
empty search path and schema-qualified references, and are not executable by
anonymous callers. These are intentional boundaries, not unchecked public RPCs.

The supplied JSON document structure is retained. Generated reporting columns
use an immutable ISO-date parser; settings include the fields used by auditing.
Audit records capture the authenticated UUID and before/after values on the
server, including grant changes. A displayed name or request header is not used
as proof of identity. Historical source notes remain source data.

Contract and settings saves require an expected revision. Stale edits fail
instead of replacing another user's payment or handover array. The UI uses
Malaysia calendar dates and UTC date-only month arithmetic, avoiding a one-day
shift at local midnight. CSV exports escape formula-like text. Financier rules,
account destinations, agents and partner contacts are private settings, not
hardcoded into public JavaScript.

Realtime uses the authenticated staff JWT with table RLS. A 15-second authenticated
refresh covers dropped connections and permission changes. No auth schema or
project-wide Realtime setting is modified.

## Deployment and verification

Apply `20261115180050_rental_staff_tracker.sql` to the intended E2 project after
schema review. The migration intentionally fails on conflicting existing tables.
Import the approved source via client-side parsed CSV into `rental_contracts`
(`id`, `data` only), in one transaction that refuses a nonempty destination.
Populate private `rental_settings/lists` with the supplied settings. Never import
generated columns and never execute server-side file reads or shell commands.
Verify source row count, unique IDs and exact JSON equality after import.

Run `node supabase/tests/rental.mjs` and `node tests/rental-browser.mjs`.
These cover unauthorized roles, explicit grants, revocation, audit identity,
settings writes, date handling, stale-payment rejection, desktop/mobile layout
and clearing private UI. Browser fixtures are synthetic and block external URLs.
After deployment, verify anonymous REST reads and writes are denied and no
private data or source CSV exists in the public page. Real staff acceptance uses
the owner's own login; never retrieve or copy their browser session token.

For rollback, unpublish the page and revoke grants. Preserve contract and audit
tables; do not delete imported records as a routine rollback step. Existing
encrypted whole-database backups include the rental tables.

## Super Admin activity viewer

`/rental-audit.html` is linked from the rental page and Staff menus. The Super Admin
Dashboard, Admin vehicle workspace and Office Admin intake workspace all expose
the rental link only when `rental_ok()` succeeds. The audit link additionally
requires active Super Admin. Menu visibility is not the security boundary.

The read-only `rental_audit_list_v2` (and retained v1 `rental_audit_list`) and `rental_audit_detail` RPCs independently
require `auth.uid()` and active Super Admin on every call. Neither grants direct
access to `auth.users`. The SECURITY DEFINER join is needed only to resolve the
actor UUID to its Portal profile display name, falling back to email; anonymous execution is revoked. Admin
and Office Admin cannot read audit data even with a rental grant. No client can
edit or delete audit records. No changes to contract or payment data are needed
for this feature.

The list uses a bounded 20-record page, descending identity cursor and optional
plate search. Snapshots load only when opening one record. The view shows MYT,
vehicle plate, actor display name (email fallback; retained UUID if unavailable), and
field-level before/after changes including payment and handover arrays. System
or import actions without an authenticated actor are explicitly labelled.
Historical import records do not establish who originally edited the source CSV.
Array comparisons use item position; an insertion/reorder can show multiple
changed fields. All source text is rendered as text, never interpreted as HTML.

Sign-out clears list and detail immediately; role checks on focus and every
15 seconds clear the viewer when access is lost. Already viewed or copied
information cannot be recalled. No snapshots are stored in browser storage.
Tests use synthetic records for unauthorized roles, inactive Super Admin,
pagination, filtering, before/after payments, XSS text, mobile layout and
late responses after sign-out.

## Actor display names

`rental_identity()` returns only the current authorized rental user's ID and
trimmed `staff_profiles.display_name`, falling back to the account email.
The rental page uses this label for new payment, handover and history entries.
Existing business JSON is not rewritten. Names refresh during access checks.

`rental_audit.actor` remains the authenticated UUID. The database trigger stores
an additional `actor_display_name` snapshot for new actions, resolving the name
from the authenticated account itself. Client `x-actor` headers are not trusted.
A later profile rename does not change that snapshot. Historical rows without a
snapshot resolve the current profile name, then email. System/import entries
without an account retain their explicit system label. Display names need not be
unique; the retained UUID remains the authoritative identity.

Apply `20261116033047_rental_profile_actor_names.sql` before publishing the new
frontend. The old audit list RPC remains available for cached clients. This
migration does not rewrite contracts, payments or historical audit rows.
