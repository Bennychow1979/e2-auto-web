# Automatic vehicle description translation

Saving a new or changed `vehicles.description` queues EN, BM and Simplified Chinese
display copy. Price, registration, specifications, photos and the original text are
never rewritten by the translator. Blank descriptions stay blank. A save that does
not change the description does not request another translation.

The queue runs in the database, including saves made by an importer. Closing the
staff portal does not stop it. The portal displays the current status and saved
translations, and an Admin can retry a failed job. The public vehicle page uses a
translation only when its exact source matches the current description. Existing
reviewed translations remain the fallback if the backend has not been deployed.

## Deployment status and activation

The migration starts **disabled**. Publishing GitHub Pages alone does not activate
OpenAI or create the Supabase tables. No production API credentials are included.

1. Apply `migrations/202610010001_vehicle_translation.sql` to the existing E2 WEB
   project `gkppiuuwsecojcnvkzjl` using its authorized migration/SQL channel.
2. Deploy only `e2-translate-vehicle` with its bundled `core.mjs` and `handler.mjs`.
   The `verify_jwt = false` setting in `config.toml` is required for database-issued
   capabilities; the handler independently requires a one-use, expiring token.
3. Set `OPENAI_API_KEY` in **Supabase Edge Function Secrets**, using an OpenAI
   project key with Responses access and available API credit. Never put it in
   browser configuration, a GitHub file, SQL text, a screenshot, or chat.
   Optional `E2_TRANSLATION_MODEL` overrides the pinned default
   `gpt-4.1-mini-2025-04-14`; the replacement must support Responses JSON Schema.
4. Ensure `pg_net` and `pg_cron` are enabled (the existing inventory scheduler
   already uses both). Run `activate-vehicle-translation.sql`. This starts the
   existing nonempty-description queue and installs a database watchdog that runs
   once per minute. It makes no provider calls unless work is pending.
5. Verify a non-public test draft: save a description, observe `ready`, preview all
   three languages, change the description and confirm the new version replaces
   the old version. Verify the original and all vehicle fields remain unchanged.
   Do not claim activation until a real provider request has completed.

OpenAI API usage is separate from the ChatGPT subscription. There is no paid
request on a public page view. Each changed description normally uses one request;
temporary failures retry up to three attempts. Set the provider project's usage
alerts/limits as appropriate before activation.

## Failure and access behavior

- Only the service role writes translated results. Anonymous visitors see only
  results belonging to a published vehicle and matching its current source.
- Admins can read safe job columns and request retries; capability hashes and
  queue controls are not exposed through the browser API. Sales cannot retry.
- Tokens are generated per dispatch, expire after two minutes, and are claimed
  atomically. HTTP receipts contain IDs and status only, not listing text or keys.
- Translation uses strict structured output and `store: false`; only the vehicle
  description is sent to OpenAI. Customer, financing, staff and loan data are not
  sent. The description field is already intended for public listing copy.
- The original-language text is restored verbatim. Changed/missing numbers and
  URLs fail validation. Prompts forbid adding specifications, warranties, finance
  guarantees, discounts or claims. Staff should review wording in the preview.
- Stale or duplicate completions cannot overwrite a newer description. API
  configuration/billing failures pause the job; after correcting secrets/credit,
  rerun activation or use Retry translation. Network failures do not block saves.

To pause new requests without changing existing inventory or translations:

```sql
update public.vehicle_translation_settings set enabled=false where singleton;
```

Validation: `node supabase/tests/vehicle-translation.mjs` runs real PostgreSQL/RLS
checks in PGlite plus provider/handler checks with fake credentials. It does not
call a live OpenAI account. The regular `npm test` includes this test.

Official references:
- https://developers.openai.com/api/docs/guides/structured-outputs
- https://developers.openai.com/api/docs/models/gpt-4.1-mini
- https://supabase.com/docs/guides/database/extensions/pg_net
- https://supabase.com/docs/guides/functions/secrets
