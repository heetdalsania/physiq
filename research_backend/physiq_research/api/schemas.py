"""Versioned API response schemas (Pydantic). Routes never return ORM rows."""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field

from physiq_research.records import AssessmentSummary, FailureDiagnostics
from physiq_research.versions import DELETION_CONTRACT, JOB_CONTRACT, RESULT_CONTRACT

JobStatus = Literal["queued", "processing", "succeeded", "failed", "deleted"]


class ApiModel(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True, allow_inf_nan=False)


class FailureV1(ApiModel):
    code: str
    detail: str | None
    stage: str | None
    diagnostics: FailureDiagnostics | None


class JobLinksV1(ApiModel):
    self: str
    assessment: str | None


class ResearchJobResponseV1(ApiModel):
    contract: Literal["research-job-v1"] = JOB_CONTRACT
    job_id: uuid.UUID
    status: JobStatus
    deduplicated: bool = False
    movement_type: str | None
    capture_mode: str | None
    research_subject_id: uuid.UUID | None
    source_sha256: str | None
    source_bytes: int | None
    pipeline_version: str
    processing_fingerprint: str | None
    attempts: int = Field(ge=0)
    created_at: datetime
    updated_at: datetime
    started_at: datetime | None
    finished_at: datetime | None
    deleted_at: datetime | None
    assessment_id: uuid.UUID | None
    failure: FailureV1 | None
    links: JobLinksV1


class ArtifactV1(ApiModel):
    schema_version: str
    content_sha256: str
    byte_size: int = Field(ge=0)
    data: dict[str, Any] | None


class IntegrityV1(ApiModel):
    record_sha256: str
    summary_sha256: str
    provenance_sha256: str


class ScientificScopeV1(ApiModel):
    claim_stage: Literal["stage_3_video_estimated_movement_mechanics"] = "stage_3_video_estimated_movement_mechanics"
    non_claims: list[str]


SCIENTIFIC_NON_CLAIMS = [
    "Angles are apparent 2D angles between projected landmarks in one camera image, not 3D joint angles.",
    "No comparison against optical motion capture has been completed.",
    "No force-plate validation has been completed.",
    "No ground reaction force is estimated.",
    "No joint moments or other joint kinetics are estimated.",
    "No muscle, tendon or tissue forces or loads are estimated.",
    "No injury, risk, readiness, capacity, diagnosis or movement-quality judgement is made.",
    "Capture quality describes the measurement, not the movement.",
    "Normalized skeleton coordinates are dimensionless image-space units, not physical lengths.",
]


class ResearchAssessmentResultV1(ApiModel):
    contract: Literal["research-assessment-result-v1"] = RESULT_CONTRACT
    assessment_id: uuid.UUID
    job_id: uuid.UUID
    research_subject_id: uuid.UUID | None
    movement_type: str
    capture_mode: str
    source_sha256: str
    processing_key: str
    processing_fingerprint: str
    pipeline_version: str
    versions: dict[str, str]
    provenance: dict[str, Any]
    summary: AssessmentSummary
    integrity: IntegrityV1
    processing_started_at: datetime
    processing_finished_at: datetime
    created_at: datetime
    artifacts: dict[str, ArtifactV1]
    artifacts_included: bool
    scientific_scope: ScientificScopeV1


class ResearchDeletionResponseV1(ApiModel):
    contract: Literal["research-deletion-v1"] = DELETION_CONTRACT
    target: Literal["assessment", "job"]
    id: uuid.UUID
    state: Literal["deleted", "already_deleted"]
    assessment_id: uuid.UUID | None
    jobs_tombstoned: int = Field(ge=0)
    artifacts_removed: int = Field(
        ge=0,
        description=(
            "M7 assessment artifacts removed; excludes M8 trial artifacts and validation results removed by cascade."
        ),
    )


class HealthV1(ApiModel):
    status: Literal["ok", "not_ready"]
    checks: dict[str, Any] = Field(default_factory=dict)
