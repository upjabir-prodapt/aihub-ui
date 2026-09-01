"""Envelope encryption for the tokens held in a session document.

docs 13 §5 corrects docs 11 §5.2: a KMS decrypt per session read is *wrong* —
it adds 10–30 ms and burns KMS quota at request rate. The accepted pattern is

    per-session DEK  ->  AES-256-GCM over the tokens
    KMS              ->  wraps only the DEK

with the unwrapped DEK cached in-instance for the instance's lifetime, so KMS is
called roughly once per session per instance, never per request.

The docs specify no algorithm, key size or nonce scheme (only "a data encryption
key"), so AES-256-GCM with a fresh 96-bit nonce per ciphertext is chosen here and
recorded as an implementation decision.
"""

from __future__ import annotations

import asyncio
import logging
import os
from typing import Protocol

from cryptography.hazmat.primitives.ciphers.aead import AESGCM

logger = logging.getLogger(__name__)

DEK_BYTES = 32  # AES-256
NONCE_BYTES = 12  # 96-bit GCM nonce, the NIST-recommended size


class CryptoError(RuntimeError):
    """Raised when a token envelope cannot be sealed or opened."""


class KeyWrapper(Protocol):
    async def wrap(self, dek: bytes) -> bytes: ...
    async def unwrap(self, wrapped: bytes) -> bytes: ...


class LocalKeyWrapper:
    """Dev-only wrapper. XOR-free, but the "KMS key" is a local static key.

    Used when ``AUTH_MODE=dev`` / the Firestore emulator is in play, so that the
    whole session path can be exercised without GCP credentials. Never selected
    when ``ENVIRONMENT=prod`` (``Settings`` forbids it).
    """

    def __init__(self, master_key: bytes | None = None) -> None:
        self._aead = AESGCM(master_key or b"\x00" * DEK_BYTES)

    async def wrap(self, dek: bytes) -> bytes:
        nonce = os.urandom(NONCE_BYTES)
        return nonce + self._aead.encrypt(nonce, dek, b"aihub-dek")

    async def unwrap(self, wrapped: bytes) -> bytes:
        if len(wrapped) <= NONCE_BYTES:
            raise CryptoError("wrapped DEK is truncated")
        nonce, ct = wrapped[:NONCE_BYTES], wrapped[NONCE_BYTES:]
        try:
            return self._aead.decrypt(nonce, ct, b"aihub-dek")
        except Exception as exc:  # noqa: BLE001
            raise CryptoError("failed to unwrap DEK") from exc


class KmsKeyWrapper:
    """Cloud KMS symmetric encrypt/decrypt over the DEK only."""

    def __init__(self, key_name: str) -> None:
        self._key_name = key_name
        self._client: object | None = None

    def _ensure_client(self) -> object:
        if self._client is None:
            from google.cloud import kms  # imported lazily

            self._client = kms.KeyManagementServiceClient()
        return self._client

    def _encrypt(self, dek: bytes) -> bytes:
        client = self._ensure_client()
        resp = client.encrypt(  # type: ignore[attr-defined]
            request={"name": self._key_name, "plaintext": dek}
        )
        return bytes(resp.ciphertext)

    def _decrypt(self, wrapped: bytes) -> bytes:
        client = self._ensure_client()
        resp = client.decrypt(  # type: ignore[attr-defined]
            request={"name": self._key_name, "ciphertext": wrapped}
        )
        return bytes(resp.plaintext)

    async def wrap(self, dek: bytes) -> bytes:
        try:
            return await asyncio.to_thread(self._encrypt, dek)
        except Exception as exc:  # noqa: BLE001
            raise CryptoError("KMS wrap failed") from exc

    async def unwrap(self, wrapped: bytes) -> bytes:
        try:
            return await asyncio.to_thread(self._decrypt, wrapped)
        except Exception as exc:  # noqa: BLE001
            raise CryptoError("KMS unwrap failed") from exc


