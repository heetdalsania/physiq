"""The real FastAPI application, adversarially (SQLite and real Postgres)."""

from __future__ import annotations

import os
import uuid
from collections.abc import Iterator
from pathlib import Path
from typing import Any

import pytest
from fastapi.testclient import TestClient

from physiq_research.api.app import create_app
from physiq_research.config import MediaLimits, Settings
from physiq_research.force_plate.versions import DATABASE_SCHEMA_REVISION as M8_DATABASE_SCHEMA_REVISION
from physiq_research.media.tempfiles import list_uploads
from physiq_research.storage.db import check_ready, downgrade, make_engine, upgrade
from physiq_research.storage.repository import ResearchRepository
from physiq_research.workers.worker import Worker
from tests.conftest import API_BASE, CLIENT_HEADERS
from tests.support.providers import DotPoseProvider

FORM = {"movement_type": "bodyweight_squat_sagittal", "capture_mode": "single_camera_sagittal"}


@pytest.fixture
def client(db_settings: Settings, db_repo: ResearchRepository) -> Iterator[TestClient]:
    app = create_app(db_settings, engine=db_repo.engine, repository=db_repo)
    with TestClient(app, base_url=API_BASE, raise_server_exceptions=False) as c:
        yield c


def submit(
    client: TestClient,
    video: bytes,
    *,
    name: str = "squat.mp4",
    ctype: str = "video/mp4",
    data: dict[str, str] | None = None,
    headers: dict[str, str] | None = None,
) -> Any:
    return client.post(
        "/research/v1/jobs",
        files={"video": (name, video, ctype)},
        data=FORM if data is None else data,
        headers=CLIENT_HEADERS if headers is None else headers,
    )


def assert_safe_error(resp: Any, status: int, code: str) -> dict[str, Any]:
    assert resp.status_code == status, resp.text
    body = resp.json()
    assert body["contract"] == "research-error-v1"
    assert body["error"]["code"] == code
    text = resp.text
    for leak in ("Traceback", 'File "', "/Users/", "/tmp/", "Errno", "physiq_research.", "sqlalchemy"):
        assert leak not in text
    assert resp.headers["cache-control"] == "no-store"
    return body


# ── valid submission and reads ──────────────────────────────────────────


def test_valid_upload_creates_a_durable_queued_job(
    client: TestClient, db_settings: Settings, db_repo: ResearchRepository, squat_video: Path
) -> None:
    subject = str(uuid.uuid4())
    resp = submit(client, squat_video.read_bytes(), data={**FORM, "research_subject_id": subject})
    assert resp.status_code == 202, resp.text
    body = resp.json()
    assert body["contract"] == "research-job-v1" and body["status"] == "queued" and body["deduplicated"] is False
    assert body["research_subject_id"] == subject and "raw_video_retained" not in body
    assert body["source_sha256"] and body["source_bytes"] == squat_video.stat().st_size
    job = db_repo.get_job(uuid.UUID(body["job_id"]))
    assert job is not None and job.status == "queued"
    assert list_uploads(db_settings.upload_dir) == [job.upload_token]
    got = client.get(f"/research/v1/jobs/{body['job_id']}")
    assert got.status_code == 200 and got.json()["status"] == "queued"


