"""SHA-256 of the raw source video.

Computed while the upload streams to disk and re-verified by the worker
before decoding. Only the digest (plus basic technical metadata) outlives
the video. It permits reproducibility, duplicate detection and audit; it is
NOT anonymization — whoever holds the same video can recompute it.
"""

from __future__ import annotations

import hashlib
from pathlib import Path

CHUNK = 1024 * 1024


def file_sha256(path: Path) -> tuple[str, int]:
    h = hashlib.sha256()
    size = 0
    with open(path, "rb") as fh:
        while True:
            chunk = fh.read(CHUNK)
            if not chunk:
                break
            h.update(chunk)
            size += len(chunk)
    return h.hexdigest(), size


def digest_prefix(digest: str | None) -> str:
    """Log-safe short form (first 12 hex characters)."""
    return (digest or "")[:12]
