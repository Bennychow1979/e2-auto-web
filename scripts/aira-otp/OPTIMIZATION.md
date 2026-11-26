# OTP sender memory optimization

Replaces the full OpenClaw CLI subprocess with a short-lived Gateway client.
The parent stays small between requests; no AI agent/plugin runtime is invoked.
Only the independent `e2-whatsapp-otp.service` should be restarted for this change.

## Compatibility and security

- Tested installed OpenClaw: 2026.10.9, client bundle `client-DZgDBpiJ.mjs`.
  This internal bundle is deliberately version-pinned. A different OpenClaw
  version fails closed and requires verification/redeployment of this adapter.
- Uses the existing loopback gateway, token, and CLI device identity in
  `sharedStateMode: read-only`; never creates/updates credentials or pairing.
- Requests operator.read/operator.write only. No admin scopes, agent requests,
  reconnects of WhatsApp, configuration writes, or default-account fallback.
- The approved `siti` account, its `siti` agent binding, and sender phone are
  checked before every send. Channel status uses `probe: false`.
- OTP/recipient travel through child stdin, not argv/environment/logs. Existing
  job expiry is rechecked after channel status. Ambiguous sends are not retried.
- The same 384 MiB MemAvailable/load guard stays in place. This optimization
  does not cure server-wide memory pressure or guarantee OTP availability when
  that guard yields. Email/password authentication is unchanged.
- Parent/child heap limit 80 MiB; service MemoryHigh 256 MiB, MemoryMax 320 MiB
  (formerly 512/768 MiB). AIRA remains outside this user service cgroup.

## Validation and rollout

`npm run test:whatsapp` covers broker DB permissions/rate limits and sender
identity, expiry, delivery confirmation, timeout, abort, flood and no-retry.
No database migration or customer page deployment is needed.

Before replacement, back up the OTP script files and its user service unit.
Copy all five .mjs modules in this directory and the unit, retain worker.json
unchanged at mode 0600, run `node --check`, reload the user systemd manager and
restart ONLY e2-whatsapp-otp.service. Compare AIRA MainPID and its config SHA256
before/after. Run the check operation and one operator-only delivery acceptance
test. Observe the OTP cgroup during normal polling; do not lower its guard.

Rollback: restore the saved OTP files/unit, reload the user manager, restart
only the OTP service. Do not restart/reconfigure OpenClaw or the EC2 instance.

## Measurement notes

On 2026-11-26, the previous service showed MemoryCurrent about 41 MiB and a
historical cgroup MemoryPeak about 487 MiB. The isolated new client import used
85 MiB RSS; a read-only gateway connection plus channel status used 154 MiB
peak RSS. These are preliminary different-scope measurements, not a measured
production percentage improvement. Capture parent+child cgroup peak on rollout.
