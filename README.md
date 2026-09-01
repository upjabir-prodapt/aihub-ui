# Colt AI Hub

A React/Vite single-page application and the FastAPI **backend-for-frontend** that serves it,
deployed as one container to the Cloud Run service `aihub-bff`.

The BFF owns identity. The browser holds one opaque, `HttpOnly` session cookie and never sees a
token; Entra ID authentication, session storage, token refresh and upstream authorisation all
happen server side.

```
browser ──HTTPS──▶ internal ALB (IAP) ──▶ Cloud Run `aihub-bff`
                                            ├── GET  /            SPA bundle
                                            ├── /auth/*           Entra OIDC + session
                                            └── /api/*  ──────▶ Apigee ──▶ Translation / Sales
```

## Layout

```
frontend/            Vite SPA
  src/app/           App, router, providers, AppShell
  src/features/      hub, tracker, translation, sales, auth
  src/shared/        api client, ui, hooks, types, utils
bff/                 FastAPI BFF
  app/auth/          IAP validation, OIDC, MS Graph, CSRF, cookies, routes
  app/session/       store, model, crypto, cache, lifecycle
  app/proxy/         streaming proxy, Apigee headers, colt_session shim, Python mock upstream
  app/uploads/       signed GCS PUT URLs
  tests/
Dockerfile           multi-stage: node build -> python runtime
docker-compose.dev.yml
```

## Running locally

No GCP credentials and no VPN required. `AUTH_MODE=dev` mints a local session and
`UPSTREAM_MODE=mock` serves the ported fixtures.

```bash
# terminal 1 — BFF on :8080
cd bff
python3.11 -m venv .venv && . .venv/bin/activate
pip install -e ".[dev]"
AUTH_MODE=dev UPSTREAM_MODE=mock IAP_ENABLED=false SERVE_SPA=false \
TRANSLATION_UPLOAD_MODE=multipart \
  uvicorn app.main:app --reload --port 8080

# terminal 2 — SPA on :5173, proxying /auth and /api to :8080
cd frontend
npm ci
npm run dev
```

Open <http://localhost:5173>. The SPA's first request is `GET /auth/session`; it 401s, the client
redirects to `/auth/login`, and in dev mode the BFF mints a session immediately and redirects back.

`docker compose -f docker-compose.dev.yml up` runs the same thing with a Firestore emulator if you
want to exercise the real `FirestoreSessionStore`.

Set `DEV_SESSION_ROLES` to change entitlements, e.g. `DEV_SESSION_ROLES=Translation.User` to see
the Sales route redirect to `/denied`.

## Checks

```bash
cd bff       && ruff check app tests && ruff format --check app tests && mypy app && pytest
cd frontend  && npm run lint && npm run typecheck && npm run test && npm run build
```

## Configuration

The frontend has essentially no build-time configuration: it is same-origin and calls only relative
paths. Everything lives in the BFF's environment — see `bff/README.md` for the module configuration
table and `GITLAB_CI_VARIABLES.md` for the complete GitLab CI/CD environment variable inventory and
deployment runbook.

Secrets are never environment variables. `ENTRA_CLIENT_SECRET_NAME` and `APIGEE_API_KEY_SECRET`
carry Secret Manager *names*; the values are fetched at startup (gap G15).

## Open items

Carried forward from the plan's §13 and found during implementation. Each needs an answer from
outside this repo.

1. **Apigee API key header name.** `APIGEE_API_KEY_HEADER` defaults to `x-apikey`. The name does not
   appear anywhere in the AICOE-Terraform docs; confirm against the deployed proxy configuration.

2. **Apigee must relay `x-colt-user-company` and `x-colt-user-department`.** The `AssignMessage`
   policy (docs 15 §B.11 step 8) currently strips inbound `x-colt-*` and re-injects only the
   verified `oid`/`roles`. Until it is updated, both headers are dropped silently between the BFF
   and the backend — and a passing local test will not catch it, because the mock upstream is
   inside the BFF. Tracked as docs 19 §3.4.

3. **`x-colt-user-oid` vs `x-colt-user-id`.** The plan §8 says the former; the reference
   implementation in docs 18 §3.2 says the latter. `APIGEE_USER_OID_HEADER` makes this a config
   change rather than a code change, but somebody has to decide.

4. **GCS signing.** `POST /api/translation/uploads` needs either a service-account key or
   `roles/iam.serviceAccountTokenCreator` on `aihub-bff-sa` *for itself* so that `signBlob` works.
   Cloud Run has no key by default. Confirm the binding exists before enabling
   `TRANSLATION_UPLOAD_MODE=gcs_signed`; until then run `multipart`.

5. **Front-channel logout URL.** docs 18 §3.3 step 6 registers `/auth/logout` as the Entra
   front-channel logout URL, but docs 13 §1 requires `/auth/logout` to be a CSRF-protected POST and
   Entra invokes the front-channel URL as a browser GET. One handler cannot be both. This repo
   resolves it with two paths, so **register `/auth/frontchannel-logout`** in the app registration,
   not `/auth/logout`. Also confirm whether Entra sends a `sid` parameter.

6. **IAP clear-cookie endpoint.** `/_gcp_iap/clear_login_cookie` and its `continue` parameter are
   not documented anywhere in the reference set — docs 13 §1 says only "redirect to IAP's
   clear-cookie endpoint". `IAP_CLEAR_COOKIE_PATH` keeps it configurable and it is confined to one
   function in `app/auth/routes.py`. Verify in sandbox.

7. **IAP placement.** docs 15 §B.7 puts IAP on the internal ALB backend service; runbook §20.7 says
   Google recommends it directly on the Cloud Run service, and notes the ALB variant is untested for
   regional internal load balancers (spike S1 arm 3). `IAP_AUDIENCE` is a plain string so either
   format works, but the spike still needs running.

8. **KMS `session` key.** docs 18 §9 references `aihub-ew3` / `session` in `europe-west3`, but the
   runbook's key inventory does not create a `session` key anywhere. Confirm it exists before
   deploying with `AUTH_MODE=entra`.

9. **Rotation on plain refresh.** Plan §7 rotates the session id on every token refresh; docs 13 §2
   says explicitly not to ("access-token renewal is not a privilege change ... churn with no
   benefit"). `SESSION_ROTATE_ON_REFRESH` defaults to the plan's behaviour. Rotation on
   authentication and on a roles change is unconditional either way.
