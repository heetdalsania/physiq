"""Protocol replay, normalized-skeleton-v0.1 and time-normalization-v0.1."""

from __future__ import annotations

import math

import pytest

from physiq_research.domain.geometry import Point, included_angle_deg
from physiq_research.domain.kinematics import AngleSample
from physiq_research.domain.pose_frame import PoseFrame, normalize_pose_result
from physiq_research.domain.protocol import replay_protocol
from physiq_research.domain.skeleton import SkeletonReferenceUnavailable, derive_transform, normalize_frame
from physiq_research.domain.smoothing import smooth_trace
from physiq_research.domain.squat_analysis import analyze_squat_capture
from physiq_research.domain.time_normalization import percent_times, resample
from tests.support.synthetic_pose import lean_for_knee, provider_pose, provider_result_at, squat_knee_at


def frames_for(fn, times, w: int = 640, h: int = 480) -> list[PoseFrame]:
    return [
        normalize_pose_result(fn(t), t_ms=t, frame_width=w, frame_height=h, provider="p", model_id="m") for t in times
    ]


TIMES = [k * 100.0 for k in range(0, 81)]


# ── protocol replay ──────────────────────────────────────────────────────


def test_replay_calibrates_then_captures_until_repetition_finished() -> None:
    r = replay_protocol(frames_for(lambda t: provider_result_at(t, "squat"), TIMES))
    # The first window spanning ≥ 1700 ms with ≥ 8 usable still frames: 0…1700 ms (18 frames).
    assert r.calibrated and r.calibration_complete_ms == 1700
    assert [f.t_ms for f in r.calibration_window] == [k * 100.0 for k in range(18)]
    assert r.capture_frames[0].t_ms == 1800  # the calibrating frame is not a capture frame
    assert r.end == "repetition_finished"
    # finished ≥ 1 s after the interpolated ascent end (5680 ms) → 6700 ms
    assert r.capture_frames[-1].t_ms == 6700
    assert r.phases.count("calibration_window") == 18
    assert r.phases[-1] == "after_capture"


def test_replay_stops_at_a_second_person() -> None:
    r = replay_protocol(frames_for(lambda t: provider_result_at(t, "two" if t >= 4000 else "squat"), TIMES))
    assert r.end == "multiple_people"
    assert r.capture_frames[-1].status == "multiple_poses"
    a = analyze_squat_capture(r.calibration, r.capture_frames)
    assert a.status == "insufficient_data" and a.insufficient_reason == "multiple_people_during_capture"


def test_replay_capture_limited_to_ten_seconds_of_media_time() -> None:
    times = [k * 100.0 for k in range(0, 200)]
    r = replay_protocol(frames_for(lambda t: provider_result_at(t, "stand"), times))
    assert r.end == "max_duration"
    assert r.capture_frames[-1].t_ms - r.calibration_complete_ms < 10000  # type: ignore[operator]


def test_replay_never_calibrates_for_frontal_view() -> None:
    r = replay_protocol(frames_for(lambda t: provider_result_at(t, "front"), TIMES))
    assert not r.calibrated and r.end == "no_calibration_before_end" and r.last_guidance == "not_side_on"


def test_replay_positioning_timeout_is_media_time() -> None:
    times = [k * 500.0 for k in range(0, 100)]
    r = replay_protocol(frames_for(lambda t: provider_result_at(t, "front"), times))
    assert r.end == "positioning_timeout"


# ── normalized skeleton ─────────────────────────────────────────────────


def _cal_and_frames(transform_pose, w: int = 640, h: int = 480):
    def raw(t: float) -> dict:
        # Provider output is normalised; frame size w×h only sets the pixel scale.
        knee = squat_knee_at(t)
        pts = provider_pose(knee, lean_for_knee(knee))
        return {"landmarks": [[transform_pose(p) for p in pts]]}

    frames = frames_for(raw, TIMES, w, h)
    r = replay_protocol(frames)
    assert r.calibrated
    return r, frames


def _skeletons(transform_pose, w: int = 640, h: int = 480):
    r, frames = _cal_and_frames(transform_pose, w, h)
    assert r.calibration is not None
    t = derive_transform(r.calibration, r.calibration_window)
    return t, [normalize_frame(f, t) for f in frames]


def _assert_same(a: list, b: list, tol: float = 1e-9) -> None:
    assert len(a) == len(b)
    for fa, fb in zip(a, b, strict=True):
        for name in fa:
            la, lb = fa[name], fb[name]
            assert (la is None) == (lb is None), name
            if la is not None:
                assert la.x == pytest.approx(lb.x, abs=tol) and la.y == pytest.approx(lb.y, abs=tol), name


def identity(p: dict) -> dict:
    return dict(p)


def test_translation_invariance() -> None:
    _, base = _skeletons(identity)
    _, moved = _skeletons(lambda p: {**p, "x": p["x"] - 0.1, "y": p["y"] + 0.05})
    _assert_same(base, moved)


