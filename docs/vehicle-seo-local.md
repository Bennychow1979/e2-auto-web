# E2 vehicle SEO — local review only

Historical prototype notes below. The current complete proposal, image design, full inventory evidence and remaining activation steps are in [vehicle-seo-complete.md](vehicle-seo-complete.md). Its completed items supersede the earlier open engineering items below. The two independently reviewed small patches remain frozen.

Base: `e2e32cc688bdd6472320148ce1d3fb8d3ca93f90`. Nothing in this change has been committed, pushed, deployed, scheduled or submitted to Google.

Release scopes are independent. The customer initialization fix and five-runtime-file photo-loading fix can each ship without activating static routes or changing booking, Stock Request, SQL, RLS, accounts or roles. The booking/Stock Request work below is separate business development, never a prerequisite for these fixes or the SEO rendering change. The separately exported photo patch also includes two portable browser-test files so the existing `tests/**` CI filter runs its regressions.

The immediate fix renders verified vehicle facts before waiting for photo URLs. Photo timeout/failure leaves facts, calculator and enquiry controls usable. The album order, next/previous and retry remain intact. This can be reviewed separately from static URL activation.

The static prototype reuses `vehicleMetadata()` and `descriptionFor()`, writes three language pages at `/cars/<fixed-slug>/`, and preserves query links. It includes literal title, description, complete accessible H1, price, known specifications, canonical, hreflang, OG and parseable Car/Offer JSON-LD. Unknown engine size is omitted; no mileage is added to JSON-LD. Canonical and sitemap exclude sales/ref parameters; enquiry and language links preserve the intended referral. No vehicle, account, permission or schema is changed.

Generated artifacts carry an explicit snapshot timestamp. JavaScript rechecks publication, identity, price and status when opening the page. A confirmed unpublished/mismatched vehicle hides the cached body and removes canonical/schema. An unavailable backend or disabled JavaScript retains a labelled historical snapshot with live application and calculator controls disabled. This is NOT immediate removal from the raw hosted HTML: that requires a successful rebuild/deployment or dynamic request-time rendering.

## Local commands

Use Node 24 LTS. `npm run test:vehicle-pages` checks routes, safe escaping, fixed slugs, staged rebuilds, completeness, withdrawal and the two explicit Sold sitemap policies. `npm run test:vehicle-browser` runs desktop/mobile fixtures. Set `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH` if using an installed browser. Optional `E2_TEST_BASELINE=1` compares the saved production source and verifies the immediate photo fix with unchanged production helpers; it requires the named base commit in local Git.

`node scripts/build-car-pages.mjs <fresh-snapshot.json> <separate-output-folder>` is explicit and performs no network requests or deployment. `fetchPublicSample()` requires 1–10 exact IDs. The separately tested `fetchPublicInventory()` draft requires complete count-checked pagination and two agreeing reads; it is not invoked automatically. Only anonymous publishable credentials are accepted. No service role key is used.

A build validates every input first, stages the whole output beside the explicit destination, removes only manifest-listed generated files in staging, then swaps the generated directory. Earlier output is retained as a sibling backup. Empty, stale, malformed, truncated or conflicting reads fail closed. Unexpected non-generated output directories and symlinks are rejected. Only the final output directory would be a future Pages artifact; backups must not be uploaded.

`data/car-slugs.json` is the seed; generated output contains the next persistent map. Existing and withdrawn ID mappings survive, model/price/plate edits do not rename URLs, collisions get an ID suffix, and missing plates use an ID fallback. Before enabling stateless CI, establish how the last approved map is supplied to every run. The current empty source seed is not a complete production slug registry. Newly published cars without a mapped page fall back to the working query URL.

## Exact remaining release requirements

