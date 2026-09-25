"""Research job queue and derived-data repository.

Job queue semantics (a deliberately simple, database-backed prototype for a
single-worker research environment — NOT a production distributed queue):

    queued ──claim──▶ processing ──▶ succeeded | failed
       │                  │  └─ lease expired ─▶ queued (attempt < max) | failed (worker_lost)
       └──── DELETE ──────┴──────▶ deleted (scrubbed tombstone; also after succeeded/failed)

* Claiming is an atomic compare-and-set (``UPDATE … WHERE id = :id AND
  status = 'queued'``); two workers can never both own a job. On Postgres the
  candidate row is also selected ``FOR UPDATE SKIP LOCKED``.
* Ownership is a lease (``lease_owner``, ``lease_expires_at``) renewed by the
  worker's heartbeat. Every state change a worker makes is conditional on
  still owning the lease, so a worker whose lease was reclaimed cannot write.
* A lease that expires (worker killed, machine slept) is recovered by any
  worker: re-queued while attempts remain and the upload still exists,
  otherwise failed as ``worker_lost`` and the upload deleted.
* Success is ONE transaction: the job flips to ``succeeded`` and the
  assessment plus all four artifacts are inserted together, or nothing is.
  No successful assessment row can exist without its artifacts.

Moving to Redis/SQS/etc. would replace ``claim_next``/``heartbeat``/
``recover_expired`` with the broker's receive/visibility-timeout/redelivery,
and keep the rest (the job row remains the source of truth for status).
"""

from __future__ import annotations

import uuid
from collections.abc import Callable
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from typing import Any

from sqlalchemy import Engine, delete, func, insert, select, update
from sqlalchemy.engine import Connection, Row
from sqlalchemy.exc import IntegrityError

from physiq_research.canonical import canonical_bytes, canonical_digest, sha256_hex
from physiq_research.failures import FailureCode, JobCancelled, LeaseLost
from physiq_research.pipeline.record import AssessmentRecord, ProvenanceRecord
from physiq_research.records import (
    ARTIFACT_KINDS,
    ARTIFACT_MODELS,
    ARTIFACT_SCHEMAS,
    AssessmentSummary,
    FailureDiagnostics,
)
from physiq_research.storage.tables import research_assessment_artifacts as artifacts_t
from physiq_research.storage.tables import research_assessments as assessments_t
from physiq_research.storage.tables import research_jobs as jobs_t
from physiq_research.versions import RESEARCH_PIPELINE_VERSION


def utcnow() -> datetime:
    return datetime.now(UTC)


def _aware(value: datetime | None) -> datetime | None:
    if value is None:
        return None
    return value if value.tzinfo is not None else value.replace(tzinfo=UTC)


class StoredDataError(RuntimeError):
    """A stored value failed its integrity or schema check on read."""

    def __init__(self, code: str) -> None:
        super().__init__(code)
        self.code = code


@dataclass(frozen=True)
class JobView:
    id: uuid.UUID
    status: str
    movement_type: str | None
    capture_mode: str | None
    research_subject_id: uuid.UUID | None
    source_sha256: str | None
    source_bytes: int | None
    upload_token: str | None
    idempotency_key: str | None
    processing_fingerprint: str | None
    pipeline_version: str
    created_at: datetime
    updated_at: datetime
    started_at: datetime | None
    finished_at: datetime | None
    deleted_at: datetime | None
    attempts: int
    lease_owner: str | None
    lease_expires_at: datetime | None
    failure_code: str | None
    failure_detail: str | None
    failure_stage: str | None
    failure_diagnostics: dict[str, Any] | None
    assessment_id: uuid.UUID | None

    @classmethod
    def from_row(cls, row: Row[Any]) -> JobView:
        m = row._mapping
        return cls(
            id=m["id"],
            status=m["status"],
            movement_type=m["movement_type"],
            capture_mode=m["capture_mode"],
            research_subject_id=m["research_subject_id"],
            source_sha256=m["source_sha256"],
            source_bytes=m["source_bytes"],
            upload_token=m["upload_token"],
            idempotency_key=m["idempotency_key"],
            processing_fingerprint=m["processing_fingerprint"],
            pipeline_version=m["pipeline_version"],
            created_at=_aware(m["created_at"]),  # type: ignore[arg-type]
            updated_at=_aware(m["updated_at"]),  # type: ignore[arg-type]
            started_at=_aware(m["started_at"]),
            finished_at=_aware(m["finished_at"]),
            deleted_at=_aware(m["deleted_at"]),
            attempts=m["attempts"],
            lease_owner=m["lease_owner"],
            lease_expires_at=_aware(m["lease_expires_at"]),
            failure_code=m["failure_code"],
            failure_detail=m["failure_detail"],
            failure_stage=m["failure_stage"],
            failure_diagnostics=m["failure_diagnostics"],
            assessment_id=m["assessment_id"],
        )


