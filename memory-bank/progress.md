# Progress — AI CoE Hub BFF

All core modules have been re-scaffolded from scratch and verified.

## What works:
- **Scaffolding**: Standard Next.js 16 (Turbopack) setup with pnpm package manager.
- **OIDC auth routes**: Login and callback flows configured with custom secret loading.
- **Session management**: State sessions securely stored inside Firestore by SHA-256 ID, timed out absolutely after 8 hours and idling after 60 minutes.
- **KMS Envelope Cryptography**: Implemented in-memory wrapped DEK caching.
- **CSRF protections**: Constant-time double-submit checks and server Host origin matching.
- **Apigee Reverse Proxying**: Catch-all routes created for Translation and Sales endpoint targets.
- **Docker builds**: Standalone multi-stage build files compiled successfully.
- **Tailwind & Shadcn UI Full Migration**: Completed a full visual overhaul of the entire application using Tailwind CSS v4 utility classes and a custom Shadcn UI component library (`components/ui/`: button, card, input, label, badge, skeleton, tooltip, dropdown-menu, avatar, sonner, textarea, select).
  - **Self-hosted fonts**: Replaced the Google Fonts CDN `@import` with `next/font/google` so Inter is bundled at build time and served locally — critical for the internal, no-external-connectivity Cloud Run deployment.
  - **Collapsible Sidebar**: Added a three-dot toggle button that collapses the sidebar into an icon-only rail with tooltips, with collapsed/expanded state persisted to `localStorage`.
  - **Top-right User Menu**: Moved user identity out of the sidebar footer into a traditional top-right avatar + dropdown menu (profile info, entitlements, per-service sign-out actions) in the Topbar.
  - **Rebuilt Pages**: `LoginModal`, `ReviewModal`, `TranslationPage`, `SalesAgentPage`, `VertexAIPage`, and `ContractManagementPage` were all fully rebuilt with Shadcn primitives and Tailwind utility classes, replacing all legacy hand-rolled CSS.
  - **Legacy CSS removed**: Deleted `modules/styles/{App,layout,contracts,sales-agent,translation,vertex-ai}.css` now that all consuming components use Tailwind utilities exclusively. Only `modules/styles/index.css` (CSS variable theme definitions) remains, imported once via `app/globals.css`.
  - **Build verified**: `pnpm build` completes successfully with zero compilation errors across all routes.
- **CI/CD pipeline overhaul**: Rebuilt `.gitlab-ci.yml` from a minimal 2-stage pnpm scaffold into a full sync → lint → test → build → deploy → dast → promote pipeline, modeled on the sibling `Translation` repo's GitLab CI (WIF-based GCP auth, Shell1 runner, sandbox/dev/prod branch-mapped environments, fast-forward-only promotion jobs, manual `build-and-push`/`deploy-cloud-run`/DAST gates). Added `pnpm`-specific tooling helpers (`.ensure_pnpm`, `.node_ci_base`), lint+typecheck and Next.js build-verify jobs, and an `env-scope-check` job validating all required runtime/build-time variables per environment.
- **Cross-checked against `AICOE-Terraform`** (the platform's real infra-as-code repo) and corrected several wrong assumptions from the initial CI/deployment draft:
  - Dev region is **`europe-west3`** (not `europe-west1` — that was a stale/placeholder value from `.env.example`'s `VITE_*_CLOUD_RUN_URL` examples, which are fake URLs, not real deployed services).
  - The Cloud Run service is named `aihub-bff`, in project `gclt-aicoe-dev-aihub-ui`, Artifact Registry repo `containers`, KMS ring `aihub-ew3` — all now reflected in `.gitlab-ci.yml`'s `deploy-cloud-run` job and `docs/deployment.md`.
  - **This service must never get `--allow-unauthenticated`** — per Terraform (`6a-gclt-aicoe-dev-aihub-ui/main.tf`), `aihub-bff` is "the only IAP in the platform," sitting behind an internal ALB + Identity-Aware Proxy federated to Entra ID. `deploy-cloud-run` now uses `--no-allow-unauthenticated`, `--ingress=internal-and-cloud-load-balancing`, and VPC egress settings matching the Terraform-provisioned network.
  - Flagged open gaps for the platform team: this repo isn't yet in the shared WIF pool's `allowed_repositories` allow-list, and there's no separate `sandbox` GCP project (sandbox and dev currently point at the same Terraform-provisioned project).
- **Deployment documentation**: Rewrote `docs/deployment.md` to cite real Terraform source files (`AICOE-Terraform/terraform/2-foundations/gclt-aicoe-dev-aihub-ui.tf`, `6-workloads/6a-gclt-aicoe-dev-aihub-ui/`, `docs/15-entra-gcp-iap-setup.md`, `docs/09-implementation-runbook-console.md`) for every infra value, explicitly calling out where the legacy `.env.example` contains fake/placeholder URLs that must not be copied into real environment configuration.
- **`.env.example` rewritten**: replaced every stale placeholder (project `aicoesandox`, region `europe-west1`, project number `297743845367`) with the real Terraform-confirmed dev values (`gclt-aicoe-dev-aihub-ui`, `europe-west3`, internal Apigee origin `aihub-api.aicoedev-int.colt.net`). Cloud Run `.run.app` URLs and the GCP project number are marked `<LOOK-UP-REQUIRED>` with the exact `gcloud` command to resolve them, since those are assigned at deploy time and cannot be hardcoded. Also added a commented reference block for all server-side (non-`VITE_`) runtime env vars from `server/config/env.ts`, and restated the open WIF `allowed_repositories` gap directly in the file.

- **Workload Identity Federation clarified**: confirmed via `AICOE-Terraform/terraform/0-bootstrap/wif.tf` and `1-org/main.tf` that there is exactly **one shared WIF pool** (`gitlab-pool`/`gitlab-provider`) in the seed project `aicoe-sharedwif`, used by every AI CoE repo — not a per-app pool. The provider's `attribute_condition` gates access via an `allowed_repositories` allow-list (`terraform/envs/dev/terraform.tfvars`), which does **not yet include `ai-hub-ui`** — this is a hard blocker for `build-and-push`/`deploy-cloud-run` until the platform team adds this repo's GitLab project path and re-applies `0-bootstrap`. Also confirmed a `tf-deployer@gclt-aicoe-dev-aihub-ui.iam.gserviceaccount.com` service account already exists (project is in `target_projects`) as the likely `SERVICE_ACCOUNT` to impersonate, pending an IAM-scope review. Documented all of this in `.gitlab-ci.yml`'s variable comments and `docs/deployment.md` §3.2.



