"""Cross-language parity: Milestone 6 JavaScript ≈ Python research pipeline.

Fixtures (tests/fixtures/m6_parity/*.json) were produced by the REAL M6
session controller and algorithms (tools/m6_parity/scenarios.mjs); the root
JS test test/researchParityFixtures.test.js fails if M6 drifts from them.
Here the Python implementation consumes the byte-identical provider output
and must reproduce:

  * the frames the session analysed as the calibration window and capture
    (exact timestamp equality — the protocol replay);
  * every unrounded internal value (references, minimum, ROM, crossing times,
    durations, trunk minimum, the whole smoothed knee trace) within
    ANGLE_TOL / TIME_TOL;
  * the rounded movement-assessment-v0.1 result fields EXACTLY (status,
    reason, side, reference, metrics, events, traces, quality) — with one
    documented exception: a ROUNDING-BOUNDARY TIE. When the true value sits
    on a rounding midpoint (e.g. the fixture's trunk–thigh angle 121.25°),
    a one-ulp libm difference (JS atan2 → 121.25, macOS libm →
    121.24999999999996) legitimately rounds to 121.3 in one language and
    121.2 in the other. A rounded mismatch is accepted only if the rounded
    values differ by exactly one unit of the rounding AND the unrounded
    Python value is within 1e-7 rounding units of the midpoint (the
    unrounded values themselves were already compared within tolerance).
    Every tie is counted and reported.

Tolerances: both implementations use IEEE-754 doubles and the same formulas
in the same order; only libm's atan2/hypot may differ in the last unit in
the last place (~1e-14° at 175°). 1e-9° and 1e-6 ms are five to six orders
of magnitude above that and eight orders below the 0.1° / 1 ms resolution of
the result, so a real semantic difference cannot hide inside them. Values
are never rounded before the unrounded comparison.
"""

from __future__ import annotations

import json
import math
from pathlib import Path
from typing import Any

import pytest

from physiq_research.domain.pose_frame import normalize_pose_result
from physiq_research.domain.protocol import replay_protocol
from physiq_research.domain.squat_analysis import analyze_squat_capture

FIXTURES = Path(__file__).parent / "fixtures" / "m6_parity"
ANGLE_TOL = 1e-9
TIME_TOL = 1e-6
FIXTURE_FILES = sorted(FIXTURES.glob("*.json"))
REQUIRED_SCENARIOS = {
    "clean_squat_100ms",
    "clean_squat_15hz",
    "no_motion",
    "partial_motion",
    "multiple_reps",
    "back_to_back_reps",
    "missing_frames_during_capture",
    "tracking_gap",
    "bottom_pause",
    "low_frame_rate_5hz",
    "irregular_timing",
}
MAX_DIFF: dict[str, float] = {"angle": 0.0, "time": 0.0}
TIES: list[str] = []
TIE_TOL_UNITS = 1e-7


def _raw(encoded: dict[str, Any], filler: list[float]) -> dict[str, Any]:
    poses = []
    for used in encoded["poses"]:
        pts = [{"x": filler[0], "y": filler[1], "z": filler[2], "visibility": filler[3]} for _ in range(33)]
        for idx, (x, y, z, vis) in used.items():
            pts[int(idx)] = {"x": x, "y": y, "z": z, "visibility": vis}
        poses.append(pts)
    return {"landmarks": poses}


def _frames(fx: dict[str, Any]) -> list[Any]:
    return [
        normalize_pose_result(
            _raw(f["raw"], fx["filler"]),
            t_ms=f["t"],
            frame_width=fx["frameWidth"],
            frame_height=fx["frameHeight"],
            provider="m6-fixture",
            model_id="m6-fixture",
        )
        for f in fx["frames"]
    ]


def _close(a: float | None, b: float | None, tol: float, kind: str, what: str) -> None:
    if a is None or b is None:
        assert a is None and b is None, f"{what}: {a!r} vs {b!r}"
        return
    diff = abs(float(a) - float(b))
    MAX_DIFF[kind] = max(MAX_DIFF[kind], diff)
    assert diff <= tol, f"{what}: python {a!r} vs js {b!r} (Δ {diff:g} > {tol:g})"


