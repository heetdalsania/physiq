"""Persistence of force-plate trials and validation results.

Writes
    * A trial is ONE transaction: the trial row and its three artifacts are
      inserted together or not at all (a failure after the trial row rolls
      the row back). A concurrent import of the same inputs under the same
      contract (same ``trial_key``) returns the existing trial.
    * A validation result is one row, keyed by (trial record, estimate,
      protocol); a repeated evaluation returns the existing result.
    * Nothing is ever updated (database triggers reject UPDATE). A changed
      processing rule means a new version → a new key → a new row.

Reads verify before serving: every digest (artifacts, summary, provenance,
record), every schema, the exact derivation invariants of the ground truth
(``ground_truth.verify_consistency``), summary/artifact agreement, and the
link to the immutable M7 record (its digest must still equal the one the
trial was built from; the M7 record itself is re-verified by M7's
repository). A failure raises ``StoredDataError`` — never served.

Deletion removes the trial row; its artifacts and validation results
cascade; a trigger writes a tombstone. The linked M7 assessment is never
touched. Deleting an M7 assessment cascades to every trial derived from it.
"""

from __future__ import annotations

import uuid
from collections.abc import Callable
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Any, Literal

from pydantic import BaseModel, ValidationError
from sqlalchemy import Engine, delete, func, insert, select
from sqlalchemy.engine import Connection
from sqlalchemy.exc import IntegrityError

from physiq_research.canonical import canonical_bytes, canonical_digest, sha256_hex
from physiq_research.force_plate.errors import ForcePlateError
from physiq_research.force_plate.estimate import VerticalGrfEstimate
from physiq_research.force_plate.ground_truth import verify_consistency
from physiq_research.force_plate.records import (
    TRIAL_ARTIFACT_KINDS,
    TRIAL_ARTIFACT_MODELS,
    TRIAL_ARTIFACT_SCHEMAS,
    Strict,
    TrialProvenance,
    TrialSummary,
    ValidationMetrics,
    ValidationProvenance,
)
from physiq_research.force_plate.tables import (
    force_plate_trial_artifacts as artifacts_t,
)
from physiq_research.force_plate.tables import (
    force_plate_trial_tombstones as tombstones_t,
)
from physiq_research.force_plate.tables import (
    force_plate_trials as trials_t,
)
from physiq_research.force_plate.tables import (
    grf_validation_results as results_t,
)
from physiq_research.storage.repository import ResearchRepository, StoredDataError, utcnow
from physiq_research.storage.tables import research_assessments

Faults = Callable[[str], None]


def _aware(value: datetime) -> datetime:
    return value if value.tzinfo is not None else value.replace(tzinfo=UTC)


@dataclass(frozen=True)
class TrialRecord:
    """A complete, schema-checked trial ready to be written."""

    trial_id: uuid.UUID
    assessment_id: uuid.UUID
    assessment_record_sha256: str
    research_subject_id: uuid.UUID | None
    movement_type: str
    capture_mode: str
    data_origin: str
    force_source_sha256: str
    trial_key: str
    processing_fingerprint: str
    pipeline_version: str
    versions: dict[str, str]
    provenance: TrialProvenance
    summary: TrialSummary
    artifacts: dict[str, Strict]

    def __post_init__(self) -> None:
        if set(self.artifacts) != set(TRIAL_ARTIFACT_KINDS):
            raise ValueError("a trial has every artifact kind")


@dataclass(frozen=True)
class StoredArtifact:
    kind: str
    schema_version: str
    content_sha256: str
    byte_size: int
    data: dict[str, Any] | None  # None when read with include_artifacts=False


@dataclass(frozen=True)
class StoredTrial:
    id: uuid.UUID
    assessment_id: uuid.UUID
    assessment_record_sha256: str
    research_subject_id: uuid.UUID | None
    movement_type: str
    capture_mode: str
    data_origin: str
    force_source_sha256: str
    trial_key: str
    processing_fingerprint: str
    pipeline_version: str
    versions: dict[str, str]
    provenance: dict[str, Any]
    provenance_sha256: str
    summary: dict[str, Any]
    summary_sha256: str
    record_sha256: str
    created_at: datetime
    artifacts: dict[str, StoredArtifact]


