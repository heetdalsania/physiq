"""research-pose-frame-v1 normalisation (pose quality) and 2D geometry."""

from __future__ import annotations

import math

import pytest

from physiq_research.domain.geometry import Point, distance, included_angle_deg, mean, median, midpoint, percentile
from physiq_research.domain.kinematics import KNEE, TRUNK_THIGH, angle_sample, build_angle_trace
from physiq_research.domain.pose_frame import (
    LANDMARK_NAMES,
    landmark_state,
    normalize_landmark,
    normalize_pose_result,
)
from tests.support.synthetic_pose import provider_pose, provider_result_at


def frame(raw: object, t: float = 0.0, w: int = 640, h: int = 480):
    return normalize_pose_result(raw, t_ms=t, frame_width=w, frame_height=h, provider="p", model_id="m")


# ── geometry ────────────────────────────────────────────────────────────


@pytest.mark.parametrize(
    ("a", "b", "c", "deg"),
    [
        ((0, 0), (1, 0), (2, 0), 180.0),
        ((0, 1), (0, 0), (1, 0), 90.0),
        ((1, 0), (0, 0), (1, 0), 0.0),
        ((1, 1), (0, 0), (1, 0), 45.0),
        ((-1, 1), (0, 0), (1, 0), 135.0),
    ],
)
def test_included_angle_hand_derived(a: tuple, b: tuple, c: tuple, deg: float) -> None:
    got = included_angle_deg(Point(*a), Point(*b), Point(*c))
    assert got is not None and abs(got - deg) < 1e-12


def test_included_angle_invariances_and_invalid_input() -> None:
    a, b, c = Point(3, 7), Point(5, 2), Point(11, 4)
    base = included_angle_deg(a, b, c)
    assert base is not None
    shifted = included_angle_deg(Point(103, -93), Point(105, -98), Point(111, -96))
    scaled = included_angle_deg(Point(9, 21), Point(15, 6), Point(33, 12))
    mirrored = included_angle_deg(Point(-3, 7), Point(-5, 2), Point(-11, 4))
    for v in (shifted, scaled, mirrored):
        assert v is not None and abs(v - base) < 1e-12
    assert included_angle_deg(None, b, c) is None
    assert included_angle_deg(Point(math.nan, 0), b, c) is None
    assert included_angle_deg(b, b, c) is None  # coincident: undefined
    assert included_angle_deg(Point(math.inf, 0), b, c) is None


