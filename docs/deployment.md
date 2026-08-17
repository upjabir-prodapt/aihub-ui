# AI CoE Hub BFF — Deployment Guide

This document describes how the **AI-Hub-UI** (Next.js Backend-for-Frontend, Cloud Run
service name `aihub-bff`) is built, tested, and deployed to Google Cloud Run via GitLab
CI/CD. It mirrors the pattern used by the sibling `Translation` service repository, adapted
for a single-container Node.js app (no separate API/worker split, no Python toolchain).

**Infrastructure values in this document are sourced from the `AICOE-Terraform` repository**
(`terraform/2-foundations/gclt-aicoe-dev-aihub-ui.tf`, `terraform/6-workloads/6a-gclt-aicoe-dev-aihub-ui/`,
`terraform/envs/dev/terraform.tfvars`, `docs/15-entra-gcp-iap-setup.md`,
`docs/09-implementation-runbook-console.md`) — not guessed or copied from the legacy
`.env.example` placeholders, which contain fake/example values.

> ### ⚠️ `.env.example` is outdated — do not use it as a source of real values
>
> This repository's root `.env.example` predates the Terraform-provisioned platform and
> still describes the **old standalone Vite SPA + Nginx** architecture (comment: *"Vite
> loads .env.\[mode\] based on --mode"*, references to `VITE_TRANSLATION_CLOUD_RUN_URL=https://translation-api-service-297743845367.europe-west1.run.app`
> etc.). None of the following in `.env.example` reflect the real, Terraform-provisioned
> dev environment and must not be copied verbatim into GitLab CI/CD variables or `.env.local`:
> - **Region**: `.env.example` implies `europe-west1`; the real dev region is
>   **`europe-west3`** (`AICOE-Terraform/terraform/envs/dev/terraform.tfvars`).
> - **Cloud Run URLs**: the `VITE_TRANSLATION_CLOUD_RUN_URL` / `VITE_SALES_CLOUD_RUN_URL`
>   values point at project number `297743845367` — a different GCP project than
>   `gclt-aicoe-dev-aihub-ui`/`gclt-aicoe-dev-st`, and are placeholder/fake values from
>   before the platform was rebuilt on `AICOE-Terraform`.
> - **API origins**: `VITE_TRANSLATION_API_ORIGIN=https://translation.aicoesandox-int.colt.net`
>   and `VITE_SALES_API_ORIGIN=https://salesagent.aicoesandox-int.colt.net` do not match the
>   real internal Apigee PSC endpoint (`aihub-api.aicoedev-int.colt.net`, §3.3 below).
> - **GCP metadata**: `VITE_GCP_PROJECT_ID=aicoesandox` / `VITE_GCP_PROJECT_NUMBER=297743845367`
>   do not match `gclt-aicoe-dev-aihub-ui`.
>
> `.env.example` should be regenerated from this document (or from a `terraform output`
> against the live `AICOE-Terraform` state) before it is relied on again. Until then, treat
> every value in it as illustrative only, not as the current environment's configuration.


---

## 1. Overview

| | |
|---|---|
| **Runtime** | Node.js 20-alpine, Next.js 16 standalone server, port `8080` |
| **Package manager** | pnpm 11 (via corepack) |
| **Cloud Run service name** | `aihub-bff` |
| **GCP project (dev)** | `gclt-aicoe-dev-aihub-ui` |
| **Region (dev)** | `europe-west3` — confirmed in `terraform/envs/dev/terraform.tfvars` |
| **Container registry** | Google Artifact Registry, repo `containers`, KMS-encrypted (`aihub-ew3` key ring, key `artifacts`) |
| **Compute** | Google Cloud Run (fully managed), **internal-only ingress**, behind a Shared-VPC internal Application Load Balancer with **IAP** |
| **CI/CD** | GitLab CI (`.gitlab-ci.yml`), Shell runner (`Shell1`) for GCP/Docker jobs, `node:20` image for lint/build |
| **Auth to GCP (CI)** | Workload Identity Federation — shared `gitlab-pool`/`gitlab-provider` in project `aicoe-sharedwif` |
| **Auth to the app (users)** | Microsoft Entra ID via Google Workforce Identity Federation + IAP — see `AICOE-Terraform/docs/15-entra-gcp-iap-setup.md` |
| **Branches → Environments** | `sandbox` → sandbox, `dev` → dev, `prod` → prod |

The pipeline is a mirror-and-promote model:
1. Code changes land on `sandbox` (synced from Azure DevOps, or pushed directly in GitLab).
2. The pipeline lints, type-checks, builds, and (on manual trigger) builds/pushes a Docker
   image and deploys it to Cloud Run in the `sandbox` environment.
