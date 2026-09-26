"""Milestone 8: force-plate trials, their artifacts, validation results, tombstones.

Revision ID: 0002_force_plate_validation
Revises: 0001_research_initial
Create Date: 2026-09-25

Additive only: no Milestone 7 table, column, trigger or stored value is
changed. Like 0001, this revision is independent of every scientific version
family.

Triggers (Postgres and SQLite):
    * every M8 table rejects UPDATE — stored results are immutable; a new
      processing rule produces a new row under a new key;
    * an INSERT into force_plate_trials is rejected unless the referenced M7
      assessment has the same research_subject_id (NULL-safe), movement,
      capture mode and record SHA-256 — no trial can pair a different
      participant with an assessment;
    * deleting a force_plate_trials row (directly, or by cascade when its M7
      assessment is research-deleted) writes a tombstone (trial id + time).

Referential integrity: trials → research_assessments ON DELETE CASCADE;
artifacts and validation results → trials ON DELETE CASCADE.
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0002_force_plate_validation"
down_revision: str | None = "0001_research_initial"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

TRIAL_ARTIFACT_KINDS = ("measured_signal", "synchronization", "ground_truth")
DATA_ORIGINS = ("research_recording", "synthetic_test_fixture")
M8_TABLES = (
    "force_plate_trials",
    "force_plate_trial_artifacts",
    "grf_validation_results",
    "force_plate_trial_tombstones",
)

LINK_CONDITION = (
    "SELECT 1 FROM research_assessments a WHERE a.id = NEW.assessment_id "
    "AND a.research_subject_id {same} NEW.research_subject_id "
    "AND a.movement_type = NEW.movement_type "
    "AND a.capture_mode = NEW.capture_mode "
    "AND a.record_sha256 = NEW.assessment_record_sha256"
)


def _json() -> sa.types.TypeEngine:
    return sa.JSON().with_variant(postgresql.JSONB(), "postgresql")


def _in(column: str, values: tuple[str, ...]) -> str:
    return f"{column} IN ({', '.join(repr(v) for v in values)})"


def upgrade() -> None:
    op.create_table(
        "force_plate_trials",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column(
            "assessment_id",
            sa.Uuid(),
            sa.ForeignKey("research_assessments.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("assessment_record_sha256", sa.String(64), nullable=False),
        sa.Column("research_subject_id", sa.Uuid()),
        sa.Column("movement_type", sa.String(64), nullable=False),
        sa.Column("capture_mode", sa.String(64), nullable=False),
        sa.Column("data_origin", sa.String(32), nullable=False),
        sa.Column("force_source_sha256", sa.String(64), nullable=False),
        sa.Column("trial_key", sa.String(64), nullable=False, unique=True),
        sa.Column("processing_fingerprint", sa.String(64), nullable=False),
        sa.Column("pipeline_version", sa.String(64), nullable=False),
        sa.Column("versions", _json(), nullable=False),
        sa.Column("provenance", _json(), nullable=False),
        sa.Column("provenance_sha256", sa.String(64), nullable=False),
        sa.Column("summary", _json(), nullable=False),
        sa.Column("summary_sha256", sa.String(64), nullable=False),
        sa.Column("record_sha256", sa.String(64), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint(_in("data_origin", DATA_ORIGINS), name="ck_force_plate_trials_origin"),
    )
    op.create_index("ix_force_plate_trials_assessment", "force_plate_trials", ["assessment_id"])
    op.create_index("ix_force_plate_trials_subject", "force_plate_trials", ["research_subject_id"])
    op.create_index("ix_force_plate_trials_source", "force_plate_trials", ["force_source_sha256"])

    op.create_table(
        "force_plate_trial_artifacts",
        sa.Column(
            "trial_id",
            sa.Uuid(),
            sa.ForeignKey("force_plate_trials.id", ondelete="CASCADE"),
            primary_key=True,
        ),
        sa.Column("kind", sa.String(32), primary_key=True),
        sa.Column("schema_version", sa.String(64), nullable=False),
        sa.Column("content_sha256", sa.String(64), nullable=False),
        sa.Column("byte_size", sa.Integer(), nullable=False),
        sa.Column("data", _json(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint(_in("kind", TRIAL_ARTIFACT_KINDS), name="ck_force_plate_artifacts_kind"),
        sa.CheckConstraint("byte_size >= 0", name="ck_force_plate_artifacts_size"),
    )

    op.create_table(
        "grf_validation_results",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column(
            "trial_id",
            sa.Uuid(),
            sa.ForeignKey("force_plate_trials.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("result_key", sa.String(64), nullable=False, unique=True),
        sa.Column("protocol_version", sa.String(64), nullable=False),
        sa.Column("estimator_name", sa.String(64), nullable=False),
        sa.Column("estimator_version", sa.String(64), nullable=False),
        sa.Column("estimate_sha256", sa.String(64), nullable=False),
        sa.Column("estimate", _json(), nullable=False),
        sa.Column("metrics", _json(), nullable=False),
        sa.Column("metrics_sha256", sa.String(64), nullable=False),
        sa.Column("provenance", _json(), nullable=False),
        sa.Column("provenance_sha256", sa.String(64), nullable=False),
        sa.Column("record_sha256", sa.String(64), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index("ix_grf_validation_results_trial", "grf_validation_results", ["trial_id"])

    op.create_table(
        "force_plate_trial_tombstones",
        sa.Column("trial_id", sa.Uuid(), primary_key=True),
        sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=False),
    )

    dialect = op.get_bind().dialect.name
    if dialect == "postgresql":
        op.execute(
            """
            CREATE FUNCTION force_plate_reject_update() RETURNS trigger LANGUAGE plpgsql AS $$
            BEGIN
              RAISE EXCEPTION 'force-plate research rows are immutable (table %)', TG_TABLE_NAME
                USING ERRCODE = 'restrict_violation';
            END
            $$
            """
        )
        op.execute(
            f"""
            CREATE FUNCTION force_plate_trial_link_check() RETURNS trigger LANGUAGE plpgsql AS $$
            BEGIN
              IF NOT EXISTS ({LINK_CONDITION.format(same="IS NOT DISTINCT FROM")}) THEN
                RAISE EXCEPTION 'force-plate trial does not match its research assessment'
                  USING ERRCODE = 'integrity_constraint_violation';
              END IF;
              RETURN NEW;
            END
            $$
            """
        )
        op.execute(
            """
            CREATE FUNCTION force_plate_trial_tombstone() RETURNS trigger LANGUAGE plpgsql AS $$
            BEGIN
              INSERT INTO force_plate_trial_tombstones (trial_id, deleted_at)
                VALUES (OLD.id, now()) ON CONFLICT (trial_id) DO NOTHING;
              RETURN OLD;
            END
            $$
            """
        )
        for table in M8_TABLES:
            op.execute(
                f"CREATE TRIGGER {table}_immutable BEFORE UPDATE ON {table} "
                "FOR EACH ROW EXECUTE FUNCTION force_plate_reject_update()"
            )
        op.execute(
            "CREATE TRIGGER force_plate_trials_link BEFORE INSERT ON force_plate_trials "
            "FOR EACH ROW EXECUTE FUNCTION force_plate_trial_link_check()"
        )
        op.execute(
            "CREATE TRIGGER force_plate_trials_tombstone AFTER DELETE ON force_plate_trials "
            "FOR EACH ROW EXECUTE FUNCTION force_plate_trial_tombstone()"
        )
    elif dialect == "sqlite":
        for table in M8_TABLES:
            op.execute(
                f"CREATE TRIGGER {table}_immutable BEFORE UPDATE ON {table} "
                "BEGIN SELECT RAISE(ABORT, 'force-plate research rows are immutable'); END"
            )
        op.execute(
            "CREATE TRIGGER force_plate_trials_link BEFORE INSERT ON force_plate_trials "
            f"WHEN NOT EXISTS ({LINK_CONDITION.format(same='IS')}) "
            "BEGIN SELECT RAISE(ABORT, 'force-plate trial does not match its research assessment'); END"
        )
        # Six fractional digits, the storage format SQLAlchemy writes for DateTime.
        op.execute(
            "CREATE TRIGGER force_plate_trials_tombstone AFTER DELETE ON force_plate_trials "
            "BEGIN INSERT OR IGNORE INTO force_plate_trial_tombstones (trial_id, deleted_at) VALUES "
            "(OLD.id, strftime('%Y-%m-%d %H:%M:%S', 'now') || '.' || substr(strftime('%f', 'now'), 4) || '000'); "
            "END"
        )


def downgrade() -> None:
    dialect = op.get_bind().dialect.name
    owners = {f"{t}_immutable": t for t in M8_TABLES}
    owners["force_plate_trials_link"] = "force_plate_trials"
    owners["force_plate_trials_tombstone"] = "force_plate_trials"
    for trigger, table in owners.items():
        op.execute(f"DROP TRIGGER IF EXISTS {trigger}" + (f" ON {table}" if dialect == "postgresql" else ""))
    if dialect == "postgresql":
        for fn in ("force_plate_reject_update", "force_plate_trial_link_check", "force_plate_trial_tombstone"):
            op.execute(f"DROP FUNCTION IF EXISTS {fn}()")
    op.drop_table("force_plate_trial_tombstones")
    op.drop_index("ix_grf_validation_results_trial", table_name="grf_validation_results")
    op.drop_table("grf_validation_results")
    op.drop_table("force_plate_trial_artifacts")
    op.drop_index("ix_force_plate_trials_source", table_name="force_plate_trials")
    op.drop_index("ix_force_plate_trials_subject", table_name="force_plate_trials")
    op.drop_index("ix_force_plate_trials_assessment", table_name="force_plate_trials")
    op.drop_table("force_plate_trials")
