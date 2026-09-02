"""Startup validation of the Entra settings.

The rules under test all exist because the corresponding runtime failure is
badly diagnosable: Entra answers a multi-resource ``scope=`` with the same
``invalid_scope`` it uses for a scope that does not exist, and an audience
mismatch presents as "signed in, but 403 on everything".
"""

from __future__ import annotations

import pytest
from pydantic import ValidationError

from app.config import ConfigError, Settings

TENANT = "11111111-1111-1111-1111-111111111111"
API_CLIENT_ID = "22222222-2222-2222-2222-222222222222"
APP_ID_URI = f"api://{API_CLIENT_ID}"

BASE: dict[str, object] = {
    "environment": "dev",
    "auth_mode": "entra",
    "upstream_mode": "mock",
    "iap_enabled": False,
    "translation_upload_mode": "multipart",
    "entra_tenant_id": TENANT,
    "entra_client_id": "33333333-3333-3333-3333-333333333333",
    "entra_app_id_uri": APP_ID_URI,
    "entra_redirect_uri": "https://aihub.test/auth/callback",
    "entra_scopes": (
        f"openid profile offline_access {APP_ID_URI}/Translation.Translate "
        f"{APP_ID_URI}/Sales.Research"
    ),
    "gcp_project_id": "proj",
    "kms_key_name": "projects/p/locations/l/keyRings/r/cryptoKeys/k",
}


def build(**overrides: object) -> Settings:
    return Settings(**{**BASE, **overrides})  # type: ignore[arg-type]


# ── ENTRA_SCOPES: exactly one resource ───────────────────────────────────────


def test_single_resource_scopes_are_accepted() -> None:
    assert build().scope_list[0] == "openid"


def test_graph_scope_in_entra_scopes_is_rejected() -> None:
    """The exact mistake that was baked into GITLAB_CI_VARIABLES.md."""
    with pytest.raises(ConfigError) as excinfo:
        build(
            entra_scopes=(
                f"openid profile offline_access User.Read {APP_ID_URI}/Translation.Translate"
            )
        )

    message = str(excinfo.value)
    assert "User.Read" in message
    # The message must point at the fix, not just report the symptom.
    assert "GRAPH_SCOPES" in message


def test_fully_qualified_graph_scope_is_also_rejected() -> None:
    with pytest.raises(ConfigError, match="GRAPH_SCOPES"):
        build(
            entra_scopes=(
                f"openid profile offline_access "
                f"https://graph.microsoft.com/User.Read "
                f"{APP_ID_URI}/Translation.Translate"
            )
        )


def test_a_foreign_api_resource_is_rejected() -> None:
    with pytest.raises(ConfigError, match="one resource"):
        build(
            entra_scopes=(
                f"openid profile offline_access {APP_ID_URI}/Translation.Translate "
                f"api://99999999-9999-9999-9999-999999999999/Other.Scope"
            )
        )


def test_missing_offline_access_is_rejected() -> None:
    """Without it there is no refresh token, so no Graph exchange either."""
    with pytest.raises(ConfigError, match="offline_access"):
        build(entra_scopes=f"openid profile {APP_ID_URI}/Translation.Translate")


def test_scope_check_defers_to_the_missing_app_id_uri_error() -> None:
    """An absent ENTRA_APP_ID_URI must be reported as such, not as 20 bad scopes."""
    with pytest.raises(ConfigError) as excinfo:
        build(entra_app_id_uri="")

    assert "ENTRA_APP_ID_URI" in str(excinfo.value)
    assert "GRAPH_SCOPES" not in str(excinfo.value)


def test_dev_auth_mode_skips_the_resource_check() -> None:
    settings = build(auth_mode="dev", entra_scopes="openid offline_access User.Read anything")
    assert settings.auth_mode == "dev"


# ── audiences ────────────────────────────────────────────────────────────────


def test_audiences_default_to_the_app_id_uri() -> None:
    assert build().access_token_audiences == [APP_ID_URI]


def test_explicit_audiences_override_the_default() -> None:
    """v2 access tokens carry the resource app's client ID, not the URI."""
    assert build(entra_access_token_audiences=API_CLIENT_ID).access_token_audiences == [
        API_CLIENT_ID
    ]


def test_both_audiences_can_be_accepted_during_a_migration() -> None:
    settings = build(entra_access_token_audiences=f"{API_CLIENT_ID} {APP_ID_URI}")
    assert settings.access_token_audiences == [API_CLIENT_ID, APP_ID_URI]


def test_v1_issuer_is_derived_from_the_tenant() -> None:
    assert build().v1_issuer == f"https://sts.windows.net/{TENANT}/"


# ── app id uri shape ─────────────────────────────────────────────────────────


def test_app_id_uri_must_be_a_uri() -> None:
    # A field validator, so pydantic wraps it rather than raising ConfigError.
    with pytest.raises(ValidationError, match="ENTRA_APP_ID_URI"):
        build(entra_app_id_uri="not-a-uri", entra_scopes="openid offline_access")


def test_app_id_uri_trailing_slash_is_stripped() -> None:
    """Otherwise every scope string would carry a double slash."""
    assert build(entra_app_id_uri=f"{APP_ID_URI}/").entra_app_id_uri == APP_ID_URI