3. Once verified, `sandbox` is fast-forward promoted to `dev`, then `dev` to `prod`, each
   re-running the same pipeline scoped to that branch/environment.

> **This repository (`ai-hub-ui`) is not yet in the WIF pool's `allowed_repositories` list**
> (`terraform/envs/dev/terraform.tfvars` currently only allow-lists `aicoe-terraform`,
> `translation`, `sales-agent`). The WIF attribute condition will reject this pipeline's
> impersonation attempts until the Terraform platform team adds
> `"code-scanning-toolset/ai-hub-ui"` (or the correct GitLab project path) to
> `allowed_repositories` and re-applies `0-bootstrap`.

---

## 2. Pipeline Stages

```
sync → lint → test → build → deploy → dast → promote
```

| Stage | Job | Trigger | Purpose |
|---|---|---|---|
| `sync` | `sync-from-azure` | manual, `sandbox` only | Fast-forwards GitLab `sandbox` from the Azure DevOps `gitlab-sync-branch` mirror. |
| `lint` | `sast`, secret-detection, dependency-scanning (GitLab templates) | automatic | Standard GitLab security scanning templates. |
| `lint` | `lint-and-typecheck` | automatic | `pnpm install --frozen-lockfile`, `pnpm lint` (ESLint), `tsc --noEmit`. |
| `lint` | `env-scope-check` | manual, allowed to fail | Verifies required environment-scoped CI/CD variables exist for the target branch before a deploy is attempted. |
| `test` | `build-verify` | automatic | Runs `pnpm build` (Next.js production build) as a compile-time smoke test; uploads `.next/` as a short-lived artifact. |
| `build` | `build-and-push` | manual | Builds the production Docker image (multi-stage `Dockerfile`) and pushes it to Artifact Registry, tagged with `$CI_PIPELINE_IID`. |
| `deploy` | `deploy-cloud-run` | manual | Deploys the pushed image to the Cloud Run service for the current branch/environment. |
| `dast` | `resolve-dast-target`, `dast-scan` | manual | Resolves the live Cloud Run URL and runs an OWASP ZAP baseline scan (report-only, non-blocking). |
| `promote` | `promote-sandbox-to-dev`, `promote-dev-to-prod` | manual | Fast-forwards the next branch once the current environment is verified. |

All GCP-authenticated and Docker-building jobs run on the `Shell1` shell runner (tagged
`.shell_runner`) because Docker-in-Docker is not available/desired here; `gcloud` and
`docker` are expected to be pre-installed (or are bootstrapped on demand) on that host.
Lint/build/typecheck jobs run in the `node:20` Docker-executor image since they don't need
GCP or Docker access.

> **DAST caveat.** `resolve-dast-target`/`dast-scan` assume the Cloud Run URL is directly
> reachable. Because this service has **no public ingress** (see §5), the ZAP scanner
> container must run somewhere with network access to the Shared VPC (e.g. a self-hosted
> runner attached to the internal network), or this stage will fail to connect. Update the
> `dast-scan` job's runner tags accordingly once that access path is confirmed.

---

## 3. Required GitLab CI/CD Variables

Configure these under **Settings → CI/CD → Variables**. Use **Group-level** variables for
values shared across all AI CoE repos, and **environment-scoped** (Environment = `sandbox`
/ `dev` / `prod`) variables for anything that differs per environment.

### 3.1 Group-level (shared)

| Variable | Description |
|---|---|
| `HTTP_PROXY` / `HTTPS_PROXY` | Corporate outbound proxy for the shell runner. |
| `AZURE_PAT` | Azure DevOps PAT (Code Read) — used only by `sync-from-azure`. |
| `GITLAB_PUSH_TOKEN` | GitLab PAT/project token, scope `write_repository` — used by `sync-from-azure` and both `promote-*` jobs. |

### 3.2 Workload Identity Federation

Confirmed against `AICOE-Terraform/terraform/0-bootstrap/wif.tf` and `main.tf`, and
`terraform/1-org/main.tf`'s header comment. **One WIF pool is shared by every AI CoE
repository** — there is no per-project or per-app pool:

- **Pool**: `gitlab-pool`, in the **seed project `aicoe-sharedwif`** (`0-bootstrap/wif.tf`,
  `google_iam_workload_identity_pool.gitlab`).
