"""Storage, migrations, immutability, idempotency, deletion — on SQLite and,
with RESEARCH_TEST_POSTGRES_URL, on a real freshly created Postgres
database per test (``-m postgres`` selects only the Postgres runs)."""

from __future__ import annotations

import uuid
from pathlib import Path
from typing import Any

import pytest
from sqlalchemy import inspect, select, text, update
from sqlalchemy.exc import DBAPIError, IntegrityError

from physiq_research.canonical import canonical_digest
from physiq_research.config import Settings
from physiq_research.pipeline.contract import processing_contract, processing_fingerprint
from physiq_research.storage.db import check_ready, current_revision, downgrade, make_engine, upgrade
from physiq_research.storage.repository import ResearchRepository, StoredDataError
from physiq_research.storage.tables import metadata, research_assessment_artifacts, research_assessments, research_jobs
from physiq_research.versions import DATABASE_SCHEMA_REVISION
from physiq_research.workers.worker import Worker
from tests.support.jobs import enqueue_file
from tests.support.providers import DotPoseProvider


def process(settings: Settings, repo: ResearchRepository, video: Path, **kw: Any) -> Any:
    job = enqueue_file(settings, repo, video, **kw)
    outcome = Worker(settings, repo, DotPoseProvider()).process_next()
    assert outcome is not None and outcome.job_id == job.id
    return outcome, job


def test_migration_from_empty_database(db_settings: Settings) -> None:
    engine = make_engine(db_settings.database_url)
    assert current_revision(engine) is None
    assert not check_ready(engine)["schema_current"]
    upgrade(db_settings.database_url)
    assert current_revision(engine) == DATABASE_SCHEMA_REVISION
    assert check_ready(engine) == {
        "database": "ok",
        "schema_revision": DATABASE_SCHEMA_REVISION,
        "schema_current": True,
    }
    names = set(inspect(engine).get_table_names())
    assert {"research_jobs", "research_assessments", "research_assessment_artifacts", "alembic_version"} <= names
    # The migrated schema matches the table definitions the code uses.
    from alembic.autogenerate import compare_metadata
    from alembic.migration import MigrationContext

    with engine.connect() as conn:
        diff = compare_metadata(MigrationContext.configure(conn), metadata)
    assert diff == []
    # Downgrade removes everything; upgrade again works (migrations are reversible).
    downgrade(db_settings.database_url, "base")
    assert "research_jobs" not in set(inspect(engine).get_table_names())
    upgrade(db_settings.database_url)
    assert current_revision(engine) == DATABASE_SCHEMA_REVISION
    engine.dispose()


def test_no_personal_data_columns(db_repo: ResearchRepository) -> None:
    cols = {
        c["name"]
        for t in ("research_jobs", "research_assessments", "research_assessment_artifacts")
        for c in inspect(db_repo.engine).get_columns(t)
    }
    for forbidden in (
        "email",
        "name",
        "phone",
        "address",
        "account",
        "user",
        "login",
        "filename",
        "video",
        "frame",
        "image",
    ):
        assert not [c for c in cols if forbidden in c.split("_")], forbidden


def test_success_persists_and_survives_restart(
    db_settings: Settings, db_repo: ResearchRepository, squat_video: Path
) -> None:
    subject = uuid.uuid4()
    outcome, job = process(db_settings, db_repo, squat_video, subject=subject)
    assert outcome.status == "succeeded"
    before = db_repo.get_assessment(outcome.assessment_id)
    assert before is not None and before.research_subject_id == subject
    db_repo.engine.dispose()  # "restart": a brand-new engine and repository
    fresh = ResearchRepository(make_engine(db_settings.database_url))
    after = fresh.get_assessment(outcome.assessment_id)
    assert after is not None
    assert after.record_sha256 == before.record_sha256
    assert after.summary == before.summary and after.provenance == before.provenance
    for kind in before.artifacts:
        assert after.artifacts[kind].data == before.artifacts[kind].data
        assert canonical_digest(after.artifacts[kind].data) == before.artifacts[kind].content_sha256
    assert fresh.get_job(job.id).status == "succeeded"  # type: ignore[union-attr]
    fresh.engine.dispose()


