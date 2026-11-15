# Separate high-voltage battery warranty

Factory Warranty covers the vehicle's verified remaining manufacturer warranty. Battery Warranty is an independent, verified high-voltage hybrid/EV battery warranty, with a battery/lightning icon. Either label may appear alone, or both may appear together. This is not a 12 V starter-battery label.

Existing vehicles default to no battery label. No model, fuel type, build year or registration rule automatically enables coverage or copies factory warranty dates. An active Admin/Super Admin must check the vehicle's warranty certificate and transfer eligibility, move the vehicle to draft, then enter the actual expiry date, optional total odometer limit and any public coverage conditions, including individual extensions. Republish after review. Never enter customer details or private certificate contents in the public conditions field.

The label and details are hidden if the expiry date is past (Malaysia time). Battery cover is not automatically rejected or hidden based on the vehicle odometer or its confirmation status: an administrator verifies individual policy extensions. An entered limit, including 210,000 km, is displayed as recorded; leaving it blank does not imply unlimited mileage. Factory warranty eligibility rules are separate and unchanged. Factory warranty expiry does not invalidate battery coverage. English, Malay and Chinese public labels share the same eligibility rules.

## BMW reference, checked 15 November 2026

[BMW Malaysia warranty information](https://www.bmw.com.my/en/topics/discover/gewaehrleistung.html) distinguishes the following total terms, whichever limit is reached first:

| Category | Total term / odometer limit |
|---|---|
| PHEV registered before 1 June 2020 | 6 years / 100,000 km |
| PHEV registered after 1 June 2020 | 8 years / 160,000 km |
| i8 or i3 | 8 years / 100,000 km |
| BEV | 8 years / 160,000 km |

The page's before/after wording does not explicitly resolve registration on 1 June 2020; confirm the certificate with BMW. Do not infer remaining cover from model year or assume Malaysian-market terms apply to an imported vehicle. The page describes capacity-loss coverage for fully electric models; do not present that as a general PHEV promise. The vehicle certificate determines actual cover.

## Release and verification

Apply `supabase/migrations/202611150001_battery_warranty.sql`, then `supabase/migrations/202611150002_battery_warranty_no_odometer_gate.sql` once before publishing the updated portal. This additive transaction introduces four fields and an Admin/Super Admin validation trigger. Existing RLS, draft-only editing, audit and publication triggers remain in place. No existing warranty values are reclassified and no vehicle is granted coverage by this migration. The follow-up migration makes the battery odometer limit optional and removes only the battery-specific current-mileage guard. Existing stored limits are retained; no vehicle values are rewritten. No new secret or Edge Function deployment is needed.

Run `node supabase/tests/vehicle-benefits.cjs` and `node --test supabase/tests/vehicle-benefits-display.mjs supabase/tests/languages.mjs`. Database tests use an isolated in-memory PGlite instance and synthetic records. They cover defaults, independent cover, Admin/Super Admin access, denied non-admin/service changes, invalid dates/limits, saving a 210,000 km extension with unknown/unconfirmed/at-or-over-limit mileage, optional limits, published-row locks and audit behavior. Display tests cover date boundaries, independence, translations, the battery icon and escaped public notes. Preview the portal form and public labels on desktop and mobile before release; do not assign test labels to real stock.
