"""Session identifiers and the Firestore session document.

Two things must never be confused:

* the **session id** — 256 bits of randomness, base64url, lives only in the
  ``__Host-AISESSION`` cookie and in memory (docs 11 §5.1);
* the **document id** — ``SHA-256(session_id)`` in hex, which is what Firestore
  actually stores. Runbook §16.3: *"Store the hash of the session identifier as
  the document id, never the identifier itself"*, so a database export does not
  hand out usable cookies.
"""

from __future__ import annotations

import base64
import dataclasses
import hashlib
import secrets
from datetime import UTC, datetime
from typing import Any

SESSION_ID_BYTES = 32  # 256 bits, docs 11 §5.1
SESSIONS_COLLECTION = "sessions"
AUTH_STATES_COLLECTION = "auth_states"


def new_session_id() -> str:
    """256 bits of cryptographic randomness, base64url, unpadded."""
    return base64.urlsafe_b64encode(secrets.token_bytes(SESSION_ID_BYTES)).rstrip(b"=").decode()


def hash_session_id(session_id: str) -> str:
    """Firestore document id for a session id."""
    return hashlib.sha256(session_id.encode("utf-8")).hexdigest()


def new_csrf_token() -> str:
    return secrets.token_urlsafe(32)


def utcnow() -> datetime:
    return datetime.now(UTC)


def _aware(value: datetime | None) -> datetime | None:
    """Firestore may hand back naive datetimes depending on the client path."""
    if value is None:
        return None
    return value if value.tzinfo is not None else value.replace(tzinfo=UTC)


