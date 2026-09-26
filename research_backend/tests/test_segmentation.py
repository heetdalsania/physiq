"""Single-squat segmentation — the M6 cases with hand-derived expectations.

Standing 175° until 3000 ms; linear to 95° at 4200 ms; held to 4600 ms;
linear back to 175° at 5800 ms. R = 175, E = 80°, T = 167°:
  descent start 3120 ms, deepest 4200 ms (earliest minimum), ascent end
  5680 ms → descent 1080 ms, ascent 1480 ms, total 2560 ms, ROM 80°.
"""

from __future__ import annotations

from collections.abc import Callable

import pytest

from physiq_research.domain.kinematics import AngleSample
from physiq_research.domain.segmentation import SEGMENTATION, segment_single_squat
from physiq_research.domain.smoothing import smooth_trace
from tests.support.synthetic_pose import squat_knee_at


def trace(fn: Callable[[float], float | None], start: float = 0, stop: float = 8000, step: float = 100) -> list:
    out = []
    t = start
    while t <= stop + 1e-9:
        v = fn(t)
        out.append(AngleSample(t, None, "missing") if v is None else AngleSample(t, float(v), "valid"))
        t += step
    return smooth_trace(out)


def test_parameters_are_m6_detection_parameters() -> None:
    assert SEGMENTATION == {
        "minCaptureValidSamples": 10,
        "minExcursionDeg": 20,
        "phaseThresholdFraction": 0.1,
        "secondRepFraction": 0.5,
        "maxGapMs": 300,
        "minRepSamples": 8,
    }


def test_clean_squat_hand_calculation() -> None:
    r = segment_single_squat(trace(squat_knee_at), 175)
    assert r.segmented
    assert r.excursion_deg == pytest.approx(80, abs=1e-9)
    assert r.threshold_deg == pytest.approx(167, abs=1e-9)
    assert r.descent_start_ms == pytest.approx(3120, abs=1e-6)
    assert r.deepest_ms == 4200
    assert r.ascent_end_ms == pytest.approx(5680, abs=1e-6)
    assert (r.descent_ms, r.ascent_ms, r.total_ms) == pytest.approx((1080, 1480, 2560), abs=1e-6)


def test_no_motion() -> None:
    r = segment_single_squat(trace(lambda t: 175), 175)
    assert (r.state, r.reason) == ("insufficient", "no_clear_repetition")


def test_partial_motion() -> None:
    down = segment_single_squat(trace(lambda t: 175 if t <= 3000 else max(95, 175 - (t - 3000) / 15)), 175)
    assert down.reason == "did_not_return_to_standing"
    started = segment_single_squat(trace(lambda t: squat_knee_at(t + 4000)), 175)
    assert started.reason == "repetition_started_before_capture"
    shallow = segment_single_squat(trace(lambda t: squat_knee_at(t, {"bottomDeg": 157})), 175)
    assert shallow.reason == "no_clear_repetition" and shallow.excursion_deg == pytest.approx(18)


def test_multiple_reps_rejected_never_averaged() -> None:
    second = {"descentAt": 6600, "bottomAt": 7400, "riseAt": 7600, "standAt": 8400}
    two = trace(lambda t: min(squat_knee_at(t), squat_knee_at(t, second)), 0, 9500)
    assert segment_single_squat(two, 175).reason == "multiple_repetitions"
    small = trace(lambda t: min(squat_knee_at(t), squat_knee_at(t, {**second, "bottomDeg": 150})), 0, 9500)
    assert segment_single_squat(small, 175).segmented


def test_missing_frames_bounded_timing_error() -> None:
    r = segment_single_squat(trace(lambda t: None if round(t) % 500 == 200 else squat_knee_at(t)), 175)
    assert r.segmented
    assert r.descent_start_ms == pytest.approx(3120, abs=1e-6)
    assert r.ascent_end_ms == pytest.approx(5680, abs=1e-6)


def test_data_gap_fails_instead_of_guessing() -> None:
    r = segment_single_squat(trace(lambda t: None if 3800 < t < 4400 else squat_knee_at(t)), 175)
    assert r.reason == "data_gap_during_repetition"
    assert r.max_gap_ms is not None and r.max_gap_ms > 300


def test_bottom_pause_counts_in_ascent() -> None:
    r = segment_single_squat(trace(lambda t: squat_knee_at(t, {"riseAt": 5200, "standAt": 6400})), 175)
    assert r.deepest_ms == 4200
    assert r.ascent_ms == pytest.approx(5200 + 1080 - 4200, abs=1e-6)


def test_low_frame_rate() -> None:
    # 5 Hz still segments (interpolated crossings are exact on linear phases)…
    r = segment_single_squat(trace(squat_knee_at, 0, 9000, 200), 175)
    assert r.segmented and r.descent_start_ms == pytest.approx(3120, abs=1e-6)
    # …but a 400 ms squat at 10 Hz has only 3 samples inside it.
    quick = trace(lambda t: squat_knee_at(t, {"descentAt": 3000, "bottomAt": 3200, "riseAt": 3200, "standAt": 3400}))
    assert segment_single_squat(quick, 175).reason == "too_few_samples_in_repetition"


def test_irregular_timing_uses_real_timestamps() -> None:
    import random

    rng = random.Random(7)
    times = [0.0]
    while times[-1] < 8000:
        times.append(times[-1] + 55 + rng.random() * 50)
    samples = smooth_trace([AngleSample(t, squat_knee_at(t), "valid") for t in times])
    r = segment_single_squat(samples, 175)
    assert r.segmented
    # piecewise-linear truth + interpolation at the crossings: exact within float error
    assert r.descent_start_ms == pytest.approx(3120, abs=1e-6)
    assert r.ascent_end_ms == pytest.approx(5680, abs=1e-6)


def test_reference_must_be_finite_number() -> None:
    for ref in (None, float("nan"), float("inf"), "175", True):
        assert segment_single_squat(trace(squat_knee_at), ref).reason == "no_reference"  # type: ignore[arg-type]


def test_durations_never_negative_or_non_finite() -> None:
    import math

    for bottom in range(60, 151, 15):
        for pause in (0, 400, 800):
            spec = {"bottomDeg": bottom, "riseAt": 4200 + pause, "standAt": 5400 + pause}
            r = segment_single_squat(trace(lambda t, s=spec: squat_knee_at(t, s), 0, 9000), 175)
            if r.segmented:
                for d in (r.descent_ms, r.ascent_ms, r.total_ms):
                    assert d is not None and math.isfinite(d) and d >= 0
