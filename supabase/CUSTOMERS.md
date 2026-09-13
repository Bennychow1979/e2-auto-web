# Customer accounts

Customer sign-in and signup: `customer.html`. Preferences and contact details are in `customer_profiles`. Admin directory: `customers.html`. The site header links to My E2; staff sign-in is in the footer and remains available directly at portal.html.

## Privacy and access

Registration asks for name, email, WhatsApp/mobile, password and acceptance of the dated privacy notice. After email confirmation, the customer can save optional city/state, language, budget, desired vehicle, timing, payment preference and trade-in details. No identity, bank, income, uploaded documents or marketing subscriptions are collected. Phone numbers are self-reported and normalized, not OTP-verified.

Customer sessions use `e2-customer-auth`; staff sessions keep `e2-staff-auth`. Both are Supabase Auth accounts, so an existing email uses its existing password. Customer registration does not insert into staff_memberships or grant a staff role. Customers may read/write only their own profile; inactive memberships block customer profile access. Admin and Super Admin can read the directory. Salesman/Account/anonymous visitors cannot. Direct profile writes are denied; the save RPC fixes user_id to auth.uid(), validates input and checks revision. Email in the directory comes from Auth rather than user metadata. Privacy acceptance version/time are fixed by the server and retained on updates.

The signup metadata contains only initial name/phone and the dated notice acceptance marker. On first confirmed customer sign-in, the app copies those details into the private profile using the same self-only RPC; if setup fails, the customer can complete the visible form. Unconfirmed registrations are not listed as completed customer profiles. The directory is paginated and searchable; it does not include a send-message or broadcast action. Customer data is never embedded in public stock pages.

## Activation sequence

1. Apply `migrations/202609130006_customers.sql` after the existing migrations. This adds the table, RLS, and three RPCs; it changes no existing staff role.
2. Add exact redirect `https://e2auto.my/customer.html` to Auth URL Configuration, preserving existing entries. For a supported GitHub Pages fallback, also add `https://bennychow1979.github.io/e2-auto-web/customer.html`.
3. Deploy the frontend and verify both account and staff-directory pages.
4. Enable Allow new users to sign up. Keep Confirm email enabled; keep anonymous sign-ins off. This opens customer self-registration, not staff self-registration.
5. The owner completes a real signup with their own email/password and confirms receipt and callback. Never submit a fabricated recipient to the live mail service as a test. Existing Gmail SMTP delivery and quotas still apply.

The UI imposes a shared 60-second delay between signup/resend/reset requests, with a bounded timestamp in sessionStorage; Supabase's server sending limits remain authoritative. Signup/recovery messages do not promise delivery or disclose whether an email is registered. Recovery is driven by the SDK PASSWORD_RECOVERY event; passwords are never sent through the profile RPC or stored in customer_profiles. All auth fragment/query data is removed after processing, with no-referrer on account pages.

## Validation

`supabase/tests/customers.cjs` covers 36 customer authorization, isolation, input-validation, revision, privacy and inactive-account checks. Existing inventory/staff/profile/referral tests remain in the suite. Local UI uses a mock Auth/data module with `example.test` identities: password mismatch, email confirmation prompt, initial profile creation, preference save, signout, recovery flow, admin list, and phone layout. No real email or user is created by those tests.

## Current state

Code and migration prepared; live activation and a real email round-trip remain to be completed. Do not label registrations live until the database and Auth settings are applied and the frontend deployment succeeds.
