"""The research pipeline on real encoded media (processor + worker, SQLite).

The DotPoseProvider stands in for the learned model (tests/support); the
decoder, timestamps, orientation, sampling, protocol, segmentation,
skeleton, features, storage and cleanup are the production code.
Hand-derived truth for the M6 squat: ROM 80°, descent 1080 ms, ascent
1480 ms, repetition 2560 ms, deepest at 4200 ms of media time.
"""

from __future__ import annotations

import math
from fractions import Fraction
from pathlib import Path
from typing import Any

import numpy as np
import pytest

from physiq_research.config import Settings
from physiq_research.media import orientation as orientation_module
from physiq_research.records import ARTIFACT_MODELS, AssessmentSummary
from physiq_research.storage.repository import ResearchRepository
from physiq_research.workers.worker import Worker
from tests.support.jobs import enqueue_file
from tests.support.providers import DotPoseProvider, ScriptedPoseProvider
from tests.support.synthetic_pose import provider_result_at
from tests.support.videos import times_cfr, write_blank_video, write_dot_squat_video


def run(settings: Settings, repo: ResearchRepository, video: Path, provider: Any = None) -> tuple[Any, Any]:
    job = enqueue_file(settings, repo, video)
    outcome = Worker(settings, repo, provider or DotPoseProvider()).process_next()
    assert outcome is not None and outcome.job_id == job.id
    assert outcome.upload_deleted
    return outcome, repo.get_job(job.id)


def assessment(repo: ResearchRepository, outcome: Any) -> Any:
    assert outcome.status == "succeeded", (outcome.failure_code, outcome.failure_detail, outcome.failure_stage)
    stored = repo.get_assessment(outcome.assessment_id)
    assert stored is not None
    return stored


def assert_hand_derived(summary: dict[str, Any], *, time_tol: float = 12.0, angle_tol: float = 0.6) -> None:
    k = summary["kinematics"]
    assert k["knee"]["standing_reference_deg"] == pytest.approx(175, abs=angle_tol)
    assert k["knee"]["minimum_deg"] == pytest.approx(95, abs=angle_tol)
    assert k["knee"]["apparent_rom_deg"] == pytest.approx(80, abs=angle_tol)
    assert k["timing"]["descent_ms"] == pytest.approx(1080, abs=time_tol)
    assert k["timing"]["ascent_ms"] == pytest.approx(1480, abs=time_tol)
    assert k["timing"]["repetition_ms"] == pytest.approx(2560, abs=time_tol)
    ev = summary["segmentation"]["events"]
    assert ev["descent_start_ms"] == pytest.approx(3120, abs=time_tol)
    assert ev["deepest_ms"] == pytest.approx(4200, abs=70)
    assert ev["ascent_end_ms"] == pytest.approx(5680, abs=time_tol)
    assert k["trunk_thigh"]["state"] == "available"
    assert k["trunk_thigh"]["apparent_change_deg"] == pytest.approx(75, abs=angle_tol)
    assert k["symmetry"]["state"] == "unavailable_for_capture_mode"


def test_successful_assessment_record(settings: Settings, repo: ResearchRepository, squat_video: Path) -> None:
    outcome, job = run(settings, repo, squat_video)
    stored = assessment(repo, outcome)
    assert job.status == "succeeded" and job.upload_token is None
    s = stored.summary
    AssessmentSummary.model_validate(s)
    assert_hand_derived(s)
    assert s["analysis_side"] == "left" and s["facing_in_image"] == "positive_x" and s["mirror_applied"] is False
    assert s["quality"]["state"] == "sufficient"
    assert s["frame_statistics"]["decoded_frames"] == 211 and s["frame_statistics"]["sampled_frames"] == 106
    for kind, model in ARTIFACT_MODELS.items():
        model.model_validate(stored.artifacts[kind].data)
    tn = stored.artifacts["time_normalized_traces"].data
    assert len(tn["knee_deg"]) == 101 and tn["knee_deg"][0] == pytest.approx(167, abs=0.6)
    assert min(v for v in tn["knee_deg"] if v is not None) == pytest.approx(95, abs=0.6)


