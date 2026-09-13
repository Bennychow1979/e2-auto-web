# Seven-step customer loan applications

Status: production activation approved by the owner on 2026-09-14. All three loan migrations were applied atomically to the existing E2 Supabase project. This release supplies the customer application and staff follow-up pages.

## Customer flow

From an available car, Start loan application carries the car UUID and any validated public salesperson reference. Guests sign in at customer.html and return to the selected car. Only route UUIDs, not form details, are kept in sessionStorage.

my-e2.html provides Overview, Saved cars, My applications and Continue application. The seven steps are vehicle preferences, personal details, address, employment, supporting details including two emergency contacts, conditional guarantor details, and review/submission. Preferred tenure is 3–9 years. The vehicle and price are a server-derived snapshot; drafts do not reserve stock. Availability is checked again on submission.

Save draft, Save & continue, Save & exit and changing steps persist to Supabase with revision checks. Partial drafts are permitted. There is no per-keystroke autosave or document upload. Required fields and two customer confirmations are checked before submission. Staff cannot fill or submit for the applicant.

## Access

- Active, email-confirmed customers read and save their own Draft or Needs information application.
- Drafts are hidden from all other users, including all staff.
- Submitted applications and their subsequent updates are readable by active Super Admin and the active assigned salesperson/Admin only.
- Unassigned Admin, Account, unrelated salespeople and other customers have no access.
- Staff change only follow-up status or, for Super Admin, assignment. Applicant details are never staff-editable.
- Reassignment and progress are recorded in the customer-visible history. No automatic bank submission or credit/approval decision takes place.
- Sensitive fields are stored in loan_applications protected by RLS and RPC-only writes. No sensitive draft data is stored in browser local/sessionStorage. Customer pages additionally scope reads to the current owner even if that Auth account is also a staff member.

## Activation order

1. Confirm collection and access to IC, address, employment, financial/debt, emergency-contact and guarantor information in the existing E2 Supabase project, with the above permissions.
2. Apply migrations 202609140007_customer_workspace.sql, 202609140008_loan_validation.sql and 202609140009_loan_workflow.sql in order. 202609140006_saved_vehicles.sql is already live and must not be rerun.
3. Deploy only files listed in the local loan release manifest, based on a freshly fetched main tree. Do not upload .loan-qa or other local fixtures.
4. Verify GitHub CI and Pages success, live guest gate and live schema/RPC grants without inserting real customer applications.

## Verification

- 76 PGlite database privacy/workflow checks: draft isolation, role access, owner writes, unknown/invalid fields, conditional guarantor, confirmations, revision conflicts, transitions, reassignment, deactivation, availability and active-application cap.
- Existing inventory, staff, profile, referral, customer and saved-car suites passed alongside the new loan suite.
- Syntax checks passed for all production JavaScript.
- Browser QA used synthetic data and mocked API responses, not the live database. Verified seven steps, explicit save, Save & exit, Continue application, reload persistence, conditional guarantor, review confirmations, submitted read-only view, session-expiry clearing, 390px mobile layout and staff Needs information progress. Database enforcement is covered independently by the PGlite suite.

- Live Supabase create/save and draft-isolation smoke test passed in a rolled-back transaction. Supabase default function grants were explicitly revoked for anonymous users; the validator is internal.

## Operational limits

No automatic email or WhatsApp notifications, file uploads, bank integration, automated retention deletion, or customer withdrawal action in this release. E2 can receive deletion/correction requests using the contact in the loan privacy notice. A later policy-approved retention task can be added separately.
