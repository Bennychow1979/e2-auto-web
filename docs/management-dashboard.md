# Super Admin overview

The dashboard is a read-only management view. The rollout gate `managementDashboard`
is enabled after hosted endpoint checks and real Super Admin acceptance. Its design follows
the supplied navy sidebar, mint selection, summary cards, pipeline, age bands and
action queue. All demo data belongs in tests, never in the production page.

## Rollout status — 2026-11-16 MYT

PR #59 is merged. The protected page is published at
`https://e2auto.my/dashboard.html`; its HTML, CSS, JavaScript, view module and
configuration were fetched from the live site and matched the reviewed source.
The owner verified the live page using their own Super Admin session: all four
summary totals matched and the page reported that the latest data was loaded.
Following this acceptance, `managementDashboard` is enabled so Super Admin login
opens the overview by default. Website inventory remains accessible through
`portal.html?view=inventory`; dispatch drafts and password recovery retain priority.

`e2-management-dashboard` is active in the existing E2 project, version 1,
package SHA-256 `14f80b7910c589a53469fae142d350b240c3d7d2fed26b099e48da0d3fb22d1e`.
All nine deployed files match the submitted source. Hosted checks verified 401
for missing/invalid sessions, 403 for a disallowed origin and 405 for GET, with
no-store responses and no business data. Active/inactive role gates, sign-out
races, failure states and pagination passed synthetic tests; this does not claim
real-user testing for every role. Source columns and aggregate definitions were
checked read-only against the live database. No source records, credentials or
business counts are included in this report.

Desktop and mobile layout checks passed on synthetic fixtures, including chart
rendering, task links, menu/Escape, refresh and no horizontal page overflow.
Mobile tasks use cards so action links remain visible. The existing dispatch
draft regression also passes after restoring its shared notice module in the
test preview allowlist. GitHub permission and browser checks passed before merge.

## Source and definitions

The owner confirmed on 2026-11-16 (MYT) that MASTERLIST is authoritative. Notion
is a cross-check only; differences require review and must not overwrite it.

- Fleet: the existing fixed E2 MASTERLIST workbook, current Malaysia-month sheet.
  Reads reuse the existing server-side Drive service account and single-file
  Viewer grant. No new source sharing, browser token or source edits are needed.
- Full-fleet stock: vehicle rows in the current inventory section, before the
  number-plate-sales and delivery sections. This includes reserved/repair stock;
  it must not be labelled "available for sale" or "published website stock".
- Actual stock age: calendar days since literal `DATE IN`, using Malaysia's date.
  Bands are 0–30, 31–60, 61–90 and over 90. Missing, invalid, formula or future
  dates are excluded from bands and explicitly counted as needing verification.
  No website/Notion creation timestamp is used as a substitute.
- This month's deliveries: unique vehicle rows in the current worksheet's
  `SOLD & DELIVERED` section. This is monthly section membership, **not a claim
  that exact handover dates are complete**. Never convert a sales month into an
  invented handover day. The following older sales-closing section is excluded.
- Pending deliveries: the `PENDING DELIVERY / DONE SIGN LOAN` section. A website
  `Sold` label, referral delivery or runner delivery job is not a fleet delivery.
- The Notion Vehicles database was inspected as a cross-check. It has `CAR IN
  DATE`, `交车日期`, status and sale-month properties, but exact handover dates are
  incomplete. No runtime Notion sync or new Notion integration is provisioned.
- Members: completed `customer_profiles`, not every Supabase Auth registration.
- Loans: submitted website loan applications and submitted guest intake cases.
  Each source/id counts once; multiple bank applications are not added together.
  Outcome-recorded/withdrawn/draft cases do not count as in progress. No approval,
  signing or disbursement total is inferred from a generic outcome status.
- Pending commissions: actual `Pending` referral commissions.

The month starts at midnight in Asia/Kuala_Lumpur. Source modification time and
read time are shown separately. A failed source leaves its numbers blank, never
zero. The queue does not say everything is clear while any source is unavailable.
Unknown worksheet structure, duplicate registrations (including slash aliases),
or a workbook changed during the read blocks fleet metrics rather than guessing.

## Privacy and access

`e2-management-dashboard` verifies the JWT with Supabase Auth, then checks the
current `staff_memberships` row for active `super_admin` **before any business
query or Drive read**. Other staff and customers cannot retrieve totals. The
browser uses the existing staff session and publishable key only. Responses have
`Cache-Control: no-store`; no dashboard payload is persisted to local storage.
The workbook exists only in server memory. Responses contain counts and source
timestamps, not vehicle/customer rows, purchase costs, profits or private notes.
Do not log request tokens, raw database errors, workbook cells or credentials.

No SQL migration or write policy is required. The endpoint changes no vehicles,
loans, source files or permissions. It reads minimal columns, counts profiles and
commissions without returning their rows, and checks loan pagination completely.

## Deployment and acceptance

1. Preserve the owner-confirmed source definitions above, especially current-month
   `SOLD & DELIVERED` membership versus exact daily handover records.
2. Deploy `e2-management-dashboard` to the existing E2 Supabase project, including
   its relative shared modules. The browser sends a current user JWT; the handler
   verifies it itself. Follow the existing function pattern with gateway JWT
   verification disabled when using publishable keys. Never remove handler auth.
   With an already authenticated Supabase CLI:
   `supabase functions deploy e2-management-dashboard --project-ref gkppiuuwsecojcnvkzjl --no-verify-jwt`
3. Reuse existing project secrets `E2_DRIVE_SERVICE_ACCOUNT_JSON`, `SUPABASE_URL`,
   `SUPABASE_ANON_KEY` and `SUPABASE_SERVICE_ROLE_KEY`. Do not copy their values into
   source, PRs, chat or browser configuration. Do not change the vehicle importer.
4. Verify unauthenticated access returns 401; inactive and non-Super-Admin users
   return 403; active Super Admin returns live counts. Check the current month
   directly against MASTERLIST and verify all age bands plus missing-date count
   equal fleet stock. Check service errors leave the affected figures blank.
5. Inspect desktop and mobile layouts with the actual login, sign-out clearing,
   keyboard navigation and refresh. Do not take screenshots containing customer
   names, credentials or workbook financial details.
6. Only after those checks, change `managementDashboard` to true and publish the
   website. Super Admin enters the dashboard; `portal.html?view=inventory` keeps
   the existing editor available. Password recovery and dispatch-draft iframe
   flows retain their existing routes. Other staff roles keep their current home.

Rollback: turn the gate off; no database rollback is needed. The disabled gate
does not replace endpoint access control.
