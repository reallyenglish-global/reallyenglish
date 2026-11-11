# Strapi headless CMS

Strapi provides the editor admin for brand-scoped marketing pages. Astro reads only published content on the server; the CMS token is never sent to browser code.

## Start

Use Node.js 24 (the root `.node-version` is authoritative):

```sh
cd apps/cms
npm install
cp .env.example .env # replace every placeholder with fresh local-only values
npm run develop
```

The generated configuration uses local SQLite. Never reuse sample secrets outside a disposable local environment. Admin registration is local to this CMS instance.

## Create initial content

1. In the admin UI, create and publish a **Brand** for each website tenant. Set its slug, name, logo text, hostname, and six-digit primary/accent colours.
2. Create a **Page** per brand, using slug `home`; fill the hero fields and JSON `features`, then relate the page to exactly one Brand. Publish it.
3. In Settings → Users & Permissions → Roles → Public, grant **find/findOne only** for Brand and Page. Never grant create/update/delete. Keep API tokens server-side in the frontend environment.

Tenant resolution uses the frontend's server-side `BRAND_HOST_MAP` exact-host allowlist and resolves it to the CMS brand slug. Do not select a tenant from query parameters. Verify custom domain ownership and define domain onboarding/removal before production use.
