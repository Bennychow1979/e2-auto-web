# Guest intake release

Vehicle invitation -> customer seven-step form + optional attachments -> assigned salesperson -> selected Office Admin. No customer Auth account or email confirmation is created by this flow. Existing registered-customer applications remain separate and unchanged.

## Access
- Public endpoint `e2-guest-intake`: only public invitation context and write operations. No submitted-answer read, file listing, file download, staff action or arbitrary RPC proxy.
- Only this function uses `verify_jwt=false`. Existing invitation/admin function stays authenticated. Service role remains on the server, never in page source.
- Database RPCs used by this endpoint are executable only by service_role; explicit revokes account for Supabase default grants.
- Active assigned salesperson and Super Admin read submitted enquiries. Selected active Office Admin receives read/file access only after recorded handover. Staff cannot rewrite customer answers. Other sales/admin/account/customer users have no access.
- Invitation UUID expires in 14 days. Per-submission random write nonce is held only in page memory, stored hashed server-side, valid for two hours, and never grants read access.
- Files: private `intake-documents`, JPEG/PNG/PDF, 10 MB each, 30 maximum. Signature and metadata checked, opaque server-selected paths, no overwrite. Removal first locks the metadata state so concurrent submission cannot receive a file being deleted.

## Operations and limits
- Opening an invitation does not create an application. The final Submit starts staging, uploads files and then submits answers. Retries reuse the session and file identifiers.
- Memory-only form progress is lost on reload. No guest read/resume route. Corrections or missing files require direct salesperson follow-up in this initial release; there is no guest supplement link or staff answer editor.
- Email optional; all other agreed field validation and third-party information consent retained. Information is marked customer-provided/unverified.
- Limits: 10 starts/invite/hour, 50/staff/day, 100/global/hour; 2 GiB reserved uploads/day globally. Invitation revocation stops new and unfinished writes.
- Abandoned files become eligible for opportunistic cleanup 24 hours after session expiry. Cleanup runs on subsequent context requests, up to 30 files at a time. It is not a timed retention guarantee. Empty staging rows remain; establish a separately approved retention process before larger-scale use.
- Staff manually record actual financier submission/outcome. No email/WhatsApp messages or bank submissions are automatically sent.

## Activation order
1. Review migration 202609140011_guest_intake.sql and the new public endpoint + selected Office Admin access expansion.
2. Apply migration once to the E2 project. Confirm private bucket, RLS and explicit RPC grants.
3. Deploy e2-guest-intake from index.ts plus handler.mjs with JWT verification disabled for this function only. Existing Supabase service-role environment supplies the server client. No new secrets in repository.
4. Release only the files in the prepared release manifest on the latest main tree, preserving all other files; wait for permission tests and Pages deployment.
5. Signed-in salesperson creates a link for a published available vehicle. Verify public context and a synthetic submission before inviting actual customers. Never send customer messages without explicit authorization.

## Validation
Database tests use PGlite with Supabase-like default EXECUTE grants; tests cover guest write isolation, no anonymous read, Office handover, optional email, read-only staff answers, revoked/expired sessions, storage staging and deletion races. Handler tests cover body limits, allowed origins, RPC whitelist and content signatures. Browser preview uses explicitly synthetic local adapters, not production customer records.
