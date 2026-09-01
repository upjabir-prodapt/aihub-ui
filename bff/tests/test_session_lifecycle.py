"""Session lifecycle tests — plan §11, docs 13.

These are the tests that matter. Everything else in the BFF is plumbing; this
file is where the rules that are easy to get subtly wrong are pinned down.
"""

from __future__ import annotations

import asyncio
from datetime import UTC, datetime, timedelta

import pytest

from app.auth.oidc import InvalidGrantError, Principal, TokenSet
from app.config import Settings
from app.session.cache import TTLCache
from app.session.crypto import LocalKeyWrapper, TokenEnvelope
from app.session.lifecycle import SessionExpired, SessionManager, SessionTerminated
from app.session.model import hash_session_id
from app.session.store import InMemorySessionStore, SessionStoreUnavailable


class FakeOidc:
    """Counts refreshes so the lease test can assert "exactly one"."""

    def __init__(self, *, expires_in: int = 3600, fail_with: Exception | None = None) -> None:
        self.refresh_calls = 0
        self.expires_in = expires_in
        self.fail_with = fail_with
        self.roles = ["Translation.User"]
        self.refresh_delay = 0.0

    async def refresh(self, refresh_token: str) -> TokenSet:
        self.refresh_calls += 1
        if self.refresh_delay:
            await asyncio.sleep(self.refresh_delay)
        if self.fail_with is not None:
            raise self.fail_with
        return TokenSet(
            access_token=f"new-access-{self.refresh_calls}",
            refresh_token=f"new-refresh-{self.refresh_calls}",
            id_token="",
            expires_in=self.expires_in,
        )

    async def roles_from_access_token(self, access_token: str) -> list[str]:
        return list(self.roles)


def make_manager(
    settings: Settings,
    store: InMemorySessionStore,
    *,
    oidc: FakeOidc | None = None,
    cache_ttl: float = 0.0,
    rotate_on_refresh: bool = True,
) -> SessionManager:
    tuned = settings.model_copy(update={"session_rotate_on_refresh": rotate_on_refresh})
    return SessionManager(
        settings=tuned,
        store=store,
        envelope=TokenEnvelope(LocalKeyWrapper()),
        cache=TTLCache(ttl_seconds=cache_ttl),
        oidc=oidc,  # type: ignore[arg-type]
    )


def a_principal() -> Principal:
    return Principal(
        oid="oid-123",
        email="person@colt.net",
        name="A Person",
        tid="tenant-1",
        roles=["Translation.User"],
        sid="entra-sid-1",
    )


def a_token_set(expires_in: int = 3600) -> TokenSet:
    return TokenSet(
        access_token="access-1",
        refresh_token="refresh-1",
        id_token="",
        expires_in=expires_in,
    )


async def create_session(manager: SessionManager, *, expires_in: int = 3600) -> tuple[str, str]:
    session_id, record = await manager.create(
        principal=a_principal(),
        tokens=a_token_set(expires_in),
        department="AI CoE",
        company_name="Colt",
    )
    return session_id, record.doc_id


# ── Document key ─────────────────────────────────────────────────────────────


async def test_document_key_is_the_hash_never_the_session_id(
    settings: Settings, store: InMemorySessionStore
) -> None:
    """Runbook §16.3: a database read must not yield usable cookies."""
    manager = make_manager(settings, store)
    session_id, doc_id = await create_session(manager)

    assert doc_id == hash_session_id(session_id)
    assert session_id not in store._sessions  # noqa: SLF001
    assert doc_id in store._sessions  # noqa: SLF001

    # And no stored field contains the plaintext id or the plaintext tokens.
    document = store._sessions[doc_id]  # noqa: SLF001
    serialised = repr(document)
    assert session_id not in serialised
    assert "access-1" not in serialised
    assert "refresh-1" not in serialised


# ── Expiry (docs 13 §4) ──────────────────────────────────────────────────────


async def test_expiry_enforced_on_read_even_when_ttl_has_not_reaped(
    settings: Settings, store: InMemorySessionStore
) -> None:
    """Firestore TTL lags up to 24 h, so the read path is the enforcement."""
    manager = make_manager(settings, store)
    session_id, doc_id = await create_session(manager)

    # The document is still present — exactly the state a lagging TTL leaves.
    past = datetime.now(UTC) - timedelta(seconds=1)
    await store.update(doc_id, {"absolute_expires_at": past})
    assert await store.get(doc_id) is not None

    with pytest.raises(SessionExpired) as excinfo:
        await manager.load(session_id)
    assert excinfo.value.reason == "absolute"
    # docs 13 §1: expiry runs the same path as logout — delete, do not refuse.
    assert await store.get(doc_id) is None


