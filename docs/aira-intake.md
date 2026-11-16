# AIRA public financing entry

Use `https://e2auto.my/intake.html?source=aira` in AIRA's application replies.
Optional customer language: `&lang=en`, `&lang=ms`, or `&lang=zh`.
The entry is public and reusable; it does not open submitted applications or files.

The server resolves the `aira` source to its configured generic invitation. Its
expiry is PostgreSQL `infinity`; no renewal job is required. The previously sent
invitation `2700f7df-7787-4a18-b1bb-eaba47882537` remains valid, so customers can
also reopen older messages. Staff invitations are also permanent and cannot accidentally reuse the AIRA
invitation. Existing enabled staff links are extended; revoked links are not
reactivated. Revocation and the assigned
staff account's active/eligible status remain enforced. Draft upload sessions
still expire after two hours; the permanent entry does not extend write secrets.

`intake_links.source` and `intake_submissions.source` identify the entry. A database
trigger stamps new applications from their link; frontend input does not select
the recorded source. Existing applications using the identified AIRA link are
tagged AIRA. This describes the entry used, not proof that a person spoke to the
bot. Customer details and ownership stay unchanged. Staff lists/details display
Source: AIRA within their existing access permissions.

Authorized reporting can group submitted applications by source and MYT date:

```sql
select source, (submitted_at at time zone 'Asia/Kuala_Lumpur')::date as date_myt,
       count(*) as applications
from public.intake_submissions
where submitted_at is not null
group by 1,2 order by 2 desc,1;
```

## Server-enforced limits

- JPG, PNG or PDF, verified by file signature; 10 MiB per file.
- 30 files and 100 MiB of reserved files per application, checked by PostgreSQL
  with a submission row lock. The frontend also checks these before uploading.
- 240 POST requests per minute across the guest endpoint, before reading bodies.
- 60 valid upload attempts per application session per hour.
- 2 GiB of cumulative attempted uploads per UTC day across the endpoint. Deleting
  a file does not refund this quota. Failed Storage attempts still consume budget.
- Existing creation caps remain: 10 new sessions per invitation/hour,
  50 per assigned staff/day, and 100 across all invitations/hour. Retries using
  the same nonce do not create another session.
- JSON bodies are bounded at 64 KiB; multipart bodies at 10 MiB plus 16 KiB.

Rate counters are shared database fixed windows, not per-process memory or a
client-supplied IP limit. Request/daily byte counters ignore caller subject names.
Counters retain only scope, session UUID where needed, window and usage; no raw
IP, nonce, document name or customer detail. Old windows are pruned after two days.
The quota RPCs and entry resolver permit service-role execution only. Anonymous
clients cannot reset quotas or call the intake database RPCs directly.

HTTP throttles return 429 and Retry-After. Quotas bound resource use; they are not
identity verification or CAPTCHA, and a shared limit can affect other customers.
Review aggregate usage before changing thresholds. Do not log customer bodies.

Expired, invalid or revoked links show a WhatsApp button for **012-278 5126**
(`https://wa.me/60122785126`). The application and static footer also keep this
contact available for upload errors or connection interruptions.

## Deployment and AIRA handoff

Apply the AIRA and permanent-staff-invitation migrations, deploy `e2-guest-intake` with its existing
`verify_jwt=false` guest setting, then publish the frontend. Preserve the existing
staff-only document access and nonce validation. Do not expose service keys.

Replace AIRA's hard-coded application URL with the fixed source URL above on the
same day. Suggested rule: “For online financing enquiries, send only
https://e2auto.my/intake.html?source=aira. If the form cannot be opened or submitted,
offer https://wa.me/60122785126. Do not claim that the enquiry is approved.”
The bot's rule configuration is maintained outside this website repository;
publishing this site does not by itself update that external configuration.

Tests use synthetic records only: `node supabase/tests/intake.cjs`,
`node supabase/tests/intake-handler.mjs`, and `node tests/aira-intake-browser.mjs`.
Verify the real public context and expired-link help without submitting customer
data. Never stress-test production quotas or create fake production applications.