1. Choose stable public main-image delivery and withdrawal behavior. Current Drive/photo APIs issue expiring URLs and recheck publication. The prototype does not freeze these URLs or copy a private bucket. Raw static pages therefore have descriptive alt text but no real main-image src, OG image or schema image yet. Album tests use explicitly labelled placeholders. The attachment's complete-photo acceptance criterion remains OPEN. Publishing permanent photo copies or adding a photo proxy needs its own reviewed access/cache/removal design.
2. Supply and persist the complete stable slug registry, validate the full public snapshot, and decide Sold sitemap policy. Default keeps published Sold pages and sitemap entries; `includeSold:false` is separately tested as the attachment's alternative. It never removes Sold pages. No status policy is silently selected from a reference attachment.
3. Connect approved Notion status changes to verified website inventory updates, then to a fresh staged build and explicit Pages deployment. A daily 06:00 Malaysia sweep can repair missed events; by itself it leaves up to about a day of stale raw HTML. A timestamp or client check cannot satisfy immediate raw-page withdrawal. Use dynamic rendering if immediate withdrawal is mandatory. New integration access, triggers and production writes require separate approval.
4. Preserve PDF assets, existing public/private routes, salesperson and partner behavior in a full release check. Static paths are currently outside the existing advertising path allowlist; expanding tracking must be separately reviewed, not silently enabled by SEO. Public non-JS enquiry goes to the E2 team because live salesperson visibility cannot be verified without JavaScript.
5. Review the disabled workflow draft alongside the current `deploy-pages.yml`. Use one complete artifact and explicit `actions/deploy-pages`; an automated `GITHUB_TOKEN` commit is not a Pages deployment. No automatic commit/push, new secret or schedule is installed by this prototype.
6. After separate publication approval, verify actual deployed source and normal customer flows. Existing Search Console and sitemap setup do not need repeating. No Google canonical, ranking or indexing outcome is guaranteed by local checks.

## Owner-confirmed stock rules, recorded 2026-10-12

Independent future business work only; not a release gate for login or SEO.

- Notion `已签待交` maps to `Sold`; `维修中已订` maps to `Reserved`. `publication` is independent.
- One vehicle can have multiple independent customer booking and loan cases. One declined loan must not remove other bookings, release the car automatically, or overwrite a Sold state.
- Interest in a Sold vehicle becomes a separate Stock Request for Benny to find a similar/replacement vehicle. Preserve the original source vehicle as Sold; leave the eventual matched vehicle unset until selected. Do not advertise the sold vehicle as deliverable.
- Deposits, expiration, automatic cancellations/refunds and later conversion from a Stock Request have not been specified. Do not infer these policies.

This is design scope only. Current source still filters `Available` in `car.js`, `my-e2.js`, `booking.js`, customer-workspace/loan-workflow/optional-intake/viewing-booking SQL and partner enquiry SQL. A later reviewed change must update all relevant frontend and server eligibility checks together; hiding/showing a CTA alone is insufficient. Booking here also has an existing viewing-appointment meaning, so the new business booking and Stock Request must not be conflated with it. No production schema or relationship has been inspected or changed for this proposal.

## Reference-spec decisions and current documentation

Read the complete 116-line `seo-static-car-pages-spec.md` from Library. Its 53-car count and asserted Google cause are not assumed current facts. We reuse its metadata and fixed-slug approach, reject expired image URL caching, and treat status/scheduling details as review decisions. The local three-record sample proves distinct source content, not a full-site inventory count.

Node 20 is EOL; Node 24 is supported LTS: https://nodejs.org/en/about/previous-releases

Google removed Vehicle Listing support from the Rich Results Test. No eligible Car rich result is not a syntax failure, and no price-rich-result promise is made. Local tests parse and check Car/Offer fields; external Schema.org validation remains a release check: https://developers.google.com/search/blog/2025/06/simplifying-search-results

GitHub documents the automated-token limitation and custom workflow publishing: https://docs.github.com/en/pages/getting-started-with-github-pages/configuring-a-publishing-source-for-your-github-pages-site
