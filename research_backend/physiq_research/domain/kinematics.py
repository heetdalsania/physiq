"""Apparent 2D joint-angle definitions and traces (port of kinematics.js).

    knee         hip → knee → ankle      vertex knee. 180° = straight leg in
                                         the image; smaller = more flexion.
    trunk_thigh  shoulder → hip → knee   vertex hip. Combines hip flexion
                                         with trunk and pelvic motion; NOT
                                         hip flexion and never labelled so.

Both are measured on ONE side (the frozen analysis side). An angle exists
only when all three landmarks are individually valid; otherwise the sample
records why it is unavailable.
"""

from __future__ import annotations

import math
from collections.abc import Iterable, Sequence
from dataclasses import dataclass
from typing import Final, Literal

from physiq_research.domain.geometry import included_angle_deg
from physiq_research.domain.pose_frame import PoseFrame, landmark_state, side_landmark_name

SampleState = Literal[
    "valid",
    "no_pose",
    "multiple_poses",
    "malformed",
    "missing",
    "out_of_frame",
    "low_confidence",
    "degenerate",
]
SAMPLE_STATES: Final = (
    "valid",
    "no_pose",
    "multiple_poses",
    "malformed",
    "missing",
    "out_of_frame",
    "low_confidence",
    "degenerate",
)


@dataclass(frozen=True, slots=True)
class AngleDefinition:
    id: str
    label: str
    points: tuple[str, str, str]
    formula: str


KNEE: Final = AngleDefinition(
    id="knee",
    label="Apparent 2D knee angle",
    points=("hip", "knee", "ankle"),
    formula="included angle at the knee landmark between the hip and ankle landmarks",
)
TRUNK_THIGH: Final = AngleDefinition(
    id="trunk_thigh",
    label="Apparent 2D trunk–thigh angle",
    points=("shoulder", "hip", "knee"),
    formula="included angle at the hip landmark between the shoulder and knee landmarks",
)

# First failing reason wins; frame-level problems outrank landmark-level ones.
_LANDMARK_FAILURE_ORDER: Final = ("missing", "out_of_frame", "low_confidence")


@dataclass(frozen=True, slots=True)
class AngleSample:
    t_ms: float | None
    value: float | None
    state: str


def angle_sample(frame: PoseFrame | None, side: str, definition: AngleDefinition) -> AngleSample:
    t_ms = frame.t_ms if frame is not None and frame.t_ms is not None and math.isfinite(frame.t_ms) else None
    if frame is None or frame.status != "pose":
        state = frame.status if frame is not None and frame.status else "malformed"
        return AngleSample(t_ms, None, state)
    points = [frame.landmarks.get(side_landmark_name(side, part)) for part in definition.points]
    states = [landmark_state(p) for p in points]
    for reason in _LANDMARK_FAILURE_ORDER:
        if reason in states:
            return AngleSample(t_ms, None, reason)
    value = included_angle_deg(points[0], points[1], points[2])
    if value is None:
        return AngleSample(t_ms, None, "degenerate")
    return AngleSample(t_ms, value, "valid")


def build_angle_trace(frames: Iterable[PoseFrame], side: str, definition: AngleDefinition) -> list[AngleSample]:
    """Frames → time-ordered samples. Frames without a finite timestamp, or
    whose timestamp does not strictly increase, cannot be placed on a time
    axis and are dropped."""
    out: list[AngleSample] = []
    last_t = -math.inf
    for frame in frames:
        s = angle_sample(frame, side, definition)
        if s.t_ms is None or not (s.t_ms > last_t):
            continue
        last_t = s.t_ms
        out.append(s)
    return out


def valid_values(samples: Sequence[object], key: str = "value") -> list[float]:
    out: list[float] = []
    for s in samples:
        v = getattr(s, key, None)
        if isinstance(v, (int, float)) and not isinstance(v, bool) and math.isfinite(v):
            out.append(float(v))
    return out
