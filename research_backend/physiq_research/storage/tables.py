"""Table definitions (SQLAlchemy Core). The schema is created ONLY by the
Alembic migrations in ``migrations/versions`` — never implicitly at
service start-up. ``tests/test_storage.py`` checks that the migrated
schema matches these definitions.

Three tables:

research_jobs                one row per submission; after a research
                             deletion it becomes a scrubbed tombstone
                             (id, status ``deleted``, timestamps and the
                             deleted assessment's opaque id only).
research_assessments         one immutable row per successful job.
research_assessment_artifacts
                             the four derived artifacts of an assessment
                             (pose series, normalized skeleton, kinematic
                             traces, time-normalized traces); immutable,
                             deleted with their assessment (ON DELETE
                             CASCADE).

No table has a column for a name, email, phone, address, account id or any
consumer-app identifier, and none stores raw video or frames.
"""

from __future__ import annotations

from sqlalchemy import (
    JSON,
    BigInteger,
    CheckConstraint,
    Column,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    MetaData,
    String,
    Table,
    Uuid,
)
from sqlalchemy.dialects.postgresql import JSONB

JOB_STATUSES = ("queued", "processing", "succeeded", "failed", "deleted")
ARTIFACT_KINDS = ("pose_series", "normalized_skeleton", "kinematic_traces", "time_normalized_traces")

JsonColumn = JSON().with_variant(JSONB(), "postgresql")

metadata = MetaData()


def _in(column: str, values: tuple[str, ...]) -> str:
    return f"{column} IN ({', '.join(repr(v) for v in values)})"


research_jobs = Table(
    "research_jobs",
    metadata,
    Column("id", Uuid, primary_key=True),
    Column("status", String(16), nullable=False),
    Column("movement_type", String(64)),
    Column("capture_mode", String(64)),
    Column("research_subject_id", Uuid),
    Column("source_sha256", String(64)),
    Column("source_bytes", BigInteger),
    Column("upload_token", String(80)),
    Column("idempotency_key", String(64)),
    Column("processing_fingerprint", String(64)),
    Column("pipeline_version", String(64), nullable=False),
    Column("created_at", DateTime(timezone=True), nullable=False),
    Column("updated_at", DateTime(timezone=True), nullable=False),
    Column("started_at", DateTime(timezone=True)),
    Column("finished_at", DateTime(timezone=True)),
    Column("deleted_at", DateTime(timezone=True)),
    Column("attempts", Integer, nullable=False, server_default="0"),
    Column("lease_owner", String(128)),
    Column("lease_expires_at", DateTime(timezone=True)),
    Column("heartbeat_at", DateTime(timezone=True)),
    Column("failure_code", String(64)),
    Column("failure_detail", String(128)),
    Column("failure_stage", String(32)),
    Column("failure_diagnostics", JsonColumn),
    Column("assessment_id", Uuid),
    CheckConstraint(_in("status", JOB_STATUSES), name="ck_research_jobs_status"),
    CheckConstraint("attempts >= 0", name="ck_research_jobs_attempts"),
    Index("ix_research_jobs_status_created", "status", "created_at"),
    Index("ix_research_jobs_idempotency_key", "idempotency_key"),
    Index("ix_research_jobs_assessment_id", "assessment_id"),
)

research_assessments = Table(
    "research_assessments",
    metadata,
    Column("id", Uuid, primary_key=True),
    Column("job_id", Uuid, ForeignKey("research_jobs.id", ondelete="RESTRICT"), nullable=False),
    Column("processing_key", String(64), nullable=False, unique=True),
    Column("processing_fingerprint", String(64), nullable=False),
    Column("research_subject_id", Uuid),
    Column("movement_type", String(64), nullable=False),
    Column("capture_mode", String(64), nullable=False),
    Column("source_sha256", String(64), nullable=False),
    Column("pipeline_version", String(64), nullable=False),
    Column("versions", JsonColumn, nullable=False),
    Column("provenance", JsonColumn, nullable=False),
    Column("provenance_sha256", String(64), nullable=False),
    Column("summary", JsonColumn, nullable=False),
    Column("summary_sha256", String(64), nullable=False),
    Column("record_sha256", String(64), nullable=False),
    Column("processing_started_at", DateTime(timezone=True), nullable=False),
    Column("processing_finished_at", DateTime(timezone=True), nullable=False),
    Column("created_at", DateTime(timezone=True), nullable=False),
    Index("ix_research_assessments_subject", "research_subject_id"),
    Index("ix_research_assessments_source", "source_sha256"),
)

research_assessment_artifacts = Table(
    "research_assessment_artifacts",
    metadata,
    Column(
        "assessment_id",
        Uuid,
        ForeignKey("research_assessments.id", ondelete="CASCADE"),
        primary_key=True,
    ),
    Column("kind", String(32), primary_key=True),
    Column("schema_version", String(64), nullable=False),
    Column("content_sha256", String(64), nullable=False),
    Column("byte_size", Integer, nullable=False),
    Column("data", JsonColumn, nullable=False),
    Column("created_at", DateTime(timezone=True), nullable=False),
    CheckConstraint(_in("kind", ARTIFACT_KINDS), name="ck_research_artifacts_kind"),
    CheckConstraint("byte_size >= 0", name="ck_research_artifacts_size"),
)
