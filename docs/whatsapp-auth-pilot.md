# WhatsApp authentication pilot

Limited to a server-side approved test number. Email registration and login remain available. No public navigation entry; `/customer-whatsapp-test.html?lang=zh` supports EN/BM/ZH and is noindex.

## Phone and password pilot

The test page defaults to phone/password login with the native Supabase `signInWithPassword` API. Code login remains available. Registration first verifies the phone with a WhatsApp code, then offers password setup. Existing phone customers use **Forgot / set password** (or **Set / change password** when signed in) to verify a new code before setup; recovery requests use `shouldCreateUser: false`.

Passwords require at least six characters and matching confirmation. They go directly to Supabase Auth through `updateUser`, never to AIRA, the OTP queue, URLs, local storage, or application logs. Setup requires the same independently verified phone/user as the current tab's successful OTP, within five minutes, and an allowed customer. Switching accounts or reloading does not inherit that setup state. This is a client flow guard; Supabase Auth remains the server-side authority for password updates. There are no new database, AWS, or OpenClaw settings for this change.

The phone account is separate from any existing email account. The allowlist and pilot expiration continue to restrict customer data access. Password setup and real password login must be tested by the account owner; do not generate or enter a password for them.

Tests: `tests/aira-otp.spec.mjs` and `tests/phone-password.spec.mjs` cover EN/BM/ZH desktop/mobile, six-character setup, mismatch rejection, invalid credentials, recovery without signup, account switching, customer denial, and code fallback. These mock Auth; user acceptance against live Auth is separate.

## Deployment and isolation

1. Apply `20261125181751_aira_whatsapp_auth_pilot.sql` and `20261125184834_aira_otp_operator_sender.sql`; the initial state is disabled.
2. Deploy `e2-aira-otp-worker` with JWT verification disabled. Its separate 64-hex bearer credential is checked against an expiring private database hash. Browser and authenticated-user roles cannot invoke the worker RPC or read private tables.
3. Enable native Phone Auth with confirmation, six digits and 300-second expiry. Select Postgres Send SMS Hook `public.e2_aira_send_sms`. Leave test OTP bypass empty and email settings unchanged.
4. Deploy static files. Never link this pilot in public navigation before acceptance.
5. On the existing AIRA host, place worker modules and mode-600 worker.json in `~/.config/e2-otp-pilot/`. Config: token (random 32-byte hex), endpoint (project Edge Function URL), account (explicit confirmed WhatsApp account), agentId (its existing agent binding), senderPhone (confirmed sender without plus), allowedPhone (test recipient without plus). Startup checks the actual connected account number and stops on a mismatch; it never falls back to the default account.
6. Configure only the private pilot settings/allowlist in Supabase: token SHA-256, worker/pilot expiry no more than 24 hours. Start one temporary Node process; it self-exits after 24 hours. No systemd, cron, AWS infrastructure, gateway configuration, ports, channel bindings or auto-reply changes.
7. The worker uses the documented operator command `openclaw message send --channel whatsapp --account <confirmed-account>`. It does not invoke an AI session, change agent tool permissions or run a model completion. Startup verifies the account number with read-only channel status. No service-role key is installed on the host.

The existing WhatsApp connection is still shared for outbound delivery. Validate channel health after the test; do not promise zero load or zero interaction with third-party delivery state.

## Data and safety

Supabase Auth generates and verifies OTPs and issues native sessions. Only independently verified Auth email/phone fields authorize customers; editable metadata cannot confer access. Phone customer access is restricted to the active allowlist. Existing email accounts are not merged by self-reported phone number.

The queue stores encrypted codes, clears ciphertext after acknowledgement/expiry and never logs codes. Worker delivery errors are generic. A claimed message is not retried after an ambiguous failure. Requests need a fresh worker heartbeat and are limited to one per 60 seconds, five per hour and twenty per day per number. Auth verification rate limiting remains native: this implementation does **not** promise a per-code five-wrong-attempt cutoff. Queue delivery deadline is four minutes; expired ciphertext is cleared on the next active poll. Auth code lifetime is five minutes from issuance. The operator command has a 60-second deadline and the claim expires after 90 seconds. CLI output and errors are captured and never logged, because they may contain the message. The OTP is briefly present in the local process arguments; server administrators already control this host.

The native phone provider is globally enabled, but sending and customer authorization are server restricted. Unapproved numbers must be tested as rejected before the pilot is accepted.

## Verification

- `npm run test:whatsapp`: PGlite authorization, private-table grants, allowlist, throttling, expiry, queue claims and worker validation. PGlite crypto stand-ins exercise control flow only; verify real pgcrypto separately on the target.
- `playwright test -c playwright.otp.config.mjs tests/aira-otp.spec.mjs`: three languages, desktop/mobile, wrong code, correct code, email fallback, account creation flag, resend cooldown. Uses mocked Auth; does not establish WhatsApp delivery.
- Run existing customer email registration/login/recovery tests.
- Real acceptance: approved user requests a code, receives it in WhatsApp and enters it on the test page. Confirm registration, logout/login and saved-car ownership. Never request OTPs in chat or inspect stored Auth OTP values.

## Stop / rollback

Disable `e2_otp_private.settings.enabled`, clear heartbeat and expire worker_until. Stop only the recorded pilot Node PID after checking its command. Do not stop/restart OpenClaw, its gateway or the EC2 instance. Remove the pilot page via a normal release if needed. Existing verified email customer authorization remains intact. Disable Phone provider and the Send SMS Hook if retiring the entire pilot; email settings stay unchanged. Do not automatically delete any test account or its saved data.
