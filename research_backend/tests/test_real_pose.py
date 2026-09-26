"""REAL pose runtime + model (mediapipe 0.10.31, pose_landmarker_full).

Runtime-integration evidence only — NOT scientific validation: one still
image of one person says nothing about joint-angle accuracy, and a still
frame cannot contain a squat. Enable with RESEARCH_TEST_REAL_POSE=1 (the
pinned test image is fetched once, before any monitored run).
"""

from __future__ import annotations

import json
import os
import subprocess
import sys
import threading
import time
from pathlib import Path
from typing import Any

import numpy as np
import pytest

from physiq_research.config import Settings
from physiq_research.media.decoder import VideoDecoder
from physiq_research.pose import mediapipe_provider as mpp
from physiq_research.pose.base import PoseProviderError
from physiq_research.pose.identity import POSE_MODEL
from physiq_research.storage.repository import ResearchRepository
from physiq_research.workers.worker import Worker
from tests.support.jobs import enqueue_file

pytestmark = pytest.mark.real_pose
BACKEND = Path(__file__).resolve().parents[1]
MODEL = Path(
    os.environ.get("RESEARCH_POSE_MODEL_PATH") or BACKEND.parent / "vendor" / "mediapipe" / "pose_landmarker_full.task"
)


@pytest.fixture(scope="module")
def image() -> np.ndarray:
    from tests.support.real_fixtures import pose_image

    return pose_image()


@pytest.fixture(scope="module")
def expected() -> list[tuple[float, float, float]]:
    from tests.support.real_fixtures import expected_landmarks

    return expected_landmarks()


@pytest.fixture(scope="module")
def provider() -> mpp.MediaPipePoseProvider:
    return mpp.MediaPipePoseProvider(MODEL)


def detect_once(provider: mpp.MediaPipePoseProvider, rgb: np.ndarray, repeats: int = 3) -> dict[str, Any]:
    session = provider.open_session()
    try:
        out = {}
        for i in range(repeats):  # VIDEO mode: a few frames let tracking settle
            out = session.detect(np.ascontiguousarray(rgb), i * 66)
        return out
    finally:
        session.close()


def max_error(raw: dict[str, Any], expected: list[tuple[float, float, float]]) -> float:
    pose = raw["landmarks"][0]
    return max(max(abs(p["x"] - e[0]), abs(p["y"] - e[1])) for p, e in zip(pose, expected, strict=True))


