"""Standing calibration (port of calibration.js).

The most recent ``windowMs`` of pose frames is evaluated as one block; the
calibration completes the first time every check passes. It establishes
ONLY the analysis side, the standing reference knee angle (median raw knee
angle), the standing reference trunk–thigh angle (when ≥ 8 valid samples),
and image-space framing references (apparent nose-to-ankle height in pixels,
ankle position) used by capture quality and by the normalized skeleton's
scale. It does NOT establish limb lengths, camera distance or any physical
scale. Every threshold is an ALGORITHMIC DETECTION PARAMETER, not a health,
mobility or form standard.
"""

from __future__ import annotations

import math
from collections.abc import Sequence
from dataclasses import dataclass
from typing import Any, Final

from physiq_research.domain.geometry import Point, distance, median, midpoint
from physiq_research.domain.kinematics import KNEE, TRUNK_THIGH, angle_sample, build_angle_trace, valid_values
from physiq_research.domain.pose_frame import PoseFrame, side_landmark_name
from physiq_research.domain.side_selection import SideSelection, choose_analysis_side
from physiq_research.domain.smoothing import smooth_trace

CALIBRATION: Final[dict[str, Any]] = {
    "windowMs": 2000,
    "minSpanMs": 1700,
    "minFrames": 8,
    "minUsableFraction": 0.9,
    "maxKneeRangeDeg": 10,
    "maxHipSeparationRatio": 0.25,
}


@dataclass(frozen=True, slots=True)
class Calibration:
    state: str  # "complete" | "incomplete"
    reason: str | None = None
    progress: float = 0.0
    side: str | None = None
    side_selection: SideSelection | None = None
    reference_knee_deg: float | None = None
    reference_trunk_thigh_deg: float | None = None
    knee_range_deg: float | None = None
    hip_separation_ratio: float | None = None
    frame_count: int = 0
    usable_frames: int = 0
    span_ms: float | None = None
    frame_width: int | None = None
    frame_height: int | None = None
    standing_height_px: float | None = None
    ankle_reference: Point | None = None

    @property
    def complete(self) -> bool:
        return self.state == "complete"


def full_body_in_frame(frame: PoseFrame | None, side: str) -> bool:
    """Nose and the side's hip, knee, ankle and at least one foot point are in the image."""
    if frame is None or frame.status != "pose":
        return False
    lm = frame.landmarks

    def inside(name: str) -> bool:
        p = lm.get(name)
        return p is not None and p.in_frame

    return (
        inside("nose")
        and inside(side_landmark_name(side, "hip"))
        and inside(side_landmark_name(side, "knee"))
        and inside(side_landmark_name(side, "ankle"))
        and (inside(side_landmark_name(side, "heel")) or inside(side_landmark_name(side, "foot_index")))
    )


def hip_separation_ratio(frame: PoseFrame | None) -> float | None:
    """Hip separation ÷ torso length; coordinates regardless of visibility
    (the far hip is expected to be occluded)."""
    if frame is None or frame.status != "pose":
        return None
    lm = frame.landmarks
    hip_mid = midpoint(lm.get("left_hip"), lm.get("right_hip"))
    shoulder_mid = midpoint(lm.get("left_shoulder"), lm.get("right_shoulder"))
    torso = distance(hip_mid, shoulder_mid)
    hips = distance(lm.get("left_hip"), lm.get("right_hip"))
    if torso is None or hips is None or torso < 1:
        return None
    return hips / torso


def _incomplete(reason: str, progress: float = 0.0, **extra: Any) -> Calibration:
    return Calibration(state="incomplete", reason=reason, progress=progress, **extra)


def evaluate_calibration(frames: Sequence[PoseFrame], options: dict[str, Any] | None = None) -> Calibration:
    """``frames``: the pose frames of the last ``windowMs``, in time order."""
    opt = {**CALIBRATION, **(options or {})}
    frame_list = [f for f in frames if f is not None and f.t_ms is not None and math.isfinite(f.t_ms)]
    if not frame_list:
        return _incomplete("no_frames", 0.0)
    first_t = frame_list[0].t_ms
    last_t = frame_list[-1].t_ms
    assert first_t is not None and last_t is not None
    span = last_t - first_t
    progress = max(0.0, min(1.0, span / opt["windowMs"]))
    pose_frames = [f for f in frame_list if f.status == "pose"]

    if any(f.status == "multiple_poses" for f in frame_list):
        return _incomplete("multiple_people", 0.0)
    if not pose_frames:
        return _incomplete("no_person", 0.0)

    selection = choose_analysis_side(pose_frames)
    if selection.side is None:
        return _incomplete("no_side_visible", 0.0, side_selection=selection)
    side = selection.side

    in_frame_count = sum(1 for f in pose_frames if full_body_in_frame(f, side))
    if in_frame_count < opt["minUsableFraction"] * len(frame_list):
        return _incomplete("body_not_in_frame", 0.0, side_selection=selection)

    ratio = median(hip_separation_ratio(f) for f in pose_frames)
    if ratio is None or ratio > opt["maxHipSeparationRatio"]:
        return _incomplete("not_side_on", 0.0, side_selection=selection, hip_separation_ratio=ratio)

    knee_trace = build_angle_trace(frame_list, side, KNEE)
    usable = [f for f in frame_list if full_body_in_frame(f, side) and angle_sample(f, side, KNEE).state == "valid"]
    if len(usable) < opt["minUsableFraction"] * len(frame_list):
        return _incomplete("low_visibility", 0.0, side_selection=selection)

    smoothed_knee = valid_values(smooth_trace(knee_trace))
    knee_range = (max(smoothed_knee) - min(smoothed_knee)) if smoothed_knee else None
    if knee_range is None or knee_range > opt["maxKneeRangeDeg"]:
        return _incomplete("not_still", 0.0, side_selection=selection, knee_range_deg=knee_range)

    if span < opt["minSpanMs"] or len(usable) < opt["minFrames"]:
        return _incomplete("collecting", progress, side_selection=selection)

    trunk_values = valid_values(build_angle_trace(frame_list, side, TRUNK_THIGH))
    ankle_name = side_landmark_name(side, "ankle")
    heights = [distance(f.landmarks.get("nose"), f.landmarks.get(ankle_name)) for f in usable]
    ankle_x = [f.landmarks[ankle_name].x for f in usable]  # type: ignore[union-attr]
    ankle_y = [f.landmarks[ankle_name].y for f in usable]  # type: ignore[union-attr]
    ax = median(ankle_x)
    ay = median(ankle_y)
    return Calibration(
        state="complete",
        side=side,
        side_selection=selection,
        reference_knee_deg=median(valid_values(knee_trace)),
        reference_trunk_thigh_deg=median(trunk_values) if len(trunk_values) >= opt["minFrames"] else None,
        knee_range_deg=knee_range,
        hip_separation_ratio=ratio,
        frame_count=len(frame_list),
        usable_frames=len(usable),
        span_ms=span,
        frame_width=frame_list[-1].frame_width,
        frame_height=frame_list[-1].frame_height,
        standing_height_px=median(heights),
        ankle_reference=Point(ax, ay) if ax is not None and ay is not None else None,
    )
