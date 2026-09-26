"""Force ↔ video synchronization (``force-video-sync-v0.1``).

Two clocks, never assumed to agree:

    media time   M7's video clock: t = (pts − pts₀) × time_base of the
                 first decoded frame, in ms (``media_ms_since_first_decoded_frame``).
                 Never frame_index / nominal_fps.
    force time   the force-plate acquisition clock, in s since force
                 acquisition start (``seconds_since_force_acquisition_start``).

The mapping is an explicit, declared clock model

    t_media_ms = offset_ms + rate × t_force_ms          (t_force_ms = 1000 × t_force_s)

estimated ONLY from declared anchors — events observed in both clocks:

    one_anchor_offset   rate = 1 exactly; offset_ms = video_time_ms − force_time_ms
    two_anchor_affine   rate = (v₂ − v₁)/(f₂ − f₁); offset_ms = v₁ − rate·f₁
                        (models a constant offset plus a small constant clock-rate
                        difference; anchor residuals are recorded)

Rejected, never repaired: anchors not strictly increasing in both clocks
(reversed), anchors closer than ``min_anchor_separation_ms`` in either clock
(degenerate — anchor timing uncertainty δ becomes a rate error ≈ 2δ/Δ),
|rate − 1| > ``max_abs_rate_deviation`` (a plausibility bound against unit or
transcription mistakes, ~100× larger than crystal drift, NOT a drift
estimate), and anchors outside either clock's recorded support.

No alignment is ever derived from the signals themselves (no
cross-correlation, no peak matching). The synchronized output is the CLOSED
intersection of the mapped force support with the video's media support;
nothing is extrapolated beyond it.

Every mapped time is computed by ONE expression (``media_ms_from_force_s``)
so that stored values can be recomputed bit-for-bit on read.
"""

from __future__ import annotations

from collections.abc import Sequence
from dataclasses import dataclass
from typing import Any, Final, Literal

import numpy as np

from physiq_research.force_plate.errors import ForcePlateError
from physiq_research.force_plate.manifest import Anchor
from physiq_research.force_plate.signal import MeasuredForceSignal

SyncMethod = Literal["one_anchor_offset", "two_anchor_affine"]

MIN_ANCHOR_SEPARATION_MS: Final = 1000.0
MAX_ABS_RATE_DEVIATION: Final = 0.01

SYNC_PARAMETERS: Final[dict[str, Any]] = {
    "clock_model": "t_media_ms = offset_ms + rate * t_force_ms",
    "one_anchor_offset": "rate = 1 exactly; offset_ms = video_time_ms - force_time_ms",
    "two_anchor_affine": "rate = (v2 - v1) / (f2 - f1); offset_ms = v1 - rate * f1",
    "min_anchor_separation_ms": MIN_ANCHOR_SEPARATION_MS,
    "max_abs_rate_deviation": MAX_ABS_RATE_DEVIATION,
    "anchor_support": "closed: force [first, last] sample time; video [0, last decoded frame]",
    "overlap": "closed intersection of the mapped force support with the video media support",
    "extrapolation": "none",
    "signal_derived_alignment": "none",
}


@dataclass(frozen=True)
class ClockMapping:
    method: SyncMethod
    offset_ms: float
    rate: float


def media_ms_from_force_s(mapping: ClockMapping, time_s: np.ndarray) -> np.ndarray:
    """THE force→media expression (elementwise, IEEE double, no fused ops)."""
    return mapping.offset_ms + mapping.rate * (np.asarray(time_s, dtype=np.float64) * 1000.0)


def media_ms_from_force_ms(mapping: ClockMapping, t_force_ms: float) -> float:
    return float(mapping.offset_ms + mapping.rate * t_force_ms)


def force_ms_from_media_ms(mapping: ClockMapping, t_media_ms: float) -> float:
    """Inverse mapping (exact up to floating-point rounding)."""
    return float((t_media_ms - mapping.offset_ms) / mapping.rate)