async def test_idle_expiry_is_distinct_from_absolute(
    settings: Settings, store: InMemorySessionStore
) -> None:
    manager = make_manager(settings, store)
    session_id, doc_id = await create_session(manager)

    await store.update(doc_id, {"idle_expires_at": datetime.now(UTC) - timedelta(seconds=1)})

    with pytest.raises(SessionExpired) as excinfo:
        await manager.load(session_id)
    assert excinfo.value.reason == "idle"


async def test_forged_cookie_is_rejected(settings: Settings, store: InMemorySessionStore) -> None:
    """Gap G21 negative test."""
    manager = make_manager(settings, store)
    await create_session(manager)

    with pytest.raises(SessionExpired) as excinfo:
        await manager.load("not-a-real-session-id")
    assert excinfo.value.reason == "not_found"


# ── Fail closed (docs 13 §4) ─────────────────────────────────────────────────


async def test_store_failure_raises_unavailable_not_expired(
    settings: Settings, store: InMemorySessionStore
) -> None:
    """503, never 401. A 401 during an outage is a redirect-to-login storm."""
    manager = make_manager(settings, store)
    session_id, _ = await create_session(manager)

    store.fail_with = SessionStoreUnavailable("firestore down", retry_after=5)

    with pytest.raises(SessionStoreUnavailable):
        await manager.load(session_id)


async def test_missing_document_and_store_failure_are_different_types(
    settings: Settings, store: InMemorySessionStore
) -> None:
    """ "Do not collapse them, or you cannot tell an outage from expiry.\""""
    manager = make_manager(settings, store)
    assert not issubclass(SessionStoreUnavailable, SessionExpired)
    assert not issubclass(SessionExpired, SessionStoreUnavailable)

    with pytest.raises(SessionExpired):
        await manager.load("absent")

    store.fail_with = SessionStoreUnavailable("boom")
    with pytest.raises(SessionStoreUnavailable):
        await manager.load("absent")


# ── last_seen_at throttling (docs 13 §6) ─────────────────────────────────────


async def test_last_seen_at_is_throttled_to_one_write_per_minute(
    settings: Settings, store: InMemorySessionStore
) -> None:
    """Firestore sustains ~1 write/sec/document; a write per request is out."""
    manager = make_manager(settings, store)
    session_id, doc_id = await create_session(manager)

    first = (await store.get(doc_id))["last_seen_at"]
    for _ in range(5):
        await manager.load(session_id)
    assert (await store.get(doc_id))["last_seen_at"] == first

    # Push last_seen_at past the throttle window and the next read does write.
    await store.update(doc_id, {"last_seen_at": datetime.now(UTC) - timedelta(seconds=120)})
    await manager.load(session_id)
    assert (await store.get(doc_id))["last_seen_at"] != first


# ── Rotation (docs 13 §2) ────────────────────────────────────────────────────


async def test_predecessor_is_readable_inside_the_grace_window(
    settings: Settings, store: InMemorySessionStore
) -> None:
    """A browser routinely has several requests in flight during a rotation."""
    manager = make_manager(settings, store)
    old_id, old_doc = await create_session(manager)
    old_record = await manager._read_record(old_doc)  # noqa: SLF001

    new_id, successor = await manager.rotate(old_record, trigger="test")
    assert new_id != old_id
    assert successor.doc_id == hash_session_id(new_id)

    loaded = await manager.load(old_id)
    assert loaded.served_via_predecessor is True
    # Served with the *successor's* state, so the tokens are the fresh ones.
    assert loaded.record.doc_id == successor.doc_id


async def test_predecessor_is_rejected_after_the_grace_window(
    settings: Settings, store: InMemorySessionStore
) -> None:
    manager = make_manager(settings, store)
    old_id, old_doc = await create_session(manager)
    old_record = await manager._read_record(old_doc)  # noqa: SLF001
    await manager.rotate(old_record, trigger="test")

    # Age the supersession past the 30 s grace.
    await store.update(
        old_doc,
        {"superseded_at": datetime.now(UTC) - timedelta(seconds=61)},
    )

    with pytest.raises(SessionExpired) as excinfo:
        await manager.load(old_id)
    assert excinfo.value.reason == "rotated"
    assert await store.get(old_doc) is None