@dataclass(frozen=True)
class StoredArtifact:
    kind: str
    schema_version: str
    content_sha256: str
    byte_size: int
    data: dict[str, Any] | None  # None when read with include_artifacts=False


@dataclass(frozen=True)
class StoredAssessment:
    id: uuid.UUID
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
    provenance_sha256: str
    summary: dict[str, Any]
    summary_sha256: str
    record_sha256: str
    processing_started_at: datetime
    processing_finished_at: datetime
    created_at: datetime
    artifacts: dict[str, StoredArtifact]


@dataclass(frozen=True)
class DeletionOutcome:
    state: str  # "deleted" | "already_deleted" | "not_found"
    assessment_id: uuid.UUID | None
    jobs_tombstoned: int
    artifacts_removed: int
    upload_tokens: tuple[str, ...] = ()


_TOMBSTONE_SCRUB: dict[str, Any] = {
    "movement_type": None,
    "capture_mode": None,
    "research_subject_id": None,
    "source_sha256": None,
    "source_bytes": None,
    "upload_token": None,
    "idempotency_key": None,
    "processing_fingerprint": None,
    "lease_owner": None,
    "lease_expires_at": None,
    "heartbeat_at": None,
    "failure_code": None,
    "failure_detail": None,
    "failure_stage": None,
    "failure_diagnostics": None,
}


def record_digest(
    *,
    versions: dict[str, str],
    provenance_sha256: str,
    summary_sha256: str,
    artifact_digests: dict[str, str],
    source_sha256: str,
    processing_key: str,
    processing_fingerprint: str,
    research_subject_id: uuid.UUID | None,
    movement_type: str,
    capture_mode: str,
) -> str:
    return canonical_digest(
        {
            "versions": versions,
            "provenance_sha256": provenance_sha256,
            "summary_sha256": summary_sha256,
            "artifacts": artifact_digests,
            "source_sha256": source_sha256,
            "processing_key": processing_key,
            "processing_fingerprint": processing_fingerprint,
            "research_subject_id": str(research_subject_id) if research_subject_id else None,
            "movement_type": movement_type,
            "capture_mode": capture_mode,
        }
    )


