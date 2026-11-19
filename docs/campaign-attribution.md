# Threads campaign measurement — 22–28 November 2026

The fourteen existing scheduled URLs are unchanged. `utm_source=threads` and
`utm_medium=organic_social` are required. `honda_week` identifies seven image
posts; `reels_week` identifies seven video posts. The migration contains each
post's exact `utm_content`, language and scheduled time in Malaysia time.

## What the numbers mean

- Visits: consented campaign arrivals, deduplicated within 30 minutes for the
  same campaign/post in a browser. Direct internal navigation creates no visit.
- Browsers: random browser IDs, not unique people. Clearing storage or using a
  different browser changes this identifier.
- Registration started: a new Supabase Auth customer account, recorded by an
  INSERT trigger. Failed form submissions and existing-user logins do not count.
- Registration confirmed: the same account's server-controlled
  `email_confirmed_at` becomes non-null. Opening the email on another device
  still completes the original attribution. Profile edits do not change it.
- Attribution: last supported campaign seen in the consenting browser within
  30 days. It is frozen on account creation. An untagged/direct return preserves
  the source. Rejection/withdrawal removes the browser reference; accounts can
  still register without attribution.

The public pages and account form show an optional EN/MS/ZH measurement choice.
This is separate from the existing Meta advertising consent. No contact fields,
passwords, full query strings or Meta registration events are collected by this
feature. Private database tables have RLS and no anonymous/customer read grants.
Anonymous visitors can only invoke the bounded, allowlisted write RPC. A random
visit token is an attribution hint, never an authorization credential. This is
marketing measurement, not fraud-proof billing data.

## Reporting

An authenticated E2 administrator may call
`e2_campaign_report(from_at, until_at, include_test=false)` with an interval up
to 100 days. Normal customers and anonymous callers are denied. This reports
visit cohorts in that interval and registrations confirmed before its end.

For the November 30 comparison, run `docs/threads-campaign-48h.sql` through the
authorized Supabase connection. It gives every post its own first 48 hours,
excludes QA, and includes zero-traffic posts. Summarize image/video totals and
the individual posts. Report website visit rate as measured visits / Threads
views, and registration conversion as confirmed / measured visits (null when
denominator is zero). Do not describe visits / views as a platform click-through
rate: consent rejection, browsers and repeat views make those different metrics.

Read views, likes, replies, reposts and quotes from Threads separately. Record
the actual collection time. Website 48-hour cohorts are available from SQL;
historical 48-hour Threads snapshots may not be available retrospectively, so
label current platform totals rather than inventing comparable snapshots.
Language, car, posting time and date differ, so this is an observational
comparison rather than a controlled A/B test. Low/zero counts are inconclusive.

## Validation and operations

`npm run test:campaign` tests the actual migration in PGlite, anonymous/customer
permissions, validation, idempotency, immutable attribution and confirmation.
`npm run test:campaign:browser` exercises the actual registration form and SQL,
all fourteen tags, a fresh-browser email return, opt-out and transient failure.
Its email transport is simulated. `node tests/favourite-registration-browser.mjs`
covers the existing three-language save/register journey. Discovery/release
tests verify tracking is packaged on listing, category and vehicle pages.

For production smoke tests, use `utm_campaign=tracking_qa` and
`utm_content=e2_tracking_smoke` with the same source/medium. This reserved campaign
is excluded from all regular reports. Do not use a live campaign for test signups.
Email delivery must be checked using an authorized test mailbox; an SQL update
of `email_confirmed_at` is not an end-to-end mail test.

If collection fails, signup still works. Check function/auth logs for
`E2 campaign registration capture failed`. The anonymous collector caps at
100 rows per browser/day and 20,000 globally/day; unexpected caps need review.
Rollback: revert frontend changes first. Leave the additive private tables for
audit; removing the auth trigger is a separate reviewed migration if needed.
Do not reset Auth, disable email confirmation, or alter customer permissions.
