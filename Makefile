SHELL := /bin/bash
.DEFAULT_GOAL := help
NODE_RUN ?= mise exec node@24 --
KIND ?= mise exec kind -- kind
KIND_CLUSTER ?= reallyenglish-prototype
KUBE_CONTEXT ?=
NAMESPACE := reallyenglish-prototype
WEB_IMAGE := reallyenglish-web:local
CMS_IMAGE := reallyenglish-cms:local
CMS_K8S_ENV ?= .env.k8s

.PHONY: help check-node install dev cms-install cms-dev build test cms-build cms-audit \
        image-build docker-build-web docker-build-cms kind-up kind-load local-secrets k8s-render deploy port-forward port-forward-cms

help: ## Show available commands
	@awk 'BEGIN {FS = "##"} /^[a-zA-Z0-9_-]+:/ {name = $$1; sub(/:.*/, "", name); printf "%-20s %s\n", name, $$2}' $(MAKEFILE_LIST)

check-node: ## Verify the pinned Node 24 runtime
	@$(NODE_RUN) node -e 'const [major] = process.versions.node.split(".").map(Number); if (major !== 24) { console.error(`Node 24 required; found $${process.version}`); process.exit(1) }; console.log(`Using Node $${process.version}`)'

install: check-node ## Install frontend dependencies from package-lock.json
	$(NODE_RUN) npm ci

dev: check-node ## Run the Astro development server
	$(NODE_RUN) npm run dev -- --host 0.0.0.0

cms-install: check-node ## Install Strapi dependencies (known audit advisories; prototype only)
	cd apps/cms && $(NODE_RUN) npm ci

cms-dev: check-node ## Run Strapi locally
	cd apps/cms && $(NODE_RUN) npm run develop

build: check-node ## Build the Astro server
	$(NODE_RUN) npm run build

test: build ## Run Astro build + HTTP/CRM smoke tests + offline Kustomize render
	$(NODE_RUN) npm test
	$(MAKE) k8s-render

cms-build: check-node ## Build the Strapi admin and server (requires CMS dependencies)
	cd apps/cms && $(NODE_RUN) npm run build

cms-audit: ## Audit CMS dependency tree (currently reports upstream advisories)
	cd apps/cms && $(NODE_RUN) npm audit

image-build: check-node docker-build-web docker-build-cms ## Build both local website and CMS images
docker-build-web: ## Build only the Astro frontend container
	docker build --tag $(WEB_IMAGE) --file Dockerfile .
docker-build-cms: ## Build only the Strapi CMS container
	docker build --tag $(CMS_IMAGE) --file apps/cms/Dockerfile .

kind-up: ## Create the isolated local Kind cluster; never targets a cloud cluster
	@if $(KIND) get clusters | grep -Fxq "$(KIND_CLUSTER)"; then echo "Kind cluster $(KIND_CLUSTER) already exists"; else $(KIND) create cluster --name $(KIND_CLUSTER) --wait 120s; fi

kind-load: ## Load locally built images into the named Kind cluster
	$(KIND) load docker-image $(WEB_IMAGE) $(CMS_IMAGE) --name $(KIND_CLUSTER)

local-secrets: ## Create/update the local CMS Secret from an untracked .env.k8s file
	@test "$(KUBE_CONTEXT)" = "kind-$(KIND_CLUSTER)" || { echo 'Refusing: set KUBE_CONTEXT=kind-reallyenglish-prototype'; exit 2; }
	@test -f "$(CMS_K8S_ENV)" || { echo 'Create .env.k8s from k8s/cms-secrets.env.example and replace every placeholder'; exit 2; }
	@if grep -Eiq '^[[:space:]]*[A-Z_]+=(replace|tobemodified|changeme)' "$(CMS_K8S_ENV)"; then echo 'Refusing placeholder CMS secrets'; exit 2; fi
	kubectl --context "$(KUBE_CONTEXT)" create namespace $(NAMESPACE) --dry-run=client -o yaml | kubectl --context "$(KUBE_CONTEXT)" apply -f -
	kubectl --context "$(KUBE_CONTEXT)" create secret generic reallyenglish-cms-secrets --namespace $(NAMESPACE) --from-env-file="$(CMS_K8S_ENV)" --dry-run=client -o yaml | kubectl --context "$(KUBE_CONTEXT)" apply -f -

k8s-render: ## Render local Kustomize manifests without contacting a cluster
	kubectl kustomize k8s/overlays/local

deploy: ## Apply only to the named local Kind cluster (requires explicit confirmation)
	@test "$(KUBE_CONTEXT)" = "kind-$(KIND_CLUSTER)" || { echo 'Refusing non-local context; this prototype deploy target is Kind-only'; exit 2; }
	@test "$(DEPLOY_APPROVED)" = "yes" || { echo 'Set DEPLOY_APPROVED=yes to confirm the local Kind apply'; exit 2; }
	@$(KIND) get clusters | grep -Fxq "$(KIND_CLUSTER)" || { echo 'Local Kind cluster is not running'; exit 2; }
	@kubectl --context "$(KUBE_CONTEXT)" --namespace $(NAMESPACE) get secret reallyenglish-cms-secrets >/dev/null 2>&1 || { echo 'Missing reallyenglish-cms-secrets; run make local-secrets after preparing .env.k8s'; exit 2; }
	@docker image inspect $(WEB_IMAGE) $(CMS_IMAGE) >/dev/null 2>&1 || { echo 'Build local images first: make image-build'; exit 2; }
	$(KIND) load docker-image $(WEB_IMAGE) $(CMS_IMAGE) --name $(KIND_CLUSTER)
	kubectl --context "$(KUBE_CONTEXT)" apply -k k8s/overlays/local

port-forward: ## Forward local Kind website service to http://localhost:4321
	@test "$(KUBE_CONTEXT)" = "kind-$(KIND_CLUSTER)" || { echo 'Set KUBE_CONTEXT=kind-reallyenglish-prototype'; exit 2; }
	kubectl --context "$(KUBE_CONTEXT)" --namespace $(NAMESPACE) port-forward service/website 4321:80

port-forward-cms: ## Forward local Kind CMS admin to http://localhost:1337/admin
	@test "$(KUBE_CONTEXT)" = "kind-$(KIND_CLUSTER)" || { echo 'Set KUBE_CONTEXT=kind-reallyenglish-prototype'; exit 2; }
	kubectl --context "$(KUBE_CONTEXT)" --namespace $(NAMESPACE) port-forward service/cms 1337:1337
