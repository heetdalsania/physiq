"""Temporal smoothing (port of smoothing.js).

Symmetric centred moving median over at most 5 samples: sample i plus, for
each k = 1, 2, the PAIR (i − k, i + k) — included only when BOTH members are
valid and both lie within 300 ms of sample i. Windows hold 1, 3 or 5 values.
Invalid samples stay invalid, nothing is interpolated, timestamps are
unchanged. (A k = 2 pair is still used when the k = 1 pair is not, exactly
as in the JavaScript source.)
"""

from __future__ import annotations

import math
from collections.abc import Sequence
from dataclasses import dataclass
from typing import Any, Final

from physiq_research.domain.geometry import median
from physiq_research.domain.kinematics import AngleSample

SMOOTHING: Final[dict[str, Any]] = {
    "method": "symmetric_centered_moving_median",
    "halfWindowSamples": 2,
    "maxNeighborOffsetMs": 300,
}


@dataclass(frozen=True, slots=True)
class SmoothedSample:
    t_ms: float | None
    raw: float | None
    value: float | None
    state: str


def _is_valid(s: AngleSample | None) -> bool:
    return s is not None and s.state == "valid" and _is_number(s.value) and _is_number(s.t_ms)


def _is_number(v: object) -> bool:
    return isinstance(v, (int, float)) and not isinstance(v, bool) and math.isfinite(v)


def smooth_trace(
    samples: Sequence[AngleSample],
    *,
    half_window: int = SMOOTHING["halfWindowSamples"],
    max_neighbor_offset_ms: float = SMOOTHING["maxNeighborOffsetMs"],
) -> list[SmoothedSample]:
    n = len(samples)

    def usable(j: int, center: AngleSample) -> bool:
        if not (0 <= j < n):
            return False
        s = samples[j]
        assert center.t_ms is not None
        return _is_valid(s) and abs(s.t_ms - center.t_ms) <= max_neighbor_offset_ms  # type: ignore[operator]

    out: list[SmoothedSample] = []
    for i, s in enumerate(samples):
        if not _is_valid(s):
            out.append(
                SmoothedSample(
                    s.t_ms if s is not None else None, None, None, s.state if s is not None and s.state else "malformed"
                )
            )
            continue
        assert s.value is not None
        window: list[float] = [s.value]
        for k in range(1, half_window + 1):
            if usable(i - k, s) and usable(i + k, s):
                left = samples[i - k].value
                right = samples[i + k].value
                assert left is not None and right is not None
                window.extend((left, right))
        out.append(SmoothedSample(s.t_ms, s.value, median(window), "valid"))
    return out
