# Financing case workflow: review build

This branch is a development-only, first-version implementation. It has not been
merged, deployed, or applied to the production database. No staff accounts,
permissions for real people, real lender applications, or emails were created.

## Existing features reused

- Customer uploads remain in the existing private `loan-documents` and
  `intake-documents` buckets. The shared authenticated PDF/image preview and
  original-byte download remain in use; there are no public document URLs.
- `office_admin` is the existing limited Submission Admin role. It cannot edit
  vehicle inventory or administer users. The existing `admin` role is broader;
  selecting it as a case owner does not turn it into a limited role.
- Staff open a submitted case from Customer intake or Registered applications.
  Starting case tracking is explicit. Original submitted customer answers remain
  read-only for staff. Customer drafts are not imported or exposed.

## First-version flow

1. The assigned Salesman starts tracking, checks customer details and required
   files, and records missing items or a completed review. Missing items are
   internal records, not automatically delivered customer messages.
2. A complete review requires the customer type, vehicle, required ready files,
   statement coverage, and explicit human details/document checks. Counts do not
   establish authenticity, legibility, or lender acceptance.
3. The Salesman explicitly hands the complete case to the receiving coordinator.
   The coordinator then assigns or reassigns the Submission Admin. The workspace
   displays Salesman, coordinator and Admin separately. Registered loans retain
   their original Salesman assignment. Coordination alone does not allow lender
   submission; those actions require being the assigned case Admin.
4. The case Admin creates independent applications for configured banks or
   credit companies. Each records its assignee, channel, attachments, missing
   items, reviewed preparation, actual submission date/reference/evidence,
   lender-reported outcome and offer amount/rate/tenure.
5. Portal: download the necessary documents, sign in and submit manually on the
   configured HTTPS lender website, then record the actual result in E2.
6. Email: review the snapshotted recipient, message and attachment checklist.
   Copy into an approved email tool, manually attach the selected files and send
   there. Only after verifying the sent message should staff explicitly record
   successful human sending, its reference and time in E2. Preparing/reviewing a
   draft never means submitted. There is no mailto shortcut or automatic send.
7. Record each lender's actual response independently. One rejection does not
   reject the whole case. An approved offer requires amount, annual rate and
   tenure; staff document the rate basis and conditions in the response note.
8. Record the customer's explicit chosen approved offer and how/when the choice
   was confirmed. This is a record of instruction, not acceptance of a lender
   contract, credit decision or disbursement.

## Access and consistency

The new tables use RLS and RPC-only writes. Active assigned Salesman, a configured global loan coordinator, handed-over
case Admin and Super Admin can read the case. The coordinator capability reads
all submitted guest and registered sources/cases, their ready private files and
history, across Salesmen and receiving coordinators. Unsubmitted customer drafts
and preparing guest entries remain private. Other Salesmen/Admins, Account,
customers and anonymous callers cannot read internal lender applications. An
application assignee is a tracking label and does not itself grant case access.
Deactivation is checked on subsequent database requests.

Existing generic handoff/status RPCs reject tracked cases so they cannot bypass
completeness checks or actual-submission evidence. Untracked cases keep their
legacy behavior. Old registered loans assigned directly to Office Admin require
Super Admin to identify/reassign their Salesman before starting tracking; this
migration does not guess or silently change a person's role.

## Confirmed staffing requirement

The owner confirmed on 2026-10-08:

- Ada (formal name EDDA) can view all submitted loan cases and assign/reassign
  their Submission Admin after the Salesman completeness check and handover.
  EDDA and Ada identify the same person; use Ada in prose and the reviewed UI
  display-name setup, while preserving EDDA as the formal identity mapping.
- TONG EN and Jean are the Admin staff responsible for loan submission/follow-up.

These are setup requirements, not authorization identities. No account IDs or
emails have been inferred, and no account was created or changed. Super Admin
must verify each actual account and obtain production access-change approval.
Use the existing limited `office_admin` membership for submission staff. Enable
the separate dispatcher capability only for the verified coordinator account;
it does not confer inventory or user-administration power. The dispatcher
configuration table is empty in this migration. Do not hardcode display names
in authorization. This capability is deliberately global within submitted loan
cases, including guest and registered sources before handover. It is independent
of a case’s recorded receiving coordinator. Assignment/reassignment still waits
for Salesman handover, and submission requires the separate case Admin assignment.
A configured coordinator keeps global read/routing access after assigning an
Admin; a revoked or deactivated coordinator loses that capability on subsequent
requests. It grants no inventory editing, staff management or customer-draft access. Reassignment removes the
previous Admin's assigned-case access, unless that person separately qualifies
as a global loan coordinator or Super Admin. Their historical assignee label alone grants
no access.

