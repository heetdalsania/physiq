"""Cheap content sniffing done by the API (no FFmpeg in the API process).

The filename, extension and declared Content-Type are never trusted on
their own. The API accepts a part only if its first bytes are an ISO base
media file ``ftyp`` box (MP4 / QuickTime MOV, what phones record). Real
validation — container, codec, dimensions, duration, decodability — happens
in the worker's bounded decoder.
"""

from __future__ import annotations

import struct

SNIFF_BYTES = 12


def looks_like_iso_bmff(head: bytes) -> bool:
    """First box is ``ftyp`` with a plausible size and a printable brand."""
    if len(head) < SNIFF_BYTES:
        return False
    size = struct.unpack(">I", head[0:4])[0]
    if head[4:8] != b"ftyp":
        return False
    if size != 1 and (size < 16 or size > 4096):
        return False
    brand = head[8:12]
    return all(32 <= b < 127 for b in brand)
