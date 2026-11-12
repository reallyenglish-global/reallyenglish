# ReallyEnglish marketing site prototype

This is a public, early prototype for replacing the HubSpot marketing site with an editor-managed frontend, supporting white-label partner sites and a separate CRM. It is not a production migration or a live lead-collection service.

## Stack

- **Astro + Tailwind CSS:** Node 24 server-rendered frontend.
- **Strapi 5:** local CMS admin for brand and page content.
- **Twenty CRM:** optional server-side lead adapter. It defaults to safe demo mode and has not been connected to a live workspace.
- **White-label:** exact hostname-to-brand mapping; the local `partner.localhost` host shows a separate demo brand.

The default site content is illustrative; the existing HubSpot mirror has not yet been imported. No production lead data, credentials, or live CRM calls are part of this prototype.

## Makefile: local development and tests

Install and run the frontend with the pinned Node 24 runtime:

```sh
make install
make dev
```

Run Strapi separately when you need the editor. Local Strapi uses SQLite; replace the generated sample secrets in `apps/cms/.env` before using it:

```sh
make cms-install
cp apps/cms/.env.example apps/cms/.env
# Replace all example values in apps/cms/.env with fresh local secrets.
make cms-dev
```

Run the automated checks:

```sh
make test
```

`make test` builds Astro, starts the built server, and checks health, the ReallyEnglish page, partner-host selection, demo lead submission, consent validation, cross-origin rejection, and offline Kustomize rendering. It uses only synthetic test values. `make cms-build` builds Strapi after its dependencies are installed; `make cms-audit` reports dependency advisories.

## Local Kubernetes / Kind prototype

The Kubernetes overlay is intentionally *local-only*. It has no Ingress, public hostname, registry credentials, or production namespace. The Strapi SQLite database and uploads use `emptyDir`, so content in a Kind pod is disposable and can be lost when the pod is recreated. Use the normal local Strapi process for durable local editorial work. The frontend remains in `CRM_MODE=demo` and discards form data.

Render the manifests without contacting a cluster:

```sh
make k8s-render
```

To create and run the optional local Kind prototype:

```sh
make kind-up
make image-build
cp k8s/cms-secrets.env.example .env.k8s
# Edit .env.k8s: replace every placeholder with fresh random values; never commit it.
KUBE_CONTEXT=kind-reallyenglish-prototype make local-secrets
make kind-load
KUBE_CONTEXT=kind-reallyenglish-prototype DEPLOY_APPROVED=yes make deploy
KUBE_CONTEXT=kind-reallyenglish-prototype make port-forward
```

Visit `http://localhost:4321`. To access the CMS admin, use `KUBE_CONTEXT=kind-reallyenglish-prototype make port-forward-cms`, then open `http://localhost:1337/admin`.

- `PUBLIC_SITE_ORIGINS` is the explicit comma-separated Origin allowlist for the lead endpoint; include every exact browser origin (scheme, host, and port; no path or trailing slash), especially behind a reverse proxy.
- `BRAND_HOST_MAP` maps exact verified hostnames to CMS Brand slugs; it is an allowlist, not a query-string switch.

The Makefile `deploy` target refuses every context except the named local Kind context and requires an explicit `DEPLOY_APPROVED=yes`. It does not deploy to GKE or any remote/production cluster. No `kubectl apply`, Kind cluster creation, or image build was run while preparing this scaffold.

## Production blockers

Do not treat these manifests as production deployment configuration. Before any remote deployment or real lead collection:

- Resolve the current Strapi dependency audit findings (37 advisories: 23 high, 12 moderate, 2 low) or choose a safer CMS; verify the full CMS install and build.
- Replace SQLite and ephemeral uploads with a managed database and durable object storage/PVC, and define backup/restore and migration procedures.
- Add an approved image registry, immutable image tags, image scanning/signing, cluster/namespace selection, ingress and TLS, DNS, resource/cost limits, monitoring, and secret-manager integration.
- Approve partner content, domain verification, localization, accessibility, consent/privacy wording, retention/deletion, spam/rate limiting, and Twenty field/API mapping.
- Import the existing `homepage-mirror` with a repeatable dry-run-first seeding process; do not manually recreate hundreds of pages or blindly publish raw HubSpot HTML.

No production deployment is authorized by this prototype work. Production cluster changes, public cutover, domain changes, and live CRM credentials each require separate approval.

## Manual commands

```sh
mise exec node@24 -- node --version
mise exec node@24 -- npm run build
mise exec node@24 -- npm test
make k8s-render
```

See [apps/cms/README.md](apps/cms/README.md) for content types and read-only public API permission guidance. The planning decision and migration rationale remain in the private re-work repository.