@dataclass(frozen=True)
class ValidationRecord:
    result_id: uuid.UUID
    trial_id: uuid.UUID
    result_key: str
    estimate: VerticalGrfEstimate
    metrics: ValidationMetrics
    provenance: ValidationProvenance


@dataclass(frozen=True)
class StoredValidation:
    id: uuid.UUID
    trial_id: uuid.UUID
    result_key: str
    protocol_version: str
    estimator_name: str
    estimator_version: str
    estimate_sha256: str
    estimate: dict[str, Any]
    metrics: dict[str, Any]
    metrics_sha256: str
    provenance: dict[str, Any]
    provenance_sha256: str
    record_sha256: str
    created_at: datetime


@dataclass(frozen=True)
class TrialDeletion:
    state: Literal["deleted", "already_deleted", "not_found"]
    trial_id: uuid.UUID
    artifacts_removed: int
    validation_results_removed: int


def trial_record_digest(
    *,
    trial_id: uuid.UUID,
    assessment_id: uuid.UUID,
    assessment_record_sha256: str,
    research_subject_id: uuid.UUID | None,
    movement_type: str,
    capture_mode: str,
    data_origin: str,
    force_source_sha256: str,
    trial_key: str,
    processing_fingerprint: str,
    pipeline_version: str,
    versions: dict[str, str],
    summary_sha256: str,
    provenance_sha256: str,
    artifact_digests: dict[str, str],
) -> str:
    return canonical_digest(
        {
            "trial_id": str(trial_id),
            "assessment_id": str(assessment_id),
            "assessment_record_sha256": assessment_record_sha256,
            "research_subject_id": str(research_subject_id) if research_subject_id else None,
            "movement_type": movement_type,
            "capture_mode": capture_mode,
            "data_origin": data_origin,
            "force_source_sha256": force_source_sha256,
            "trial_key": trial_key,
            "processing_fingerprint": processing_fingerprint,
            "pipeline_version": pipeline_version,
            "versions": versions,
            "summary_sha256": summary_sha256,
            "provenance_sha256": provenance_sha256,
            "artifacts": artifact_digests,
        }
    )


def validation_record_digest(
    *,
    result_id: uuid.UUID,
    trial_id: uuid.UUID,
    result_key: str,
    protocol_version: str,
    estimator_name: str,
    estimator_version: str,
    estimate_sha256: str,
    metrics_sha256: str,
    provenance_sha256: str,
) -> str:
    return canonical_digest(
        {
            "result_id": str(result_id),
            "trial_id": str(trial_id),
            "result_key": result_key,
            "protocol_version": protocol_version,
            "estimator_name": estimator_name,
            "estimator_version": estimator_version,
            "estimate_sha256": estimate_sha256,
            "metrics_sha256": metrics_sha256,
            "provenance_sha256": provenance_sha256,
        }
    )


def _validate(model: type[BaseModel], data: object, code: str) -> None:
    try:
        model.model_validate(data)
    except (ValidationError, ValueError):
        raise StoredDataError(code) from None


