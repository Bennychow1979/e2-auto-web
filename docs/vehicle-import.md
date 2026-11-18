# Programmatic vehicle import

Status (2026-09-21): deployed and enabled after explicit single-file MASTERLIST Viewer approval. Live implementation is pinned to release `8e41c04d04bcaed8f4a921043e270156eaa24b97`. First import created 11 private drafts and 185 Drive links. Independent SQL verification confirmed 18 original published vehicles remained published. A repeated run created nothing and reported no changed issues.

The admin portal's **Import new Drive vehicles** button calls `e2-vehicle-import` in batches of up to three cars. The function compares Drive metadata and all inventory plates, reads the current Malaysia-month MASTERLIST worksheet only when candidate fingerprints change, and creates private drafts with Drive photo links. The original Upload photos and Link Google Drive controls remain available.

## Boundaries

- Only the configured E2 Vehicle Uploads root and the fixed E2 MASTERLIST file are read. Source files and permissions are never changed by the importer.
- Every existing normalized plate is skipped, irrespective of publication or stock status. Completed folder receipts also remain completed after folder renames or vehicle plate edits.
- Missing/ambiguous month sheets, absent current-year DATE IN evidence, duplicate headers/rows, nonliteral formula sale cells, missing prices, folder/model conflicts and unknown model labels block import.
- Price comes exclusively from the named MUDAH PRICE header. CC must be a literal litres value representable to one decimal; exact CC values are not silently rounded.
- Model labels use the E2 catalog snapshot. Source model suffixes stay in private review notes; spec is blank. Initial mileage is null and unconfirmed; the optional M-photo stage below can fill an unconfirmed reading. Required fuel and availability fields use explicitly marked provisional PETROL / Available values.
- Gallery import checks metadata (read permission, supported MIME, size, checksum), removes checksum duplicates, and sorts filenames naturally with ID as tie-breaker. It does not inspect photo pixels. The optional M-photo stage below reads only the selected odometer image. The first gallery file is the cover. Albums over 30 supported unique files need manual selection.
- Drive image delivery still validates the downloaded image when it is displayed. Linking metadata alone cannot guarantee photo clarity, vehicle consistency, correct cover angle or actual file decodability.
- Workbook, folder and selected photo metadata are rechecked before committing. The database locks inventory writes and atomically inserts the draft, photo associations and receipt. Uncertain retries skip existing cars. It never publishes or edits existing stock.
- Save verification rereads draft state, price, photo count and cover association. Private import review notes appear in the editor.
- Only necessary sale fields and source IDs are persisted. Costs, profits, customers and internal notes are excluded from the projected rows, receipts and responses. Workbook bytes exist only in server memory during parsing.

## Activation prerequisites

1. Obtain explicit approval to extend `e2-drive-photos@e2-vehicle-photos-202609.iam.gserviceaccount.com` from the photos folder to **Viewer access on the single E2 MASTERLIST file**. The earlier photo-folder approval does not include this file. Do not grant a parent folder, account-wide access, edit rights or public access.
2. Confirm the service account can read that original XLSX and verify its current-month headers and year. Do not change or convert the original file.
3. Apply migration `202609210001_vehicle_import.sql` after the optional-spec and Drive-photo migrations. Deploy `e2-vehicle-import` (gateway JWT off; handler verifies user and active admin). Update the existing Drive adapter deployment only if needed for shared-module consistency.
4. Run an authenticated connection check and a controlled first batch against actual source records. The activation environment variable `E2_VEHICLE_IMPORT_ENABLED` must be `true` for imports; leave unset until ready. Reuse existing server-side Drive credentials; never copy secrets to the client or local files.
5. Deploy the portal UI and call the program through the admin button. Verify new drafts and compact receipts. No publishing is part of this rollout.
6. Program-only scheduling uses Supabase pg_cron and pg_net. After migration `202609210002_vehicle_import_schedule.sql`, deploy the updated function and run `supabase/schedule-vehicle-import.sql`. Daily job runs at 01:00 UTC (09:00 Malaysia); a database-only watchdog marks timed-out runs. Disable the Codex heartbeat after an end-to-end scheduled test succeeds. Scheduling and gallery import need no browser session or local computer. The optional M-photo recognition stage uses OpenAI. Results appear in the private portal, not AI messages.

Each scheduled batch receives an expiring single-use capability generated inside the database. Only its hash is retained in the private dispatch table. The handler verifies and consumes it through a service-only RPC; a browser or staff user cannot mint scheduled requests. The existing administrator must remain active. Cars are still committed only as private drafts through the same audited importer. Continuations are bounded, daily starts are idempotent, and all outcomes are stored in private run receipts. Existing manual import remains available. No provider credentials are copied into cron commands or GitHub.

## Verification

### Optional M-photo mileage stage (2026-11-19 implementation)

Apply `20261118173130_drive_mileage_import_budget.sql` before deploying the updated worker and portal. Configure only `E2_MILEAGE_OPENAI_API_KEY` in Supabase Edge Function Secrets; no GitHub key is needed. This dedicated secret does not activate the separate translation worker. Deployment and a live run still need verification; local tests alone do not indicate activation.

After normal Draft import, the same daily job checks unconfirmed Drafts for a uniquely matching plate folder and `M.jpg`, `M.jpeg`, `M.png` or `M.webp` (case insensitive). A vehicle/checksum receipt prevents repeat recognition, including identical reuploads. Published vehicles and confirmed mileages are excluded. Up to two images are processed per continuation, and photo metadata is rechecked before and after recognition. Source photos are never modified.

Each attempt atomically reserves 3 sen against a 500-sen Malaysia calendar-month allowance before downloading or calling the API. At most 166 attempts (RM4.98 reserved) fit per month. Failed or interrupted attempts retain their reservation and checksum receipt, avoiding uncertain paid retries. Budget exhaustion pauses mileage recognition while ordinary Draft import continues. The allowance conservatively covers the pinned `gpt-4.1-mini-2025-04-14` request with one image and at most 300 output tokens; it is not a provider invoice in MYR. Review the allowance before changing model, provider prices or request limits.

Unclear digits, unknown units, trip displays, conflicting photos, reduced mileage, manual-value conflicts or concurrent vehicle edits need review. Automatic readings stay unconfirmed. A changed photo can replace an earlier automatic reading only while the vehicle still has exactly that applied version; human edits are protected. Private receipts and budget totals are readable only by active administrators. Claim and finish RPCs are service-only. The existing manual mileage evidence flow remains separate.

`supabase/tests/drive-mileage.mjs` tests photo selection, checksum reuse, provider request bounds and changed-photo rejection. `supabase/tests/drive-mileage-db.mjs` verifies the SQL allowance, idempotency, access controls, vehicle-version checks and protection of published, confirmed and manually edited mileages without paid API calls.

`npm run check` checks syntax. `npm test` includes the workbook parser, month rollover, moved price column, rejected formula caches, private-column exclusion, ambiguous model/price blocking, metadata-only photo ordering, SQL RLS, all-or-nothing inserts, normalized duplicates, uncertain retry recovery, unchanged blocker caching, staff authorization and activation gate tests.

ExcelJS is pinned to 4.4.0. The dependency audit reports the transitive uuid <11.1.1 buffer-argument advisory affecting v3/v5/v6. ExcelJS's sole uuid use is v4 in conditional-format writing; this importer only reads XLSX and never invokes those affected APIs. Reassess when upgrading; do not describe the dependency audit as zero findings.
