# Private application documents

Adds supporting uploads to the existing seven-step individual loan application.

## Checklists
- Worker: applicant IC front/back, driving licence, latest three months payslips, latest three months personal bank statements, latest EPF statement.
- Self-employed / business owner buying in their own name: applicant IC front/back, driving licence, latest six months business/company bank statements. This is not a corporate-borrower application.
- JPG, PNG or PDF; 10 MB per file; 30 active/pending files per application. Monthly documents are uploaded one file at a time with 1–3 or 1–6 covered months; a combined PDF is supported. Repeated months are counted once, not verified. Other categories permit multiple files.

## Access and lifecycle
- Private `loan-documents` bucket; no public or signed share links. Downloads use the current authenticated session and Storage RLS.
- Drafts: active, email-confirmed applicant alone, including staff accounts using their customer session. Staff cannot read another customer's draft.
- After submission: applicant, active Super Admin and the active assigned salesperson/Admin may read ready files. Other roles have no access.
- Upload, replace and remove: applicant only, at Draft / Submitted to E2 / Needs information. Staff are read-only. Later stages remain read-only until a Needs information request.
- New upload: server reserves opaque application/file path, recording consent version/time, category, MIME, size and months. Storage validates permissions and bucket limits; finalization verifies actual stored size and MIME. Only finalized files become staff-visible.
- Replacement finalizes the new file and hides the old file in one database transaction. Failed uploads preserve the old file. Removed files are hidden from staff immediately, then deleted through the Storage API; cleanup retries on the applicant's next visit. Historical metadata and events remain. Previously downloaded copies cannot be recalled.
- Filenames are escaped and bounded. Browser upload and photo preview verify signatures; HTML/SVG/HEIC are not accepted. This is not an antivirus scanning service. PDF files are downloaded for the device's viewer, not embedded as active page content.
- No real identity or financial files were used in testing.

## Activation
1. Review migration `202609140010_loan_documents.sql` and the updated `loan-privacy.html`.
2. Confirm the additional identity/income file storage and submitted-file access in the existing E2 Supabase project gkppiuuwsecojcnvkzjl.
3. Apply migration 010 once, after already-live loan migrations 007–009. Do not rerun earlier migrations. The migration is transactional and explicitly revokes inherited anonymous/default function privileges.
4. Verify the private bucket, table RLS, RPC grants and Storage metadata size/mimetype compatibility.
5. Publish only the files in the local document release manifest, using a fresh main tree; never include `.document-qa`, `.loan-qa` or synthetic fixtures.
6. Verify GitHub CI and Pages deployment and live guest/authorised routing. Do not upload real customer files for testing.

## Verification completed locally
- 117 PGlite document access/integrity checks, including Supabase default grants, staging/finalization, size/type/month limits, draft isolation, role and assignment changes, replacement failure, deletion and stage locks.
- All existing inventory, staff, profile, customer, saved-car and loan test suites passed alongside the document suite.
- Browser tests used local synthetic data and mocked APIs: actual file chooser PDF upload, combined three/six-month PDF labels, photo preview, PDF download entry, replacement network failure, sign-out clearing, staff read-only view, 390px layout, and saving current loan fields before opening Documents.
- Owner confirmed activation on 14 September 2026. Migration 010 was applied successfully to the existing E2 project. The Storage service exposes the size and mimetype metadata used by finalization. Local browser mocks do not verify real Storage transfers; production deployment is tracked through GitHub Actions.

## Operational limits
No automatic bank submission, approval promise, required-document verification gate, automated retention/deletion schedule or guarantor document collection is added. A 30-file application needs one free slot to safely replace a file; at the cap, remove an unneeded file first. Old files successfully replaced but awaiting cleanup remain private. Staff handle further document requests through the existing Needs information status and note.

Platform references: [Private buckets](https://supabase.com/docs/guides/storage/buckets/fundamentals), [Storage access control](https://supabase.com/docs/guides/storage/security/access-control), [Authenticated downloads](https://supabase.com/docs/reference/javascript/file-buckets-download).
