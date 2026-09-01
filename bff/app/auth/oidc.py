"""Entra ID OIDC confidential client: authorization code + PKCE.

Silent SSO (docs 15 §0.1): the authorize request carries ``prompt=none`` plus a
``login_hint`` derived from the *validated* IAP assertion. Entra answers
``interaction_required`` or ``login_required`` when it cannot complete silently;
the caller retries the same request once without ``prompt=none``.

The application ID URI is read from ``ENTRA_APP_ID_URI`` and never hardcoded.
docs 18 §9 records that a hardcoded mismatch here "fails with an invalid-scope
error identical to a missing scope", which is a miserable thing to debug.
"""

from __future__ import annotations

import asyncio
import base64
import contextlib
import hashlib
import logging
import secrets
import time
from dataclasses import dataclass, field
from typing import Any
from urllib.parse import urlencode

import httpx
import jwt
from jwt import PyJWKClient

from app.config import Settings
from app.secrets.manager import SecretsManager

logger = logging.getLogger(__name__)

# Errors Entra returns when prompt=none cannot be satisfied (docs 15 §0.1).
INTERACTION_REQUIRED = frozenset({"interaction_required", "login_required", "consent_required"})


class OidcError(RuntimeError):
    """Any non-recoverable failure talking to Entra."""

    def __init__(self, message: str, *, code: str = "", description: str = "") -> None:
        super().__init__(message)
        self.code = code
        self.description = description


class InteractionRequiredError(OidcError):
    """``prompt=none`` failed; retry once interactively."""


class InvalidGrantError(OidcError):
    """The refresh token is dead. docs 13 §3: terminate the session, never retry."""


@dataclass(slots=True)
class TokenSet:
    access_token: str
    refresh_token: str
    id_token: str
    expires_in: int
    scope: str = ""
    obtained_at: float = field(default_factory=time.time)

    @property
    def access_expires_at_epoch(self) -> float:
        return self.obtained_at + self.expires_in


@dataclass(slots=True)
class Principal:
    oid: str
    email: str
    name: str
    tid: str
    roles: list[str]
    sid: str | None = None


def generate_pkce() -> tuple[str, str]:
    """Return ``(verifier, challenge)`` for S256."""
    verifier = base64.urlsafe_b64encode(secrets.token_bytes(64)).rstrip(b"=").decode()
    digest = hashlib.sha256(verifier.encode("ascii")).digest()
    challenge = base64.urlsafe_b64encode(digest).rstrip(b"=").decode()
    return verifier, challenge