class ResearchRepository:
    def __init__(self, engine: Engine, clock: Callable[[], datetime] = utcnow) -> None:
        self.engine = engine
        self.clock = clock

    # ── jobs ────────────────────────────────────────────────────────────
    def create_job(
        self,
        *,
        movement_type: str,
        capture_mode: str,
        research_subject_id: uuid.UUID | None,
        source_sha256: str,
        source_bytes: int,
        upload_token: str,
        idempotency_key: str,
        processing_fingerprint: str,
    ) -> JobView:
        now = self.clock()
        job_id = uuid.uuid4()
        with self.engine.begin() as conn:
            conn.execute(
                insert(jobs_t).values(
                    id=job_id,
                    status="queued",
                    movement_type=movement_type,
                    capture_mode=capture_mode,
                    research_subject_id=research_subject_id,
                    source_sha256=source_sha256,
                    source_bytes=source_bytes,
                    upload_token=upload_token,
                    idempotency_key=idempotency_key,
                    processing_fingerprint=processing_fingerprint,
                    pipeline_version=RESEARCH_PIPELINE_VERSION,
                    created_at=now,
                    updated_at=now,
                    attempts=0,
                )
            )
            return self._job(conn, job_id)  # type: ignore[return-value]

    def _job(self, conn: Connection, job_id: uuid.UUID) -> JobView | None:
        row = conn.execute(select(jobs_t).where(jobs_t.c.id == job_id)).first()
        return JobView.from_row(row) if row is not None else None

    def get_job(self, job_id: uuid.UUID) -> JobView | None:
        with self.engine.connect() as conn:
            return self._job(conn, job_id)

    def find_job_by_key(self, key: str) -> JobView | None:
        """Most recent non-deleted job with this idempotency key."""
        with self.engine.connect() as conn:
            row = conn.execute(
                select(jobs_t)
                .where(jobs_t.c.idempotency_key == key, jobs_t.c.status != "deleted")
                .order_by(jobs_t.c.created_at.desc(), jobs_t.c.id.desc())
                .limit(1)
            ).first()
        return JobView.from_row(row) if row is not None else None

    def active_upload_tokens(self) -> set[str]:
        with self.engine.connect() as conn:
            rows = conn.execute(
                select(jobs_t.c.upload_token).where(
                    jobs_t.c.status.in_(("queued", "processing")), jobs_t.c.upload_token.is_not(None)
                )
            ).all()
        return {r[0] for r in rows}

    def count_by_status(self) -> dict[str, int]:
        with self.engine.connect() as conn:
            rows = conn.execute(select(jobs_t.c.status, func.count()).group_by(jobs_t.c.status)).all()
        return {r[0]: int(r[1]) for r in rows}

    def claim_next(self, owner: str, lease_seconds: int) -> JobView | None:
        for _ in range(5):
            now = self.clock()
            with self.engine.begin() as conn:
                candidate = conn.execute(
                    select(jobs_t.c.id)
                    .where(jobs_t.c.status == "queued")
                    .order_by(jobs_t.c.created_at, jobs_t.c.id)
                    .limit(1)
                    .with_for_update(skip_locked=True)
                ).first()
                if candidate is None:
                    return None
                result = conn.execute(
                    update(jobs_t)
                    .where(jobs_t.c.id == candidate[0], jobs_t.c.status == "queued")
                    .values(
                        status="processing",
                        lease_owner=owner,
                        lease_expires_at=now + timedelta(seconds=lease_seconds),
                        heartbeat_at=now,
                        started_at=func.coalesce(jobs_t.c.started_at, now),
                        attempts=jobs_t.c.attempts + 1,
                        updated_at=now,
                    )
                )
                if result.rowcount == 1:
                    return self._job(conn, candidate[0])
        return None

    def _owned(self, job_id: uuid.UUID, owner: str) -> Any:
        return (jobs_t.c.id == job_id) & (jobs_t.c.status == "processing") & (jobs_t.c.lease_owner == owner)

    def _lost(self, conn: Connection, job_id: uuid.UUID) -> Exception:
        job = self._job(conn, job_id)
        if job is None or job.status == "deleted":
            return JobCancelled(str(job_id))
        return LeaseLost(str(job_id))

    def heartbeat(self, job_id: uuid.UUID, owner: str, lease_seconds: int) -> None:
        """Renew the lease. Raises JobCancelled (deleted) or LeaseLost."""
        now = self.clock()
        with self.engine.begin() as conn:
            result = conn.execute(
                update(jobs_t)
                .where(self._owned(job_id, owner))
                .values(lease_expires_at=now + timedelta(seconds=lease_seconds), heartbeat_at=now, updated_at=now)
            )
            if result.rowcount != 1:
                raise self._lost(conn, job_id)

    def mark_failed(
        self,
        job_id: uuid.UUID,
        owner: str | None,
        *,
        code: FailureCode,
        detail: str,
        stage: str,
        diagnostics: dict[str, Any] | None,
    ) -> bool:
        """Terminal failure. With ``owner`` the change is lease-conditional."""
        now = self.clock()
        diag = FailureDiagnostics.model_validate(diagnostics).model_dump(mode="json") if diagnostics else None
        condition = (
            self._owned(job_id, owner)
            if owner is not None
            else ((jobs_t.c.id == job_id) & jobs_t.c.status.in_(("queued", "processing")))
        )
        with self.engine.begin() as conn:
            result = conn.execute(
                update(jobs_t)
                .where(condition)
                .values(
                    status="failed",
                    failure_code=str(code),
                    failure_detail=detail[:128],
                    failure_stage=stage[:32],
                    failure_diagnostics=diag,
                    finished_at=now,
                    updated_at=now,
                    upload_token=None,
                    lease_owner=None,
                    lease_expires_at=None,
                )
            )
            return result.rowcount == 1

    def save_success(self, record: AssessmentRecord, owner: str) -> uuid.UUID:
        """Atomically: job → succeeded, assessment + all artifacts inserted.

        If an assessment with the same processing key already exists (a
        concurrent duplicate), the job is linked to it and nothing is
        overwritten. Raises JobCancelled/LeaseLost if the job is no longer
        this worker's.
        """
        now = self.clock()
        summary = record.summary.model_dump(mode="json")
        provenance = record.provenance.model_dump(mode="json")
        artifact_rows = []
        artifact_digests: dict[str, str] = {}
        for kind in ARTIFACT_KINDS:
            data = record.artifacts[kind].model_dump(mode="json")
            raw = canonical_bytes(data)
            digest = sha256_hex(raw)
            artifact_digests[kind] = digest
            artifact_rows.append(
                {
                    "assessment_id": record.assessment_id,
                    "kind": kind,
                    "schema_version": ARTIFACT_SCHEMAS[kind],
                    "content_sha256": digest,
                    "byte_size": len(raw),
                    "data": data,
                    "created_at": now,
                }
            )
        summary_sha = canonical_digest(summary)
        provenance_sha = canonical_digest(provenance)
        rec_sha = record_digest(
            versions=record.versions,
            provenance_sha256=provenance_sha,
            summary_sha256=summary_sha,
            artifact_digests=artifact_digests,
            source_sha256=record.source_sha256,
            processing_key=record.processing_key,
            processing_fingerprint=record.processing_fingerprint,
            research_subject_id=record.research_subject_id,
            movement_type=record.movement_type,
            capture_mode=record.capture_mode,
        )
        with self.engine.begin() as conn:
            result = conn.execute(
                update(jobs_t)
                .where(self._owned(record.job_id, owner))
                .values(
                    status="succeeded",
                    assessment_id=record.assessment_id,
                    finished_at=now,
                    updated_at=now,
                    upload_token=None,
                    lease_owner=None,
                    lease_expires_at=None,
                    failure_code=None,
                    failure_detail=None,
                    failure_stage=None,
                    failure_diagnostics=None,
                )
            )
            if result.rowcount != 1:
                raise self._lost(conn, record.job_id)
            savepoint = conn.begin_nested()
            try:
                conn.execute(
                    insert(assessments_t).values(
                        id=record.assessment_id,
                        job_id=record.job_id,
                        processing_key=record.processing_key,
                        processing_fingerprint=record.processing_fingerprint,
                        research_subject_id=record.research_subject_id,
                        movement_type=record.movement_type,
                        capture_mode=record.capture_mode,
                        source_sha256=record.source_sha256,
                        pipeline_version=record.versions["research_pipeline"],
                        versions=record.versions,
                        provenance=provenance,
                        provenance_sha256=provenance_sha,
                        summary=summary,
                        summary_sha256=summary_sha,
                        record_sha256=rec_sha,
                        processing_started_at=record.processing_started_at,
                        processing_finished_at=record.processing_finished_at,
                        created_at=now,
                    )
                )
                conn.execute(insert(artifacts_t), artifact_rows)
                savepoint.commit()
                return record.assessment_id
            except IntegrityError:
                savepoint.rollback()
                existing = conn.execute(
                    select(assessments_t.c.id).where(assessments_t.c.processing_key == record.processing_key)
                ).first()
                if existing is None:
                    raise
                conn.execute(update(jobs_t).where(jobs_t.c.id == record.job_id).values(assessment_id=existing[0]))
                return existing[0]  # type: ignore[no-any-return]

    def recover_expired(
        self, *, max_attempts: int, upload_exists: Callable[[str | None], bool]
    ) -> list[tuple[uuid.UUID, str, str | None]]:
        """Handle processing jobs whose lease expired. Returns
        (job_id, "requeued" | "failed", token_to_delete)."""
        now = self.clock()
        out: list[tuple[uuid.UUID, str, str | None]] = []
        with self.engine.connect() as conn:
            rows = conn.execute(
                select(jobs_t).where(jobs_t.c.status == "processing", jobs_t.c.lease_expires_at < now)
            ).all()
        for row in rows:
            job = JobView.from_row(row)
            still = (
                (jobs_t.c.id == job.id)
                & (jobs_t.c.status == "processing")
                & (jobs_t.c.lease_owner == job.lease_owner)
                & (jobs_t.c.lease_expires_at < now)
            )
            with self.engine.begin() as conn:
                if job.attempts < max_attempts and upload_exists(job.upload_token):
                    result = conn.execute(
                        update(jobs_t)
                        .where(still)
                        .values(status="queued", lease_owner=None, lease_expires_at=None, updated_at=now)
                    )
                    if result.rowcount == 1:
                        out.append((job.id, "requeued", None))
                else:
                    result = conn.execute(
                        update(jobs_t)
                        .where(still)
                        .values(
                            status="failed",
                            failure_code=str(FailureCode.WORKER_LOST),
                            failure_detail="lease_expired",
                            failure_stage="queue",
                            finished_at=now,
                            updated_at=now,
                            upload_token=None,
                            lease_owner=None,
                            lease_expires_at=None,
                        )
                    )
                    if result.rowcount == 1:
                        out.append((job.id, "failed", job.upload_token))
        return out

    def expire_old_queued(self, max_age_s: int) -> list[tuple[uuid.UUID, str | None]]:
        now = self.clock()
        cutoff = now - timedelta(seconds=max_age_s)
        out: list[tuple[uuid.UUID, str | None]] = []
        with self.engine.begin() as conn:
            rows = conn.execute(
                select(jobs_t.c.id, jobs_t.c.upload_token).where(
                    jobs_t.c.status == "queued", jobs_t.c.created_at < cutoff
                )
            ).all()
            for job_id, token in rows:
                result = conn.execute(
                    update(jobs_t)
                    .where(jobs_t.c.id == job_id, jobs_t.c.status == "queued")
                    .values(
                        status="failed",
                        failure_code=str(FailureCode.UPLOAD_EXPIRED),
                        failure_detail="queued_too_long",
                        failure_stage="queue",
                        finished_at=now,
                        updated_at=now,
                        upload_token=None,
                    )
                )
                if result.rowcount == 1:
                    out.append((job_id, token))
        return out

    # ── deletion ────────────────────────────────────────────────────────
    def _tombstone(self, conn: Connection, where: Any, now: datetime) -> tuple[int, list[str]]:
        tokens = [r[0] for r in conn.execute(select(jobs_t.c.upload_token).where(where)).all() if r[0]]
        result = conn.execute(
            update(jobs_t).where(where).values(status="deleted", deleted_at=now, updated_at=now, **_TOMBSTONE_SCRUB)
        )
        return result.rowcount, tokens

    def delete_assessment(self, assessment_id: uuid.UUID) -> DeletionOutcome:
        now = self.clock()
        with self.engine.begin() as conn:
            exists = conn.execute(select(assessments_t.c.id).where(assessments_t.c.id == assessment_id)).first()
            if exists is None:
                tomb = conn.execute(
                    select(func.count())
                    .select_from(jobs_t)
                    .where(jobs_t.c.assessment_id == assessment_id, jobs_t.c.status == "deleted")
                ).scalar_one()
                return DeletionOutcome("already_deleted" if tomb else "not_found", assessment_id, 0, 0)
            jobs_n, tokens = self._tombstone(conn, jobs_t.c.assessment_id == assessment_id, now)
            removed = conn.execute(delete(artifacts_t).where(artifacts_t.c.assessment_id == assessment_id)).rowcount
            conn.execute(delete(assessments_t).where(assessments_t.c.id == assessment_id))
            return DeletionOutcome("deleted", assessment_id, jobs_n, removed, tuple(tokens))

    def delete_job(self, job_id: uuid.UUID) -> DeletionOutcome:
        """Research deletion of one job: cancels queued/processing work,
        scrubs failed jobs, and deletes the assessment of a succeeded job."""
        job = self.get_job(job_id)
        if job is None:
            return DeletionOutcome("not_found", None, 0, 0)
        if job.status == "deleted":
            return DeletionOutcome("already_deleted", job.assessment_id, 0, 0)
        if job.status == "succeeded" and job.assessment_id is not None:
            return self.delete_assessment(job.assessment_id)
        now = self.clock()
        with self.engine.begin() as conn:
            n, tokens = self._tombstone(conn, (jobs_t.c.id == job_id) & (jobs_t.c.status != "deleted"), now)
        return DeletionOutcome("deleted" if n else "already_deleted", None, n, 0, tuple(tokens))

    # ── assessments ─────────────────────────────────────────────────────
    def get_assessment(self, assessment_id: uuid.UUID, *, include_artifacts: bool = True) -> StoredAssessment | None:
        """Read, integrity-check (digests) and schema-validate a stored record."""
        with self.engine.connect() as conn:
            row = conn.execute(select(assessments_t).where(assessments_t.c.id == assessment_id)).first()
            if row is None:
                return None
            art_rows = conn.execute(select(artifacts_t).where(artifacts_t.c.assessment_id == assessment_id)).all()
        m = row._mapping
        summary = m["summary"]
        provenance = m["provenance"]
        if not isinstance(summary, dict) or canonical_digest(summary) != m["summary_sha256"]:
            raise StoredDataError("summary_integrity")
        if not isinstance(provenance, dict) or canonical_digest(provenance) != m["provenance_sha256"]:
            raise StoredDataError("provenance_integrity")
        try:
            AssessmentSummary.model_validate(summary)
            ProvenanceRecord.model_validate(provenance)
        except ValueError:
            raise StoredDataError("summary_schema") from None
        artifacts: dict[str, StoredArtifact] = {}
        digests: dict[str, str] = {}
        for ar in art_rows:
            a = ar._mapping
            kind = a["kind"]
            data = a["data"]
            if kind not in ARTIFACT_MODELS or not isinstance(data, dict):
                raise StoredDataError("artifact_schema")
            if canonical_digest(data) != a["content_sha256"]:
                raise StoredDataError("artifact_integrity")
            digests[kind] = a["content_sha256"]
            if include_artifacts:
                if (
                    a["schema_version"] != ARTIFACT_SCHEMAS[kind]
                    or data.get("schema_version") != ARTIFACT_SCHEMAS[kind]
                ):
                    raise StoredDataError("artifact_schema")
                try:
                    ARTIFACT_MODELS[kind].model_validate(data)
                except ValueError:
                    raise StoredDataError("artifact_schema") from None
            artifacts[kind] = StoredArtifact(
                kind, a["schema_version"], a["content_sha256"], a["byte_size"], data if include_artifacts else None
            )
        if set(digests) != set(ARTIFACT_KINDS):
            raise StoredDataError("artifacts_incomplete")
        expected = record_digest(
            versions=m["versions"],
            provenance_sha256=m["provenance_sha256"],
            summary_sha256=m["summary_sha256"],
            artifact_digests=digests,
            source_sha256=m["source_sha256"],
            processing_key=m["processing_key"],
            processing_fingerprint=m["processing_fingerprint"],
            research_subject_id=m["research_subject_id"],
            movement_type=m["movement_type"],
            capture_mode=m["capture_mode"],
        )
        if expected != m["record_sha256"]:
            raise StoredDataError("record_integrity")
        return StoredAssessment(
            id=m["id"],
            job_id=m["job_id"],
            research_subject_id=m["research_subject_id"],
            movement_type=m["movement_type"],
            capture_mode=m["capture_mode"],
            source_sha256=m["source_sha256"],
            processing_key=m["processing_key"],
            processing_fingerprint=m["processing_fingerprint"],
            pipeline_version=m["pipeline_version"],
            versions=m["versions"],
            provenance=provenance,
            provenance_sha256=m["provenance_sha256"],
            summary=summary,
            summary_sha256=m["summary_sha256"],
            record_sha256=m["record_sha256"],
            processing_started_at=_aware(m["processing_started_at"]),  # type: ignore[arg-type]
            processing_finished_at=_aware(m["processing_finished_at"]),  # type: ignore[arg-type]
            created_at=_aware(m["created_at"]),  # type: ignore[arg-type]
            artifacts=artifacts,
        )
