# E2 Partner Referral MVP

## Architecture review — 22 September 2026

Repository: `Bennychow1979/e2-auto-web`. Reviewed production source snapshot: `31d0cd0d817e3d52a08838394ede9bfe29f49b54`.

The application is static HTML/CSS/ES modules hosted by GitHub Pages. `e2-config.js` points to the existing **E2 WEB Project** (`gkppiuuwsecojcnvkzjl`). Database access uses Supabase Auth, RLS and security-definer RPCs. There is no application server to receive WhatsApp messages.

Existing structures reviewed:

| Area | Existing implementation | Referral integration |
| --- | --- | --- |
| Staff login | `e2-data.js`, `staff_memberships`, `staff_profiles`; `e2-staff-auth` browser session | Reuses Admin/Super Admin and assigned Sales authorization |
| Customer login | `customer-data.js`, `customer_profiles`; `e2-customer-auth` session | No registration required to browse or submit referral enquiry |
| Vehicles | `vehicles`, photos, `car.html?id=<uuid>`, public/draft RLS | References existing stable vehicle IDs; does not alter stock or photos |
| Sales sharing | `referral.js`, `?sales=<staff uuid>` | Continues to route enquiries; `?ref=<partner code>` independently controls attribution |
| Loans | `loan_applications`, `loan_events`, `loan_documents`, guest `intake_*` tables | Remain unchanged; staff manually confirms the referral pipeline stages |

Read-only inspection of the live Supabase Database Tables page confirmed these structures among 21 public tables and no pre-existing Partner/referral tables. The live staff membership columns were verified as `user_id`, `role`, `active`, `revision`. This was not a full live schema/policy dump. No live customer records were changed or used as test fixtures.

## Commercial scope confirmed by the owner

This MVP is for Partner/Influencer referrals at E2 published vehicle prices with a fixed agreed commission. It is **not suitable for a broker who privately marks up the price**: the public vehicle link displays the E2 price. Do not onboard markup arrangements into this program or suggest that it hides the public price. A future broker workflow needs separate E2 floor price, customer quote, E2 approval of the actual transaction price, and margin settlement. It may reuse inventory but must not reuse this public-price referral flow or fixed-commission calculation. No broker pricing feature is implemented here.

## Delivered implementation

- `partner.html`: dedicated E2 Partner sign-in, recovery, code, per-car links, anonymous lead progress and own commission totals.
- `referrals.html`: existing E2 staff session; Admin manages Partner memberships, assigns leads, confirms delivery and approves/records commissions. Assigned active Sales can work on their own leads up to Approved.
- `partner-referral.js`: opt-in integration into the existing vehicle page, using a scoped stylesheet. Ordinary visitors retain the existing enquiry flow.
- `partner-privacy.html`: contact and attribution notice.
- `202609220001_partner_referrals.sql`: one transactional additive migration; six new tables and scoped RPCs. No existing table, role, loan workflow or vehicle record is rewritten.

### Account boundary

Partners use dedicated confirmed Auth accounts in **the E2 Supabase project**, their own `e2_partners` membership, and `e2-partner-auth` browser session. Attaching an existing staff/customer profile as a Partner is rejected. Partner access grants no private inventory or customer/loan/document access. The Partner portal exposes lead UUID references, date, stage and own commissions only.

KeretaSB must use a different Supabase project, Auth issuer, keys and session namespace when created. Do not reuse E2 credentials or federate the two identities. This change creates no KeretaSB account, database or dependency. A separate browser storage key alone is not a database boundary; the E2 project is the boundary.

### Attribution and lifecycle

1. `car.html?id=<vehicle uuid>&ref=<generated code>` records a deduplicated browser/vehicle/day visit. No lead is created.
2. A valid code is remembered locally for 30 days so moving between cars does not lose attribution. A later valid link can replace the browsing code **before** a lead is locked.
3. WhatsApp, Request a call, and the final Book Viewing contact action request name, phone and contact consent. This is not account registration. The database normalizes local `0…`, `+60…` and `0060…` forms.
4. The first identified enquiry for a normalized phone locks the Partner and commission rate. A transaction lock plus unique phone prevents conflicting first claims. Later cars, sales links and Partner links cannot overwrite this ownership. A separate enquiry receipt is returned, never an existing customer's data.
5. WhatsApp continues only after save succeeds. The message contains the enquiry receipt for staff to match. Saving does not send a message or confirm an appointment. Failure offers retry with the same idempotency key or explicit direct contact without a confirmed save.
6. `New Lead → Viewed → Loan Submitted → Approved → Delivered`. Stages cannot be skipped or moved backward. Staff must explicitly confirm they contacted the customer before advancing. Only Admin/Super Admin can mark Delivered.
7. Delivery and creation of the **single** Pending commission are in the same database transaction. The amount is the integer MYR cents snapshotted when the lead was created.
8. Admin: Pending → Approved → Paid, with an actual payment reference required for Paid. This records payment; it does not transfer funds. Revision checks reject stale/double actions. Audit records capture operations.

