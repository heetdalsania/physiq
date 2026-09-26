"""End-to-end research smoke (in process; SQLite and real Postgres):

research video → POST job → durable queued job → worker claim (separate
engine/repository, as in a separate process) → decode → pose (dot test
double) → normalized skeleton → segmentation → features → persistence →
GET job → GET assessment → DELETE assessment → verify deletion.

A socket guard fails the test on ANY non-loopback network connection
during the whole flow. Controlled synthetic media only.
"""

from __future__ import annotations

import json
import socket
import uuid
from collections.abc import Iterator
from pathlib import Path
from typing import Any

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select, text

from physiq_research.api.app import create_app
from physiq_research.config import Settings
from physiq_research.media.tempfiles import list_uploads
from physiq_research.storage.db import make_engine
from physiq_research.storage.repository import ResearchRepository
from physiq_research.storage.tables import research_assessment_artifacts, research_assessments, research_jobs
from physiq_research.workers.worker import Worker
from tests.conftest import API_BASE, CLIENT_HEADERS
from tests.support.providers import DotPoseProvider


@pytest.fixture
def no_external_network(monkeypatch: pytest.MonkeyPatch, db_settings: Settings) -> Iterator[list[Any]]:
    """Only loopback and the configured database host are allowed."""
    from sqlalchemy.engine import make_url

    db_host = make_url(db_settings.database_url).host
    allowed = {"127.0.0.1", "::1", "localhost"}
    if db_host:
        allowed.add(db_host)
        allowed.update(info[4][0] for info in socket.getaddrinfo(db_host, None))
    attempts: list[Any] = []
    real_connect = socket.socket.connect

    def guarded(self: socket.socket, address: Any) -> Any:
        host = address[0] if isinstance(address, tuple) else address
        attempts.append(host)
        if isinstance(address, tuple) and host not in allowed:
            raise AssertionError(f"unexpected network connection to {host}")
        return real_connect(self, address)

    def no_dns(*args: Any, **_k: Any) -> Any:
        if args and args[0] not in allowed and args[0] is not None:
            raise AssertionError(f"unexpected DNS lookup for {args[0]}")
        return real_getaddrinfo(*args)

    real_getaddrinfo = socket.getaddrinfo
    monkeypatch.setattr(socket.socket, "connect", guarded)
    monkeypatch.setattr(socket, "getaddrinfo", no_dns)
    yield attempts


def test_end_to_end_research_flow(
    db_settings: Settings, db_repo: ResearchRepository, squat_video: Path, no_external_network: list[Any]
) -> None:
    api = create_app(db_settings, engine=db_repo.engine, repository=db_repo)
    subject = str(uuid.uuid4())
    filename = "participant-jane-doe-2026.mp4"  # a filename that must never be stored
    with TestClient(api, base_url=API_BASE) as client:
        # 1. submit
        resp = client.post(
            "/research/v1/jobs",
            files={"video": (filename, squat_video.read_bytes(), "video/mp4")},
            data={
                "movement_type": "bodyweight_squat_sagittal",
                "capture_mode": "single_camera_sagittal",
                "research_subject_id": subject,
            },
            headers=CLIENT_HEADERS,
        )
        assert resp.status_code == 202, resp.text
        job_id = resp.json()["job_id"]
        # 2. durable queued job + one restricted temporary file
        assert client.get(f"/research/v1/jobs/{job_id}").json()["status"] == "queued"
        uploads = list_uploads(db_settings.upload_dir)
        assert len(uploads) == 1
        mode = (Path(db_settings.upload_dir) / uploads[0]).stat().st_mode & 0o777
        assert mode == 0o600 and Path(db_settings.upload_dir).stat().st_mode & 0o777 == 0o700

        # 3. a worker with its OWN engine (as a separate process would have) claims and processes
        worker_engine = make_engine(db_settings.database_url)
        worker = Worker(db_settings, ResearchRepository(worker_engine), DotPoseProvider())
        outcome = worker.process_next()
        worker_engine.dispose()
        assert outcome is not None and outcome.status == "succeeded", outcome
        assert worker.process_next() is None  # nothing left; the job is not processed twice

        # 4. raw video gone
        assert list_uploads(db_settings.upload_dir) == []

        # 5. GET job + assessment
        job = client.get(f"/research/v1/jobs/{job_id}").json()
        assert job["status"] == "succeeded" and job["failure"] is None
        aid = job["assessment_id"]
        record = client.get(f"/research/v1/assessments/{aid}").json()
        k = record["summary"]["kinematics"]
        assert k["knee"]["apparent_rom_deg"] == pytest.approx(80, abs=0.6)
        assert k["timing"]["descent_ms"] == pytest.approx(1080, abs=12)
        assert k["timing"]["ascent_ms"] == pytest.approx(1480, abs=12)
        assert k["timing"]["repetition_ms"] == pytest.approx(2560, abs=12)
        assert record["research_subject_id"] == subject
        sizes = {kind: a["byte_size"] for kind, a in record["artifacts"].items()}
        assert all(v > 0 for v in sizes.values())

        # 6. nothing personal and no media in the database
        with db_repo.engine.connect() as c:
            dump = json.dumps(
                [
                    [dict(r._mapping) for r in c.execute(select(t)).all()]
                    for t in (research_jobs, research_assessments, research_assessment_artifacts)
                ],
                default=str,
            )
        assert filename not in dump and "jane" not in dump.lower()
        assert "ftyp" not in dump and "rv-" not in dump  # no media bytes, no temp names left

        # 7. delete: derived data existed before, is gone after
        with db_repo.engine.connect() as c:
            assert c.execute(
                select(research_assessment_artifacts).where(
                    research_assessment_artifacts.c.assessment_id == uuid.UUID(aid)
                )
            ).all()
        deleted = client.delete(f"/research/v1/assessments/{aid}", headers=CLIENT_HEADERS).json()
        assert (
            deleted["state"] == "deleted" and deleted["artifacts_removed"] == 4 and "raw_video_retained" not in deleted
        )
        assert client.get(f"/research/v1/assessments/{aid}").status_code == 404
        with db_repo.engine.connect() as c:
            assert c.execute(select(research_assessments)).all() == []
            assert c.execute(select(research_assessment_artifacts)).all() == []
            left = c.execute(
                text("SELECT status, source_sha256, research_subject_id, idempotency_key FROM research_jobs")
            ).all()
        assert [tuple(r) for r in left] == [("deleted", None, None, None)]
        assert (
            client.delete(f"/research/v1/assessments/{aid}", headers=CLIENT_HEADERS).json()["state"]
            == "already_deleted"
        )

    # 8. no network activity except to the database, at any point
    assert all(
        not isinstance(h, str)
        or h.startswith("/")
        or h in {"127.0.0.1", "::1"}
        or h.startswith(("172.", "10.", "192.168."))
        for h in no_external_network
    )
