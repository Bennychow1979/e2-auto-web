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
