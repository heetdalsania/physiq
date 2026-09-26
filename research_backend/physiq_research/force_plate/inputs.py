"""Reading untrusted input files: bounded, once, into memory — no temp files.

A force-plate CSV (or a JSON document) is read exactly ONCE into process
memory with a hard byte bound. Its SHA-256 is computed over exactly those
bytes and the parser reads the same buffer, so the digested bytes and the
parsed bytes are identical even if the file changes on disk meanwhile.

This layer never creates, copies, moves or deletes a file: no temporary
copy of a raw force export ever exists, so there is nothing to clean up
after success, failure, cancellation or a killed process. The operator's
own export file is outside this service (like the original video on the
researcher's device in Milestone 7) and is governed by the external
research data-management plan.

Only regular files are read (a FIFO or device is refused without blocking:
the file is opened non-blocking and checked with ``fstat`` first). Paths
are never echoed in errors.

JSON documents are strict: UTF-8 without BOM, no duplicate keys within an
object, no NaN/Infinity tokens and no number outside the double range.
"""

from __future__ import annotations

import codecs
import json
import math
import os
import stat
from pathlib import Path
from typing import Any, Literal

from physiq_research.force_plate.errors import ForcePlateError

_CHUNK = 1024 * 1024
# A decimal integer with more digits than this is outside the double range.
_MAX_INT_DIGITS = 309


def read_bounded(path: Path, *, max_bytes: int, kind: Literal["source", "document"], field: str) -> bytes:
    """All bytes of a regular file, or a stable error. Never follows up with a write."""
    flags = os.O_RDONLY | getattr(os, "O_NONBLOCK", 0) | getattr(os, "O_CLOEXEC", 0)
    try:
        fd = os.open(path, flags)
    except OSError:
        raise ForcePlateError(f"{kind}_unreadable", field=field) from None
    try:
        info = os.fstat(fd)
        if not stat.S_ISREG(info.st_mode):
            raise ForcePlateError(f"{kind}_not_regular_file", field=field)
        if info.st_size > max_bytes:
            raise ForcePlateError(f"{kind}_too_large", field=field)
        chunks: list[bytes] = []
        total = 0
        while True:
            try:
                chunk = os.read(fd, min(_CHUNK, max_bytes + 1 - total))
            except OSError:
                raise ForcePlateError(f"{kind}_unreadable", field=field) from None
            if not chunk:
                break
            total += len(chunk)
            if total > max_bytes:  # the file grew after fstat
                raise ForcePlateError(f"{kind}_too_large", field=field)
            chunks.append(chunk)
        return b"".join(chunks)
    finally:
        os.close(fd)


def decode_utf8(data: bytes, *, field: str) -> str:
    if data.startswith(codecs.BOM_UTF8):
        raise ForcePlateError("byte_order_mark_not_allowed", field=field)
    try:
        return data.decode("utf-8", errors="strict")
    except UnicodeDecodeError:
        raise ForcePlateError("invalid_utf8", field=field) from None


class _DuplicateKey(Exception):
    pass


class _NonFinite(Exception):
    pass


def _object(pairs: list[tuple[str, Any]]) -> dict[str, Any]:
    out: dict[str, Any] = {}
    for key, value in pairs:
        if key in out:
            raise _DuplicateKey
        out[key] = value
    return out


def _reject_constant(_token: str) -> Any:
    raise _NonFinite


def _finite_float(text: str) -> float:
    value = float(text)
    if not math.isfinite(value):  # e.g. 1e400 parses to inf
        raise _NonFinite
    return value


def _bounded_int(text: str) -> int:
    if len(text.lstrip("-")) > _MAX_INT_DIGITS:
        raise _NonFinite
    return int(text)


def parse_json_document(data: bytes, *, field: str) -> Any:
    """Strictly parsed JSON value of a document."""
    text = decode_utf8(data, field=field)
    try:
        return json.loads(
            text,
            object_pairs_hook=_object,
            parse_constant=_reject_constant,
            parse_float=_finite_float,
            parse_int=_bounded_int,
        )
    except _DuplicateKey:
        raise ForcePlateError("duplicate_json_key", field=field) from None
    except _NonFinite:
        raise ForcePlateError("non_finite_json_number", field=field) from None
    except (ValueError, RecursionError):  # JSONDecodeError is a ValueError
        raise ForcePlateError("invalid_json", field=field) from None
