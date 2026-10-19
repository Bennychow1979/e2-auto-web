# Vehicle inspections and repairs

`inspections.html` is the private Inspector/Admin workspace. Existing E2 staff credentials are used. A pure Inspector signing in through `portal.html` is sent here automatically.

Apply migration `202610200008_vehicle_inspections.sql` before releasing the updated pages and the `e2-invite-user` function. The migration adds the Inspector role and workflow; it does not change any existing account. Assign an existing account through Super Admin → Users & permissions after deployment. This keeps its Auth identity/password, changes permissions on subsequent database requests, and records an access audit event.

Active Inspector, Admin and Super Admin accounts can read vehicles, start one open inspection per vehicle, assign responsibility to eligible staff, complete the seven-item checklist, record defects, arrange a workshop/date/time, and save repair progress. A booked or in-progress repair needs a workshop, date and issue description. Ready requires every checklist item to be Pass or Not applicable, plus final-check notes. Cancellation requires a reason. Closed records remain immutable; create a new inspection for later work. Every successful change stores an audit snapshot. Stale revisions are rejected.

This is internal record keeping: saving a repair arrangement does not contact or book a workshop, authorize payment, change the public listing, or certify roadworthiness. Admin retains publication and price control. Inspector has no user-management, sales allocation, customer-financing or loan-document privileges. Pure Inspectors disappear from public Sales profiles and cannot receive new personal-link viewings. Existing Sales appointments are retained for Admin review; changing a role does not transfer ownership silently.

The workflow keeps dedicated RLS-protected tables and denies direct client writes. RPCs recheck active membership on every request. All eligible care staff can see care records, regardless of which Inspector is responsible. Sales, Office Admin, Account, Customer and anonymous users cannot access these records. No historical inspection records are fabricated.

Validation: `node supabase/tests/inspections.mjs` tests role isolation, stale updates, idempotent creation, one-open-inspection enforcement, checklist and repair requirements, closure, audit retention and revoked access. `node tests/inspections-browser.mjs` tests desktop/mobile creation, repair editing, completion, history, sign-out cleanup and denied access using synthetic data. It is included in the browser CI suite.