- **Provider**: `gitlab-provider` (`google_iam_workload_identity_pool_provider.gitlab`),
  OIDC issuer = the value of `gitlab_issuer` (`https://amsgit01` in dev per
  `envs/dev/terraform.tfvars`), with the JWKS embedded from a captured
  `gitlab-jwks.json` (amsgit01 is internal-only, so Google cannot fetch it live — **this
  file must be manually refreshed whenever GitLab rotates its signing keys**, or token
  exchange silently starts failing).
- **The one real control**: the provider's `attribute_condition` requires
  `attribute.project_path in <allowed_repositories>` **and**
  `attribute.ref_protected == "true"`. `envs/dev/terraform.tfvars`'s `allowed_repositories`
  currently lists only:
  ```
  code-scanning-toolset/aicoe-terraform
  code-scanning-toolset/translation
  code-scanning-toolset/sales-agent
  ```
  **`ai-hub-ui` is not in this list yet.** Every WIF-authenticated job in this repo's
  pipeline (`build-and-push`, `deploy-cloud-run`, `resolve-dast-target`) will fail to
  exchange its GitLab OIDC token until the platform team adds this repo's exact GitLab
  project path (likely `code-scanning-toolset/ai-hub-ui`) to `allowed_repositories` in
  `terraform/envs/dev/terraform.tfvars` and re-applies `0-bootstrap`. **This is the single
  highest-priority open action item before this pipeline can run past the `sync`/`lint`
  stages.**
- **One `tf-deployer` service account per target project**, not a single shared identity —
  `0-bootstrap/main.tf`'s `google_service_account.tf` creates
  `tf-deployer@<project>.iam.gserviceaccount.com` for every project listed in
  `target_projects` (`envs/dev/terraform.tfvars`), which **already includes**
  `gclt-aicoe-dev-aihub-ui`. So the account to impersonate for this pipeline is:

