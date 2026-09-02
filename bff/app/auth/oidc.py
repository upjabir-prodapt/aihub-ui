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

        logger.info(
            "authorize_request",
            extra={
                "endpoint": endpoint,
                "clientId": params["client_id"],
                "redirectUri": params["redirect_uri"],
                # The single most common cause of a failed sign-in. Logged in
                # full so it can be diffed against the app registration.
                "scope": params["scope"],
                "prompt": params.get("prompt", "(interactive)"),
                "hasLoginHint": bool(login_hint),
            },
        )
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
            # error_description carries the AADSTS code and a human sentence; it
            # is the difference between "invalid_scope" and knowing *which*
            # scope. Always surface it.
            logger.error(
                "entra_token_endpoint_error",
                extra={
                    "grantType": form.get("grant_type"),
                    "status": response.status_code,
                    "entraError": code,
                    "entraErrorDescription": description,
                    "requestedScope": form.get("scope"),
                },
            )
            if code == "invalid_grant":
                raise InvalidGrantError(
                    "refresh token rejected by Entra", code=code, description=description
                )
            if code in INTERACTION_REQUIRED:
                raise InteractionRequiredError(
                    "interaction required", code=code, description=description
                )
            raise OidcError(f"token request failed: {code}", code=code, description=description)

        payload_ok = dict(response.json())
        logger.info(
            "entra_token_endpoint_ok",
            extra={
                "grantType": form.get("grant_type"),
                # The scopes Entra actually granted, which may be narrower than
                # those requested.
                "grantedScope": payload_ok.get("scope"),
                "expiresIn": payload_ok.get("expires_in"),
                "hasRefreshToken": bool(payload_ok.get("refresh_token")),
                "hasIdToken": bool(payload_ok.get("id_token")),
            },
        )
        return payload_ok

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

    async def acquire_graph_token(self, refresh_token: str) -> TokenSet | None:
        """Redeem the refresh token for a *Microsoft Graph* access token.

        An access token has exactly one audience, so the token used for the
        platform API can never also call Graph. ``ENTRA_SCOPES`` therefore names
        only the API resource, and ``User.Read`` is acquired here in a second
        exchange (docs 19 Option A).

        Returns ``None`` on any failure: ``department``/``companyName`` are a
        reporting dimension, not a security control, and must never block sign-in.

        The caller **must** adopt ``TokenSet.refresh_token`` from the result:
        Entra rotates refresh tokens and the one passed in may no longer be
        redeemable.
        """
        if not refresh_token:
            logger.warning("graph_token_skipped_no_refresh_token")
            return None
        try:
            payload = await self._post_token(
                {
                    "grant_type": "refresh_token",
                    "refresh_token": refresh_token,
                    "scope": self._settings.graph_scopes,
                }
            )
        except OidcError as exc:
            logger.warning(
                "graph_token_exchange_failed",
                extra={
                    "error": str(exc),
                    "entraError": exc.code,
                    "entraErrorDescription": exc.description,
                    "detail": "department/companyName will fall back to placeholders. "
                    "Usually Graph User.Read is not consented on the BFF app.",
                },
            )
            return None
        tokens = self._token_set(payload, previous_refresh=refresh_token)
        logger.info(
            "graph_token_acquired",
            extra={"refreshTokenRotated": tokens.refresh_token != refresh_token},
        )
        return tokens

    # ── validation ───────────────────────────────────────────────────────────

    def _decode(
        self, token: str, *, audience: str | list[str], jwks_uri: str, issuer: str
    ) -> dict[str, Any]:
        signing_key = self._jwks(jwks_uri).get_signing_key_from_jwt(token)
        claims = dict(
            jwt.decode(
                token,
                signing_key.key,
                algorithms=["RS256"],
                # PyJWT treats a list as "any of these match".
                audience=audience,
                issuer=issuer,
                options={"require": ["exp", "iat", "aud", "iss"]},
                leeway=60,
            )
        )
        # Tie the token back to our tenant. The issuer check alone is not enough
        # when a tenant-independent metadata document is in play.
        expected_tid = self._settings.entra_tenant_id
        if expected_tid and claims.get("tid") != expected_tid:
            raise OidcError(f"token tid {claims.get('tid')!r} is not tenant {expected_tid!r}")
        return claims

    @staticmethod
    def _unverified_claims(token: str) -> dict[str, Any]:
        """Claims for diagnostics only. Never used for a trust decision."""
        try:
            return dict(jwt.decode(token, options={"verify_signature": False}))
        except Exception:  # noqa: BLE001 - diagnostics must never raise
            return {}

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
            seen = self._unverified_claims(id_token)
            logger.error(
                "id_token_rejected",
                extra={
                    "error": str(exc),
                    "tokenAud": seen.get("aud"),
                    "tokenIss": seen.get("iss"),
                    "tokenTid": seen.get("tid"),
                    "expectedAudience": self._settings.entra_client_id,
                    "expectedIssuer": issuer,
                },
            )
            raise OidcError(f"id_token validation failed: {exc}") from exc

        if claims.get("nonce") != expected_nonce:
            logger.error("id_token_nonce_mismatch")
            raise OidcError("id_token nonce mismatch")

        logger.info(
            "id_token_validated",
            extra={
                "oid": claims.get("oid"),
                "tid": claims.get("tid"),
                "hasGroups": "groups" in claims,
                "groupCount": len(claims.get("groups") or []),
                "hasSid": bool(claims.get("sid")),
                "hasClaimNames": "_claim_names" in claims,
            },
        )
        if "_claim_names" in claims:
            logger.error(
                "id_token_group_overflow",
                extra={
                    "detail": "Entra replaced groups[] with _claim_names because the user is "
                    "in too many groups. Workforce-pool group mapping will match "
                    "nothing and IAP will deny this user. Switch the groups claim to "
                    "'Groups assigned to the application'.",
                },
            )
        return claims

    async def validate_access_token(self, access_token: str) -> dict[str, Any]:
        """Validate the access token so ``roles`` can be trusted (decision D7).

        The accepted audiences come from ``ENTRA_ACCESS_TOKEN_AUDIENCES`` (falling
        back to ``ENTRA_APP_ID_URI``) — the same values Apigee's Verify JWT policy
        must check (docs 15 §B.11).

        Both access-token versions are accepted, because which one Entra issues is
        controlled by ``requestedAccessTokenVersion`` on the *resource* app
        registration, not by anything here:

        * v1 (``null``/``1``): ``iss`` is ``https://sts.windows.net/<tid>/`` and
          ``aud`` is the App ID URI.
        * v2 (``2``): ``iss`` ends in ``/v2.0`` and ``aud`` is the resource app's
          client ID GUID.

        Getting this wrong used to yield an empty role set and a 403 on every API
        call while sign-in still succeeded, so a failure here is logged with the
        offending claims.
        """
        meta = await self.metadata()
        jwks_uri = str(meta.get("jwks_uri", ""))
        issuer = str(meta.get("issuer", ""))
        audiences = self._settings.access_token_audiences

        last: Exception | None = None
        for candidate_issuer in (issuer, self._settings.v1_issuer):
            if not candidate_issuer:
                continue
            try:
                claims = await asyncio.to_thread(
                    self._decode,
                    access_token,
                    audience=audiences,
                    jwks_uri=jwks_uri,
                    issuer=candidate_issuer,
                )
            except Exception as exc:  # noqa: BLE001, PERF203
                last = exc
            else:
                logger.info(
                    "access_token_validated",
                    extra={
                        "tokenVer": claims.get("ver"),
                        "tokenAud": claims.get("aud"),
                        "tokenIss": claims.get("iss"),
                        "roles": claims.get("roles") or [],
                        "scp": claims.get("scp"),
                    },
                )
                if not claims.get("roles"):
                    logger.warning(
                        "access_token_has_no_roles",
                        extra={
                            "detail": "Token validated but carries no roles[] claim. The user "
                            "is in no group assigned to an App Role on the resource app, "
                            "or the App Role's allowed member type is not Users/Groups. "
                            "Sign-in will succeed and every API call will 403.",
                        },
                    )
                return claims

        seen = self._unverified_claims(access_token)
        logger.error(
            "access_token_rejected",
            extra={
                "error": str(last),
                "tokenAud": seen.get("aud"),
                "tokenIss": seen.get("iss"),
                "tokenVer": seen.get("ver"),
                "expectedAudiences": audiences,
                "expectedIssuers": [issuer, self._settings.v1_issuer],
            },
        )
        raise OidcError(f"access_token validation failed: {last}")

    async def principal_from(self, tokens: TokenSet, *, expected_nonce: str) -> Principal:
        """Build the caller identity from the id_token, roles from the access token."""
        id_claims = await self.validate_id_token(tokens.id_token, expected_nonce=expected_nonce)
        try:
            access_claims = await self.validate_access_token(tokens.access_token)
        except OidcError as exc:
            # An access token minted for a resource we cannot validate is a
            # configuration error: ENTRA_ACCESS_TOKEN_AUDIENCES not matching the
            # resource app's requestedAccessTokenVersion is the usual cause.
            #
            # Degrading to an empty role set produces a session that looks signed
            # in but is 403'd by every API call, which is indistinguishable from a
            # group-assignment problem and near-impossible to diagnose. Outside
            # local development, fail the sign-in outright instead.
            logger.error("access_token_unvalidated", extra={"error": str(exc)})
            if not self._settings.is_dev_auth and self._settings.environment != "dev":
                raise
            access_claims = {}

        roles = [str(r) for r in (access_claims.get("roles") or id_claims.get("roles") or [])]
        logger.info(
            "principal_resolved",
            extra={
                "oid": id_claims.get("oid"),
                "roles": roles,
                "rolesSource": "access_token" if access_claims.get("roles") else "id_token",
            },
        )
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
