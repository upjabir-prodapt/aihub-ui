"""Python mock upstream, selected by ``UPSTREAM_MODE=mock`` (decision D8)."""

from app.proxy.mock.router import handle, reset_mock_state

__all__ = ["handle", "reset_mock_state"]