The 30-day limit applies to the browser code, not to already locked leads. This MVP intentionally has no lead expiry, reassignment of referrer, repeat-purchase commissions, cancellations, refunds or commission reversals. Resolve those policies before expanding beyond the pilot. Changing a Partner rate affects future leads only; disabling a Partner stops new referrals and portal access without deleting earned records.

## Migration and activation

The migration is **prepared and tested locally, not applied to production by this change**. `partnerReferrals` remains `false`. The pull request does not publish an active referral program.

1. Confirm the target is **E2 WEB Project**, not another project. Back up using the established E2 process. Existing migrations through `202609210003` should already be installed.
2. In the target database, first inspect `to_regclass('public.e2_partners')` and `to_regclass('public.e2_referral_leads')`: both must be null for this first-time migration. Do not re-run an applied migration.
3. Apply `supabase/migrations/202609220001_partner_referrals.sql` once. It is wrapped in a transaction and rolls back on error. RLS is enabled on all six new tables; direct anonymous reads/writes and authenticated direct writes are revoked. Each exposed function receives explicit grants, including revocation of Supabase default grants.
4. In E2 Auth redirect settings add the exact `https://e2auto.my/partner.html` URL for Partner password recovery. Keep existing redirect URLs. Create the dedicated Partner Auth account using E2's normal administrator-controlled onboarding; the recipient sets their own password and confirms the email. This task did not send invitations or create credentials.
5. Deploy the reviewed frontend with the feature flag still off. Sign in to `referrals.html` using an existing Admin session. Attach the confirmed Partner email, name and explicitly agreed commission in RM. Do not copy the synthetic RM500 test amount into production by default.
6. Verify actual Partner login, password recovery delivery, revocation, anonymous private-data denial and an end-to-end pilot against an appropriate test environment. Local mocks do not establish hosted Auth/email behavior. No real customer's pipeline or financial records should be changed for a smoke test.
7. Enable `partnerReferrals: true` in E2 configuration and release once the hosted checks and pilot arrangements are ready. Existing main deployments automatically publish via GitHub Pages, so merging code and applying a database migration are distinct operations.

Rollback: set `partnerReferrals` to false and redeploy to restore the original vehicle contact flow. Keep the new tables/audit/commission data; do not drop financial records. The existing backend needs no rollback because it was not modified.

## Validation

Run from the repository root:

```sh
npm ci --ignore-scripts
npm run check
npm test
node supabase/tests/partner-referrals.mjs
```

The new suite contains **67 checks** using PGlite with the existing schema, existing RLS and Supabase-like default function grants. It checks isolated accounts, permission denial, click-only behavior, phone normalization, first-winner ownership, car changes, retry receipts, contact consent, hidden customer PII, sequential progression, stale revisions, delivery restrictions, exactly one commission, approval/payment ordering, payment references, revocation, client storage expiry and multi-page reads. Existing inventory/staff/customer/saved/loan/document/intake/office/advertising/import suites also passed. SQL transaction locks are exercised in a single-engine fixture; a multi-connection production contention test remains part of rollout validation.

Browser verification used a local, isolated synthetic API adapter (not committed or shipped): Partner summary/link generation; desktop and 390px phone layout; Admin Delivered → Approve → Mark paid; referred WhatsApp form and receipt-bearing continuation. No WhatsApp message or actual payment was sent. Tests do not claim production onboarding, email delivery or persistence have been verified.

## Pilot limits and next work

- The phone is self-reported. The lock records the claimed contact; it is not OTP proof. Staff verification and Admin delivery/approval are required. Add OTP or WhatsApp Business inbound verification and an attribution dispute workflow before automated payouts.
- Public RPCs have per-phone hourly submission limits, deduplicated clicks and a daily per-Partner click storage cap. These are basic bounds, **not** identity verification or bot-proof rate limiting. Add server-verified CAPTCHA/edge throttling before broad paid traffic.
- All stages are manually maintained independently of loan workflow. Later add explicit, authorized linkage to registered and guest loan records, while preserving their existing RLS and document boundaries.
- Account onboarding is Admin-controlled and uses existing Supabase Auth; self-service signup, automated invitations and social login are not part of this slice.
- One locked lead/commission per phone in this pilot. Repeat purchases, phone changes, disputes, returns, retention scheduling and referral expiry need deliberate business rules rather than silently changing attribution.

Security reference: [Supabase database function security and grants](https://supabase.com/docs/guides/database/functions), [Supabase RLS](https://supabase.com/docs/guides/database/postgres/row-level-security).
