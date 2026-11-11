---
title: ReallyEnglish marketing website prototype
---

# Development notes

- Use the Node.js 24.x version pinned by `.node-version`.
- Astro frontend: run `npm install`, then `npm run dev`; verify with `npm run build`.
- Strapi CMS: work under `apps/cms`; keep generated secrets in the ignored `.env` file.
- Never commit API keys, production lead data, partner credentials, or private source-site exports.
- CRM mode defaults to `demo`; do not connect a production Twenty workspace or deploy without separate approval and security/privacy review.
- Keep tenant selection bound to configured exact hostnames; do not trust request parameters for tenant identity.