## Owner-provided institution list · configuration pending

The owner supplied these 13 display names on 2026-10-08 and then clarified that
the first institution is AEON Credit:

1. AEON Credit
2. Chailease Credit
3. GFS Credit
4. X Star Credit
5. Carsome Credit
6. FS Credit
7. Elk Credit
8. Maybank
9. Public Bank
10. AmBank
11. CIMB Bank
12. HLB Bank
13. Bank Muamalat

`config/finance-institutions.draft.json` is a separate, disabled review checklist.
It is not loaded by the application or inserted by the migration. All records
have `active: false`; institution type, submission channels, recipient, portal
URL and required-document list remain unset. The owner explicitly chose to leave
all submission channels pending confirmation; do not default to portal or email.
An unknown document list is stored
as null, not an empty list that could imply no requirements.

Do not guess portal/email routing from an institution's name, and do not expand
FS Credit or Elk Credit into an assumed corporate identity. Verify each actual
institution and its accepted channels/destinations with the owner or the
institution. The named draft is not directly importable into the RPC: review
its type and required fields first. Keep records disabled until configuration
and any production activation are separately approved. No real lender requests
were made; all workflow tests still use synthetic cases and institution data.

## Concurrency and history

Expected revisions prevent ordinary stale writes. Customer source/document
changes invalidate the Salesman and unsent application reviews. The server
validates that selected attachments belong to the same case and are ready in
private Storage. Submitted channel/content/destination and confirmation history
are retained rather than silently replaced. Customer selection checks the
expected offer version so changed terms must be reviewed again.

Super Admin configures institution name, bank/credit type, active state, verified
HTTPS portal, verified single email recipient and document requirements. No real
bank, credit-company URL or email recipient is seeded. Changed institution
configuration requires unsent applications to be refreshed and re-reviewed.

The browser keeps case data and downloaded files in memory. It clears sensitive
content and preview resources on sign-out/account change/navigation; pending
responses cannot repopulate an invalidated view. No customer form or financial
file content is stored in localStorage or sessionStorage by this feature.

## Important limits to review

- Guest intake has no supported same-case supplemental upload after submission.
  Its original invitation cannot reopen submitted details or files, and this
  feature deliberately does not extend or recreate a guest bearer token. A
  missing-document case remains blocked for handover until a separately approved
  secure process is available. Record Salesman follow-up; do not suggest that an
  automatic correction link exists. There is no staff upload route to assume.
- Already-handed-over legacy guest cases require a separate, explicit adoption
  action by a global coordinator or Super Admin. Normal Start tracking still
  refuses automatic conversion. Adoption validates the exact source revision
  and active, eligible existing Salesman/Admin, preserves every source field and
  the current Admin, and creates a pending-review case with an audit event. The
  adopter sees current account IDs and handover time and must confirm the
  mapping. Invalid or ambiguous mappings are rejected. New lender applications
  remain blocked until a fresh Salesman review; reassignment is a separate
  explicit action. There is no automatic or bulk backfill.
- Registered customers keep their existing signed-in correction/document path
  when information is requested. No notifications are sent automatically.
- Required month coverage checks distinct months within the existing supported
  18-month upload window. Staff must verify that the correct latest months and
  lender-specific requirements are satisfied, including exceptions such as no
  driving licence/EPF. There is no waiver bypass in this version.
- The website cannot verify a lender portal result or sent mailbox itself. Its
  first-version submission evidence is an explicit authenticated human
  confirmation, clearly recorded as such. False attestations cannot be detected.
  Keep the actual sent email / portal receipt as evidence of exact contents;
  E2 retains attachment metadata and content revisions, not a duplicate immutable
  archive of every historical customer file. Destination use rechecks current
  case/application/institution revisions, but external manual action is not an
  atomic transaction with E2. Recheck the actual destination before sharing.
