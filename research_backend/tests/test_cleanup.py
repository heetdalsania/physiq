"""Raw-video lifecycle — the highest-priority invariant.

A failure is injected at every major stage; afterwards the temporary raw
video must be gone, the job must be in a well-defined state, and no
assessment may exist. Also: cancellation, lease loss, database failure,
BaseException, and the stale-upload sweeper (which must never touch files
that are not ours).
"""

from __future__ import annotations

import os
import time
from pathlib import Path
from typing import Any

import pytest
from sqlalchemy import func, select
from sqlalchemy.exc import OperationalError

from physiq_research.config import Settings
from physiq_research.failures import Stage
from physiq_research.media.tempfiles import list_uploads, sweep_stale
from physiq_research.storage.repository import ResearchRepository
from physiq_research.storage.tables import research_assessment_artifacts, research_assessments
from physiq_research.workers.worker import ORPHAN_GRACE_S, Worker
from tests.support.jobs import enqueue_file
from tests.support.providers import DotPoseProvider


class Injected(RuntimeError):
    pass


def injector(stage: Stage, exc: BaseException | None = None) -> Any:
    def fault(current: Stage) -> None:
        if current == stage:
            raise exc if exc is not None else Injected(f"injected at {stage}")

    return fault


def no_assessments(repo: ResearchRepository) -> bool:
    with repo.engine.connect() as c:
        return (
            c.execute(select(func.count()).select_from(research_assessments)).scalar_one() == 0
            and c.execute(select(func.count()).select_from(research_assessment_artifacts)).scalar_one() == 0
        )


INJECTABLE = [
    Stage.DIGEST,
    Stage.PROBE,
    Stage.POSE_INIT,
    Stage.DECODE,
    Stage.POSE_INFERENCE,
    Stage.PROTOCOL,
    Stage.SEGMENTATION,
    Stage.NORMALIZATION,
    Stage.FEATURES,
    Stage.DATABASE_SAVE,
]


@pytest.mark.parametrize("stage", INJECTABLE, ids=[s.value for s in INJECTABLE])
def test_failure_at_every_stage_deletes_the_raw_video(
    settings: Settings, repo: ResearchRepository, squat_video: Path, stage: Stage
) -> None:
    job = enqueue_file(settings, repo, squat_video)
    assert list_uploads(settings.upload_dir) == [job.upload_token]
    outcome = Worker(settings, repo, DotPoseProvider(), faults=injector(stage)).process_next()
    assert outcome is not None
    assert list_uploads(settings.upload_dir) == []  # the raw video is gone
    assert outcome.upload_deleted
    stored = repo.get_job(job.id)
    assert stored is not None
    assert (stored.status, stored.failure_code, stored.failure_detail, stored.failure_stage) == (
        "failed",
        "pipeline_error",
        "unexpected_exception",
        stage.value,
    )
    assert stored.upload_token is None and stored.assessment_id is None
    assert no_assessments(repo)  # never half-successful


def test_pose_runtime_failures_delete_the_raw_video(
    settings: Settings, repo: ResearchRepository, squat_video: Path
) -> None:
    for configure, stage in (
        (lambda p: setattr(p, "fail_open", True), "pose_init"),
        (lambda p: setattr(p, "fail_on_call", 5), "pose_inference"),
    ):
        provider = DotPoseProvider()
        configure(provider)
        job = enqueue_file(settings, repo, squat_video)
        Worker(settings, repo, provider).process_next()
        stored = repo.get_job(job.id)
        assert stored is not None and stored.failure_code == "pipeline_error" and stored.failure_stage == stage
        assert stored.failure_detail in ("pose_runtime_init_failed", "pose_inference_failed")
        assert list_uploads(settings.upload_dir) == []
        assert provider.sessions_opened == provider.sessions_closed  # the session is always closed


