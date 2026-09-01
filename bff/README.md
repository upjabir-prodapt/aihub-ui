# AI Hub BFF

FastAPI backend-for-frontend. Serves the built SPA, terminates Entra ID OIDC, holds the session
server side, and proxies `/api/*` to Apigee with trusted headers.

## Why it is shaped like this

Three reference decisions drive most of the design, and each has a failure mode worth knowing:

**Firestore, not Redis** (decision D4, docs 11 §5.3). Memorystore basic tier needs Private Service
Access, which peers the Shared VPC host — forbidden by the networking decision and shortly by org
policy `compute.restrictVpcPeering`. Everything goes through the `SessionStore` protocol so a
future Memorystore-Cluster-over-PSC swap is a new class rather than a rewrite.

**KMS wraps the DEK, not the tokens** (decision D5, docs 13 §5). A KMS decrypt per session read
would add 10–30 ms to every request and burn KMS quota at request rate. Each session gets its own
AES-256-GCM data key; KMS wraps only that key, and the unwrapped key is cached for the instance's
lifetime.

**503 on infrastructure failure, 401 only on a genuinely absent session** (docs 13 §4). These are
different exception types (`SessionStoreUnavailable` vs `SessionExpired`) and the distinction is
load-bearing: returning 401 while Firestore is down sends every browser to the login endpoint at
once.

## Module map

| Module | Responsibility |
|---|---|
| `app/config.py` | Typed settings, fail-fast at startup. Refuses to boot on a bad config. |
| `app/deps.py` | `Services` container, `get_session`, CSRF-checked session, `require_roles`. |
| `app/auth/iap.py` | Validates `x-goog-iap-jwt-assertion`. The only source of `login_hint`. |
| `app/auth/oidc.py` | Discovery/JWKS cache, PKCE, `prompt=none`, code exchange, refresh, end-session. |
| `app/auth/graph.py` | `department` / `companyName` from MS Graph. Fails open. |
| `app/auth/csrf.py` | Synchroniser token + `Origin` / `Sec-Fetch-Site` checks. |
| `app/auth/cookies.py` | `__Host-AISESSION` attributes; rotation cookie middleware. |
| `app/auth/routes.py` | `/auth/login`, `/callback`, `/session`, `/logout`, `/frontchannel-logout`. |
| `app/session/model.py` | Session id vs document id, expiry and refresh predicates. |
| `app/session/store.py` | `SessionStore` protocol, Firestore impl, circuit breaker, in-memory impl. |
| `app/session/crypto.py` | Envelope encryption, DEK cache. |
| `app/session/cache.py` | 5–15 s in-instance cache with explicit invalidation. |
| `app/session/lifecycle.py` | Expiry, throttled `last_seen_at`, refresh lease, rotation, termination. |
| `app/proxy/upstream.py` | Streaming proxy, header allow-list, `x-colt-*` stripping. |
| `app/proxy/apigee.py` | Bearer + `x-colt-user-*` + API key injection. |
| `app/proxy/colt_session.py` | Decision D3 shim. **Exists to be deleted.** |
| `app/proxy/mock/` | Python port of the TypeScript mock upstream. |
| `app/uploads/` | V4 signed GCS PUT URLs. |

## Configuration

