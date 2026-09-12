# E2 workspace: prototype and production boundary

## Delivered prototype

- Public showroom Login link opens a clearly labelled role demo without password fields.
- Admin can add/edit sample vehicles, assign enquiries, update follow-up and schedule viewings.
- Sales A sees shared inventory plus assigned sample enquiries/viewings, can create own enquiries, and cannot access the Admin team screen through the provided UI. These are demonstrations only, not security controls.
- Edits are held in memory until refresh. Reset demo restores sample records. Nothing sends messages, changes real stock or handles financial records.
- Account and Customer remain planned, not working sign-in options.

## Production requirements before real users or data

Use managed authentication and a database-backed API. Derive roles from server-managed membership records, never browser fields. Enforce authorization on each read/write, including record assignment and ownership. Deny by default. Keep secrets server-side. Implement session expiry, password reset, account invitation and audit trails.

Proposed entities: staff memberships, vehicles, enquiries with assigned salesperson, follow-up events, viewings. Finance records and customer accounts are separate later phases. Customer-owned records must be isolated; salespeople can read permitted stock and access only assigned customers/viewings. Admin owns stock publishing and assignments. Account access should be limited to finance-related data under an agreed policy.

Before rollout, validate Admin/Sales/Account/Customer access with cross-role and cross-user tests on the server; test unauthenticated requests and direct record IDs. Confirm hosting/database service, staff roster, role policy and data retention before importing real data.
