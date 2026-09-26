"""Force-plate storage: migration, referential integrity, immutability,
integrity on read, reprocessing, deletion, rollback and races — on SQLite
and, with RESEARCH_TEST_POSTGRES_URL, on a fresh real Postgres per test.

SYNTHETIC TEST FIXTURE — NOT HUMAN DATA — NOT VALIDATION EVIDENCE.
"""

from __future__ import annotations

import json
import threading
import uuid
from pathlib import Path
from typing import Any

import pytest
from sqlalchemy import func, insert, inspect, select, text, update
from sqlalchemy.exc import DBAPIError, IntegrityError

import physiq_research.force_plate.tables as m8
from physiq_research.api.schemas import ResearchDeletionResponseV1
from physiq_research.canonical import canonical_digest
from physiq_research.config import Settings
from physiq_research.force_plate import importer as importer_module
from physiq_research.force_plate.comparison import compare_estimate
from physiq_research.force_plate.errors import ForcePlateError
from physiq_research.force_plate.importer import ImportOutcome, import_trial
from physiq_research.force_plate.limits import ForcePlateLimits
from physiq_research.force_plate.repository import ForcePlateRepository, trial_record_digest
from physiq_research.force_plate.versions import DATABASE_SCHEMA_REVISION
from physiq_research.storage.db import current_revision, downgrade, make_engine, upgrade
from physiq_research.storage.repository import ResearchRepository, StoredAssessment, StoredDataError
from physiq_research.storage.tables import metadata, research_assessment_artifacts, research_assessments
from tests.support.force_fixtures import ForceFixture, make_fixture, null_baseline_estimate, process_assessment

LIMITS = ForcePlateLimits()
M8_TABLES = set(m8.M8_TABLES)


def setup_trial(
    settings: Settings, repo: ResearchRepository, video: Path, **fixture: Any
) -> tuple[StoredAssessment, ForceFixture, ImportOutcome]:
    subject = uuid.uuid4()
    assessment = process_assessment(settings, repo, video, subject=subject)
    fx = make_fixture(assessment.id, subject=subject, **fixture)
    return assessment, fx, import_trial(repo.engine, fx.manifest_bytes(), fx.csv, LIMITS)


def count(repo: ResearchRepository, table: Any) -> int:
    with repo.engine.connect() as c:
        return int(c.execute(select(func.count()).select_from(table)).scalar_one())


def evaluate_null(repo: ResearchRepository, assessment: StoredAssessment, trial_id: uuid.UUID) -> Any:
    doc = null_baseline_estimate(repo.get_assessment(assessment.id))  # type: ignore[arg-type]
    return compare_estimate(repo.engine, trial_id, json.dumps(doc).encode(), LIMITS)


# ── schema ──────────────────────────────────────────────────────────────


def test_migration_from_empty_database_is_real_and_reversible(db_settings: Settings) -> None:
    from alembic.autogenerate import compare_metadata
    from alembic.migration import MigrationContext

    engine = make_engine(db_settings.database_url)
    assert current_revision(engine) is None
    upgrade(db_settings.database_url)
    assert current_revision(engine) == DATABASE_SCHEMA_REVISION == "0002_force_plate_validation"
    names = set(inspect(engine).get_table_names())
    assert M8_TABLES <= names and {"research_jobs", "research_assessments"} <= names
    with engine.connect() as conn:
        assert compare_metadata(MigrationContext.configure(conn), metadata) == []
    # 0002 is purely additive: stepping back to 0001 removes exactly the M8 tables
    downgrade(db_settings.database_url, "0001_research_initial")
    left = set(inspect(engine).get_table_names())
    assert not (M8_TABLES & left) and {"research_jobs", "research_assessments", "research_assessment_artifacts"} <= left
    upgrade(db_settings.database_url)
    downgrade(db_settings.database_url, "base")
    assert not (M8_TABLES & set(inspect(engine).get_table_names()))
    upgrade(db_settings.database_url)
    assert current_revision(engine) == DATABASE_SCHEMA_REVISION
    engine.dispose()