def _is_boundary_tie(py: float, js: float, unrounded: Any) -> bool:
    if not isinstance(unrounded, float):
        return False
    for digits in (0, 1, 3):
        unit = 10.0**-digits
        if abs(abs(py - js) - unit) > unit * 1e-9:
            continue
        scaled = unrounded * 10.0**digits
        if abs(scaled - (math.floor(scaled) + 0.5)) <= TIE_TOL_UNITS:
            return True
    return False


def _json_equal(a: Any, b: Any, path: str = "$", unrounded: Any = None) -> None:
    """Exact equality after JSON normalisation (1.0 == 1, -0 == 0), except a
    verified rounding-boundary tie (see module docstring)."""
    if isinstance(a, dict) and isinstance(b, dict):
        assert set(a) == set(b), f"{path}: keys {sorted(set(a) ^ set(b))}"
        for k in a:
            _json_equal(a[k], b[k], f"{path}.{k}", unrounded.get(k) if isinstance(unrounded, dict) else None)
    elif isinstance(a, list) and isinstance(b, list):
        assert len(a) == len(b), f"{path}: length {len(a)} vs {len(b)}"
        for i, (x, y) in enumerate(zip(a, b, strict=True)):
            _json_equal(x, y, f"{path}[{i}]", unrounded[i] if isinstance(unrounded, list) else None)
    elif isinstance(a, (int, float)) and isinstance(b, (int, float)) and not isinstance(a, bool):
        if float(a) != float(b):
            assert _is_boundary_tie(float(a), float(b), unrounded), f"{path}: python {a!r} vs js {b!r}"
            TIES.append(f"{path}: python {a!r} / js {b!r} (unrounded python {unrounded!r})")
    else:
        assert a == b, f"{path}: python {a!r} vs js {b!r}"


def test_fixture_set_is_complete() -> None:
    names = {p.stem for p in FIXTURE_FILES}
    assert REQUIRED_SCENARIOS <= names, sorted(REQUIRED_SCENARIOS - names)
    for p in FIXTURE_FILES:
        fx = json.loads(p.read_text())
        assert fx["format"] == "m6-parity-fixture-v1"
        assert fx["m6"] == {
            "result": "movement-assessment-v0.1",
            "kinematics": "squat-kinematics-v0.2",
            "poseFrame": "pose-frame-v1",
        }


