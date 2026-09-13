# Customer saved cars

Migration `202609140006_saved_vehicles.sql` was applied to the E2 production project on 14 September 2026. This is independent of the still-unreleased loan application migrations and design preview.

`saved_vehicles` stores the current authenticated customer, a vehicle reference and creation time. Confirmed, active customers can read only their own rows. Admin and other staff have no access to another customer's saved list through this feature. All writes use `e2_save_vehicle`; direct writes are denied, ownership comes from Auth, save/remove operations are idempotent and each account is capped at 100 vehicles. Only currently published vehicles can be added. Existing unpublished entries remain removable without exposing draft vehicle details.

The vehicle page offers Save car / Saved and links to `saved.html`. Logged-out users are sent to the existing customer sign-in. A validated vehicle UUID and 30-minute timestamp in session storage carry that explicit save intent through sign-in; there is no arbitrary redirect URL. Confirmed sign-in returns to the saved page, which performs the save and clears the intent. The account profile also links to Saved cars. The customer and staff Auth sessions remain separate.

Saved cards use public inventory data and current stock status. Missing published vehicles show an unavailable placeholder. Signed cover URLs refresh on focus and every four minutes. Saving does not reserve a vehicle.

Validation: all existing tests and syntax checks pass, plus 26 saved-car database authorization checks. Browser QA with synthetic fixtures covers save/remove, repeat loading, removal of unavailable vehicles, login handoff, and a 390px single-column mobile layout. Synthetic fixture files are local only and excluded from deployment. No customer passwords or private records are copied into the test fixtures.
