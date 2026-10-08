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
