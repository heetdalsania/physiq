"""Milestone 8 tables (SQLAlchemy Core) on the research schema's shared MetaData.

Created ONLY by the Alembic migration ``0002_force_plate_validation`` —
never at start-up. ``tests/test_force_plate_storage.py`` checks that the
migrated schema matches these definitions.

force_plate_trials            one immutable row per paired trial: identity,
                              link to ONE immutable M7 assessment (FK, ON
                              DELETE CASCADE — research deletion of the
                              assessment removes every M8 record derived from
                              it), inherited research_subject_id, force-source
                              digest, versions, provenance, summary, digests.
force_plate_trial_artifacts   the canonical measured signal, the
                              synchronization and the ground truth of a trial
                              (immutable; cascade with their trial).
grf_validation_results        one immutable row per (trial, estimate,
                              validation protocol): the estimate that was
                              compared, the metrics and their provenance.
force_plate_trial_tombstones  trial id + deletion time only, written by a
                              database trigger whenever a trial row is removed
                              (directly or by cascade), so a repeated deletion
                              answers ``already_deleted``.

Database triggers (migration): every M8 table rejects UPDATE; an INSERT into
force_plate_trials is rejected unless the referenced assessment has exactly
the same research_subject_id (NULL-safe), movement, capture mode and record
SHA-256 — a trial can never pair a different participant with an
assessment.

No column holds a name, e-mail, phone, address, account id, filename, file
path, free text or raw export bytes.
"""

from __future__ import annotations

from sqlalchemy import CheckConstraint, Column, DateTime, ForeignKey, Index, Integer, String, Table, Uuid

from physiq_research.storage.tables import JsonColumn, metadata

TRIAL_ARTIFACT_KINDS = ("measured_signal", "synchronization", "ground_truth")
DATA_ORIGINS = ("research_recording", "synthetic_test_fixture")


def _in(column: str, values: tuple[str, ...]) -> str:
    return f"{column} IN ({', '.join(repr(v) for v in values)})"


force_plate_trials = Table(
    "force_plate_trials",
    metadata,
    Column("id", Uuid, primary_key=True),
    Column("assessment_id", Uuid, ForeignKey("research_assessments.id", ondelete="CASCADE"), nullable=False),
    Column("assessment_record_sha256", String(64), nullable=False),
    Column("research_subject_id", Uuid),
    Column("movement_type", String(64), nullable=False),
    Column("capture_mode", String(64), nullable=False),
    Column("data_origin", String(32), nullable=False),
    Column("force_source_sha256", String(64), nullable=False),
    Column("trial_key", String(64), nullable=False, unique=True),
    Column("processing_fingerprint", String(64), nullable=False),
    Column("pipeline_version", String(64), nullable=False),
    Column("versions", JsonColumn, nullable=False),
    Column("provenance", JsonColumn, nullable=False),
    Column("provenance_sha256", String(64), nullable=False),
    Column("summary", JsonColumn, nullable=False),
    Column("summary_sha256", String(64), nullable=False),
    Column("record_sha256", String(64), nullable=False),
    Column("created_at", DateTime(timezone=True), nullable=False),
    CheckConstraint(_in("data_origin", DATA_ORIGINS), name="ck_force_plate_trials_origin"),
    Index("ix_force_plate_trials_assessment", "assessment_id"),
    Index("ix_force_plate_trials_subject", "research_subject_id"),
    Index("ix_force_plate_trials_source", "force_source_sha256"),
)

force_plate_trial_artifacts = Table(
    "force_plate_trial_artifacts",
    metadata,
    Column("trial_id", Uuid, ForeignKey("force_plate_trials.id", ondelete="CASCADE"), primary_key=True),
    Column("kind", String(32), primary_key=True),
    Column("schema_version", String(64), nullable=False),
    Column("content_sha256", String(64), nullable=False),
    Column("byte_size", Integer, nullable=False),
    Column("data", JsonColumn, nullable=False),
    Column("created_at", DateTime(timezone=True), nullable=False),
    CheckConstraint(_in("kind", TRIAL_ARTIFACT_KINDS), name="ck_force_plate_artifacts_kind"),
    CheckConstraint("byte_size >= 0", name="ck_force_plate_artifacts_size"),
)

grf_validation_results = Table(
    "grf_validation_results",
    metadata,
    Column("id", Uuid, primary_key=True),
    Column("trial_id", Uuid, ForeignKey("force_plate_trials.id", ondelete="CASCADE"), nullable=False),
    Column("result_key", String(64), nullable=False, unique=True),
    Column("protocol_version", String(64), nullable=False),
    Column("estimator_name", String(64), nullable=False),
    Column("estimator_version", String(64), nullable=False),
    Column("estimate_sha256", String(64), nullable=False),
    Column("estimate", JsonColumn, nullable=False),
    Column("metrics", JsonColumn, nullable=False),
    Column("metrics_sha256", String(64), nullable=False),
    Column("provenance", JsonColumn, nullable=False),
    Column("provenance_sha256", String(64), nullable=False),
    Column("record_sha256", String(64), nullable=False),
    Column("created_at", DateTime(timezone=True), nullable=False),
    Index("ix_grf_validation_results_trial", "trial_id"),
)

force_plate_trial_tombstones = Table(
    "force_plate_trial_tombstones",
    metadata,
    Column("trial_id", Uuid, primary_key=True),
    Column("deleted_at", DateTime(timezone=True), nullable=False),
)

M8_TABLES = (
    "force_plate_trials",
    "force_plate_trial_artifacts",
    "grf_validation_results",
    "force_plate_trial_tombstones",
)
