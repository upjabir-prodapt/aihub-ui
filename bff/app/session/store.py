"""Session persistence.

Decision D4: Firestore Native, not Redis. Memorystore basic tier needs Private
Service Access, which peers the Shared VPC host — forbidden by the networking
decision and shortly by org policy ``compute.restrictVpcPeering`` (gap G18).
Firestore is reachable over the existing PSC endpoint with no new networking
(docs 11 §5.3, budget 10–20 ms per read).

Everything goes through the ``SessionStore`` protocol so that a future
Memorystore-Cluster-over-PSC swap is a new class, not a rewrite.

Fail-closed semantics (docs 13 §4) are expressed as two distinct exception
types, and they must not be collapsed:

* ``SessionStoreUnavailable`` -> 503 + ``Retry-After``. Infrastructure is broken.
* returning ``None``            -> 401. The session genuinely is not there.

Collapsing them means you cannot tell an outage from normal expiry in the logs,
and it turns a Firestore blip into a redirect-to-login storm.
"""

from __future__ import annotations

import asyncio
import contextlib
import logging
import time
from datetime import UTC, datetime, timedelta
from typing import Any, Protocol, runtime_checkable

from app.session.model import (
    AUTH_STATES_COLLECTION,
    SESSIONS_COLLECTION,
    AuthState,
    utcnow,
)

logger = logging.getLogger(__name__)


class SessionStoreUnavailable(RuntimeError):
    """Infrastructure failure. Must surface as 503, never 401 (docs 13 §4)."""

    def __init__(self, message: str, *, retry_after: int = 5) -> None:
        super().__init__(message)
        self.retry_after = retry_after


class LeaseNotAcquired(RuntimeError):
    """Another request holds the refresh lease (docs 13 §3)."""


@runtime_checkable
class SessionStore(Protocol):
    async def get(self, doc_id: str) -> dict[str, Any] | None: ...
    async def create(self, doc_id: str, data: dict[str, Any]) -> None: ...
    async def update(self, doc_id: str, patch: dict[str, Any]) -> None: ...
    async def delete(self, doc_id: str) -> None: ...
    async def delete_by_entra_sid(self, sid: str) -> int: ...
    async def acquire_refresh_lease(self, doc_id: str, lease_seconds: int) -> bool: ...
    async def release_refresh_lease(self, doc_id: str) -> None: ...
    async def put_auth_state(self, state_hash: str, state: AuthState) -> None: ...
    async def take_auth_state(self, state_hash: str) -> AuthState | None: ...
    async def ping(self) -> None: ...
    async def close(self) -> None: ...


# ── Circuit breaker ──────────────────────────────────────────────────────────


class CircuitBreaker:
    """Fast-fail after sustained errors instead of waiting on timeouts.

    docs 13 §4: "Sustained error rate -> circuit-break to a fast 503 rather than
    waiting on timeouts."
    """

    def __init__(self, *, threshold: int, reset_seconds: float) -> None:
        self._threshold = threshold
        self._reset_seconds = reset_seconds
        self._failures = 0
        self._opened_at: float | None = None

    @property
    def is_open(self) -> bool:
        if self._opened_at is None:
            return False
        if time.monotonic() - self._opened_at >= self._reset_seconds:
            # Half-open: let the next call through and judge by its outcome.
            self._opened_at = None
            self._failures = self._threshold - 1
            return False
        return True

    def record_success(self) -> None:
        self._failures = 0
        self._opened_at = None

    def record_failure(self) -> None:
        self._failures += 1
        if self._failures >= self._threshold and self._opened_at is None:
            self._opened_at = time.monotonic()
            logger.error("firestore_circuit_opened", extra={"failures": self._failures})


# ── In-memory store (tests, and AUTH_MODE=dev without an emulator) ───────────


