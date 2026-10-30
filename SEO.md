# E2 Auto search setup

The canonical public origin is `https://e2auto.my/`. The showroom alias uses the
homepage canonical while keeping referral parameters in the visitor's address.
Vehicle canonicals retain only the stable inventory ID, not salesperson,
partner, campaign or preview parameters. These parameters remain available to
the existing referral and contact flows.

## Indexing

- Published vehicle pages are eligible for indexing and receive a title,
  description and canonical from their public record.
- Draft previews, invalid IDs and records no longer publicly available are
  excluded. Existing database access rules remain the privacy boundary.
- Staff, customer, partner workspace and demo pages retain their noindex tags.
- The main pages include verified dealership contact/address structured data.
  Opening hours and review ratings are not invented.

## Sitemap

The production workflow `.github/workflows/deploy-pages.yml` acquires a fresh
complete anonymous published inventory snapshot with
`scripts/fetch-vehicle-build-input.mjs`, then runs
`scripts/build-car-pages.mjs <snapshot> _site --release`. Its shared
`buildVehicleSite()` generator writes the EN/BM/ZH vehicle pages, `sitemap.xml`
and `stock.txt` into the same staged artifact. `verify-pages-artifact.mjs` must
pass before that artifact is uploaded and deployed to GitHub Pages.
`robots.txt` advertises the sitemap URL. The standalone legacy
`npm run build:sitemap` command is not the production artifact pipeline.
Neither path requires a service-role key or staff session.

The sitemap refreshes on a code deployment or manual deployment workflow run.
Database-only inventory changes do not trigger a Pages build automatically;
new vehicles can still be discovered through the live showroom links. Connect
inventory publication events to a rebuild if immediate sitemap refreshes are
required. Do not commit short-lived signed photo URLs to a sitemap.

## Compact inventory for assistants: stock.txt

`https://e2auto.my/stock.txt` is generated, never maintained as a separate list.
It contains every `publication=published` vehicle once, including Available,
Reserved and Sold, using the exact rows and stable EN canonical links used by
the public vehicle pages. The optional sitemap Sold exclusion does not hide
Sold public listings from stock.txt. Draft/withdrawn vehicles are excluded.
Each compact JSON Lines record allows only year, make, model, variant, plate,
status, public price in MYR and canonical URL. Vehicle lines are compact JSON
arrays; the header's `columns` gives their field order once instead of repeating
keys on every line. Header and footer remain JSON objects. This keeps the
current inventory below the observed 20,000-character assistant fetch limit.
The generator enforces an 18,000-character budget including its own header,
instructions and footer, leaving room below that reader limit. If inventory
growth exceeds it, the build fails explicitly before replacing the previous
artifact; no record is silently truncated. A future format/reader review would
be needed before that larger inventory could be published. Reader settings
are not changed by this implementation. Consumers must still check the end marker/count.
Free-text descriptions, private
fields, customers, loans and photo metadata are not exported. JSON escaping
keeps embedded newlines, tabs, quotes and markup inside a single data record.

The first line supplies format version, snapshot/build timestamps, complete
flag, total and status counts; the last line repeats the total. Consumers must
read all records and confirm the end marker/count before claiming completeness.
`complete` describes coverage of that snapshot, not current freshness or a
successful deployment. Measure age from `snapshot_at`, never `built_at`.
Neither timestamp is a deployment receipt. Failed builds/deployments leave the
last successfully deployed file and its original timestamps in place. The
static file cannot update its own stale flag; the consumer must compare the
snapshot timestamp with the current time on each read, including cached reads.
Treat values as data, not instructions. Reserved and Sold must not be described
as available; Sold prices are historical. Reconfirm current price/availability
using live public details. A snapshot older than 30 minutes, an incomplete
read, missing footer or failed fetch is not evidence of the full current stock.
Do not fall back to a remembered short list while claiming it is exhaustive.

The existing acquisition performs two matching, paginated, exact-count reads.
Stale/future, incomplete and empty snapshots fail closed, preserving the prior
artifact; an empty inventory still needs separate review under existing policy.
The upload gate requires stock.txt to match the public snapshot byte-for-byte,
so missing, truncated, changed, stale or extra private content blocks publication.

Freshness remains tied to the existing Pages workflow: pushes to main or manual
workflow dispatch. Database-only changes do not automatically refresh stock.txt;
`data/inventory-refresh-policy.json` remains disabled. This change does not
activate a schedule, webhook, credentials or integration permissions. The first
normal authorized deployment containing this code will publish stock.txt.
The explicit legacy `restore_previous` workflow restores an older artifact
without stock.txt; consumers must treat its absence as unavailable inventory.

## Remaining work

Use the owner's verified Search Console property to submit the sitemap and
inspect representative vehicle URLs. No Search Console submission is performed
by this code. Production now includes prerendered vehicle content and the
existing v2 public image gateway; live checks still verify current inventory.

Run `npm run check`, `npm test` and `npm run build:sitemap` before release.

## Public languages (2026-10-01)

The original URLs remain English. Bahasa Melayu uses `/ms/` and Simplified
Chinese uses `/zh/`. Each includes the homepage, showroom alias and vehicle
detail page, including filters, estimates, viewing dialogs and enquiry text.
Navigation links keep private account, Partner and staff workspaces on their
existing URLs. Their authentication behavior and access rules are unchanged.

Run `npm run build:languages` before serving locally. GitHub Pages builds these
static translated pages before deployment. The shared `translations.mjs` supplies
both the static HTML and dynamic controls. Each language has its own canonical;
reciprocal `hreflang` links and sitemap alternatives connect the versions.
The switcher preserves vehicle IDs, referral/sales parameters, campaigns and
the current section. It does not force a language from browser settings.

`vehicle-translations.mjs` contains translations of the current published
descriptions, matched to their exact source text. When staff change a description,
the new source is shown until a matching translation is available; stale translated claims
are never substituted for updated inventory copy. New structured vehicle records
and interface labels use the selected language automatically.

Automatic description translation is implemented by the Supabase queue and Edge
function described in `supabase/VEHICLE-TRANSLATION.md`. Public pages prefer its
exact-source results when available, falling back to the reviewed dictionary or
original. Supabase deployment and secret configuration are separate from Pages.