def test_classified_failure_deletes_the_raw_video(settings: Settings, repo: ResearchRepository, tmp_path: Path) -> None:
    bad = tmp_path / "bad.mp4"
    bad.write_bytes(b"\x00\x00\x00\x18ftypisom\x00\x00\x02\x00isomiso2" + os.urandom(3000))
    job = enqueue_file(settings, repo, bad)
    Worker(settings, repo, DotPoseProvider()).process_next()
    assert repo.get_job(job.id).failure_code == "invalid_video"  # type: ignore[union-attr]
    assert list_uploads(settings.upload_dir) == []


def test_digest_mismatch_deletes_the_raw_video(settings: Settings, repo: ResearchRepository, squat_video: Path) -> None:
    job = enqueue_file(settings, repo, squat_video)
    with open(Path(settings.upload_dir) / job.upload_token, "ab") as fh:  # type: ignore[operator]
        fh.write(b"tampered")
    Worker(settings, repo, DotPoseProvider()).process_next()
    stored = repo.get_job(job.id)
    assert (stored.failure_code, stored.failure_detail) == ("invalid_video", "digest_mismatch")  # type: ignore[union-attr]
    assert list_uploads(settings.upload_dir) == []


def test_database_write_failure_deletes_the_raw_video(
    settings: Settings, repo: ResearchRepository, squat_video: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    job = enqueue_file(settings, repo, squat_video)

    def broken_save(*_a: Any, **_k: Any) -> None:
        raise OperationalError("INSERT", {}, Exception("database is down"))

    monkeypatch.setattr(repo, "save_success", broken_save)
    outcome = Worker(settings, repo, DotPoseProvider()).process_next()
    assert outcome is not None and outcome.failure_stage == "database_save"
    assert list_uploads(settings.upload_dir) == []
    assert repo.get_job(job.id).status == "failed"  # type: ignore[union-attr]
    assert no_assessments(repo)


def test_worker_exception_when_even_the_failure_cannot_be_recorded(
    settings: Settings, repo: ResearchRepository, squat_video: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Database unreachable for both save and mark_failed: the video is still deleted
    and the job stays 'processing' with a lease that will expire (never 'healthy')."""
    job = enqueue_file(settings, repo, squat_video)

    def down(*_a: Any, **_k: Any) -> None:
        raise OperationalError("UPDATE", {}, Exception("database is down"))

    monkeypatch.setattr(repo, "save_success", down)
    monkeypatch.setattr(repo, "mark_failed", down)
    outcome = Worker(settings, repo, DotPoseProvider()).process_next()
    assert outcome is not None and outcome.status == "lease_lost"
    assert list_uploads(settings.upload_dir) == []
    stored = repo.get_job(job.id)
    assert stored is not None and stored.status == "processing" and stored.lease_expires_at is not None


def test_base_exception_still_deletes_the_raw_video(
    settings: Settings, repo: ResearchRepository, squat_video: Path
) -> None:
    enqueue_file(settings, repo, squat_video)
    worker = Worker(settings, repo, DotPoseProvider(), faults=injector(Stage.POSE_INFERENCE, KeyboardInterrupt()))
    with pytest.raises(KeyboardInterrupt):
        worker.process_next()
    assert list_uploads(settings.upload_dir) == []


def test_cancellation_during_processing(settings: Settings, repo: ResearchRepository, squat_video: Path) -> None:
    job = enqueue_file(settings, repo, squat_video)
    fast = settings.with_overrides(heartbeat_seconds=0)

    def cancel_midway(stage: Stage) -> None:
        if stage == Stage.POSE_INFERENCE:
            repo.delete_job(job.id)

    outcome = Worker(fast, repo, DotPoseProvider(), faults=cancel_midway).process_next()
    assert outcome is not None and outcome.status == "cancelled"
    assert list_uploads(settings.upload_dir) == []
    stored = repo.get_job(job.id)
    assert stored is not None and stored.status == "deleted" and stored.source_sha256 is None
    assert no_assessments(repo)


def test_lease_lost_discards_result_and_deletes_video(
    settings: Settings, repo: ResearchRepository, squat_video: Path
) -> None:
    from sqlalchemy import update

    from physiq_research.storage.tables import research_jobs

    job = enqueue_file(settings, repo, squat_video)

    def steal(stage: Stage) -> None:
        if stage == Stage.FEATURES:
            with repo.engine.begin() as c:
                c.execute(update(research_jobs).where(research_jobs.c.id == job.id).values(lease_owner="someone-else"))

    outcome = Worker(settings, repo, DotPoseProvider(), faults=steal).process_next()
    assert outcome is not None and outcome.status == "lease_lost"
    assert list_uploads(settings.upload_dir) == []
    assert no_assessments(repo)


def test_reclaimed_attempt_keeps_video_for_new_owner(
    db_settings: Settings, db_repo: ResearchRepository, squat_video: Path
) -> None:
    from datetime import timedelta

    from physiq_research.media.tempfiles import upload_exists

    job = enqueue_file(db_settings, db_repo, squat_video)
    successor: dict[str, Any] = {}

    def reclaim(stage: Stage) -> None:
        if stage != Stage.FEATURES:
            return
        current = db_repo.get_job(job.id)
        assert current is not None and current.lease_expires_at is not None
        later = ResearchRepository(db_repo.engine, clock=lambda: current.lease_expires_at + timedelta(seconds=1))
        recovered = later.recover_expired(
            max_attempts=2, upload_exists=lambda token: upload_exists(db_settings.upload_dir, token)
        )
        assert recovered == [(job.id, "requeued", None)]
        successor["repo"] = later
        successor["claim"] = later.claim_next("successor", db_settings.lease_seconds)
        assert successor["claim"] is not None

    old = Worker(db_settings, db_repo, DotPoseProvider(), faults=reclaim, owner="original").process_next()
    assert old is not None and old.status == "lease_lost" and not old.upload_deleted
    assert upload_exists(db_settings.upload_dir, job.upload_token)
    newer = Worker(db_settings, successor["repo"], DotPoseProvider(), owner="successor").process_job(successor["claim"])
    assert newer.status == "succeeded" and newer.upload_deleted
    assert not upload_exists(db_settings.upload_dir, job.upload_token)


def test_success_deletes_the_raw_video(settings: Settings, repo: ResearchRepository, squat_video: Path) -> None:
    job = enqueue_file(settings, repo, squat_video)
    outcome = Worker(settings, repo, DotPoseProvider()).process_next()
    assert outcome is not None and outcome.status == "succeeded"
    assert list_uploads(settings.upload_dir) == [] and repo.get_job(job.id).upload_token is None  # type: ignore[union-attr]


# ── crash recovery / stale-temp sweeper ─────────────────────────────────


def test_sweeper_removes_only_our_old_unreferenced_files(
    settings: Settings, repo: ResearchRepository, squat_video: Path, tmp_path: Path
) -> None:
    worker = Worker(settings, repo, DotPoseProvider())
    upload_dir = Path(settings.upload_dir)
    active = enqueue_file(settings, repo, squat_video)  # referenced by a queued job
    orphan = upload_dir / "rv-orphan000.upload"
    young = upload_dir / "rv-young00000.upload"
    foreign = upload_dir / "notes.txt"
    decoy_outside = tmp_path / "rv-outside000.upload"  # right name, wrong directory
    for p in (orphan, young, foreign, decoy_outside):
        p.write_bytes(b"x")
    old = time.time() - ORPHAN_GRACE_S - 60
    for p in (orphan, foreign, decoy_outside, upload_dir / active.upload_token):  # type: ignore[operator]
        os.utime(p, (old, old))
    link = upload_dir / "rv-symlink000.upload"
    link.symlink_to(decoy_outside)
    os.utime(link, (old, old), follow_symlinks=False)

    result = worker.maintenance()
    assert "rv-orphan000.upload" in result["swept"]
    assert not orphan.exists()
    assert young.exists()  # an upload may still be streaming
    assert (upload_dir / active.upload_token).exists()  # type: ignore[operator]
    assert foreign.exists() and decoy_outside.exists()  # never touch files that are not ours
    assert os.path.lexists(link) and decoy_outside.exists()  # symlinks are not followed or treated as uploads


def test_sweeper_does_not_unlink_a_stalled_in_flight_upload(settings: Settings) -> None:
    from physiq_research.media.tempfiles import create_upload_file, ensure_upload_dir

    folder = ensure_upload_dir(settings.upload_dir)
    token, fd = create_upload_file(folder)
    path = folder / token
    try:
        os.write(fd, b"partial upload")
        old = time.time() - ORPHAN_GRACE_S - 1
        os.utime(path, (old, old))
        assert sweep_stale(folder, max_age_s=ORPHAN_GRACE_S, keep=set()) == []
        assert path.exists()
    finally:
        os.close(fd)
    assert sweep_stale(folder, max_age_s=ORPHAN_GRACE_S, keep=set()) == [token]
    assert not path.exists()


def test_recovery_after_worker_crash(settings: Settings, repo: ResearchRepository, squat_video: Path) -> None:
    from datetime import timedelta

    job = enqueue_file(settings, repo, squat_video)
    claimed = repo.claim_next("crashed-worker", settings.lease_seconds)
    assert claimed is not None and claimed.status == "processing"
    # the crashed worker never renews its lease
    later = ResearchRepository(repo.engine, clock=lambda: claimed.lease_expires_at + timedelta(seconds=1))  # type: ignore[operator]
    worker = Worker(settings, later, DotPoseProvider())
    recovered = worker.maintenance()["recovered"]
    assert recovered == [(job.id, "requeued", None)]  # attempt 1 < max 2 and the upload still exists
    assert later.get_job(job.id).status == "queued"  # type: ignore[union-attr]
    # second crash on the last attempt → failed as worker_lost, upload deleted
    again = later.claim_next("crashed-again", settings.lease_seconds)
    assert again is not None and again.attempts == 2
    even_later = ResearchRepository(repo.engine, clock=lambda: again.lease_expires_at + timedelta(seconds=1))  # type: ignore[operator]
    Worker(settings, even_later, DotPoseProvider()).maintenance()
    final = even_later.get_job(job.id)
    assert final is not None and (final.status, final.failure_code, final.failure_detail) == (
        "failed",
        "worker_lost",
        "lease_expired",
    )
    assert list_uploads(settings.upload_dir) == []


def test_old_queued_uploads_expire(settings: Settings, repo: ResearchRepository, squat_video: Path) -> None:
    from datetime import timedelta

    job = enqueue_file(settings, repo, squat_video)
    later = ResearchRepository(
        repo.engine, clock=lambda: job.created_at + timedelta(seconds=settings.upload_max_age_s + 1)
    )
    Worker(settings, later, DotPoseProvider()).maintenance()
    stored = later.get_job(job.id)
    assert stored is not None and (stored.status, stored.failure_code) == ("failed", "upload_expired")
    assert list_uploads(settings.upload_dir) == []


def test_sweep_stale_is_bounded_to_the_pattern(tmp_path: Path) -> None:
    d = tmp_path / "u"
    d.mkdir(mode=0o700)
    names = ["rv-abcdefgh.upload", "rv-../../x.upload", "rv-short.upload", "other.upload", "rv-abcdefgh.upload.bak"]
    for n in names:
        if "/" not in n:
            (d / n).write_bytes(b"x")
            os.utime(d / n, (0, 0))
    removed = sweep_stale(d, max_age_s=10, keep=[])
    assert removed == ["rv-abcdefgh.upload"]
    assert sorted(os.listdir(d)) == ["other.upload", "rv-abcdefgh.upload.bak", "rv-short.upload"]
