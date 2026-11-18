# Public insurance and road tax calculator

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
The supplied `E2RT` engine is identical to the standalone road tax calculator.
The large result combines insurance and road tax, with separate subtotals and
calculation steps. Region, saloon/non-saloon and individual/company inputs follow
the supplied template.
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

Every language is tested with comprehensive insurance, RM99,990 sum insured,
2,494cc, 55% NCD and individual ownership:

- Peninsular saloon: RM2,316.05 = RM1,442.05 insurance + RM874.00 road tax.
- Peninsular non-saloon: RM2,277.25 = RM1,442.05 + RM835.20.
- Sabah/Sarawak non-saloon: RM1,576.59 = RM1,116.23 + RM460.36.

Unit tests enforce identical E2RT source and compare all four regions, both
vehicle classes and both owners at every integer cc from 1 to 9,999. Browser
tests exercise these selectors against the standalone road tax page in each
language on desktop and mobile, including island rates and third-party cover.
