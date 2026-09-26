"""Analysis-side selection (port of sideSelection.js).

Chosen ONCE from the calibration frames, then frozen:
  1. only single-pose ("pose") frames take part;
  2. per frame and side, the side's value is the LOWEST visibility among that
     side's hip, knee and ankle (missing or out-of-frame scores 0);
  3. each side's score is the median over those frames;
  4. higher median wins; equal medians → higher mean (summed in sorted
     order); still equal → "left" by documented convention;
  5. if the winning median is below the landmark gate, no side is chosen.
"""

from __future__ import annotations

from collections.abc import Iterable
from dataclasses import dataclass
from typing import Final

from physiq_research.domain.geometry import mean, median
from physiq_research.domain.pose_frame import LANDMARK_MIN_VISIBILITY, PoseFrame, side_landmark_name

SIDES: Final = ("left", "right")
SIDE_REQUIRED_PARTS: Final = ("hip", "knee", "ankle")
TIE_EPSILON: Final = 1e-12
SIDE_RULE: Final = "median_min_visibility_hip_knee_ankle"


@dataclass(frozen=True, slots=True)
class SideSelection:
    rule: str
    frame_count: int
    left_median: float | None
    right_median: float | None
    left_mean: float | None
    right_mean: float | None
    tie_break: str | None
    side: str | None
    reason: str | None


def side_visibility(frame: PoseFrame | None, side: str) -> float | None:
    if frame is None or frame.status != "pose":
        return None
    lowest = 1.0
    for part in SIDE_REQUIRED_PARTS:
        lm = frame.landmarks.get(side_landmark_name(side, part))
        v = lm.visibility if lm is not None and lm.in_frame else 0.0
        lowest = min(lowest, v)
    return lowest


def choose_analysis_side(frames: Iterable[PoseFrame]) -> SideSelection:
    per_side: dict[str, list[float]] = {"left": [], "right": []}
    for f in frames:
        for side in SIDES:
            s = side_visibility(f, side)
            if s is not None:
                per_side[side].append(s)
    left_median = median(per_side["left"])
    right_median = median(per_side["right"])
    left_mean = mean(per_side["left"])
    right_mean = mean(per_side["right"])
    frame_count = len(per_side["left"])

    def result(side: str | None, tie_break: str | None, reason: str | None) -> SideSelection:
        return SideSelection(
            rule=SIDE_RULE,
            frame_count=frame_count,
            left_median=left_median,
            right_median=right_median,
            left_mean=left_mean,
            right_mean=right_mean,
            tie_break=tie_break,
            side=side,
            reason=reason,
        )

    if frame_count == 0:
        return result(None, None, "no_pose_frames")
    assert left_median is not None and right_median is not None
    assert left_mean is not None and right_mean is not None
    tie_break: str | None = None
    d_median = left_median - right_median
    if abs(d_median) > TIE_EPSILON:
        side = "left" if d_median > 0 else "right"
    else:
        d_mean = left_mean - right_mean
        if abs(d_mean) > TIE_EPSILON:
            side = "left" if d_mean > 0 else "right"
            tie_break = "mean"
        else:
            side = "left"
            tie_break = "left_by_convention"
    winning = left_median if side == "left" else right_median
    if winning < LANDMARK_MIN_VISIBILITY:
        return result(None, tie_break, "insufficient_visibility")
    return result(side, tie_break, None)
