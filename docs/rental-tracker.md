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

## Add a rental vehicle from website stock

The add-car form offers a partial plate filter over the inventory visible to the
current staff account. It reads only `id`, `plate`, `brand`, `model`, `variant`,
`year` and `stock_status` from active `vehicles`, using the existing staff client
and inventory RLS. Office Admins retain their existing inventory visibility;
this feature does not expand access to private stock. Archived/trash vehicles
are excluded; sold/booked active vehicles remain selectable for rental tracking.

Selecting a result fills plate, brand, model plus variant, and year. It does not
copy the advertised price into a loan amount or overwrite owner/loan inputs.
Existing rental plates are disabled in the picker. Manual entry remains available
for missing/inaccessible stock or connection failures. The normal rental form
validation and `rental_save` revision checks still apply.

A selected vehicle's ID is stored as optional `stock_vehicle_id` in the existing
contract JSON. This is a source reference, not a foreign-key constraint or an
identity/authorization claim. Basic vehicle fields are a snapshot at selection;
stock changes do not rewrite existing rental records. Manually changing the plate
to another plate before saving removes the pending association.

Inventory results are scoped to the current form and auth epoch, never persisted
in browser storage. Late results after closing, changing panels or signing out
are ignored. Tests cover pagination, denied access, partial plate filtering,
autofill/save, duplicates, manual fallback, failed reads/retry and late responses.

## Plate correction (`rental_move_plate`) and handover edits (2026-11-20)

**Plate correction is a single RPC.** The plate is the record id, so a correction
is a move. `public.rental_move_plate(old_id, new_id, new_plate, expected_revision,
patch)` does the whole move inside one function call, i.e. one transaction:
takes the shared contract plate-identity lock, then locks both ids in a fixed order, checks `rental_ok()`, the old record's
revision (errcode 40001 on mismatch), that the old record is not already MOVED
and that the new id and normalized live plate are free (23505), then inserts the new row (payments,
handovers, history copied, `plate_changed_from/at`, `pay_reference` renamed when
it was the old plate, history entry with the actor from `rental_identity()`) and
updates the old row to `car_status: MOVED` with `moved_to`. Any failure rolls back
both writes, so there is never a second live record or a lost payment. `patch`
lets the admin form submit its other field edits in the same transaction; it may
not touch plate, payments, handovers, history, car_status or moved_to.
`rental_save` still refuses plate changes and now freezes MOVED rows, rejects forged
move markers, and shares the normalization check and first lock. The audit trigger
records INSERT(new) + UPDATE(old) with `auth.uid()`. Later saves have separate audits. MOVED records are hidden from every list,
count and export in the page but remain in the table and in `rental_audit`.

**Handover edits.** A non-void handover can be edited inline. Inputs are
scoped per row (`eh_<index>_<field>`), only one editor may be open at a time,
and opening an editor registers its fields as panel drafts so the 15 s refresh,
Realtime reloads and other-section saves cannot wipe it (the draft restore
re-opens the editor and refills the values). Saving goes through `rental_save`
with the record revision; the entry keeps its type and gains `edited_by`,
`edited_at` and an `edit_log` of previous values (last 10). The car's current
upfront (`actual_rent`) follows only the last non-void rent-out: editing that
entry's upfront updates the summary, editing an older entry does not. Cancel and
no-op save replace only that handover row, preserving other unsaved sections.

The migration also replaces `rental_save` with the same signature and grants; it
does not alter table structures or rewrite rows. All contract-writing RPCs take
the shared lock before row/id locks, so alias creates and moves cannot race.
This briefly serializes rental writes (settings are unaffected). Direct owner /
service-role writes are outside this RPC guarantee. Existing conflicting live
plates must be resolved before relying on the uniqueness rule.

CARSOME automatic check notes and payment references are computed once and included
in either the normal save or the move patch. Manual check notes are preserved.
Deploy the migration before publishing the versioned JS modules.
## Pending disbursement and reservations

