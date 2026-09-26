"""The seam for FUTURE video-derived vertical-GRF estimates.

Nothing here estimates anything. This module defines:

    VerticalGrfEstimate   the input contract (``vertical-grf-estimate-v0.1``):
                          ESTIMATED total vertical GRF (newtons) at M7 media
                          times, bound to the exact M7 record it was computed
                          from (assessment id + record SHA-256), and naming a
                          versioned estimator. It is never called measured,
                          and never "validated" by existing.
    VerticalGrfEstimator  the interface a future estimator implements. Its
                          input is the M7 record (derived kinematics) and the
                          declared body mass — NEVER measured force, so the
                          measured ground truth cannot leak into a prediction.
    SubjectPartition      participant-level development / held-out partition.
                          Partitioning is by research_subject_id only (never by
                          frame or trial), so one participant can never appear
                          on both sides.
    check_held_out        refuses to compare an estimate with a trial whose
                          participant was used to develop the estimator.

No estimator, weights, training or partition of real participants exist in
this repository. Test doubles live under tests/ and are labelled as such.
"""

from __future__ import annotations

import re
import uuid
from dataclasses import dataclass
from typing import Annotated, Any, Final, Literal, Protocol

import numpy as np
from pydantic import BaseModel, ConfigDict, Field, ValidationError, field_validator

from physiq_research.force_plate.errors import ForcePlateError
from physiq_research.force_plate.inputs import parse_json_document
from physiq_research.force_plate.limits import ForcePlateLimits
from physiq_research.force_plate.manifest import SHA256_PATTERN, parse_canonical_uuid
from physiq_research.force_plate.versions import ESTIMATE_CONTRACT
from physiq_research.storage.repository import StoredAssessment

ESTIMATOR_NAME: Final = re.compile(r"^[a-z0-9][a-z0-9_.-]{0,63}$")
ESTIMATOR_VERSION: Final = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_.+-]{0,63}$")


class _Strict(BaseModel):
    model_config = ConfigDict(strict=True, extra="forbid", frozen=True, allow_inf_nan=False)


class EstimatorIdentity(_Strict):
    name: str
    version: str
    parameters_sha256: str | None
    # Participants whose data were used to develop, train or tune the
    # estimator in any way (empty for an estimator with no participant-data
    # dependence). Evaluation refuses any trial of these participants.
    development_research_subject_ids: Annotated[list[uuid.UUID], Field(max_length=100_000)]

    @field_validator("name")
    @classmethod
    def _name(cls, value: str) -> str:
        if not ESTIMATOR_NAME.match(value):
            raise ValueError("estimator name must be a lowercase slug")
        return value

    @field_validator("version")
    @classmethod
    def _version(cls, value: str) -> str:
        if not ESTIMATOR_VERSION.match(value):
            raise ValueError("estimator version must be a short version string")
        return value

    @field_validator("parameters_sha256")
    @classmethod
    def _parameters(cls, value: str | None) -> str | None:
        if value is not None and not SHA256_PATTERN.match(value):
            raise ValueError("parameters_sha256 must be a lowercase SHA-256")
        return value

    @field_validator("development_research_subject_ids", mode="before")
    @classmethod
    def _subjects(cls, value: object) -> list[uuid.UUID]:
        if not isinstance(value, list):
            raise ValueError("a list of research subject ids is required")
        parsed = [parse_canonical_uuid(v, require_v4=True) for v in value]
        if len(set(parsed)) != len(parsed):
            raise ValueError("research subject ids must be unique")
        return parsed


class VerticalGrfEstimate(_Strict):
    contract: Literal["vertical-grf-estimate-v0.1"]
    quantity: Literal["estimated_total_vertical_ground_reaction_force"]
    unit: Literal["N"]
    time_axis: Literal["media_ms_since_first_decoded_frame"]
    assessment_id: uuid.UUID
    assessment_record_sha256: str
    estimator: EstimatorIdentity
    t_media_ms: list[float]
    vertical_grf_n: list[float]

    @field_validator("assessment_id", mode="before")
    @classmethod
    def _assessment(cls, value: object) -> uuid.UUID:
        return parse_canonical_uuid(value, require_v4=False)

    @field_validator("assessment_record_sha256")
    @classmethod
    def _record(cls, value: str) -> str:
        if not SHA256_PATTERN.match(value):
            raise ValueError("assessment_record_sha256 must be a lowercase SHA-256")
        return value


assert ESTIMATE_CONTRACT == "vertical-grf-estimate-v0.1"