def test_get_assessment_and_delete_twice(
    client: TestClient, db_settings: Settings, db_repo: ResearchRepository, squat_video: Path
) -> None:
    job_id = submit(client, squat_video.read_bytes()).json()["job_id"]
    Worker(db_settings, db_repo, DotPoseProvider()).process_next()
    job = client.get(f"/research/v1/jobs/{job_id}").json()
    assert job["status"] == "succeeded" and job["links"]["assessment"]
    aid = job["assessment_id"]
    full = client.get(f"/research/v1/assessments/{aid}")
    assert full.status_code == 200
    rec = full.json()
    assert rec["contract"] == "research-assessment-result-v1" and rec["artifacts_included"] is True
    assert set(rec["artifacts"]) == {"pose_series", "normalized_skeleton", "kinematic_traces", "time_normalized_traces"}
    assert rec["summary"]["kinematics"]["knee"]["apparent_rom_deg"] == pytest.approx(80, abs=0.6)
    assert "No force-plate validation has been completed." in rec["scientific_scope"]["non_claims"]
    light = client.get(f"/research/v1/assessments/{aid}", params={"include_artifacts": "false"}).json()
    assert light["artifacts_included"] is False and set(light["artifacts"]) == set(rec["artifacts"])
    assert all(a["data"] is None and len(a["content_sha256"]) == 64 for a in light["artifacts"].values())
    first = client.delete(f"/research/v1/assessments/{aid}", headers=CLIENT_HEADERS)
    assert first.status_code == 200 and first.json()["state"] == "deleted" and first.json()["artifacts_removed"] == 4
    second = client.delete(f"/research/v1/assessments/{aid}", headers=CLIENT_HEADERS)
    assert second.status_code == 200 and second.json()["state"] == "already_deleted"
    assert_safe_error(client.get(f"/research/v1/assessments/{aid}"), 404, "assessment_not_found")
    tomb = client.get(f"/research/v1/jobs/{job_id}").json()
    assert tomb["status"] == "deleted" and tomb["source_sha256"] is None and tomb["research_subject_id"] is None
    assert_safe_error(
        client.delete(f"/research/v1/assessments/{uuid.uuid4()}", headers=CLIENT_HEADERS), 404, "assessment_not_found"
    )


def test_delete_queued_job_removes_upload_immediately(
    client: TestClient, db_settings: Settings, squat_video: Path
) -> None:
    job_id = submit(client, squat_video.read_bytes()).json()["job_id"]
    assert len(list_uploads(db_settings.upload_dir)) == 1
    resp = client.delete(f"/research/v1/jobs/{job_id}", headers=CLIENT_HEADERS)
    assert resp.status_code == 200 and resp.json()["state"] == "deleted"
    assert list_uploads(db_settings.upload_dir) == []
    assert client.delete(f"/research/v1/jobs/{job_id}", headers=CLIENT_HEADERS).json()["state"] == "already_deleted"


def test_duplicate_submission_is_deduplicated(client: TestClient, db_settings: Settings, squat_video: Path) -> None:
    data = squat_video.read_bytes()
    first = submit(client, data).json()
    second = submit(client, data)
    assert second.status_code == 200 and second.json()["deduplicated"] is True
    assert second.json()["job_id"] == first["job_id"]
    assert len(list_uploads(db_settings.upload_dir)) == 1  # the duplicate upload was deleted
    other_subject = submit(client, data, data={**FORM, "research_subject_id": str(uuid.uuid4())})
    assert other_subject.status_code == 202 and other_subject.json()["job_id"] != first["job_id"]


# ── adversarial input ───────────────────────────────────────────────────


def test_missing_file(client: TestClient, db_settings: Settings) -> None:
    resp = client.post(
        "/research/v1/jobs",
        data=FORM,
        files={"movement_type": (None, "bodyweight_squat_sagittal")},
        headers=CLIENT_HEADERS,
    )
    assert resp.status_code in (400, 422)
    assert resp.json()["error"]["code"] in ("missing_file", "duplicate_field")
    resp = client.post(
        "/research/v1/jobs",
        files={"capture_mode": (None, "single_camera_sagittal"), "movement_type": (None, "bodyweight_squat_sagittal")},
        headers=CLIENT_HEADERS,
    )
    assert_safe_error(resp, 422, "missing_file")
    assert list_uploads(db_settings.upload_dir) == []


def test_unsupported_media(client: TestClient, db_settings: Settings, squat_video: Path) -> None:
    video = squat_video.read_bytes()
    assert_safe_error(
        client.post("/research/v1/jobs", content=b"hello", headers={**CLIENT_HEADERS, "content-type": "text/plain"}),
        415,
        "unsupported_media_type",
    )
    assert_safe_error(
        client.post("/research/v1/jobs", json=FORM, headers=CLIENT_HEADERS), 415, "unsupported_media_type"
    )
    assert_safe_error(submit(client, video, ctype="image/png"), 415, "unsupported_media_type")  # declared type
    png = b"\x89PNG\r\n\x1a\n" + os.urandom(2000)
    assert_safe_error(submit(client, png, name="clip.mp4"), 415, "unsupported_media_type")  # extension lies
    assert_safe_error(submit(client, b"\x00\x00"), 415, "unsupported_media_type")  # too short to be a video
    assert list_uploads(db_settings.upload_dir) == []


