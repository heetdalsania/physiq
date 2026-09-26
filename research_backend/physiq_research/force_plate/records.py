"""Schemas of every stored Milestone 8 document.

Each stored JSON document carries its own schema identity and is checked
against these models BEFORE it is written and AFTER it is read back (with its
content digest), so a malformed or tampered value is refused, never served.
Numbers must be finite; series must be equally long and strictly increasing
in time; intervals must be ordered.

Scientific restraint applies to stored outputs too: no score, grade,
accuracy, pass/fail, risk, readiness, tissue or joint-kinetics field exists
in any model (tests/test_force_plate_boundaries.py enumerates every key).
"""

from __future__ import annotations

from typing import Annotated, Any, Literal

import numpy as np
from pydantic import BaseModel, ConfigDict, Field, model_validator

from physiq_research.canonical import canonical_json
from physiq_research.force_plate.ground_truth import STANDARD_GRAVITY_M_S2
from physiq_research.force_plate.manifest import BODY_MASS_KG_MAX, BODY_MASS_KG_MIN

Finite = Annotated[float, Field(allow_inf_nan=False)]
NonNegative = Annotated[float, Field(allow_inf_nan=False, ge=0)]
Positive = Annotated[float, Field(allow_inf_nan=False, gt=0)]
Fraction = Annotated[float, Field(allow_inf_nan=False, ge=0, le=1)]
Count = Annotated[int, Field(ge=0, le=100_000_000)]
BodyMass = Annotated[float, Field(allow_inf_nan=False, ge=BODY_MASS_KG_MIN, le=BODY_MASS_KG_MAX)]
Interval = Annotated[list[Finite], Field(min_length=2, max_length=2)]
IndexPair = Annotated[list[Count], Field(min_length=2, max_length=2)]
SyncMethod = Literal["one_anchor_offset", "two_anchor_affine"]
DataOrigin = Literal["research_recording", "synthetic_test_fixture"]

MAX_SERIES = 1_000_000


class Strict(BaseModel):
    # Strict mode: stored JSON must already have the right types (an int is
    # accepted for a float field, since canonical JSON writes 5.0 as 5).
    model_config = ConfigDict(strict=True, extra="forbid", frozen=True, allow_inf_nan=False)


def _standard_gravity(value: float) -> None:
    if value != STANDARD_GRAVITY_M_S2:
        raise ValueError("standard gravity must be 9.80665 m/s²")


def _ordered(interval: list[float], what: str, strict: bool = False) -> None:
    if (interval[0] >= interval[1]) if strict else (interval[0] > interval[1]):
        raise ValueError(f"{what} must be an ordered interval")


def _increasing(values: list[float], what: str) -> None:
    if len(values) > 1 and not bool(np.all(np.diff(np.asarray(values, dtype=np.float64)) > 0)):
        raise ValueError(f"{what} must be strictly increasing")


# ── canonical measured signal ───────────────────────────────────────────


class SamplingRecord(Strict):
    sample_count: Annotated[int, Field(ge=2, le=MAX_SERIES)]
    first_time_s: NonNegative
    last_time_s: NonNegative
    span_s: Positive
    min_interval_s: Positive
    median_interval_s: Positive
    max_interval_s: Positive
    mean_rate_hz: Positive


class SignalArtifact(Strict):
    schema_version: Literal["force-plate-signal-artifact-v1"]
    signal_contract: Literal["force-plate-signal-v0.1"]
    quantity: Literal["measured_total_vertical_ground_reaction_force"]
    measurement: Literal["single_force_plate_both_feet"]
    time_axis: Literal["seconds_since_force_acquisition_start"]
    unit: Literal["N"]
    positive_direction: Literal["up"]
    preprocessing: Literal["none"]
    sample_count: Annotated[int, Field(ge=2, le=MAX_SERIES)]
    time_s: Annotated[list[NonNegative], Field(max_length=MAX_SERIES)]
    vertical_grf_n: Annotated[list[Finite], Field(max_length=MAX_SERIES)]
    sampling: SamplingRecord

    @model_validator(mode="after")
    def _shape(self) -> SignalArtifact:
        if not (len(self.time_s) == len(self.vertical_grf_n) == self.sample_count == self.sampling.sample_count):
            raise ValueError("signal series lengths must equal sample_count")
        _increasing(self.time_s, "time_s")
        return self