- Portal credentials, tokens and passwords must never be entered in E2 fields.
- No automatic lender login, third-party portal automation, email integration,
  provider OAuth, credential storage, automated follow-up/reminder delivery,
  cancellation, loan acceptance or fund transfer is implemented.
- Selected offers are locked against edits. Staff can record a new customer
  choice of another approved offer. A dedicated withdrawal/correction operation
  for the sole selected offer is not included; do not alter history directly.
- Local PostgreSQL-compatible tests and mocked browser tests cannot establish
  hosted Supabase Storage/Auth behavior or physical iPhone/Safari behavior.

## Before any actual email-send integration

This build works with staff's existing approved email tool. Sending directly
from E2 would need separate approval and design, including:

- A verified E2 sending identity and authorized sending account/provider; do not
  assume the Auth invitation SMTP configuration is approved for lender emails.
- Approved institution recipients and customer authority to share the particular
  documents. Verify sender-domain ownership, SPF/DKIM/DMARC where applicable.
- Server-only secrets or an explicitly approved OAuth grant. Never put secret
  keys, SMTP passwords or provider tokens in browser files or Git.
- A server-side attachment fetch scoped to the case, per-send review, an immutable
  recipient/content/attachment snapshot, idempotency keys and retry-safe sends.
- Provider-confirmed acceptance/message IDs and robust failed/uncertain states;
  distinguish provider acceptance, delivery and lender receipt/acknowledgement.
- Bounce handling, audit retention, attachment size limits and operational
  monitoring. None of these is activated by applying this review build.

## Local validation

Use Node 22.13+ or 24+. All fixtures are synthetic.

```sh
npm ci --ignore-scripts
npm run check
npm test
PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/usr/bin/chromium npm run test:browser -- --workers=2
```

The new database suite is `supabase/tests/case-submissions.cjs`; the pure helper
suite is `supabase/tests/financing-core.mjs`; the new browser suite is
`tests/financing-case.spec.mjs`. Existing document-preview tests are also required.
Browser tests intercept the data module and deny third-party requests. Do not use
production customer financial documents as test inputs.

## Approval and release checklist

1. Review the Chinese workflow PDF separately from this code and resolve any
   requested product changes. Confirm the first-version guest-upload limitation,
   application-assignee semantics, date/rate conventions and correction needs.
2. Review SQL/RLS and test evidence. Confirm the existing `office_admin` role and separate dispatcher capability
   match Ada (EDDA) / TONG EN / Jean responsibilities after account identity verification. Applying this migration adds a configurable global submitted-case read/routing
   capability plus case-specific Submission Admin access. No coordinator is
   enabled automatically; production activation and every real capability or
   staff-role change require separate approval.
3. Before publishing, get approval for remote branch/draft PR. Before merging or
   deployment, get separate release approval. A merge/push to main automatically
   deploys GitHub Pages; this local commit does not authorize that action.
4. Inspect actual production migration history and schema. Back up database and
   Storage separately. Do not rerun historical migrations. Apply only the new
   migration in a reviewed staging environment, then run real Auth/Storage smoke
   tests using synthetic accounts/files under separately approved access.
5. Verify Super Admin, assigned/unassigned Salesman, assigned/unassigned Office
   Admin, global/revoked/deactivated coordinator, Account, customer, anonymous and deactivated staff. Test direct RPC,
   table and Storage attempts, cross-case IDs and attachments, concurrent edits,
   changed document reviews, global coordinator cross-Salesman/source visibility,
   coordinator assignment/reassignment and old-Admin access
   revocation, recipient corrections, stale offer selection and
   failure/retry. Check real Storage metadata/schema and read/download behavior.
6. Only after explicit production migration approval, apply
   `supabase/migrations/202610080001_case_submissions.sql` once. No real role
   assignments, customer data imports, real recipients or applications belong in
   the migration. Coordinate frontend release after database verification.
7. Review the 13 owner-provided names in the disabled configuration draft.
   Confirm each institution type, portal/email channel, exact verified URL or
   recipient and required documents; do not assume an unset field is optional.
   Configure verified institutions through Super Admin under the approved process.
   Only after separate account/permission approval, map the verified Ada / EDDA account to the
   dispatcher capability and verified TONG EN/Jean to limited Office Admin
   membership. Do not use names as identifiers. Verify live entry links and
   authorized case visibility with synthetic data.
   Test Chrome and a physical iPhone/Safari, including preview/download and
   account switching. Remove or retain synthetic records under the agreed policy.
