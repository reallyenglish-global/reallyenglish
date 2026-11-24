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
2. Published ReallyEnglish routes are created by the validated public-content manifest seed. Creating an imported route by entering just a slug and hero fields is not supported: the seed provides path identity, locale, SEO, brand and source provenance. Use a disposable instance for reimports; reseeding may replace editorial changes.
3. In Content Manager, edit an existing ReallyEnglish Page's title, description or `contentHtml` and save the draft. The server sanitizes the body and computes `contentHash`; do not edit derived keys, hashes or provenance. The prior publication remains visible until Publish. Unpublish removes the route. This is an HTML field, not a visual layout editor.
4. Set `CMS_CONTENT_MODE=published` on Astro for those routes, and configure the same server-only `CMS_READ_TOKEN` on Astro and Strapi. The scoped site read endpoints need no public collection permissions. The partner homepage uses built-in copy and its published Brand's logo and colours if configured; it does not expose ReallyEnglish pages.

There is no database migration for older drafts. If a draft predates server-side hashing, save its body again before publishing it. Existing installations require a separate data-integrity and migration review before promotion.

Tenant resolution uses the frontend's server-side `BRAND_HOST_MAP` exact-host allowlist and resolves it to the CMS brand slug. Do not select a tenant from query parameters. Verify custom domain ownership and define domain onboarding/removal before production use.
