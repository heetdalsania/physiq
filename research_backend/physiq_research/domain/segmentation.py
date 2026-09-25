"""Single-squat segmentation (port of squatSegmentation.js).

Input: the SMOOTHED knee-angle trace of the capture window and the standing
reference knee angle R. Deterministic:

  1. ≥ 10 valid samples, else ``insufficient_valid_frames``.
  2. Deepest point: smallest angle A_min, EARLIEST on ties (a bottom pause
     counts in the ascent).
  3. Excursion E = R − A_min; E < 20° → ``no_clear_repetition`` (a detection
     floor, not a depth standard).
  4. Phase threshold T = R − 0.1·E.
  5. Descent start: walking back from the deepest point, the first valid
     sample ≥ T; time = linear interpolation of the T-crossing between it
     and the next valid sample. None → ``repetition_started_before_capture``.
  6. Ascent end: walking forward, the first valid sample ≥ T, interpolated
     the same way. None → ``did_not_return_to_standing``.
  7. Any valid sample outside [start, end] at or below R − 0.5·E →
     ``multiple_repetitions`` (never averaged, never chosen between).
  8. Steps between consecutive valid samples from the sample before the
     start to the sample after the end must be ≤ 300 ms
     (``data_gap_during_repetition``) and ≥ 8 valid samples must lie strictly
     inside the repetition (``too_few_samples_in_repetition``).

All times are media times (ms) from the pose frames — never wall-clock.
"""

from __future__ import annotations

import math
from collections.abc import Sequence
from dataclasses import dataclass, field
from typing import Any, Final

from physiq_research.domain.smoothing import SmoothedSample

SEGMENTATION: Final[dict[str, Any]] = {
    "minCaptureValidSamples": 10,
    "minExcursionDeg": 20,
    "phaseThresholdFraction": 0.1,
    "secondRepFraction": 0.5,
    "maxGapMs": 300,
    "minRepSamples": 8,
}


@dataclass(frozen=True, slots=True)
class Segmentation:
    state: str  # "segmented" | "insufficient"
    reason: str | None = None
    reference_deg: float | None = None
    minimum_deg: float | None = None
    excursion_deg: float | None = None
    threshold_deg: float | None = None
    descent_start_ms: float | None = None
    deepest_ms: float | None = None
    ascent_end_ms: float | None = None
    descent_ms: float | None = None
    ascent_ms: float | None = None
    total_ms: float | None = None
    rep_samples: int | None = None
    max_gap_ms: float | None = None
    valid_samples: int | None = None
    extra: dict[str, Any] = field(default_factory=dict)

    @property
    def segmented(self) -> bool:
        return self.state == "segmented"


def _is_valid(s: SmoothedSample) -> bool:
    return (
        s is not None
        and isinstance(s.value, (int, float))
        and not isinstance(s.value, bool)
        and math.isfinite(s.value)
        and isinstance(s.t_ms, (int, float))
        and math.isfinite(s.t_ms)
    )


def _fail(reason: str, **extra: Any) -> Segmentation:
    return Segmentation(state="insufficient", reason=reason, **extra)


def crossing_time(t0: float, v0: float, t1: float, v1: float, level: float) -> float:
    """Time at which the line (t0, v0)–(t1, v1) reaches ``level``."""
    if v0 == v1:
        return t0
    f = (level - v0) / (v1 - v0)
    return t0 + max(0.0, min(1.0, f)) * (t1 - t0)


def segment_single_squat(
    smoothed: Sequence[SmoothedSample], reference_deg: float | None, options: dict[str, Any] | None = None
) -> Segmentation:
    opt = {**SEGMENTATION, **(options or {})}
    if (
        not isinstance(reference_deg, (int, float))
        or isinstance(reference_deg, bool)
        or not math.isfinite(reference_deg)
    ):
        return _fail("no_reference")

    valid = [s for s in smoothed if _is_valid(s)]
    if len(valid) < opt["minCaptureValidSamples"]:
        return _fail("insufficient_valid_frames", valid_samples=len(valid))

    values = [float(s.value) for s in valid]  # type: ignore[arg-type]
    times = [float(s.t_ms) for s in valid]  # type: ignore[arg-type]
    min_idx = 0
    for i in range(1, len(valid)):
        if values[i] < values[min_idx]:
            min_idx = i
    minimum = values[min_idx]
    excursion = reference_deg - minimum
    if not (excursion >= opt["minExcursionDeg"]):
        return _fail("no_clear_repetition", excursion_deg=excursion, valid_samples=len(valid))

    threshold = reference_deg - opt["phaseThresholdFraction"] * excursion

    before = -1
    for k in range(min_idx - 1, -1, -1):
        if values[k] >= threshold:
            before = k
            break
    if before < 0:
        return _fail("repetition_started_before_capture", excursion_deg=excursion, valid_samples=len(valid))

    after = -1
    for k in range(min_idx + 1, len(valid)):
        if values[k] >= threshold:
            after = k
            break
    if after < 0:
        return _fail("did_not_return_to_standing", excursion_deg=excursion, valid_samples=len(valid))

    descent_start = crossing_time(times[before], values[before], times[before + 1], values[before + 1], threshold)
    ascent_end = crossing_time(times[after - 1], values[after - 1], times[after], values[after], threshold)
    deepest = times[min_idx]

    second_rep_level = reference_deg - opt["secondRepFraction"] * excursion
    outside_dip = any(
        (times[i] < descent_start or times[i] > ascent_end) and values[i] <= second_rep_level for i in range(len(valid))
    )
    if outside_dip:
        return _fail("multiple_repetitions", excursion_deg=excursion, valid_samples=len(valid))

    max_gap = 0.0
    for k in range(before + 1, after + 1):
        max_gap = max(max_gap, times[k] - times[k - 1])
    if max_gap > opt["maxGapMs"]:
        return _fail(
            "data_gap_during_repetition", excursion_deg=excursion, max_gap_ms=max_gap, valid_samples=len(valid)
        )

    inside = sum(1 for t in times if descent_start < t < ascent_end)
    if inside < opt["minRepSamples"]:
        return _fail(
            "too_few_samples_in_repetition", excursion_deg=excursion, rep_samples=inside, valid_samples=len(valid)
        )

    descent = deepest - descent_start
    ascent = ascent_end - deepest
    total = ascent_end - descent_start
    if not all(math.isfinite(d) and d >= 0 for d in (descent, ascent, total)):
        return _fail("invalid_timing", valid_samples=len(valid))

    return Segmentation(
        state="segmented",
        reference_deg=float(reference_deg),
        minimum_deg=minimum,
        excursion_deg=excursion,
        threshold_deg=threshold,
        descent_start_ms=descent_start,
        deepest_ms=deepest,
        ascent_end_ms=ascent_end,
        descent_ms=descent,
        ascent_ms=ascent,
        total_ms=total,
        rep_samples=inside,
        max_gap_ms=max_gap,
        valid_samples=len(valid),
    )