@dataclass(frozen=True)
class EstimatorInputs:
    """Everything a future estimator may see. Measured force is NOT here."""

    assessment: StoredAssessment
    body_mass_kg: float


class VerticalGrfEstimator(Protocol):
    """Interface for a future, separately versioned estimator (none exists)."""

    identity: EstimatorIdentity

    def estimate(self, inputs: EstimatorInputs) -> VerticalGrfEstimate: ...


@dataclass(frozen=True)
class SubjectPartition:
    """Participant-level partition for future estimator development.

    ``development`` holds every participant whose data may be used to build,
    train or tune an estimator; ``held_out`` holds the participants reserved
    for evaluation. The two are disjoint by construction, so trials of one
    participant can never be on both sides (no trial- or frame-level split).
    """

    development: frozenset[uuid.UUID]
    held_out: frozenset[uuid.UUID]

    def __post_init__(self) -> None:
        if self.development & self.held_out:
            raise ValueError("a participant cannot be both a development and a held-out participant")

    def role(self, subject: uuid.UUID) -> Literal["development", "held_out", "unassigned"]:
        if subject in self.development:
            return "development"
        if subject in self.held_out:
            return "held_out"
        return "unassigned"


def check_held_out(estimate: VerticalGrfEstimate, trial_subject: uuid.UUID | None) -> str:
    """Refuse a comparison that would reuse a development participant."""
    if trial_subject is None:
        raise ForcePlateError("held_out_status_unverifiable")
    development = set(estimate.estimator.development_research_subject_ids)
    if not development:
        return "no_development_participants_declared"
    if trial_subject in development:
        raise ForcePlateError("subject_not_held_out")
    return "trial_participant_not_in_development_set"


def _estimate_error(exc: ValidationError) -> ForcePlateError:
    for err in exc.errors():
        loc = tuple(str(p) for p in err["loc"])
        if err["type"] == "finite_number" and loc and loc[0] in ("t_media_ms", "vertical_grf_n"):
            return ForcePlateError("non_finite_prediction", field=loc[0])
        if err["type"] == "extra_forbidden":
            return ForcePlateError("unknown_field", field=".".join(p for p in loc[:-1] if not p.isdigit()) or "$")
        if err["type"] == "missing":
            return ForcePlateError("missing_field", field=".".join(loc))
        return ForcePlateError("invalid_estimate", field=".".join(p for p in loc if not p.isdigit()) or "$")
    return ForcePlateError("invalid_estimate")  # pragma: no cover


def validate_estimate_document(value: object, limits: ForcePlateLimits) -> VerticalGrfEstimate:
    """Validate an estimate given as a Python value (e.g. from a future
    in-process estimator) — the same rules as a JSON document."""
    if not isinstance(value, dict):
        raise ForcePlateError("invalid_estimate", field="$")
    if value.get("contract") != ESTIMATE_CONTRACT:
        raise ForcePlateError("unsupported_estimate_contract", field="contract")
    try:
        estimate = VerticalGrfEstimate.model_validate(value)
    except ValidationError as exc:
        raise _estimate_error(exc) from None
    check_series(estimate, limits)
    return estimate


def parse_estimate(data: bytes, limits: ForcePlateLimits) -> VerticalGrfEstimate:
    return validate_estimate_document(parse_json_document(data, field="estimate"), limits)


def check_series(estimate: VerticalGrfEstimate, limits: ForcePlateLimits) -> None:
    t = np.asarray(estimate.t_media_ms, dtype=np.float64)
    f = np.asarray(estimate.vertical_grf_n, dtype=np.float64)
    if t.size == 0 and f.size == 0:
        raise ForcePlateError("empty_prediction")
    if t.size != f.size:
        raise ForcePlateError("prediction_length_mismatch")
    if t.size > limits.max_estimate_samples:
        raise ForcePlateError("too_many_predictions")
    if not (np.all(np.isfinite(t)) and np.all(np.isfinite(f))):  # pragma: no cover - schema rejects first
        raise ForcePlateError("non_finite_prediction")
    if np.any(t < 0):
        raise ForcePlateError("negative_prediction_time", field="t_media_ms")
    if t.size > 1 and not np.all(np.diff(t) > 0):
        raise ForcePlateError("prediction_timestamps_not_increasing", field="t_media_ms")


def estimate_document(estimate: VerticalGrfEstimate) -> dict[str, Any]:
    return estimate.model_dump(mode="json")