def test_no_personal_data_columns(db_repo: ResearchRepository) -> None:
    forbidden = {
        "email",
        "phone",
        "address",
        "account",
        "user",
        "login",
        "filename",
        "file",
        "path",
        "video",
        "frame",
        "image",
        "note",
        "notes",
        "comment",
        "text",
        "dob",
        "birth",
        "sex",
        "age",
        "height",
        "consent",
        "person",
        "participant",
    }
    for table in M8_TABLES:
        for column in inspect(db_repo.engine).get_columns(table):
            parts = set(column["name"].split("_"))
            assert not parts & forbidden, (table, column["name"])
            assert "name" not in parts or column["name"] == "estimator_name", column["name"]  # the estimator's name


# ── referential integrity and database-level guarantees ────────────────


def test_foreign_keys_and_link_trigger(db_settings: Settings, db_repo: ResearchRepository, squat_video: Path) -> None:
    assessment, _fx, out = setup_trial(db_settings, db_repo, squat_video)
    with db_repo.engine.connect() as c:
        row = dict(
            c.execute(select(m8.force_plate_trials).where(m8.force_plate_trials.c.id == out.trial_id)).one()._mapping
        )
    variants = {
        "unknown assessment": {"assessment_id": uuid.uuid4()},
        "different participant": {"research_subject_id": uuid.uuid4()},
        "participant dropped": {"research_subject_id": None},
        "different M7 record digest": {"assessment_record_sha256": "0" * 64},
        "different movement": {"movement_type": "countermovement_jump"},
    }
    for name, change in variants.items():
        bad = {**row, **change, "id": uuid.uuid4(), "trial_key": uuid.uuid4().hex * 2}
        with pytest.raises((IntegrityError, DBAPIError)), db_repo.engine.begin() as c:
            c.execute(insert(m8.force_plate_trials).values(**bad))
        assert count(db_repo, m8.force_plate_trials) == 1, name
    orphan = {
        "trial_id": uuid.uuid4(),
        "kind": "ground_truth",
        "schema_version": "x",
        "content_sha256": "0" * 64,
        "byte_size": 1,
        "data": {},
        "created_at": row["created_at"],
    }
    with pytest.raises(IntegrityError), db_repo.engine.begin() as c:
        c.execute(insert(m8.force_plate_trial_artifacts).values(**orphan))
    assert assessment.id == row["assessment_id"]


def test_stored_rows_are_immutable(db_settings: Settings, db_repo: ResearchRepository, squat_video: Path) -> None:
    assessment, _fx, out = setup_trial(db_settings, db_repo, squat_video)
    evaluate_null(db_repo, assessment, out.trial_id)
    db_repo_m8 = ForcePlateRepository(db_repo.engine)
    ForcePlateRepository(db_repo.engine).delete_trial(uuid.uuid4())  # not found: no tombstone
    other_assessment, _f, other = setup_trial(db_settings, db_repo, squat_video)
    db_repo_m8.delete_trial(other.trial_id)  # creates a tombstone
    for table, column, value in (
        (m8.force_plate_trials, "summary", {"tampered": True}),
        (m8.force_plate_trials, "research_subject_id", uuid.uuid4()),
        (m8.force_plate_trial_artifacts, "content_sha256", "0" * 64),
        (m8.grf_validation_results, "metrics_sha256", "0" * 64),
        (m8.force_plate_trial_tombstones, "deleted_at", _now()),
    ):
        with pytest.raises((DBAPIError, IntegrityError)), db_repo.engine.begin() as c:
            c.execute(update(table).values({column: value}))
    trial = db_repo_m8.get_trial(out.trial_id)
    assert trial is not None and len(db_repo_m8.list_validations(trial.id, trial.record_sha256)) == 1
    assert other_assessment.id != assessment.id


def _now() -> Any:
    from datetime import UTC, datetime

    return datetime.now(UTC)


def _disable_m8_immutability(repo: ResearchRepository) -> None:
    with repo.engine.begin() as c:
        for t in m8.M8_TABLES:
            if repo.engine.dialect.name == "postgresql":
                c.execute(text(f"ALTER TABLE {t} DISABLE TRIGGER {t}_immutable"))
            else:
                c.execute(text(f"DROP TRIGGER {t}_immutable"))


# ── integrity on read ───────────────────────────────────────────────────


def test_restart_durability_and_digests(db_settings: Settings, db_repo: ResearchRepository, squat_video: Path) -> None:
    _a, _fx, out = setup_trial(db_settings, db_repo, squat_video)
    before = ForcePlateRepository(db_repo.engine).get_trial(out.trial_id)
    db_repo.engine.dispose()
    fresh = make_engine(db_settings.database_url)
    after = ForcePlateRepository(fresh).get_trial(out.trial_id)
    assert before is not None and after is not None
    assert after.record_sha256 == before.record_sha256 and after.summary == before.summary
    for kind, art in before.artifacts.items():
        assert after.artifacts[kind].data == art.data and canonical_digest(art.data) == art.content_sha256
    fresh.dispose()


