"""Link to ONE existing, immutable Milestone 7 assessment.

M8 consumes the stored M7 record — it never reruns or forks the pose,
segmentation or skeleton pipeline. The record is read through M7's own
repository, which recomputes every digest and schema-validates the summary
and provenance before anything is returned (a tampered record is refused).

Taken from the record, unchanged:
    * identity: assessment id, record SHA-256 (pins the exact record),
      research_subject_id, movement, capture mode, source-video SHA-256,
      M7 versions and processing fingerprint;
    * media-time support [0, t of the last accepted decoded frame] — M7's
      clock, (pts − pts₀) × time_base;
    * the repetition [descent_start_ms, ascent_end_ms] and deepest_ms from
      ``summary.segmentation.events`` (M6/M7 semantics, not redefined);
    * the standing calibration window from ``summary.calibration``.

Nothing is ever written to M7 tables.
"""

from __future__ import annotations

import math
import uuid
from dataclasses import dataclass
from typing import Any

from sqlalchemy import func, select

from physiq_research.force_plate.errors import ForcePlateError
from physiq_research.force_plate.manifest import ForcePlateManifest
from physiq_research.force_plate.versions import CAPTURE_MODE, MOVEMENT
from physiq_research.storage.repository import ResearchRepository, StoredAssessment, StoredDataError
from physiq_research.storage.tables import research_jobs


@dataclass(frozen=True)
class LinkedAssessment:
    assessment_id: uuid.UUID
    record_sha256: str
    research_subject_id: uuid.UUID | None
    movement_type: str
    capture_mode: str
    source_video_sha256: str
    pipeline_version: str
    processing_fingerprint: str
    versions: dict[str, str]
    media_end_ms: float
    descent_start_ms: float
    deepest_ms: float
    ascent_end_ms: float
    calibration_start_ms: float
    calibration_end_ms: float

    def describe(self) -> dict[str, Any]:
        """The ``link`` provenance section of a trial."""
        return {
            "assessment_id": str(self.assessment_id),
            "assessment_record_sha256": self.record_sha256,
            "research_subject_id": str(self.research_subject_id) if self.research_subject_id else None,
            "movement_type": self.movement_type,
            "capture_mode": self.capture_mode,
            "source_video_sha256": self.source_video_sha256,
            "m7_pipeline_version": self.pipeline_version,
            "m7_processing_fingerprint": self.processing_fingerprint,
            "m7_versions": dict(self.versions),
            "media_time_definition": "(pts - pts0) * time_base of the first decoded frame, in ms (M7)",
            "media_support_ms": [0.0, self.media_end_ms],
            "repetition_source": "summary.segmentation.events (M7 kinematic-features-v0.1)",
            "standing_window_source": "summary.calibration window (M7)",
        }


def _finite(value: object) -> float:
    if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(float(value)):
        raise ForcePlateError("assessment_media_support_unavailable")
    return float(value)


def linked_from_stored(stored: StoredAssessment) -> LinkedAssessment:
    """Extract the M8 view of an already integrity-verified M7 record."""
    try:
        decode = stored.provenance["source"]["technical"]["decode"]
        media_end = _finite(decode["last_frame_t_ms"])
        source_video = stored.provenance["source"]["sha256"]
    except (KeyError, TypeError):
        raise ForcePlateError("assessment_media_support_unavailable") from None
    events = stored.summary["segmentation"]["events"]
    calibration = stored.summary["calibration"]
    linked = LinkedAssessment(
        assessment_id=stored.id,
        record_sha256=stored.record_sha256,
        research_subject_id=stored.research_subject_id,
        movement_type=stored.movement_type,
        capture_mode=stored.capture_mode,
        source_video_sha256=str(source_video),
        pipeline_version=stored.pipeline_version,
        processing_fingerprint=stored.processing_fingerprint,
        versions=dict(stored.versions),
        media_end_ms=media_end,
        descent_start_ms=float(events["descent_start_ms"]),
        deepest_ms=float(events["deepest_ms"]),
        ascent_end_ms=float(events["ascent_end_ms"]),
        calibration_start_ms=float(calibration["window_start_ms"]),
        calibration_end_ms=float(calibration["window_end_ms"]),
    )
    if not 0.0 < linked.ascent_end_ms <= linked.media_end_ms:
        raise ForcePlateError("assessment_media_support_unavailable")
    return linked


def check_supported(linked: LinkedAssessment) -> None:
    if linked.movement_type != MOVEMENT:
        raise ForcePlateError("unsupported_assessment_movement")
    if linked.capture_mode != CAPTURE_MODE:
        raise ForcePlateError("unsupported_assessment_capture_mode")


def check_manifest_matches(manifest: ForcePlateManifest, linked: LinkedAssessment) -> None:
    if manifest.assessment_id != linked.assessment_id:  # pragma: no cover - caller reads by this id
        raise ForcePlateError("assessment_link_mismatch")
    if (manifest.movement_type, manifest.capture_mode) != (linked.movement_type, linked.capture_mode):
        raise ForcePlateError("assessment_declaration_mismatch")
    # Inherit, never re-pair: both null, or the same participant.
    if manifest.research_subject_id != linked.research_subject_id:
        raise ForcePlateError("research_subject_mismatch", field="research_subject_id")


def read_linked_assessment(m7: ResearchRepository, assessment_id: uuid.UUID) -> LinkedAssessment:
    try:
        stored = m7.get_assessment(assessment_id, include_artifacts=False)
    except StoredDataError:
        raise ForcePlateError("assessment_integrity_error") from None
    if stored is None:
        with m7.engine.connect() as conn:
            tombstones = conn.execute(
                select(func.count())
                .select_from(research_jobs)
                .where(research_jobs.c.assessment_id == assessment_id, research_jobs.c.status == "deleted")
            ).scalar_one()
        raise ForcePlateError("assessment_deleted" if tombstones else "assessment_not_found")
    linked = linked_from_stored(stored)
    check_supported(linked)
    return linked