8. On a problem, disable the new entry links/revert the frontend and investigate.
   Do not drop the new tables or rewrite submitted histories to roll back. Review
   a data-preserving migration or restore plan before changing production state.

## Initial local validation record · 2026-10-08

This checkpoint predates the owner-confirmed global coordinator change. The
latest draft PR checks are authoritative for the final branch head.

- `npm run check`: passed against the final local code.
- `npm test`: passed, including all existing suites, the helper/adapter checks,
  and 194 new synthetic database workflow/security checks. The complete command
  reported 880 PASS lines.
- Browser collection: 152 cases total, comprising 72 existing document-preview
  cases and 80 new financing cases across desktop/mobile Chromium.
- Browser execution: not verified. Chromium aborted before test bodies while
  creating its process singleton socket (`Operation not permitted`), including
  the elevated retry. Final browser scenarios parse/collect and fixture smoke
  checks pass, but no browser assertions or screenshots are claimed as passed.
- No production Auth, Storage, database migration, staff capability grant,
  institution configuration, application submission or email was tested/changed.
- Publishing a branch/draft PR to run browser CI requires separate approval;
  merging, deployment and production migration remain separate approvals.

The institution-list-only follow-up adds a disabled JSON review draft and this
setup guidance. The 13 unique names and unset routing/contact/requirements fields
were validated locally; it does not alter the tested workflow mechanics or
activate any institution.

## Global coordinator update · 2026-10-08

The owner explicitly confirmed Ada’s global submitted-case visibility and
assignment responsibility. The configurable dispatcher capability now covers
both submitted source types across Salesmen and receiving coordinators. It does
not reveal drafts, grant site administration, or allow unassigned submission.
The browser suite includes 96 financing cases (168 with existing PDF tests);
server isolation/regression checks verify the expanded scope and revocation.
The optional one-case legacy adoption path is covered by explicit action,
identity/revision validation, unchanged source data and fresh-review gates.
No actual account was enabled, and no profile was renamed.

Local validation for this update passed `npm run check` and the full `npm test`
command: 1,065 reported PASS checks, including 379 financing security/workflow
checks. All 168 browser cases parse and collect; the latest PR CI result is the
authoritative executed browser result.

## Staged static publication gate

`e2-config.js` ships with `financingCases: false`. Missing configuration also
means disabled. This permits publishing the reviewed static code before any
production database security change. While disabled:

- Existing intake/registered-loan pages do not call new finance permission RPCs.
- New financing-workspace links are hidden. Existing authentication, application
  follow-up and private-document behavior remain in place.
- Opening `financing-case.html` directly shows a disabled-state notice and links
  to the existing pages, without importing its finance/Auth data adapter.
- The new staff page uses the existing staff Auth storage key only when enabled;
  public pages keep their nonpersistent, non-staff Auth context.

This flag is a rollout switch, not an authorization boundary or a database
rollback. Real authorization remains in Auth/RLS/RPCs. Do not substitute the
flag for approving or verifying backend access. Applying the migration changes
live policies and RPC grants immediately, even with the frontend disabled.

Production migration, capability setup and feature activation require a
separate exact approval and authenticated administration route. Confirm the
actual applied migrations/dependencies, take database and Storage backups, and
run hosted synthetic Auth/Storage and concurrent-session checks first. The SQL
creates five finance tables and their policies/functions/triggers, seeds no
real accounts/cases/institutions, preserves customer draft isolation, and adds
configurable global submitted-case access plus assigned-only submission.

Dispatcher rows start empty. The receiving-coordinator handoff requires an
explicitly approved active dispatcher entry for a verified eligible account,
even when that account already has Super Admin. Do not change Ada’s existing
role or guess an Auth UUID. Verify destinations before enabling institutions.

After tracked cases exist, turning the UI off does not restore legacy mutation
RPCs for those cases. A data-preserving rollback/recovery plan is required; do
not drop audit/case data. Also check external service-role integrations: the
legacy wrappers no longer inherit their old service-role execute grants.

Only after separate backend approval/application and successful staging/hosted
checks should the explicit rollout flag be enabled in another reviewed release.
A static deployment with the flag off must be reported as code published,
financing tracking not enabled. No production SQL is applied by Pages CI.