def test_provenance_answers_every_reproducibility_question(
    settings: Settings, repo: ResearchRepository, squat_video: Path
) -> None:
    outcome, _ = run(settings, repo, squat_video)
    stored = assessment(repo, outcome)
    p = stored.provenance
    assert p["source"]["sha256"] == stored.source_sha256 and len(stored.source_sha256) == 64  # which video
    assert (
        p["decoder"]["contract"] == "video-decoding-v0.1" and p["decoder"]["identity"]["library"] == "PyAV"
    )  # decoder
    assert p["decoder"]["identity"]["library_version"] == "18.1.0" and p["decoder"]["identity"]["ffmpeg_version"]
    assert p["orientation"]["transform_applied"] == "none"  # orientation transform
    assert p["sampling"]["contract"] == "video-sampling-v0.1" and p["sampling"]["parameters"]["target_rate_hz"] == 15
    assert p["pose"]["runtime"]["id"] == "test-dot-detector"  # pose provider (test double here)
    assert "sha256" in p["pose"]["model"]  # pose model hash
    assert p["normalization"]["contract"] == "normalized-skeleton-v0.1"
    assert p["segmentation"]["source_semantics"] == {
        "kinematics": "squat-kinematics-v0.2",
        "result": "movement-assessment-v0.1",
        "pose_frame": "pose-frame-v1",
    }
    assert p["segmentation"]["implementation"] == "research-pipeline-v0.1"
    assert p["features"] == {
        "kinematic_features": "kinematic-features-v0.1",
        "time_normalization": "time-normalization-v0.1",
    }
    assert p["pipeline"]["version"] == "research-pipeline-v0.1"
    assert p["pipeline"]["processed_started_at"] <= p["pipeline"]["processed_finished_at"]  # when
    assert stored.movement_type == "bodyweight_squat_sagittal" and stored.capture_mode == "single_camera_sagittal"
    assert stored.versions["research_pipeline"] == "research-pipeline-v0.1"


@pytest.mark.parametrize("rotation", [90, -90, 180])
def test_rotation_metadata_gives_the_same_derived_data(
    settings: Settings, repo: ResearchRepository, video_dir: Path, rotation: int
) -> None:
    times = times_cfr(30, 7000)
    plain = assessment(repo, run(settings, repo, write_dot_squat_video(video_dir / "p.mp4", times_s=times))[0])
    rot = assessment(
        repo,
        run(settings, repo, write_dot_squat_video(video_dir / f"r{rotation}.mp4", times_s=times, rotation=rotation))[0],
    )
    assert rot.provenance["orientation"]["transform_applied"] != "none"
    assert rot.provenance["source"]["technical"]["display_width"] == 360
    for key in ("kinematics", "segmentation", "quality", "calibration"):
        assert rot.summary[key] == plain.summary[key]
    assert rot.artifacts["normalized_skeleton"].data["frames"] == plain.artifacts["normalized_skeleton"].data["frames"]
    assert rot.artifacts["pose_series"].data["frame_width"] == 360


