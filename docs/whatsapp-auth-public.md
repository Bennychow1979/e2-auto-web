# Public WhatsApp registration and login

All valid Malaysian mobile numbers can use WhatsApp verification after
`e2_otp_private.settings.public_enabled` is enabled. Email registration,
password login and recovery remain on `customer.html`. The public WhatsApp
entry is `customer-whatsapp.html`, with EN/BM/ZH, phone/password login,
code login, verified registration and code-based password recovery.
Existing test-page bookmarks remain compatible. Accounts are not merged by
self-reported phone numbers. Favourite intent survives switching methods.

## Deployment order

1. Run the database and browser regressions. Apply
   `20261126034910_aira_whatsapp_public_registration.sql`. It does **not**
   enable public access on its own.
2. Deploy the `e2-aira-otp-worker` Edge Function with its existing JWT setting
   (`verify_jwt=false`). The scoped bearer hash remains the worker authority;
   the host has no Supabase administrative key.
3. Install the reviewed worker/core and user service into
   `~/.config/e2-otp-service` and
   `~/.config/systemd/user/e2-whatsapp-otp.service`.
   Copy the existing mode-600 worker configuration, add `mode:"public"`,
   retain the explicitly confirmed sender/account/binding, and keep the
   token secret. Set worker credential expiry to infinity only for this
   permanent, narrowly scoped service. It can be revoked by clearing its hash.
4. Verify the recorded pilot process command before stopping that process.
   Start/enable only `e2-whatsapp-otp.service`. Existing user linger must
   already be enabled; do not change AWS, gateway or OpenClaw configuration.
5. Check heartbeat, send a verification code to the approved operator number,
   and check acknowledgement. Enable `public_enabled` only when ready to
   publish the public customer entry.
6. Merge/publish static pages. Check all three languages and email fallback.
   Recheck the OpenClaw config hash, existing gateway PID, service and channel
   health; user receipt and real password login are separate acceptance steps.

## Isolation and limits

The worker uses the existing explicit `siti` operator sender, not an AI
session or agent tool. It never changes an account binding or auto-reply rule.
The service has low CPU priority and a 768 MiB maximum cgroup memory budget.
Before starting another CLI command it yields when Linux MemAvailable is
below 384 MiB or one-minute load exceeds 1.5 times available CPUs.
It does not claim zero interaction with a shared WhatsApp connection.

Only one claimed delivery may run, with at most three active queue jobs.
Requests are limited per number (60 seconds, five/hour, twenty/day) and
globally (six/minute, sixty/hour, three hundred/day). Limits apply in the
Auth hook, not only the webpage. Native Auth verification/password rate
limits remain enabled. When unavailable or busy, customers can use email.

Heartbeat continues during a slow send. An ambiguous command/ack is not
retried; claimed jobs expire. Failures pause sending for sixty seconds.
Logs include only generic outcomes, never codes, recipients or CLI output.
Ciphertext is erased on terminal state/expiry. The sender checks the
configured account and connected phone on startup and every five minutes.
The original pilot's first false-failure record was not conclusively
explained; public acceptance must verify a new delivery acknowledgement.

Verified phone customer authorization is independent of sender heartbeat,
send enablement and pilot expiry, so existing users can still use passwords
during an outage. Only independently Auth-confirmed contacts count; inactive
staff membership is still denied. Private tables stay inaccessible to client
roles, and existing per-user customer/saved/document policies are unchanged.

## Rollback

Set `settings.enabled=false` to stop new OTP sends while retaining verified
customers' password access. Stop only the independent OTP user service.
Keep email auth available. Reverting `public_enabled=false` additionally
returns phone customer authorization to the old expiring allowlist; do this
only as a deliberate access rollback, not as an automatic transport recovery.
Never stop/restart AIRA or the EC2 instance for OTP maintenance.
