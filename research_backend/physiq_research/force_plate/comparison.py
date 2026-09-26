"""Compare a supplied estimate with a stored trial's measured ground truth.

    stored trial (verified on read) + estimate document
      → binding check: the estimate names this trial's M7 assessment id AND
        its record SHA-256 (it was computed from exactly that record)
      → held-out check: the trial's participant was not used to develop the
        estimator
      → evaluation.evaluate (grf-validation-v0.1)
      → one immutable validation result, keyed by (trial record, estimate,
        protocol); the same comparison again returns the existing result

The estimate is stored with the result so the comparison can be re-examined
later; nothing here produces or modifies a prediction.
"""

from __future__ import annotations

import platform
import uuid
from collections.abc import Callable
from dataclasses import dataclass
from datetime import datetime

import numpy as np
from sqlalchemy import Engine

from physiq_research import __version__
from physiq_research.canonical import canonical_digest
from physiq_research.force_plate.errors import ForcePlateError
from physiq_research.force_plate.estimate import check_held_out, estimate_document, parse_estimate
from physiq_research.force_plate.evaluation import EVALUATION_PARAMETERS, TruthSeries, evaluate
from physiq_research.force_plate.limits import ForcePlateLimits
from physiq_research.force_plate.records import ValidationMetrics, ValidationProvenance
from physiq_research.force_plate.repository import ForcePlateRepository, StoredTrial, ValidationRecord
from physiq_research.force_plate.versions import (
    ESTIMATE_CONTRACT,
    FORCE_PLATE_PIPELINE_VERSION,
    NUMERICS_VERSION,
    VALIDATION_METRICS_SCHEMA,
    VALIDATION_PROTOCOL,
)
from physiq_research.storage.repository import utcnow

Faults = Callable[[str], None]


def evaluation_fingerprint() -> str:
    return canonical_digest(
        {
            "protocol": VALIDATION_PROTOCOL,
            "parameters": EVALUATION_PARAMETERS,
            "estimate_contract": ESTIMATE_CONTRACT,
            "metrics_schema": VALIDATION_METRICS_SCHEMA,
            "numerics": NUMERICS_VERSION,
        }
    )


def result_key(*, trial_id: uuid.UUID, trial_record_sha256: str, estimate_sha256: str, fingerprint: str) -> str:
    return canonical_digest(
        {
            "trial_id": str(trial_id),
            "trial_record_sha256": trial_record_sha256,
            "estimate_sha256": estimate_sha256,
            "evaluation_fingerprint": fingerprint,
        }
    )


def read_trial(repo: ForcePlateRepository, trial_id: uuid.UUID) -> StoredTrial:
    trial = repo.get_trial(trial_id)
    if trial is None:
        raise ForcePlateError("trial_deleted" if repo.trial_state(trial_id) == "deleted" else "trial_not_found")
    return trial


def truth_series(trial: StoredTrial) -> TruthSeries:
    doc = trial.artifacts["ground_truth"].data
    assert doc is not None
    rep = doc["repetition"]["media_ms"]
    return TruthSeries(
        t_media_ms=np.asarray(doc["t_media_ms"], dtype=np.float64),
        vertical_grf_n=np.asarray(doc["vertical_grf_n"], dtype=np.float64),
        body_weight_n=float(doc["body_weight_n"]),
        repetition_ms=(float(rep[0]), float(rep[1])),
    )


@dataclass(frozen=True)
class ComparisonOutcome:
    trial: StoredTrial
    result_id: uuid.UUID
    deduplicated: bool


def compare_estimate(
    engine: Engine,
    trial_id: uuid.UUID,
    estimate_bytes: bytes,
    limits: ForcePlateLimits,
    *,
    clock: Callable[[], datetime] = utcnow,
    faults: Faults | None = None,
) -> ComparisonOutcome:
    repo = ForcePlateRepository(engine, clock=clock, faults=faults)
    trial = read_trial(repo, trial_id)
    estimate = parse_estimate(estimate_bytes, limits)
    if (
        estimate.assessment_id != trial.assessment_id
        or estimate.assessment_record_sha256 != trial.assessment_record_sha256
    ):
        raise ForcePlateError("estimate_assessment_mismatch")
    held_out = check_held_out(estimate, trial.research_subject_id)

    body = evaluate(
        truth_series(trial),
        np.asarray(estimate.t_media_ms, dtype=np.float64),
        np.asarray(estimate.vertical_grf_n, dtype=np.float64),
    )
    metrics = ValidationMetrics.model_validate(
        {
            "schema_version": VALIDATION_METRICS_SCHEMA,
            "protocol_version": VALIDATION_PROTOCOL,
            "parameters": dict(EVALUATION_PARAMETERS),
            **body,
        }
    )
    estimate_sha = canonical_digest(estimate_document(estimate))
    fingerprint = evaluation_fingerprint()
    key = result_key(
        trial_id=trial.id,
        trial_record_sha256=trial.record_sha256,
        estimate_sha256=estimate_sha,
        fingerprint=fingerprint,
    )
    identity = estimate.estimator
    provenance = ValidationProvenance.model_validate(
        {
            "trial": {
                "trial_id": str(trial.id),
                "trial_record_sha256": trial.record_sha256,
                "assessment_id": str(trial.assessment_id),
                "assessment_record_sha256": trial.assessment_record_sha256,
                "research_subject_id": str(trial.research_subject_id) if trial.research_subject_id else None,
                "data_origin": trial.data_origin,
                "ground_truth_sha256": trial.artifacts["ground_truth"].content_sha256,
                "versions": trial.versions,
            },
            "estimate": {
                "contract": ESTIMATE_CONTRACT,
                "sha256": estimate_sha,
                "estimator_name": identity.name,
                "estimator_version": identity.version,
                "estimator_parameters_sha256": identity.parameters_sha256,
                "development_participant_count": len(identity.development_research_subject_ids),
                "sample_count": len(estimate.t_media_ms),
            },
            "held_out": {"status": held_out},
            "protocol": {
                "version": VALIDATION_PROTOCOL,
                "parameters": dict(EVALUATION_PARAMETERS),
                "evaluation_fingerprint": fingerprint,
            },
            "pipeline": {
                "version": FORCE_PLATE_PIPELINE_VERSION,
                "service_version": __version__,
                "result_key": key,
                "evaluated_at": clock().isoformat(),
                "python": platform.python_version(),
            },
        }
    )
    if faults is not None:
        faults("database_save")
    result_id, deduplicated = repo.save_validation(
        ValidationRecord(
            result_id=uuid.uuid4(),
            trial_id=trial.id,
            result_key=key,
            estimate=estimate,
            metrics=metrics,
            provenance=provenance,
        )
    )
    return ComparisonOutcome(trial=trial, result_id=result_id, deduplicated=deduplicated)