class OidcClient:
    def __init__(
        self,
        *,
        settings: Settings,
        http: httpx.AsyncClient,
        secrets: SecretsManager,
    ) -> None:
        self._settings = settings
        self._http = http
        self._secrets = secrets
        self._metadata: dict[str, Any] | None = None
        self._metadata_lock = asyncio.Lock()
        self._jwk_client: PyJWKClient | None = None

    # ── discovery ────────────────────────────────────────────────────────────

    async def metadata(self) -> dict[str, Any]:
        if self._metadata is not None:
            return self._metadata
        async with self._metadata_lock:
            if self._metadata is not None:
                return self._metadata
            url = self._settings.entra_discovery_url
            try:
                response = await self._http.get(url)
                response.raise_for_status()
            except httpx.HTTPError as exc:
                raise OidcError(f"OIDC discovery failed for {url}") from exc
            self._metadata = dict(response.json())
            logger.info("oidc_discovery_loaded", extra={"issuer": self._metadata.get("issuer")})
            return self._metadata

    async def _endpoint(self, key: str, fallback: str) -> str:
        meta = await self.metadata()
        return str(meta.get(key) or fallback)

    def _jwks(self, uri: str) -> PyJWKClient:
        if self._jwk_client is None:
            # PyJWKClient caches keys in-process and refetches on unknown kid.
            self._jwk_client = PyJWKClient(uri, cache_keys=True, lifespan=3600)
        return self._jwk_client

    async def _client_secret(self) -> str:
        return await self._secrets.get(self._settings.entra_client_secret_name)

    # ── authorize ────────────────────────────────────────────────────────────

    async def authorization_url(
        self,
        *,
        state: str,
        nonce: str,
        code_challenge: str,
        login_hint: str | None,
        silent: bool,
    ) -> str:
        endpoint = await self._endpoint(
            "authorization_endpoint", f"{self._settings.entra_authority}/oauth2/v2.0/authorize"
        )
        params: dict[str, str] = {
            "client_id": self._settings.entra_client_id,
            "response_type": "code",
            "redirect_uri": self._settings.entra_redirect_uri,
            "response_mode": "query",
            "scope": self._settings.entra_scopes,
            "state": state,
            "nonce": nonce,
            "code_challenge": code_challenge,
            "code_challenge_method": "S256",
        }
        if login_hint:
            params["login_hint"] = login_hint
        if silent:
            # The parameter that actually requests silent auth. login_hint alone
            # only pre-selects an account (docs 15 §0.1).
            params["prompt"] = "none"
        return f"{endpoint}?{urlencode(params)}"

    # ── token endpoint ───────────────────────────────────────────────────────

    async def _post_token(self, form: dict[str, str]) -> dict[str, Any]:
        endpoint = await self._endpoint(
            "token_endpoint", f"{self._settings.entra_authority}/oauth2/v2.0/token"
        )
        form = dict(form)
        form["client_id"] = self._settings.entra_client_id
        form["client_secret"] = await self._client_secret()

        try:
            response = await self._http.post(
                endpoint,
                data=form,
                headers={"Content-Type": "application/x-www-form-urlencoded"},
            )
        except httpx.HTTPError as exc:
            raise OidcError(f"token endpoint unreachable: {exc}") from exc

        if response.status_code >= 400:
            payload: dict[str, Any] = {}
            with contextlib.suppress(ValueError):
                payload = response.json()
            code = str(payload.get("error", f"http_{response.status_code}"))
            description = str(payload.get("error_description", ""))
            if code == "invalid_grant":
                raise InvalidGrantError(
                    "refresh token rejected by Entra", code=code, description=description
                )
            if code in INTERACTION_REQUIRED:
                raise InteractionRequiredError(
                    "interaction required", code=code, description=description
                )
            raise OidcError(f"token request failed: {code}", code=code, description=description)

        return dict(response.json())

    def _token_set(self, payload: dict[str, Any], *, previous_refresh: str = "") -> TokenSet:
        return TokenSet(
            access_token=str(payload.get("access_token", "")),
            # Entra rotates refresh tokens; fall back to the previous one only if
            # the response omitted it entirely.
            refresh_token=str(payload.get("refresh_token") or previous_refresh),
            id_token=str(payload.get("id_token", "")),
            expires_in=int(payload.get("expires_in", 3600)),
            scope=str(payload.get("scope", "")),
        )

    async def exchange_code(self, *, code: str, code_verifier: str) -> TokenSet:
        payload = await self._post_token(
            {
                "grant_type": "authorization_code",
                "code": code,
                "redirect_uri": self._settings.entra_redirect_uri,
                "code_verifier": code_verifier,
                "scope": self._settings.entra_scopes,
            }
        )
        return self._token_set(payload)

    async def refresh(self, refresh_token: str) -> TokenSet:
        payload = await self._post_token(
            {
                "grant_type": "refresh_token",
                "refresh_token": refresh_token,
                "scope": self._settings.entra_scopes,
            }
        )
        return self._token_set(payload, previous_refresh=refresh_token)

    # ── validation ───────────────────────────────────────────────────────────

    def _decode(self, token: str, *, audience: str, jwks_uri: str, issuer: str) -> dict[str, Any]:
        signing_key = self._jwks(jwks_uri).get_signing_key_from_jwt(token)
        return dict(
            jwt.decode(
                token,
                signing_key.key,
                algorithms=["RS256"],
                audience=audience,
                issuer=issuer,
                options={"require": ["exp", "iat", "aud", "iss"]},
                leeway=60,
            )
        )

    async def validate_id_token(self, id_token: str, *, expected_nonce: str) -> dict[str, Any]:
        meta = await self.metadata()
        jwks_uri = str(meta.get("jwks_uri", ""))
        issuer = str(meta.get("issuer", ""))
        try:
            claims = await asyncio.to_thread(
                self._decode,
                id_token,
                audience=self._settings.entra_client_id,
                jwks_uri=jwks_uri,
                issuer=issuer,
            )
        except Exception as exc:  # noqa: BLE001
            raise OidcError(f"id_token validation failed: {exc}") from exc

        if claims.get("nonce") != expected_nonce:
            raise OidcError("id_token nonce mismatch")
        return claims

    async def validate_access_token(self, access_token: str) -> dict[str, Any]:
        """Validate the access token so ``roles`` can be trusted (decision D7).

        The audience is ``ENTRA_APP_ID_URI`` — the same value Apigee's Verify JWT
        policy checks (docs 15 §B.11).
        """
        meta = await self.metadata()
        jwks_uri = str(meta.get("jwks_uri", ""))
        issuer = str(meta.get("issuer", ""))
        audience = self._settings.entra_app_id_uri
        for candidate_issuer in (issuer, issuer.replace("/v2.0", "/")):
            try:
                return await asyncio.to_thread(
                    self._decode,
                    access_token,
                    audience=audience,
                    jwks_uri=jwks_uri,
                    issuer=candidate_issuer,
                )
            except Exception as exc:  # noqa: BLE001, PERF203
                last = exc
        raise OidcError(f"access_token validation failed: {last}")

    async def principal_from(self, tokens: TokenSet, *, expected_nonce: str) -> Principal:
        """Build the caller identity from the id_token, roles from the access token."""
        id_claims = await self.validate_id_token(tokens.id_token, expected_nonce=expected_nonce)
        try:
            access_claims = await self.validate_access_token(tokens.access_token)
        except OidcError as exc:
            # An access token minted for a resource we cannot validate is a
            # configuration error (usually ENTRA_APP_ID_URI, docs 18 §9). Roles
            # gate the UI, so fail closed with an empty role set rather than
            # inventing entitlements.
            logger.error("access_token_unvalidated", extra={"error": str(exc)})
            access_claims = {}

        roles = [str(r) for r in (access_claims.get("roles") or id_claims.get("roles") or [])]
        return Principal(
            oid=str(id_claims.get("oid") or access_claims.get("oid") or ""),
            email=str(
                id_claims.get("preferred_username")
                or id_claims.get("email")
                or access_claims.get("preferred_username")
                or ""
            ),
            name=str(id_claims.get("name") or ""),
            tid=str(id_claims.get("tid") or ""),
            roles=roles,
            sid=str(id_claims.get("sid")) if id_claims.get("sid") else None,
        )

    async def roles_from_access_token(self, access_token: str) -> list[str]:
        """Re-read roles after a refresh; a changed set is a privilege change."""
        try:
            claims = await self.validate_access_token(access_token)
        except OidcError as exc:
            logger.warning("roles_reread_failed", extra={"error": str(exc)})
            return []
        return [str(r) for r in (claims.get("roles") or [])]

    # ── logout ───────────────────────────────────────────────────────────────

    async def end_session_url(self, *, post_logout_redirect_uri: str = "") -> str:
        endpoint = await self._endpoint(
            "end_session_endpoint", f"{self._settings.entra_authority}/oauth2/v2.0/logout"
        )
        target = post_logout_redirect_uri or self._settings.entra_post_logout_redirect_uri
        if target:
            return f"{endpoint}?{urlencode({'post_logout_redirect_uri': target})}"
        return endpoint

    async def revoke_refresh_token(self, refresh_token: str) -> bool:
        """Best-effort revocation (docs 13 §1 step 1).

        The Microsoft identity platform does not implement RFC 7009, so this only
        does anything if discovery advertises a ``revocation_endpoint``. Failure
        is logged and never aborts a logout.
        """
        meta = await self.metadata()
        endpoint = meta.get("revocation_endpoint")
        if not endpoint:
            logger.info("refresh_revocation_unsupported")
            return False
        try:
            response = await self._http.post(
                str(endpoint),
                data={
                    "token": refresh_token,
                    "token_type_hint": "refresh_token",
                    "client_id": self._settings.entra_client_id,
                    "client_secret": await self._client_secret(),
                },
            )
        except Exception as exc:  # noqa: BLE001
            logger.warning("refresh_revocation_failed", extra={"error": str(exc)})
            return False
        if response.status_code >= 400:
            logger.warning("refresh_revocation_rejected", extra={"status": response.status_code})
            return False
        return True
