# ReallyEnglish marketing site prototype

This is a public, early prototype for replacing the HubSpot marketing site with an editor-managed frontend, while supporting white-label partner sites and a separate CRM.

## Proposed stack

- **Astro + Tailwind CSS:** component-based, server-rendered frontend with a small client-side form.
- **Strapi 5:** self-hosted CMS admin for brand and page content; published CMS fields feed the frontend server-side.
- **Twenty CRM:** server-side lead adapter targets a configured custom `Website Lead` object, keeping contact forms, enquiry details, consent, source and brand context together.
- **White-label:** exact verified hostname → brand-slug mapping; each page and theme is scoped to one CMS Brand. `partner.localhost` shows the demo partner brand locally.

This is a prototype, not a production-ready migration or a live lead collection service. The page content/brand details are illustrative, the lead handler defaults to `CRM_MODE=demo` and deliberately does not store or forward submitted data in that mode, and no live Twenty workspace has been connected.

## Prerequisites

- Node.js **24.x** (see `.node-version`).
- npm shipped with that Node release.
- A local Strapi install is needed only to edit and publish CMS content.

```sh
npm install
cp .env.example .env
npm run dev -- --host 0.0.0.0
```

Open `http://localhost:4321` for ReallyEnglish and `http://partner.localhost:4321` for the sample partner theme. Astro falls back to illustrative fixture content when Strapi is unreachable, so the frontend can be run independently.

## Start the CMS

```sh
cd apps/cms
npm install
cp .env.example .env
# Replace all placeholder Strapi secrets in apps/cms/.env with fresh random values.
npm run develop
```

The current CMS scaffold uses a local SQLite database. Complete the setup in [apps/cms/README.md](apps/cms/README.md): create a Brand and a `home` Page for each tenant, publish them, and grant the public role read-only `find`/`findOne` access. Never allow public writes. Configure `CMS_API_URL`; use a read-only server-side API token if your permission setup needs one. Do not expose that token to browser code.

## CRM prototype setup

No real CRM credentials belong in this repository. `CRM_MODE=demo` accepts a validated demo submission but does not persist or forward it. To test against a Twenty sandbox, first create a `Website Lead` custom object with API name `websiteLeads` and the following fields in that workspace:

- `name` (the required display name), `submissionId` (text; make it unique if the workspace/API supports it)
- `firstName`, `lastName`, `email`, `companyName`, `message`, `brandSlug`, `sourceUrl` (text)
- `consent` (boolean)

Create a least-privilege API key scoped to create those records, then set `CRM_MODE=twenty`, `TWENTY_BASE_URL`, `TWENTY_API_KEY`, and `TWENTY_LEAD_OBJECT_API_NAME` in the server environment. The API key is server-only. The object/field names and create response must be verified against the target workspace before any real lead collection; the live integration has not been exercised here. Failed CRM calls return a generic error; the site does not claim success. This prototype does not yet provide a durable retry queue, rate limiting, or a retention/deletion workflow, so **do not connect it to a live production form**.

The Strapi CMS scaffold is pinned to the current upstream release in its lockfile, but `npm audit` currently reports 37 advisories in that dependency tree (2 low, 12 moderate, 23 high). No production CMS installation or deployment is authorized; review the affected advisories and wait for safe upstream fixes or choose another CMS before connecting real partner content or data. This is a known prototype blocker, not an accepted production risk.

## White-label boundaries

- `BRAND_HOST_MAP` is a JSON map from exact, verified hostnames to CMS Brand slugs. It is an allowlist, not a query-string switch.
- Brand colors are restricted to six-digit hex values before use in inline CSS.
- Public page lookup is filtered by both page slug and brand slug; draft pages are not exposed.
- Partner content, legal terms, domain verification, consent wording, localisation, accessibility, analytics boundaries, tenant isolation, and domain lifecycle need product/legal review before launch.

## Project structure

```text
src/                         Astro site, shared components, CMS reader, CRM endpoint
apps/cms/                    Strapi scaffold and Brand/Page content types
.env.example                 Local frontend environment template (no credentials)
```

## Verification

```sh
node --version               # must be v24.x
npm run build                # Astro SSR production build
```

See the internal re-work record for the broader decision context; it remains in the private planning repository. This repository is a fresh prototype and does not copy the old HubSpot export, customer data, credentials, or assets from the existing `website`, `homepage`, or `homepage-mirror` repositories.
