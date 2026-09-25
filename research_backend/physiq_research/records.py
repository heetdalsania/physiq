"""Validated schemas of every stored research artifact and summary.

Every structured artifact carries ``schema_version`` and is validated with
these models both BEFORE it is written and AFTER it is read back (with its
content digest), so a malformed or tampered stored value is rejected rather
than served. Validation enforces finite numbers (no NaN/Infinity), valid
enums, bounded counts, angle ranges and timestamp ordering.

Scientific restraint applies to internal outputs too: there is no score,
grade, risk, readiness, capacity, force, load, moment or injury field in any
model (tests/test_privacy_boundaries.py enumerates every key).
"""

from __future__ import annotations

import itertools
from typing import Annotated, Any, Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator

from physiq_research.domain.kinematics import SAMPLE_STATES
from physiq_research.domain.pose_frame import LANDMARK_NAMES, POSE_STATUSES
from physiq_research.versions import (
    FAILURE_DIAGNOSTICS_SCHEMA,
    KINEMATIC_FEATURES_VERSION,
    KINEMATIC_TRACES_SCHEMA,
    NORMALIZED_SKELETON_SCHEMA,
    NORMALIZED_SKELETON_VERSION,
    POSE_FRAME_CONTRACT,
    POSE_SERIES_SCHEMA,
    SUMMARY_SCHEMA,
    TIME_NORMALIZATION_VERSION,
    TIME_NORMALIZED_TRACES_SCHEMA,
)

# Hard schema ceilings (processing limits are lower; see config.MediaLimits).
MAX_SERIES_FRAMES = 10_000
MAX_TRACE_SAMPLES = 10_000

Finite = Annotated[float, Field(allow_inf_nan=False)]
NonNegative = Annotated[float, Field(allow_inf_nan=False, ge=0)]
Probability = Annotated[float, Field(allow_inf_nan=False, ge=0, le=1)]
AngleDeg = Annotated[float, Field(allow_inf_nan=False, ge=0, le=180)]
Count = Annotated[int, Field(ge=0, le=10_000_000)]
Side = Literal["left", "right"]
PoseStatus = Literal["pose", "no_pose", "multiple_poses", "malformed"]
FramePhase = Literal["positioning", "calibration_window", "capture", "after_capture", "not_processed"]
SampleState = Literal[
    "valid", "no_pose", "multiple_poses", "malformed", "missing", "out_of_frame", "low_confidence", "degenerate"
]
Sha256 = Annotated[str, Field(pattern=r"^[0-9a-f]{64}$")]

assert set(POSE_STATUSES) == {"pose", "no_pose", "multiple_poses", "malformed"}
assert set(SAMPLE_STATES) == set(SampleState.__args__)  # type: ignore[attr-defined]


class Strict(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True, allow_inf_nan=False)


def _strictly_increasing(values: list[float], what: str) -> None:
    for a, b in itertools.pairwise(values):
        if not b > a:
            raise ValueError(f"{what} must be strictly increasing")


# ── landmarks ────────────────────────────────────────────────────────────


class LandmarkRecord(Strict):
    x: Finite
    y: Finite
    visibility: Probability
    in_frame: bool


def _check_landmark_keys(landmarks: dict[str, LandmarkRecord | None], status: str) -> None:
    if set(landmarks) != set(LANDMARK_NAMES):
        raise ValueError("landmarks must contain exactly the research landmark set")
    if status != "pose" and any(v is not None for v in landmarks.values()):
        raise ValueError("a frame without a single pose has no landmarks")


# ── pose series (image space) ────────────────────────────────────────────


class PoseSeriesFrame(Strict):
    sample_index: Count
    frame_index: Count
    source_pts: int
    t_ms: NonNegative
    provider_timestamp_ms: Count
    status: PoseStatus
    pose_count: Annotated[int, Field(ge=0, le=64)]
    phase: FramePhase
    landmarks: dict[str, LandmarkRecord | None]

    @model_validator(mode="after")
    def _landmarks(self) -> PoseSeriesFrame:
        _check_landmark_keys(self.landmarks, self.status)
        return self


