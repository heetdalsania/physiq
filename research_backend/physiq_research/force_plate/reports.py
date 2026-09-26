"""Machine-readable output documents of the force-plate command line.

Every document carries a contract identity, the data origin's evidence
statement and the scientific scope (claim stage + non-claims). A document
built from a ``synthetic_test_fixture`` trial states, in capitals, that it
is not human data and not validation evidence.
"""

from __future__ import annotations

from typing import Any, Final

from physiq_research.force_plate.repository import StoredTrial, StoredValidation, TrialDeletion
from physiq_research.force_plate.versions import (
    DELETION_CONTRACT,
    STUDY_REPORT_CONTRACT,
    TRIAL_LIST_CONTRACT,
    TRIAL_REPORT_CONTRACT,
    VALIDATION_EXPORT_CONTRACT,
    VALIDATION_REPORT_CONTRACT,
)

CLAIM_STAGE: Final = "measured_force_plate_ground_truth_and_comparison_framework"

NON_CLAIMS: Final[tuple[str, ...]] = (
    "The force-plate measurement is the ground truth; nothing derived from video is ground truth.",
    "This software contains no video-based force estimator and produces no force estimate.",
    "A per-trial comparison is not evidence that an estimator is accurate, valid or generalizable.",
    "Only total vertical ground-reaction force from one plate with both feet on it; no left/right asymmetry.",
    "Only bodyweight_squat_sagittal assessments captured with single_camera_sagittal.",
    "No joint moments, inverse dynamics, or muscle, tendon or tissue forces are estimated.",
    "No injury, risk, readiness, recovery, capacity, diagnosis or movement-quality judgement is made.",
    "Approval, consent and the participant mapping are external to this software.",
)

EVIDENCE_STATEMENTS: Final[dict[str, str]] = {
    "synthetic_test_fixture": "SYNTHETIC TEST FIXTURE — NOT HUMAN DATA — NOT VALIDATION EVIDENCE",
    "research_recording": (
        "Measured force-plate data paired with one Milestone 7 assessment under the recorded versions. "
        "Any comparison describes this trial only; conclusions require the external, pre-specified "
        "analysis plan and held-out participants."
    ),
}


def scope() -> dict[str, Any]:
    return {"claim_stage": CLAIM_STAGE, "non_claims": list(NON_CLAIMS)}


def _artifacts(trial: StoredTrial) -> dict[str, Any]:
    return {
        kind: {
            "schema_version": a.schema_version,
            "content_sha256": a.content_sha256,
            "byte_size": a.byte_size,
            **({"data": a.data} if a.data is not None else {}),
        }
        for kind, a in sorted(trial.artifacts.items())
    }


def trial_document(trial: StoredTrial, *, deduplicated: bool | None = None) -> dict[str, Any]:
    doc: dict[str, Any] = {
        "contract": TRIAL_REPORT_CONTRACT,
        "trial_id": str(trial.id),
        "assessment_id": str(trial.assessment_id),
        "assessment_record_sha256": trial.assessment_record_sha256,
        "research_subject_id": str(trial.research_subject_id) if trial.research_subject_id else None,
        "movement_type": trial.movement_type,
        "capture_mode": trial.capture_mode,
        "data_origin": trial.data_origin,
        "evidence_statement": EVIDENCE_STATEMENTS[trial.data_origin],
        "force_source_sha256": trial.force_source_sha256,
        "trial_key": trial.trial_key,
        "processing_fingerprint": trial.processing_fingerprint,
        "pipeline_version": trial.pipeline_version,
        "versions": trial.versions,
        "summary": trial.summary,
        "provenance": trial.provenance,
        "integrity": {
            "record_sha256": trial.record_sha256,
            "summary_sha256": trial.summary_sha256,
            "provenance_sha256": trial.provenance_sha256,
            "verified_on_read": True,
        },
        "created_at": trial.created_at.isoformat(),
        "artifacts": _artifacts(trial),
        "artifacts_included": all(a.data is not None for a in trial.artifacts.values()),
        "scientific_scope": scope(),
    }
    if deduplicated is not None:
        doc["deduplicated"] = deduplicated
    return doc


def validation_document(trial: StoredTrial, result: StoredValidation, *, include_estimate: bool) -> dict[str, Any]:
    doc: dict[str, Any] = {
        "result_id": str(result.id),
        "trial_id": str(result.trial_id),
        "protocol_version": result.protocol_version,
        "estimator": {"name": result.estimator_name, "version": result.estimator_version},
        "estimate_sha256": result.estimate_sha256,
        "metrics": result.metrics,
        "provenance": result.provenance,
        "integrity": {
            "record_sha256": result.record_sha256,
            "metrics_sha256": result.metrics_sha256,
            "verified_on_read": True,
        },
        "created_at": result.created_at.isoformat(),
        "data_origin": trial.data_origin,
        "evidence_statement": EVIDENCE_STATEMENTS[trial.data_origin],
    }
    if include_estimate:
        doc["estimate"] = result.estimate
    return doc


def validation_report(trial: StoredTrial, result: StoredValidation, *, deduplicated: bool) -> dict[str, Any]:
    return {
        "contract": VALIDATION_REPORT_CONTRACT,
        "deduplicated": deduplicated,
        **validation_document(trial, result, include_estimate=False),
        "scientific_scope": scope(),
    }


def export_document(trial: StoredTrial, results: list[StoredValidation], *, include_estimates: bool) -> dict[str, Any]:
    return {
        "contract": VALIDATION_EXPORT_CONTRACT,
        "evidence_statement": EVIDENCE_STATEMENTS[trial.data_origin],
        "trial": trial_document(trial),
        "validation_results": [validation_document(trial, r, include_estimate=include_estimates) for r in results],
        "scientific_scope": scope(),
    }


def deletion_document(outcome: TrialDeletion) -> dict[str, Any]:
    return {
        "contract": DELETION_CONTRACT,
        "trial_id": str(outcome.trial_id),
        "state": outcome.state,
        "artifacts_removed": outcome.artifacts_removed,
        "validation_results_removed": outcome.validation_results_removed,
        "linked_assessment": "unchanged",
    }


def list_document(rows: list[dict[str, Any]]) -> dict[str, Any]:
    return {"contract": TRIAL_LIST_CONTRACT, "trials": rows}


def study_document(body: dict[str, Any], definition_sha256: str) -> dict[str, Any]:
    origin = body["data_origin"]
    statement = EVIDENCE_STATEMENTS[origin]
    if origin == "synthetic_test_fixture":
        statement = "SOFTWARE TEST OUTPUT — " + statement
    return {
        "contract": STUDY_REPORT_CONTRACT,
        "evidence_statement": statement,
        "study_definition_sha256": definition_sha256,
        **body,
        "scientific_scope": scope(),
    }