def test_runtime_identity_and_model_verification(
    provider: mpp.MediaPipePoseProvider, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    ident = provider.identity
    assert ident["installed_runtime_version"] == "0.10.31" == ident["runtime"]["package_version"]
    assert (
        ident["model"]["sha256"]
        == POSE_MODEL["sha256"]
        == "5134a3aad27a58b93da0088d431f366da362b44e3ccfbe3462b3827a839011b1"
    )
    assert ident["model_verified"] is True and len(ident["native_library_sha256"]) == 64
    assert (ident["runtime"]["running_mode"], ident["runtime"]["delegate"], ident["runtime"]["num_poses"]) == (
        "VIDEO",
        "CPU",
        2,
    )
    tampered = tmp_path / "model.task"
    data = bytearray(MODEL.read_bytes())
    data[1000] ^= 0xFF
    tampered.write_bytes(bytes(data))
    with pytest.raises(PoseProviderError) as info:
        mpp.MediaPipePoseProvider(tampered)
    assert info.value.code == "model_integrity_failed"
    monkeypatch.setattr(mpp, "installed_runtime_version", lambda: "0.10.35")
    with pytest.raises(PoseProviderError) as info:
        mpp.MediaPipePoseProvider(MODEL)
    assert info.value.code == "runtime_version_mismatch"


def test_landmarks_match_mediapipes_published_expectation(
    provider: mpp.MediaPipePoseProvider, image: np.ndarray, expected: list
) -> None:
    raw = detect_once(provider, image)
    assert len(raw["landmarks"]) == 1 and len(raw["landmarks"][0]) == 33
    err = max_error(raw, expected)
    print(f"\nmax |Δ| vs published landmarks (normalised units): {err:.4f}")
    assert err < 0.03  # runtime sanity, not accuracy validation


def test_no_person_gives_no_pose(provider: mpp.MediaPipePoseProvider) -> None:
    blank = np.full((480, 640, 3), 90, dtype=np.uint8)
    assert detect_once(provider, blank)["landmarks"] == []


def test_two_people_are_both_reported(provider: mpp.MediaPipePoseProvider, image: np.ndarray) -> None:
    two = np.concatenate([image[:, 150:850], image[:, 150:850]], axis=1)
    assert len(detect_once(provider, two)["landmarks"]) == 2


def test_rotation_metadata_with_the_real_model(
    provider: mpp.MediaPipePoseProvider, image: np.ndarray, expected: list, tmp_path: Path
) -> None:
    from tests.support.videos import write_image_video

    limits = Settings(database_url="sqlite://", upload_dir=tmp_path).limits
    path = write_image_video(tmp_path / "rot.mp4", image, rotation=90, duration_ms=300, options={"crf": "12"})
    with VideoDecoder(path, limits) as dec:
        dec.probe()
        first = next(iter(dec.frames()))
        upright = dec.to_rgb(first)
        stored = first.av_frame.to_ndarray(format="rgb24")  # the sideways pixels as coded
    assert upright.shape[:2] == (666, 1000) and stored.shape[:2] == (1000, 666)
    good = max_error(detect_once(provider, upright), expected)
    sideways = detect_once(provider, stored)
    print(
        f"\nupright after display-matrix rotation: max |Δ| {good:.4f}; "
        f"sideways pixels: {len(sideways['landmarks'])} pose(s)"
    )
    assert good < 0.03
    if sideways["landmarks"]:
        # landmarks of a sideways person, expressed in sideways image coordinates, cannot match
        assert max_error(sideways, expected) > 0.1


def test_real_worker_pipeline_and_session_lifecycle(
    settings: Settings, repo: ResearchRepository, image: np.ndarray, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    from tests.support.videos import write_blank_video, write_image_video

    reads: list[Path] = []
    real_read = mpp.read_verified_model
    monkeypatch.setattr(mpp, "read_verified_model", lambda p: reads.append(p) or real_read(p))
    provider = mpp.MediaPipePoseProvider(MODEL)
    worker = Worker(settings, repo, provider)
    cases = {
        "person": (
            write_image_video(tmp_path / "p.mp4", image, duration_ms=2500),
            ("insufficient_calibration", "not_side_on"),
        ),
        "blank": (
            write_blank_video(tmp_path / "b.mp4", size=(640, 480), duration_ms=2000),
            ("no_pose", "no_person_detected"),
        ),
        "two": (
            write_image_video(tmp_path / "t.mp4", np.concatenate([image[:, 150:850]] * 2, axis=1), duration_ms=2000),
            ("multiple_people", "multiple_people_during_calibration"),
        ),
    }
    for name, (video, (code, detail)) in cases.items():
        enqueue_file(settings, repo, video)
        out = worker.process_next()
        assert out is not None and (out.failure_code, out.failure_detail) == (code, detail), name
        assert out.upload_deleted
    assert len(reads) == 1  # weights loaded and verified once per worker
    assert provider.sessions_opened == 3  # a fresh graph per video (no cross-subject tracking state)


@pytest.mark.netmon
@pytest.mark.skipif(sys.platform != "darwin", reason="the libc interposer is macOS-specific")
def test_no_network_activity_during_sustained_real_inference(tmp_path: Path, image: np.ndarray) -> None:
    """Runs the real worker on the real model for RESEARCH_NETMON_SECONDS
    (default 180 s) with every libc network call logged by tools/netmon and
    the process's sockets sampled with lsof. The run ends with ONE deliberate
    loopback connection — a positive control proving the monitor sees calls."""
    seconds = float(os.environ.get("RESEARCH_NETMON_SECONDS", "180"))
    dylib = tmp_path / "netmon.dylib"
    subprocess.run(
        ["clang", "-dynamiclib", "-O2", "-o", str(dylib), str(BACKEND / "tools" / "netmon" / "netmon.c")], check=True
    )
    log = tmp_path / "net.log"
    env = {**os.environ, "NETMON_LOG": str(log), "DYLD_INSERT_LIBRARIES": str(dylib)}
    proc = subprocess.Popen(
        [
            sys.executable,
            str(BACKEND / "tools" / "real_pose_smoke.py"),
            "--seconds",
            str(seconds),
            "--positive-control",
        ],
        cwd=BACKEND,
        env=env,
        stdout=subprocess.PIPE,
        stderr=subprocess.DEVNULL,
        text=True,
    )
    samples: list[str] = []

    def sample() -> None:
        while proc.poll() is None:
            r = subprocess.run(
                ["lsof", "-nP", "-a", "-i", "-p", str(proc.pid)], capture_output=True, text=True, check=False
            )
            samples.append(r.stdout.strip())
            time.sleep(2)

    sampler = threading.Thread(target=sample)
    sampler.start()
    stdout, _ = proc.communicate(timeout=seconds + 600)
    sampler.join()
    assert proc.returncode == 0
    report = json.loads(stdout.strip().splitlines()[-1])
    lines = [ln for ln in log.read_text().splitlines() if "netmon loaded" not in ln]
    port = report["positive_control_port"]
    inet_sockets = [ln for ln in lines if " socket domain=2 " in ln or " socket domain=30 " in ln]
    connects = [ln for ln in lines if " connect" in ln and " unix" not in ln]  # inet only
    local_ipc = [ln for ln in lines if " connect" in ln and " unix" in ln]
    lookups = [ln for ln in lines if "getaddrinfo" in ln or "gethostbyname" in ln]
    sends = [ln for ln in lines if " sendto " in ln]
    evidence = {
        "wall_seconds": report["wall_seconds"],
        "rounds": report["rounds"],
        "jobs": len(report["results"]),
        "outcomes": sorted({(r["video"], r["failure_code"]) for r in report["results"]}),
        "logged_calls": len(lines),
        "inet_sockets": inet_sockets,
        "connects": connects,
        "local_ipc_connects": local_ipc,
        "lookups": lookups,
        "sends": sends,
        "lsof_samples": len(samples),
        "lsof_samples_with_sockets": sum(1 for s in samples if s),
        "max_rss_mb": report["max_rss_mb"],
    }
    print("\nNETMON " + json.dumps(evidence, default=str))
    (BACKEND / ".local").mkdir(exist_ok=True)
    (BACKEND / ".local" / "netmon_evidence.json").write_text(
        json.dumps({**evidence, "report": report}, indent=1, default=str)
    )
    # Positive control: exactly the deliberate loopback connection was seen …
    assert connects == [ln for ln in connects if f"inet 127.0.0.1:{port}" in ln] and len(connects) == 1
    assert len(inet_sockets) == 2  # the control's server and client sockets
    # … and nothing else: no DNS lookups, no datagrams, no other sockets.
    assert lookups == [] and sends == []
    assert all("unix /var/run/syslog" in ln for ln in local_ipc)  # local system-log IPC only
    assert all(not s or f":{port}" in s for s in samples)
    assert report["wall_seconds"] >= seconds * 0.95
    assert all(r["upload_deleted"] for r in report["results"]) and report["leftover_uploads"] == []