class PoseSeriesArtifact(Strict):
    schema_version: Literal["research-pose-series-v1"] = POSE_SERIES_SCHEMA
    pose_frame_contract: Literal["research-pose-frame-v1"] = POSE_FRAME_CONTRACT
    coordinate_space: Literal["image_pixels_display_oriented"] = "image_pixels_display_oriented"
    time_axis: Literal["media_ms_since_first_decoded_frame"] = "media_ms_since_first_decoded_frame"
    frame_width: Annotated[int, Field(gt=0, le=100_000)]
    frame_height: Annotated[int, Field(gt=0, le=100_000)]
    landmark_names: list[str]
    frames: Annotated[list[PoseSeriesFrame], Field(max_length=MAX_SERIES_FRAMES)]

    @model_validator(mode="after")
    def _ordering(self) -> PoseSeriesArtifact:
        if self.landmark_names != list(LANDMARK_NAMES):
            raise ValueError("landmark_names must be the research landmark set, in order")
        if [f.sample_index for f in self.frames] != list(range(len(self.frames))):
            raise ValueError("sample_index must be 0..n-1")
        _strictly_increasing([f.t_ms for f in self.frames], "t_ms")
        _strictly_increasing([float(f.provider_timestamp_ms) for f in self.frames], "provider_timestamp_ms")
        _strictly_increasing([float(f.frame_index) for f in self.frames], "frame_index")
        return self


# ── normalized skeleton ─────────────────────────────────────────────────


class SkeletonFrame(Strict):
    sample_index: Count
    t_ms: NonNegative
    status: PoseStatus
    phase: FramePhase
    landmarks: dict[str, LandmarkRecord | None]

    @model_validator(mode="after")
    def _landmarks(self) -> SkeletonFrame:
        _check_landmark_keys(self.landmarks, self.status)
        return self


class PointPx(Strict):
    x: Finite
    y: Finite


class SkeletonTransformRecord(Strict):
    origin_px: PointPx
    scale_px: Annotated[float, Field(allow_inf_nan=False, gt=0)]
    facing_in_image: Literal["positive_x", "negative_x", "undetermined"]
    mirror_applied: bool
    reference_frame_count: Count
    hip_centre_samples: Count
    facing_samples: Count


class NormalizedSkeletonArtifact(Strict):
    schema_version: Literal["research-normalized-skeleton-v1"] = NORMALIZED_SKELETON_SCHEMA
    skeleton_version: Literal["normalized-skeleton-v0.1"] = NORMALIZED_SKELETON_VERSION
    coordinate_space: Literal["dimensionless_normalized_image_space"] = "dimensionless_normalized_image_space"
    unit: Literal["standing_apparent_nose_to_ankle_image_height"] = "standing_apparent_nose_to_ankle_image_height"
    axes: dict[str, str]
    analysis_side: Side
    transform: SkeletonTransformRecord
    parameters: dict[str, Any]
    frames: Annotated[list[SkeletonFrame], Field(max_length=MAX_SERIES_FRAMES)]

    @model_validator(mode="after")
    def _ordering(self) -> NormalizedSkeletonArtifact:
        _strictly_increasing([f.t_ms for f in self.frames], "t_ms")
        return self


# ── kinematic traces ────────────────────────────────────────────────────


class TraceSample(Strict):
    t_ms: NonNegative
    raw_deg: AngleDeg | None
    smoothed_deg: AngleDeg | None
    state: SampleState

    @model_validator(mode="after")
    def _consistency(self) -> TraceSample:
        valid = self.state == "valid"
        if valid != (self.raw_deg is not None) or valid != (self.smoothed_deg is not None):
            raise ValueError("a sample has angles exactly when its state is valid")
        return self


class RepetitionEvents(Strict):
    descent_start_ms: NonNegative
    deepest_ms: NonNegative
    ascent_end_ms: NonNegative

    @model_validator(mode="after")
    def _order(self) -> RepetitionEvents:
        if not (self.descent_start_ms <= self.deepest_ms <= self.ascent_end_ms):
            raise ValueError("events must satisfy descent start ≤ deepest ≤ ascent end")
        return self