Cars can enter stock with `pending_disbursement: true` while their account number
and first payment date are unknown. They can receive one reservation with a
positive booking deposit. The staff view labels these cars Pre-booking or
Reserved; agent stock messages group READY, PRE-BOOKING and RESERVED and omit
GPS, spare keys and booking-party details. Payment messages, including all-owner
previews, exclude pending cars. Handovers use cards that fit phone screens.

Apply `20261121063232_rental_pending_booking_guards.sql` **before** publishing
the frontend. This migration replaces the two existing RPC bodies, retaining
their signatures, permission checks, locks, revision checks and audit behavior.
It introduces an internal `SECURITY INVOKER` validator, with an empty search path
and no PUBLIC/anon/authenticated execution grant. Both RPCs invoke it on the
complete proposed contract while holding their existing locks, before writing.
There are no table changes, new public RPCs, role changes or existing-data rewrites.

The validator prevents pending contracts from carrying payments or live OUT
handovers. An explicitly tracked disbursement state cannot be dropped by a full
replacement. Completing disbursement requires a numeric account number and a
valid first payment date. Existing financier-specific frontend rules remain;
Carsome continues using its existing 82008 account and Ref-2/check-note flow.
Legacy records without the new flag retain their existing loan-data rules until
saved with the new form, so the migration does not retroactively reject all old
incomplete contracts.

Bookings require a renter, phone, valid date and positive numeric deposit.
Clearing/replacing one must append its original values with CANCELLED or CONVERTED
status to `booking_history`; existing history is append-only. Closing a contract
retains its reservation and displays it in the detail, where it can still be
cancelled explicitly. Ordinary vehicle edits never replace stored booking data
with a derived hidden-state null. Cancellation records the deposit; it does not
assert that any refund was paid.

After disbursement, rent-out prefills the reservation and a total upfront of at
least the received deposit (or the higher target upfront). Blank or lower totals
are rejected, including in later handover edits. Conversion archives the original
reservation, carries its deposit into the OUT handover, and saves the matching
total upfront. SQL guards prevent invalid conversion through either RPC; rejected
saves and plate moves leave both contracts and audit rows unchanged.

Validation: `node supabase/tests/rental.mjs` exercises real RPCs in PGlite,
including rollback, revision conflicts, invalid state transitions, deposit/history
preservation and helper ACLs. `tests/rental-pending-browser.mjs` covers the end-to-end
pending/reserve/cancel/disburse/convert flow. `tests/rental-booking-regression.mjs`
covers the four reviewed defects plus poll/conflict drafts, late logout responses,
and 320/390px cards. Both browser suites run in `npm run test:browser` with the
existing rental, stock and audit regressions.


## Payment corrections (2026-11-23)

Payment rows now offer Edit and Void to authorized rental staff on open contracts. Editing records the previous values and the actor; voiding requires a reason and keeps the original row. Active payments are renumbered after `paid_count_excel`, while voided rows retain their historical number. Counts, next-due calculations and CSV last-payment dates exclude `void: true`. Existing database audit triggers continue recording immutable before/after snapshots with the authenticated actor.

Migration `20261123131607_rental_payment_void_counts.sql` makes `rental_contracts_flat.paid_count` use the same rule without rewriting contracts, changing grants or changing `security_invoker`. Apply it before publishing the payment-correction UI.

The implementation is based on current main, preserving the pending-disbursement/booking validator, closed-contract booking evidence, deposit-inclusive conversion totals, WhatsApp preview/copy filtering and logout guards. It does not overwrite those protections with the older uploaded frontend. Payment edit and void-reason drafts are restored after saving another panel section; stale revisions cannot overwrite another person's update. Unknown legacy payment methods remain selected when editing unrelated fields. Late payment responses do not repopulate private UI or messages after logout.

Validation: `npm run check`, `node supabase/tests/rental.mjs`, `tests/rental-payment-fix-browser.mjs`, `tests/rental-payment-regression.mjs`, and the existing rental booking, pending, general, stock and audit browser suites. Tests use isolated synthetic data. `.github/workflows/rental-checks.yml` runs the database and browser suites on relevant changes.
