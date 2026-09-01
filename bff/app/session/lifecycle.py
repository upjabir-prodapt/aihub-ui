"""Session lifecycle: creation, read, expiry, refresh, rotation, termination.

This is where docs 13 is implemented. The rules that are easy to get subtly
wrong, and why they are written the way they are:

* **Expiry is checked on every read.** Firestore TTL lags by up to 24 hours
  (docs 13 §4), so the TTL policy on ``absolute_expires_at`` is housekeeping.
  The check here is the enforcement.
* **Firestore failure is 503, never 401** (docs 13 §4). Returning 401 during an
  outage sends every browser to the login endpoint at once.
* **The refresh lease is a Firestore transaction** (docs 13 §3) and the Entra
  HTTP timeout sits well inside it, or the lease expires mid-call and the
  stampede comes back.
* **``invalid_grant`` terminates.** It never retries.
* **Rotation keeps the predecessor readable for 30 s** so the several requests a
  browser routinely has in flight do not fail.
"""

from __future__ import annotations

import asyncio
import logging
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from typing import TYPE_CHECKING, Any

from app.auth.oidc import InvalidGrantError, OidcError, Principal, TokenSet
from app.config import Settings
from app.session.cache import TTLCache
from app.session.crypto import CryptoError, TokenEnvelope
from app.session.model import (
    SessionRecord,
    hash_session_id,
    new_csrf_token,
    new_session_id,
    utcnow,
)
from app.session.store import SessionStore, SessionStoreUnavailable

if TYPE_CHECKING:  # pragma: no cover
    from app.auth.oidc import OidcClient

logger = logging.getLogger(__name__)

# docs 13 §3: 50, 100, 200 ... capped so total wait stays around two seconds.
BACKOFF_LADDER_MS = (50, 100, 200, 400, 800, 1600)


class SessionExpired(RuntimeError):
    """The session is genuinely gone or timed out. Surfaces as 401."""

    def __init__(self, reason: str) -> None:
        super().__init__(reason)
        self.reason = reason


class SessionTerminated(SessionExpired):
    """The session was killed mid-request (``invalid_grant``). Surfaces as 401."""


@dataclass(slots=True)
class LoadedSession:
    """A live session plus the bookkeeping the response layer needs."""

    record: SessionRecord
    session_id: str
    rotated_to: str | None = None
    served_via_predecessor: bool = False

    @property
    def cookie_needs_update(self) -> bool:
        return self.rotated_to is not None


