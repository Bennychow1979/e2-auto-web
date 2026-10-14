# E2 static vehicle pages - Pages release candidate

Current release status (2026-10-14): the separately authorized `e2-drive-photos` deployment is complete (production version 4, public-image contract v2). This candidate now wires the existing Pages workflow to a fresh complete static build and uploads only `_site`. Pages publication is still pending separate approval. See [the exact Pages activation and rollback procedure](pages-release.md); it supersedes earlier local-only release instructions below.

Revision: **image v2** supersedes the earlier frozen complete proposal. The upload object UUID is independent of `vehicle_photos.id`; see [the image v2 approval and verification contract](public-image-v2.md). Earlier v1 test results and public probes are historical evidence, not a v2 release approval.

Integrated base: `905b410c57a75978d52604b6f4d344aa71856897`, verified against remote main on 2026-10-13. PR #8 customer initialization/text-before-photos and PR #9 mobile CSS are already on this base and retained. This local SEO integration has not been committed, pushed or deployed; it adds no production SQL, role/account change, Notion write or active schedule/webhook. Use the single new-base integration patch instead of stacking the older full patches. A persistent Stock Request or booking/loan backend is separate business work, not a prerequisite for SEO.

## Full public inventory

The anonymous read at 2026-10-12 17:59:30 UTC returned 57 published vehicles: 55 Available, zero Reserved, two Sold. Count-checked pagination is read twice and must agree. Public first-photo metadata then checks the same IDs/update timestamps. All 57 have a main photo: 41 Drive, 16 upload. No real photo bytes were downloaded.

The local complete artifact contains 171 vehicle pages (57 each EN/BM/ZH), 57 fixed unique slugs, six Sold language pages and 178 sitemap entries including seven non-vehicle URLs. Raw HTML includes year/brand/model/variant H1, known facts, price, canonical/hreflang, main image URL/alt, OG image and parseable Car/Offer JSON-LD. Unknown facts remain absent or pending. Full generation uncovered an empty-field translation bug, now fixed and tested.

## Stable image delivery

The local change to the existing `e2-drive-photos` function adds:

`/functions/v1/e2-drive-photos?public_vehicle=<vehicle UUID>`

It always begins with anonymous public RLS, ignoring any caller's Authorization header, selects the current first photo, then rechecks publication, plate, first-photo identity/path/order/source and the entire Drive association after retrieval. Uploads use the exact associated path in the private `vehicle-photos` bucket, constrained to `<vehicle UUID>/<independent object UUID>.webp`, with WebP and 3 MiB checks. Drive uses the existing adapter with exact vehicle/photo association, folder/root/plate/checksum/type/size validation. Public failures are generic and cannot reflect upstream payloads or signed URLs. Responses use `no-store`. HTML never contains a signed ticket or Google file identifier. No SQL, bucket policy, secret, role or `verify_jwt` setting changes are proposed.

HEAD verifies route capability/linkage with zero downloaded image bytes. It does not prove every object's bytes decode or download. The approved deployment report records one Drive and one upload GET/HEAD smoke test, successful decoding and v2 headers. Local endpoint tests use synthetic bytes and cover draft refusal even with staff headers, withdrawal during fetch, removed photos, invalid paths/types/checksums and zero-byte HEAD. Those negative tests were not repeated by mutating production records.

Historical probes on 2026-10-12 returned HEAD 405 and GET 400 for the proposed route; the legacy signed GET remained healthy. Those results are superseded by the 2026-10-14 function deployment report and current v2 HEAD checks. `--release` requires every required main-image HEAD to return image MIME, `X-E2-Public-Image: v2`, `no-store`, `nosniff`, `inline` and `no-referrer`; v1 cannot pass. Failure preserves the prior artifact. The manifest records `imageGatewayVersion` and `imageGatewayCheck: HEAD`, which explicitly does not certify every GET body or Pages deployment.

## Persistent slugs and safe builds

`data/car-slugs.json` contains the 57 reviewed identities. Price/model/plate edits do not rename links; withdrawn IDs retain their mapping; collisions use a UUID suffix and missing plates use an ID fallback. All legacy language query links remain supported. Newly published unmapped cars retain their working query URL.

`scripts/fetch-vehicle-build-input.mjs` reads the previously deployed public `/data/car-slugs.json` before a fresh full inventory read. Invalid/conflicting maps and HTTP failures stop the build. Only explicit first-activation `--bootstrap` permits a 404 and uses the reviewed seed. Subsequent builds carry forward the deployed registry, including withdrawn mappings, without commit bots, PATs or `contents:write`.

Whitelisted public metadata only enters the build. Empty, stale (over 30 minutes), truncated, duplicate or inconsistent snapshots fail closed. An isolated stage is validated before swapping the output directory; the old output remains a sibling backup. Only manifest-listed generated pages are pruned. Unsafe manifests/symlinks are refused, and unrelated files survive. Never upload backup directories.

