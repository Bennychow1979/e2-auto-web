# Customer account and application acceptance

`customer-journey.spec.mjs` runs the real customer, My E2 and Documents pages,
including their production data adapters. Only the Supabase SDK boundary and
anonymous contact-list response are replaced with synthetic fixtures. All other
external HTTP requests are blocked and fail the test. No live account, email,
customer file, credential, SQL execution or permission change is required.

Run `npx playwright test tests/customer-journey.spec.mjs` for desktop and mobile
Chromium. Coverage includes registration and confirmation state, invalid login,
email-request cooldowns, password recovery, profile and draft retries, a complete
application, customer-owned progress, PDF/PNG upload and preview, replacement
failure, duplicate submission, lost upload-finalization responses, logout,
cross-tab account changes, and delayed responses after an identity change.
Same-account refresh events must preserve unsaved inputs.

This suite verifies browser behavior against a synthetic backend contract. The
`supabase/tests/{customers,loans,documents,case-submissions}.cjs` suites separately
exercise SQL authorization in PGlite. Neither proves current production migration
state, email delivery or callback configuration; those require a separately
approved live acceptance using designated test accounts and synthetic documents.

# Private document preview browser tests

These tests open the real `documents.html` and `intake-workspace.html` screens.
Only their data modules are mocked. Every identity, file and storage response is
synthetic, and the suite blocks and rejects all third-party HTTP requests.
Production credentials and real customer documents are never needed.

## Run

```sh
npm ci
npx playwright install --with-deps chromium
npm run test:browser
```

To use an existing Chromium installation:

```sh
PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/usr/bin/chromium npm run test:browser
```

The browser must be allowed to create its ordinary IPC sockets. A sandbox that
denies Chromium's Unix sockets fails before test bodies can run; do not treat
that infrastructure failure as an application test result.

The configuration starts a same-origin static server and builds PDF.js assets.
Desktop and touch/mobile Chromium each exercise customer Documents, staff
Documents, and staff Customer intake. Coverage includes two-page rendering
(verified through canvas pixels), pagination, landscape resize, original-file
downloads, images, corrupt PDFs, unavailable renderer code, storage failures,
loading cancellation, authentication changes, repeated opens and URL cleanup.

Each successful PDF test attaches a screenshot. Optionally write the customer
screenshots to a chosen directory as well:

```sh
PLAYWRIGHT_SCREENSHOT_DIR=/tmp/e2-preview-screenshots npm run test:browser
```

## Manual, synthetic-only visual review

For an ordinary browser that can reach the machine running this server:

```sh
npm run build:pdf-preview
E2_PREVIEW_TEST_FIXTURES=1 PLAYWRIGHT_PORT=4174 node tests/serve.mjs
```

Open one of these local pages:

- `http://127.0.0.1:4174/documents.html?application=11111111-1111-4111-8111-111111111111`
- `http://127.0.0.1:4174/documents.html?application=11111111-1111-4111-8111-111111111111&staff=1`
- `http://127.0.0.1:4174/intake-workspace.html`

This opt-in mode rewrites test-server responses only. It never changes the
production HTML or data modules. Do not enable it on a production server.


# Customer initialization timing

`customer-initialization.spec.mjs` covers refresh/initial-session ordering, the
profile-to-My-E2 link, stale identity reads, sign-out and account changes, and
same-revision stale profile submissions. It uses synthetic SDK/session state.
Set `E2_TEST_BASELINE=1` locally to also compare the published `e2e32cc` behavior;
that optional comparison requires the commit in local Git history and is not
enabled by default in shallow CI checkouts. No real credentials are used.

# Financing-case browser tests

`financing-case.spec.mjs` exercises the staff financing page with a fully mocked
`financing-data.js` adapter and synthetic source/documents/institutions. It
covers both source types, Salesman reviews, coordinator handover/reassignment,
Submission Admin isolation, independent portal/email tracking, missing items,
explicit human submission evidence, lender outcomes, selected offers, draft
retry/error preservation, stale configuration, auth races and PDF cleanup.

Portal popups are synthetic stub objects; no lender page opens in the tests.
All third-party requests are blocked and asserted absent. The checked source,
files and case revision arrive as one database snapshot in production; the
adapter unit suite independently verifies that boundary.

The finance suite has 96 desktop/mobile cases, including global coordinator
visibility and cross-coordinator assignment without submission powers. Its screenshot test can capture
synthetic multi-institution views when run on a browser-capable host. Test
collection alone is not an executed browser pass.
