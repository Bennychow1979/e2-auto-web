# Optional Google Drive photos

Status (2026-09-18): Google Drive connection, Edge function and database migration are
deployed and verified. The frontend remains local and has not been released. Existing
uploads remain the default. Live draft linking/removal and public gallery end-to-end
verification are still required before enabling the frontend.

Connection: project `e2-vehicle-photos-202609`, service account
`e2-drive-photos@e2-vehicle-photos-202609.iam.gserviceaccount.com`, Viewer access only
to E2 Vehicle Uploads, restricted sharing. No billing or domain-wide delegation.
The current uploaded service-account key expires 2027-09-18; arrange rotation before
that date. Secrets are stored only in the authorized Supabase backend, not in this repo.
The read-only server administration connection check verified 25 vehicle folders and
16 supported photos in VBH4735, including checksum-verified image retrieval.
The backend migration preserved the complete stock and original photo digests:
18 vehicles (17 published), 271 uploaded photos, zero Drive associations.

## Staff workflow

Save a private vehicle draft. Use **Upload photos +** as before, or **Link Google Drive**.
Paste the vehicle folder link, load previews, select verified photos and add them.
Both sources share the 30-photo limit, cover selection and album order. Linking appends
photos without replacing existing ones. Removing a Drive photo unlinks it; the original
is never deleted. Published vehicles must move to draft before any album changes.

The service reads only direct vehicle folders within the configured E2 Vehicle Uploads root.
Folder names must start with the exact plate, followed by whitespace or an underscore and
the model name, for example “VBH4735 CIVIC FD”. It deliberately rejects W2133A/WB2133A
and JC5501/JC5501J mismatches. No prices, specifications or other vehicle fields are imported.
There is no automatic folder synchronization or publication.

## Connection required before enabling in production

1. In an E2-controlled Google Cloud project, enable the Google Drive API and create a
   dedicated service account. No domain-wide delegation is needed. Have the owner approve
   sharing only the E2 Vehicle Uploads folder with that account as Viewer. Do not make
   the folder public and do not grant access to the masterlist, email or other Drive folders.
2. Put its JSON key in Supabase Edge secret `E2_DRIVE_SERVICE_ACCOUNT_JSON`, not in
   browser configuration, Git, screenshots or chat. Store a random secret of at least
   32 characters as `E2_DRIVE_SIGNING_SECRET`. A service account key is a credential:
   the owner should perform or explicitly approve its creation and storage.
3. Set `E2_DRIVE_ROOT_FOLDER_ID=1shtrbAggeUA8mc2lt8eBF4D8v-LFsqjx`.
   Google requests use only the `drive.readonly` scope.
4. Apply `202609180001_drive_photos.sql` and deploy the `e2-drive-photos` function with
   the supplied configuration. The gateway accepts public image requests; the handler
   itself verifies staff Auth and roles for all management operations.
5. Before publishing the frontend, test one explicitly chosen private draft with a
   clear photo. Verify browser display, duplicate retry, combined cover/order, anonymous
   denial of draft photos, and removal leaving the Drive original untouched. Then publish
   the new frontend only with the user's release authorization.

## Storage and access

Original uploaded photos, paths and order are preserved. A new source field defaults
every existing photo to “upload”. Drive IDs and checksums are held in a separate table
that is inaccessible to anonymous and authenticated browser roles. Only the service can
attach validated Drive records through an atomic, draft-only, role-checked database function.

Browser image links expire after five minutes. Each image request rechecks publication or
the staff member's current access, the parent folder and original file checksum. A replaced
file is not silently substituted into an approved advertisement. JPEG, PNG and WebP are
checked for type, size and content checksum; duplicate Drive contents are skipped.

Files are fetched through the website's server when viewed. They are not downloaded to
the user's computer for re-upload and are not copied into the existing photo bucket.
This still uses Google API requests, server bandwidth and memory; it is not zero-cost
image hosting. The initial version serves originals up to 20 MB without compression or
persistent caching. Prefer web-sized Drive photos for fast pages. Uploaded images retain
their existing compression and five-minute signed URLs.

If a file is deleted, moved, replaced or access is revoked, its linked photo becomes
unavailable; uploaded photos remain usable. The staff portal labels each source. The public
advertisement uses the existing gallery and does not show source labels.

## Verification and rollback

`node supabase/tests/drive-photos.mjs` covers mixed sources, exact plate matching,
short-lived tickets, image integrity, database roles, atomic limits, cover/order and retries.
`node supabase/tests/drive-handler.mjs` exercises the actual Edge request handler with
mocked external services, including access revocation and public draft denial.
Live Google access and image retrieval passed on 2026-09-18. Draft attachment and
removal through the real staff UI remain unverified; local database and handler tests
cover permissions, retries, ordering, public denial and original preservation.

The optional `connection-check` action is read-only and accepts only a configured
server administration key (legacy service-role bearer or exact modern secret API key).
Anonymous, ordinary staff and forged keys are denied. It never issues photo URLs,
attaches images or changes inventory. Modern keys are read from the default
`SUPABASE_SECRET_KEYS` JSON dictionary, as documented at
https://supabase.com/docs/guides/functions/secrets.

Before any Drive records exist, reverting the frontend restores the old upload-only UI.
Once Drive photos are linked, keep the dual-source reader deployed: reverting to the old
reader would make Drive-only albums unavailable. Stop new linking through the UI or move
affected vehicles to private drafts, then replace links with verified uploads before retiring
the service. Do not drop the source column or Drive table while links exist.

Official references:
- https://developers.google.com/workspace/drive/api/reference/rest/v3/files/list
- https://developers.google.com/workspace/drive/api/guides/manage-downloads
- https://developers.google.com/identity/protocols/oauth2/service-account