@pytest.mark.parametrize(
    ("what", "code"),
    [
        ("artifact_content", "artifact_integrity"),
        ("summary_content", "summary_integrity"),
        ("provenance_content", "provenance_integrity"),
        ("record_digest", "record_integrity"),
        ("schema_with_consistent_digests", "artifact_schema"),
        ("derivation_with_consistent_digests", "ground_truth_derivation"),
        ("summary_disagrees_with_artifacts", "summary_artifact_mismatch"),
        ("missing_artifact", "artifacts_incomplete"),
        ("link_digest", "assessment_link"),
    ],
)
def test_tampering_is_detected_on_read(
    db_settings: Settings, db_repo: ResearchRepository, squat_video: Path, what: str, code: str
) -> None:
    _a, _fx, out = setup_trial(db_settings, db_repo, squat_video)
    repo = ForcePlateRepository(db_repo.engine)
    _disable_m8_immutability(db_repo)
    t, a = m8.force_plate_trials, m8.force_plate_trial_artifacts
    tid = out.trial_id
    with db_repo.engine.begin() as c:
        row = dict(c.execute(select(t).where(t.c.id == tid)).one()._mapping)
        arts = {r.kind: dict(r._mapping) for r in c.execute(select(a).where(a.c.trial_id == tid)).all()}

    def rewrite_gt(mutate: Any) -> None:
        data = json.loads(json.dumps(arts["ground_truth"]["data"]))
        mutate(data)
        digests = {k: v["content_sha256"] for k, v in arts.items()}
        digests["ground_truth"] = canonical_digest(data)
        record = trial_record_digest(
            trial_id=tid,
            assessment_id=row["assessment_id"],
            assessment_record_sha256=row["assessment_record_sha256"],
            research_subject_id=row["research_subject_id"],
            movement_type=row["movement_type"],
            capture_mode=row["capture_mode"],
            data_origin=row["data_origin"],
            force_source_sha256=row["force_source_sha256"],
            trial_key=row["trial_key"],
            processing_fingerprint=row["processing_fingerprint"],
            pipeline_version=row["pipeline_version"],
            versions=row["versions"],
            summary_sha256=row["summary_sha256"],
            provenance_sha256=row["provenance_sha256"],
            artifact_digests=digests,
        )
        with db_repo.engine.begin() as c:
            c.execute(
                update(a)
                .where(a.c.trial_id == tid, a.c.kind == "ground_truth")
                .values(data=data, content_sha256=digests["ground_truth"])
            )
            c.execute(update(t).where(t.c.id == tid).values(record_sha256=record))

    with db_repo.engine.begin() as c:
        if what == "artifact_content":
            data = {**arts["measured_signal"]["data"], "sample_count": 3}
            c.execute(update(a).where(a.c.trial_id == tid, a.c.kind == "measured_signal").values(data=data))
        elif what == "summary_content":
            c.execute(update(t).where(t.c.id == tid).values(summary={**row["summary"], "body_mass_kg": 71}))
        elif what == "provenance_content":
            prov = json.loads(json.dumps(row["provenance"]))
            prov["source"]["declared_force_unit"] = "kN"
            c.execute(update(t).where(t.c.id == tid).values(provenance=prov))
        elif what == "record_digest":
            c.execute(update(t).where(t.c.id == tid).values(record_sha256="f" * 64))
        elif what == "missing_artifact":
            c.execute(text("DELETE FROM force_plate_trial_artifacts WHERE kind = 'synchronization'"))
        elif what == "link_digest":  # the M7 record changed underneath (triggers bypassed by the owner)
            if db_repo.engine.dialect.name == "postgresql":
                c.execute(text("ALTER TABLE research_assessments DISABLE TRIGGER research_assessments_immutable"))
            else:
                c.execute(text("DROP TRIGGER research_assessments_immutable"))
            c.execute(
                update(research_assessments)
                .where(research_assessments.c.id == row["assessment_id"])
                .values(record_sha256="e" * 64)
            )
    if what == "schema_with_consistent_digests":
        rewrite_gt(lambda d: d.__setitem__("preprocessing", "lowpass_6hz"))
    elif what == "derivation_with_consistent_digests":
        rewrite_gt(lambda d: d["vertical_grf_n"].__setitem__(100, d["vertical_grf_n"][100] + 1.0))
    elif what == "summary_disagrees_with_artifacts":
        rewrite_gt(
            lambda d: (
                d.__setitem__("body_mass_kg", 71.0),
                d.__setitem__("body_weight_n", 71.0 * 9.80665),
                d.__setitem__("vertical_grf_bw", [x / (71.0 * 9.80665) for x in d["vertical_grf_n"]]),
            )
        )
    with pytest.raises(StoredDataError) as info:
        repo.get_trial(tid)
    assert info.value.code == code


