# Viewing requests

Public entry: `https://e2auto.my/booking.html`, with `/ms/booking.html` and `/zh/booking.html` translations. All use the same inventory and database. Homepage and vehicle viewing buttons point here. Language links retain vehicle, Sales and Partner query parameters; a tab-scoped draft expires after 30 minutes and is cleared of contact fields after success.

Apply `migrations/202610010002_viewing_bookings.sql` before deploying the public pages. This additive migration depends on the existing inventory, staff and Partner referral migrations. It does not change stock, staff membership, payments, AI settings or existing descriptions. The original booking form needs no Edge function or scheduled task. The optional Telegram integration below adds an Edge function and a one-minute schedule; it uses no OpenAI or email provider.

Visitors submit through the anonymous `e2_submit_viewing` RPC. The RPC validates consent, phone, an optional available published car, Malaysia dates within 90 days and half-hour preferences during the showroom's viewing hours. Public users have no table read/write grants. Repeating the same UUID and normalized content returns the receipt, without contact data or a duplicate appointment; different contents must use a new UUID. Submission is limited to 5 per phone per hour, 200 total per hour and 1,000 total per day. These limits apply only to writes, not to the page or crawlers. They are basic abuse controls, not proof of a caller's identity.

New appointments are **Requested**, never automatically confirmed. The success screen displays the reference and preferred slot, and asks the visitor to wait for E2 confirmation. A requested slot neither reserves inventory nor guarantees capacity. No customer message is sent automatically. A receipt restored from the tab is labelled as a saved submission receipt, not a live status tracker; customers contact E2 for the latest arrangements.

Staff open **E2 Workspace → Viewing requests** (`bookings.html`). Active Admin/Super Admin see all requests and can assign active Sales/Admin staff. Active Sales see and update only their assigned requests. Other accounts and unauthenticated visitors cannot read contact information. Database checks apply even to old sessions. Direct client writes are denied; the staff RPC checks permissions, revision, allowed statuses and explicit customer agreement before confirmation. Changed confirmation times require renewed agreement. Updates are audited. Closed requests are retained and cannot be reopened.

For an active Partner code plus a selected car, submission invokes the existing referral RPC in the same transaction and links its receipt. Existing first-referrer ownership and commission rules are preserved; booking alone creates no commission. General showroom requests retain the Partner code for staff follow-up when a car is chosen, without creating a vehicle-specific lead prematurely.

The form contains a BM/EN/Chinese contact notice and consent, and loads no advertising scripts. Contact data is not included in navigation URLs, analytics or the public receipt response. Administrators should process cancellation/correction requests through the workspace and handle any data removal request under the business's retention policy.

`npm run check` and `npm test` cover the page build and database behavior. `node supabase/tests/bookings.mjs` exercises anonymous/assigned/unassigned/revoked access, retries, revision conflicts, time limits, stock eligibility, referral linkage and language routing using a disposable local database.

Google Business Profile reviews business links independently. The dedicated location page lets a visitor finish submitting a viewing request online and does not require WhatsApp or sign-in. Do not advertise that Google has approved this link until Google actually accepts it.

## Ordinary-request rotation and private-channel notifications

Implementation prepared on 2026-10-20; this section is a deployment procedure, not a production activation receipt.

Apply `202610200006_viewing_rotation_notifications.sql`, then `202610200007_viewing_notification_dispatch.sql`, before releasing the updated staff page. Migration 006 changes ordinary new submissions immediately; existing appointments and historical notification delivery are not backfilled. Telegram enqueueing defaults to **off** until explicit activation.

- A valid `sales` link keeps its active Sales/Admin owner, even if that Salesman's ordinary-booking rotation is paused. Invalid/inactive personal links keep the existing error/removal flow; they do not silently switch owners.
- Without a Sales link, all active accounts with role `sales` participate by default. Admin/Super Admin/Office accounts are not in the ordinary rotation. Admin can pause/resume each Salesman under **Viewing requests → Salesman rotation & Telegram** without changing their account or personal links.
- The least recent ordinary allocation gets the next turn; the initial order is display name, then user ID. The counter persists across days and restarts. Dedicated-link bookings, retries, cancelled bookings and manual transfers do not advance/reset that counter. A newly added or resumed Salesman with an older turn joins at the appropriate next position.
- One database transaction validates, assigns, saves the booking/referral and queues its notification. The existing advisory lock serializes submissions and rotation changes. The original request UUID/fingerprint check runs before rotation, so a repeated submission never takes another turn. Failed transactions roll back the allocation too.
- If all Salesmen are paused/inactive, save an unassigned request for Admin follow-up. Its channel message explicitly says **UNASSIGNED** when Telegram is enabled.
- Partner attribution and commission rules remain in the existing referral RPC. A new linked lead receives the rotated Salesman; an existing first-referrer lead retains its existing ownership rules.

### Telegram setup and activation

