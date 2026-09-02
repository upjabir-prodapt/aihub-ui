"""Typed BFF settings.

Every setting comes from the environment. Secrets are *names* here; the actual
values are resolved from Secret Manager at startup by ``app.secrets.manager``
and are never read from environment variables in a deployed environment
(gap G15).

Validation is fail-fast: a missing or malformed setting raises at import/startup
time, not at the first request. ``ENTRA_APP_ID_URI`` in particular is called out
in docs 18 §9 as a known failure mode when hardcoded or omitted.
"""

from __future__ import annotations

import functools
from typing import Literal
from urllib.parse import urlparse

from pydantic import ValidationInfo, field_validator, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

Environment = Literal["dev", "sandbox", "prod"]
AuthMode = Literal["entra", "dev"]
UpstreamMode = Literal["apigee", "mock"]
DownstreamAuthMode = Literal["headers", "colt_session"]
UploadMode = Literal["gcs_signed", "multipart"]

SESSION_COOKIE_NAME = "__Host-AISESSION"
CSRF_HEADER_NAME = "X-CSRF-Token"

# Scopes that are not tied to a resource and may be combined with any one
# resource's scopes in a single authorization request.
RESERVED_OIDC_SCOPES = frozenset({"openid", "profile", "email", "offline_access"})


