"""Capture (measurement) quality (port of captureQuality.js).

Describes how trustworthy the MEASUREMENT is — never the movement.
"sufficient" does not mean good movement and "insufficient" does not mean
bad movement.

    usable_frames        share of capture frames with a valid knee angle
                         (limited < 0.8, insufficient < 0.5)
    landmark_confidence  median over valid samples of the lowest
                         hip/knee/ankle visibility (limited < 0.75)
    single_person        frames with two poses (insufficient if any)
    body_in_frame        share of pose frames with head and analysed
                         leg/foot in view (limited < 0.9)
    foot_stability       90th-percentile ankle displacement from its
                         calibration position ÷ apparent standing height
                         (limited > 0.08; camera or feet moved)
    repetition           whether one repetition was segmented
"""

from __future__ import annotations

import math
from collections.abc import Sequence
from dataclasses import dataclass
from typing import Any, Final

from physiq_research.domain.calibration import Calibration, full_body_in_frame
from physiq_research.domain.geometry import distance, median, percentile
from physiq_research.domain.jsnum import js_round_digits
from physiq_research.domain.kinematics import KNEE, angle_sample
from physiq_research.domain.pose_frame import PoseFrame, side_landmark_name
from physiq_research.domain.segmentation import Segmentation

QUALITY: Final[dict[str, Any]] = {
    "minUsableFraction": 0.8,
    "insufficientUsableFraction": 0.5,
    "minMedianVisibility": 0.75,
    "minBodyInFrameFraction": 0.9,
    "maxFootDriftFraction": 0.08,
    "footDriftPercentile": 90,
}


@dataclass(frozen=True, slots=True)
class QualityFactor:
    id: str
    state: str  # "pass" | "limited" | "insufficient"
    value: float | int | str | None  # unrounded (research precision)


@dataclass(frozen=True, slots=True)
class CaptureQuality:
    state: str  # "sufficient" | "limited" | "insufficient"
    factors: tuple[QualityFactor, ...]
    total_frames: int
    capture_duration_ms: float
    usable_frames: int
    usable_fraction: float
    median_landmark_visibility: float | None
    frame_status_counts: dict[str, int]
    body_in_frame_fraction: float
    foot_drift_fraction: float | None

    def m6_view(self, *, rounded: bool = True) -> dict[str, Any]:
        """The values rounded exactly as movement-assessment-v0.1 reports them
        (or unrounded, same structure, with ``rounded=False``)."""

        def r(v: Any, d: int) -> Any:
            if not rounded:
                return v
            return js_round_digits(v, d, no_negative_zero=False) if isinstance(v, float) else v

        digits = {"usable_frames": 3, "landmark_confidence": 3, "body_in_frame": 3, "foot_stability": 3}
        return {
            "state": self.state,
            "factors": [
                {"id": f.id, "state": f.state, "value": r(f.value, digits[f.id]) if f.id in digits else f.value}
                for f in self.factors
            ],
            "totalFrames": self.total_frames,
            "captureDurationMs": r(self.capture_duration_ms, 0),
            "usableFrames": self.usable_frames,
            "usableFraction": r(self.usable_fraction, 3),
            "medianLandmarkVisibility": r(self.median_landmark_visibility, 3),
            "frameStatusCounts": dict(self.frame_status_counts),
            "bodyInFrameFraction": r(self.body_in_frame_fraction, 3),
            "footDriftFraction": r(self.foot_drift_fraction, 3),
        }


def assess_capture_quality(
    capture_frames: Sequence[PoseFrame],
    side: str | None,
    calibration: Calibration | None,
    segmentation: Segmentation,
    options: dict[str, Any] | None = None,
) -> CaptureQuality:
    opt = {**QUALITY, **(options or {})}
    frames = list(capture_frames)
    total = len(frames)
    stamps = [f.t_ms for f in frames if f is not None and f.t_ms is not None and math.isfinite(f.t_ms)]
    capture_duration = float(stamps[-1] - stamps[0]) if len(stamps) > 1 else 0.0
    counts = {"pose": 0, "no_pose": 0, "multiple_poses": 0, "malformed": 0}
    for f in frames:
        s = f.status if f is not None else None
        counts[s if s in counts else "malformed"] += 1

    knee = [angle_sample(f, side, KNEE) for f in frames] if side else []
    valid_knee = [s for s in knee if s.state == "valid"]
    usable_fraction = len(valid_knee) / total if total > 0 else 0.0

    visibilities: list[float] = []
    ankle_name = side_landmark_name(side, "ankle") if side else None
    if side:
        for i, f in enumerate(frames):
            if knee[i].state != "valid":
                continue
            lm = f.landmarks
            hip = lm[side_landmark_name(side, "hip")]
            kn = lm[side_landmark_name(side, "knee")]
            an = lm[ankle_name]  # type: ignore[index]
            assert hip is not None and kn is not None and an is not None
            visibilities.append(min(hip.visibility, kn.visibility, an.visibility))
    median_visibility = median(visibilities)

    pose_frames = [f for f in frames if f is not None and f.status == "pose"]
    in_frame = sum(1 for f in pose_frames if full_body_in_frame(f, side)) if side else 0
    body_in_frame_fraction = in_frame / len(pose_frames) if pose_frames else 0.0

    foot_drift: float | None = None
    ref = calibration.ankle_reference if calibration is not None else None
    height = calibration.standing_height_px if calibration is not None else None
    if side and ref is not None and isinstance(height, float) and height > 0:
        drifts = []
        for f in pose_frames:
            ankle = f.landmarks.get(ankle_name) if ankle_name else None
            if ankle is not None and ankle.in_frame:
                drifts.append(distance(ankle, ref))
        p = percentile(drifts, opt["footDriftPercentile"])
        foot_drift = None if p is None else p / height

    segmented = segmentation.state == "segmented"

    def usable_state(v: float) -> str:
        if v < opt["insufficientUsableFraction"]:
            return "insufficient"
        return "limited" if v < opt["minUsableFraction"] else "pass"

    factors = (
        QualityFactor("usable_frames", usable_state(usable_fraction), usable_fraction),
        QualityFactor(
            "landmark_confidence",
            "insufficient"
            if median_visibility is None
            else ("limited" if median_visibility < opt["minMedianVisibility"] else "pass"),
            median_visibility,
        ),
        QualityFactor(
            "single_person", "insufficient" if counts["multiple_poses"] > 0 else "pass", counts["multiple_poses"]
        ),
        QualityFactor(
            "body_in_frame",
            "limited" if body_in_frame_fraction < opt["minBodyInFrameFraction"] else "pass",
            body_in_frame_fraction,
        ),
        QualityFactor(
            "foot_stability",
            "limited" if foot_drift is None or foot_drift > opt["maxFootDriftFraction"] else "pass",
            foot_drift,
        ),
        QualityFactor(
            "repetition",
            "pass" if segmented else "insufficient",
            "one_repetition" if segmented else (segmentation.reason or "not_segmented"),
        ),
    )
    state = "sufficient"
    if any(f.state == "insufficient" for f in factors):
        state = "insufficient"
    elif any(f.state == "limited" for f in factors):
        state = "limited"

    return CaptureQuality(
        state=state,
        factors=factors,
        total_frames=total,
        capture_duration_ms=capture_duration,
        usable_frames=len(valid_knee),
        usable_fraction=usable_fraction,
        median_landmark_visibility=median_visibility,
        frame_status_counts=counts,
        body_in_frame_fraction=body_in_frame_fraction,
        foot_drift_fraction=foot_drift,
    )
