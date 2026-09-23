# Staff intake: optional vehicle

Released 23 September 2026.

In Customer intake, choose a published, available vehicle or leave **Not decided yet**, then create/copy the invitation. Customers may submit the existing personal-information and document form without deciding on a car. Preferred deposit and tenure remain required preferences; these are not a financing offer.

The assigned salesperson or Super Admin opens the received application and uses **Select the customer’s vehicle → Save vehicle**. Confirm the vehicle, deposit and financing preferences directly with the customer. Selection records the vehicle snapshot, actor and time and preserves the customer's original answers. Select a vehicle before office handover. This action fills an undecided vehicle once; it does not replace vehicles already selected or handed over.

The shared undecided invitation remains undecided for other customers. Existing vehicle invitations, expiration, revocation, limits, customer privacy and Partner referral rules are unchanged.

## Deployment

Apply `supabase/migrations/202609230001_optional_intake_vehicle.sql` to E2 only before publishing the updated static pages. The transaction makes the vehicle foreign keys nullable, replaces invitation/context/handover functions, and adds a permission-checked assignment RPC. Existing rows are unchanged. No Edge Function deployment is required: the existing guest API passes the new context through.

Publish `intake-workspace.html`, `intake-workspace.js`, `intake-staff-data.js`, `intake.html`, and `intake.js`. Both entry pages use the `optional-car-1` script version. Do not reapply the migration after successful application; the assignment function is intentionally created once.

## Verification

Run `npm run check`, `node supabase/tests/intake.cjs`, `node supabase/tests/intake-handler.mjs`, and `node supabase/tests/office-admin.cjs`. The intake suite covers undecided invitation reuse, submission, privacy, permissions, revision conflicts, unpublished/sold vehicles, immutable customer answers, audit history, handover gating and revocation.

Use synthetic local browser fixtures to check invitation creation without a vehicle, the customer form, and assignment followed by handover. Do not submit fake customers or documents into production for testing.
