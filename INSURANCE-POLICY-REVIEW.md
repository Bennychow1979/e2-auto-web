# Insurance policy upload and reviewed fields

This development feature records an existing insurance policy inside a financing
case. It proposes nine labelled fields from a text PDF: insurer, policy number,
vehicle registration, insured name, sum insured, premium, NCD, inception and
expiry. An authorized staff member must compare the original, select each field,
confirm the case and save with a review note. It does not quote, buy or issue
insurance, verify policy validity, or perform LOU work.

## Release boundary

The insurance branch starts at financing PR #4 commit
`7dc46028f3998e8d6414c8e9e5a236ca077445d5` and is intended as a separate draft PR
targeting `codex/financing-admin-institutions`. It does not modify that branch or
its release. Do not merge or deploy before **2026-10-13 00:00 Asia/Kuala_Lumpur**.
Reaching that time does not approve database changes, access changes or activation.

`insurance-feature.mjs` requires both `financingCases === true` and
`insurancePolicyUpload === true` in the existing feature configuration. An absent
insurance flag is false. This change does not enable either flag, change production
configuration, apply SQL, create staff accounts or add role assignments.

## Extraction and review

- PDF.js runs in the browser using the existing, self-hosted PDF.js assets. There
  is no new dependency, OCR provider, model call or paid service.
- Suggestions require an explicit supported English or Malay label and a colon.
  This is a conservative first parser, not a general policy-layout recognizer.
  Multi-column layouts, unfamiliar labels and unsupported formats may yield no
  suggestion. Every suggestion is marked unverified; there is no accuracy score.
- Numeric dates that could mean either day/month or month/day, conflicting label
  values and unsupported money/currency formats remain blank. Money suggestions
  require RM or MYR; reviewed money values are stored as decimal text in RM.
- Text-free PDFs and JPG/PNG files retain the original and use manual field entry.
  No text is recognized from image pixels. Password-protected PDFs have no password
  entry flow; use an approved readable original instead. Encrypted PDF handling
  has not been validated with a synthetic encrypted fixture.
- Limits are 10 MB per original, 20 PDF pages, 200,000 extracted text characters,
  25 megapixels per image and a 20-second local analysis budget. File signatures
  and image decoding are checked before upload. These checks are not antivirus
  scanning and do not establish that a policy is authentic.
- Only selected, nonblank values can be saved. Replacing existing values requires
  explicit confirmation. A registration that differs from the case vehicle is
  rejected. Insured name/case ownership also needs human verification; there is
  no automatic identity match.

## Original files, access and evidence

The unapplied migration is
`supabase/migrations/202610100001_insurance_policy_review.sql`. It requires the
existing schema through `202610080001_case_submissions.sql` and
`202610090001_financing_admin_workspace.sql`.

It creates private bucket `insurance-policies` and three RLS-protected tables:
`insurance_policy_documents`, `insurance_policy_records` and
`insurance_policy_events`. Reads reuse `e2_finance_case_access`; writes reuse the
existing case lock and current Submission Admin/Super Admin boundary. Reassignment
and deactivation revoke access through that boundary. This migration adds new
object/RPC permissions but grants no person a new role; applying it still requires
separate backend/access approval.

Upload reserves a case-scoped document, stores bytes without upsert, then marks it
ready only after Storage size/MIME metadata matches. The original must still be
available when reviewed fields are saved. Original bytes, extraction evidence and
events have no staff update/delete path. Saved policy fields live in a separate
case record and do not overwrite customer intake or vehicle records.

Each field retains its original document ID, reviewer, review time, parser version,
source page/excerpt and whether the value matched the local suggestion or was
entered/corrected manually. The audit retains before/after snapshots and the review
note. Only limited matched excerpts are stored, not a second copy of all PDF text.
Extraction evidence is supplied by the browser and is untrusted until reviewed.

SHA-256 is client-reported, not server-attested. It prevents ordinary same-case
duplicate uploads; it is not proof of authenticity. An interrupted retry that
finds an existing object compares its actual bytes with the expected size/hash
before completing. The same file in another case remains a separate private
original and reveals no cross-case duplicate information.

Both case revision and policy revision must match on save. The case lock serializes
mutations; a stale review must reload and be checked again. Cancel/sign-out invalidates
the local operation and late UI results. A request already accepted by the server
may complete; the UI explicitly asks staff to reload before retrying.

Incomplete uploads are private to their uploader while that person remains a
current writer. They are retained for retry and count toward a 20-original case
limit. There is no automatic cleanup or retention deletion. A separately approved
operator process is needed for abandoned uploads, recovery or retention requests;
never delete Storage rows directly as a substitute for deleting actual objects.

## Verification and activation plan

Development uses synthetic fixtures only. No customer policy was opened, uploaded,
exported or sent to an external service. Local tests cover parser ambiguity, the
actual browser PDF extraction/preview path, explicit selection/replacement,
duplicate retry, stale saves, upload failures, cancellation, auth changes and
mobile layout. PGlite covers the migration, RPCs and RLS with synthetic identities.
These results do not prove hosted Supabase Auth/Storage behavior or multi-connection
database concurrency.

Local verification on 2026-10-10 passed `npm run check`, the complete `npm test`
command and all 292 desktop/mobile browser tests (including 52 insurance cases).
The insurance suites passed 39 parser/review assertions and 82 database checks,
plus original-byte retry adapter checks. Desktop/mobile synthetic screenshots were
visually inspected. These are local results; check the draft PR for hosted CI.

Before activation, obtain separate approval for these concrete steps:

1. Review this draft and its dependency on financing PR #4. Recheck the final base,
   exact migration diff and passing CI after any merge or retargeting. Keep both
   feature flags false while infrastructure is prepared.
2. Identify or create an approved isolated staging Supabase project. No usable
   isolated staging project or recoverable production backup has been verified
   by this feature work. Confirm backup and a restoration rehearsal first.
3. Apply missing existing migrations in their established order in staging, then
   apply `202610100001_insurance_policy_review.sql` exactly once. Inspect the private
   bucket, table/function ACLs and Storage policies; do not alter unrelated RLS.
4. Using approved staging identities and synthetic policies, check assigned and
   unassigned staff, customers, deactivated users, reassignment, direct Storage
   reads, upload retries and missing originals. Use two independent sessions to
   verify stale case and policy revisions. Do not assume local PGlite tests prove
   hosted Storage semantics.
5. Confirm the owner-approved staff mapping separately. No screenshot marked
   "Invitation pending" establishes a completed login. Any invitation, account
   creation or role change needs its own explicit approval.
6. After the time hold, backup/recovery and staging gates pass, seek explicit
   production migration and activation approval. Apply the reviewed migration,
   deploy the approved static revision, and enable the exact insurance flag only
   for the agreed rollout. Start with synthetic cases and verify the same access
   checks before allowing customer policy use.
7. To stop UI rollout, disable `insurancePolicyUpload`. Preserve originals and
   audit history. This flag is a UI gate, not a server permission revocation; any
   emergency RPC/Storage restriction or destructive rollback requires a separately
   reviewed database/security action.

Actual customer files, external OCR/AI, provider onboarding, retention deletion,
new credentials and permission expansion remain outside this development change.