# ── synchronization ─────────────────────────────────────────────────────


class AnchorRecord(Strict):
    event: Literal["plate_impact", "trigger_signal", "other_declared_event"]
    video_time_ms: NonNegative
    force_time_ms: NonNegative
    residual_ms: Finite


class MappingRecord(Strict):
    offset_ms: Finite
    rate: Positive


class ForceSupportRecord(Strict):
    force_s: Interval
    media_ms: Interval


class OverlapRecord(Strict):
    media_ms: Interval
    force_s: Interval
    duration_ms: Positive
    video_coverage_fraction: Fraction
    force_coverage_fraction: Fraction


class SyncArtifact(Strict):
    schema_version: Literal["force-video-sync-artifact-v1"]
    sync_version: Literal["force-video-sync-v0.1"]
    media_clock: Literal["media_ms_since_first_decoded_frame"]
    force_clock: Literal["seconds_since_force_acquisition_start"]
    method: SyncMethod
    mapping: MappingRecord
    anchors: Annotated[list[AnchorRecord], Field(min_length=1, max_length=2)]
    parameters: dict[str, Any]
    force_support: ForceSupportRecord
    media_support_ms: Interval
    overlap: OverlapRecord

    @model_validator(mode="after")
    def _consistent(self) -> SyncArtifact:
        if len(self.anchors) != (1 if self.method == "one_anchor_offset" else 2):
            raise ValueError("anchor count must match the method")
        if self.method == "one_anchor_offset" and self.mapping.rate != 1.0:
            raise ValueError("one-anchor alignment has rate exactly 1")
        for interval, what in (
            (self.force_support.force_s, "force_support.force_s"),
            (self.force_support.media_ms, "force_support.media_ms"),
            (self.media_support_ms, "media_support_ms"),
            (self.overlap.force_s, "overlap.force_s"),
        ):
            _ordered(interval, what)
        _ordered(self.overlap.media_ms, "overlap.media_ms", strict=True)
        return self


# ── ground truth ────────────────────────────────────────────────────────


class RepetitionRecord(Strict):
    media_ms: Interval
    deepest_media_ms: NonNegative
    force_s: Interval
    deepest_force_s: Finite
    duration_ms: Positive
    bracketing_sample_range: IndexPair
    samples_inside: Count
    max_sample_interval_ms: Positive
    measured_peak_vertical_grf_n: Positive
    measured_peak_vertical_grf_bw: Positive
    measured_peak_media_ms: NonNegative
    measured_trough_vertical_grf_n: Positive
    measured_trough_vertical_grf_bw: Positive
    measured_trough_media_ms: NonNegative
    measured_impulse_n_s: Positive
    measured_impulse_bw_s: Positive

    @model_validator(mode="after")
    def _order(self) -> RepetitionRecord:
        _ordered(self.media_ms, "repetition.media_ms", strict=True)
        _ordered(self.force_s, "repetition.force_s", strict=True)
        if not self.media_ms[0] <= self.deepest_media_ms <= self.media_ms[1]:
            raise ValueError("the deepest point lies inside the repetition")
        return self


class StandingRecord(Strict):
    window_media_ms: Interval
    role: str
    state: Literal["covered", "not_covered"]
    mean_vertical_grf_n: Finite | None
    mean_vertical_grf_bw: Finite | None

    @model_validator(mode="after")
    def _state(self) -> StandingRecord:
        covered = self.state == "covered"
        if covered != (self.mean_vertical_grf_n is not None) or covered != (self.mean_vertical_grf_bw is not None):
            raise ValueError("standing means are present exactly when the window is covered")
        return self


