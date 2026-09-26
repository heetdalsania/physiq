"""Research backend initial schema: jobs, immutable assessments, artifacts.

Revision ID: 0001_research_initial
Revises:
Create Date: 2026-09-25

This database migration version is independent of every scientific version
family (research-pipeline, normalized-skeleton, kinematic-features, pose
model, …): changing the schema never changes a stored value, and a new
algorithm version never needs a migration merely to exist.

Immutability: once written, rows of research_assessments and
research_assessment_artifacts cannot be UPDATEd (a trigger rejects it on
Postgres and on SQLite). Scientific outputs therefore cannot silently
change after a code upgrade; reprocessing creates a new assessment under a
new processing key, and research deletion removes rows (DELETE is allowed).
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0001_research_initial"
down_revision: str | None = None
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

JOB_STATUSES = ("queued", "processing", "succeeded", "failed", "deleted")
ARTIFACT_KINDS = ("pose_series", "normalized_skeleton", "kinematic_traces", "time_normalized_traces")


def _json() -> sa.types.TypeEngine:
    return sa.JSON().with_variant(postgresql.JSONB(), "postgresql")


def _in(column: str, values: tuple[str, ...]) -> str:
    return f"{column} IN ({', '.join(repr(v) for v in values)})"


def upgrade() -> None:
    op.create_table(
        "research_jobs",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("status", sa.String(16), nullable=False),
        sa.Column("movement_type", sa.String(64)),
        sa.Column("capture_mode", sa.String(64)),
        sa.Column("research_subject_id", sa.Uuid()),
        sa.Column("source_sha256", sa.String(64)),
        sa.Column("source_bytes", sa.BigInteger()),
        sa.Column("upload_token", sa.String(80)),
        sa.Column("idempotency_key", sa.String(64)),
        sa.Column("processing_fingerprint", sa.String(64)),
        sa.Column("pipeline_version", sa.String(64), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("started_at", sa.DateTime(timezone=True)),
        sa.Column("finished_at", sa.DateTime(timezone=True)),
        sa.Column("deleted_at", sa.DateTime(timezone=True)),
        sa.Column("attempts", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("lease_owner", sa.String(128)),
        sa.Column("lease_expires_at", sa.DateTime(timezone=True)),
        sa.Column("heartbeat_at", sa.DateTime(timezone=True)),
        sa.Column("failure_code", sa.String(64)),
        sa.Column("failure_detail", sa.String(128)),
        sa.Column("failure_stage", sa.String(32)),
        sa.Column("failure_diagnostics", _json()),
        sa.Column("assessment_id", sa.Uuid()),
        sa.CheckConstraint(_in("status", JOB_STATUSES), name="ck_research_jobs_status"),
        sa.CheckConstraint("attempts >= 0", name="ck_research_jobs_attempts"),
    )
    op.create_index("ix_research_jobs_status_created", "research_jobs", ["status", "created_at"])
    op.create_index("ix_research_jobs_idempotency_key", "research_jobs", ["idempotency_key"])
    op.create_index("ix_research_jobs_assessment_id", "research_jobs", ["assessment_id"])

    op.create_table(
        "research_assessments",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("job_id", sa.Uuid(), sa.ForeignKey("research_jobs.id", ondelete="RESTRICT"), nullable=False),
        sa.Column("processing_key", sa.String(64), nullable=False, unique=True),
        sa.Column("processing_fingerprint", sa.String(64), nullable=False),
        sa.Column("research_subject_id", sa.Uuid()),
        sa.Column("movement_type", sa.String(64), nullable=False),
        sa.Column("capture_mode", sa.String(64), nullable=False),
        sa.Column("source_sha256", sa.String(64), nullable=False),
        sa.Column("pipeline_version", sa.String(64), nullable=False),
        sa.Column("versions", _json(), nullable=False),
        sa.Column("provenance", _json(), nullable=False),
        sa.Column("provenance_sha256", sa.String(64), nullable=False),
        sa.Column("summary", _json(), nullable=False),
        sa.Column("summary_sha256", sa.String(64), nullable=False),
        sa.Column("record_sha256", sa.String(64), nullable=False),
        sa.Column("processing_started_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("processing_finished_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index("ix_research_assessments_subject", "research_assessments", ["research_subject_id"])
    op.create_index("ix_research_assessments_source", "research_assessments", ["source_sha256"])

    op.create_table(
        "research_assessment_artifacts",
        sa.Column(
            "assessment_id",
            sa.Uuid(),
            sa.ForeignKey("research_assessments.id", ondelete="CASCADE"),
            primary_key=True,
        ),
        sa.Column("kind", sa.String(32), primary_key=True),
        sa.Column("schema_version", sa.String(64), nullable=False),
        sa.Column("content_sha256", sa.String(64), nullable=False),
        sa.Column("byte_size", sa.Integer(), nullable=False),
        sa.Column("data", _json(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint(_in("kind", ARTIFACT_KINDS), name="ck_research_artifacts_kind"),
        sa.CheckConstraint("byte_size >= 0", name="ck_research_artifacts_size"),
    )

    dialect = op.get_bind().dialect.name
    if dialect == "postgresql":
        op.execute(
            """
            CREATE FUNCTION research_reject_update() RETURNS trigger LANGUAGE plpgsql AS $$
            BEGIN
              RAISE EXCEPTION 'research assessment rows are immutable (table %)', TG_TABLE_NAME
                USING ERRCODE = 'restrict_violation';
            END
            $$
            """
        )
        for table in ("research_assessments", "research_assessment_artifacts"):
            op.execute(
                f"CREATE TRIGGER {table}_immutable BEFORE UPDATE ON {table} "
                "FOR EACH ROW EXECUTE FUNCTION research_reject_update()"
            )
    elif dialect == "sqlite":
        for table in ("research_assessments", "research_assessment_artifacts"):
            op.execute(
                f"CREATE TRIGGER {table}_immutable BEFORE UPDATE ON {table} "
                f"BEGIN SELECT RAISE(ABORT, 'research assessment rows are immutable'); END"
            )


def downgrade() -> None:
    dialect = op.get_bind().dialect.name
    for table in ("research_assessments", "research_assessment_artifacts"):
        op.execute(f"DROP TRIGGER IF EXISTS {table}_immutable" + (f" ON {table}" if dialect == "postgresql" else ""))
    if dialect == "postgresql":
        op.execute("DROP FUNCTION IF EXISTS research_reject_update()")
    op.drop_table("research_assessment_artifacts")
    op.drop_index("ix_research_assessments_source", table_name="research_assessments")
    op.drop_index("ix_research_assessments_subject", table_name="research_assessments")
    op.drop_table("research_assessments")
    op.drop_index("ix_research_jobs_assessment_id", table_name="research_jobs")
    op.drop_index("ix_research_jobs_idempotency_key", table_name="research_jobs")
    op.drop_index("ix_research_jobs_status_created", table_name="research_jobs")
    op.drop_table("research_jobs")