def test_sideways_pixels_would_corrupt_the_skeleton(
    settings: Settings, repo: ResearchRepository, video_dir: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Negative control: with orientation normalisation disabled, a portrait
    squat stored as landscape pixels is analysed sideways. Included angles are
    rotation-invariant, so the dot test double still "measures" 80° — but the
    frame geometry and the skeleton's vertical axis are wrong. (With the real
    model a sideways person is also detected worse; tests/test_real_pose.py.)"""
    video = write_dot_squat_video(video_dir / "rot90b.mp4", rotation=90)
    good = assessment(repo, run(settings, repo, video)[0])
    monkeypatch.setattr(orientation_module.Orientation, "apply", lambda self, rgb: rgb)
    bad = assessment(
        repo, run(settings, repo, write_dot_squat_video(video_dir / "rot90c.mp4", rotation=90, duration_ms=6999))[0]
    )
    assert good.artifacts["pose_series"].data["frame_width"] == 360
    assert bad.artifacts["pose_series"].data["frame_width"] == 640  # landscape pixels analysed

    def hip_path(a: Any) -> tuple[float, float]:
        frames = a.artifacts["normalized_skeleton"].data["frames"]
        standing, bottom = frames[0]["landmarks"]["left_hip"], frames[63]["landmarks"]["left_hip"]
        return bottom["x"] - standing["x"], bottom["y"] - standing["y"]

    gx, gy = hip_path(good)
    bx, by = hip_path(bad)
    assert gy < -0.1 and abs(gx) < abs(gy)  # upright: the hip goes DOWN
    assert abs(by) < abs(bx)  # sideways: the "descent" lies on the horizontal axis


def test_variable_frame_rate_and_60fps_timing(settings: Settings, repo: ResearchRepository, video_dir: Path) -> None:
    rng = np.random.default_rng(5)
    times = [Fraction(0)]
    while times[-1] < Fraction(7):
        times.append(times[-1] + Fraction(int(rng.integers(25, 45)), 1000))
    vfr = write_dot_squat_video(video_dir / "vfr_squat.mp4", times_s=times)
    assert_hand_derived(assessment(repo, run(settings, repo, vfr)[0]).summary, time_tol=25)
    sixty = write_dot_squat_video(video_dir / "sixty.mp4", fps=60)
    s = assessment(repo, run(settings, repo, sixty)[0]).summary
    assert_hand_derived(s)
    assert s["frame_statistics"]["decoded_frames"] == 421 and s["frame_statistics"]["sampled_frames"] == 106


def test_timestamp_chain_source_to_stored_trace(settings: Settings, repo: ResearchRepository, video_dir: Path) -> None:
    """source PTS → sampling → pose timestamp → segmentation → stored trace."""
    tb = Fraction(1, 600)
    times = [Fraction(0)]
    while times[-1] < Fraction(7):
        times.append(times[-1] + Fraction(20 + 7 * (len(times) % 4), 600))  # irregular, exact in 1/600
    video = write_dot_squat_video(video_dir / "chain.mp4", times_s=times, time_base=tb)
    stored = assessment(repo, run(settings, repo, video)[0])
    series = stored.artifacts["pose_series"].data["frames"]
    # The muxer picks the stream time base; the decoder must use whatever the file declares.
    num, den = map(int, stored.provenance["source"]["technical"]["time_base"].split("/"))
    stream_tb = Fraction(num, den)
    first_pts = series[0]["source_pts"]  # the first decoded frame is always sampled
    source_ms = {float(t * 1000) for t in times}
    for f in series:
        assert f["t_ms"] in source_ms  # a real frame's own time, never a grid time
        assert f["t_ms"] == float((Fraction(f["source_pts"]) - first_pts) * stream_tb * 1000)
        assert f["provider_timestamp_ms"] == math.floor(f["t_ms"])
    trace = stored.artifacts["kinematic_traces"].data
    capture_times = [f["t_ms"] for f in series if f["phase"] == "capture"]
    assert [s["t_ms"] for s in trace["knee"]] == capture_times
    ev = trace["events"]
    assert capture_times[0] <= ev["descent_start_ms"] <= ev["deepest_ms"] <= ev["ascent_end_ms"] <= capture_times[-1]
    assert ev["deepest_ms"] in capture_times  # the deepest point is a real sample
    assert stored.summary["kinematics"]["timing"]["repetition_ms"] == pytest.approx(
        ev["ascent_end_ms"] - ev["descent_start_ms"]
    )
    tn = stored.artifacts["time_normalized_traces"].data
    assert tn["t_ms"][0] == ev["descent_start_ms"] and tn["t_ms"][-1] == pytest.approx(ev["ascent_end_ms"])


def test_mirrored_capture_canonicalises(settings: Settings, repo: ResearchRepository, video_dir: Path) -> None:
    plain = assessment(repo, run(settings, repo, write_dot_squat_video(video_dir / "fp.mp4"))[0])
    mirrored = assessment(repo, run(settings, repo, write_dot_squat_video(video_dir / "fm.mp4", mirror=True))[0])
    assert mirrored.summary["facing_in_image"] == "negative_x" and mirrored.summary["mirror_applied"] is True
    assert mirrored.summary["analysis_side"] == plain.summary["analysis_side"] == "left"
    # Compare translation-free vectors (the test double reports the far hip 6 px
    # to the image right in both videos, which shifts the hip-centre origin).
    for i in (0, 30, 60, 80):
        pa = plain.artifacts["normalized_skeleton"].data["frames"][i]["landmarks"]
        pb = mirrored.artifacts["normalized_skeleton"].data["frames"][i]["landmarks"]
        for a_name, b_name in (("left_knee", "left_ankle"), ("left_hip", "left_knee"), ("nose", "left_ankle")):
            va = (pa[a_name]["x"] - pa[b_name]["x"], pa[a_name]["y"] - pa[b_name]["y"])
            vb = (pb[a_name]["x"] - pb[b_name]["x"], pb[a_name]["y"] - pb[b_name]["y"])
            assert va == pytest.approx(vb, abs=0.004)  # dot-centroid quantisation only
    assert mirrored.summary["kinematics"]["knee"]["apparent_rom_deg"] == pytest.approx(80, abs=0.6)


# ── classified failures (stable codes, no derived data kept) ─────────────


def scripted(scenario_for: Any) -> ScriptedPoseProvider:
    return ScriptedPoseProvider(lambda ts, rgb: scenario_for(ts))


@pytest.fixture(scope="module")
def landscape_video(video_dir: Path) -> Path:
    """640×480 (the M6 fixture geometry), 30 fps, 7 s; pixels are ignored by the scripted provider."""
    return write_blank_video(video_dir / "landscape_640x480.mp4", size=(640, 480), duration_ms=7000)


@pytest.mark.parametrize(
    ("script", "code", "detail"),
    [
        (lambda t: provider_result_at(t, "front"), "insufficient_calibration", "not_side_on"),
        (lambda t: provider_result_at(t, "low"), "insufficient_calibration", "no_side_visible"),
        (lambda t: provider_result_at(t, "two"), "multiple_people", "multiple_people_during_calibration"),
        (
            lambda t: provider_result_at(t, "two" if t >= 4000 else "squat"),
            "multiple_people",
            "multiple_people_during_capture",
        ),
        (lambda t: provider_result_at(t, "stand"), "no_clear_repetition", "no_clear_repetition"),
        (lambda t: provider_result_at(t, "partial"), "no_clear_repetition", "did_not_return_to_standing"),
        (
            lambda t: {"landmarks": []} if 3800 < t < 4400 else provider_result_at(t, "squat"),
            "data_gap",
            "data_gap_during_repetition",
        ),
        (lambda t: provider_result_at(t, "garbage"), "insufficient_calibration", "no_person"),
    ],
)
def test_failure_classification(
    settings: Settings, repo: ResearchRepository, landscape_video: Path, script: Any, code: str, detail: str
) -> None:
    outcome, job = run(settings, repo, landscape_video, scripted(script))
    assert (outcome.status, outcome.failure_code, outcome.failure_detail) == ("failed", code, detail)
    assert job.status == "failed" and job.failure_code == code and job.assessment_id is None
    diag = job.failure_diagnostics
    assert diag["schema_version"] == "research-failure-diagnostics-v1"
    assert "landmarks" not in str(diag) and "trace" not in str(diag)  # no derived trajectories for failures


def test_scripted_clean_squat_succeeds(settings: Settings, repo: ResearchRepository, landscape_video: Path) -> None:
    # The scripted provider only sees the integer provider timestamp ⌊t_ms⌋ while
    # frames keep their exact media time, so times agree to < 1 ms; angles exactly.
    outcome, _ = run(settings, repo, landscape_video, scripted(lambda t: provider_result_at(t, "squat")))
    assert_hand_derived(assessment(repo, outcome).summary, time_tol=1.0, angle_tol=1e-9)


def test_no_pose_video(settings: Settings, repo: ResearchRepository, video_dir: Path) -> None:
    outcome, _job = run(settings, repo, write_blank_video(video_dir / "blank.mp4", duration_ms=3000))
    assert (outcome.failure_code, outcome.failure_detail, outcome.failure_stage) == (
        "no_pose",
        "no_person_detected",
        "protocol",
    )


def test_invalid_video_is_a_stable_failure(settings: Settings, repo: ResearchRepository, tmp_path: Path) -> None:
    bad = tmp_path / "bad.mp4"
    bad.write_bytes(b"\x00\x00\x00\x18ftypisom\x00\x00\x02\x00isomiso2" + b"\x00" * 500)
    _outcome, job = run(settings, repo, bad)
    assert (job.failure_code, job.failure_detail, job.failure_stage) == (
        "invalid_video",
        "container_open_failed",
        "probe",
    )


def test_deterministic_stages_are_reproducible(
    settings: Settings, repo: ResearchRepository, squat_video: Path, tmp_path: Path
) -> None:
    """Same video, fresh database: identical derived artifacts (content digests)."""
    from physiq_research.storage.db import make_engine, upgrade

    first = assessment(repo, run(settings, repo, squat_video)[0])
    other = settings.with_overrides(
        database_url=f"sqlite+pysqlite:///{tmp_path / 'second.db'}", upload_dir=tmp_path / "up2"
    )
    upgrade(other.database_url)
    repo2 = ResearchRepository(make_engine(other.database_url))
    second = assessment(repo2, run(other, repo2, squat_video)[0])
    for kind in ARTIFACT_MODELS:
        assert first.artifacts[kind].content_sha256 == second.artifacts[kind].content_sha256
    assert first.summary_sha256 == second.summary_sha256