class SessionManager:
    def __init__(
        self,
        *,
        settings: Settings,
        store: SessionStore,
        envelope: TokenEnvelope,
        cache: TTLCache[Any],
        oidc: OidcClient | None = None,
    ) -> None:
        self._settings = settings
        self._store = store
        self._envelope = envelope
        self._cache = cache
        self._oidc = oidc
        # Serialises refresh attempts inside one instance, so N concurrent
        # requests on the same worker make one Firestore transaction, not N.
        self._refresh_locks: dict[str, asyncio.Lock] = {}
        self._lock_guard = asyncio.Lock()

    # ── helpers ──────────────────────────────────────────────────────────────

    @staticmethod
    def _aad(doc_id: str) -> bytes:
        """Bind the ciphertext to its document, so envelopes cannot be swapped."""
        return f"aihub-session:{doc_id}".encode()

    async def _lock_for(self, doc_id: str) -> asyncio.Lock:
        async with self._lock_guard:
            return self._refresh_locks.setdefault(doc_id, asyncio.Lock())

    # ── creation ─────────────────────────────────────────────────────────────

    async def create(
        self,
        *,
        principal: Principal,
        tokens: TokenSet,
        department: str | None,
        company_name: str | None,
    ) -> tuple[str, SessionRecord]:
        """Mint a brand-new session. Always a fresh id (docs 13 §2, fixation defence)."""
        session_id = new_session_id()
        doc_id = hash_session_id(session_id)
        now = utcnow()

        record = SessionRecord(
            doc_id=doc_id,
            subject_oid=principal.oid,
            email=principal.email,
            name=principal.name,
            tid=principal.tid,
            roles=list(principal.roles),
            csrf_token=new_csrf_token(),
            department=department,
            company_name=company_name,
            entra_sid=principal.sid,
            created_at=now,
            access_issued_at=datetime.fromtimestamp(tokens.obtained_at, tz=UTC),
            access_expires_at=datetime.fromtimestamp(tokens.access_expires_at_epoch, tz=UTC),
            absolute_expires_at=now
            + timedelta(seconds=self._settings.session_absolute_ttl_seconds),
            idle_expires_at=now + timedelta(seconds=self._settings.session_idle_ttl_seconds),
            last_seen_at=now,
            access_token=tokens.access_token,
            refresh_token=tokens.refresh_token,
        )

        await self._persist_new(record)
        logger.info(
            "session_created",
            extra={"oid": principal.oid, "docId": doc_id, "roles": record.roles},
        )
        return session_id, record

    async def _persist_new(self, record: SessionRecord) -> None:
        aad = self._aad(record.doc_id)
        access_ct, refresh_ct, nonce_at, nonce_rt, wrapped = await self._envelope.seal(
            record.access_token, record.refresh_token, aad=aad
        )
        await self._store.create(
            record.doc_id,
            record.to_document(
                access_token_ct=access_ct,
                refresh_token_ct=refresh_ct,
                nonce_at=nonce_at,
                nonce_rt=nonce_rt,
                wrapped_dek=wrapped,
            ),
        )

    # ── read ─────────────────────────────────────────────────────────────────

    async def load(
        self, session_id: str, *, bypass_cache: bool = False, touch: bool = True
    ) -> LoadedSession:
        """Resolve a cookie value to a live session.

        Raises ``SessionExpired`` (-> 401) or ``SessionStoreUnavailable`` (-> 503).
        Never conflates the two.
        """
        if not session_id:
            raise SessionExpired("no session cookie")

        doc_id = hash_session_id(session_id)

        if not bypass_cache:
            cached = self._cache.get(doc_id)
            if cached is not None:
                record: SessionRecord = cached
                reason = record.expired_at(utcnow())
                if reason is None:
                    return LoadedSession(record=record, session_id=session_id)
                self._cache.invalidate(doc_id)

        record = await self._read_record(doc_id)

        # Rotation grace (docs 13 §2): a predecessor stays readable for 30 s.
        if record.is_superseded:
            return await self._follow_supersession(record, session_id)

        now = utcnow()
        reason = record.expired_at(now)
        if reason is not None:
            # docs 13 §1: idle and absolute expiry run the same path as logout —
            # delete the document, do not merely refuse the request.
            await self._destroy(doc_id, reason=reason)
            raise SessionExpired(reason)

        if touch:
            await self._touch(record, now)

        self._cache.set(doc_id, record)
        return LoadedSession(record=record, session_id=session_id)

    async def _read_record(self, doc_id: str) -> SessionRecord:
        data = await self._store.get(doc_id)
        if data is None:
            # Distinct from a store failure — this is a normal 401 (docs 13 §4).
            raise SessionExpired("not_found")

        record = SessionRecord.from_document(doc_id, data)
        try:
            access, refresh = await self._envelope.open(
                access_ct=bytes(data.get("access_token_ct") or b""),
                refresh_ct=bytes(data.get("refresh_token_ct") or b""),
                nonce_at=bytes(data.get("nonce_at") or b""),
                nonce_rt=bytes(data.get("nonce_rt") or b""),
                wrapped_dek=bytes(data.get("wrapped_dek") or b""),
                aad=self._aad(doc_id),
            )
        except CryptoError as exc:
            # An envelope we cannot open is not a valid session. Fail closed.
            logger.error("session_envelope_unreadable", extra={"docId": doc_id, "error": str(exc)})
            await self._destroy(doc_id, reason="corrupt")
            raise SessionExpired("corrupt") from exc

        record.access_token = access
        record.refresh_token = refresh
        return record

    async def _follow_supersession(
        self, predecessor: SessionRecord, session_id: str
    ) -> LoadedSession:
        """Serve an in-flight request that still carries the pre-rotation cookie."""
        grace = timedelta(seconds=self._settings.session_rotation_grace_seconds)
        superseded_at = predecessor.superseded_at or predecessor.last_seen_at
        if utcnow() >= superseded_at + grace:
            await self._destroy(predecessor.doc_id, reason="rotation_grace_elapsed")
            raise SessionExpired("rotated")

        successor_doc_id = predecessor.superseded_by or ""
        successor = await self._read_record(successor_doc_id)
        reason = successor.expired_at(utcnow())
        if reason is not None:
            await self._destroy(successor_doc_id, reason=reason)
            raise SessionExpired(reason)

        # The browser already received the successor cookie on the response that
        # performed the rotation, so no Set-Cookie is emitted here.
        return LoadedSession(record=successor, session_id=session_id, served_via_predecessor=True)

    async def _touch(self, record: SessionRecord, now: datetime) -> None:
        """Slide the idle window, throttled to one write per minute (docs 13 §6)."""
        elapsed = (now - record.last_seen_at).total_seconds()
        if elapsed < self._settings.session_last_seen_throttle_seconds:
            return
        record.last_seen_at = now
        record.idle_expires_at = now + timedelta(seconds=self._settings.session_idle_ttl_seconds)
        try:
            await self._store.update(
                record.doc_id,
                {"last_seen_at": record.last_seen_at, "idle_expires_at": record.idle_expires_at},
            )
        except SessionStoreUnavailable:
            # A missed heartbeat is not worth failing a request the caller is
            # otherwise entitled to make.
            logger.warning("last_seen_write_skipped", extra={"docId": record.doc_id})

    # ── refresh (docs 13 §3) ─────────────────────────────────────────────────

    async def ensure_fresh_access_token(self, loaded: LoadedSession) -> LoadedSession:
        """Refresh the access token if it is due, honouring the lease protocol."""
        record = loaded.record
        now = utcnow()

        if self._oidc is None:
            return loaded

        # Jitter is a stable per-session value (see SessionRecord), so this
        # answer does not change between here and the re-check under the lock.
        jitter = self._settings.session_refresh_jitter_seconds
        if not record.needs_refresh(now, self._settings.session_refresh_at_fraction, jitter):
            return loaded

        expired = now >= record.access_expires_at

        lock = await self._lock_for(record.doc_id)
        if lock.locked() and not expired:
            # Another coroutine on this instance is already refreshing and our
            # token is still usable. Proceed rather than queue.
            return loaded

        async with lock:
            # Re-read under the lock: the winner may already have finished.
            fresh = await self._read_record(record.doc_id)
            if not fresh.needs_refresh(
                utcnow(), self._settings.session_refresh_at_fraction, jitter
            ):
                return LoadedSession(record=fresh, session_id=loaded.session_id)

            acquired = await self._store.acquire_refresh_lease(
                record.doc_id, self._settings.session_refresh_lease_seconds
            )
            if acquired:
                return await self._do_refresh(fresh, loaded.session_id)

        # Lost the lease.
        if not expired:
            # Proactive refresh: the current token still works, so do not block.
            return loaded
        return await self._await_winner(record.doc_id, loaded.session_id)

    async def _await_winner(self, doc_id: str, session_id: str) -> LoadedSession:
        """Loser path: back off, re-reading the document, then give up with 503."""
        waited = 0.0
        cap = self._settings.session_refresh_loser_max_wait_seconds
        for delay_ms in BACKOFF_LADDER_MS:
            delay = delay_ms / 1000.0
            if waited + delay > cap:
                break
            await asyncio.sleep(delay)
            waited += delay

            record = await self._read_record(doc_id)
            if record.is_superseded:
                return await self._follow_supersession(record, session_id)
            if utcnow() < record.access_expires_at:
                self._cache.invalidate(doc_id)
                return LoadedSession(record=record, session_id=session_id)

        # docs 13 §3: cap the wait; do not hold a Cloud Run instance open.
        logger.warning("refresh_wait_exceeded", extra={"docId": doc_id, "waitedSeconds": waited})
        raise SessionStoreUnavailable("token refresh did not complete in time", retry_after=1)

    async def _do_refresh(self, record: SessionRecord, session_id: str) -> LoadedSession:
        assert self._oidc is not None  # noqa: S101
        try:
            tokens = await self._oidc.refresh(record.refresh_token)
        except InvalidGrantError:
            # docs 13 §3: terminate. Never retry-loop.
            logger.warning("refresh_invalid_grant", extra={"docId": record.doc_id})
            await self._destroy(record.doc_id, reason="invalid_grant")
            raise SessionTerminated("invalid_grant") from None
        except OidcError as exc:
            await self._store.release_refresh_lease(record.doc_id)
            logger.error("refresh_failed", extra={"docId": record.doc_id, "error": str(exc)})
            raise SessionStoreUnavailable("token refresh failed", retry_after=2) from exc

        new_roles = await self._oidc.roles_from_access_token(tokens.access_token)
        if not new_roles:
            new_roles = list(record.roles)
        privilege_change = sorted(new_roles) != sorted(record.roles)

        record.access_token = tokens.access_token
        record.refresh_token = tokens.refresh_token
        record.access_issued_at = datetime.fromtimestamp(tokens.obtained_at, tz=UTC)
        record.access_expires_at = datetime.fromtimestamp(tokens.access_expires_at_epoch, tz=UTC)
        record.roles = new_roles

        # docs 13 §2 rotates on privilege change; plan §7 also rotates on plain
        # refresh. SESSION_ROTATE_ON_REFRESH controls only the latter.
        if privilege_change or self._settings.session_rotate_on_refresh:
            new_session_id_value, successor = await self.rotate(
                record, trigger="privilege_change" if privilege_change else "refresh"
            )
            return LoadedSession(
                record=successor,
                session_id=new_session_id_value,
                rotated_to=new_session_id_value,
            )

        await self._rewrite_tokens(record)
        await self._store.release_refresh_lease(record.doc_id)
        self._cache.invalidate(record.doc_id)
        logger.info("access_token_refreshed", extra={"docId": record.doc_id})
        return LoadedSession(record=record, session_id=session_id)

    async def _rewrite_tokens(self, record: SessionRecord) -> None:
        aad = self._aad(record.doc_id)
        access_ct, refresh_ct, nonce_at, nonce_rt, wrapped = await self._envelope.seal(
            record.access_token, record.refresh_token, aad=aad
        )
        await self._store.update(
            record.doc_id,
            {
                "access_token_ct": access_ct,
                "refresh_token_ct": refresh_ct,
                "nonce_at": nonce_at,
                "nonce_rt": nonce_rt,
                "wrapped_dek": wrapped,
                "access_issued_at": record.access_issued_at,
                "access_expires_at": record.access_expires_at,
                "roles": list(record.roles),
                "refresh_lease_until": None,
            },
        )

    # ── rotation (docs 13 §2) ────────────────────────────────────────────────

    async def rotate(self, record: SessionRecord, *, trigger: str) -> tuple[str, SessionRecord]:
        """Mint a successor and leave the predecessor readable for the grace window."""
        successor_id = new_session_id()
        successor_doc_id = hash_session_id(successor_id)
        now = utcnow()

        successor = SessionRecord(
            doc_id=successor_doc_id,
            subject_oid=record.subject_oid,
            email=record.email,
            name=record.name,
            tid=record.tid,
            roles=list(record.roles),
            # Carry the CSRF token forward: rotation is invisible to the SPA, and
            # invalidating it would break every form already on screen.
            csrf_token=record.csrf_token,
            department=record.department,
            company_name=record.company_name,
            entra_sid=record.entra_sid,
            created_at=now,
            access_issued_at=record.access_issued_at,
            access_expires_at=record.access_expires_at,
            absolute_expires_at=record.absolute_expires_at,
            idle_expires_at=now + timedelta(seconds=self._settings.session_idle_ttl_seconds),
            last_seen_at=now,
            access_token=record.access_token,
            refresh_token=record.refresh_token,
        )
        await self._persist_new(successor)

        await self._store.update(
            record.doc_id,
            {
                "superseded_by": successor_doc_id,
                "superseded_at": now,
                "refresh_lease_until": None,
            },
        )
        self._cache.invalidate(record.doc_id)

        logger.info(
            "session_rotated",
            extra={
                "trigger": trigger,
                "predecessorDocId": record.doc_id,
                "successorDocId": successor_doc_id,
            },
        )
        # Best-effort cleanup once the grace window has passed.
        asyncio.create_task(self._reap_predecessor(record.doc_id))  # noqa: RUF006
        return successor_id, successor

    async def _reap_predecessor(self, doc_id: str) -> None:
        await asyncio.sleep(self._settings.session_rotation_grace_seconds)
        try:
            await self._store.delete(doc_id)
        except Exception as exc:  # noqa: BLE001 - TTL and the read path both cover us
            logger.warning("predecessor_reap_failed", extra={"docId": doc_id, "error": str(exc)})

    # ── termination ──────────────────────────────────────────────────────────

    async def _destroy(self, doc_id: str, *, reason: str) -> None:
        self._cache.invalidate(doc_id)
        try:
            await self._store.delete(doc_id)
        except SessionStoreUnavailable:
            logger.warning("session_delete_failed", extra={"docId": doc_id, "reason": reason})
        logger.info("session_ended", extra={"docId": doc_id, "reason": reason})

    async def terminate(self, session_id: str, *, reason: str) -> None:
        """Delete a session by cookie value. Idempotent (docs 13 §1)."""
        if not session_id:
            return
        await self._destroy(hash_session_id(session_id), reason=reason)

    async def terminate_by_entra_sid(self, sid: str) -> int:
        """Front-channel logout: Entra tells us which session ended."""
        self._cache.clear()
        count = await self._store.delete_by_entra_sid(sid)
        logger.info("frontchannel_logout", extra={"sessionsDeleted": count})
        return count

    async def peek(self, session_id: str) -> SessionRecord | None:
        """Read without touching or refreshing. Used by logout for revocation."""
        if not session_id:
            return None
        try:
            return await self._read_record(hash_session_id(session_id))
        except (SessionExpired, SessionStoreUnavailable):
            return None