def mapping_from_anchors(method: SyncMethod, anchors: Sequence[Anchor]) -> ClockMapping:
    expected = 1 if method == "one_anchor_offset" else 2
    if len(anchors) != expected:
        raise ForcePlateError("anchor_count_mismatch", field="synchronization.anchors")
    if method == "one_anchor_offset":
        (a,) = anchors
        return ClockMapping(method, a.video_time_ms - a.force_time_ms, 1.0)
    a, b = anchors
    d_force = b.force_time_ms - a.force_time_ms
    d_video = b.video_time_ms - a.video_time_ms
    if d_force < 0 or d_video < 0:
        raise ForcePlateError("anchors_not_increasing", field="synchronization.anchors")
    if d_force < MIN_ANCHOR_SEPARATION_MS or d_video < MIN_ANCHOR_SEPARATION_MS:
        raise ForcePlateError("anchors_too_close", field="synchronization.anchors")
    rate = d_video / d_force
    if abs(rate - 1.0) > MAX_ABS_RATE_DEVIATION:
        raise ForcePlateError("implausible_clock_rate", field="synchronization.anchors")
    return ClockMapping(method, a.video_time_ms - rate * a.force_time_ms, rate)


def check_anchor_support(anchors: Sequence[Anchor], signal: MeasuredForceSignal, media_end_ms: float) -> None:
    first_ms = float(signal.time_s[0]) * 1000.0
    last_ms = float(signal.time_s[-1]) * 1000.0
    for anchor in anchors:
        if not first_ms <= anchor.force_time_ms <= last_ms:
            raise ForcePlateError("anchor_outside_force_support", field="synchronization.anchors")
        if not 0.0 <= anchor.video_time_ms <= media_end_ms:
            raise ForcePlateError("anchor_outside_video_support", field="synchronization.anchors")


@dataclass(frozen=True)
class Overlap:
    """Closed interval where synchronized measured force exists, in both clocks."""

    media_ms: tuple[float, float]
    force_s: tuple[float, float]
    force_support_media_ms: tuple[float, float]
    media_support_ms: tuple[float, float]

    @property
    def duration_ms(self) -> float:
        return self.media_ms[1] - self.media_ms[0]

    def contains_media(self, start_ms: float, end_ms: float) -> bool:
        return self.media_ms[0] <= start_ms and end_ms <= self.media_ms[1]


def compute_overlap(mapping: ClockMapping, signal: MeasuredForceSignal, media_end_ms: float) -> Overlap:
    mapped = media_ms_from_force_s(mapping, signal.time_s[[0, -1]])
    first, last = float(mapped[0]), float(mapped[1])
    start = max(first, 0.0)
    end = min(last, media_end_ms)
    if not end > start:
        raise ForcePlateError("no_temporal_overlap")
    # A bound that comes from the force side is an exact sample time.
    force_start = float(signal.time_s[0]) if start == first else force_ms_from_media_ms(mapping, start) / 1000.0
    force_end = float(signal.time_s[-1]) if end == last else force_ms_from_media_ms(mapping, end) / 1000.0
    return Overlap(
        media_ms=(start, end),
        force_s=(force_start, force_end),
        force_support_media_ms=(first, last),
        media_support_ms=(0.0, media_end_ms),
    )


def describe_sync(
    mapping: ClockMapping, anchors: Sequence[Anchor], overlap: Overlap, signal: MeasuredForceSignal
) -> dict[str, Any]:
    """The synchronization artifact body (schema: records.SyncArtifact)."""
    anchor_rows = [
        {
            "event": a.event,
            "video_time_ms": a.video_time_ms,
            "force_time_ms": a.force_time_ms,
            "residual_ms": media_ms_from_force_ms(mapping, a.force_time_ms) - a.video_time_ms,
        }
        for a in anchors
    ]
    media_span = overlap.media_support_ms[1] - overlap.media_support_ms[0]
    force_span = overlap.force_support_media_ms[1] - overlap.force_support_media_ms[0]
    return {
        "method": mapping.method,
        "mapping": {"offset_ms": mapping.offset_ms, "rate": mapping.rate},
        "anchors": anchor_rows,
        "parameters": dict(SYNC_PARAMETERS),
        "force_support": {
            "force_s": [float(signal.time_s[0]), float(signal.time_s[-1])],
            "media_ms": list(overlap.force_support_media_ms),
        },
        "media_support_ms": list(overlap.media_support_ms),
        "overlap": {
            "media_ms": list(overlap.media_ms),
            "force_s": list(overlap.force_s),
            "duration_ms": overlap.duration_ms,
            "video_coverage_fraction": overlap.duration_ms / media_span if media_span > 0 else 0.0,
            "force_coverage_fraction": overlap.duration_ms / force_span if force_span > 0 else 0.0,
        },
    }