```powershell
npm run test:vehicle-pages
npm run test:vehicle-browser
npm run check

# Explicit acquisition and local candidate only; does not deploy.
node scripts/fetch-vehicle-build-input.mjs public-inventory-snapshot.json --bootstrap
node scripts/build-car-pages.mjs public-inventory-snapshot.json _site

# After image-route deployment and release approval; omit --bootstrap after first activation.
node scripts/build-car-pages.mjs public-inventory-snapshot.json _site --release
```

The existing `.github/workflows/deploy-pages.yml` now invokes the static generator, validates the complete output and uploads `_site`. Its existing main-push/manual deployment remains the only publication path. The separate inventory event/daily proposal stays outside `.github/workflows`, with a false job condition and exit gate; no new trigger or schedule is activated.

## Sold inquiry and status

Sold pages retain facts and SoldOut schema while hiding viewing/finance controls. Three-language copy labels the sold price and offers a similar-car enquiry. Its WhatsApp draft preserves the original source vehicle and expressly asks for a similar car. Rendering creates no account, booking, application, deposit or Stock Request record. Live sales routing remains available; no-JavaScript enquiry uses E2's company contact. Benny assignment and persistent source/replacement relationships require separate business backend work.

Live public status overrides the snapshot. A confirmed withdrawn/mismatched vehicle hides the body and removes canonical/schema/OG image. Unavailable backend or no JavaScript retains a labelled saved snapshot with live application/calculator controls disabled. This cannot immediately remove hosted raw HTML; a successful rebuild/deployment or dynamic rendering is required.

Owner-confirmed future rules: `已签待交` maps to Sold; `维修中已订` maps to Reserved. Multiple independent customer cases are allowed. One rejected loan must not cancel other cases or overwrite Sold. A Sold inquiry creates a separate future Stock Request with original Sold source and unassigned replacement. Deposit/expiry/cancellation/refund policies remain unspecified. No backend mutation implementing these rules is included.

## Approved update design — pure simulation, activation off

The owner selected authoritative inventory-change events plus a daily full reconciliation. Notion changes enter this same path only after successful inventory synchronization. `data/inventory-refresh-policy.json` records `events-with-backup` and 1,440 minutes with `enabled:false`; the planner's generic default remains inert/manual. Simulations cover bounded coalescing, late/duplicate revisions, checkpoint restart, distinct retry attempts, newer changes during builds, predeployment projection mismatch, independent daily reconciliation, explicit stale state and no false deployment claim. They register no event/job and never call Notion or mutate inventory. See [the exact integration and minimum-access plan](inventory-update-integration.md).

| Policy | Raw HTML delay | Limitation |
| --- | --- | --- |
| Manual | Human response plus build/deploy | No finite bound |
| Daily sweep | Up to 24 hours plus build/deploy | Cannot promise near-current inventory |
| Hourly sweep | Up to one hour plus build/deploy | Stale between successful runs |
| **Selected: per verified change + daily reconciliation** | Proposed 30-second coalescing plus build/deploy; 10-minute normal-operation target | Missed events may wait one day plus build/deploy; not a guaranteed 10-minute maximum |

Failures extend all delays. The event-plus-daily design is selected; its target is not a hard freshness guarantee. Immediate raw-page withdrawal requires dynamic rendering. Actual trigger/schedule activation and any new persistent access still need separate approval: wait for verified inventory commit, wake a fresh complete public read, verify source revision/order, serialize builds, reject obsolete completions and explicitly deploy only a passing artifact. Never trust a delayed Notion payload to directly overwrite stock status. No real trigger, new permission or Notion write is activated here.

## Exact remaining release steps

1. Review the single integration patch against current main and pass final PR CI, preserving existing PDF/public/private pages and the already released PR #8/#9 fixes. Local compatibility work does not wait for staging access.
2. Reuse the completed, separately approved image-function version 4 deployment and bounded GET/HEAD evidence. Do not redeploy the function, change its JWT setting or repeat staging setup for this Pages release. Source files in this patch record the already deployed public route; the Pages workflow cannot deploy Edge Functions.
3. Follow `pages-release.md`: after separate publication approval and passing PR CI, merge this reviewed candidate and dispatch the first release with `bootstrap_registry=true`, `restore_previous=false`. Acquire a fresh complete snapshot and prior registry, build with `--release`, validate `_site`, then publish. Check actual deployed source, normal customer Continue flow and album retry. Use the verified artifact restoration branch for rollback.
4. Separately approve actual activation of the selected event-plus-daily design and any exact missing restricted access. Current published Sold listings remain in the sitemap; tested `includeSold:false` is available if requested and never removes Sold pages.

Advertising consent logic/path allowlist remains unchanged: new static paths do not activate Meta tracking. That measurement limitation is disclosed rather than silently expanding tracking. Referral behavior remains tested.

No authenticated Supabase schema state, actual login, staff role or production financing migration was inferred from public reads. No Google indexing/ranking/canonical selection outcome is claimed; existing Search Console setup need not be repeated.

References previously checked: [Node support](https://nodejs.org/en/about/previous-releases), [Google Vehicle Listing test retirement](https://developers.google.com/search/blog/2025/06/simplifying-search-results), [GitHub Pages publishing](https://docs.github.com/en/pages/getting-started-with-github-pages/configuring-a-publishing-source-for-your-github-pages-site).