| Variable | Dev value | Description |
|---|---|---|
| `WORKLOAD_IDENTITY_PROJECT_NUMBER` | project number of `aicoe-sharedwif` | GCP project number hosting the WIF pool (from `wif.tf`'s `output "wif_project_number"`). |
| `WORKLOAD_IDENTITY_POOL` | `gitlab-pool` | WIF pool ID — fixed, shared across every repo. |
| `WORKLOAD_IDENTITY_PROVIDER` | `gitlab-provider` | WIF provider ID — fixed, shared across every repo. |
| `SERVICE_ACCOUNT` | `tf-deployer@gclt-aicoe-dev-aihub-ui.iam.gserviceaccount.com` | Already exists (created by `0-bootstrap` because `gclt-aicoe-dev-aihub-ui` is in `target_projects`). **Its current IAM grants are Terraform-apply-shaped** (broad `roles/owner` during build per the README's "reduce afterwards" guidance) — confirm it specifically holds `roles/run.developer`/`roles/run.admin` and `roles/artifactregistry.writer` scoped to this project, and `roles/iam.serviceAccountUser` on `aihub-bff-sa`, before relying on it for app deploys rather than Terraform applies. If the platform team prefers app-deploy CI to use a narrower identity than the Terraform deployer, a **second** service account should be requested instead of broadening `tf-deployer`'s permissions. |
| `GCP_PROJECT_ID` | `gclt-aicoe-dev-aihub-ui` | Target GCP project for Artifact Registry + Cloud Run. |


### 3.3 Per-environment (scope: `sandbox`, `dev`, `prod`)

**Infra / deploy target** — dev values confirmed against Terraform outputs
(`terraform/vars-handoff/2-foundations.auto.tfvars.json`, `terraform/6-workloads/6a-...`):

| Variable | Dev value | Description |
|---|---|---|
| `GCP_REGION` | `europe-west3` | Cloud Run + Artifact Registry region (`terraform/envs/dev/terraform.tfvars`). Prod uses `europe-west1` per `terraform/envs/prod/terraform.tfvars` — **confirm the real prod value before use; it is currently a placeholder file.** |
| `ARTIFACT_REPO` | `containers` | Artifact Registry Docker repo, defined in `2-foundations/gclt-aicoe-dev-aihub-ui.tf` (`google_artifact_registry_repository.gclt_aicoe_dev_aihub_ui_containers`), CMEK-protected by KMS key `aihub-ew3/artifacts`. |
| `IMAGE_NAME` | `aihub-bff` | Docker image name — matches the Cloud Run service name for clarity. |
| `CLOUD_RUN_SERVICE` | `aihub-bff` | Cloud Run service name. Fixed by Terraform (`6a-gclt-aicoe-dev-aihub-ui/main.tf` references `cloud_run_service = "aihub-bff"`); do not rename without updating the backend service / NEG / IAP bindings that target it by name. |
| `CLOUD_RUN_NETWORK` | `gclt-aicoe-dev-vpc` | Shared VPC network (`terraform/3-network/main.tf`). |
| `CLOUD_RUN_SUBNET` | `gclt-aicoe-dev-cloudrun-ew3` | The Cloud Run direct-VPC-egress subnet (`192.168.4.0/23`), **not** the user-facing `subnet_ew3` (`10.110.73.0/24`) — that one is reserved for load balancer VIPs only. |
| `CLOUD_RUN_SA` | `aihub-bff-sa@gclt-aicoe-dev-aihub-ui.iam.gserviceaccount.com` | Runtime service account (`2-foundations/gclt-aicoe-dev-aihub-ui.tf`, `service_accounts["aihub-bff-sa"]`). Holds Firestore User, Secret Manager Secret Accessor (on the two BFF secrets), and Cloud KMS CryptoKey Encrypter/Decrypter (session key) — see `docs/09-implementation-runbook-console.md` §18.3. |
| `CLOUD_RUN_MAX_INSTANCES` | `30` | Optional; defaults to `30` in the pipeline if unset — this is the platform's allotted share of the `192.168.4.0/23` VPC-egress budget (§19.3 of the runbook: 127 total instances across all services, BFF gets 30). Do not raise without a platform-wide capacity review. |

**Application runtime environment variables** (map directly to `server/config/env.ts`):

| Variable | Description |
|---|---|
| `ENTRA_TENANT_ID` | Entra ID (Azure AD) tenant ID. |
| `ENTRA_CLIENT_ID` | Client ID of the `AI-BFF` app registration (see `docs/15-entra-gcp-iap-setup.md` Part A.3). |
| `ENTRA_REDIRECT_URI` | Must exactly match the `AI-BFF` app registration's redirect URI, e.g. `https://aihub.aicoedev-int.colt.net/auth/callback` (per `terraform/3-network/main.tf`'s DNS record `aihub.aicoedev-int.colt.net` → `10.110.73.20`). |
| `ENTRA_CLIENT_SECRET_SECRET_NAME` | `entra-bff-client-secret` — provisioned as a Secret Manager secret by `2-foundations/gclt-aicoe-dev-aihub-ui.tf`. |
| `GCP_PROJECT_ID` | `gclt-aicoe-dev-aihub-ui` |
| `GCP_PROJECT_NUMBER` | GCP project number of `gclt-aicoe-dev-aihub-ui` (used for KMS resource paths). |
| `GCP_KMS_KEY_RING` | `aihub-ew3` (`2-foundations/gclt-aicoe-dev-aihub-ui.tf`, `module.gclt_aicoe_dev_aihub_ui_kms`). |
| `GCP_KMS_KEY_NAME` | `session` — the key that wraps the cached session-token DEK. |
| `GCP_KMS_LOCATION` | `europe-west3` — **same region as `GCP_REGION` in dev.** The KMS ring, Cloud Run service, and Artifact Registry repo are all colocated in `europe-west3` for this project; there is no cross-region split here (unlike the earlier draft of this document, which incorrectly assumed `europe-west1`/`europe-west3` split based on unrelated placeholder values in `.env.example`). |
| `APIGEE_CLIENT_KEY_SECRET_NAME` | `apigee-bff-client-key` — also provisioned by `2-foundations/gclt-aicoe-dev-aihub-ui.tf`. |
| `TRANSLATION_API_ORIGIN` | The BFF reaches Apigee server-side over the internal PSC endpoint (`10.110.73.10`, private DNS `aihub-api.aicoedev-int.colt.net`) — see `terraform/5-network-psc/main.tf`. Set this to `https://aihub-api.aicoedev-int.colt.net` (not the public-looking values in the legacy `.env.example`). |
| `SALES_API_ORIGIN` | Same internal Apigee endpoint as above — Apigee routes by path/host, not by a separate origin. |

**Client bundle build-time variables** (baked into the browser bundle at `docker build`
time via `--build-arg`; see `shared/config.ts`):

| Variable | Description |
|---|---|
| `VITE_TRANSLATION_API_ORIGIN` | Same internal Apigee origin as `TRANSLATION_API_ORIGIN` above — used for display/diagnostics only, the browser never calls this directly (all calls proxy through `/api/translation/v1/*` on the BFF's own origin). |
| `VITE_TRANSLATION_CLOUD_RUN_URL` | Cloud Run `.run.app` URL of `translation-api-service` in `gclt-aicoe-dev-st`, region `europe-west3` — **do not use the `europe-west1...run.app` example value from the legacy `.env.example`; that was a placeholder/fake URL left over from an earlier draft, not a real deployed service.** Look up the real URL with `gcloud run services describe translation-api-service --project=gclt-aicoe-dev-st --region=europe-west3 --format='value(status.url)'`. |
| `VITE_SALES_API_ORIGIN` | Internal Apigee origin, same as above. |
| `VITE_SALES_CLOUD_RUN_URL` | Cloud Run `.run.app` URL of `sales-research-application` in `gclt-aicoe-dev-st`, region `europe-west3` — same caveat as `VITE_TRANSLATION_CLOUD_RUN_URL`; look it up, don't reuse the old placeholder. |
| `VITE_CONTRACTS_API_BASE` | Contract management API base URL — not yet provisioned in Terraform; confirm with the owning team before setting for non-local environments. |
| `VITE_GCP_PROJECT_ID` | `gclt-aicoe-dev-aihub-ui` (diagnostics only). |
| `VITE_GCP_PROJECT_NUMBER` | Project number of `gclt-aicoe-dev-aihub-ui` (diagnostics only). |
| `VITE_GCP_REGION` | `europe-west3` (diagnostics only — matches `GCP_REGION`, not the old `europe-west1` placeholder). |
| `VITE_TLS_CA_FILE` | Path to the Colt internal CA bundle used by local dev tooling only; not meaningful inside Cloud Run, which reaches Apigee over a private PSC endpoint with Google-managed or internally issued certs. |

> Use the manual `env-scope-check` job on any branch to verify all required variables are
> present before running `build-and-push` / `deploy-cloud-run`.

---

## 4. Docker Image

The image is built from the repository's multi-stage `Dockerfile`:

1. **`deps`** — installs pnpm dependencies with `--frozen-lockfile` (`node:20-alpine`).
2. **`builder`** — copies source, runs `pnpm build` (Next.js standalone output).
3. **`runner`** — copies only `public/`, `.next/standalone`, and `.next/static` into a
   minimal `node:20-alpine` image, runs as an unprivileged `nextjs` user, exposes `8080`,
   and starts with `node server.js`.

Build locally:

```bash
docker build -t aihub-bff:local .
docker run --rm -p 8080:8080 --env-file .env.local aihub-bff:local
```

In CI, `build-and-push` additionally passes the `VITE_*` client variables as
`--build-arg` so they are compiled into the static client bundle, and tags/pushes the
image to:

```
${GCP_REGION}-docker.pkg.dev/${GCP_PROJECT_ID}/${ARTIFACT_REPO}/${IMAGE_NAME}:${CI_PIPELINE_IID}
```

which resolves in dev to:

```
europe-west3-docker.pkg.dev/gclt-aicoe-dev-aihub-ui/containers/aihub-bff:<pipeline-iid>
```

The `containers` repo is CMEK-protected (`kms_key_name` set to the `aihub-ew3/artifacts` key)
and has `docker_config { immutable_tags = true }` — pushing the same tag twice will fail;
`$CI_PIPELINE_IID` is unique per pipeline run so this is not normally an issue.

---

## 5. Cloud Run Deployment

**This service has no public ingress and must never be granted `--allow-unauthenticated`.**
Per `terraform/6-workloads/6a-gclt-aicoe-dev-aihub-ui/main.tf`'s own header comment, `aihub-bff`
is *"the only IAP in the platform"* — it sits behind an **internal** Application Load
Balancer (`bs-aihub-bff` backend service, in the ingress stack) with **Identity-Aware Proxy**
enabled, itself federated to Microsoft Entra ID via a Google Workforce Identity Pool
(`colt-aiappsui-auth`). Every other Cloud Run service in the platform (`translation-api-service`,
`sales-research-application`, etc.) is instead authorized purely through Cloud Run IAM
(`roles/run.invoker` granted to the Apigee runtime SA) — see `docs/09-implementation-runbook-console.md`
Part 19 for the full authentication-boundary design.

`deploy-cloud-run` runs:

```bash
gcloud run deploy "$CLOUD_RUN_SERVICE" \
  --image <artifact-registry-image-uri> \
  --platform=managed \
  --region="$GCP_REGION" \
  --project="$GCP_PROJECT_ID" \
  --ingress=internal-and-cloud-load-balancing \
  --network="$CLOUD_RUN_NETWORK" \
  --subnet="$CLOUD_RUN_SUBNET" \
  --vpc-egress=private-ranges-only \
  --service-account="$CLOUD_RUN_SA" \
  --min-instances=1 \
  --max-instances=30 \
  --concurrency=80 \
  --port=8080 \
  --timeout=60 \
  --memory=512Mi \
  --cpu=1 \
  --no-allow-unauthenticated \
  --set-env-vars="<application env vars>"
```

Key points, corrected against Terraform and the console runbook:

- **`--ingress=internal-and-cloud-load-balancing`** (not the default `all`) — required so the
  service is reachable only via the internal ALB's serverless NEG, not directly from the
  internet or even from other internal callers bypassing the load balancer.
- **`--no-allow-unauthenticated`** — always. IAP invokes the service as its own service
  agent (`service-<PROJECT_NUMBER>@gcp-sa-iap.iam.gserviceaccount.com`), which
  `terraform/6-workloads/6a-gclt-aicoe-dev-aihub-ui/main.tf` grants `roles/run.invoker`
  explicitly (`google_cloud_run_v2_service_iam_member.iap_invoker`). Setting
  `--allow-unauthenticated` here would bypass IAP entirely and expose the BFF's session/auth
  endpoints without any front-door check — this is a platform security control, not a
  convenience default.
- **`--vpc-egress=private-ranges-only`** with **Direct VPC egress** to the
  `gclt-aicoe-dev-cloudrun-ew3` subnet (`192.168.4.0/23`) — required so the BFF can reach
  Firestore, Secret Manager, and KMS via the PSC endpoint at `192.168.6.164`, and Apigee via
  the PSC endpoint at `10.110.73.10` (`aihub-api.aicoedev-int.colt.net`). See
  `docs/09-implementation-runbook-console.md` §19.2.
- **`--max-instances=30`** — the BFF's allotted share of the platform's 127-instance ceiling
  on the `/23` VPC-egress subnet (§19.3). Do not raise without a capacity review across all
  services sharing that subnet.
- Application secrets are **not** passed as plain env vars — the client secret and Apigee
  key are fetched at runtime from **Secret Manager** via `server/secrets/gcpSecretManager.ts`,
  using only the *secret name* passed in as an env var (`ENTRA_CLIENT_SECRET_SECRET_NAME`,
  `APIGEE_CLIENT_KEY_SECRET_NAME`).
- Session state lives in **Firestore Native mode** (`server/session/sessionStore.ts`,
  `google_firestore_database.gclt_aicoe_dev_aihub_ui_sessions` in Terraform) and tokens are
  envelope-encrypted with a **KMS-wrapped DEK** cached in memory
  (`server/session/sessionCrypto.ts`, key `aihub-ew3/session`).

### Runtime GCP IAM already granted to `aihub-bff-sa` (Terraform-managed, do not duplicate)

- `roles/datastore.user`, scoped to the Firestore database
- `roles/secretmanager.secretAccessor` on `entra-bff-client-secret` and `apigee-bff-client-key`
- `roles/cloudkms.cryptoKeyEncrypterDecrypter` on the `session` key

### IAM the CI/deploy identity (`SERVICE_ACCOUNT`) needs, not yet fully defined

- `roles/run.developer` (or `run.admin`) on `gclt-aicoe-dev-aihub-ui`, scoped to the
  `aihub-bff` service if possible
- `roles/artifactregistry.writer` on the `containers` repo
- `roles/iam.serviceAccountUser` on `aihub-bff-sa` (to deploy revisions running as it)
- Must be reachable through the shared `gitlab-pool`/`gitlab-provider` WIF setup, and this
  repository's path must be added to `allowed_repositories` in
  `AICOE-Terraform/terraform/envs/dev/terraform.tfvars` (see §1 and §3.2 above) — **this is
  an open action item, not yet done.**

---

## 6. Environments & Promotion Flow

```
Azure DevOps (gitlab-sync-branch)
        │  sync-from-azure (manual)
        ▼
     sandbox  ──lint/test/build/deploy/dast──►  Cloud Run aihub-bff (gclt-aicoe-dev-aihub-ui, europe-west3)
        │  promote-sandbox-to-dev (manual, fast-forward only)
        ▼
       dev    ──lint/test/build/deploy/dast──►  Cloud Run aihub-bff (gclt-aicoe-dev-aihub-ui, europe-west3)
        │  promote-dev-to-prod (manual, fast-forward only)
        ▼
       prod   ──lint/test/build/deploy/dast──►  Cloud Run aihub-bff (prod project — REPLACE_ME in terraform/envs/prod/terraform.tfvars)
```

- **Sandbox and dev currently point at the same GCP project** (`gclt-aicoe-dev-aihub-ui`) —
  `AICOE-Terraform` only defines one `dev` environment; there is no separate `sandbox`
  project in the Terraform estate today. Confirm with the platform team whether `sandbox`
  should get its own Cloud Run service name (e.g. `aihub-bff-sandbox`) in the same project,
  or whether `sandbox` in this app repo maps to a pre-production stage of the same `dev`
  infrastructure. **Do not assume `CLOUD_RUN_SERVICE` differs between sandbox and dev without
  checking first** — the pipeline as written uses one `CLOUD_RUN_SERVICE` variable per
  GitLab environment scope, so this must be set deliberately per environment in CI/CD
  variables.
- **Prod does not exist yet.** `terraform/envs/prod/terraform.tfvars` is explicitly marked
  "NOT YET IN USE" with `REPLACE_ME` placeholders for every prod project ID. Do not attempt
  `deploy-cloud-run` against `prod` until the platform team provisions the prod projects and
  fills in real values.
- Promotion jobs only **fast-forward** the target branch. If the target branch has diverged
  (extra commits not in the source), the job fails and instructs you to merge/rebase
  manually before retrying — this prevents accidental history loss between environments.
- Every stage from `build-and-push` onward is `when: manual`, so nothing is deployed
  without an explicit trigger in the GitLab pipeline UI.

---

## 7. Manual Deployment (break-glass)

If you need to deploy outside of CI (e.g. CI is down), reproduce the pipeline steps locally
with an authenticated `gcloud` session:

```bash
# 1. Authenticate (requires roles listed in §5)
gcloud auth login
gcloud config set project gclt-aicoe-dev-aihub-ui

# 2. Build & push
docker build \
  --build-arg VITE_TRANSLATION_API_ORIGIN=https://aihub-api.aicoedev-int.colt.net \
  --build-arg VITE_TRANSLATION_CLOUD_RUN_URL=<real translation-api-service .run.app URL> \
  --build-arg VITE_SALES_API_ORIGIN=https://aihub-api.aicoedev-int.colt.net \
  --build-arg VITE_SALES_CLOUD_RUN_URL=<real sales-research-application .run.app URL> \
  --build-arg VITE_CONTRACTS_API_BASE=<confirm with owning team> \
  --build-arg VITE_GCP_PROJECT_ID=gclt-aicoe-dev-aihub-ui \
  --build-arg VITE_GCP_PROJECT_NUMBER=<project number> \
  --build-arg VITE_GCP_REGION=europe-west3 \
  --build-arg VITE_TLS_CA_FILE=certs/colt-internal-ca.pem \
  -t europe-west3-docker.pkg.dev/gclt-aicoe-dev-aihub-ui/containers/aihub-bff:manual-$(date +%s) .

gcloud auth print-access-token | docker login -u oauth2accesstoken --password-stdin \
  https://europe-west3-docker.pkg.dev

docker push europe-west3-docker.pkg.dev/gclt-aicoe-dev-aihub-ui/containers/aihub-bff:manual-$(date +%s)

# 3. Deploy
gcloud run deploy aihub-bff \
  --image <pushed-image-uri> \
  --region=europe-west3 --project=gclt-aicoe-dev-aihub-ui \
  --ingress=internal-and-cloud-load-balancing \
  --network=gclt-aicoe-dev-vpc --subnet=gclt-aicoe-dev-cloudrun-ew3 \
  --vpc-egress=private-ranges-only \
  --service-account=aihub-bff-sa@gclt-aicoe-dev-aihub-ui.iam.gserviceaccount.com \
  --min-instances=1 --max-instances=30 --concurrency=80 --port=8080 --timeout=60 \
  --memory=512Mi --cpu=1 \
  --no-allow-unauthenticated \
  --set-env-vars="ENTRA_TENANT_ID=...,ENTRA_CLIENT_ID=...,ENTRA_REDIRECT_URI=https://aihub.aicoedev-int.colt.net/auth/callback,ENTRA_CLIENT_SECRET_SECRET_NAME=entra-bff-client-secret,GCP_PROJECT_ID=gclt-aicoe-dev-aihub-ui,GCP_PROJECT_NUMBER=...,GCP_KMS_KEY_RING=aihub-ew3,GCP_KMS_KEY_NAME=session,GCP_KMS_LOCATION=europe-west3,APIGEE_CLIENT_KEY_SECRET_NAME=apigee-bff-client-key,TRANSLATION_API_ORIGIN=https://aihub-api.aicoedev-int.colt.net,SALES_API_ORIGIN=https://aihub-api.aicoedev-int.colt.net"
```

**Note:** because the service has no public ingress, this command (and the CI pipeline) must
run from somewhere that can reach the GCP APIs — a Cloud Shell session, a VM on the Shared
VPC, or a GitLab Shell runner that already has network/API access, which is why the pipeline
uses `Shell1` rather than a hosted GitLab.com runner.

---

## 8. Rollback

Cloud Run keeps all previous revisions. To roll back:

```bash
# List revisions
gcloud run revisions list --service=aihub-bff --region=europe-west3 --project=gclt-aicoe-dev-aihub-ui

# Shift 100% traffic back to a known-good revision
gcloud run services update-traffic aihub-bff \
  --region=europe-west3 --project=gclt-aicoe-dev-aihub-ui \
  --to-revisions=<revision-name>=100
```

Alternatively, re-run `deploy-cloud-run` in GitLab against an older pipeline's `IMAGE_TAG`
(the `$CI_PIPELINE_IID` value) by manually retagging/redeploying that Artifact Registry
image — remember the repo has `immutable_tags = true`, so the original tag from that
pipeline is still intact and can be redeployed directly without rebuilding.

---

## 9. Verification Checklist (post-deploy)

- [ ] `gcloud run services describe aihub-bff --region=europe-west3 --project=gclt-aicoe-dev-aihub-ui` shows `Ready: True`.
- [ ] The service's ingress setting is `internal-and-cloud-load-balancing`, **not** `all`.
- [ ] No IAM binding on the service grants `allUsers` or `allAuthenticatedUsers` (Terraform's
      `check "no_public_invoker"` pattern in `6b-gclt-aicoe-dev-st` is a good model for a
      similar guard on `aihub-bff` if one doesn't already exist for it).
- [ ] From inside the Colt corporate network / VPN path to the internal ALB, browsing to
      `https://aihub.aicoedev-int.colt.net/` redirects to a Microsoft Entra sign-in page.
- [ ] After signing in with an account in `App-AICoE-UI-Users`, the AI Hub interface loads
      (not a 403 — see `docs/15-entra-gcp-iap-setup.md` §B.8 if it 403s after a successful
      sign-in: the IAP service agent is almost certainly missing `roles/run.invoker`).
- [ ] `/auth/callback` completes the BFF's own separate Entra token exchange and sets the
      `__Host-AISESSION` cookie (`SameSite=Lax`, not `Strict` — see the pitfalls table in
      `docs/15-entra-gcp-iap-setup.md`).
- [ ] `/api/translation/v1/*` and `/api/sales/v1/*` proxy calls reach Apigee over the
      internal PSC endpoint and return upstream responses (not `401`/`502` from the BFF).
- [ ] Firestore `sessions` collection in `gclt-aicoe-dev-aihub-ui` is being written to.
- [ ] DAST baseline report (`dast-scan` job artifacts) reviewed for new high-severity
      findings — remember this stage needs network access to the internal service (§2 caveat).

---

## 10. Related Files

| File | Purpose |
|---|---|
| `.gitlab-ci.yml` | Full pipeline definition described in this document. |
| `Dockerfile` | Multi-stage build → standalone Next.js runtime image. |
| `server/config/env.ts` | Canonical list + local defaults of server-side runtime env vars. |
| `shared/config.ts` | Canonical list + fallback defaults of client-side `VITE_*` env vars — **note the defaults/examples in `.env.example` are placeholders and must not be copied into real environment configuration.** |
| `memory-bank/systemPatterns.md` | Architecture reference for the BFF's server modules. |
| `AICOE-Terraform/terraform/2-foundations/gclt-aicoe-dev-aihub-ui.tf` | Source of truth for KMS, Artifact Registry, Firestore, and Secret Manager resources this service depends on. |
| `AICOE-Terraform/terraform/6-workloads/6a-gclt-aicoe-dev-aihub-ui/main.tf` | Source of truth for the IAP-protected backend service / NEG this Cloud Run service sits behind. |
| `AICOE-Terraform/docs/15-entra-gcp-iap-setup.md` | Full identity/sign-in setup guide (Entra app registrations, Workforce Identity Federation, IAP, Apigee JWT verification). |
| `AICOE-Terraform/docs/09-implementation-runbook-console.md` | Console runbook; Part 18–20 cover the exact Cloud Run settings, IAM grants, and load-balancer/IAP wiring this service must match. |