| Variable | Default | Notes |
|---|---|---|
| `ENVIRONMENT` | `dev` | `dev` / `sandbox` / `prod`. `prod` forces `entra` + `apigee` + IAP. |
| `AUTH_MODE` | `entra` | `dev` bypasses IAP and Entra and mints a local session. |
| `UPSTREAM_MODE` | `apigee` | `mock` serves the ported fixtures. |
| `DOWNSTREAM_AUTH_MODE` | `headers` | `colt_session` enables the D3 shim. |
| `TRANSLATION_UPLOAD_MODE` | `gcs_signed` | `multipart` streams the file through the proxy. |
| `SERVE_SPA` / `SPA_DIST_DIR` | `true` / `/srv/static` | Set `false` in dev; Vite owns the bundle. |
| `ENTRA_TENANT_ID` | — | Required when `AUTH_MODE=entra`. |
| `ENTRA_CLIENT_ID` | — | The `AI-BFF` application (client) ID. |
| `ENTRA_APP_ID_URI` | — | `api://<client-id>`. **Never hardcode** (docs 18 §9). Validated at startup. |
| `ENTRA_REDIRECT_URI` | — | Must end `/auth/callback`; https outside localhost. |
| `ENTRA_SCOPES` | — | Space-delimited. Must include `offline_access`. |
| `ENTRA_CLIENT_SECRET_NAME` | `entra-bff-client-secret` | Secret Manager **name**. |
| `ENTRA_POST_LOGOUT_REDIRECT_URI` | — | Optional. |
| `IAP_ENABLED` / `IAP_AUDIENCE` | `true` / — | Audience format depends on where IAP lands. |
| `IAP_CLEAR_COOKIE_PATH` | `/_gcp_iap/clear_login_cookie` | Not in the reference docs; verify. |
| `GCP_PROJECT_ID` | — | |
| `FIRESTORE_DATABASE` | `(default)` | |
| `FIRESTORE_EMULATOR_HOST` | — | Dev only. |
| `KMS_KEY_NAME` | — | Required outside dev. Falls back to a local key wrapper in dev. |
| `APIGEE_BASE_URL` | — | |
| `APIGEE_API_KEY_SECRET` | `apigee-bff-client-key` | Secret Manager **name**. |
| `APIGEE_API_KEY_HEADER` | `x-apikey` | Unverified; see README open item 1. |
| `APIGEE_USER_OID_HEADER` | `x-colt-user-oid` | Docs disagree; see README open item 3. |
| `GCS_UPLOAD_BUCKET` | — | Required when `TRANSLATION_UPLOAD_MODE=gcs_signed`. |
| `GCS_SIGNER_SERVICE_ACCOUNT` | — | Needed for `signBlob` signing on Cloud Run. |
| `SESSION_ABSOLUTE_TTL_SECONDS` | `28800` | 8 h, aligned with IAP. |
| `SESSION_IDLE_TTL_SECONDS` | `3600` | |
| `SESSION_ROTATION_GRACE_SECONDS` | `30` | docs 13 §2. |
| `SESSION_CACHE_TTL_SECONDS` | `10` | Capped at 15 (docs 13 §4). |
| `SESSION_ROTATE_ON_REFRESH` | `true` | See README open item 9. |
| `SESSION_REFRESH_LEASE_SECONDS` | `10` | Must exceed `ENTRA_HTTP_TIMEOUT_SECONDS`; enforced. |
| `ENTRA_HTTP_TIMEOUT_SECONDS` | `5` | Must sit well inside the lease (docs 13 §3). |
| `FIRESTORE_TIMEOUT_SECONDS` | `2` | docs 13 §4. |
| `DEV_SESSION_*` | see `config.py` | `AUTH_MODE=dev` only. `DEV_SESSION_ROLES` is comma-separated. |
| `LOG_LEVEL` | `INFO` | |

## IAM required by `aihub-bff-sa`

Plan task 35. Confirm these before deploying with `AUTH_MODE=entra`; raise a Terraform request if
any are missing.

- `roles/datastore.user` — Firestore sessions
- `roles/cloudkms.cryptoKeyEncrypterDecrypter` on the session key — DEK wrap/unwrap
- `roles/secretmanager.secretAccessor` on `entra-bff-client-secret` and `apigee-bff-client-key`
- `roles/storage.objectAdmin` on `GCS_UPLOAD_BUCKET` — signed uploads
- `roles/iam.serviceAccountTokenCreator` **on itself** — required for `signBlob` URL signing

## Tests

```bash
pytest                    # 77 tests, in-memory store, no GCP needed
ruff check app tests && ruff format --check app tests && mypy app
```

The suite runs against `InMemorySessionStore` by default so that failures can be injected precisely
— the rules under test (expiry, lease, rotation, fail-closed) are the BFF's, not Firestore's.
Set `FIRESTORE_EMULATOR_HOST` to exercise the real store.