def test_tampered_validation_result_is_refused(
    db_settings: Settings, db_repo: ResearchRepository, squat_video: Path
) -> None:
    assessment, _fx, out = setup_trial(db_settings, db_repo, squat_video)
    evaluate_null(db_repo, assessment, out.trial_id)
    repo = ForcePlateRepository(db_repo.engine)
    trial = repo.get_trial(out.trial_id)
    assert trial is not None and len(repo.list_validations(trial.id, trial.record_sha256)) == 1
    _disable_m8_immutability(db_repo)
    r = m8.grf_validation_results
    with db_repo.engine.begin() as c:
        metrics = c.execute(select(r.c.metrics)).scalar_one()
        metrics = {**metrics, "pointwise": {**metrics["pointwise"], "rmse_n": 0.0}}
        c.execute(update(r).values(metrics=metrics))
    with pytest.raises(StoredDataError) as info:
        repo.list_validations(trial.id, trial.record_sha256)
    assert info.value.code == "metrics_integrity"


# ── versioned reprocessing never rewrites ──────────────────────────────


def test_reprocessing_under_a_new_contract_creates_a_new_trial(
    db_settings: Settings, db_repo: ResearchRepository, squat_video: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    assessment, fx, old = setup_trial(db_settings, db_repo, squat_video)
    repo = ForcePlateRepository(db_repo.engine)
    before = repo.get_trial(old.trial_id)
    same = import_trial(db_repo.engine, fx.manifest_bytes(), fx.csv, LIMITS)
    assert same.deduplicated and same.trial_id == old.trial_id
    contract = importer_module.processing_contract()
    contract["parser"] = {**contract["parser"], "number_grammar": "json_number_v2_test"}
    monkeypatch.setattr(importer_module, "processing_fingerprint", lambda _c=None: canonical_digest(contract))
    new = import_trial(db_repo.engine, fx.manifest_bytes(), fx.csv, LIMITS)
    assert not new.deduplicated and new.trial_id != old.trial_id
    after = repo.get_trial(old.trial_id)
    assert before is not None and after is not None and after.record_sha256 == before.record_sha256
    assert {t["trial_id"] for t in repo.list_trials(assessment.id)} == {str(old.trial_id), str(new.trial_id)}


def test_repeated_and_reprocessed_evaluation(
    db_settings: Settings, db_repo: ResearchRepository, squat_video: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    from physiq_research.force_plate import comparison

    assessment, _fx, out = setup_trial(db_settings, db_repo, squat_video)
    first = evaluate_null(db_repo, assessment, out.trial_id)
    again = evaluate_null(db_repo, assessment, out.trial_id)
    assert again.deduplicated and again.result_id == first.result_id
    monkeypatch.setattr(comparison, "evaluation_fingerprint", lambda: "f" * 64)
    newer = evaluate_null(db_repo, assessment, out.trial_id)
    assert not newer.deduplicated and newer.result_id != first.result_id
    assert count(db_repo, m8.grf_validation_results) == 2


# ── deletion ────────────────────────────────────────────────────────────


def test_deletion_is_idempotent_and_leaves_m7_intact(
    db_settings: Settings, db_repo: ResearchRepository, squat_video: Path
) -> None:
    assessment, _fx, out = setup_trial(db_settings, db_repo, squat_video)
    evaluate_null(db_repo, assessment, out.trial_id)
    repo = ForcePlateRepository(db_repo.engine)
    m7_before = db_repo.get_assessment(assessment.id)
    first = repo.delete_trial(out.trial_id)
    assert (first.state, first.artifacts_removed, first.validation_results_removed) == ("deleted", 3, 1)
    for table in (m8.force_plate_trials, m8.force_plate_trial_artifacts, m8.grf_validation_results):
        assert count(db_repo, table) == 0
    assert repo.get_trial(out.trial_id) is None and repo.trial_state(out.trial_id) == "deleted"
    assert repo.deleted_at(out.trial_id) is not None
    assert repo.delete_trial(out.trial_id).state == "already_deleted"
    assert repo.delete_trial(uuid.uuid4()).state == "not_found"
    m7_after = db_repo.get_assessment(assessment.id)
    assert m7_before is not None and m7_after is not None and m7_after.record_sha256 == m7_before.record_sha256
    assert count(db_repo, research_assessment_artifacts) == 4
    # an explicit research operation may import the same data again: a NEW trial, not a resurrection
    fx = make_fixture(assessment.id, subject=assessment.research_subject_id)
    again = import_trial(db_repo.engine, fx.manifest_bytes(), fx.csv, LIMITS)
    assert again.trial_id != out.trial_id and not again.deduplicated


def test_deleting_the_m7_assessment_cascades_to_every_derived_m8_row(
    db_settings: Settings, db_repo: ResearchRepository, squat_video: Path
) -> None:
    assessment, _fx, out = setup_trial(db_settings, db_repo, squat_video)
    evaluate_null(db_repo, assessment, out.trial_id)
    outcome = db_repo.delete_assessment(assessment.id)
    assert outcome.state == "deleted" and outcome.artifacts_removed == 4
    count_description = ResearchDeletionResponseV1.model_json_schema()["properties"]["artifacts_removed"]["description"]
    assert "M7 assessment artifacts" in count_description and "excludes M8" in count_description
    for table in (m8.force_plate_trials, m8.force_plate_trial_artifacts, m8.grf_validation_results):
        assert count(db_repo, table) == 0
    repo = ForcePlateRepository(db_repo.engine)
    assert repo.trial_state(out.trial_id) == "deleted"  # the trigger wrote the tombstone on cascade
    assert repo.delete_trial(out.trial_id).state == "already_deleted"
    with db_repo.engine.connect() as c:
        tomb = c.execute(select(m8.force_plate_trial_tombstones)).all()
    assert [r[0] for r in tomb] == [out.trial_id]
    assert len(tomb[0]) == 2  # trial id and deletion time only


def test_partial_writes_roll_back(db_settings: Settings, db_repo: ResearchRepository, squat_video: Path) -> None:
    subject = uuid.uuid4()
    assessment = process_assessment(db_settings, db_repo, squat_video, subject=subject)
    fx = make_fixture(assessment.id, subject=subject)
    for point in ("after_trial_row", "after_artifacts"):

        def fault(p: str, point: str = point) -> None:
            if p == point:
                raise RuntimeError(f"injected at {point}")

        with pytest.raises(RuntimeError):
            import_trial(db_repo.engine, fx.manifest_bytes(), fx.csv, LIMITS, faults=fault)
        for table in m8.M8_TABLES:
            assert count(db_repo, getattr(m8, table)) == 0, (point, table)
    out = import_trial(db_repo.engine, fx.manifest_bytes(), fx.csv, LIMITS)
    trial = ForcePlateRepository(db_repo.engine).get_trial(out.trial_id)
    assert trial is not None

    def late(p: str) -> None:
        if p == "after_validation_row":
            raise KeyboardInterrupt

    doc = null_baseline_estimate(db_repo.get_assessment(assessment.id))  # type: ignore[arg-type]
    with pytest.raises(KeyboardInterrupt):
        compare_estimate(db_repo.engine, out.trial_id, json.dumps(doc).encode(), LIMITS, faults=late)
    assert count(db_repo, m8.grf_validation_results) == 0


# ── races ───────────────────────────────────────────────────────────────


def test_concurrent_duplicate_imports_create_one_trial(
    db_settings: Settings, db_repo: ResearchRepository, squat_video: Path
) -> None:
    subject = uuid.uuid4()
    assessment = process_assessment(db_settings, db_repo, squat_video, subject=subject)
    fx = make_fixture(assessment.id, subject=subject)
    barrier = threading.Barrier(3)
    results: list[ImportOutcome] = []
    errors: list[BaseException] = []

    def stage(name: str) -> None:
        if name == "database_save":
            barrier.wait(timeout=30)

    def worker() -> None:
        try:
            results.append(import_trial(db_repo.engine, fx.manifest_bytes(), fx.csv, LIMITS, faults=stage))
        except BaseException as exc:  # pragma: no cover - reported below
            errors.append(exc)

    threads = [threading.Thread(target=worker) for _ in range(3)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()
    assert not errors, errors
    assert len({r.trial_id for r in results}) == 1
    assert sorted(r.deduplicated for r in results) == [False, True, True]
    assert count(db_repo, m8.force_plate_trials) == 1 and count(db_repo, m8.force_plate_trial_artifacts) == 3


def test_import_racing_m7_deletion_leaves_nothing(
    db_settings: Settings, db_repo: ResearchRepository, squat_video: Path
) -> None:
    subject = uuid.uuid4()
    assessment = process_assessment(db_settings, db_repo, squat_video, subject=subject)
    fx = make_fixture(assessment.id, subject=subject)

    def delete_first(name: str) -> None:
        if name == "database_save":  # linked, synchronized, ground truth built … then the M7 record goes
            ResearchRepository(db_repo.engine).delete_assessment(assessment.id)

    with pytest.raises(ForcePlateError) as info:
        import_trial(db_repo.engine, fx.manifest_bytes(), fx.csv, LIMITS, faults=delete_first)
    assert info.value.code == "assessment_not_found"
    for table in m8.M8_TABLES:
        assert count(db_repo, getattr(m8, table)) == 0


def test_evaluation_racing_trial_deletion(
    db_settings: Settings, db_repo: ResearchRepository, squat_video: Path
) -> None:
    assessment, _fx, out = setup_trial(db_settings, db_repo, squat_video)
    doc = json.dumps(null_baseline_estimate(db_repo.get_assessment(assessment.id))).encode()  # type: ignore[arg-type]

    def delete_first(name: str) -> None:
        if name == "database_save":
            ForcePlateRepository(db_repo.engine).delete_trial(out.trial_id)

    with pytest.raises(ForcePlateError) as info:
        compare_estimate(db_repo.engine, out.trial_id, doc, LIMITS, faults=delete_first)
    assert info.value.code == "trial_deleted"
    assert count(db_repo, m8.grf_validation_results) == 0
    with pytest.raises(ForcePlateError) as info:
        compare_estimate(db_repo.engine, out.trial_id, doc, LIMITS)
    assert info.value.code == "trial_deleted"


def test_threaded_delete_and_evaluate_never_leave_orphans(
    db_settings: Settings, db_repo: ResearchRepository, squat_video: Path
) -> None:
    for _ in range(3):
        assessment, _fx, out = setup_trial(db_settings, db_repo, squat_video)
        doc = json.dumps(null_baseline_estimate(db_repo.get_assessment(assessment.id))).encode()  # type: ignore[arg-type]
        barrier = threading.Barrier(2)
        outcomes: dict[str, Any] = {}

        def evaluate(
            doc: bytes = doc,
            tid: uuid.UUID = out.trial_id,
            barrier: threading.Barrier = barrier,
            outcomes: dict[str, Any] = outcomes,
        ) -> None:
            barrier.wait(timeout=30)
            try:
                outcomes["evaluate"] = compare_estimate(db_repo.engine, tid, doc, LIMITS).result_id
            except ForcePlateError as exc:
                outcomes["evaluate"] = exc.code

        def delete(
            tid: uuid.UUID = out.trial_id, barrier: threading.Barrier = barrier, outcomes: dict[str, Any] = outcomes
        ) -> None:
            barrier.wait(timeout=30)
            outcomes["delete"] = ForcePlateRepository(db_repo.engine).delete_trial(tid).state

        threads = [threading.Thread(target=evaluate), threading.Thread(target=delete)]
        for t in threads:
            t.start()
        for t in threads:
            t.join()
        assert outcomes["delete"] == "deleted"
        assert isinstance(outcomes["evaluate"], uuid.UUID) or outcomes["evaluate"] in (
            "trial_deleted",
            "trial_not_found",
        )
        with db_repo.engine.connect() as c:
            left = c.execute(
                select(func.count())
                .select_from(m8.grf_validation_results)
                .where(m8.grf_validation_results.c.trial_id == out.trial_id)
            ).scalar_one()
        assert left == 0
        assert count(db_repo, research_assessments) >= 1