def test_oversized_upload(db_settings: Settings, db_repo: ResearchRepository, squat_video: Path) -> None:
    small = db_settings.with_overrides(limits=MediaLimits(max_upload_bytes=100_000))
    app = create_app(small, engine=db_repo.engine, repository=db_repo)
    with TestClient(app, base_url=API_BASE) as c:
        big = b"\x00\x00\x00\x18ftypisom\x00\x00\x02\x00isomiso2" + b"\x00" * 300_000
        assert_safe_error(submit(c, big), 413, "upload_too_large")  # rejected from Content-Length

        def chunks() -> Iterator[bytes]:  # chunked body without Content-Length: rejected while streaming
            yield (
                b'--b\r\nContent-Disposition: form-data; name="video"; filename="x.mp4"\r\n'
                b"Content-Type: video/mp4\r\n\r\n"
            )
            yield b"\x00\x00\x00\x18ftypisom\x00\x00\x02\x00isomiso2"
            for _ in range(40):
                yield b"\x00" * 10_000

        resp = c.post(
            "/research/v1/jobs",
            content=chunks(),
            headers={**CLIENT_HEADERS, "content-type": "multipart/form-data; boundary=b"},
        )
        assert_safe_error(resp, 413, "upload_too_large")
    assert list_uploads(db_settings.upload_dir) == []


@pytest.mark.parametrize(
    "body",
    [
        b"this is not multipart at all",
        b"--b\r\nContent-Disposition: form-data\r\n\r\nno name\r\n--b--\r\n",
        b"--b\r\nContent-Type: text/plain\r\n\r\nno disposition\r\n--b--\r\n",
        (
            b'--b\r\nContent-Disposition: form-data; name="video"; filename="a.mp4"\r\n'
            b"Content-Type: video/mp4\r\n\r\n\x00\x00\x00\x18ftypisom"
        ),
    ],
)
def test_malformed_multipart(client: TestClient, db_settings: Settings, body: bytes) -> None:
    resp = client.post(
        "/research/v1/jobs", content=body, headers={**CLIENT_HEADERS, "content-type": "multipart/form-data; boundary=b"}
    )
    assert resp.status_code in (400, 415, 422), resp.text
    assert resp.json()["error"]["code"] in ("malformed_multipart", "missing_file", "unsupported_media_type")
    assert "Traceback" not in resp.text
    assert list_uploads(db_settings.upload_dir) == []
    assert_safe_error(
        client.post(
            "/research/v1/jobs", content=b"x", headers={**CLIENT_HEADERS, "content-type": "multipart/form-data"}
        ),
        400,
        "malformed_multipart",
    )


def test_unknown_movement_capture_mode_subject_and_fields(
    client: TestClient, db_settings: Settings, squat_video: Path
) -> None:
    v = squat_video.read_bytes()
    assert_safe_error(
        submit(client, v, data={**FORM, "movement_type": "countermovement_jump"}), 422, "unknown_movement"
    )
    assert_safe_error(submit(client, v, data={**FORM, "capture_mode": "front"}), 422, "unsupported_capture_mode")
    assert_safe_error(submit(client, v, data={"capture_mode": "single_camera_sagittal"}), 422, "missing_field")
    for bad in (
        "not-a-uuid",
        "1b4e28ba-2fa1-11d2-883f-0016d3cca427",
        "{" + str(uuid.uuid4()) + "}",
    ):  # v1 UUID embeds a MAC
        assert_safe_error(
            submit(client, v, data={**FORM, "research_subject_id": bad}), 422, "invalid_research_subject_id"
        )
    for pii in ("email", "name", "phone", "address", "user_id", "account_id", "workout_history", "consent"):
        body = assert_safe_error(submit(client, v, data={**FORM, pii: "x"}), 422, "unknown_field")
        assert "x" not in body["error"]["message"]
    assert list_uploads(db_settings.upload_dir) == []