class TokenEnvelope:
    """Seals and opens the access/refresh token pair for one session."""

    def __init__(self, wrapper: KeyWrapper, *, dek_cache_size: int = 2048) -> None:
        self._wrapper = wrapper
        # Keyed on the wrapped DEK bytes, so an unwrap happens at most once per
        # session per instance (docs 13 §5).
        self._dek_cache: dict[bytes, bytes] = {}
        self._cache_size = dek_cache_size
        self._locks: dict[bytes, asyncio.Lock] = {}
        self._guard = asyncio.Lock()

    @property
    def kms_unwraps_avoided(self) -> int:
        return len(self._dek_cache)

    async def _dek_for(self, wrapped: bytes) -> bytes:
        cached = self._dek_cache.get(wrapped)
        if cached is not None:
            return cached

        async with self._guard:
            lock = self._locks.setdefault(wrapped, asyncio.Lock())

        async with lock:
            cached = self._dek_cache.get(wrapped)
            if cached is not None:
                return cached
            dek = await self._wrapper.unwrap(wrapped)
            self._remember(wrapped, dek)
            return dek

    def _remember(self, wrapped: bytes, dek: bytes) -> None:
        if len(self._dek_cache) >= self._cache_size:
            # Crude FIFO eviction; the cache exists to avoid KMS chatter, not to
            # be a precise LRU.
            for key in list(self._dek_cache)[: self._cache_size // 4]:
                self._dek_cache.pop(key, None)
                self._locks.pop(key, None)
        self._dek_cache[wrapped] = dek

    async def seal(
        self, access_token: str, refresh_token: str, *, aad: bytes
    ) -> tuple[bytes, bytes, bytes, bytes, bytes]:
        """Return ``(access_ct, refresh_ct, nonce_at, nonce_rt, wrapped_dek)``."""
        dek = os.urandom(DEK_BYTES)
        wrapped = await self._wrapper.wrap(dek)
        self._remember(wrapped, dek)

        aead = AESGCM(dek)
        nonce_at = os.urandom(NONCE_BYTES)
        nonce_rt = os.urandom(NONCE_BYTES)
        access_ct = aead.encrypt(nonce_at, access_token.encode("utf-8"), aad)
        refresh_ct = aead.encrypt(nonce_rt, refresh_token.encode("utf-8"), aad)
        return access_ct, refresh_ct, nonce_at, nonce_rt, wrapped

    async def reseal(
        self, access_token: str, refresh_token: str, *, aad: bytes, wrapped_dek: bytes
    ) -> tuple[bytes, bytes, bytes, bytes]:
        """Re-encrypt under an existing DEK (used on refresh without rotation)."""
        dek = await self._dek_for(wrapped_dek)
        aead = AESGCM(dek)
        nonce_at = os.urandom(NONCE_BYTES)
        nonce_rt = os.urandom(NONCE_BYTES)
        return (
            aead.encrypt(nonce_at, access_token.encode("utf-8"), aad),
            aead.encrypt(nonce_rt, refresh_token.encode("utf-8"), aad),
            nonce_at,
            nonce_rt,
        )

    async def open(
        self,
        *,
        access_ct: bytes,
        refresh_ct: bytes,
        nonce_at: bytes,
        nonce_rt: bytes,
        wrapped_dek: bytes,
        aad: bytes,
    ) -> tuple[str, str]:
        dek = await self._dek_for(wrapped_dek)
        aead = AESGCM(dek)
        try:
            access = aead.decrypt(nonce_at, access_ct, aad).decode("utf-8")
            refresh = aead.decrypt(nonce_rt, refresh_ct, aad).decode("utf-8") if refresh_ct else ""
        except Exception as exc:  # noqa: BLE001
            raise CryptoError("failed to open token envelope") from exc
        return access, refresh


def build_envelope(*, kms_key_name: str, allow_local: bool) -> TokenEnvelope:
    if kms_key_name:
        return TokenEnvelope(KmsKeyWrapper(kms_key_name))
    if not allow_local:
        raise CryptoError("KMS_KEY_NAME is required outside local development")
    logger.warning("kms_disabled_using_local_key_wrapper")
    return TokenEnvelope(LocalKeyWrapper())
