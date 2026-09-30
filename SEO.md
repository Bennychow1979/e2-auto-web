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

`npm run build:sitemap` reads anonymous published inventory and creates the
ignored `sitemap.xml`. GitHub Pages runs this before each deployment, failing
the deployment if inventory cannot be retrieved instead of publishing a partial
sitemap. `robots.txt` advertises its public URL. This does not require a service
role key or staff session.

The sitemap refreshes on a code deployment or manual deployment workflow run.
Database-only inventory changes do not trigger a Pages build automatically;
new vehicles can still be discovered through the live showroom links. Connect
inventory publication events to a rebuild if immediate sitemap refreshes are
required. Do not commit short-lived signed photo URLs to a sitemap.

## Remaining work

Use the owner's verified Search Console property to submit the sitemap and
inspect representative vehicle URLs. No Search Console submission is performed
by this code. Vehicle content still depends on JavaScript; public prerendered
vehicle content and stable public photo URLs are separate follow-up work.

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
the new source is shown until its translation is reviewed; stale translated claims
are never substituted for updated inventory copy. New structured vehicle records
and interface labels use the selected language automatically.
