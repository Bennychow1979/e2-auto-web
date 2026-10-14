# Static vehicle Pages release

Candidate base: `905b410c57a75978d52604b6f4d344aa71856897` (PR #8 and #9 included). This document describes a reviewable release; no Pages publication has been performed by this preparation task.

## Completed prerequisites

- The owner accepted the local static preview. The accepted integration passed 412 existing Chromium cases, 40 static-page browser cases, the full npm suite and 177 historical no-JavaScript page checks. These are reused regression results, not new production tests.
- The separately authorized minimal-r1 `e2-drive-photos` package was deployed as version 4 on 2026-10-14 at 02:17:30 UTC. Package SHA-256: `d51cd2ea3b915d990e930b3c7a11767c664f0c38ae5013d4e85e04975d9ef31d`. The deployment report records one successful Drive and one upload GET/HEAD sample and unchanged JWT-off setting. No redeployment is part of this Pages release.
- Independent current public HEAD probes passed for both samples. A complete public snapshot acquired at 03:14:53 UTC contains 57 published vehicles and 57 main photos. The release build passes all required v2 HEAD checks and produces 171 vehicle pages and 178 sitemap URLs. HEAD checks download no photo bytes; they do not certify every image body.
- The official current Pages artifact, from successful run `38404893260`, artifact `11818585986`, is preserved as `.release-backups/e2-pages-905b410.zip`. SHA-256: `2bf6564c2b910d9c1b878f6fdecc9b5ad9e5125cacda9749f1367f3a67db1e0d`. It restores 484 files exactly, with tree digest `c82dd669144b93a6bb0c89da303faa8f0a9cff5d745c89f61e9e2993c6330f2b`. Its saved copy does not depend on the remote artifact retention period.

## Proposed release scope

The existing `deploy-pages.yml` builds the PDF renderer, checks templates and packaging, acquires fresh anonymous public metadata, invokes `build-car-pages.mjs ... _site --release`, validates `_site`, then uploads only `_site` to the existing Pages deployment action. All required current first images must return successful v2 HEAD responses with defensive headers before the artifact can pass.

The validator checks raw HTML/canonical/structured data, registry and sitemap counts, and preserves customer initialization, mobile CSS, public runtime configuration, privacy, documents, PDF files and the existing model-year catalogue. The generator now explicitly copies `verified-model-years.json`, which the existing staff catalogue aid fetches at runtime. This is a packaging fix; no inventory or catalogue content changes.

The custom domain remains in GitHub Pages settings; current main has no `CNAME` file. No DNS or hosting setting change is proposed. Build inputs, source-control folders, SQL/functions, test/tooling directories and the rollback archive are excluded from the new public artifact. The source patch also records the already deployed image-route source. The workflow has no function deployment command.

Existing token permissions remain `contents: read`, `pages: write`, `id-token: write`. Existing triggers remain main push and manual dispatch. No new secret, database migration, SQL execution, RLS/bucket/role change, customer-finance access, JWT change, paid service or inventory schedule is part of this release.

## Separate publication approval

1. Approve the final candidate patch and its digest for a PR, passing remote CI, merge and initial Pages publication. Recheck current main and resolve any changes before merge; do not approve a different patch implicitly.
2. After CI passes and merge is approved, merge the reviewed patch. The automatic push run has `bootstrap_registry=false`. The deployed registry returned 404 at 03:25:28 UTC, so this first automatic run will stop before uploading or deploying; the prior live site remains available.
3. Dispatch **Deploy E2 Auto to GitHub Pages** on `main` with `bootstrap_registry=true`, `restore_previous=false`. This first-release switch permits only a missing (404) registry to use the reviewed seed. It does not bypass malformed/conflicting maps, inventory completeness/freshness checks, image checks or artifact validation. Every run reacquires inventory; do not publish the saved local snapshot later as though it were fresh.
4. Require the build, upload and deployment to succeed. Verify a newly deployed Available and Sold page in each language: literal raw HTML facts/canonical/JSON-LD, same-car language links, safe Sold enquiry and main image. Check legacy query links, normal customer Continue/navigation, text before album completion/retry, mobile finance layout and PDF assets. Use existing authorized sessions only; a production finance application or login is not part of the smoke test.
5. Normal later main pushes/manual releases use both inputs `false` and preserve the deployed slug registry, including withdrawn mappings. A failing gate must leave the prior deployment unchanged.

No release approval has yet been executed in this task. Local checks do not substitute for remote PR CI or post-publication verification.

## Pages-only rollback

If the Pages release has a material regression, use the separately approved rollback action: dispatch the same workflow on `main` with `restore_previous=true`, `bootstrap_registry=false`. Never set both inputs true.

The restoration path skips npm/build/inventory acquisition and the image gateway. It first tries to save the current public slug registry as a separate Actions artifact, then verifies and unpacks the pinned original Pages archive into a new `_site`, and deploys those original files. Registry capture is best effort and cannot block urgent restoration. Archive digest, unsafe paths or an existing output directory cause restoration to fail before publication. The files are restored without rebuilding against newer dependencies or inventory.

Keep image function **version 4** in place: the old Pages version still uses its preserved legacy routes. This action must not revert the function, secrets, JWT, DB or access policies. Verify the old customer/mobile flows after restoration. Before resuming static SEO later, recover the newest saved slug registry and review it into the seed; if capture failed, recover the last static deployment artifact/registry before approving another bootstrap. Do not silently reset mappings for newly added or withdrawn vehicles.

## Inventory refresh remains off

The owner-selected inventory-event plus daily reconciliation design remains `enabled:false`, and its proposal remains outside `.github/workflows`. This release refreshes static inventory only on successful existing push/manual deployments. Without a subsequent rebuild, raw HTML and sitemap can become stale; client-side live availability checks do not immediately remove hosted source HTML. Actual event/daily activation and any associated persistent permissions require their own concrete approval.

Staging authentication, production financing schema, actual staff logins and TONG EN/Jean accounts have not been inferred or changed by these public checks. Existing Search Console configuration does not need to be repeated, and no indexing/ranking outcome is promised.
