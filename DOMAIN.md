# E2 custom domain

Configured 2026-09-13 (Malaysia time).

- Primary domain: `e2auto.my`; alternate: `www.e2auto.my`.
- GitHub Pages custom domain is configured in repository Settings > Pages. This repository deploys through GitHub Actions, so a CNAME file does not configure its domain.
- Exabytes zone: `e2auto.my`, domain #555429, zone #110814.
- Nameservers: `ns184.mschosting.com`, `ns185.mschosting.com`, `ns186.mschosting.com`.
- Apex A records: `185.199.108.153`, `185.199.109.153`, `185.199.110.153`, `185.199.111.153`.
- `www` CNAME: `bennychow1979.github.io`.
- Supabase Site URL: `https://e2auto.my/portal.html`. Redirect allowlist includes this exact URL and `https://bennychow1979.github.io/e2-auto-web/portal.html` for transition.
- Other purchased domains have not been connected or redirected.

## Verified live

On 2026-09-13, GitHub Pages reported DNS check successful and a usable certificate; Enforce HTTPS was enabled. Strict HTTPS checks returned 200 for the apex and 301 from www to `https://e2auto.my/`. The MY registry, Exabytes authoritative DNS, Google DNS and Cloudflare DNS returned the expected records.

The new HTTPS homepage loaded all three published vehicles and their real cover photos with Flow active. A vehicle detail page loaded all 20 photos, specifications and its finance estimate with no console errors. The new-origin staff sign-in page loaded correctly. The Pages deployment and inventory permissions workflow both passed for commit `52609dde59927ba4b562b2a17293cc8444b786dc`.

## Remaining owner checks

- Sign in using the existing staff account at the new origin; browser sessions on github.io do not transfer automatically. A real sign-in on the new origin has not been tested by the agent.
- Verify password-reset delivery separately before relying on it in production.

The public root uses the connected showroom. The previous homepage is preserved at `homepage-before-domain.html`.
