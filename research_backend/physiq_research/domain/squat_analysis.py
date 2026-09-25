"""Bodyweight squat (sagittal) analysis (port of squatAssessment.js).

Pure: calibration + capture pose frames → analysis. Definitions (identical
to movement-assessment-v0.1 / squat-kinematics-v0.2):

    apparent 2D knee ROM (°)      = R_knee − min(smoothed knee angle in the
                                    detected repetition)
    apparent 2D trunk–thigh change = R_trunk − min(smoothed trunk–thigh angle
                                    between descent start and ascent end);
                                    only when ≥ 80% (and ≥ 8) of those samples
                                    are valid and a standing reference exists
    descent = deepest − descent start; ascent = ascent end − deepest;
    total = ascent end − descent start (media ms)
    symmetry: never estimated from one sagittal view

Values are kept at full double precision here. ``m6_view`` reproduces the
on-device result's rounding (0.1° for angles, 1 ms for times) only so that
the two implementations can be compared field by field; rounding is
presentation, not a change of semantics.
"""

from __future__ import annotations

from collections.abc import Sequence
from dataclasses import dataclass
from typing import Any, Final

from physiq_research.domain.calibration import CALIBRATION, Calibration
from physiq_research.domain.capture_quality import QUALITY, CaptureQuality, assess_capture_quality
from physiq_research.domain.jsnum import js_round_digits
from physiq_research.domain.kinematics import KNEE, TRUNK_THIGH, build_angle_trace
from physiq_research.domain.pose_frame import LANDMARK_MIN_VISIBILITY, PoseFrame
from physiq_research.domain.segmentation import SEGMENTATION, Segmentation, segment_single_squat
from physiq_research.domain.smoothing import SMOOTHING, SmoothedSample, smooth_trace
from physiq_research.versions import CAPTURE_MODE_SINGLE_CAMERA_SAGITTAL

# Capture protocol (squat-kinematics-v0.2). In the research pipeline the
# durations are MEDIA time, measured on the frames' presentation timestamps.
CAPTURE: Final[dict[str, Any]] = {
    "maxDurationMs": 10000,
    "postRepetitionHoldMs": 1000,
    "positioningTimeoutMs": 45000,
    "minInferenceIntervalMs": 66,
}
TRUNK_THIGH_MIN_COVERAGE: Final = 0.8

SYMMETRY_UNAVAILABLE: Final[dict[str, str]] = {
    "state": "unavailable_for_capture_mode",
    "captureMode": CAPTURE_MODE_SINGLE_CAMERA_SAGITTAL,
    "reason": "single_sagittal_view",
}


def m6_parameters() -> dict[str, Any]:
    """Every algorithm parameter of squat-kinematics-v0.2, M6 key names."""
    return {
        "landmarkMinVisibility": LANDMARK_MIN_VISIBILITY,
        "smoothing": dict(SMOOTHING),
        "calibration": dict(CALIBRATION),
        "segmentation": dict(SEGMENTATION),
        "quality": dict(QUALITY),
        "capture": dict(CAPTURE),
        "trunkThighMinCoverage": TRUNK_THIGH_MIN_COVERAGE,
    }


@dataclass(frozen=True, slots=True)
class TrunkThighMetric:
    state: str  # "available" | "unavailable"
    reason: str | None = None
    value_deg: float | None = None
    reference_deg: float | None = None
    minimum_deg: float | None = None
    samples_in_repetition: int = 0
    valid_in_repetition: int = 0