def test_uniform_scale_and_resolution_invariance() -> None:
    _, base = _skeletons(identity)
    # Same scene at twice the resolution: normalised provider coordinates are identical,
    # pixel coordinates double, and so does the calibration scale.
    t1, _ = _skeletons(identity)
    t2, double = _skeletons(identity, 1280, 960)
    _assert_same(base, double)
    assert t2.scale_px == pytest.approx(2 * t1.scale_px, rel=1e-12)
    # Person half the size in the same frame (camera twice as far): pixel geometry halves.
    t_half, half = _skeletons(lambda p: {**p, "x": 0.5 + (p["x"] - 0.5) / 2, "y": 0.5 + (p["y"] - 0.5) / 2})
    _assert_same(base, half)
    assert t_half.scale_px == pytest.approx(t1.scale_px / 2, rel=1e-9)


def test_mirror_canonicalisation_keeps_anatomical_side() -> None:
    t_base, base = _skeletons(identity)
    t_mirror, mirrored = _skeletons(lambda p: {**p, "x": 1 - p["x"]})
    assert t_base.facing == "positive_x" and not t_base.mirror_applied
    assert t_mirror.facing == "negative_x" and t_mirror.mirror_applied
    _assert_same(base, mirrored)  # labels unchanged: left_knee is still the left knee


def test_real_joint_angle_differences_are_not_normalised_away() -> None:
    _, base = _skeletons(identity)
    # angles from normalised coordinates equal the pixel angles (similarity transform)…
    _r, frames = _cal_and_frames(identity)
    for f, s in zip(frames, base, strict=True):
        if f.status != "pose":
            continue
        px = included_angle_deg(f.landmarks["left_hip"], f.landmarks["left_knee"], f.landmarks["left_ankle"])
        nz = included_angle_deg(s["left_hip"], s["left_knee"], s["left_ankle"])
        assert px is not None and nz is not None and abs(px - nz) < 1e-9
    # …and the squat is still there: knee angle at the bottom is 95°, not the standing 175°
    bottom = base[42]  # t = 4200 ms
    assert included_angle_deg(bottom["left_hip"], bottom["left_knee"], bottom["left_ankle"]) == pytest.approx(
        95, abs=1e-6
    )


def test_fixed_origin_and_scale_preserve_real_movement() -> None:
    t, sk = _skeletons(identity)
    standing_hip = sk[0]["left_hip"]
    bottom_hip = sk[42]["left_hip"]
    assert standing_hip is not None and bottom_hip is not None
    assert abs(standing_hip.y) < 0.02  # origin = standing hip centre (left/right hips 6 px apart)
    assert bottom_hip.y < -0.1  # the hip descends in canonical +y-up coordinates
    ankle = sk[42]["left_ankle"]
    assert ankle is not None and ankle.y < bottom_hip.y
    # one scale for the whole assessment: nose-to-ankle standing ≈ 1
    nose, ank = sk[0]["nose"], sk[0]["left_ankle"]
    assert nose is not None and ank is not None
    assert math.hypot(nose.x - ank.x, nose.y - ank.y) == pytest.approx(1.0, abs=1e-9)
    assert t.scale_px > 0


def test_bad_frames_stay_null() -> None:
    t, _ = _skeletons(identity)
    empty = normalize_pose_result(
        {"landmarks": []}, t_ms=0, frame_width=640, frame_height=480, provider="p", model_id="m"
    )
    assert all(v is None for v in normalize_frame(empty, t).values())
    pose = provider_pose(175, 0)
    pose[25] = {"x": math.nan, "y": 0.5, "visibility": 0.9}
    partial = normalize_pose_result(
        {"landmarks": [pose]}, t_ms=0, frame_width=640, frame_height=480, provider="p", model_id="m"
    )
    out = normalize_frame(partial, t)
    assert out["left_knee"] is None and out["left_hip"] is not None


def test_skeleton_reference_failure_is_explicit() -> None:
    r, _ = _cal_and_frames(identity)
    assert r.calibration is not None
    with pytest.raises(SkeletonReferenceUnavailable):
        derive_transform(r.calibration, r.calibration_window[:3])


# ── time normalization ──────────────────────────────────────────────────


def test_time_normalized_trace_is_deterministic_and_keeps_real_time() -> None:
    samples = smooth_trace([AngleSample(t, squat_knee_at(t), "valid") for t in TIMES])
    times = percent_times(3120.0, 5680.0)
    assert len(times) == 101 and times[0] == 3120.0 and times[-1] == pytest.approx(5680.0)
    knee = resample(samples, times)
    assert knee[0] == pytest.approx(167, abs=1e-9)  # the threshold crossing itself
    assert knee[-1] == pytest.approx(167, abs=1e-9)
    assert min(v for v in knee if v is not None) == pytest.approx(95, abs=1e-9)
    assert knee == resample(samples, times)


def test_time_normalization_never_interpolates_across_gaps() -> None:
    samples = smooth_trace(
        [
            AngleSample(t, None, "missing") if 3700 < t < 4500 else AngleSample(t, squat_knee_at(t), "valid")
            for t in TIMES
        ]
    )
    knee = resample(samples, percent_times(3120.0, 5680.0))
    assert any(v is None for v in knee)
    assert resample(samples, [-5.0, 99999.0]) == [None, None]  # no extrapolation


def test_normalization_uses_real_points_only() -> None:
    samples = [AngleSample(0.0, 10.0, "valid"), AngleSample(100.0, 20.0, "valid")]
    assert resample(smooth_trace(samples), [50.0]) == [pytest.approx(15.0)]
    assert included_angle_deg(Point(0, 1), Point(0, 0), Point(1, 0)) == 90
