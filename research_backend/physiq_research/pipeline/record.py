"""The complete derived research record produced by one successful job."""

from __future__ import annotations

import uuid
from dataclasses import dataclass
from datetime import datetime
from typing import Any

from pydantic import BaseModel, ConfigDict, model_validator

from physiq_research.canonical import canonical_json
from physiq_research.records import ARTIFACT_KINDS, AssessmentSummary, Strict

PROVENANCE_SECTIONS = (
    "source",
    "decoder",
    "orientation",
    "sampling",
    "pose",
    "normalization",
    "segmentation",
    "features",
    "pipeline",
    "media_limits",
)


class ProvenanceRecord(BaseModel):
    """Answers: which source video, decoder, orientation transform, sampling
    contract, pose provider/model/hash, normalization, segmentation
    semantics, feature schema and pipeline version — and when."""

    model_config = ConfigDict(extra="forbid", frozen=True, allow_inf_nan=False)

    source: dict[str, Any]
    decoder: dict[str, Any]
    orientation: dict[str, Any]
    sampling: dict[str, Any]
    pose: dict[str, Any]
    normalization: dict[str, Any]
    segmentation: dict[str, Any]
    features: dict[str, Any]
    pipeline: dict[str, Any]
    media_limits: dict[str, Any]

    @model_validator(mode="after")
    def _json_finite(self) -> ProvenanceRecord:
        canonical_json(self.model_dump())  # raises on NaN/Infinity/unsupported types
        return self


@dataclass(frozen=True)
class AssessmentRecord:
    assessment_id: uuid.UUID
    job_id: uuid.UUID
    research_subject_id: uuid.UUID | None
    movement_type: str
    capture_mode: str
    source_sha256: str
    processing_fingerprint: str
    processing_key: str
    versions: dict[str, str]
    provenance: ProvenanceRecord
    summary: AssessmentSummary
    artifacts: dict[str, Strict]
    processing_started_at: datetime
    processing_finished_at: datetime

    def __post_init__(self) -> None:
        if set(self.artifacts) != set(ARTIFACT_KINDS):
            raise ValueError("a successful assessment has every artifact kind")