@pytest.mark.parametrize(
    "filename",
    [
        "../../../../etc/passwd.mp4",
        "/tmp/absolute.mp4",
        "..\\..\\windows.mp4",
        "スクワット 🏋️ vidéo.mp4",
        "a" * 300 + ".mp4",
        "x\x00y.mp4",
        "",
    ],
)
def test_filenames_never_reach_the_filesystem(
    client: TestClient,
    db_settings: Settings,
    db_repo: ResearchRepository,
    squat_video: Path,
    tmp_path: Path,
    filename: str,
) -> None:
    before = set(os.listdir(tmp_path))
    resp = submit(client, squat_video.read_bytes(), name=filename)
    assert resp.status_code == 202, resp.text
    job = db_repo.get_job(uuid.UUID(resp.json()["job_id"]))
    assert job is not None and job.upload_token is not None
    assert list_uploads(db_settings.upload_dir) == [job.upload_token]  # our own opaque name only
    assert not Path("/tmp/absolute.mp4").exists()
    assert set(os.listdir(tmp_path)) == before
    assert filename not in resp.text or filename == ""
    for field in (job.upload_token, job.source_sha256, job.movement_type):
        assert "passwd" not in str(field) and "スクワット" not in str(field)


def test_absurdly_long_filename_is_rejected_safely(
    client: TestClient, db_settings: Settings, squat_video: Path
) -> None:
    resp = submit(client, squat_video.read_bytes(), name="z" * 20_000 + ".mp4")
    assert_safe_error(resp, 400, "malformed_multipart")
    assert list_uploads(db_settings.upload_dir) == []


def test_invalid_path_identifiers(client: TestClient) -> None:
    for path in ("/research/v1/jobs/not-a-uuid", "/research/v1/assessments/1234", "/research/v1/assessments/../../etc"):
        resp = client.get(path)
        assert resp.status_code in (404, 422)
        assert resp.json()["contract"] == "research-error-v1" and "Traceback" not in resp.text
    assert_safe_error(client.get("/research/v1/jobs/not-a-uuid"), 422, "invalid_identifier")
    assert_safe_error(client.get("/research/v1/assessments/1234"), 422, "invalid_identifier")
    assert_safe_error(client.delete("/research/v1/assessments/xyz", headers=CLIENT_HEADERS), 422, "invalid_identifier")
    assert_safe_error(client.get(f"/research/v1/jobs/{uuid.uuid4()}"), 404, "job_not_found")


# ── local-only posture ──────────────────────────────────────────────────


def test_local_only_guards(client: TestClient, squat_video: Path) -> None:
    assert_safe_error(client.get("/health/live", headers={"host": "research.example.com"}), 400, "invalid_host")
    assert_safe_error(client.get("/health/live", headers={"host": "attacker.test:8765"}), 400, "invalid_host")
    assert_safe_error(submit(client, squat_video.read_bytes(), headers={}), 403, "missing_client_header")
    assert_safe_error(client.delete(f"/research/v1/assessments/{uuid.uuid4()}"), 403, "missing_client_header")
    preflight = client.options(
        "/research/v1/jobs", headers={"Origin": "https://evil.example", "Access-Control-Request-Method": "POST"}
    )
    assert "access-control-allow-origin" not in preflight.headers
    got = client.get("/health/live", headers={"Origin": "https://evil.example"})
    assert got.status_code == 200 and "access-control-allow-origin" not in got.headers


def test_route_surface_is_exactly_the_research_api(client: TestClient) -> None:
    routes = {(m, r.path) for r in client.app.routes for m in getattr(r, "methods", set()) if m != "HEAD"}  # type: ignore[attr-defined]
    assert routes == {
        ("GET", "/research/v1/openapi.json"),
        ("GET", "/health/live"),
        ("GET", "/health/ready"),
        ("POST", "/research/v1/jobs"),
        ("GET", "/research/v1/jobs/{job_id}"),
        ("DELETE", "/research/v1/jobs/{job_id}"),
        ("GET", "/research/v1/assessments/{assessment_id}"),
        ("DELETE", "/research/v1/assessments/{assessment_id}"),
    }
    for p in ("/videos/x", "/research/v1/videos/x", "/research/v1/assessments/x/video", "/docs", "/redoc"):
        assert client.get(p).status_code in (404, 422)


