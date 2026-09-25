"""Normalized skeleton ``normalized-skeleton-v0.1``.

Purpose: reduce dependence on frame dimensions, image position and camera
scale so that skeleton trajectories from different research captures can be
compared — WITHOUT pretending to recover physical-world coordinates.

One similarity transform per assessment (never per frame):

    reference frames  the calibration-window frames that M6 calibration
                      counts as usable (full body in frame and a valid knee
                      angle on the analysis side)
    origin O          component-wise median, over the reference frames, of
                      the hip centre = midpoint(left_hip, right_hip)
                      (image pixels). At least 8 reference frames with both
                      hip landmarks are required.
    scale  s          median, over the reference frames, of the distance from
                      the nose to the analysis-side ankle (image pixels) —
                      exactly M6's "apparent standing height" (standingHeightPx).
    facing            sign of the median, over the reference frames, of
                      (analysis-side foot_index.x − heel.x); requires ≥ 8
                      frames with both points in frame. "positive_x" or
                      "negative_x"; "undetermined" if unavailable or zero.
    mirror m          −1 when facing is "negative_x" (the skeleton is
                      reflected so that the subject faces +x), else +1.

    x_n = m · (x − O.x) / s          y_n = (O.y − y) / s

  * +y points UP (opposite to image rows), +x is the subject's facing
    direction when canonicalised, the origin is the STANDING hip centre.
  * Because O and s are fixed for the whole assessment, real movement is
    preserved: the hip descends during the squat (y_n of the hips goes
    negative) instead of being re-centred away frame by frame.
  * A similarity transform preserves included angles, so apparent 2D joint
    angles computed from normalized coordinates equal those computed from
    pixels (up to floating-point rounding). Kinematic features are computed
    from the pixel coordinates, exactly as in M6.
  * Mirroring never changes anatomical labels: "left_knee" stays the
    subject's left knee; ``analysis_side`` is recorded unchanged and
    ``mirror_applied`` records the reflection.
  * Missing landmarks stay missing (null); visibility and in-frame flags are
    copied unchanged. No bad frame ever becomes a zero coordinate.

What this is NOT: normalized coordinates are dimensionless image-space
research coordinates in units of the standing apparent nose-to-ankle height.
They are not metres or centimetres, not 3D, not limb-length measurements,
not physical scale, and not individual anthropometrics.
"""

from __future__ import annotations

import math
from collections.abc import Sequence
from dataclasses import dataclass
from typing import Any, Final, Literal

from physiq_research.domain.calibration import CALIBRATION, Calibration, full_body_in_frame
from physiq_research.domain.geometry import Point, distance, median, midpoint
from physiq_research.domain.kinematics import KNEE, angle_sample
from physiq_research.domain.pose_frame import LANDMARK_NAMES, Landmark, PoseFrame, side_landmark_name

Facing = Literal["positive_x", "negative_x", "undetermined"]

SKELETON_PARAMETERS: Final[dict[str, Any]] = {
    "reference_frames": "calibration_window_usable_frames",
    "origin": "median_hip_centre_px",
    "scale": "median_nose_to_analysis_side_ankle_px",
    "facing": "sign_of_median_analysis_side_toe_minus_heel_x",
    "min_reference_frames": CALIBRATION["minFrames"],
    "min_scale_px": 1.0,
    "vertical_axis": "up",
    "unit": "standing_apparent_nose_to_ankle_image_height",
}


class SkeletonReferenceUnavailable(ValueError):
    """The calibration window cannot define the normalization."""

    def __init__(self, detail: str) -> None:
        super().__init__(detail)
        self.detail = detail


@dataclass(frozen=True, slots=True)
class SkeletonTransform:
    origin: Point
    scale_px: float
    facing: Facing
    mirror_applied: bool
    reference_frame_count: int
    hip_centre_samples: int
    facing_samples: int

    @property
    def mirror(self) -> float:
        return -1.0 if self.mirror_applied else 1.0

    def apply(self, lm: Landmark | None) -> Landmark | None:
        if lm is None:
            return None
        x = self.mirror * (lm.x - self.origin.x) / self.scale_px
        y = (self.origin.y - lm.y) / self.scale_px
        if not (math.isfinite(x) and math.isfinite(y)):
            return None
        return Landmark(x=x, y=y, visibility=lm.visibility, in_frame=lm.in_frame)


def reference_frames(calibration_window: Sequence[PoseFrame], side: str) -> list[PoseFrame]:
    """Calibration frames M6 counts as usable (full body + valid knee angle)."""
    return [
        f for f in calibration_window if full_body_in_frame(f, side) and angle_sample(f, side, KNEE).state == "valid"
    ]


def derive_transform(calibration: Calibration, calibration_window: Sequence[PoseFrame]) -> SkeletonTransform:
    if not calibration.complete or not calibration.side:
        raise SkeletonReferenceUnavailable("calibration_incomplete")
    side = calibration.side
    refs = reference_frames(calibration_window, side)
    min_frames = SKELETON_PARAMETERS["min_reference_frames"]

    hip_centres = [midpoint(f.landmarks.get("left_hip"), f.landmarks.get("right_hip")) for f in refs]
    centres = [c for c in hip_centres if c is not None]
    if len(centres) < min_frames:
        raise SkeletonReferenceUnavailable("hip_centre_unavailable")
    ox = median(c.x for c in centres)
    oy = median(c.y for c in centres)

    ankle = side_landmark_name(side, "ankle")
    heights = [distance(f.landmarks.get("nose"), f.landmarks.get(ankle)) for f in refs]
    scale = median(heights)
    if scale is None or not math.isfinite(scale) or scale < SKELETON_PARAMETERS["min_scale_px"]:
        raise SkeletonReferenceUnavailable("scale_unavailable")

    heel = side_landmark_name(side, "heel")
    toe = side_landmark_name(side, "foot_index")
    directions = []
    for f in refs:
        h = f.landmarks.get(heel)
        t = f.landmarks.get(toe)
        if h is not None and t is not None and h.in_frame and t.in_frame:
            directions.append(t.x - h.x)
    facing: Facing = "undetermined"
    if len(directions) >= min_frames:
        d = median(directions)
        if d is not None and d > 0:
            facing = "positive_x"
        elif d is not None and d < 0:
            facing = "negative_x"
    assert ox is not None and oy is not None
    return SkeletonTransform(
        origin=Point(ox, oy),
        scale_px=scale,
        facing=facing,
        mirror_applied=facing == "negative_x",
        reference_frame_count=len(refs),
        hip_centre_samples=len(centres),
        facing_samples=len(directions),
    )


def normalize_frame(frame: PoseFrame, transform: SkeletonTransform) -> dict[str, Landmark | None]:
    if frame.status != "pose":
        return dict.fromkeys(LANDMARK_NAMES)
    return {name: transform.apply(frame.landmarks.get(name)) for name in LANDMARK_NAMES}


def transform_description(transform: SkeletonTransform) -> dict[str, Any]:
    return {
        "origin_px": {"x": transform.origin.x, "y": transform.origin.y},
        "scale_px": transform.scale_px,
        "facing_in_image": transform.facing,
        "mirror_applied": transform.mirror_applied,
        "reference_frame_count": transform.reference_frame_count,
        "hip_centre_samples": transform.hip_centre_samples,
        "facing_samples": transform.facing_samples,
    }
