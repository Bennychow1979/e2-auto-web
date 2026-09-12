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

## Verification at configuration time

The MY registry returned the expected nameservers. Exabytes authoritative DNS returned all four A records and the expected www CNAME; Cloudflare public DNS also returned all four addresses. Some recursive DNS caches still returned the previous negative answer. HTTPS certificate provisioning and GitHub's DNS check were still pending. Do not declare HTTPS live until the checks below pass.

## Finish rollout

1. In GitHub Settings > Pages, confirm DNS check succeeds and certificate provisioning completes. Enable Enforce HTTPS when available.
2. Verify `https://e2auto.my/` and `https://www.e2auto.my/` without bypassing certificate checks; www should redirect to the apex.
3. Verify root inventory, real cover photos, Flow, vehicle details and the portal login page. The owner should sign in at the new origin; existing browser sessions on github.io do not transfer automatically.
4. Verify password-reset delivery separately before relying on it in production.

The public root uses the connected showroom. The previous homepage is preserved at `homepage-before-domain.html`.