def test_failed_assessment_persists_stable_codes(
    db_settings: Settings, db_repo: ResearchRepository, tmp_path: Path
) -> None:
    bad = tmp_path / "bad.mp4"
    bad.write_bytes(b"\x00\x00\x00\x18ftypisom\x00\x00\x02\x00isomiso2" + b"\x01" * 800)
    _outcome, job = process(db_settings, db_repo, bad)
    stored = db_repo.get_job(job.id)
    assert stored is not None
    assert (stored.status, stored.failure_code, stored.failure_detail, stored.failure_stage) == (
        "failed",
        "invalid_video",
        "container_open_failed",
        "probe",
    )
    assert str(tmp_path) not in str(stored.failure_diagnostics) and "Errno" not in str(stored.failure_diagnostics)


def test_assessments_are_immutable_in_the_database(
    db_settings: Settings, db_repo: ResearchRepository, squat_video: Path
) -> None:
    outcome, _ = process(db_settings, db_repo, squat_video)
    for table, column, value in (
        (research_assessments, "summary", {"tampered": True}),
        (research_assessment_artifacts, "content_sha256", "0" * 64),
    ):
        with pytest.raises((DBAPIError, IntegrityError)), db_repo.engine.begin() as c:
            key = table.c.id if table is research_assessments else table.c.assessment_id
            c.execute(update(table).where(key == outcome.assessment_id).values({column: value}))
    assert db_repo.get_assessment(outcome.assessment_id) is not None  # unchanged and still verifiable


def _disable_immutability(repo: ResearchRepository) -> None:
    with repo.engine.begin() as c:
        for t in ("research_assessments", "research_assessment_artifacts"):
            if repo.engine.dialect.name == "postgresql":
                c.execute(text(f"ALTER TABLE {t} DISABLE TRIGGER {t}_immutable"))
            else:
                c.execute(text(f"DROP TRIGGER {t}_immutable"))


