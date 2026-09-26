"""Normalized-time traces ``time-normalization-v0.1``.

An ADDITIONAL representation of a segmented repetition for later research
comparison (0–100% of the detected repetition). It never replaces the
original trace, and absolute timing metrics are always computed from real
media time, never from normalized time.

Algorithm
    * 101 samples at p = 0, 1, …, 100 (% of the detected repetition).
    * t_p = start + (p / 100) · (end − start), where start/end are the
      detected descent start and ascent end (media ms, interpolated
      threshold crossings from segmentation).
    * For each trace (smoothed values), the value at t_p is the linear
      interpolation between the nearest valid sample at or before t_p and
      the nearest valid sample at or after t_p (an exact hit uses that
      sample). No extrapolation.
    * If either bracketing sample is missing, or the two are more than
      300 ms apart (the segmentation's maximum gap), the value is null —
      nothing is interpolated across a tracking gap.
"""

from __future__ import annotations

import bisect
from collections.abc import Sequence
from typing import Any, Final

from physiq_research.domain.segmentation import SEGMENTATION
from physiq_research.domain.smoothing import SmoothedSample

TIME_NORMALIZATION: Final[dict[str, Any]] = {
    "samples": 101,
    "domain": "detected_repetition_descent_start_to_ascent_end",
    "interpolation": "linear_between_bracketing_valid_smoothed_samples",
    "max_bracket_gap_ms": SEGMENTATION["maxGapMs"],
    "extrapolation": "none",
}


def percent_times(start_ms: float, end_ms: float, samples: int = TIME_NORMALIZATION["samples"]) -> list[float]:
    span = end_ms - start_ms
    return [start_ms + (p / (samples - 1)) * span for p in range(samples)]


def resample(
    trace: Sequence[SmoothedSample],
    times: Sequence[float],
    max_gap_ms: float = TIME_NORMALIZATION["max_bracket_gap_ms"],
) -> list[float | None]:
    pts = [(float(s.t_ms), float(s.value)) for s in trace if s.value is not None and s.t_ms is not None]
    ts = [p[0] for p in pts]
    out: list[float | None] = []
    for t in times:
        i = bisect.bisect_left(ts, t)
        if i < len(ts) and ts[i] == t:
            out.append(pts[i][1])
            continue
        if i == 0 or i == len(ts):
            out.append(None)
            continue
        t0, v0 = pts[i - 1]
        t1, v1 = pts[i]
        if t1 - t0 > max_gap_ms:
            out.append(None)
            continue
        f = (t - t0) / (t1 - t0)
        out.append(v0 + f * (v1 - v0))
    return out
