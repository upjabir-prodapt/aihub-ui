# Microsoft Entra ID setup for AI Hub

**Scope.** This document owns the two Entra app registrations and the BFF's environment-variable
contract. It supersedes `AICOE-Terraform/docs/18-entra-id-complete-setup-guide.md` §2, §3, §9, §11
and §13.

Doc 18 remains authoritative for everything this document does not cover: the Workforce Identity
Pool (§6), the Terraform stages that wire IAP (§4, §7, §8), and the front-door load balancer (§10).

> **Already worked through doc 18 §3?** Most of it stands. Jump to
> [§9 — Delta if you followed doc 18 §3](#9-delta-if-you-followed-doc-18-3) for the short list of
> what still has to change, then come back for the environment contract in §5.

> **Doc 18 was written against a Next.js application that no longer exists.** It refers to
> `server/config/env.ts`, `server/entra/oidcClient.ts` and `app/auth/callback/route.ts`. The BFF is
> now Python/FastAPI under `bff/app/`. In particular, **ignore doc 18 §9's instruction to edit the
> three hardcoded `api://aicoe-platform` occurrences in `server/entra/oidcClient.ts`** — that file
> does not exist and nothing in the BFF hardcodes an Application ID URI. Everything is env-driven.

---

## 1. The three-token model

The single most important thing to understand, and the thing doc 18 gets wrong. The BFF handles
**three distinct tokens**. They are never interchangeable, because in OAuth an access token has
exactly one audience.

| Token | Audience (`aud`) | Who issues it | Who validates it | Used for |
|---|---|---|---|---|
| **IAP assertion** | The IAP backend service | Google IAP | `bff/app/auth/iap.py` | Proving the person got past the front door; the only trusted source of `login_hint` |
| **API access token** | `AICOE-API-DEV` | Entra, via the scopes in `ENTRA_SCOPES` | `bff/app/auth/oidc.py` and Apigee's Verify JWT | Carries `roles[]`; forwarded upstream; decides what the user may call |
| **Graph access token** | `https://graph.microsoft.com` | Entra, via a **second** exchange using `GRAPH_SCOPES` | Microsoft Graph | One `GET /v1.0/me` call at sign-in for `department` / `companyName` |

Two consequences follow directly, and both were live bugs:

1. **`ENTRA_SCOPES` may name only one resource.** Putting `User.Read` (Graph) in the same `scope=`
   as `<APP_ID_URI>/Translation.Translate` (your API) makes Entra reject the whole request with
   `invalid_scope` / `AADSTS28000`. The BFF now refuses to start on this
   (`bff/app/config.py::_single_resource_scopes`).
2. **Graph needs its own token exchange.** The BFF redeems the refresh token a second time against
   `GRAPH_SCOPES` (`OidcClient.acquire_graph_token`). This is invisible to the operator, but it is
   why `offline_access` is mandatory.

---

## 2. `AICOE-API-DEV` — the resource app

Build this first: its scopes and App Roles must exist before the BFF app can request them.

### 2.1 Registration

**Identity → Applications → App registrations → + New registration.**

| Field | Value |
|---|---|
| Name | `AICOE-API-DEV` |
| Supported account types | Accounts in this organizational directory only (Single tenant) |
| Redirect URI | leave blank — nobody signs into this app |

Record the **Application (client) ID** from the Overview page. Call it `<AICOE_API_CLIENT_ID>`.
Under `requestedAccessTokenVersion: 2` this GUID — not the URI below — is the token audience.

### 2.2 Application ID URI

**Expose an API → Set** next to Application ID URI.

Most tenants (including Colt's) block vanity URIs that do not derive from something Entra can prove
you own, failing with *"All newly added URIs must contain a tenant verified domain, tenant ID, or
app ID"*. Three options:

| Option | Value | Trade-off |
|---|---|---|
| **A — app ID (recommended)** | `api://<AICOE_API_CLIENT_ID>` | What Entra pre-fills. Always passes tenant policy, needs no admin change, and keeps scope strings short |
| B — verified domain | `api://aicoe-platform.colt.net` | Readable, but the domain must first be verified on the tenant |
| C — tenant ID | `api://<TENANT_ID>/aicoe-platform` | Works immediately, ties the URI to the tenant |

Record the final value as `<AICOE_API_APP_ID_URI>`. It becomes the prefix of every scope string, so
pick it once and never change it casually — changing it invalidates existing consents.

### 2.3 Set the access-token version — **do not skip this**

**App registration → Manifest** → set `"requestedAccessTokenVersion": 2` → Save. In the newer
manifest editor this is under the *Microsoft Graph App Manifest* view; the older
`accessTokenAcceptedVersion` key is the same setting.

This is absent from doc 18 and it is the difference between a working system and one where sign-in
appears to succeed but every API call returns 403.

| `requestedAccessTokenVersion` | `iss` | `aud` |
|---|---|---|
| `null` or `1` (default) | `https://sts.windows.net/<TENANT_ID>/` | the Application ID URI |
| **`2`** | `https://login.microsoftonline.com/<TENANT_ID>/v2.0` | the **client ID GUID** |

Source: [Microsoft access token claims reference](https://learn.microsoft.com/en-us/entra/identity-platform/access-token-claims-reference)
— *"In v2.0 tokens, this value is always the client ID of the API."*

v2 is required because Apigee's Verify JWT and the BFF both discover from the v2 endpoints. The BFF
accepts both issuer forms so a wrong setting is diagnosable rather than silent, but v2 is the
supported configuration.

### 2.4 Delegated scopes

**Expose an API → + Add a scope.** Create three. Who can consent: **Admins and users**;
State: **Enabled**.

| Scope | Admin consent display name |
|---|---|
| `access_as_user` | Access AI CoE platform as the signed-in user |
| `Translation.Translate` | Use the Translation service as the signed-in user |
| `Sales.Research` | Use the Sales Agent research service as the signed-in user |

The BFF requests only the latter two; `access_as_user` is harmless to keep for other clients.

### 2.5 App Roles

**App roles → + Create app role**, three times. Allowed member types: **Users/Groups** (not
Applications) — this is what lets you assign a group rather than individuals.

| Display name | Value | Grants |
|---|---|---|
| Translation User | `Translation.User` | `/api/translation/*` |
| Sales Agent User | `SalesAgent.User` | `/api/sales/*` |
| Platform Admin | `Platform.Admin` | both, plus admin endpoints |

These values are matched in `bff/app/proxy/routes.py:33-34`, which also tolerates the legacy
spelling `Sales.User`. Prefer `SalesAgent.User`.

App Roles are **not** scopes. They are assigned ahead of time and appear automatically in the
`roles[]` claim; they are never requested via `scope=`. A missing scope breaks the token exchange; a
missing App Role breaks authorization while sign-in still succeeds.

### 2.6 Claims

- **`department` / `companyName`:** not available. Entra's optional-claims picker only offers a fixed
  built-in set, and these are Graph profile properties, not claims. They are resolved by the Graph
  call described in §1 (docs 19 Option A). Nothing to configure here.
- **Groups claim:** not needed on this app. Apigee authorizes on `roles[]`, never on `groups`. Adding
  it is harmless but only enlarges the token.

---

## 3. `AICOE-BFF-DEV` — the confidential client

### 3.1 Registration

**App registrations → + New registration.** Name `AICOE-BFF-DEV`, single tenant.

**+ Add a platform → Web** — *not* Single-Page Application. A SPA cannot hold a secret and would
push tokens into browser JavaScript, breaking the design where the browser only ever sees an opaque
session cookie.

Redirect URIs (all three, on the Web platform):

| URI | Why |
|---|---|
| `https://aihub.aicoedev-int.colt.net/auth/callback` | The app's own callback (`ENTRA_REDIRECT_URI`) |
| `http://localhost:8080/auth/callback` | Local development |
| `https://auth.cloud.google/signin-callback/locations/global/workforcePools/<POOL_ID>/providers/entra` | Google's workforce pool callback (doc 18 §6.4). Add it after creating the pool |

Under **Authentication**, also set a **Front-channel logout URL** of
`https://aihub.aicoedev-int.colt.net/auth/frontchannel-logout`, and leave **both implicit grant
boxes unchecked**.

> **Not `/auth/logout`.** Entra calls this URL as a `GET` in a hidden iframe; `/auth/logout` is a
> CSRF-protected `POST` and will answer 405 where nobody can see it, leaving sessions alive after an
> Entra-initiated sign-out. Doc 18 §3.3 step 6 gets this wrong.

> If you set `ENTRA_POST_LOGOUT_REDIRECT_URI`, that exact URI must **also** be registered as a
> redirect URI. Entra silently ignores an unregistered `post_logout_redirect_uri`. The front-channel
> logout URL is a different field and does not cover this.

Record the **Application (client) ID** as `<AICOE_BFF_CLIENT_ID>` → `ENTRA_CLIENT_ID`.

### 3.2 Client credential

**Certificates & secrets.** Prefer a certificate if your PKI supports it. Otherwise create a client
secret with a ≤24-month expiry and a calendar reminder. **Copy the value immediately** — Entra shows
it once.

Upload it to Secret Manager; it must never reach a `.tfvars`, a committed `.env`, or an image:

```bash
gcloud secrets versions add entra-bff-client-secret \
  --project=gclt-aicoe-dev-aihub-ui \
  --data-file=-
```

The secret *container* is created by Terraform stage `2-foundations`; only the version is manual.

> **Rotate now if you have not already.** A live client secret was committed in plaintext to
> `AICOE-Terraform/docs/18-entra-id-complete-setup-guide.md:196`. Treat it as compromised.

### 3.3 API permissions

**API permissions → + Add a permission:**

| Source | Permission | Type |
|---|---|---|
| My APIs → `AICOE-API-DEV` | `access_as_user` | Delegated |
| My APIs → `AICOE-API-DEV` | `Translation.Translate` | Delegated |
| My APIs → `AICOE-API-DEV` | `Sales.Research` | Delegated |
| Microsoft Graph | `User.Read` | Delegated |

Then **Grant admin consent for Colt**. Without consent every user sees a consent prompt on first
sign-in.

`User.Read` is required for the Graph exchange, but it must **not** appear in `ENTRA_SCOPES` — see
§1. A permission granted on the app registration and a scope requested at runtime are different
things.

### 3.4 Groups claim — required on this app

**Token configuration → + Add groups claim.** Tick **ID** (Access optional; only the ID token
reaches Google).

This is the app whose ID token Google's workforce pool validates and maps via
`google.groups = assertion.groups`. Without it the token arrives with no `groups` claim, the
`principalSet://.../group/<id>` binding matches zero principals, and **IAP denies every user with no
useful error**. This is the most common failure in the whole build.

Choose the source deliberately:

| Option | Emits | Also required | Trade-off |
|---|---|---|---|
| **Groups assigned to the application** | Only groups assigned to this enterprise app | Enterprise applications → `AICOE-BFF-DEV` → Users and groups → add `App-AICoE-UI-Users` | Small, stable token. Needs Entra ID P1/P2 |
| Security groups | Every group the user is in | Nothing | No licence need, but past ~200 groups Entra substitutes `_claim_names` and federation breaks silently |

Verify by decoding a real ID token: it must contain `"groups": ["<App-AICoE-UI-Users Object ID>"]`.
`_claim_names` instead means overflow; nothing at all means the claim did not take effect.

---

## 4. Security groups

**Groups → New group** (type: Security):

| Group | Purpose |
|---|---|
| `App-AICoE-UI-Users` | Front-door access only. Carries **no App Role** — used solely for the IAP binding |
| `App-AICoE-Translation-Users` | Assigned the `Translation.User` App Role |
| `App-AICoE-SalesAgent-Users` | Assigned the `SalesAgent.User` App Role |
| `App-AICoE-Platform-Admins` | Assigned the `Platform.Admin` App Role |

Assign the three role-bearing groups via `AICOE-API-DEV` → its linked **Enterprise application** →
**Users and groups → + Add user/group**.

Anyone in an entitlement group must **also** be in `App-AICoE-UI-Users`. Front-door access and
entitlement are two separate checks; entitlement alone will not get someone past IAP.

Record the **Object ID** of `App-AICoE-UI-Users` — Terraform's `ui_user_group` needs it.

---

## 5. BFF environment contract

Every variable enforced by `Settings._require_mode_settings` (`bff/app/config.py`). The BFF
fails fast at startup, not at first request, so a missing value is a boot failure.

### Entra

| Variable | Value | Notes |
|---|---|---|
| `ENTRA_TENANT_ID` | `<TENANT_ID>` | |
| `ENTRA_CLIENT_ID` | `<AICOE_BFF_CLIENT_ID>` | The **BFF** app |
| `ENTRA_APP_ID_URI` | `<AICOE_API_APP_ID_URI>` | The **API** app. Scope prefix |
| `ENTRA_ACCESS_TOKEN_AUDIENCES` | `<AICOE_API_CLIENT_ID>` | Accepted `aud`. Under v2 the GUID; under v1 the URI. Space-delimit to accept both |
| `ENTRA_REDIRECT_URI` | `https://aihub.aicoedev-int.colt.net/auth/callback` | Must end `/auth/callback`; https outside localhost |
| `ENTRA_SCOPES` | `openid profile offline_access <APP_ID_URI>/Translation.Translate <APP_ID_URI>/Sales.Research` | One resource only. Must include `offline_access` |
| `ENTRA_CLIENT_SECRET_NAME` | `entra-bff-client-secret` | Secret Manager **name**, not the value |
| `GRAPH_SCOPES` | *(leave default)* | `openid profile offline_access https://graph.microsoft.com/User.Read` |
| `ENTRA_POST_LOGOUT_REDIRECT_URI` | optional | Must be registered in Entra if set |

### Where each Entra value comes from

Four of these are GUIDs or URIs that look interchangeable and are not. This is the lookup table:

| Placeholder | Which app | Exact click path |
|---|---|---|
| `<TENANT_ID>` | — | Identity → **Overview** → Tenant ID |
| `<AICOE_BFF_CLIENT_ID>` | **BFF** | App registrations → `AICOE-BFF-DEV` → **Overview** → Application (client) ID |
| `<AICOE_API_CLIENT_ID>` | **API** | App registrations → `AICOE-API-DEV` → **Overview** → Application (client) ID |
| `<AICOE_API_APP_ID_URI>` (a.k.a. `<APP_ID_URI>`) | **API** | App registrations → `AICOE-API-DEV` → **Expose an API** → Application ID URI (top of the blade) |

The two easiest mistakes, both of which produce a working sign-in followed by 403 on every API call:

- Using the **BFF's** client ID where the **API's** is required. `ENTRA_CLIENT_ID` is the only
  variable that takes the BFF's ID; everything else Entra-side is the API app.
- Using the **URI** where the **GUID** is required. `ENTRA_APP_ID_URI` takes the URI (it is the
  scope prefix); `ENTRA_ACCESS_TOKEN_AUDIENCES` takes the GUID (it is the `aud` claim under
  `requestedAccessTokenVersion: 2`). Both describe the same app — see §2.3.

To confirm the URI without leaving the blade: the scopes listed under *Expose an API* are shown
fully qualified, so `<APP_ID_URI>/Translation.Translate` should appear there verbatim. That string
is also exactly what goes into `ENTRA_SCOPES`.

### Platform

| Variable | Value |
|---|---|
| `IAP_ENABLED` / `IAP_AUDIENCE` | `true` / `/projects/<PROJECT_NUMBER>/global/backendServices/<NUMERIC_ID>` — the **numeric** backend service ID, not the name |
| `GCP_PROJECT_ID` | `gclt-aicoe-dev-aihub-ui` |
| `KMS_KEY_NAME` | full resource name of the `session` key |
| `FIRESTORE_DATABASE` | `(default)` |
| `APIGEE_BASE_URL` / `APIGEE_API_KEY_SECRET` | `https://aihub-api.aicoedev-int.colt.net` / `apigee-bff-client-key` |
| `GCS_UPLOAD_BUCKET` / `GCS_SIGNER_SERVICE_ACCOUNT` | upload bucket / `aihub-bff-sa@…` |

Full table with dev values: [`GITLAB_CI_VARIABLES.md`](GITLAB_CI_VARIABLES.md).

### IAM still required on `aihub-bff-sa`

Not yet present in Terraform. The BFF cannot start without the first one:

- `roles/secretmanager.secretAccessor` on `entra-bff-client-secret` and `apigee-bff-client-key`
- `roles/cloudkms.cryptoKeyEncrypterDecrypter` on the `session` key
- `roles/datastore.user`
- `roles/iam.serviceAccountTokenCreator` **on itself** (V4 signed URLs via `signBlob`)
- `roles/storage.objectAdmin` on `GCS_UPLOAD_BUCKET`

---

## 6. Apigee Verify JWT

The policy must agree with the BFF exactly:

| Setting | Value |
|---|---|
| JWKS URI | `https://login.microsoftonline.com/<TENANT_ID>/discovery/v2.0/keys` |
| Issuer | `https://login.microsoftonline.com/<TENANT_ID>/v2.0` |
| **Audience** | `<AICOE_API_CLIENT_ID>` — the same value as `ENTRA_ACCESS_TOKEN_AUDIENCES` |

> Doc 18 §11 specifies the v2 JWKS and v2 issuer but an **App ID URI** audience. That combination is
> self-contradictory and cannot validate: a v2 token never carries the URI as `aud`. Use the GUID.

Path-to-role mapping, default-deny for anything else:

| Path | Required App Role |
|---|---|
| `/api/translation/*` | `Translation.User` |
| `/api/sales/*` | `SalesAgent.User` |

Sequence the change as: set `requestedAccessTokenVersion: 2` → update Apigee → deploy the BFF. Or
configure both to accept the GUID *and* the URI for the duration of the switch.

---

## 7. Verification

1. Set `ENTRA_SCOPES` with `User.Read` still in it. The BFF must refuse to boot with a message
   naming `GRAPH_SCOPES`. Then remove it.
2. `/readyz` reports both secrets loaded.
3. Sign in. Decode the API access token at `jwt.ms` and confirm `ver` = `2.0`,
   `iss` = `https://login.microsoftonline.com/<TENANT_ID>/v2.0`, `aud` = `<AICOE_API_CLIENT_ID>`,
   and `roles[]` populated.
4. `GET /auth/session` returns non-empty `roles`, and `department` is a real value rather than
   `"Unknown Department"`.
5. A `Translation.User` reaches `/api/translation/*` and gets 403 on `/api/sales/*`.
6. Let a session pass `SESSION_REFRESH_AT_FRACTION` and confirm it survives. This is what proves the
   rotated refresh token from the Graph exchange was persisted.
7. Grep logs for `access_token_rejected` and `access_token_unvalidated`. Either one outside local
   dev is a configuration fault, not noise.

---

## 8. Troubleshooting

| Symptom | Cause |
|---|---|
| BFF exits at startup naming `GRAPH_SCOPES` | `ENTRA_SCOPES` contains a Graph or foreign-resource scope. One resource only |
| `invalid_scope` / `AADSTS28000` at authorize | Same root cause, reaching Entra. Also check all three scopes exist on `AICOE-API-DEV` and consent was granted |
| Sign-in succeeds, **every** API call 403s | Token version / audience mismatch. Check the `access_token_rejected` log for the actual `aud`, `iss`, `ver`, then reconcile `requestedAccessTokenVersion` with `ENTRA_ACCESS_TOKEN_AUDIENCES` |
| Sign-in fails with the "could not be exchanged or validated" page | Same as above, in a non-dev environment where the BFF now fails loudly instead of issuing a role-less session |
| `department` shows `Unknown Department` | Graph exchange failed (`graph_token_exchange_failed`) or `User.Read` was never consented |
| Session dies ~1 h after sign-in | Rotated refresh token from the Graph exchange not persisted |
| `AADSTS50011: redirect URI does not match` | The workforce-pool callback is missing from `AICOE-BFF-DEV` → Authentication (doc 18 §6.4) |
| Session survives a sign-out at Entra or another Microsoft app | Front-channel logout URL registered as `/auth/logout` instead of `/auth/frontchannel-logout`. Look for `frontchannel_logout_misconfigured` in the logs (§9.1 item 5) |
| IAP denies everyone, no error detail | Groups claim missing on `AICOE-BFF-DEV` (§3.4), or `workforce_pool` / `ui_user_group` mismatch |
| 403 immediately after IAP sign-in | IAP service agent lacks `roles/run.invoker` on the Cloud Run service |

---

## 9. Delta if you followed doc 18 §3

Doc 18 §3.1–§3.4 gets most of the Entra work right. If you have already completed it — both app
registrations, the three scopes, the three App Roles, the groups claim on the BFF app, and the four
security groups — **do not rebuild anything.** Only the five items below are outstanding.

### 9.1 Blocking

| # | Action | Where |
|---|---|---|
| 1 | **Set `requestedAccessTokenVersion: 2`** on `AICOE-API-DEV` | Manifest. §2.3 |
| 2 | **Record `AICOE-API-DEV`'s client ID** — it becomes `ENTRA_ACCESS_TOKEN_AUDIENCES` | Its Overview page |
| 3 | **Rotate the client secret** on `AICOE-BFF-DEV` | Certificates & secrets. §3.2 |
| 4 | ~~Drop the `department` / `organization` attribute mappings~~ — **already correct**, verified via gcloud | See 9.6 |
| 5 | **Fix the front-channel logout URL** | Authentication blade |

Item 1 is the one that decides whether the system works at all. Doc 18 never mentions it, so it is
certainly still at its default, which means Entra is issuing v1 access tokens. Nothing else in this
list will save you if it stays that way.

Item 5: doc 18 §3.3 step 6 tells you to register `https://aihub.aicoedev-int.colt.net/auth/logout`,
and that value is currently live in the app registration. It is wrong.

Entra loads the front-channel logout URL in a **hidden iframe with a `GET`**. `/auth/logout` is a
CSRF-protected `POST` (docs 13 §1 forbids a GET-reachable logout), so Entra receives a 405, the
iframe swallows it, and nothing happens. **Single sign-out is silently broken**: when the user signs
out at Entra or from another Microsoft application in the same browser, the AI Hub session document
is never deleted and survives until its idle or absolute TTL — up to
`SESSION_ABSOLUTE_TTL_SECONDS` (8 hours by default).

Change it to:

```
https://aihub.aicoedev-int.colt.net/auth/frontchannel-logout
```

The rest of that chain is already correct. Entra appends `?sid=<session id>` because the ID token
carries a `sid` claim; `frontchannel_logout` passes it to `terminate_by_entra_sid`, which matches
the `entra_sid` stored on the session record.

Because the failure is invisible from the outside, `GET /auth/logout` now returns an explicit 405
naming the correct path and logs `frontchannel_logout_misconfigured`. Grep for that event to confirm
whether the old URL is still in use.

### 9.2 Verify, do not assume

Doc 18's recorded values are inconsistent in places, so confirm each of these in the portal rather
than copying them out of that file:

| Value | Doc 18 says | Check |
|---|---|---|
| `AICOE-API-DEV` Application ID URI | `api://6d43552a-585f-4378-a25f-aae53c026a73/aicoe-platform` (§3.2 step 7) | Expose an API blade |
| `AICOE-API-DEV` client ID | never recorded | Overview page. It is *probably* `6d43552a-…`, since Entra prefills `api://<client-id>` and the guide appended `/aicoe-platform` — but confirm |
| `AICOE-BFF-DEV` client ID | `8d3f5771-1758-4740-ab11-785440cd477e` (§3.3 step 9) | ✅ Confirmed — matches the `aud` of a live ID token |
| Graph `User.Read` | §3.3 step 16 says it is "often already listed by default" | API permissions — verify it is present **and** admin-consented |

### 9.3 The tenant ID conflict — resolved

Doc 18 records two different tenant IDs:

- line 63: `f820f6ca-864c-41c0-b2aa-49527f91cc4a` — **wrong, ignore it**
- lines 121–122: `b859cf7e-ff8a-40bb-bd0f-da56e6dc0eb8` — correct

Confirmed from the `tid` claim of a real workforce-pool ID token. Use
`b859cf7e-ff8a-40bb-bd0f-da56e6dc0eb8` for `ENTRA_TENANT_ID`, the workforce pool issuer URL
(`https://login.microsoftonline.com/b859cf7e-ff8a-40bb-bd0f-da56e6dc0eb8/v2.0`), and Apigee's JWKS
and issuer. A wrong tenant ID fails closed — the BFF pins the `tid` claim — but surfaces only as a
generic token-validation failure.

### 9.4 What does **not** need redoing

- Both app registrations, and the Web platform / implicit-grant-off configuration.
- The three delegated scopes and the three App Roles, including the `Users/Groups` member type.
- The groups claim on `AICOE-BFF-DEV` (doc 18 §3.3 steps 18–21). Still required, still correct.
- Skipping `department` / `companyName` in the optional-claims picker. Correct — they are resolved
  through Graph.
- The four security groups and their App Role assignments.
- The groups claim on `AICOE-API-DEV` (§3.2 step 12). Redundant but harmless; leave it.

### 9.5 Resulting configuration

Both values come from the **`AICOE-API-DEV`** registration (see the lookup table in §5):

- `<API_ID>` — its **Overview** page → Application (client) ID. Doc 18 never recorded this.
- `<API_URI>` — its **Expose an API** blade → Application ID URI. Doc 18 §3.2 step 7 says
  `api://6d43552a-585f-4378-a25f-aae53c026a73/aicoe-platform`.

```bash
# Confirmed from a live workforce-pool ID token (§9.7)
ENTRA_TENANT_ID=b859cf7e-ff8a-40bb-bd0f-da56e6dc0eb8
ENTRA_CLIENT_ID=8d3f5771-1758-4740-ab11-785440cd477e

# Still to be read off AICOE-API-DEV in the portal
ENTRA_APP_ID_URI=<API_URI>
ENTRA_ACCESS_TOKEN_AUDIENCES=<API_ID>

ENTRA_REDIRECT_URI=https://aihub.aicoedev-int.colt.net/auth/callback
ENTRA_SCOPES="openid profile offline_access <API_URI>/Translation.Translate <API_URI>/Sales.Research"
ENTRA_CLIENT_SECRET_NAME=entra-bff-client-secret
```

If doc 18's recorded URI holds, that resolves to:

```bash
ENTRA_APP_ID_URI=api://6d43552a-585f-4378-a25f-aae53c026a73/aicoe-platform
ENTRA_ACCESS_TOKEN_AUDIENCES=6d43552a-585f-4378-a25f-aae53c026a73
ENTRA_SCOPES="openid profile offline_access api://6d43552a-585f-4378-a25f-aae53c026a73/aicoe-platform/Translation.Translate api://6d43552a-585f-4378-a25f-aae53c026a73/aicoe-platform/Sales.Research"
```

The GUID appears in both because doc 18 built the URI from the API app's own client ID. **Verify
that on the Overview page** — if `AICOE-API-DEV`'s client ID turns out to be something other than
`6d43552a-…`, then `ENTRA_ACCESS_TOKEN_AUDIENCES` is that other value and only `ENTRA_APP_ID_URI`
keeps the `6d43552a-…` form.

Note that `ENTRA_APP_ID_URI` and `ENTRA_ACCESS_TOKEN_AUDIENCES` are **different values from the same
app** — the URI and the GUID. That is not a mistake; it is what
`requestedAccessTokenVersion: 2` means (§2.3).

If doc 18's URI stands, the scope strings are long but valid, e.g.
`api://6d43552a-585f-4378-a25f-aae53c026a73/aicoe-platform/Translation.Translate`.

### 9.6 Workforce pool attribute mapping — deployed state is correct

Doc 18 §6.3 prescribes four mappings, two of which reference claims that **cannot exist**:
`assertion.department` and `assertion.companyName`. Doc 18 §3.2 step 11 already establishes that
Entra's optional-claims picker does not offer them, because they are Microsoft Graph profile
properties rather than token claims — that is the entire reason docs 19 Option A exists. §6.3 then
maps them anyway.

**The pool as actually built does not have them**, verified with:

```bash
gcloud iam workforce-pools providers list \
  --workforce-pool=colt-aicoe-aihubui-auth --location=global --format=yaml
```

```yaml
attributeMapping:
  google.display_name: assertion.name
  google.groups: assertion.groups
  google.subject: assertion.oid
oidc:
  clientId: 8d3f5771-1758-4740-ab11-785440cd477e
  issuerUri: https://login.microsoftonline.com/b859cf7e-ff8a-40bb-bd0f-da56e6dc0eb8/v2.0
  webSsoConfig:
    responseType: CODE
```

No action needed. Two deviations from doc 18, both improvements:

- `google.subject` maps from `assertion.oid` rather than `assertion.sub`. Better: `oid` is the
  tenant-wide stable object ID, whereas `sub` is pairwise per client application and would change if
  the pool were ever repointed at a different app registration.
- The two impossible mappings were never added.

`google.groups ← assertion.groups` is present, which is the one IAP actually depends on.

> **Three workforce pools exist in the org**, and only one is correct:
>
> ```
> colt-aicoe-aihubui-auth   ← the one to use
> colt-aiappsui-auth        ← the stale name checked into envs/dev/terraform.tfvars
> colt-dev-aiappsui-auth
> ```
>
> Because `colt-aiappsui-auth` genuinely exists, a wrong `workforce_pool` in `terraform.tfvars`
> will **not** error. Stage 6a will happily build a `principalSet://` binding against a real pool
> that contains none of your users, and IAP will deny everyone with no diagnostic. Set
> `workforce_pool = "colt-aicoe-aihubui-auth"` before applying.

### 9.7 Values confirmed from a live workforce-pool ID token

| Value | Confirmed |
|---|---|
| `ENTRA_TENANT_ID` | `b859cf7e-ff8a-40bb-bd0f-da56e6dc0eb8` |
| `ENTRA_CLIENT_ID` | `8d3f5771-1758-4740-ab11-785440cd477e` (the token's `aud`) |
| `ui_user_group` (Terraform) | `874d0e37-2dd6-4b85-acd3-fcc2a9cc6e79` — the sole entry in `groups[]`. Confirm it is `App-AICoE-UI-Users`'s Object ID before applying stage 6a |

A single-entry `groups[]` array indicates the claim is scoped to "Groups assigned to the
application", which is the recommended setting: no overflow risk, and `_claim_names` will never
appear.

> **An ID token says nothing about the access-token version.** ID tokens from the v2 endpoint always
> carry `"ver": "2.0"`. The access token's version is governed independently by
> `requestedAccessTokenVersion` on `AICOE-API-DEV`. Item 1 in §9.1 is still outstanding no matter
> what this token shows.

### 9.8 `preferred_username` and `email` differ

The observed token carries `preferred_username: JMohammed@INTERNAL.COLT.NET` (the UPN) but
`email: jabir.mohammed@colt.net` (the routable address). They are not interchangeable.

`OidcClient.principal_from` (`bff/app/auth/oidc.py`) prefers `preferred_username`, so the UPN is
what `/auth/session` returns to the SPA and what Apigee sees. Authorization is unaffected —
everything keys on `oid`, which is stable — but if a downstream system or a report expects the
routable address, this is where the mismatch originates. Change the claim preference in
`principal_from` rather than patching it downstream.

### 9.9 Still ahead of you in doc 18

§3.5 sends you to Part B. Those steps are unchanged and remain authoritative:

- **§5** — upload the (newly rotated) client secret into Secret Manager.
- **§6** — create the Workforce Identity Pool and its `entra` provider, then return to
  `AICOE-BFF-DEV` → Authentication and add the pool's redirect URI. Doc 18 §6.4 flags this as a
  "come back to Entra" step and it is the usual cause of `AADSTS50011`.
- **§7–§8** — `workforce_pool` and `ui_user_group` in `terraform.tfvars`, then stage `6a`. Watch the
  pool-name inconsistency noted in doc 18 §7.
- **§10–§12** — ingress, Apigee (use the audience from §6 of *this* document, not doc 18 §11), and
  the end-to-end test.