class InMemorySessionStore:
    """Reference implementation of the protocol. Not for production use."""

    def __init__(self) -> None:
        self._sessions: dict[str, dict[str, Any]] = {}
        self._auth_states: dict[str, AuthState] = {}
        self._lock = asyncio.Lock()
        self.fail_with: Exception | None = None

    def _check(self) -> None:
        if self.fail_with is not None:
            raise self.fail_with

    async def get(self, doc_id: str) -> dict[str, Any] | None:
        self._check()
        data = self._sessions.get(doc_id)
        return dict(data) if data is not None else None

    async def create(self, doc_id: str, data: dict[str, Any]) -> None:
        self._check()
        self._sessions[doc_id] = dict(data)

    async def update(self, doc_id: str, patch: dict[str, Any]) -> None:
        self._check()
        existing = self._sessions.get(doc_id)
        if existing is None:
            return
        existing.update(patch)

    async def delete(self, doc_id: str) -> None:
        self._check()
        self._sessions.pop(doc_id, None)

    async def delete_by_entra_sid(self, sid: str) -> int:
        self._check()
        victims = [k for k, v in self._sessions.items() if v.get("entra_sid") == sid]
        for key in victims:
            self._sessions.pop(key, None)
        return len(victims)

    async def acquire_refresh_lease(self, doc_id: str, lease_seconds: int) -> bool:
        self._check()
        async with self._lock:
            doc = self._sessions.get(doc_id)
            if doc is None:
                return False
            now = utcnow()
            held = doc.get("refresh_lease_until")
            if held is not None:
                held_aware = held if held.tzinfo else held.replace(tzinfo=UTC)
                if held_aware > now:
                    return False
            doc["refresh_lease_until"] = now + timedelta(seconds=lease_seconds)
            return True

    async def release_refresh_lease(self, doc_id: str) -> None:
        self._check()
        doc = self._sessions.get(doc_id)
        if doc is not None:
            doc["refresh_lease_until"] = None

    async def put_auth_state(self, state_hash: str, state: AuthState) -> None:
        self._check()
        self._auth_states[state_hash] = state

    async def take_auth_state(self, state_hash: str) -> AuthState | None:
        self._check()
        return self._auth_states.pop(state_hash, None)

    async def ping(self) -> None:
        self._check()

    async def close(self) -> None:
        return None


# ── Firestore ────────────────────────────────────────────────────────────────