async def test_rotation_carries_identity_and_csrf_forward(
    settings: Settings, store: InMemorySessionStore
) -> None:
    manager = make_manager(settings, store)
    _old_id, old_doc = await create_session(manager)
    old_record = await manager._read_record(old_doc)  # noqa: SLF001

    _new_id, successor = await manager.rotate(old_record, trigger="test")

    assert successor.subject_oid == old_record.subject_oid
    assert successor.absolute_expires_at == old_record.absolute_expires_at
    # Rotation is invisible to the SPA; invalidating the CSRF token would break
    # every form already on screen.
    assert successor.csrf_token == old_record.csrf_token


# ── Refresh (docs 13 §3) ─────────────────────────────────────────────────────


async def test_refresh_is_triggered_at_eighty_percent_of_lifetime(
    settings: Settings, store: InMemorySessionStore
) -> None:
    oidc = FakeOidc()
    manager = make_manager(settings, store, oidc=oidc, rotate_on_refresh=False)
    session_id, doc_id = await create_session(manager, expires_in=1000)

    # 50% elapsed: not yet due.
    loaded = await manager.load(session_id)
    await manager.ensure_fresh_access_token(loaded)
    assert oidc.refresh_calls == 0

    # Rewind the issue time so 90% of the token's life has elapsed.
    now = datetime.now(UTC)
    await store.update(
        doc_id,
        {
            "access_issued_at": now - timedelta(seconds=900),
            "access_expires_at": now + timedelta(seconds=100),
        },
    )
    loaded = await manager.load(session_id)
    await manager.ensure_fresh_access_token(loaded)
    assert oidc.refresh_calls == 1


async def test_concurrent_requests_produce_exactly_one_refresh(
    settings: Settings, store: InMemorySessionStore
) -> None:
    """The lease exists so N in-flight requests do not each call Entra."""
    oidc = FakeOidc()
    oidc.refresh_delay = 0.05
    manager = make_manager(settings, store, oidc=oidc, rotate_on_refresh=False)
    session_id, doc_id = await create_session(manager, expires_in=1000)

    # Access token already expired: losers must wait rather than proceed.
    now = datetime.now(UTC)
    await store.update(
        doc_id,
        {
            "access_issued_at": now - timedelta(seconds=1001),
            "access_expires_at": now - timedelta(seconds=1),
        },
    )

    async def one_request() -> str:
        loaded = await manager.load(session_id)
        refreshed = await manager.ensure_fresh_access_token(loaded)
        return refreshed.record.access_token

    results = await asyncio.gather(*(one_request() for _ in range(5)))

    assert oidc.refresh_calls == 1, "the lease did not hold: Entra was called more than once"
    # Every caller, winner and losers alike, ends up with the new token.
    assert all(token == "new-access-1" for token in results)


async def test_loser_backs_off_and_then_succeeds(
    settings: Settings, store: InMemorySessionStore
) -> None:
    oidc = FakeOidc()
    manager = make_manager(settings, store, oidc=oidc, rotate_on_refresh=False)
    session_id, doc_id = await create_session(manager, expires_in=1000)
    now = datetime.now(UTC)
    await store.update(
        doc_id,
        {
            "access_issued_at": now - timedelta(seconds=1001),
            "access_expires_at": now - timedelta(seconds=1),
        },
    )

    # Simulate another instance holding the lease, then releasing it with a
    # refreshed token part-way through our backoff ladder.
    await store.acquire_refresh_lease(doc_id, 10)

    async def winner_finishes_later() -> None:
        await asyncio.sleep(0.12)
        await store.update(
            doc_id,
            {
                "access_expires_at": datetime.now(UTC) + timedelta(seconds=900),
                "refresh_lease_until": None,
            },
        )

    task = asyncio.create_task(winner_finishes_later())
    loaded = await manager.load(session_id)
    refreshed = await manager.ensure_fresh_access_token(loaded)
    await task

    assert oidc.refresh_calls == 0, "the loser should not have refreshed"
    assert refreshed.record.access_expires_at > datetime.now(UTC)