class MeasurementChecksRecord(Strict):
    sample_count: Annotated[int, Field(ge=2, le=MAX_SERIES)]
    max_sample_interval_ms: Positive
    non_positive_samples: Count
    min_vertical_grf_n: Finite
    max_vertical_grf_n: Finite


class GroundTruthArtifact(Strict):
    schema_version: Literal["force-ground-truth-artifact-v1"]
    ground_truth_version: Literal["force-ground-truth-v0.1"]
    quantity: Literal["measured_total_vertical_ground_reaction_force"]
    ground_truth_source: Literal["force_plate_measurement"]
    time_axis: Literal["media_ms_since_first_decoded_frame"]
    units: dict[str, str]
    body_mass_kg: BodyMass
    standard_gravity_m_s2: Positive
    body_weight_n: Positive
    preprocessing: Literal["none"]
    sample_support_media_ms: Interval
    source_sample_index_range: IndexPair
    t_media_ms: Annotated[list[Finite], Field(max_length=MAX_SERIES)]
    vertical_grf_n: Annotated[list[Finite], Field(max_length=MAX_SERIES)]
    vertical_grf_bw: Annotated[list[Finite], Field(max_length=MAX_SERIES)]
    repetition: RepetitionRecord
    standing_reference: StandingRecord
    measurement_checks: MeasurementChecksRecord

    @model_validator(mode="after")
    def _shape(self) -> GroundTruthArtifact:
        _standard_gravity(self.standard_gravity_m_s2)
        n = len(self.t_media_ms)
        if not (n == len(self.vertical_grf_n) == len(self.vertical_grf_bw) == self.measurement_checks.sample_count):
            raise ValueError("ground-truth series lengths differ")
        i0, i1 = self.source_sample_index_range
        if i1 - i0 + 1 != n:
            raise ValueError("source_sample_index_range does not match the series length")
        _increasing(self.t_media_ms, "t_media_ms")
        if self.sample_support_media_ms != [self.t_media_ms[0], self.t_media_ms[-1]]:
            raise ValueError("sample support must be the first and last ground-truth sample")
        rep = self.repetition.media_ms
        if not (self.t_media_ms[0] <= rep[0] and rep[1] <= self.t_media_ms[-1]):
            raise ValueError("ground truth must bracket the repetition")
        return self


# ── trial summary and provenance (trial row) ───────────────────────────


class TrialSummary(Strict):
    schema_version: Literal["force-plate-trial-summary-v1"]
    trial_contract: Literal["force-plate-trial-v0.1"]
    data_origin: DataOrigin
    movement_type: Literal["bodyweight_squat_sagittal"]
    capture_mode: Literal["single_camera_sagittal"]
    plate_configuration: Literal["single_plate_both_feet"]
    quantity: Literal["measured_total_vertical_ground_reaction_force"]
    body_mass_kg: BodyMass
    standard_gravity_m_s2: Positive
    body_weight_n: Positive
    synchronization: dict[str, Any]
    overlap: OverlapRecord
    repetition: dict[str, Any]
    standing_reference: dict[str, Any]
    signal: dict[str, Any]

    @model_validator(mode="after")
    def _json(self) -> TrialSummary:
        _standard_gravity(self.standard_gravity_m_s2)
        canonical_json(self.model_dump())  # finite, JSON-representable
        return self


PROVENANCE_SECTIONS = (
    "link",
    "manifest",
    "source",
    "signal",
    "synchronization",
    "ground_truth",
    "validation_protocol",
    "pipeline",
    "limits",
)


class TrialProvenance(Strict):
    """Answers: which M7 record, which force file (digest only), which declared
    units/sign mapping, which contracts and parameters, which body mass, which
    anchors and mapping, which overlap, which software — and when."""

    link: dict[str, Any]
    manifest: dict[str, Any]
    source: dict[str, Any]
    signal: dict[str, Any]
    synchronization: dict[str, Any]
    ground_truth: dict[str, Any]
    validation_protocol: dict[str, Any]
    pipeline: dict[str, Any]
    limits: dict[str, Any]

    @model_validator(mode="after")
    def _json(self) -> TrialProvenance:
        canonical_json(self.model_dump())
        return self


