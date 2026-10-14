# Inventory change rebuild: approved design, activation off

The owner approved rebuilding after authoritative inventory changes, with one daily full reconciliation. A Notion-originated change enters the same path only after its inventory write succeeds. This approval covers the local design and simulation; it does not create a token, webhook, schedule, permission, account or deployment.

`data/inventory-refresh-policy.json` selects `events-with-backup`, a 30-second coalescing window and a 1,440-minute reconciliation interval. `enabled` remains false. Ten minutes is a proposed normal-operation target, not a guaranteed maximum. Missed events can remain stale until the daily reconciliation plus build/deploy time; failures extend that delay. The eventual daily wall-clock time remains an activation detail.

## Trusted change boundary

Price, authoritative stock status (including Reserved/Booking and Sold), publication, public vehicle facts and first-photo changes wake a fresh complete public read. A customer booking request alone does not mark the vehicle Reserved. A raw Notion event, proposed edit, failed sync or browser timestamp is not authoritative and must not publish a status. The successful inventory commit is the boundary; the renderer never applies status or price directly from event payloads.

The checked-in Drive/workbook importer has an atomic commit/receipt boundary in `supabase/functions/e2-vehicle-import/run.mjs` and `index.ts`. This is evidence of a possible integration location, not evidence that a hosted Notion-to-inventory executor or SEO callback exists. Inspect the existing trusted sync executor before choosing the connector. A successful Notion sync must receive/verify the inventory commit result, then notify the same restricted rebuild coordinator.

The pure planner accepts a trusted, monotonically ordered coordinator `revision`, server receipt time and explicit `committed:true`. This revision is a proposed coordinator contract, not a claim that the current production vehicle schema already provides a global revision. Per-vehicle timestamps from unrelated sources must not be compared as a global sequence. The adapter must durably assign or reuse an ordered authoritative checkpoint, and treat each notification as a request to reread the whole projection.

## Deduplication, ordering and failures

The planner rejects repeated/older revisions, merges changes within a bounded window and permits only one in-flight candidate. Each attempt has a separate job ID: a late response from a failed earlier attempt cannot complete its retry. Checkpoints preserve the latest revision, pending generation and in-flight attempt in restart simulations. Actual cross-process serialization and durable atomic checkpoint storage are still integration work; this module is not a distributed lock or a running scheduler.

A changed revision during a build invalidates its completion. The future deployment adapter must also compare a fresh complete projection with the candidate immediately before publication, rejecting a mismatch even when an event was missed. A full read and digest check is required, not trust in a caller-supplied Boolean. Successful candidate generation is never recorded as deployment. Only a verified Pages deployment for the selected candidate may clear pending changes. There is no transaction spanning a remote inventory update and Pages deployment; a last-moment change can still require the next rebuild.

Daily reconciliation is measured independently of event deployments, so frequent edits cannot postpone it indefinitely. A failed build, image gate, permission check or deployment keeps the previous site and the pending change. The existing generator swaps only a validated candidate and retains the prior artifact. An all-empty projection fails closed for separate review rather than silently erasing the site.

## Explicit stale indication

`status(now).freshness` emits `state:stale` with `build-failed`, `inventory-change-pending`, `reconcile-overdue` or `no-confirmed-deployment`; it includes the last successful deployment/reconciliation times. A confirmed current deployment is the only current state. Simulation tests cover each transition and preservation of the previous artifact.

Every generated vehicle page already labels its snapshot date. A live inventory check may show current vehicle facts; a failed check keeps the dated snapshot warning and disables live application controls. A failed build cannot alter already-served raw HTML while also preserving it byte-for-byte. To show the specific global build-failed state immediately, the future integration needs an independently updated, minimal public status resource or existing operations surface. It may contain state and timestamps only, never customer data, credentials, raw errors or private source IDs. Its consumer must treat an unavailable or overdue status as unverified/stale. No such production status endpoint is enabled by this patch, and no instant crawler-cache withdrawal is promised.

## Publication and Sold semantics

On successful rebuild, a vehicle removed from `publication=published` loses its generated EN/BM/ZH pages and sitemap entries. Its slug reservation remains, and only manifest-listed pages are pruned. A confirmed live withdrawal hides a previously loaded page and clears its search metadata; no-JavaScript/raw HTML requires that successful rebuild to disappear. The stable image function independently rechecks publication for each request.

A Sold vehicle that remains published keeps its details, SoldOut schema and the existing published-Sold sitemap policy. Its price is labelled as a sold listing; finance/viewing actions are hidden. The public Stock Request presentation offers a similar-car enquiry with the original Sold vehicle in a WhatsApp draft. Rendering does not create a persistent Stock Request, assign Benny, reserve a replacement vehicle, take a deposit or cancel another customer's case. Those backend actions stay separate.

## Smallest access inventory for activation

| Channel | Existing source evidence | Minimum remaining integration/access |
| --- | --- | --- |
| Inventory and prior slug registry | Anonymous public projection reader and previous public registry reader | Reuse public reads; no customer table access, service-role key in the build, or new database grants. |
| Authoritative completion signal | Existing importer commit/receipt boundary; hosted Notion path not yet verified | Reuse a trusted existing executor if available. Wire only a successful inventory commit to the one rebuild workflow. Do not add a broad Notion workspace token merely for SEO. |
| GitHub build and Pages deployment | Existing workflow has `contents:read`, `pages:write`, `id-token:write` and manual dispatch | Reuse those job permissions. If an external executor lacks a permitted dispatch channel, separately approve a selected-repository GitHub App installation/short-lived token with only the required Actions dispatch access, restricted by the trusted executor to this workflow. No repo-wide classic PAT or `contents:write` is needed. Repository dispatch must not be chosen if it would unnecessarily require wider content access. |
| Deduplication and execution state | Pure checkpoint/attempt model only | Reuse the executor's durable state/lease store where possible; otherwise approve one restricted state namespace for revision, job ID and status. No financing schema or staff-role access. |
| Daily reconciliation | Disabled workflow proposal only | Enable one approved daily job after activation review; no new personal credential is inherently required. |
| Global stale status | Model output and dated HTML notices exist; no independent live endpoint verified | Reuse an existing authorized status surface or separately approve one small status object/endpoint with writer scope limited to that object. Readers need public read only. |
| Stable images v2 | Approved version 4 deployment completed on 2026-10-14; bounded public GET/HEAD samples and current release HEAD gate pass | Reuse this deployment. No repeat function deployment, new Drive scope, public bucket or SQL migration is required. Local negative tests remain distinct from production tests. |

Do not request secrets before checking whether the existing channels suffice. If any actual permission extension becomes necessary, review that exact delta separately. SEO activation does not wait for unrelated Mileage/financing database work, while its own image and publishing checks still apply.