@dataclass(frozen=True, slots=True)
class SquatAnalysis:
    status: str  # "complete" | "insufficient_data"
    insufficient_reason: str | None
    analysis_side: str | None
    calibration: Calibration | None
    segmentation: Segmentation
    quality: CaptureQuality
    knee_trace: tuple[SmoothedSample, ...]
    trunk_thigh_trace: tuple[SmoothedSample, ...]
    trunk_thigh: TrunkThighMetric
    trace_origin_ms: float

    @property
    def complete(self) -> bool:
        return self.status == "complete"

    def m6_view(self, *, rounded: bool = True) -> dict[str, Any]:
        """Shared fields in the movement-assessment-v0.1 shape.

        ``rounded=True`` rounds exactly like the on-device result (0.1° / 1 ms,
        JavaScript half-up rounding); ``rounded=False`` gives the same
        structure unrounded (used to recognise rounding-boundary ties).
        """

        def r1(v: float | None) -> float | None:
            return js_round_digits(v, 1, no_negative_zero=True) if rounded else v

        def r0(v: float | None) -> float | None:
            return js_round_digits(v, 0, no_negative_zero=True) if rounded else v

        cal = self.calibration
        if cal is None or not cal.complete or not cal.side:
            reason = "calibration_incomplete"
            return {
                "status": "insufficient_data",
                "insufficientReason": reason,
                "analysisSide": None,
                "reference": None,
                "metrics": _unavailable_metrics(reason),
                "events": None,
                "traces": None,
                "quality": self.quality.m6_view(rounded=rounded),
            }
        reference = {
            "kneeDeg": r1(cal.reference_knee_deg),
            "trunkThighDeg": r1(cal.reference_trunk_thigh_deg),
            "calibrationFrames": cal.usable_frames,
            "calibrationSpanMs": r0(cal.span_ms),
        }
        if not self.complete:
            reason = self.insufficient_reason or "not_segmented"
            return {
                "status": "insufficient_data",
                "insufficientReason": reason,
                "analysisSide": self.analysis_side,
                "reference": reference,
                "metrics": _unavailable_metrics(reason),
                "events": None,
                "traces": None,
                "quality": self.quality.m6_view(rounded=rounded),
            }
        seg = self.segmentation
        origin = self.trace_origin_ms
        tt = self.trunk_thigh
        trunk_metric: dict[str, Any] = (
            {
                "state": "available",
                "valueDeg": r1(tt.value_deg),
                "referenceDeg": r1(tt.reference_deg),
                "minimumDeg": r1(tt.minimum_deg),
            }
            if tt.state == "available"
            else {"state": "unavailable", "reason": tt.reason}
        )

        def rebase(samples: Sequence[SmoothedSample]) -> list[dict[str, Any]]:
            return [
                {
                    "tMs": r0(s.t_ms - origin) if s.t_ms is not None else None,
                    "value": r1(s.value),
                    "raw": r1(s.raw),
                    "state": s.state,
                }
                for s in samples
            ]

        assert seg.descent_start_ms is not None and seg.deepest_ms is not None and seg.ascent_end_ms is not None
        return {
            "status": "complete",
            "insufficientReason": None,
            "analysisSide": self.analysis_side,
            "reference": reference,
            "metrics": {
                "kneeRom": {
                    "state": "available",
                    "valueDeg": r1(seg.excursion_deg),
                    "referenceDeg": r1(seg.reference_deg),
                    "minimumDeg": r1(seg.minimum_deg),
                },
                "trunkThighChange": trunk_metric,
                "timing": {
                    "state": "available",
                    "descentMs": r0(seg.descent_ms),
                    "ascentMs": r0(seg.ascent_ms),
                    "totalMs": r0(seg.total_ms),
                },
                "symmetry": dict(SYMMETRY_UNAVAILABLE),
            },
            "events": {
                "descentStartMs": r0(seg.descent_start_ms - origin),
                "deepestMs": r0(seg.deepest_ms - origin),
                "ascentEndMs": r0(seg.ascent_end_ms - origin),
            },
            "traces": {"knee": rebase(self.knee_trace), "trunkThigh": rebase(self.trunk_thigh_trace)},
            "quality": self.quality.m6_view(rounded=rounded),
        }


def _unavailable_metrics(reason: str) -> dict[str, Any]:
    return {
        "kneeRom": {"state": "unavailable", "reason": reason},
        "trunkThighChange": {"state": "unavailable", "reason": reason},
        "timing": {"state": "unavailable", "reason": reason},
        "symmetry": dict(SYMMETRY_UNAVAILABLE),
    }


