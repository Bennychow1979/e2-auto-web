# Customer and vehicle transactions

## Product invariant

One customer may buy five vehicles, or any supported number of vehicles, with
different financiers and insurers. The same physical vehicle may also participate
in separate transactions over time. Customer identity, vehicle identity and
transaction identity are three distinct references.

Shared customer basics may be reused only through a verified customer identity.
Each vehicle transaction must independently link its applications, LOU, policies,
payments, delivery records and audit. LOU, payment and delivery references here
describe future module boundaries; this policy PR does not implement those actions.

Use stable IDs to link records. A customer name, registration plate, chassis text,
equal finance amount, equal premium or document order must never select or merge
transactions. Plates and chassis evidence are checks within the chosen transaction,
not replacements for its ID. Preserve transaction-specific snapshots and earlier
history instead of propagating later changes across a customer's vehicles.

## Existing compatibility

- Registered `loan_applications` independently link `customer_id` and `vehicle_id`.
  There is no permanent unique customer/vehicle pair. `e2_start_loan` resumes an
  existing active application for that pair, and permits a new one after the old
  status becomes `Withdrawn` or `Outcome recorded`, subject to existing limits.
- `finance_cases` has its own ID and exactly one source application/intake.
  `finance_applications` and `finance_events` use that case ID. Different lenders
  and equal draft amounts remain separate rows under the appropriate case.
- Insurance originals, reviewed fields and events use the financing case ID.
  Every original path starts with that ID; a source original from another case is
  rejected even when the staff member may access both cases and the name matches.
- The customer application list already filters by signed-in customer ID and
  lists distinct applications. It is not a complete customer transaction overview.
  Guest intakes do not yet have a verified shared customer identity that can safely
  be unified by name.
- Current vehicle/application creation does not populate a canonical chassis/VIN
  field. Policy review can compare optional `chassis`/`vin` values already present
  in that transaction's vehicle snapshot, but it does not create or modify them.
  Missing source identifiers are explicitly unverified and require staff comparison
  against the correct vehicle's records before confirmation.

Sources: `supabase/migrations/202609140007_customer_workspace.sql`,
`supabase/migrations/202610080001_case_submissions.sql`, `loan-data.js` and the
unapplied `202610100001_insurance_policy_review.sql` migration.

## Current policy safeguards and synthetic proof

The parser identifies labelled policy/schedule pages rather than searching a
delivery bundle indiscriminately. It never selects a case by the extracted name.
Locally detected registration/chassis conflicts, ambiguous vehicle evidence and
detectably incomplete insurer packets stop reservation/upload; staff must choose
the correct case and original. A retained original with conflicting identity also
blocks every reviewed save, including a premium-only patch. The server repeats
the check against the original's retained evidence. Staff cannot override that
conflict through the review form.

Missing identifiers cannot be auto-verified. Staff must explicitly compare both
registration and chassis against this transaction's records and record a review
note. Browser extraction remains untrusted evidence, not a vehicle authentication
service. Maliciously forged metadata and unavailable canonical chassis data cannot
be solved by a parser; hosted access controls and human verification remain gates.

Synthetic tests use one invented customer with five vehicles, five financiers,
five insurers and repeated draft amounts/premiums. They check separate originals,
case-specific fields and histories, cross-case original rejection, unchanged
financing rows when a policy changes, and a later transaction for the same vehicle
that inherits none of the earlier policy or audit records. They also reject plate,
chassis and ambiguous-chassis evidence even if only premium is selected.

There is no payment ledger, LOU extraction or delivery module in this change, so
these tests do not claim end-to-end coverage for those future modules. No ownership,
loan approval or insurance validity decision is inferred from the fictional data.

## Separately scoped future work

1. Review existing customer identifiers and guest intake links using approved
   metadata. Propose a verified customer-linking process, including duplicates and
   reversals, without name matching or automatic document imports.
2. Propose a transaction model for non-financed sales and canonical vehicle
   identifiers, including how chassis is verified/corrected and how repeat vehicle
   transactions preserve snapshots. Review the migration, access matrix and staged
   backfill separately before implementation or production changes.
3. Design a permission-filtered customer overview listing vehicle transactions and
   their separate application, policy and delivery states. Grouping never broadens
   staff access. Avoid monetary aggregation until amount type, currency, status and
   allocation rules are agreed; equal amounts are not duplicates.
4. Add future LOU, payment/allocation and delivery modules only under their own
   authorization. Each must reference the transaction, retain its own source and
   audit, and explicitly allocate any customer-level payment across transactions
   rather than attach it by customer name or amount.

This architecture rule does not approve new accounts, role grants, production
migrations, real-file imports, external OCR or financial actions.
