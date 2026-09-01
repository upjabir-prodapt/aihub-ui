"""Short-TTL in-instance session cache.

docs 13 §4 asks for a 5–15 second cache keyed on the session hash to keep the
p95 session read under 25 ms, and is explicit about the trade: "a revoked
session remains valid for up to the cache lifetime."

That trade is only acceptable because the cache is *bypassed* on logout,
rotation and privilege-sensitive operations. ``invalidate()`` is therefore not
optional cleanup — it is the control that bounds the exposure.
"""

from __future__ import annotations

import time
from dataclasses import dataclass
from typing import Generic, TypeVar

T = TypeVar("T")


@dataclass(slots=True)
class _Entry(Generic[T]):
    value: T
    expires_at: float


class TTLCache(Generic[T]):
    def __init__(self, *, ttl_seconds: float, max_entries: int = 10_000) -> None:
        self._ttl = ttl_seconds
        self._max = max_entries
        self._data: dict[str, _Entry[T]] = {}
        self.hits = 0
        self.misses = 0

    @property
    def enabled(self) -> bool:
        return self._ttl > 0

    def get(self, key: str) -> T | None:
        if not self.enabled:
            return None
        entry = self._data.get(key)
        if entry is None:
            self.misses += 1
            return None
        if time.monotonic() >= entry.expires_at:
            self._data.pop(key, None)
            self.misses += 1
            return None
        self.hits += 1
        return entry.value

    def set(self, key: str, value: T) -> None:
        if not self.enabled:
            return
        if len(self._data) >= self._max:
            self._evict_expired()
        if len(self._data) >= self._max:
            # Still full: drop the oldest quarter rather than grow unbounded.
            for stale in list(self._data)[: self._max // 4]:
                self._data.pop(stale, None)
        self._data[key] = _Entry(value=value, expires_at=time.monotonic() + self._ttl)

    def invalidate(self, key: str) -> None:
        """Bypass/clear on logout, rotation and privilege-sensitive operations."""
        self._data.pop(key, None)

    def clear(self) -> None:
        self._data.clear()

    def _evict_expired(self) -> None:
        now = time.monotonic()
        for key, entry in list(self._data.items()):
            if now >= entry.expires_at:
                self._data.pop(key, None)

    def __len__(self) -> int:
        return len(self._data)