def test_errors_never_leak_tracebacks(
    db_settings: Settings, db_repo: ResearchRepository, monkeypatch: pytest.MonkeyPatch
) -> None:
    app = create_app(db_settings, engine=db_repo.engine, repository=db_repo)

    def boom(*_a: Any, **_k: Any) -> None:
        raise RuntimeError("secret detail /Users/someone/private")

    monkeypatch.setattr(db_repo, "get_job", boom)
    with TestClient(app, base_url=API_BASE, raise_server_exceptions=False) as c:
        resp = c.get(f"/research/v1/jobs/{uuid.uuid4()}")
    assert_safe_error(resp, 500, "internal_error")
    assert "secret" not in resp.text


def test_queue_full_bounds_temporary_disk(
    db_settings: Settings, db_repo: ResearchRepository, squat_video: Path
) -> None:
    tight = db_settings.with_overrides(limits=MediaLimits(max_pending_uploads=1))
    app = create_app(tight, engine=db_repo.engine, repository=db_repo)
    with TestClient(app, base_url=API_BASE) as c:
        assert submit(c, squat_video.read_bytes()).status_code == 202
        assert_safe_error(submit(c, squat_video.read_bytes() + b"x"), 503, "queue_full")


def test_health_live_and_ready(client: TestClient, db_settings: Settings) -> None:
    live = client.get("/health/live")
    assert live.status_code == 200 and live.json() == {"status": "ok", "checks": {}}
    ready = client.get("/health/ready")
    assert ready.status_code == 200 and ready.json()["checks"]["schema_current"] is True


@pytest.mark.parametrize("schema_path", ["direct", "downgrade"])
def test_m7_readiness_accepts_m7_only_schema(db_settings: Settings, squat_video: Path, schema_path: str) -> None:
    if schema_path == "direct":
        upgrade(db_settings.database_url, "0001_research_initial")
    else:
        upgrade(db_settings.database_url)
        downgrade(db_settings.database_url, "0001_research_initial")
    engine = make_engine(db_settings.database_url)
    try:
        assert check_ready(engine)["schema_current"] is True
        assert check_ready(engine, required_revision=M8_DATABASE_SCHEMA_REVISION)["schema_current"] is False
        with TestClient(create_app(db_settings, engine=engine), base_url=API_BASE) as client:
            response = client.get("/health/ready")
            submission = submit(client, squat_video.read_bytes())
        assert response.status_code == 200
        assert response.json()["checks"]["schema_revision"] == "0001_research_initial"
        assert submission.status_code == 202
        repository = ResearchRepository(engine)
        outcome = Worker(db_settings, repository, DotPoseProvider()).process_next()
        assert outcome is not None and outcome.status == "succeeded"
        assert repository.get_assessment(outcome.assessment_id) is not None
    finally:
        engine.dispose()


def test_readiness_fails_without_database_or_migrations(tmp_path: Path) -> None:
    unmigrated = Settings(database_url=f"sqlite+pysqlite:///{tmp_path / 'empty.db'}", upload_dir=tmp_path / "u")
    with TestClient(create_app(unmigrated), base_url=API_BASE) as c:
        r = c.get("/health/ready")
        assert r.status_code == 503 and r.json()["checks"]["schema_current"] is False
        assert c.get("/health/live").status_code == 200  # liveness has no dependencies
    down = Settings(database_url="postgresql+psycopg://nobody:x@127.0.0.1:1/none", upload_dir=tmp_path / "u2")
    with TestClient(
        create_app(down, engine=make_engine(down.database_url, connect_args={"connect_timeout": 1})), base_url=API_BASE
    ) as c:
        r = c.get("/health/ready")
        assert r.status_code == 503 and r.json()["checks"]["database"] == "unavailable"
        assert "nobody" not in r.text and "Traceback" not in r.text