# ── validation (evaluation) result ─────────────────────────────────────


class IntervalsRecord(Strict):
    repetition_media_ms: Interval
    prediction_support_media_ms: Interval
    comparison_media_ms: Interval
    repetition_coverage_fraction: Fraction
    uncovered_start_ms: NonNegative
    uncovered_end_ms: NonNegative


class SampleCountsRecord(Strict):
    prediction_samples: Count
    in_repetition: Count
    before_repetition: Count
    after_repetition: Count
    max_prediction_segment_in_repetition_ms: NonNegative
    max_measured_interval_in_comparison_ms: NonNegative


class PointwiseRecord(Strict):
    comparison_samples: Count
    mean_signed_error_n: Finite
    mae_n: NonNegative
    rmse_n: NonNegative
    mean_signed_error_bw: Finite
    mae_bw: NonNegative
    rmse_bw: NonNegative


class WaveformShapeRecord(Strict):
    pearson_r: Annotated[float, Field(allow_inf_nan=False, ge=-1, le=1)] | None
    state: Literal["defined", "undefined_constant_series"]
    role: Literal["waveform-shape diagnostic only; not a measure of agreement"]

    @model_validator(mode="after")
    def _state(self) -> WaveformShapeRecord:
        if (self.state == "defined") != (self.pearson_r is not None):
            raise ValueError("pearson_r is present exactly when defined")
        return self


class PeakRecord(Strict):
    measured_peak_n: Finite
    measured_peak_bw: Finite
    measured_peak_media_ms: NonNegative
    predicted_peak_n: Finite
    predicted_peak_bw: Finite
    predicted_peak_media_ms: NonNegative
    peak_error_n: Finite
    abs_peak_error_n: NonNegative
    peak_error_bw: Finite
    abs_peak_error_bw: NonNegative
    peak_time_difference_ms: Finite


class ImpulseRecord(Strict):
    interval_media_ms: Interval
    measured_impulse_n_s: Finite
    predicted_impulse_n_s: Finite
    impulse_error_n_s: Finite
    abs_impulse_error_n_s: NonNegative
    measured_impulse_bw_s: Finite
    predicted_impulse_bw_s: Finite
    abs_impulse_error_bw_s: NonNegative


class ValidationMetrics(Strict):
    schema_version: Literal["grf-validation-metrics-v1"]
    protocol_version: Literal["grf-validation-v0.1"]
    parameters: dict[str, Any]
    body_weight_n: Positive
    time_shift_applied_ms: Literal[0]
    intervals: IntervalsRecord
    samples: SampleCountsRecord
    pointwise: PointwiseRecord
    waveform_shape: WaveformShapeRecord
    peak: PeakRecord
    impulse: ImpulseRecord


class ValidationProvenance(Strict):
    trial: dict[str, Any]
    estimate: dict[str, Any]
    held_out: dict[str, Any]
    protocol: dict[str, Any]
    pipeline: dict[str, Any]

    @model_validator(mode="after")
    def _json(self) -> ValidationProvenance:
        canonical_json(self.model_dump())
        return self


TRIAL_ARTIFACT_MODELS: dict[str, type[Strict]] = {
    "measured_signal": SignalArtifact,
    "synchronization": SyncArtifact,
    "ground_truth": GroundTruthArtifact,
}
TRIAL_ARTIFACT_SCHEMAS: dict[str, str] = {
    "measured_signal": "force-plate-signal-artifact-v1",
    "synchronization": "force-video-sync-artifact-v1",
    "ground_truth": "force-ground-truth-artifact-v1",
}
TRIAL_ARTIFACT_KINDS = tuple(TRIAL_ARTIFACT_MODELS)
