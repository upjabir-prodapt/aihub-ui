"""Access-token validation across both Entra token versions.

Which version Entra issues is controlled by ``requestedAccessTokenVersion`` on
the *resource* app registration, which is not something this codebase can
observe. Getting it wrong used to produce an empty role set and a 403 on every
API call while sign-in still succeeded, so both shapes are accepted and a real
mismatch is loud.

* v1 (``null``/``1``): ``iss`` is ``https://sts.windows.net/<tid>/``,
  ``aud`` is the App ID URI.
* v2 (``2``): ``iss`` ends ``/v2.0``, ``aud`` is the resource client ID GUID.
"""

from __future__ import annotations

import time
from typing import Any

import httpx
import jwt
import pytest
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import rsa

from app.auth.oidc import OidcClient, OidcError
from app.config import Settings
from app.secrets.manager import EnvSecretResolver, SecretsManager

TENANT = "11111111-1111-1111-1111-111111111111"
API_CLIENT_ID = "22222222-2222-2222-2222-222222222222"
BFF_CLIENT_ID = "33333333-3333-3333-3333-333333333333"
APP_ID_URI = f"api://{API_CLIENT_ID}"

V2_ISSUER = f"https://login.microsoftonline.com/{TENANT}/v2.0"
V1_ISSUER = f"https://sts.windows.net/{TENANT}/"
KID = "test-key-1"

_KEY = rsa.generate_private_key(public_exponent=65537, key_size=2048)
_PRIVATE_PEM = _KEY.private_bytes(
    encoding=serialization.Encoding.PEM,
    format=serialization.PrivateFormat.PKCS8,
    encryption_algorithm=serialization.NoEncryption(),
)


def _settings(**overrides: object) -> Settings:
    base: dict[str, Any] = {
        "environment": "dev",
        "auth_mode": "entra",
        "upstream_mode": "mock",
        "iap_enabled": False,
        "translation_upload_mode": "multipart",
        "entra_tenant_id": TENANT,
        "entra_client_id": BFF_CLIENT_ID,
        "entra_app_id_uri": APP_ID_URI,
        "entra_redirect_uri": "https://aihub.test/auth/callback",
        "entra_scopes": f"openid profile offline_access {APP_ID_URI}/Translation.Translate",
        "gcp_project_id": "proj",
        "kms_key_name": "projects/p/locations/l/keyRings/r/cryptoKeys/k",
    }
    return Settings(**{**base, **overrides})


def make_token(*, aud: str, iss: str, tid: str = TENANT, **extra: Any) -> str:
    now = int(time.time())
    claims: dict[str, Any] = {
        "aud": aud,
        "iss": iss,
        "tid": tid,
        "iat": now,
        "exp": now + 3600,
        "oid": "44444444-4444-4444-4444-444444444444",
        "roles": ["Translation.User"],
        **extra,
    }
    return jwt.encode(claims, _PRIVATE_PEM, algorithm="RS256", headers={"kid": KID})


class _StubSigningKey:
    key = _KEY.public_key()


class _StubJwks:
    def get_signing_key_from_jwt(self, token: str) -> _StubSigningKey:
        return _StubSigningKey()


def build_client(settings: Settings, *, issuer: str = V2_ISSUER) -> OidcClient:
    client = OidcClient(
        settings=settings,
        http=httpx.AsyncClient(),
        # Unused on the validation path: no token endpoint call is made.
        secrets=SecretsManager(EnvSecretResolver()),
    )
    client._metadata = {  # noqa: SLF001 - deliberate test seam
        "issuer": issuer,
        "jwks_uri": "https://login.microsoftonline.com/common/discovery/v2.0/keys",
        "token_endpoint": f"{issuer}/oauth2/v2.0/token",
    }
    client._jwk_client = _StubJwks()  # type: ignore[assignment]  # noqa: SLF001
    return client


# ── v2 (the supported configuration) ─────────────────────────────────────────


async def test_v2_token_validates_against_the_client_id_guid() -> None:
    client = build_client(_settings(entra_access_token_audiences=API_CLIENT_ID))

    claims = await client.validate_access_token(make_token(aud=API_CLIENT_ID, iss=V2_ISSUER))

    assert claims["roles"] == ["Translation.User"]


async def test_v2_token_is_rejected_when_only_the_uri_is_accepted() -> None:
    """The exact misconfiguration doc 18 §11 prescribed for Apigee."""
    client = build_client(_settings())  # audiences default to the App ID URI

    with pytest.raises(OidcError, match="access_token validation failed"):
        await client.validate_access_token(make_token(aud=API_CLIENT_ID, iss=V2_ISSUER))


# ── v1 (default if requestedAccessTokenVersion is never set) ─────────────────


async def test_v1_token_validates_against_the_app_id_uri() -> None:
    """Before the fix this failed: sts.windows.net was not a candidate issuer."""
    client = build_client(_settings())

    claims = await client.validate_access_token(make_token(aud=APP_ID_URI, iss=V1_ISSUER))

    assert claims["roles"] == ["Translation.User"]


async def test_both_versions_pass_during_a_migration() -> None:
    client = build_client(_settings(entra_access_token_audiences=f"{API_CLIENT_ID} {APP_ID_URI}"))

    v2 = await client.validate_access_token(make_token(aud=API_CLIENT_ID, iss=V2_ISSUER))
    v1 = await client.validate_access_token(make_token(aud=APP_ID_URI, iss=V1_ISSUER))

    assert v2["oid"] == v1["oid"]


# ── tenant pinning ───────────────────────────────────────────────────────────


async def test_a_foreign_tenant_is_rejected() -> None:
    client = build_client(_settings(entra_access_token_audiences=API_CLIENT_ID))
    foreign = make_token(
        aud=API_CLIENT_ID, iss=V2_ISSUER, tid="99999999-9999-9999-9999-999999999999"
    )

    with pytest.raises(OidcError):
        await client.validate_access_token(foreign)


async def test_a_foreign_issuer_is_rejected() -> None:
    client = build_client(_settings(entra_access_token_audiences=API_CLIENT_ID))
    hostile = make_token(aud=API_CLIENT_ID, iss="https://evil.example/v2.0")

    with pytest.raises(OidcError):
        await client.validate_access_token(hostile)


# ── diagnostics ──────────────────────────────────────────────────────────────


async def test_rejection_logs_the_offending_claims(
    caplog: pytest.LogCaptureFixture,
) -> None:
    """Without aud/iss/ver in the log this class of fault is undebuggable."""
    client = build_client(_settings())

    with caplog.at_level("ERROR"), pytest.raises(OidcError):
        await client.validate_access_token(make_token(aud=API_CLIENT_ID, iss=V2_ISSUER, ver="2.0"))

    record = next(r for r in caplog.records if r.message == "access_token_rejected")
    assert record.tokenAud == API_CLIENT_ID  # type: ignore[attr-defined]
    assert record.tokenIss == V2_ISSUER  # type: ignore[attr-defined]
    assert record.tokenVer == "2.0"  # type: ignore[attr-defined]
    assert record.expectedAudiences == [APP_ID_URI]  # type: ignore[attr-defined]