1. Create a private Telegram channel, invite only the intended E2 staff, and create a Bot through the official `@BotFather`. Suggested display name: **E2 AUTO Viewing**; suggested username: `e2auto_viewing_bot` (availability is determined by BotFather).
2. Add the Bot as a channel administrator with **Post Messages** permission. No discussion group or Salesman claim button is required.
3. For this new Bot, a setup client can read `getUpdates` after an administrator posts a test channel message; use `channel_post.chat.id` as the channel ID. Read updates in the setup client without printing the token/response to shared logs. If the Bot already has a webhook, do not remove it to fetch updates: retrieve the ID through that integration instead. Verify with `getChat` that the target is the intended private channel, not a public channel/group.
4. In **Supabase → Edge Functions → Secrets**, set `E2_VIEWING_TELEGRAM_BOT_TOKEN` and `E2_VIEWING_TELEGRAM_CHANNEL_ID`. The channel ID is a negative number, commonly starting `-100`. Tokens must never go in `e2-config.js`, a committed file, a URL shared in chat, or a screenshot.
5. Deploy **e2-viewing-notify**, including `index.ts` and `handler.mjs`. Gateway JWT verification is disabled only because the handler accepts a database-created, short-lived, one-use capability. It does not accept the public website key or an arbitrary browser call. The existing platform service-role key is used only within the Edge function.
6. Confirm `pg_cron` and `pg_net` are installed, then run `activate-viewing-notifications.sql` as the database administrator. The cron expression runs every minute; this is an application delivery job, not a Codex chat automation. Cron uses hashed one-use capabilities and does not store the Bot token or a service-role key in job text.
7. Submit labelled synthetic ordinary requests and one dedicated-link request. Check that the ordinary sequence advances independently, the dedicated request retains its owner, and the channel receives the right owner plus the **View request** link. Cancel the synthetic appointments afterwards. Verify a repeated identical request creates neither another allocation nor another queue row. Do not claim live Telegram delivery passed until the channel message is observed.

Notifications show the reference, vehicle, customer name, viewing time in Malaysia, assigned Salesman and current status. Phone numbers and internal notes remain in the authenticated workspace. The button opens the matching request for an authorized staff member; it is not an authorization bypass. A Salesman who does not own that appointment cannot view it through the link. Staff should use the workspace for the latest assignment/status; this version sends new-request alerts, not a message for every later status change.

### Delivery reliability and operations

Each enabled new booking gets one queue row. The worker claims rows with `FOR UPDATE SKIP LOCKED`, sends at most eight per invocation with pacing, and stores Telegram's message ID. A known rate-limit rejection is delayed by at least Telegram's requested interval and capped at five attempts. New queue entries are not made while delivery is disabled; enabling does not broadcast old bookings.

Telegram `sendMessage` has no client idempotency key. Network timeouts, ambiguous server responses or expired in-flight leases therefore become **uncertain**, rather than blindly producing duplicates. An Admin can inspect the channel and explicitly choose **Retry notification**. A successful send followed by a database failure never triggers another send in the same worker. Delivery retries do not change Salesman assignment. Closed bookings that are still waiting in the queue are skipped. The cron sweep marks expired sending leases for attention even if there are no new pending jobs.

The workspace displays queued/sending/sent/attention states. A configured delivery switch does not itself prove that secrets/permissions are correct: complete the synthetic delivery check. Worker responses and saved errors exclude Bot credentials, customer contact data and upstream response bodies.

To pause outbound delivery without touching allocation or appointments, run:

```sql
update public.e2_viewing_delivery_settings set notifications_enabled=false where singleton;
select cron.unschedule('e2-viewing-notifications');
```

To pause ordinary allocation, use the roster controls to pause all Salesmen; incoming ordinary requests then remain unassigned. Do not delete booking or notification tables to roll back. Pending notifications survive a delivery pause; review them before re-enabling. Already-running sends may finish.

Validation: `node supabase/tests/bookings.mjs` covers allocation, personal links, pauses, idempotency, permissions, queue leases, capabilities and retries in PGlite. `node --test supabase/tests/viewing-notify.mjs` uses a mocked Telegram transport. `node tests/viewing-workspace-browser.mjs` checks desktop/mobile controls and deep links against synthetic data. These do not substitute for live channel delivery or a real multi-session PostgreSQL concurrency check before production rollout.

Deployment: the database migration was applied successfully to `gkppiuuwsecojcnvkzjl` on 2026-10-01 (Malaysia time). The full existing test suite passed, and the booking suite passed 74 checks. Live browser verification passed on EN → BM → 华语, preserving entered fields and vehicle choice. A synthetic Chinese submission with a double click created exactly one receipt; the live staff RPC confirmed then cancelled it, leaving three audit events and no pending test appointment. Live RLS checks confirmed anonymous submission is allowed while anonymous table reads and management are denied. The signed-out staff page displays its sign-in requirement. Both GitHub workflows passed.
