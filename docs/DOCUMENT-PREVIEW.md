# Private document preview

`documents.js` (customer and staff loan documents) and `intake-workspace.js`
share `document-preview.js`. Their existing authenticated Storage downloads and
bucket permissions are unchanged. The preview validates file signatures, holds
the downloaded bytes in memory, and always keeps a Download file link once the
file is available.

PDF.js is pinned in `package-lock.json`. `npm run build:pdf-preview` copies its
legacy browser build, worker, fonts, CMaps, ICC profiles, WebAssembly assets and license to
`vendor/pdfjs/`. These generated assets are served by this site. No document is
uploaded to an external viewer or converted to a public/signed Storage URL.
The Pages workflow builds these assets before publishing the site.

PDFs render one page at a time, with previous/next controls and an optional page
text view. Canvas resolution and PDF page caches are bounded for mobile use.
Closing, Escape, sign-out/account change, navigation, and replacement discard
the preview, cancel rendering, destroy the worker and revoke its object URL.
Protected/damaged PDFs or renderer failures retain Download file as a fallback.

## Local checks

Use Node 22.13+ or 24+.

```sh
npm ci --ignore-scripts
npm run check
npm test
npx playwright install chromium
npm run test:browser
```

To use an already installed Chromium, set
`PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/path/to/chromium`.

The browser suite uses synthetic PDF/image fixtures and mocks the two data
modules; it does not access production customer documents or credentials. It
covers customer Documents, staff Documents, and Customer intake on desktop and
mobile Chromium, including page rendering, download integrity, cancellation,
repeated opens, stale authentication, errors and object-URL cleanup. Mobile
Chromium emulation is not a physical iPhone/iOS Safari test.

## Release

Review the changes on a branch and run both the existing verification workflow
and the private-document browser workflow before merging. A push to `main`
automatically triggers the existing GitHub Pages deployment. No Supabase
migration or bucket permission change is required. Check a synthetic multipage
PDF in desktop Chrome and a physical iPhone/Safari before treating iOS support
as verified.