def test_statistics_match_m6_definitions() -> None:
    assert median([3, 1, 2]) == 2
    assert median([4, 1, 3, 2]) == 2.5
    assert median([None, math.nan, 5]) == 5  # type: ignore[list-item]
    assert median([]) is None
    assert mean([0.1, 0.2, 0.3]) == mean([0.3, 0.1, 0.2])
    assert percentile([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 90) == 9
    assert percentile([5], 90) == 5
    assert distance(Point(0, 0), Point(3, 4)) == 5
    m = midpoint(Point(0, 0), Point(2, 4))
    assert m is not None and (m.x, m.y) == (1, 2)


# ── pose-frame contract: quality cases ───────────────────────────────────


def test_clean_single_person() -> None:
    f = frame(provider_result_at(0, "stand"), t=0)
    assert f.status == "pose" and f.pose_count == 1
    assert set(f.landmarks) == set(LANDMARK_NAMES)
    hip = f.landmarks["left_hip"]
    assert hip is not None and hip.in_frame and hip.visibility == 0.95
    # pixels, not normalised units (aspect-correct angles)
    assert 0 < hip.x < 640 and 0 < hip.y < 480
    s = angle_sample(f, "left", KNEE)
    assert s.state == "valid" and s.value is not None and abs(s.value - 175) < 1e-9


def test_no_pose() -> None:
    f = frame({"landmarks": []})
    assert f.status == "no_pose" and f.pose_count == 0
    assert all(v is None for v in f.landmarks.values())
    assert angle_sample(f, "left", KNEE).state == "no_pose"


def test_two_people_never_selects_a_person() -> None:
    f = frame(provider_result_at(0, "two"))
    assert f.status == "multiple_poses" and f.pose_count == 2
    assert all(v is None for v in f.landmarks.values())
    s = angle_sample(f, "left", KNEE)
    assert s.state == "multiple_poses" and s.value is None


def test_low_visibility_is_gated_not_zeroed() -> None:
    f = frame(provider_result_at(0, "low"))
    knee = f.landmarks["left_knee"]
    assert knee is not None and knee.visibility == 0.3
    assert landmark_state(knee) == "low_confidence"
    s = angle_sample(f, "left", KNEE)
    assert s.state == "low_confidence" and s.value is None


def test_out_of_frame_landmark() -> None:
    pose = provider_pose(175, 0)
    pose[27] = {**pose[27], "x": 1.2}  # left ankle beyond the right edge
    f = frame({"landmarks": [pose]})
    ankle = f.landmarks["left_ankle"]
    assert ankle is not None and not ankle.in_frame and ankle.x == pytest.approx(1.2 * 640)
    assert angle_sample(f, "left", KNEE).state == "out_of_frame"


@pytest.mark.parametrize(
    "raw",
    [
        None,
        "pose",
        {"landmarks": "x"},
        {"landmarks": [[{"x": 0.5, "y": 0.5, "visibility": 0.9}] * 10]},  # short array
        {"landmarks": [[{"x": math.nan, "y": math.inf, "visibility": 2}]]},
        {"poses": []},
    ],
)
def test_malformed_provider_output(raw: object) -> None:
    f = frame(raw)
    assert f.status == "malformed"
    assert all(v is None for v in f.landmarks.values())


@pytest.mark.parametrize(
    "point",
    [
        {"x": math.nan, "y": 0.5, "visibility": 0.9},
        {"x": 0.5, "y": math.inf, "visibility": 0.9},
        {"x": 0.5, "y": 0.5, "visibility": 1.5},
        {"x": 0.5, "y": 0.5, "visibility": -0.1},
        {"x": 0.5, "y": 0.5, "visibility": None},
        {"x": 50, "y": 0.5, "visibility": 0.9},  # garbage magnitude
        {"x": True, "y": 0.5, "visibility": 0.9},
        {"x": "0.5", "y": 0.5, "visibility": 0.9},
        None,
        7,
    ],
)
def test_bad_points_become_null_never_zero(point: object) -> None:
    assert normalize_landmark(point, 640, 480) is None
    pose = provider_pose(175, 0)
    pose[25] = point  # left knee
    f = frame({"landmarks": [pose]})
    assert f.status == "pose"
    assert f.landmarks["left_knee"] is None
    assert angle_sample(f, "left", KNEE).state == "missing"


def test_invalid_frame_metadata_is_malformed() -> None:
    raw = provider_result_at(0, "stand")
    assert (
        normalize_pose_result(raw, t_ms=None, frame_width=640, frame_height=480, provider="p", model_id="m").status
        == "malformed"
    )
    assert (
        normalize_pose_result(raw, t_ms=-1, frame_width=640, frame_height=480, provider="p", model_id="m").status
        == "malformed"
    )
    assert (
        normalize_pose_result(raw, t_ms=0, frame_width=0, frame_height=480, provider="p", model_id="m").status
        == "malformed"
    )
    assert (
        normalize_pose_result(raw, t_ms=0, frame_width=640, frame_height=math.nan, provider="p", model_id="m").status
        == "malformed"
    )


def test_trace_drops_non_increasing_timestamps() -> None:
    frames = [frame(provider_result_at(t, "stand"), t=t) for t in (0, 100, 100, 50, 200)]
    trace = build_angle_trace(frames, "left", TRUNK_THIGH)
    assert [s.t_ms for s in trace] == [0, 100, 200]