class FirestoreSessionStore:
    """Firestore Native backing store with a 2 s timeout and a circuit breaker."""

    def __init__(
        self,
        *,
        project_id: str,
        database: str = "(default)",
        timeout_seconds: float = 2.0,
        breaker_threshold: int = 5,
        breaker_reset_seconds: float = 10.0,
        client: Any | None = None,
    ) -> None:
        self._project_id = project_id
        self._database = database
        self._timeout = timeout_seconds
        self._breaker = CircuitBreaker(
            threshold=breaker_threshold, reset_seconds=breaker_reset_seconds
        )
        self._client = client

    # -- plumbing ------------------------------------------------------------

    def _ensure_client(self) -> Any:
        if self._client is None:
            from google.cloud import firestore  # imported lazily

            self._client = firestore.Client(project=self._project_id, database=self._database)
        return self._client

    async def _call(self, fn: Any, *args: Any, **kwargs: Any) -> Any:
        """Run a blocking Firestore call in a thread, bounded and breaker-guarded."""
        if self._breaker.is_open:
            raise SessionStoreUnavailable("Firestore circuit open", retry_after=5)
        try:
            result = await asyncio.wait_for(
                asyncio.to_thread(fn, *args, **kwargs), timeout=self._timeout
            )
        except TimeoutError as exc:
            self._breaker.record_failure()
            raise SessionStoreUnavailable(
                f"Firestore call exceeded {self._timeout}s", retry_after=5
            ) from exc
        except Exception as exc:  # noqa: BLE001 - all backend errors fail closed
            self._breaker.record_failure()
            raise SessionStoreUnavailable(f"Firestore call failed: {exc!r}", retry_after=5) from exc
        self._breaker.record_success()
        return result

    def _sessions(self) -> Any:
        return self._ensure_client().collection(SESSIONS_COLLECTION)

    def _auth_states(self) -> Any:
        return self._ensure_client().collection(AUTH_STATES_COLLECTION)

    # -- sessions ------------------------------------------------------------

    async def get(self, doc_id: str) -> dict[str, Any] | None:
        def _read() -> dict[str, Any] | None:
            snap = self._sessions().document(doc_id).get()
            return snap.to_dict() if snap.exists else None

        return await self._call(_read)  # type: ignore[no-any-return]

    async def create(self, doc_id: str, data: dict[str, Any]) -> None:
        def _write() -> None:
            self._sessions().document(doc_id).set(data)

        await self._call(_write)

    async def update(self, doc_id: str, patch: dict[str, Any]) -> None:
        def _write() -> None:
            self._sessions().document(doc_id).set(patch, merge=True)

        await self._call(_write)

    async def delete(self, doc_id: str) -> None:
        def _write() -> None:
            self._sessions().document(doc_id).delete()

        await self._call(_write)

    async def delete_by_entra_sid(self, sid: str) -> int:
        def _write() -> int:
            docs = list(self._sessions().where("entra_sid", "==", sid).stream())
            for doc in docs:
                doc.reference.delete()
            return len(docs)

        return await self._call(_write)  # type: ignore[no-any-return]

    # -- refresh lease (docs 13 §3) ------------------------------------------

    async def acquire_refresh_lease(self, doc_id: str, lease_seconds: int) -> bool:
        """Transactionally take the lease. Exactly one caller wins.

        The transaction stays deliberately short — docs 13 §6 warns about
        Firestore transaction contention.
        """

        def _txn() -> bool:
            from google.cloud import firestore  # imported lazily

            client = self._ensure_client()
            ref = self._sessions().document(doc_id)

            @firestore.transactional
            def _run(transaction: Any) -> bool:
                snap = ref.get(transaction=transaction)
                if not snap.exists:
                    return False
                held = (snap.to_dict() or {}).get("refresh_lease_until")
                now = datetime.now(UTC)
                if held is not None:
                    held_aware = held if held.tzinfo else held.replace(tzinfo=UTC)
                    if held_aware > now:
                        return False
                transaction.update(
                    ref, {"refresh_lease_until": now + timedelta(seconds=lease_seconds)}
                )
                return True

            return bool(_run(client.transaction()))

        return bool(await self._call(_txn))

    async def release_refresh_lease(self, doc_id: str) -> None:
        await self.update(doc_id, {"refresh_lease_until": None})

    # -- pre-auth state ------------------------------------------------------

    async def put_auth_state(self, state_hash: str, state: AuthState) -> None:
        def _write() -> None:
            self._auth_states().document(state_hash).set(state.to_document())

        await self._call(_write)

    async def take_auth_state(self, state_hash: str) -> AuthState | None:
        """Read and delete in one shot; a state may only be redeemed once."""

        def _read_delete() -> dict[str, Any] | None:
            ref = self._auth_states().document(state_hash)
            snap = ref.get()
            if not snap.exists:
                return None
            ref.delete()
            payload: dict[str, Any] | None = snap.to_dict()
            return payload

        data: dict[str, Any] | None = await self._call(_read_delete)
        return AuthState.from_document(data) if data else None

    # -- health --------------------------------------------------------------

    async def ping(self) -> None:
        def _read() -> None:
            self._sessions().document("__healthcheck__").get()

        await self._call(_read)

    async def close(self) -> None:
        client = self._client
        self._client = None
        if client is not None and hasattr(client, "close"):
            with contextlib.suppress(Exception):
                client.close()


def build_store(
    *,
    project_id: str,
    database: str,
    timeout_seconds: float,
    breaker_threshold: int,
    breaker_reset_seconds: float,
    in_memory: bool = False,
) -> SessionStore:
    if in_memory:
        logger.warning("session_store_in_memory")
        return InMemorySessionStore()
    return FirestoreSessionStore(
        project_id=project_id,
        database=database,
        timeout_seconds=timeout_seconds,
        breaker_threshold=breaker_threshold,
        breaker_reset_seconds=breaker_reset_seconds,
    )
