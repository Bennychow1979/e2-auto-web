# AIRA appointment contact verification

Endpoint: `POST https://gkppiuuwsecojcnvkzjl.supabase.co/functions/v1/verify-viewing-contact`

Headers: `Content-Type: application/json`, `x-e2-verify-key: <dedicated secret>`.
Body: `{"ref":"<e2_viewings.id UUID>","phone":"<WhatsApp sender phone>"}`.

Benny generates and sets `VIEWING_VERIFY_KEY` in Supabase Edge Function Secrets and in AIRA's private server configuration. The value must never be included in chat, source code, screenshots, frontend configuration, logs or this document. It is unrelated to Supabase anon/service-role keys. AIRA needs only this dedicated key; no Supabase login or AWS console access is required for this endpoint.

The handler hashes both credentials with SHA-256, then compares the fixed-length digests using `timingSafeEqual`. Missing configuration, missing header and wrong keys all return HTTP 401. JWT verification is disabled for this function because it implements the dedicated header authentication itself. No CORS headers are returned; requests with an Origin header are rejected.

Successful lookup returns only `found`, `match`, `already_verified`, `vehicle_label`, `preferred_date`; mismatches additionally return `form_last4`. Unknown or expired references return only `{"found":false}`. `already_verified` reflects the stored timestamp before this request, including on mismatches. A previous verification never makes a mismatched incoming number count as verified. AIRA must check `found && match` before treating the incoming WhatsApp account as matching.

The phone comes from the trusted WhatsApp sender identity, not a number typed into a message. Normalization removes all characters except ASCII digits and prepends `6` if the digits start with `0`. The entire normalized number must match. Valid normalized numbers contain 8–15 digits and cannot start with zero.

Expiry means the request was created more than 90 days ago (`created_at`), not 90 days after the preferred appointment date. Expired and unknown requests produce no contact audit event. Invalid UUID/JSON/phone returns 400. Unsupported methods return 405, browser Origin returns 403, temporary backend failure returns 503. Every error body contains only `{"found":false}`; AIRA must inspect HTTP status and must not treat an error as a confirmed missing appointment.

All authenticated attempts (including invalid input) share a database-backed rolling 60-second limit of 60 across every Edge instance. Further attempts receive 429 and `Retry-After: 60`. Invalid credentials are rejected with 401 before any database access and do not consume AIRA's quota. The bounded limiter stores timestamps only. No customer information, incoming phone, IP or secret is stored in the limiter.

On the first match, one transaction locks the appointment, sets `contact_verified_at`, increments `revision`/`updated_at` for existing staff concurrency checks, and adds `contact_verified` with exactly `{"source":"aira_whatsapp"}`. Repeated matches change nothing and add no event. Each mismatch leaves the entire appointment row unchanged and adds `contact_mismatch` with only `{"wa_last4":"<last four>"}`. Neither path changes appointment status, dates, assignment or staff notes. Phone verification does not imply the customer agreed to an appointment time.

Both SQL functions use SECURITY INVOKER, an empty search path and service-role-only EXECUTE grants. Anonymous and signed-in website users cannot call them. Existing viewing table grants and RLS are unchanged; the limiter is in a private schema with RLS and no anonymous/authenticated grants.

## Validation

Run `node --test supabase/tests/viewing-contact-handler.mjs` and `node supabase/tests/viewing-contact-db.mjs`. Tests use synthetic keys and isolated PGlite data, cover data minimization, auth, full-number comparison, retries, audit rollback, expiry, permissions, shared quota and body limits. `.github/workflows/viewing-contact.yml` runs both on relevant changes.

Authorized production test references (use the supplied test phone privately):

- `efb4ee05-d588-4cb8-b194-ada9a6636b7c`: expected match.
- `d576ed34-a94d-4323-88ca-57bb3191322c`: expected mismatch, `form_last4: "6789"`.

These tests have real effects: the first matching request sets the timestamp if empty, and a mismatch adds an audit event. Successful direct database tests verify business logic but are not equivalent to a live HTTP request carrying Benny's key. Claude should run the two HTTP calls from AIRA after configuring the same dedicated key, and only share HTTP status plus the permitted response fields. Never enable request/header debug logging.

Deployment validation on 2026-11-23: Edge version 1 is ACTIVE with custom authentication. Live unauthenticated POST and OPTIONS returned 401 with `{"found":false}` and no CORS headers. Service-role database tests on the two authorized references returned the expected match/mismatch results; the matched row was verified once and its retry returned `already_verified:true`, with no duplicate audit. The mismatched row was unchanged and its event contained only `wa_last4`. Both records returned `vehicle_label:null` and `preferred_date:"2026-11-24"` as stored. Real-key HTTP testing remains with AIRA/Benny; no key was read by the implementation agent.

The security advisor reports the private limiter's intentional lack of browser RLS policies as informational ([RLS enabled without policies](https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy)). Only service_role has schema/table privileges; it uses BYPASSRLS. No anonymous or authenticated policy should be added for this server-only table.
