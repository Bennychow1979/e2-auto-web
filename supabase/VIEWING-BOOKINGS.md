# Viewing requests

Public entry: `https://e2auto.my/booking.html`, with `/ms/booking.html` and `/zh/booking.html` translations. All use the same inventory and database. Homepage and vehicle viewing buttons point here. Language links retain vehicle, Sales and Partner query parameters; a tab-scoped draft expires after 30 minutes and is cleared of contact fields after success.

Apply `migrations/202610010002_viewing_bookings.sql` before deploying the public pages. This additive migration depends on the existing inventory, staff and Partner referral migrations. It does not change stock, staff membership, payments, AI settings or existing descriptions. No OpenAI key, Edge function, email provider or scheduled task is required.

Visitors submit through the anonymous `e2_submit_viewing` RPC. The RPC validates consent, phone, an optional available published car, Malaysia dates within 90 days and half-hour preferences during the showroom's viewing hours. Public users have no table read/write grants. Repeating the same UUID and normalized content returns the receipt, without contact data or a duplicate appointment; different contents must use a new UUID. Submission is limited to 5 per phone per hour, 200 total per hour and 1,000 total per day. These limits apply only to writes, not to the page or crawlers. They are basic abuse controls, not proof of a caller's identity.

New appointments are **Requested**, never automatically confirmed. The success screen displays the reference and preferred slot, and asks the visitor to wait for E2 confirmation. A requested slot neither reserves inventory nor guarantees capacity. No customer message is sent automatically.

Staff open **E2 Workspace → Viewing requests** (`bookings.html`). Active Admin/Super Admin see all requests and can assign active Sales/Admin staff. Active Sales see and update only their assigned requests. Other accounts and unauthenticated visitors cannot read contact information. Database checks apply even to old sessions. Direct client writes are denied; the staff RPC checks permissions, revision, allowed statuses and explicit customer agreement before confirmation. Changed confirmation times require renewed agreement. Updates are audited. Closed requests are retained and cannot be reopened.

For an active Partner code plus a selected car, submission invokes the existing referral RPC in the same transaction and links its receipt. Existing first-referrer ownership and commission rules are preserved; booking alone creates no commission. General showroom requests retain the Partner code for staff follow-up when a car is chosen, without creating a vehicle-specific lead prematurely.

The form contains a BM/EN/Chinese contact notice and consent, and loads no advertising scripts. Contact data is not included in navigation URLs, analytics or the public receipt response. Administrators should process cancellation/correction requests through the workspace and handle any data removal request under the business's retention policy.

`npm run check` and `npm test` cover the page build and database behavior. `node supabase/tests/bookings.mjs` exercises anonymous/assigned/unassigned/revoked access, retries, revision conflicts, time limits, stock eligibility, referral linkage and language routing using a disposable local database.

Google Business Profile reviews business links independently. The dedicated location page lets a visitor finish submitting a viewing request online and does not require WhatsApp or sign-in. Do not advertise that Google has approved this link until Google actually accepts it.

Deployment: the database migration was applied successfully to `gkppiuuwsecojcnvkzjl` on 2026-10-01 (Malaysia time). The full existing test suite passed, and the booking suite passed 74 checks. Live browser verification follows the Pages deployment.