def test_invalid_stored_json_is_rejected_on_read(
    db_settings: Settings, db_repo: ResearchRepository, squat_video: Path
) -> None:
    outcome, _ = process(db_settings, db_repo, squat_video)
    aid = outcome.assessment_id
    _disable_immutability(db_repo)  # simulate out-of-band tampering / corruption
    a = research_assessment_artifacts
    with db_repo.engine.begin() as c:
        row = c.execute(select(a.c.data).where(a.c.assessment_id == aid, a.c.kind == "kinematic_traces")).one()
    data = dict(row[0])

    # 1. content changed, digest not updated → integrity failure
    tampered = {**data, "capture_start_ms": data["capture_start_ms"] + 1}
    with db_repo.engine.begin() as c:
        c.execute(update(a).where(a.c.assessment_id == aid, a.c.kind == "kinematic_traces").values(data=tampered))
    with pytest.raises(StoredDataError) as info:
        db_repo.get_assessment(aid)
    assert info.value.code == "artifact_integrity"

    # 2. a buggy writer that keeps every digest consistent but violates the schema
    invalid = {**data, "knee": [{"t_ms": 1.0, "raw_deg": 999.0, "smoothed_deg": 999.0, "state": "valid"}]}
    digest = canonical_digest(invalid)
    with db_repo.engine.begin() as c:
        c.execute(
            update(a)
            .where(a.c.assessment_id == aid, a.c.kind == "kinematic_traces")
            .values(data=invalid, content_sha256=digest)
        )
        m = c.execute(select(research_assessments).where(research_assessments.c.id == aid)).one()._mapping
        digests = dict(c.execute(select(a.c.kind, a.c.content_sha256).where(a.c.assessment_id == aid)).all())
        from physiq_research.storage.repository import record_digest

        rec = record_digest(
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
        c.execute(update(research_assessments).where(research_assessments.c.id == aid).values(record_sha256=rec))
    with pytest.raises(StoredDataError) as info:
        db_repo.get_assessment(aid)
    assert info.value.code == "artifact_schema"


def test_non_finite_numbers_cannot_be_stored(db_repo: ResearchRepository) -> None:
    from physiq_research.canonical import CanonicalizationError

    job = db_repo.create_job(
        movement_type="bodyweight_squat_sagittal",
        capture_mode="single_camera_sagittal",
        research_subject_id=None,
        source_sha256="a" * 64,
        source_bytes=1,
        upload_token="rv-abcdefgh.upload",
        idempotency_key="b" * 64,
        processing_fingerprint="c" * 64,
    )
    from sqlalchemy.exc import StatementError

    with pytest.raises((CanonicalizationError, ValueError, StatementError)), db_repo.engine.begin() as c:
        c.execute(
            update(research_jobs).where(research_jobs.c.id == job.id).values(failure_diagnostics={"x": float("nan")})
        )


def test_duplicate_source_links_to_the_first_assessment(
    db_settings: Settings, db_repo: ResearchRepository, squat_video: Path
) -> None:
    """Two jobs for the same source + contract (e.g. concurrent submissions):
    the second never overwrites the first; it is linked to it."""
    first, _ = process(db_settings, db_repo, squat_video)
    second, job2 = process(db_settings, db_repo, squat_video)
    assert first.status == second.status == "succeeded"
    assert second.assessment_id == first.assessment_id
    assert db_repo.get_job(job2.id).assessment_id == first.assessment_id  # type: ignore[union-attr]
    with db_repo.engine.connect() as c:
        assert c.execute(select(research_assessments.c.id)).all() == [(first.assessment_id,)]


def test_same_source_new_pipeline_version_creates_a_new_result(
    db_settings: Settings, db_repo: ResearchRepository, squat_video: Path
) -> None:
    old, _ = process(db_settings, db_repo, squat_video)
    before = db_repo.get_assessment(old.assessment_id)
    contract = processing_contract()
    newer = processing_fingerprint(
        processing_contract({"versions": {**contract["versions"], "research_pipeline": "research-pipeline-v0.2-test"}})
    )
    new, _ = process(db_settings, db_repo, squat_video, fingerprint=newer)
    assert new.status == "succeeded" and new.assessment_id != old.assessment_id
    after = db_repo.get_assessment(old.assessment_id)
    assert (
        after is not None and before is not None and after.record_sha256 == before.record_sha256
    )  # old result untouched
    assert db_repo.get_assessment(new.assessment_id).processing_fingerprint == newer  # type: ignore[union-attr]


def test_delete_and_double_delete(db_settings: Settings, db_repo: ResearchRepository, squat_video: Path) -> None:
    subject = uuid.uuid4()
    outcome, job = process(db_settings, db_repo, squat_video, subject=subject)
    aid = outcome.assessment_id
    first = db_repo.delete_assessment(aid)
    assert (first.state, first.jobs_tombstoned, first.artifacts_removed) == ("deleted", 1, 4)
    assert db_repo.get_assessment(aid) is None
    with db_repo.engine.connect() as c:
        assert (
            c.execute(
                select(research_assessment_artifacts).where(research_assessment_artifacts.c.assessment_id == aid)
            ).all()
            == []
        )
    tomb = db_repo.get_job(job.id)
    assert tomb is not None and tomb.status == "deleted" and tomb.deleted_at is not None
    assert (
        tomb.source_sha256,
        tomb.research_subject_id,
        tomb.idempotency_key,
        tomb.movement_type,
        tomb.failure_diagnostics,
    ) == (None,) * 5
    second = db_repo.delete_assessment(aid)
    assert (second.state, second.jobs_tombstoned, second.artifacts_removed) == ("already_deleted", 0, 0)
    assert db_repo.delete_assessment(uuid.uuid4()).state == "not_found"
    assert db_repo.delete_job(job.id).state == "already_deleted"
    # after deletion the same video may be processed again (a new, separate record)
    again, _ = process(db_settings, db_repo, squat_video, subject=subject)
    assert again.status == "succeeded" and again.assessment_id != aid


def test_delete_failed_and_queued_jobs(db_settings: Settings, db_repo: ResearchRepository, squat_video: Path) -> None:
    queued = enqueue_file(db_settings, db_repo, squat_video)
    out = db_repo.delete_job(queued.id)
    assert out.state == "deleted" and out.upload_tokens == (queued.upload_token,)
    assert db_repo.claim_next("w", 60) is None  # a deleted job is never processed


def test_delete_job_when_worker_succeeds_during_initial_read(
    db_settings: Settings, db_repo: ResearchRepository, squat_video: Path
) -> None:
    job = enqueue_file(db_settings, db_repo, squat_video)

    class ConcurrentSuccessRepo(ResearchRepository):
        produced: Any = None

        def _complete_job(self) -> None:
            if self.produced is None:
                self.produced = Worker(db_settings, db_repo, DotPoseProvider()).process_next()

        def get_job(self, job_id: uuid.UUID) -> Any:
            # Old implementation read outside its deletion transaction.
            snapshot = super().get_job(job_id)
            self._complete_job()
            return snapshot

        def _lock_deletion(self, conn: Any) -> None:
            # New implementation starts its transaction before reading.
            self._complete_job()
            super()._lock_deletion(conn)

    race = ConcurrentSuccessRepo(db_repo.engine)
    deleted = race.delete_job(job.id)
    assert race.produced is not None and race.produced.status == "succeeded"
    assert deleted.state == "deleted" and deleted.artifacts_removed == 4
    assert db_repo.get_assessment(race.produced.assessment_id) is None
    tombstone = db_repo.get_job(job.id)
    assert tombstone is not None and tombstone.status == "deleted"


def test_atomic_claim_two_workers_never_share_a_job(
    db_settings: Settings, db_repo: ResearchRepository, squat_video: Path
) -> None:
    import threading

    jobs = [enqueue_file(db_settings, db_repo, squat_video, subject=uuid.uuid4()) for _ in range(6)]
    claims: dict[str, list[uuid.UUID]] = {"a": [], "b": [], "c": []}
    barrier = threading.Barrier(3)

    def worker(name: str) -> None:
        repo = ResearchRepository(db_repo.engine)
        barrier.wait()
        while (job := repo.claim_next(name, 60)) is not None:
            claims[name].append(job.id)

    threads = [threading.Thread(target=worker, args=(n,)) for n in claims]
    for t in threads:
        t.start()
    for t in threads:
        t.join()
    claimed = [j for ids in claims.values() for j in ids]
    assert sorted(claimed) == sorted(j.id for j in jobs)  # every job exactly once
    assert len(set(claimed)) == len(claimed)
    for name, ids in claims.items():
        for jid in ids:
            j = db_repo.get_job(jid)
            assert j is not None and j.status == "processing" and j.lease_owner == name and j.attempts == 1


def test_heartbeat_and_stale_owner_cannot_write(
    db_settings: Settings, db_repo: ResearchRepository, squat_video: Path
) -> None:
    from physiq_research.failures import FailureCode, LeaseLost

    job = enqueue_file(db_settings, db_repo, squat_video)
    claimed = db_repo.claim_next("owner", 60)
    assert claimed is not None and claimed.id == job.id
    db_repo.heartbeat(job.id, "owner", 60)
    with pytest.raises(LeaseLost):
        db_repo.heartbeat(job.id, "intruder", 60)
    assert not db_repo.mark_failed(
        job.id, "intruder", code=FailureCode.PIPELINE_ERROR, detail="x", stage="decode", diagnostics=None
    )
    assert db_repo.get_job(job.id).status == "processing"  # type: ignore[union-attr]