class KinematicTracesArtifact(Strict):
    schema_version: Literal["research-kinematic-traces-v1"] = KINEMATIC_TRACES_SCHEMA
    features_version: Literal["kinematic-features-v0.1"] = KINEMATIC_FEATURES_VERSION
    time_axis: Literal["media_ms_since_first_decoded_frame"] = "media_ms_since_first_decoded_frame"
    unit: Literal["degrees_apparent_2d_image_plane"] = "degrees_apparent_2d_image_plane"
    analysis_side: Side
    angle_definitions: dict[str, dict[str, Any]]
    smoothing: dict[str, Any]
    capture_start_ms: NonNegative
    events: RepetitionEvents
    knee: Annotated[list[TraceSample], Field(max_length=MAX_TRACE_SAMPLES)]
    trunk_thigh: Annotated[list[TraceSample], Field(max_length=MAX_TRACE_SAMPLES)]

    @model_validator(mode="after")
    def _ordering(self) -> KinematicTracesArtifact:
        _strictly_increasing([s.t_ms for s in self.knee], "knee t_ms")
        _strictly_increasing([s.t_ms for s in self.trunk_thigh], "trunk_thigh t_ms")
        return self


# ── time-normalized traces ──────────────────────────────────────────────


class TimeNormalizedTracesArtifact(Strict):
    schema_version: Literal["research-time-normalized-traces-v1"] = TIME_NORMALIZED_TRACES_SCHEMA
    time_normalization_version: Literal["time-normalization-v0.1"] = TIME_NORMALIZATION_VERSION
    parameters: dict[str, Any]
    unit: Literal["degrees_apparent_2d_image_plane"] = "degrees_apparent_2d_image_plane"
    repetition_start_ms: NonNegative
    repetition_end_ms: NonNegative
    percent: list[int]
    t_ms: list[NonNegative]
    knee_deg: list[AngleDeg | None]
    trunk_thigh_state: Literal["available", "unavailable"]
    trunk_thigh_deg: list[AngleDeg | None] | None

    @model_validator(mode="after")
    def _shape(self) -> TimeNormalizedTracesArtifact:
        if self.percent != list(range(101)):
            raise ValueError("percent must be 0..100")
        if len(self.t_ms) != 101 or len(self.knee_deg) != 101:
            raise ValueError("normalized traces must have 101 samples")
        _strictly_increasing(self.t_ms, "t_ms")
        if (self.trunk_thigh_state == "available") != (self.trunk_thigh_deg is not None):
            raise ValueError("trunk_thigh_deg present exactly when available")
        if self.trunk_thigh_deg is not None and len(self.trunk_thigh_deg) != 101:
            raise ValueError("normalized traces must have 101 samples")
        if not self.repetition_start_ms < self.repetition_end_ms:
            raise ValueError("repetition start must precede its end")
        return self


# ── summary (kinematic-features-v0.1) ───────────────────────────────────


class QualityFactorRecord(Strict):
    id: Literal[
        "usable_frames", "landmark_confidence", "single_person", "body_in_frame", "foot_stability", "repetition"
    ]
    state: Literal["pass", "limited", "insufficient"]
    value: Finite | int | str | None


class CaptureQualityRecord(Strict):
    state: Literal["sufficient", "limited", "insufficient"]
    factors: list[QualityFactorRecord]
    total_frames: Count
    capture_duration_ms: NonNegative
    usable_frames: Count
    usable_fraction: Probability
    median_landmark_visibility: Probability | None
    frame_status_counts: dict[PoseStatus, Count]
    body_in_frame_fraction: Probability
    foot_drift_fraction: NonNegative | None


class FrameStatistics(Strict):
    decoded_frames: Count
    accepted_frames: Count
    sampled_frames: Count
    status_counts: dict[PoseStatus, Count]
    phase_counts: dict[FramePhase, Count]
    dropped_missing_pts: Count
    dropped_duplicate_pts: Count
    dropped_non_monotonic_pts: Count
    sampling: dict[str, Count]


class SideSelectionRecord(Strict):
    rule: str
    frame_count: Count
    left_median: Probability | None
    right_median: Probability | None
    left_mean: Probability | None
    right_mean: Probability | None
    tie_break: Literal["mean", "left_by_convention"] | None
    side: Side | None


class CalibrationRecord(Strict):
    complete_at_ms: NonNegative
    window_start_ms: NonNegative
    window_end_ms: NonNegative
    frame_count: Count
    usable_frames: Count
    span_ms: NonNegative
    knee_range_deg: NonNegative
    hip_separation_ratio: NonNegative
    standing_apparent_height_px: Annotated[float, Field(allow_inf_nan=False, gt=0)]
    side_selection: SideSelectionRecord


