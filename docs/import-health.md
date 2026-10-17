# Daily import health report

One shared report per Malaysia day in `public.import_health_reports`, written by
`public.e2_import_health_check()` at 09:30 (after the 09:00 import). Two readers
use the same row:

- **Telegram (immediate alert):** sent only for a new problem, a recovery, or the
  Monday all-clear. An unchanged fault is not repeated; a same-day re-check never
  sends twice. Counts and times are excluded from the fault fingerprint.
- **Claude follow-up (analysis and email record):** reads the same report later,
  investigates function logs for abnormal days and reports causes and next steps.

Findings: import off, no daily run, still running, failed (with the importer's
error), newly blocked folders, runs past their lease, duplicate stock plates.
Metrics: drafts created (plates and prices), open blocked folders, vehicle,
draft and published counts.

## Telegram setup (owner)

1. In Telegram open **@BotFather** → `/newbot`, choose a name and username. Keep
   the token private; do not paste it into chats or tickets.
2. Choose the recipient: send `/start` to the bot (personal), or add the bot to
   a group and send one message there.
3. In your own browser open `https://api.telegram.org/bot<TOKEN>/getUpdates` and
   copy `"chat":{"id":…}` (group IDs are negative).
4. Supabase Dashboard → **Vault** → add two secrets:
   `e2_telegram_bot_token` and `e2_telegram_chat_id`.

Until both secrets exist the report is still written and `telegram_error` reads
`Telegram is not configured in Vault.`; nothing fails.

## Deploy (requires approval)

1. Apply `supabase/migrations/202610170001_import_health.sql`.
2. Schedule: `select cron.schedule('e2-import-health-daily','30 1 * * *','select public.e2_import_health_check();');`
   (01:30 UTC = 09:30 Malaysia.)
3. Delivery test with a past day, e.g.
   `select public.e2_import_health_check('2026-10-17T01:30:00Z');`
   then `select status_code from net._http_response where id=(select telegram_request from public.import_health_reports where report_day='2026-10-17');`
   (200 = delivered).

## Rollback

`select cron.unschedule('e2-import-health-daily');` then drop
`public.e2_import_health_check(timestamptz)`, `public.e2_send_import_health_telegram(date)`
and `public.import_health_reports`. The importer and its schedule are untouched.
