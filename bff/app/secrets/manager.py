"""Secret Manager access with an in-process cache.

Gap G15 requires that secrets are fetched from Secret Manager and never baked
into the image or supplied as plain environment variables in a deployed
environment. Env fallback therefore exists only for ``ENVIRONMENT=dev``.

Secret *names* come from settings (``ENTRA_CLIENT_SECRET_NAME``,
``APIGEE_API_KEY_SECRET``); this module resolves them to
``projects/<project>/secrets/<name>/versions/latest`` unless a fully qualified
resource name was supplied.
"""

from __future__ import annotations

import asyncio
import logging
import os
from typing import Protocol

from app.config import Settings

logger = logging.getLogger(__name__)


class SecretsUnavailableError(RuntimeError):
    """Raised when a required secret cannot be resolved."""


class SecretResolver(Protocol):
    async def get(self, name: str) -> str: ...


def _env_key(name: str) -> str:
    """Map a secret name to its dev environment-variable fallback key.

    ``entra-bff-client-secret`` -> ``DEV_SECRET_ENTRA_BFF_CLIENT_SECRET``
    """
    leaf = name.rsplit("/", 1)[-1]
    return "DEV_SECRET_" + leaf.replace("-", "_").replace(".", "_").upper()


class EnvSecretResolver:
    """Dev-only resolver reading ``DEV_SECRET_*`` environment variables."""

    async def get(self, name: str) -> str:
        key = _env_key(name)
        value = os.environ.get(key)
        if value is None:
            raise SecretsUnavailableError(
                f"Secret {name!r} not available; set {key} for local development"
            )
        return value


class GoogleSecretResolver:
    """Secret Manager resolver. Blocking client calls are run in a thread."""

    def __init__(self, project_id: str) -> None:
        self._project_id = project_id
        self._client: object | None = None

    def _ensure_client(self) -> object:
        if self._client is None:
            from google.cloud import secretmanager  # imported lazily

            self._client = secretmanager.SecretManagerServiceClient()
        return self._client

    def _resource_name(self, name: str) -> str:
        if name.startswith("projects/"):
            return name if "/versions/" in name else f"{name}/versions/latest"
        return f"projects/{self._project_id}/secrets/{name}/versions/latest"

    def _access(self, resource: str) -> str:
        client = self._ensure_client()
        response = client.access_secret_version(request={"name": resource})  # type: ignore[attr-defined]
        return str(response.payload.data.decode("utf-8"))

    async def get(self, name: str) -> str:
        resource = self._resource_name(name)
        try:
            return await asyncio.to_thread(self._access, resource)
        except Exception as exc:  # noqa: BLE001 - surfaced as a startup failure
            raise SecretsUnavailableError(f"Failed to access secret {resource!r}") from exc


class SecretsManager:
    """Caches resolved secret values for the lifetime of the instance."""

    def __init__(self, resolver: SecretResolver) -> None:
        self._resolver = resolver
        self._cache: dict[str, str] = {}
        self._locks: dict[str, asyncio.Lock] = {}
        self._guard = asyncio.Lock()

    @classmethod
    def from_settings(cls, settings: Settings) -> SecretsManager:
        if settings.environment == "dev" and not settings.gcp_project_id:
            return cls(EnvSecretResolver())
        if settings.environment == "dev" and os.environ.get("DEV_SECRETS_FROM_ENV") == "true":
            return cls(EnvSecretResolver())
        return cls(GoogleSecretResolver(settings.gcp_project_id))

    async def get(self, name: str) -> str:
        cached = self._cache.get(name)
        if cached is not None:
            return cached

        async with self._guard:
            lock = self._locks.setdefault(name, asyncio.Lock())

        async with lock:
            cached = self._cache.get(name)
            if cached is not None:
                return cached
            value = await self._resolver.get(name)
            self._cache[name] = value
            logger.info("secret_loaded", extra={"secret_name": name})
            return value

    async def preload(self, names: list[str]) -> None:
        """Fetch every required secret at startup so /readyz can assert on them."""
        for name in names:
            if name:
                await self.get(name)

    @property
    def loaded(self) -> bool:
        return bool(self._cache)

    def loaded_names(self) -> list[str]:
        return sorted(self._cache)
