# Inventory changes to the published site

Implementation is prepared locally, not activated in production. The database
migration defaults to disabled and does not schedule work. The old
`data/inventory-refresh-policy.json` / `scripts/inventory-refresh-policy.mjs`
are an inert planning prototype, not the runtime switch. Do not turn their JSON
flag on and assume that a worker exists.

## Existing system and chosen route

Inventory is changed through direct authenticated `vehicles` writes in
`portal.js`, the importer RPCs (new imports remain Draft), and the lifecycle RPC
in `202610220001_vehicle_recycle.sql`. A browser-save-only hook would miss imports,
SQL updates, withdrawal/archive and deletion. AFTER triggers on `vehicles` and
`vehicle_photos` therefore record one durable dirty revision inside the same
transaction. Rolled-back changes leave no event. Draft-only changes do not rebuild;
new publication, published edits, public photo changes, withdrawal and deletion do.
No row contents or private fields are copied into the queue or sent to GitHub.

The repository already uses pg_net plus database-created, short-lived one-use
capabilities to wake its import/viewing Edge workers. The new worker follows that
pattern. No existing GitHub dispatch credential or enabled refresh integration was
found in repository source/configuration. No credential values were inspected.
A new narrowly scoped GitHub capability is therefore an activation dependency,
not something already available merely because Codex can access GitHub interactively.

Flow: committed database event -> singleton dirty revision -> one-minute outbox
delivery tick -> authenticated one-use Edge invocation -> fixed GitHub
`deploy-pages.yml` workflow dispatch on `main` -> fresh anonymous public reads ->
one artifact containing stock.txt, all vehicle pages and sitemap -> live receipt.
The minute tick drains committed events; it does not rebuild an unchanged catalogue
every minute. Daily reconciliation is only a recovery path.

## Reliability and limits

* A 30-second debounce measured from the first pending event coalesces bursts
  without allowing continuous updates to postpone a build forever.
* The database stores an attempt UUID/revision before sending. One active attempt
  is checked for publication rather than repeatedly dispatched. A worker lease
  prevents overlapping ticks. GitHub Pages runs do not cancel an in-progress run.
* The workflow performs two matching exact-count public reads and checks the
  public projection again immediately before deploying. A changed candidate fails
  before publication. Events received during a build remain dirty for the next run.
* A confirmed zero count from both complete reads produces a complete zero-row
  stock.txt, removes all generated vehicle pages and vehicle sitemap entries, and
  retains the non-vehicle site. Missing counts, malformed responses, read failures,
  unconfirmed empty input, oversized stock and inconsistent reads still fail.
* The staged artifact gate checks the stock contents and receipt. After deployment,
  exact manifest, stock and sitemap bytes are read with cache-busting URLs. The
  worker acknowledges only a matching live attempt/revision, complete stock
  footer/time and exact stock/sitemap SHA-256 hashes from the manifest, not HTTP
  acceptance from GitHub or a successful build alone.
* Known GitHub rejections/failed runs retry with exponential delay capped at one
  hour; explicit GitHub rate-limit delays can extend that wait up to one day.
  Missing or ambiguous receipts are checked first, then retried after a
  30-minute attempt timeout. An accepted request can outlive that timeout, so a
  duplicate idempotent build is possible; it cannot clear a newer dirty revision.
* Expected pickup is roughly 30-90 seconds plus GitHub runner queue, full build,
  deployment and CDN propagation. The last measured production build took several
  minutes. This is automatic eventual publication, not instant withdrawal and not
  a hard ten-minute SLA. GitHub outages, continuous changes or build failures can
  delay publication indefinitely; inspect the persisted pending revision/issue.
* Failure keeps the last successful static artifact and its original timestamp.
  Cache-busting avoids acknowledging an old receipt; it cannot purge every CDN,
  browser or assistant cache or recall an already downloaded file. Plain URL
  consumers may retain old data until their cache expires (the live stock response
  observed on 2026-10-31 advertised `Cache-Control: max-age=600`). AIRA must still inspect
  snapshot_at/footer and verify current public details, especially before treating
  a listed vehicle as available. Guaranteed request-time Draft suppression would
  require a separate dynamic serving/filtering design.
* The 18,000-character stock budget remains enforced. Growth beyond it blocks the
  build visibly and remains pending; no records are dropped to make a build pass.

## Production activation: separate owner approval required

Nothing below has been executed by this feature implementation.

1. Approve/review the code, database migration, new Edge endpoint authentication
   and scheduler. Publish the repository change through the normal Pages workflow.
2. Apply `202610310001_inventory_refresh.sql` as the database administrator. It
   creates private queue state and service-role-only worker RPCs; browser roles
   cannot read state, enqueue arbitrary dispatches or acknowledge publication.
3. The owner creates a fine-grained GitHub token restricted to
   `Bennychow1979/e2-auto-web`, with **Actions: write** and required metadata access,
   expiry and an agreed rotation owner. This is new persistent access and needs
   action-time approval. It can dispatch workflows in that repository, not only
   this workflow; the code itself fixes the target workflow/ref. No Contents write
   or other repository/account scopes are needed. The owner enters it directly in
   Supabase Edge secrets as `E2_INVENTORY_GITHUB_TOKEN`; do not paste it into chat,
   source files, command history, logs, the public configuration or SQL.
4. Deploy only `e2-inventory-refresh`. Its proposed `verify_jwt=false` route replaces
   gateway JWT checking with an atomic one-use database capability, matching the
   existing worker pattern; this security-sensitive activation requires approval.
   Public website keys, browser origins and reused/expired capabilities are denied.
   The function uses Supabase's existing built-in service role only inside its
   server runtime; do not export it or add it to GitHub.
5. Verify existing pg_net/pg_cron availability, then run
   `activate-inventory-refresh.sql`. It enables this queue and adds only the named
   one-minute delivery job. Do not install extensions or change other schedules
   implicitly. The initial pending revision causes one initial full reconciliation.
6. Review the queue and GitHub run, and verify the matching live receipt and public
   outputs. Test with an owner-approved synthetic vehicle: Draft -> published ->
   Reserved/Sold -> Draft, plus a burst. Confirm withdrawal from stock, sitemap and
   every generated language page. Do not empty production stock for a test; zero
   inventory is covered locally. Do not claim live automatic delivery until an
   actual committed change is observed end to end.

Read-only status (authorized database administrator, no secrets):

```sql
select enabled,revision,deployed_revision,first_dirty_at,changed_at,dispatch_id,
       dispatch_revision,dispatched_at,attempts,available_at,last_issue,last_deployed_at
from public.e2_inventory_refresh where singleton;
```

Pause the named worker without losing pending changes:

```sql
update public.e2_inventory_refresh set enabled=false where singleton;
select cron.unschedule('e2-inventory-refresh');
```

Already accepted GitHub runs can still finish after pausing. Review/cancel those
individually if necessary; disabling the scheduler alone is not a deployment lock.

## Validation

`npm run check`, `npm test`, and `npm run test:inventory-refresh` exercise SQL
permissions, committed/rolled-back events, Draft filtering, photo changes, delete,
burst coalescing, newer revisions during a build, one-use tokens, wrong/expired
leases, timeout/backoff, failure/ambiguous outcomes, predeploy projection checks,
live receipt/cache handling and confirmed zero-inventory publication. Network tests
use injected synthetic responses and never dispatch production workflows.

Protocol references:
[Supabase database webhooks](https://supabase.com/docs/guides/database/webhooks),
[GitHub workflow dispatch permissions](https://docs.github.com/en/rest/actions/workflows#create-a-workflow-dispatch-event).