@pytest.mark.parametrize("path", FIXTURE_FILES, ids=[p.stem for p in FIXTURE_FILES])
def test_python_matches_m6(path: Path) -> None:
    fx = json.loads(path.read_text())
    exp = fx["expected"]
    frames = _frames(fx)
    replay = replay_protocol(frames)

    # 1. Protocol replay: the same frames form the calibration window and capture.
    assert replay.calibration_complete_ms == exp["calibrationCompleteMs"]
    assert [f.t_ms for f in replay.calibration_window] == exp["calibrationWindowTimestamps"]
    assert [f.t_ms for f in replay.capture_frames] == exp["captureTimestamps"]
    if exp["calibrationCompleteMs"] is None:
        assert not replay.calibrated
        assert exp["result"] is None
        assert exp["sessionPhase"] in ("positioning", "calibrating", "insufficient")
        return

    analysis = analyze_squat_capture(replay.calibration, replay.capture_frames)

    # 2. Unrounded internals.
    ic = exp["internals"]["calibration"]
    cal = replay.calibration
    assert cal is not None
    assert cal.side == ic["side"]
    _close(cal.reference_knee_deg, ic["referenceKneeDeg"], ANGLE_TOL, "angle", "standing knee angle")
    _close(
        cal.reference_trunk_thigh_deg, ic["referenceTrunkThighDeg"], ANGLE_TOL, "angle", "standing trunk-thigh angle"
    )
    _close(cal.knee_range_deg, ic["kneeRangeDeg"], ANGLE_TOL, "angle", "calibration knee range")
    _close(cal.hip_separation_ratio, ic["hipSeparationRatio"], 1e-12, "angle", "hip separation ratio")
    _close(cal.standing_height_px, ic["standingHeightPx"], 1e-9, "angle", "standing height px")
    _close(cal.span_ms, ic["spanMs"], TIME_TOL, "time", "calibration span")
    assert cal.usable_frames == ic["usableFrames"]
    assert cal.frame_count == ic["frameCount"]
    assert cal.ankle_reference is not None
    _close(cal.ankle_reference.x, ic["ankleReference"]["x"], 1e-9, "angle", "ankle ref x")
    _close(cal.ankle_reference.y, ic["ankleReference"]["y"], 1e-9, "angle", "ankle ref y")

    seg_js = exp["internals"]["segmentation"]
    seg = analysis.segmentation
    assert seg.state == seg_js["state"]
    assert seg.reason == seg_js.get("reason")
    if "excursionDeg" in seg_js:
        _close(seg.excursion_deg, seg_js["excursionDeg"], ANGLE_TOL, "angle", "apparent ROM / excursion")
    if seg_js["state"] == "segmented":
        _close(seg.minimum_deg, seg_js["minimumDeg"], ANGLE_TOL, "angle", "minimum knee angle")
        _close(seg.reference_deg, seg_js["referenceDeg"], ANGLE_TOL, "angle", "reference knee angle")
        _close(seg.threshold_deg, seg_js["thresholdDeg"], ANGLE_TOL, "angle", "phase threshold")
        ev = seg_js["events"]
        _close(seg.descent_start_ms, ev["descentStartMs"], TIME_TOL, "time", "descent crossing")
        _close(seg.deepest_ms, ev["deepestMs"], TIME_TOL, "time", "deepest point")
        _close(seg.ascent_end_ms, ev["ascentEndMs"], TIME_TOL, "time", "ascent crossing")
        du = seg_js["durations"]
        _close(seg.descent_ms, du["descentMs"], TIME_TOL, "time", "descent duration")
        _close(seg.ascent_ms, du["ascentMs"], TIME_TOL, "time", "ascent duration")
        _close(seg.total_ms, du["totalMs"], TIME_TOL, "time", "repetition duration")
        assert seg.rep_samples == seg_js["repSamples"]
        _close(seg.max_gap_ms, seg_js["maxGapMs"], TIME_TOL, "time", "max gap")
    if exp["internals"]["trunkMinimumDeg"] is not None and analysis.complete:
        _close(
            analysis.trunk_thigh.minimum_deg, exp["internals"]["trunkMinimumDeg"], ANGLE_TOL, "angle", "trunk minimum"
        )

    for ours, key in ((analysis.knee_trace, "kneeTraceSmoothed"), (analysis.trunk_thigh_trace, "trunkTraceSmoothed")):
        js_trace = exp["internals"][key]
        assert len(ours) == len(js_trace)
        for s, (t, value, raw, state) in zip(ours, js_trace, strict=True):
            assert s.state == state
            _close(s.t_ms, t, 0.0, "time", "trace timestamp")
            _close(s.value, value, ANGLE_TOL, "angle", f"{key} smoothed @ {t}")
            _close(s.raw, raw, ANGLE_TOL, "angle", f"{key} raw @ {t}")

    # 3. The rounded M6 result fields, exactly.
    view = analysis.m6_view()
    unrounded = analysis.m6_view(rounded=False)
    result = exp["result"]
    assert result is not None
    for key in ("status", "insufficientReason", "analysisSide", "reference", "metrics", "events", "traces", "quality"):
        _json_equal(view[key], result[key], f"{path.stem}:$.{key}", unrounded[key])
    assert exp["sessionPhase"] == ("results" if analysis.complete else "insufficient")


def test_report_max_differences() -> None:
    """Records the largest JS↔Python difference observed (for the report)."""
    TIES.clear()
    for p in FIXTURE_FILES:
        test_python_matches_m6(p)
    print(f"\nmax |Δ| angle-like: {MAX_DIFF['angle']:.3g}   max |Δ| time: {MAX_DIFF['time']:.3g} ms")
    print(f"rounding-boundary ties: {len(TIES)}")
    for tie in TIES:
        print("  ", tie)
    assert MAX_DIFF["angle"] <= ANGLE_TOL and MAX_DIFF["time"] <= TIME_TOL
    assert math.isfinite(MAX_DIFF["angle"])