class ForcePlateRepository:
    def __init__(self, engine: Engine, clock: Callable[[], datetime] = utcnow, faults: Faults | None = None) -> None:
        self.engine = engine
        self.clock = clock
        self.faults = faults
        self.m7 = ResearchRepository(engine)

    def _fault(self, point: str) -> None:
        if self.faults is not None:
            self.faults(point)

    # ── trials: write ───────────────────────────────────────────────────
    def save_trial(self, record: TrialRecord) -> tuple[uuid.UUID, bool]:
        """Insert atomically. Returns (trial id, deduplicated)."""
        now = self.clock()
        summary = record.summary.model_dump(mode="json")
        provenance = record.provenance.model_dump(mode="json")
        artifact_rows: list[dict[str, Any]] = []
        digests: dict[str, str] = {}
        for kind in TRIAL_ARTIFACT_KINDS:
            data = record.artifacts[kind].model_dump(mode="json")
            raw = canonical_bytes(data)
            digests[kind] = sha256_hex(raw)
            artifact_rows.append(
                {
                    "trial_id": record.trial_id,
                    "kind": kind,
                    "schema_version": TRIAL_ARTIFACT_SCHEMAS[kind],
                    "content_sha256": digests[kind],
                    "byte_size": len(raw),
                    "data": data,
                    "created_at": now,
                }
            )
        summary_sha = canonical_digest(summary)
        provenance_sha = canonical_digest(provenance)
        record_sha = trial_record_digest(
            trial_id=record.trial_id,
            assessment_id=record.assessment_id,
            assessment_record_sha256=record.assessment_record_sha256,
            research_subject_id=record.research_subject_id,
            movement_type=record.movement_type,
            capture_mode=record.capture_mode,
            data_origin=record.data_origin,
            force_source_sha256=record.force_source_sha256,
            trial_key=record.trial_key,
            processing_fingerprint=record.processing_fingerprint,
            pipeline_version=record.pipeline_version,
            versions=record.versions,
            summary_sha256=summary_sha,
            provenance_sha256=provenance_sha,
            artifact_digests=digests,
        )
        row = {
            "id": record.trial_id,
            "assessment_id": record.assessment_id,
            "assessment_record_sha256": record.assessment_record_sha256,
            "research_subject_id": record.research_subject_id,
            "movement_type": record.movement_type,
            "capture_mode": record.capture_mode,
            "data_origin": record.data_origin,
            "force_source_sha256": record.force_source_sha256,
            "trial_key": record.trial_key,
            "processing_fingerprint": record.processing_fingerprint,
            "pipeline_version": record.pipeline_version,
            "versions": record.versions,
            "provenance": provenance,
            "provenance_sha256": provenance_sha,
            "summary": summary,
            "summary_sha256": summary_sha,
            "record_sha256": record_sha,
            "created_at": now,
        }
        for _ in range(3):
            with self.engine.begin() as conn:
                existing = self._trial_by_key(conn, record.trial_key)
                if existing is not None:
                    return existing, True
                savepoint = conn.begin_nested()
                try:
                    conn.execute(insert(trials_t).values(**row))
                    self._fault("after_trial_row")
                    conn.execute(insert(artifacts_t), artifact_rows)
                    self._fault("after_artifacts")
                    savepoint.commit()
                    return record.trial_id, False
                except IntegrityError:
                    savepoint.rollback()
                    existing = self._trial_by_key(conn, record.trial_key)
                    if existing is not None:
                        return existing, True  # a concurrent import of the same inputs won
                    self._raise_link_problem(conn, record)
            # The conflicting trial was deleted before we could read it: retry.
        raise ForcePlateError("internal_error")  # pragma: no cover - three consecutive races

    @staticmethod
    def _trial_by_key(conn: Connection, key: str) -> uuid.UUID | None:
        found = conn.execute(select(trials_t.c.id).where(trials_t.c.trial_key == key)).first()
        return found[0] if found is not None else None

    @staticmethod
    def _raise_link_problem(conn: Connection, record: TrialRecord) -> None:
        a = research_assessments
        row = conn.execute(
            select(a.c.research_subject_id, a.c.movement_type, a.c.capture_mode, a.c.record_sha256).where(
                a.c.id == record.assessment_id
            )
        ).first()
        if row is None:
            raise ForcePlateError("assessment_not_found")  # deleted meanwhile (FK / link trigger)
        if tuple(row) != (
            record.research_subject_id,
            record.movement_type,
            record.capture_mode,
            record.assessment_record_sha256,
        ):
            raise ForcePlateError("assessment_link_mismatch")
        # Otherwise the key conflict came from a trial deleted since: caller retries.

    # ── trials: read ────────────────────────────────────────────────────
    def trial_state(self, trial_id: uuid.UUID) -> Literal["present", "deleted", "not_found"]:
        with self.engine.connect() as conn:
            if conn.execute(select(trials_t.c.id).where(trials_t.c.id == trial_id)).first() is not None:
                return "present"
            tomb = conn.execute(select(tombstones_t.c.trial_id).where(tombstones_t.c.trial_id == trial_id)).first()
        return "deleted" if tomb is not None else "not_found"

    def deleted_at(self, trial_id: uuid.UUID) -> datetime | None:
        with self.engine.connect() as conn:
            row = conn.execute(select(tombstones_t.c.deleted_at).where(tombstones_t.c.trial_id == trial_id)).first()
        return _aware(row[0]) if row is not None else None

    def list_trials(self, assessment_id: uuid.UUID | None = None) -> list[dict[str, Any]]:
        query = select(
            trials_t.c.id,
            trials_t.c.assessment_id,
            trials_t.c.research_subject_id,
            trials_t.c.data_origin,
            trials_t.c.pipeline_version,
            trials_t.c.created_at,
        ).order_by(trials_t.c.created_at, trials_t.c.id)
        if assessment_id is not None:
            query = query.where(trials_t.c.assessment_id == assessment_id)
        with self.engine.connect() as conn:
            rows = conn.execute(query).all()
        return [
            {
                "trial_id": str(r.id),
                "assessment_id": str(r.assessment_id),
                "research_subject_id": str(r.research_subject_id) if r.research_subject_id else None,
                "data_origin": r.data_origin,
                "pipeline_version": r.pipeline_version,
                "created_at": _aware(r.created_at).isoformat(),
            }
            for r in rows
        ]

    def get_trial(
        self, trial_id: uuid.UUID, *, include_artifacts: bool = True, verify_link: bool = True
    ) -> StoredTrial | None:
        """Read and fully verify a trial (see the module docstring).

        The trial row, its artifacts and the linked M7 row are read by separate
        statements. If a research deletion commits between them, the partial
        read is reported as "absent" (None) — never as corrupted data — after
        re-checking that the trial row is really gone.
        """
        try:
            return self._read_trial(trial_id, include_artifacts=include_artifacts, verify_link=verify_link)
        except StoredDataError:
            if self.trial_state(trial_id) != "present":
                return None  # deleted while being read
            raise

    def _read_trial(self, trial_id: uuid.UUID, *, include_artifacts: bool, verify_link: bool) -> StoredTrial | None:
        with self.engine.connect() as conn:
            row = conn.execute(select(trials_t).where(trials_t.c.id == trial_id)).first()
            if row is None:
                return None
            art_rows = conn.execute(select(artifacts_t).where(artifacts_t.c.trial_id == trial_id)).all()
            linked_digest = conn.execute(
                select(research_assessments.c.record_sha256).where(
                    research_assessments.c.id == row._mapping["assessment_id"]
                )
            ).scalar_one_or_none()
        m = row._mapping
        summary, provenance = m["summary"], m["provenance"]
        if not isinstance(summary, dict) or canonical_digest(summary) != m["summary_sha256"]:
            raise StoredDataError("summary_integrity")
        if not isinstance(provenance, dict) or canonical_digest(provenance) != m["provenance_sha256"]:
            raise StoredDataError("provenance_integrity")
        _validate(TrialSummary, summary, "summary_schema")
        _validate(TrialProvenance, provenance, "provenance_schema")

        data: dict[str, dict[str, Any]] = {}
        stored: dict[str, StoredArtifact] = {}
        for ar in art_rows:
            a = ar._mapping
            kind, doc = a["kind"], a["data"]
            if kind not in TRIAL_ARTIFACT_MODELS or not isinstance(doc, dict):
                raise StoredDataError("artifact_schema")
            if canonical_digest(doc) != a["content_sha256"]:
                raise StoredDataError("artifact_integrity")
            if a["schema_version"] != TRIAL_ARTIFACT_SCHEMAS[kind] or doc.get("schema_version") != a["schema_version"]:
                raise StoredDataError("artifact_schema")
            _validate(TRIAL_ARTIFACT_MODELS[kind], doc, "artifact_schema")
            data[kind] = doc
            stored[kind] = StoredArtifact(
                kind, a["schema_version"], a["content_sha256"], a["byte_size"], doc if include_artifacts else None
            )
        if set(data) != set(TRIAL_ARTIFACT_KINDS):
            raise StoredDataError("artifacts_incomplete")
        expected = trial_record_digest(
            trial_id=m["id"],
            assessment_id=m["assessment_id"],
            assessment_record_sha256=m["assessment_record_sha256"],
            research_subject_id=m["research_subject_id"],
            movement_type=m["movement_type"],
            capture_mode=m["capture_mode"],
            data_origin=m["data_origin"],
            force_source_sha256=m["force_source_sha256"],
            trial_key=m["trial_key"],
            processing_fingerprint=m["processing_fingerprint"],
            pipeline_version=m["pipeline_version"],
            versions=m["versions"],
            summary_sha256=m["summary_sha256"],
            provenance_sha256=m["provenance_sha256"],
            artifact_digests={k: v.content_sha256 for k, v in stored.items()},
        )
        if expected != m["record_sha256"]:
            raise StoredDataError("record_integrity")
        try:
            verify_consistency(data["measured_signal"], data["synchronization"], data["ground_truth"])
        except (ValueError, KeyError, TypeError):
            raise StoredDataError("ground_truth_derivation") from None
        _agree(summary, data)
        if linked_digest != m["assessment_record_sha256"]:
            raise StoredDataError("assessment_link")
        if verify_link:
            try:
                if self.m7.get_assessment(m["assessment_id"], include_artifacts=False) is None:
                    raise StoredDataError("assessment_link")  # cascade-deleted meanwhile, or missing
            except StoredDataError as exc:
                if exc.code == "assessment_link":
                    raise
                raise StoredDataError("assessment_integrity") from None
        return StoredTrial(
            id=m["id"],
            assessment_id=m["assessment_id"],
            assessment_record_sha256=m["assessment_record_sha256"],
            research_subject_id=m["research_subject_id"],
            movement_type=m["movement_type"],
            capture_mode=m["capture_mode"],
            data_origin=m["data_origin"],
            force_source_sha256=m["force_source_sha256"],
            trial_key=m["trial_key"],
            processing_fingerprint=m["processing_fingerprint"],
            pipeline_version=m["pipeline_version"],
            versions=m["versions"],
            provenance=provenance,
            provenance_sha256=m["provenance_sha256"],
            summary=summary,
            summary_sha256=m["summary_sha256"],
            record_sha256=m["record_sha256"],
            created_at=_aware(m["created_at"]),
            artifacts=stored,
        )

    # ── trials: delete ──────────────────────────────────────────────────
    def delete_trial(self, trial_id: uuid.UUID) -> TrialDeletion:
        """Research deletion of one trial. Idempotent; never touches M7 rows."""
        with self.engine.begin() as conn:
            found = conn.execute(select(trials_t.c.id).where(trials_t.c.id == trial_id).with_for_update()).first()
            if found is None:
                tomb = conn.execute(select(tombstones_t.c.trial_id).where(tombstones_t.c.trial_id == trial_id)).first()
                return TrialDeletion("already_deleted" if tomb is not None else "not_found", trial_id, 0, 0)
            n_artifacts = conn.execute(
                select(func.count()).select_from(artifacts_t).where(artifacts_t.c.trial_id == trial_id)
            ).scalar_one()
            n_results = conn.execute(
                select(func.count()).select_from(results_t).where(results_t.c.trial_id == trial_id)
            ).scalar_one()
            self._fault("before_delete")
            conn.execute(delete(trials_t).where(trials_t.c.id == trial_id))
            return TrialDeletion("deleted", trial_id, int(n_artifacts), int(n_results))

    # ── validation results ──────────────────────────────────────────────
    def save_validation(self, record: ValidationRecord) -> tuple[uuid.UUID, bool]:
        now = self.clock()
        estimate = record.estimate.model_dump(mode="json")
        metrics = record.metrics.model_dump(mode="json")
        provenance = record.provenance.model_dump(mode="json")
        estimate_sha = canonical_digest(estimate)
        metrics_sha = canonical_digest(metrics)
        provenance_sha = canonical_digest(provenance)
        name, version = record.estimate.estimator.name, record.estimate.estimator.version
        record_sha = validation_record_digest(
            result_id=record.result_id,
            trial_id=record.trial_id,
            result_key=record.result_key,
            protocol_version=record.metrics.protocol_version,
            estimator_name=name,
            estimator_version=version,
            estimate_sha256=estimate_sha,
            metrics_sha256=metrics_sha,
            provenance_sha256=provenance_sha,
        )
        with self.engine.begin() as conn:
            found = conn.execute(select(results_t.c.id).where(results_t.c.result_key == record.result_key)).first()
            if found is not None:
                return found[0], True
            savepoint = conn.begin_nested()
            try:
                conn.execute(
                    insert(results_t).values(
                        id=record.result_id,
                        trial_id=record.trial_id,
                        result_key=record.result_key,
                        protocol_version=record.metrics.protocol_version,
                        estimator_name=name,
                        estimator_version=version,
                        estimate_sha256=estimate_sha,
                        estimate=estimate,
                        metrics=metrics,
                        metrics_sha256=metrics_sha,
                        provenance=provenance,
                        provenance_sha256=provenance_sha,
                        record_sha256=record_sha,
                        created_at=now,
                    )
                )
                self._fault("after_validation_row")
                savepoint.commit()
                return record.result_id, False
            except IntegrityError:
                savepoint.rollback()
                found = conn.execute(select(results_t.c.id).where(results_t.c.result_key == record.result_key)).first()
                if found is not None:
                    return found[0], True
                raise ForcePlateError("trial_deleted") from None  # the trial was deleted meanwhile (FK)

    def list_validations(self, trial_id: uuid.UUID, trial_record_sha256: str) -> list[StoredValidation]:
        """Every validation result of a trial, each verified before return."""
        with self.engine.connect() as conn:
            rows = conn.execute(
                select(results_t)
                .where(results_t.c.trial_id == trial_id)
                .order_by(results_t.c.created_at, results_t.c.id)
            ).all()
        out: list[StoredValidation] = []
        for row in rows:
            m = row._mapping
            estimate, metrics, provenance = m["estimate"], m["metrics"], m["provenance"]
            for doc, digest, code in (
                (estimate, m["estimate_sha256"], "estimate_integrity"),
                (metrics, m["metrics_sha256"], "metrics_integrity"),
                (provenance, m["provenance_sha256"], "validation_provenance_integrity"),
            ):
                if not isinstance(doc, dict) or canonical_digest(doc) != digest:
                    raise StoredDataError(code)
            _validate(VerticalGrfEstimate, estimate, "estimate_schema")
            _validate(ValidationMetrics, metrics, "metrics_schema")
            _validate(ValidationProvenance, provenance, "validation_provenance_schema")
            expected = validation_record_digest(
                result_id=m["id"],
                trial_id=m["trial_id"],
                result_key=m["result_key"],
                protocol_version=m["protocol_version"],
                estimator_name=m["estimator_name"],
                estimator_version=m["estimator_version"],
                estimate_sha256=m["estimate_sha256"],
                metrics_sha256=m["metrics_sha256"],
                provenance_sha256=m["provenance_sha256"],
            )
            if expected != m["record_sha256"]:
                raise StoredDataError("validation_record_integrity")
            trial_ref = provenance.get("trial", {})
            if (
                trial_ref.get("trial_id") != str(trial_id)
                or trial_ref.get("trial_record_sha256") != trial_record_sha256
                or metrics.get("protocol_version") != m["protocol_version"]
                or estimate.get("estimator", {}).get("name") != m["estimator_name"]
                or estimate.get("estimator", {}).get("version") != m["estimator_version"]
            ):
                raise StoredDataError("validation_link")
            out.append(
                StoredValidation(
                    id=m["id"],
                    trial_id=m["trial_id"],
                    result_key=m["result_key"],
                    protocol_version=m["protocol_version"],
                    estimator_name=m["estimator_name"],
                    estimator_version=m["estimator_version"],
                    estimate_sha256=m["estimate_sha256"],
                    estimate=estimate,
                    metrics=metrics,
                    metrics_sha256=m["metrics_sha256"],
                    provenance=provenance,
                    provenance_sha256=m["provenance_sha256"],
                    record_sha256=m["record_sha256"],
                    created_at=_aware(m["created_at"]),
                )
            )
        return out


def _agree(summary: dict[str, Any], data: dict[str, dict[str, Any]]) -> None:
    """The trial summary restates its artifacts; they must agree exactly."""
    truth, sync = data["ground_truth"], data["synchronization"]
    pairs = [
        (summary["body_mass_kg"], truth["body_mass_kg"]),
        (summary["body_weight_n"], truth["body_weight_n"]),
        (summary["synchronization"].get("offset_ms"), sync["mapping"]["offset_ms"]),
        (summary["synchronization"].get("rate"), sync["mapping"]["rate"]),
        (summary["synchronization"].get("method"), sync["method"]),
        (summary["overlap"], sync["overlap"]),
        (summary["repetition"].get("media_ms"), truth["repetition"]["media_ms"]),
    ]
    if any(a != b for a, b in pairs):
        raise StoredDataError("summary_artifact_mismatch")