class SegmentationRecord(Strict):
    state: Literal["segmented"]
    reference_deg: AngleDeg
    minimum_deg: AngleDeg
    excursion_deg: NonNegative
    threshold_deg: AngleDeg
    events: RepetitionEvents
    rep_samples: Count
    max_gap_ms: NonNegative
    valid_samples: Count
    protocol_end: str


class KneeFeatures(Strict):
    standing_reference_deg: AngleDeg
    minimum_deg: AngleDeg
    apparent_rom_deg: NonNegative


class TrunkThighFeatures(Strict):
    state: Literal["available", "unavailable"]
    reason: str | None
    standing_reference_deg: AngleDeg | None
    minimum_deg: AngleDeg | None
    apparent_change_deg: Finite | None
    samples_in_repetition: Count
    valid_in_repetition: Count


class TimingFeatures(Strict):
    descent_ms: NonNegative
    ascent_ms: NonNegative
    repetition_ms: NonNegative


class KinematicsRecord(Strict):
    knee: KneeFeatures
    trunk_thigh: TrunkThighFeatures
    timing: TimingFeatures
    symmetry: dict[str, str]


class AssessmentSummary(Strict):
    schema_version: Literal["research-assessment-summary-v1"] = SUMMARY_SCHEMA
    features_version: Literal["kinematic-features-v0.1"] = KINEMATIC_FEATURES_VERSION
    movement_type: Literal["bodyweight_squat_sagittal"]
    capture_mode: Literal["single_camera_sagittal"]
    status: Literal["complete"]
    analysis_side: Side
    facing_in_image: Literal["positive_x", "negative_x", "undetermined"]
    mirror_applied: bool
    time_axis: Literal["media_ms_since_first_decoded_frame"] = "media_ms_since_first_decoded_frame"
    units: dict[str, str]
    quality: CaptureQualityRecord
    frame_statistics: FrameStatistics
    calibration: CalibrationRecord
    segmentation: SegmentationRecord
    kinematics: KinematicsRecord

    @model_validator(mode="after")
    def _consistency(self) -> AssessmentSummary:
        k = self.kinematics.knee
        if abs(k.apparent_rom_deg - (k.standing_reference_deg - k.minimum_deg)) > 1e-9:
            raise ValueError("apparent ROM must equal reference − minimum")
        t = self.kinematics.timing
        e = self.segmentation.events
        if abs(t.repetition_ms - (e.ascent_end_ms - e.descent_start_ms)) > 1e-6:
            raise ValueError("repetition duration must match the events")
        if self.quality.state == "insufficient":
            raise ValueError("an insufficient capture is never a successful assessment")
        return self


# ── failure diagnostics (failed jobs; no landmarks, no traces) ──────────


class FailureDiagnostics(Strict):
    schema_version: Literal["research-failure-diagnostics-v1"] = FAILURE_DIAGNOSTICS_SCHEMA
    decoded_frames: Count | None = None
    sampled_frames: Count | None = None
    status_counts: dict[PoseStatus, Count] | None = None
    protocol_end: str | None = None
    last_calibration_guidance: str | None = None
    segmentation_reason: str | None = None
    segmentation_excursion_deg: Finite | None = None
    quality_state: Literal["sufficient", "limited", "insufficient"] | None = None
    insufficient_quality_factors: list[str] | None = None
    source_technical: dict[str, Any] | None = None


ARTIFACT_MODELS: dict[str, type[Strict]] = {
    "pose_series": PoseSeriesArtifact,
    "normalized_skeleton": NormalizedSkeletonArtifact,
    "kinematic_traces": KinematicTracesArtifact,
    "time_normalized_traces": TimeNormalizedTracesArtifact,
}
ARTIFACT_SCHEMAS: dict[str, str] = {
    "pose_series": POSE_SERIES_SCHEMA,
    "normalized_skeleton": NORMALIZED_SKELETON_SCHEMA,
    "kinematic_traces": KINEMATIC_TRACES_SCHEMA,
    "time_normalized_traces": TIME_NORMALIZED_TRACES_SCHEMA,
}
ARTIFACT_KINDS = tuple(ARTIFACT_MODELS)