@dataclasses.dataclass(slots=True)
class SessionRecord:
    """The decoded contents of one ``sessions`` document.

    ``access_token`` / ``refresh_token`` are the *plaintext* values and are only
    ever populated in memory after ``app.session.crypto`` has opened them. They
    are never serialised back out in cleartext.
    """

    doc_id: str
    subject_oid: str
    email: str
    name: str
    tid: str
    roles: list[str]
    csrf_token: str
    created_at: datetime
    access_issued_at: datetime
    access_expires_at: datetime
    absolute_expires_at: datetime
    idle_expires_at: datetime
    last_seen_at: datetime

    department: str | None = None
    company_name: str | None = None
    entra_sid: str | None = None

    access_token: str = ""
    refresh_token: str = ""

    refresh_lease_until: datetime | None = None
    superseded_by: str | None = None
    superseded_at: datetime | None = None

    # Populated by the store when a rotation successor is followed. Not persisted.
    successor_session_id: str | None = dataclasses.field(default=None, compare=False)

    @property
    def is_superseded(self) -> bool:
        return self.superseded_by is not None

    def expired_at(self, now: datetime) -> str | None:
        """Return the expiry reason, or ``None`` if the session is still live.

        docs 13 §4: Firestore TTL lags by up to 24 hours, so expiry is checked
        here on every read rather than trusted to the TTL policy.
        """
        if now >= self.absolute_expires_at:
            return "absolute"
        if now >= self.idle_expires_at:
            return "idle"
        return None

    @property
    def stable_jitter_fraction(self) -> float:
        """A per-session constant in [0, 1), derived from the document id.

        docs 13 §3 wants jitter so that "multiple Cloud Run instances" do not
        synchronise onto the same refresh instant. Deriving it from the document
        id rather than drawing a fresh random number per request achieves that
        spread *and* keeps the answer stable: a re-roll on every call makes
        ``needs_refresh`` flap, so a request can decide a refresh is due, take
        the lease, and then decide it is not.
        """
        return int(self.doc_id[:8], 16) / 0xFFFFFFFF if self.doc_id else 0.0

    def needs_refresh(self, now: datetime, fraction: float, jitter_seconds: float) -> bool:
        """docs 13 §3: renew at ~80% of the access token's lifetime, plus jitter.

        Measured from ``access_issued_at``, not ``created_at``: after the first
        refresh the session is older than the token it holds, and using session
        age would make every subsequent token look permanently overdue.
        """
        lifetime = (self.access_expires_at - self.access_issued_at).total_seconds()
        if lifetime <= 0:
            return True
        threshold = (
            self.access_issued_at.timestamp()
            + lifetime * fraction
            + jitter_seconds * self.stable_jitter_fraction
        )
        return now.timestamp() >= threshold

    def to_document(
        self,
        *,
        access_token_ct: bytes,
        refresh_token_ct: bytes,
        nonce_at: bytes,
        nonce_rt: bytes,
        wrapped_dek: bytes,
    ) -> dict[str, Any]:
        return {
            "subject_oid": self.subject_oid,
            "email": self.email,
            "name": self.name,
            "department": self.department,
            "company_name": self.company_name,
            "roles": list(self.roles),
            "tid": self.tid,
            "access_token_ct": access_token_ct,
            "refresh_token_ct": refresh_token_ct,
            "nonce_at": nonce_at,
            "nonce_rt": nonce_rt,
            "wrapped_dek": wrapped_dek,
            "access_issued_at": self.access_issued_at,
            "access_expires_at": self.access_expires_at,
            "absolute_expires_at": self.absolute_expires_at,
            "idle_expires_at": self.idle_expires_at,
            "last_seen_at": self.last_seen_at,
            "refresh_lease_until": self.refresh_lease_until,
            "superseded_by": self.superseded_by,
            "superseded_at": self.superseded_at,
            "csrf_token": self.csrf_token,
            "entra_sid": self.entra_sid,
            "created_at": self.created_at,
        }

    @classmethod
    def from_document(cls, doc_id: str, data: dict[str, Any]) -> SessionRecord:
        return cls(
            doc_id=doc_id,
            subject_oid=data.get("subject_oid", ""),
            email=data.get("email", ""),
            name=data.get("name", ""),
            tid=data.get("tid", ""),
            roles=list(data.get("roles") or []),
            csrf_token=data.get("csrf_token", ""),
            department=data.get("department"),
            company_name=data.get("company_name"),
            entra_sid=data.get("entra_sid"),
            created_at=_aware(data.get("created_at")) or utcnow(),
            access_issued_at=(
                _aware(data.get("access_issued_at")) or _aware(data.get("created_at")) or utcnow()
            ),
            access_expires_at=_aware(data.get("access_expires_at")) or utcnow(),
            absolute_expires_at=_aware(data.get("absolute_expires_at")) or utcnow(),
            idle_expires_at=_aware(data.get("idle_expires_at")) or utcnow(),
            last_seen_at=_aware(data.get("last_seen_at")) or utcnow(),
            refresh_lease_until=_aware(data.get("refresh_lease_until")),
            superseded_by=data.get("superseded_by"),
            superseded_at=_aware(data.get("superseded_at")),
        )


@dataclasses.dataclass(slots=True)
class AuthState:
    """A pre-authentication ``auth_states`` document (plan §5)."""

    nonce: str
    pkce_verifier: str
    return_to: str
    created_at: datetime
    expires_at: datetime
    interactive_retry: bool = False

    def to_document(self) -> dict[str, Any]:
        return {
            "nonce": self.nonce,
            "pkce_verifier": self.pkce_verifier,
            "return_to": self.return_to,
            "created_at": self.created_at,
            "expires_at": self.expires_at,
            "interactive_retry": self.interactive_retry,
        }

    @classmethod
    def from_document(cls, data: dict[str, Any]) -> AuthState:
        return cls(
            nonce=data.get("nonce", ""),
            pkce_verifier=data.get("pkce_verifier", ""),
            return_to=data.get("return_to", "/"),
            created_at=_aware(data.get("created_at")) or utcnow(),
            expires_at=_aware(data.get("expires_at")) or utcnow(),
            interactive_retry=bool(data.get("interactive_retry", False)),
        )
