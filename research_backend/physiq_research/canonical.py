"""Canonical JSON serialization and digests.

Used for everything whose bytes must be stable: processing fingerprints,
idempotency keys and stored-artifact content digests. Never hash ``repr`` or
``str`` of Python objects.

Canonical form
    * UTF-8 JSON, keys sorted, no insignificant whitespace;
    * only dict (str keys), list/tuple, str, int, float, bool and None;
    * floats are written by Python's shortest round-trip ``repr`` (the same
      IEEE-754 double always gives the same text on every platform);
    * a float with an integral value below 2**53 is written as an integer
      (``5.0`` → ``5``, ``-0.0`` → ``0``), so that a value's digest does not
      depend on whether a JSON store (e.g. Postgres JSONB ``numeric``) hands
      it back as an int or a float;
    * NaN and ±Infinity are rejected — they are not valid JSON and never a
      valid research value.
"""

from __future__ import annotations

import hashlib
import json
import math
from typing import Any

_MAX_EXACT_INT = 2**53


class CanonicalizationError(ValueError):
    """The value cannot be represented canonically."""


def _normalize(value: Any, path: str) -> Any:
    if value is None or isinstance(value, (bool, str)):
        return value
    if isinstance(value, int):
        return int(value)
    if isinstance(value, float):
        if not math.isfinite(value):
            raise CanonicalizationError(f"non-finite number at {path}")
        if value.is_integer() and abs(value) < _MAX_EXACT_INT:
            return int(value)  # 5.0 and 5 are the same number; -0.0 becomes 0
        return value
    if isinstance(value, dict):
        out: dict[str, Any] = {}
        for key, item in value.items():
            if not isinstance(key, str):
                raise CanonicalizationError(f"non-string key at {path}")
            out[key] = _normalize(item, f"{path}.{key}")
        return out
    if isinstance(value, (list, tuple)):
        return [_normalize(item, f"{path}[{i}]") for i, item in enumerate(value)]
    raise CanonicalizationError(f"unsupported type {type(value).__name__} at {path}")


def canonical_json(value: Any) -> str:
    """Deterministic JSON text for ``value``."""
    return json.dumps(
        _normalize(value, "$"),
        sort_keys=True,
        separators=(",", ":"),
        ensure_ascii=False,
        allow_nan=False,
    )


def canonical_bytes(value: Any) -> bytes:
    return canonical_json(value).encode("utf-8")


def sha256_hex(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def canonical_digest(value: Any) -> str:
    """SHA-256 (hex) of the canonical JSON of ``value``."""
    return sha256_hex(canonical_bytes(value))


def strict_json_dumps(value: Any) -> str:
    """JSON for database columns: rejects NaN/Infinity, keeps key order."""
    return json.dumps(_normalize(value, "$"), ensure_ascii=False, allow_nan=False)


def strict_json_loads(text: str | bytes) -> Any:
    """Parse JSON, rejecting the non-standard NaN/Infinity tokens."""

    def _reject(token: str) -> Any:
        raise CanonicalizationError(f"non-standard JSON constant {token}")

    return json.loads(text, parse_constant=_reject)
