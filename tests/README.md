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

The finance suite has 122 desktop/mobile cases, including global coordinator
visibility and cross-coordinator assignment without submission powers. Its screenshot test can capture
synthetic multi-institution views when run on a browser-capable host. Test
collection alone is not an executed browser pass. It also covers the 13-name
pending checklist, inactive configuration prefilling, failed checklist fetches,
distinct profile-less staff labels and the same-assignee submission guard.

The cancellation regressions defer and reorder email checks across close/reopen
and page visibility changes. Older success and failure responses cannot affect
a later opening. Assignment coverage also checks repeated saves, stale-owner
conflicts with explicit refresh, and page departure during an in-flight save.
Both source types discard late file bytes after a preview is closed and a refresh
reports revoked access. Database tests separately enforce real RLS/RPC checks.