def trunk_thigh_metric(
    trace: Sequence[SmoothedSample], calibration: Calibration, segmentation: Segmentation
) -> TrunkThighMetric:
    if not isinstance(calibration.reference_trunk_thigh_deg, float):
        return TrunkThighMetric(state="unavailable", reason="no_standing_reference")
    start = segmentation.descent_start_ms
    end = segmentation.ascent_end_ms
    assert start is not None and end is not None
    in_rep = [s for s in trace if s.t_ms is not None and start <= s.t_ms <= end]
    valid = [s for s in in_rep if isinstance(s.value, float)]
    if not in_rep or len(valid) / len(in_rep) < TRUNK_THIGH_MIN_COVERAGE or len(valid) < SEGMENTATION["minRepSamples"]:
        return TrunkThighMetric(
            state="unavailable",
            reason="insufficient_landmark_quality",
            samples_in_repetition=len(in_rep),
            valid_in_repetition=len(valid),
        )
    minimum = min(s.value for s in valid)  # type: ignore[type-var]
    assert minimum is not None
    return TrunkThighMetric(
        state="available",
        value_deg=calibration.reference_trunk_thigh_deg - minimum,
        reference_deg=calibration.reference_trunk_thigh_deg,
        minimum_deg=minimum,
        samples_in_repetition=len(in_rep),
        valid_in_repetition=len(valid),
    )


def analyze_squat_capture(calibration: Calibration | None, capture_frames: Sequence[PoseFrame]) -> SquatAnalysis:
    frames = list(capture_frames)
    if calibration is None or not calibration.complete or not calibration.side:
        seg = Segmentation(state="insufficient", reason="calibration_incomplete")
        return SquatAnalysis(
            status="insufficient_data",
            insufficient_reason="calibration_incomplete",
            analysis_side=None,
            calibration=calibration,
            segmentation=seg,
            quality=assess_capture_quality(frames, None, None, seg),
            knee_trace=(),
            trunk_thigh_trace=(),
            trunk_thigh=TrunkThighMetric(state="unavailable", reason="calibration_incomplete"),
            trace_origin_ms=0.0,
        )

    side = calibration.side
    knee = smooth_trace(build_angle_trace(frames, side, KNEE))
    trunk = smooth_trace(build_angle_trace(frames, side, TRUNK_THIGH))
    segmentation = segment_single_squat(knee, calibration.reference_knee_deg)
    quality = assess_capture_quality(frames, side, calibration, segmentation)
    origin = float(knee[0].t_ms) if knee and knee[0].t_ms is not None else 0.0

    segmented = segmentation.segmented
    if not segmented or quality.state == "insufficient":
        if quality.frame_status_counts["multiple_poses"] > 0:
            reason = "multiple_people_during_capture"
        elif segmented:
            reason = "insufficient_capture_quality"
        else:
            reason = segmentation.reason or "not_segmented"
        return SquatAnalysis(
            status="insufficient_data",
            insufficient_reason=reason,
            analysis_side=side,
            calibration=calibration,
            segmentation=segmentation,
            quality=quality,
            knee_trace=tuple(knee),
            trunk_thigh_trace=tuple(trunk),
            trunk_thigh=TrunkThighMetric(state="unavailable", reason=reason),
            trace_origin_ms=origin,
        )

    return SquatAnalysis(
        status="complete",
        insufficient_reason=None,
        analysis_side=side,
        calibration=calibration,
        segmentation=segmentation,
        quality=quality,
        knee_trace=tuple(knee),
        trunk_thigh_trace=tuple(trunk),
        trunk_thigh=trunk_thigh_metric(trunk, calibration, segmentation),
        trace_origin_ms=origin,
    )


def repetition_finished(capture_frames: Sequence[PoseFrame], calibration: Calibration | None) -> bool:
    """During capture: one repetition segmented and ≥ postRepetitionHoldMs of
    frames after its end (media time)."""
    if calibration is None or not calibration.complete or not calibration.side:
        return False
    if not capture_frames:
        return False
    knee = smooth_trace(build_angle_trace(capture_frames, calibration.side, KNEE))
    seg = segment_single_squat(knee, calibration.reference_knee_deg)
    if not seg.segmented:
        return False
    last_t = capture_frames[-1].t_ms
    assert seg.ascent_end_ms is not None
    return last_t is not None and last_t - seg.ascent_end_ms >= CAPTURE["postRepetitionHoldMs"]