async def test_loser_gives_up_with_503_rather_than_holding_the_instance(
    settings: Settings, store: InMemorySessionStore
) -> None:
    """docs 13 §3: cap the wait at ~2 s, then fail with 503."""
    oidc = FakeOidc()
    tuned = settings.model_copy(update={"session_refresh_loser_max_wait_seconds": 0.2})
    manager = SessionManager(
        settings=tuned,
        store=store,
        envelope=TokenEnvelope(LocalKeyWrapper()),
        cache=TTLCache(ttl_seconds=0),
        oidc=oidc,  # type: ignore[arg-type]
    )
    session_id, doc_id = await create_session(manager, expires_in=1000)
    now = datetime.now(UTC)
    await store.update(
        doc_id,
        {
            "access_issued_at": now - timedelta(seconds=1001),
            "access_expires_at": now - timedelta(seconds=1),
        },
    )
    # A lease nobody ever releases.
    await store.acquire_refresh_lease(doc_id, 30)

    loaded = await manager.load(session_id)
    with pytest.raises(SessionStoreUnavailable):
        await manager.ensure_fresh_access_token(loaded)


async def test_invalid_grant_terminates_and_does_not_retry(
    settings: Settings, store: InMemorySessionStore
) -> None:
    """docs 13 §3: "Do not retry." A retry loop here signs everyone out."""
    oidc = FakeOidc(fail_with=InvalidGrantError("dead refresh token"))
    manager = make_manager(settings, store, oidc=oidc)
    session_id, doc_id = await create_session(manager, expires_in=1000)
    now = datetime.now(UTC)
    await store.update(
        doc_id,
        {
            "access_issued_at": now - timedelta(seconds=990),
            "access_expires_at": now + timedelta(seconds=10),
        },
    )

    loaded = await manager.load(session_id)
    with pytest.raises(SessionTerminated):
        await manager.ensure_fresh_access_token(loaded)

    assert oidc.refresh_calls == 1, "invalid_grant must not be retried"
    assert await store.get(doc_id) is None, "the session must be deleted, not marked"


async def test_privilege_change_forces_rotation_even_when_disabled(
    settings: Settings, store: InMemorySessionStore
) -> None:
    """docs 13 §2: a changed roles array is a privilege change; rotate."""
    oidc = FakeOidc()
    oidc.roles = ["Translation.User", "Platform.Admin"]
    manager = make_manager(settings, store, oidc=oidc, rotate_on_refresh=False)
    session_id, doc_id = await create_session(manager, expires_in=1000)
    now = datetime.now(UTC)
    await store.update(
        doc_id,
        {
            "access_issued_at": now - timedelta(seconds=990),
            "access_expires_at": now + timedelta(seconds=10),
        },
    )

    loaded = await manager.load(session_id)
    refreshed = await manager.ensure_fresh_access_token(loaded)

    assert refreshed.cookie_needs_update is True
    assert refreshed.rotated_to is not None
    assert refreshed.rotated_to != session_id
    assert sorted(refreshed.record.roles) == ["Platform.Admin", "Translation.User"]


# ── Termination ──────────────────────────────────────────────────────────────


async def test_terminate_is_idempotent(settings: Settings, store: InMemorySessionStore) -> None:
    manager = make_manager(settings, store)
    session_id, doc_id = await create_session(manager)

    await manager.terminate(session_id, reason="user_initiated")
    await manager.terminate(session_id, reason="user_initiated")
    await manager.terminate("", reason="user_initiated")
    assert await store.get(doc_id) is None


async def test_frontchannel_logout_deletes_by_entra_sid(
    settings: Settings, store: InMemorySessionStore
) -> None:
    manager = make_manager(settings, store)
    _one, doc_one = await create_session(manager)
    _two, doc_two = await create_session(manager)

    deleted = await manager.terminate_by_entra_sid("entra-sid-1")

    assert deleted == 2
    assert await store.get(doc_one) is None
    assert await store.get(doc_two) is None


# ── Cache (docs 13 §4) ───────────────────────────────────────────────────────


async def test_cache_is_bypassed_when_the_session_has_expired(
    settings: Settings, store: InMemorySessionStore
) -> None:
    """The cache may serve a stale session, but never an expired one."""
    manager = make_manager(settings, store, cache_ttl=15.0)
    session_id, doc_id = await create_session(manager)

    await manager.load(session_id)  # populate the cache

    # Expire it in the store *and* in the cached copy's own fields.
    past = datetime.now(UTC) - timedelta(seconds=1)
    await store.update(doc_id, {"absolute_expires_at": past})
    cached = manager._cache.get(doc_id)  # noqa: SLF001
    assert cached is not None
    cached.absolute_expires_at = past

    with pytest.raises(SessionExpired):
        await manager.load(session_id)