class ConfigError(RuntimeError):
    """Raised when the process is not configured well enough to serve traffic."""


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=None,
        extra="ignore",
        case_sensitive=False,
        frozen=True,
    )

    # ── Runtime ──────────────────────────────────────────────────────────────
    environment: Environment = "dev"
    log_level: str = "INFO"
    port: int = 8080

    auth_mode: AuthMode = "entra"
    upstream_mode: UpstreamMode = "apigee"
    downstream_auth_mode: DownstreamAuthMode = "headers"
    translation_upload_mode: UploadMode = "gcs_signed"

    # Serving the built SPA is disabled in docker-compose dev, where Vite owns it.
    serve_spa: bool = True
    spa_dist_dir: str = "/srv/static"

    # ── Security headers (gap G16; the gap register names the headers but
    # specifies no values, so these are ours) ────────────────────────────────
    hsts_max_age_seconds: int = 31_536_000
    csp_connect_src_extra: str = ""
    csp_report_only: bool = False

    # ── Entra ID ─────────────────────────────────────────────────────────────
    entra_tenant_id: str = ""
    entra_client_id: str = ""
    entra_app_id_uri: str = ""
    # Accepted ``aud`` values for the API access token, space-separated. Empty
    # means "just ENTRA_APP_ID_URI". The correct value depends on the resource
    # app's ``requestedAccessTokenVersion``: v1 tokens carry the App ID URI, v2
    # tokens carry the resource app's client ID GUID. Listing both lets the two
    # be switched independently of a redeploy.
    entra_access_token_audiences: str = ""
    entra_redirect_uri: str = ""
    entra_scopes: str = ""
    entra_client_secret_name: str = "entra-bff-client-secret"
    entra_authority_host: str = "https://login.microsoftonline.com"
    entra_post_logout_redirect_uri: str = ""
    graph_base_url: str = "https://graph.microsoft.com"
    # Graph needs its own token: one access token has exactly one audience, so
    # ``User.Read`` can never share a request with the platform API scopes.
    graph_scopes: str = "openid profile offline_access https://graph.microsoft.com/User.Read"
    # docs 19 §3.3: exact fail-open placeholders.
    graph_unknown_department: str = "Unknown Department"
    graph_unknown_company: str = "Unknown Company"

    # ── IAP ──────────────────────────────────────────────────────────────────
    iap_enabled: bool = True
    iap_audience: str = ""
    # Not written down in the reference docs (see open items); kept configurable.
    iap_clear_cookie_path: str = "/_gcp_iap/clear_login_cookie"

    # ── GCP ──────────────────────────────────────────────────────────────────
    gcp_project_id: str = ""
    firestore_database: str = "(default)"
    firestore_emulator_host: str = ""
    kms_key_name: str = ""
    gcs_upload_bucket: str = ""
    gcs_signer_service_account: str = ""

    # ── Apigee ───────────────────────────────────────────────────────────────
    apigee_base_url: str = ""
    apigee_api_key_secret: str = "apigee-bff-client-key"
    # Open item §13: the header name Apigee reads the key from is not written down
    # anywhere in the reference docs. `x-apikey` is Apigee's default and is assumed.
    apigee_api_key_header: str = "x-apikey"
    # Apigee proxy basepaths (docs 15 §B.11 routes /api/translation/* and /api/sales/*).
    apigee_translation_path: str = "/api/translation/v1"
    apigee_sales_path: str = "/api/sales/v1"
    # Plan §8 says `x-colt-user-oid`; docs 18 §3.2 reference impl says `x-colt-user-id`.
    # Configurable so the mismatch can be resolved without a code change.
    apigee_user_oid_header: str = "x-colt-user-oid"

    # ── Session lifecycle (docs 13) ──────────────────────────────────────────
    session_absolute_ttl_seconds: int = 28_800
    session_idle_ttl_seconds: int = 3_600
    session_rotation_grace_seconds: int = 30
    session_cache_ttl_seconds: float = 10.0
    session_last_seen_throttle_seconds: int = 60
    session_refresh_at_fraction: float = 0.80
    session_refresh_jitter_seconds: int = 30
    session_refresh_lease_seconds: int = 10
    # docs 13 §3: a loser waiting more than ~2 s fails the request with 503 rather
    # than holding a Cloud Run instance open.
    session_refresh_loser_max_wait_seconds: float = 2.0
    # Plan §7 rotates on refresh. docs 13 §2 says rotate only on authentication and
    # privilege change ("access-token renewal is not a privilege change"). Rotation
    # on authentication and on a roles change is unconditional; this flag controls
    # only the plain-refresh case.
    session_rotate_on_refresh: bool = True

    firestore_timeout_seconds: float = 2.0
    firestore_breaker_threshold: int = 5
    firestore_breaker_reset_seconds: float = 10.0
    entra_http_timeout_seconds: float = 5.0
    graph_http_timeout_seconds: float = 3.0
    upstream_timeout_seconds: float = 120.0

    auth_state_ttl_seconds: int = 600

    # ── AUTH_MODE=dev only ───────────────────────────────────────────────────
    dev_session_email: str = "dev@colt.net"
    dev_session_name: str = "Dev User"
    dev_session_oid: str = "00000000-0000-0000-0000-000000000000"
    dev_session_department: str = "AI CoE"
    dev_session_company: str = "Colt Technology Services"
    dev_session_roles: str = "Translation.User,Sales.User"

    # ── Derived ──────────────────────────────────────────────────────────────
    @property
    def is_dev_auth(self) -> bool:
        return self.auth_mode == "dev"

    @property
    def entra_authority(self) -> str:
        return f"{self.entra_authority_host.rstrip('/')}/{self.entra_tenant_id}"

    @property
    def entra_discovery_url(self) -> str:
        return f"{self.entra_authority}/v2.0/.well-known/openid-configuration"

    @property
    def scope_list(self) -> list[str]:
        return self.entra_scopes.split()

    @property
    def access_token_audiences(self) -> list[str]:
        """Every ``aud`` value the API access token may legitimately carry.

        PyJWT treats a list as "any of these match", which is what lets one
        deployment span a v1 -> v2 access-token migration on the resource app.
        """
        explicit = self.entra_access_token_audiences.split()
        return explicit or ([self.entra_app_id_uri] if self.entra_app_id_uri else [])

    @property
    def v1_issuer(self) -> str:
        """Issuer of a v1 access token. v2 tokens come from the authority host."""
        return f"https://sts.windows.net/{self.entra_tenant_id}/"

    @property
    def dev_roles(self) -> list[str]:
        return [r.strip() for r in self.dev_session_roles.split(",") if r.strip()]

    @property
    def use_firestore_emulator(self) -> bool:
        return bool(self.firestore_emulator_host)

    # ── Validation ───────────────────────────────────────────────────────────
    @field_validator("log_level")
    @classmethod
    def _upper_log_level(cls, v: str) -> str:
        level = v.upper()
        if level not in {"CRITICAL", "ERROR", "WARNING", "INFO", "DEBUG"}:
            raise ValueError(f"LOG_LEVEL must be a standard level name, got {v!r}")
        return level

    @field_validator("session_refresh_at_fraction")
    @classmethod
    def _fraction_range(cls, v: float) -> float:
        if not 0.1 <= v <= 0.99:
            raise ValueError("SESSION_REFRESH_AT_FRACTION must be between 0.1 and 0.99")
        return v

    @field_validator("session_cache_ttl_seconds")
    @classmethod
    def _cache_ttl_range(cls, v: float) -> float:
        # docs 13 §4: "an in-instance cache of 5 to 15 seconds". Longer means a
        # revoked session stays usable for longer.
        if not 0 <= v <= 15:
            raise ValueError("SESSION_CACHE_TTL_SECONDS must be between 0 and 15 (docs 13 §4)")
        return v

    @field_validator("entra_redirect_uri")
    @classmethod
    def _https_redirect(cls, v: str, info: ValidationInfo) -> str:
        if not v:
            return v
        parsed = urlparse(v)
        if parsed.scheme not in {"http", "https"}:
            raise ValueError("ENTRA_REDIRECT_URI must be an absolute http(s) URL")
        if parsed.scheme == "http" and parsed.hostname not in {"localhost", "127.0.0.1"}:
            raise ValueError("ENTRA_REDIRECT_URI must use https outside localhost")
        if not parsed.path.endswith("/auth/callback"):
            raise ValueError("ENTRA_REDIRECT_URI must end with /auth/callback")
        return v

    @field_validator("entra_app_id_uri")
    @classmethod
    def _app_id_uri_shape(cls, v: str) -> str:
        if v and not (v.startswith("api://") or v.startswith("https://")):
            raise ValueError(
                "ENTRA_APP_ID_URI must look like 'api://<client-id>' or an https URI (docs 18 §9)"
            )
        return v.rstrip("/")

    @model_validator(mode="after")
    def _single_resource_scopes(self) -> Settings:
        """``ENTRA_SCOPES`` must name exactly one resource.

        Entra issues one access token per resource. A ``scope=`` that mixes
        Microsoft Graph with the platform API is rejected outright
        (``invalid_scope`` / ``AADSTS28000``), and the symptom -- a failed code
        exchange -- looks identical to a missing scope. Catching it here turns a
        confusing runtime failure into a boot-time one.
        """
        prefix = self.entra_app_id_uri
        if self.auth_mode != "entra" or not self.entra_scopes or not prefix:
            # A missing ENTRA_APP_ID_URI is reported by _require_mode_settings;
            # flagging every scope as an offender here would only bury it.
            return self

        offenders = [
            scope
            for scope in self.scope_list
            if scope not in RESERVED_OIDC_SCOPES and not scope.startswith(f"{prefix}/")
        ]

        if offenders:
            raise ConfigError(
                "Invalid BFF configuration; refusing to start.\n  - "
                f"ENTRA_SCOPES may only contain the reserved OIDC scopes "
                f"({' '.join(sorted(RESERVED_OIDC_SCOPES))}) and scopes belonging to the "
                f"one resource named by ENTRA_APP_ID_URI ({prefix!r}). "
                f"Offending scope(s): {' '.join(offenders)}.\n  - "
                "Microsoft Graph scopes such as 'User.Read' or "
                "'https://graph.microsoft.com/User.Read' must NOT appear here: Graph is a "
                "separate resource and gets its own token exchange. Configure it via "
                "GRAPH_SCOPES instead (docs: ENTRA_SETUP.md)."
            )
        return self

    @model_validator(mode="after")
    def _require_mode_settings(self) -> Settings:
        missing: list[str] = []

        def need(value: object, name: str) -> None:
            if not value:
                missing.append(name)

        if self.auth_mode == "entra":
            need(self.entra_tenant_id, "ENTRA_TENANT_ID")
            need(self.entra_client_id, "ENTRA_CLIENT_ID")
            # docs 18 §9: hardcoding or omitting this is a known failure mode.
            need(self.entra_app_id_uri, "ENTRA_APP_ID_URI")
            need(self.entra_redirect_uri, "ENTRA_REDIRECT_URI")
            need(self.entra_scopes, "ENTRA_SCOPES")
            need(self.entra_client_secret_name, "ENTRA_CLIENT_SECRET_NAME")
            need(self.gcp_project_id, "GCP_PROJECT_ID")
            if not self.use_firestore_emulator:
                need(self.kms_key_name, "KMS_KEY_NAME")

        if self.iap_enabled:
            need(self.iap_audience, "IAP_AUDIENCE")

        if self.upstream_mode == "apigee":
            need(self.apigee_base_url, "APIGEE_BASE_URL")
            need(self.apigee_api_key_secret, "APIGEE_API_KEY_SECRET")

        if self.translation_upload_mode == "gcs_signed":
            need(self.gcs_upload_bucket, "GCS_UPLOAD_BUCKET")

        if self.environment == "prod":
            if self.auth_mode != "entra":
                missing.append("AUTH_MODE must be 'entra' when ENVIRONMENT=prod")
            if self.upstream_mode != "apigee":
                missing.append("UPSTREAM_MODE must be 'apigee' when ENVIRONMENT=prod")
            if not self.iap_enabled:
                missing.append("IAP_ENABLED must be true when ENVIRONMENT=prod")

        if self.session_idle_ttl_seconds > self.session_absolute_ttl_seconds:
            missing.append("SESSION_IDLE_TTL_SECONDS must not exceed SESSION_ABSOLUTE_TTL_SECONDS")

        if self.entra_scopes and "offline_access" not in self.scope_list:
            missing.append("ENTRA_SCOPES must include 'offline_access' to obtain a refresh token")

        # docs 13 §3: "A 10-second lease with a 30-second HTTP timeout means the lease
        # expires while the call is still running ... and you have recreated the stampede."
        if self.entra_http_timeout_seconds >= self.session_refresh_lease_seconds:
            missing.append(
                "ENTRA_HTTP_TIMEOUT_SECONDS must be well inside "
                "SESSION_REFRESH_LEASE_SECONDS (docs 13 §3)"
            )

        if missing:
            raise ConfigError(
                "Invalid BFF configuration; refusing to start.\n  - " + "\n  - ".join(missing)
            )
        return self


@functools.lru_cache(maxsize=1)
def get_settings() -> Settings:
    """Process-wide settings singleton. Raises ConfigError at startup on bad config."""
    return Settings()
