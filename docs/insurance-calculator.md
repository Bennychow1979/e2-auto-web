# Public car insurance calculator

The supplied EN/BM/Chinese HTML is retained unchanged in `templates/insurance/`.
`build-insurance.mjs` extracts only the E2 INSURANCE CSS, E2 INSURANCE and E2
INSURANCE JS blocks and the supplied title, description, canonical and alternate
links. It wraps them in the existing public header/footer, using the same `.rt`
styles and `roadtax-site.css` overrides as the road tax calculator.

The release build generates these routes (not committed generated output):

- `/car-insurance-calculator/`
- `/ms/kalkulator-insurans-kereta/`
- `/zh/car-insurance-calculator/`

The supplied `E2INS` rate table and complete calculation/UI script are unchanged.
The three tariff/NCD tables and four FAQ items remain literal HTML visible without
JavaScript. This is the supplied tariff estimate, not an insurer quotation.

The site build adds language-specific links from all road tax pages and all
vehicle detail pages, and includes all three routes with reciprocal alternates
in the generated sitemap. Language switching handles the distinct BM slug.
There are no database, authentication or inventory-data changes.

Checks:

- `node --test supabase/tests/insurance.mjs supabase/tests/roadtax.mjs`
- `npx playwright test -c playwright.vehicle.config.mjs --grep insurance`
- `npm run test:pages-release`
- `npm run check`

Every language is tested against the requested West Malaysia totals: comprehensive
RM50,000 / 1,468cc / 25% NCD = RM1,289.39; comprehensive RM99,990 / 2,494cc / 55%
NCD = RM1,442.05; third-party 1,468cc / 25% NCD = RM119.35.
