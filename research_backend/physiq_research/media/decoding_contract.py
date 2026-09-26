"""Declared decoding contract (importable without FFmpeg, e.g. by the API)."""

from __future__ import annotations

from typing import Any, Final

SUPPORTED_CODECS: Final = frozenset({"h264", "hevc"})
DEMUXER: Final = "mov"
OPEN_OPTIONS: Final = {"protocol_whitelist": "file", "enable_drefs": "0", "use_absolute_path": "0"}
MAX_TIMESTAMP_ANOMALY_FRACTION: Final = 0.10

DECODER_PARAMETERS: Final[dict[str, Any]] = {
    "demuxer": DEMUXER,
    "protocol_whitelist": "file",
    "supported_codecs": sorted(SUPPORTED_CODECS),
    "timestamp": "(pts - pts_first) * time_base, exact rational",
    "drop_rules": ["missing_pts", "duplicate_pts", "non_monotonic_pts"],
    "max_timestamp_anomaly_fraction": MAX_TIMESTAMP_ANOMALY_FRACTION,
    "orientation": "display matrix pure rotations only; mirror/scale/shear rejected",
    "pixel_conversion": "rgb24 via libswscale, after orientation",
}
