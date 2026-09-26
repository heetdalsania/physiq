"""Evaluator (grf-validation-v0.1) against known analytical answers.

SYNTHETIC TEST FIXTURE — NOT HUMAN DATA — NOT VALIDATION EVIDENCE. The
"predictions" here are hand-built test inputs (including a TEST / NULL
BASELINE); no estimator exists and no number here says anything about one.
"""

from __future__ import annotations

import json
import math
import subprocess
import sys
import uuid
from pathlib import Path
from typing import Any

import numpy as np
import pytest

from physiq_research.canonical import canonical_digest
from physiq_research.force_plate.errors import ForcePlateError
from physiq_research.force_plate.estimate import (
    SubjectPartition,
    check_held_out,
    parse_estimate,
    validate_estimate_document,
)
from physiq_research.force_plate.evaluation import (
    MAX_PREDICTION_GAP_MS,
    MIN_COMPARISON_SAMPLES,
    TruthSeries,
    evaluate,
)
from physiq_research.force_plate.limits import ForcePlateLimits
from physiq_research.force_plate.records import ValidationMetrics

BW = 70.0 * 9.80665
REP = (3000.0, 5000.0)
T_TRUTH = np.arange(0.0, 7001.0)  # 1 kHz measured samples, media ms


def triangle(t: np.ndarray) -> np.ndarray:
    """700 N, rising linearly to 900 N at 4000 ms and back to 700 N at 5000 ms."""
    return np.where((t >= 3000) & (t <= 5000), 900.0 - 200.0 * np.abs(t - 4000.0) / 1000.0, 700.0)


def truth(values: np.ndarray | None = None, t: np.ndarray = T_TRUTH) -> TruthSeries:
    v = triangle(t) if values is None else values
    return TruthSeries(
        t_media_ms=t, vertical_grf_n=np.asarray(v, dtype=np.float64), body_weight_n=BW, repetition_ms=REP
    )


def grid(start: float = 0.0, end: float = 7000.0, step: float = 1000.0 / 15.0) -> np.ndarray:
    return np.arange(start, end + 1e-9, step)


def run(tr: TruthSeries, t: np.ndarray, f: np.ndarray) -> dict[str, Any]:
    body = evaluate(tr, np.asarray(t, dtype=np.float64), np.asarray(f, dtype=np.float64))
    ValidationMetrics.model_validate(
        {
            "schema_version": "grf-validation-metrics-v1",
            "protocol_version": "grf-validation-v0.1",
            "parameters": {},
            **body,
        }
    )  # every result satisfies the stored schema
    return body


def refused(tr: TruthSeries, t: np.ndarray, f: np.ndarray) -> str:
    with pytest.raises(ForcePlateError) as info:
        evaluate(tr, np.asarray(t, dtype=np.float64), np.asarray(f, dtype=np.float64))
    return info.value.code


# ── analytical cases ────────────────────────────────────────────────────


def test_perfect_prediction_at_every_measured_sample_gives_zero_error() -> None:
    m = run(truth(), T_TRUTH, triangle(T_TRUTH))
    p = m["pointwise"]
    assert (p["mean_signed_error_n"], p["mae_n"], p["rmse_n"], p["mae_bw"], p["rmse_bw"]) == (0.0,) * 5
    assert m["waveform_shape"]["pearson_r"] == pytest.approx(1.0, abs=1e-15)
    assert (m["peak"]["abs_peak_error_n"], m["impulse"]["abs_impulse_error_n_s"]) == (0.0, 0.0)
    assert m["peak"]["measured_peak_n"] == 900.0 and m["peak"]["measured_peak_media_ms"] == 4000.0
    assert m["impulse"]["measured_impulse_n_s"] == pytest.approx(1600.0, rel=1e-12)  # 700·2 + ½·2·200
    assert m["intervals"]["comparison_media_ms"] == list(REP) and m["intervals"]["repetition_coverage_fraction"] == 1.0


def test_pearson_of_huge_nearly_constant_anticorrelated_series_is_negative() -> None:
    times = np.arange(8, dtype=float) * 100.0
    measured = np.array([1e308 + i * 1e293 for i in range(8)])
    predicted = measured[::-1].copy()
    result = evaluate(TruthSeries(times, measured, BW, (0.0, 700.0)), times, predicted)
    assert result["waveform_shape"]["pearson_r"] == pytest.approx(-1.0, abs=1e-12)


def test_perfect_prediction_at_video_rate_has_zero_pointwise_error() -> None:
    t = grid()
    m = run(truth(), t, triangle(t))
    assert m["pointwise"]["mae_n"] == 0.0 and m["pointwise"]["rmse_n"] == 0.0
    # peak/impulse of a 15 Hz polyline can only miss what it does not sample
    assert m["peak"]["peak_error_n"] <= 0.0
    assert m["pointwise"]["comparison_samples"] == int(np.count_nonzero((t >= 3000) & (t <= 5000)))


@pytest.mark.parametrize("offset", [25.0, -40.0])
def test_known_constant_offset(offset: float) -> None:
    t = grid()
    m = run(truth(), t, triangle(t) + offset)
    p = m["pointwise"]
    assert p["mean_signed_error_n"] == pytest.approx(offset, abs=1e-9)
    assert p["mae_n"] == pytest.approx(abs(offset), abs=1e-9) and p["rmse_n"] == pytest.approx(abs(offset), abs=1e-9)
    assert p["mae_bw"] == pytest.approx(abs(offset) / BW, rel=1e-12)
    assert m["waveform_shape"]["pearson_r"] == pytest.approx(1.0, abs=1e-12)  # shape identical despite the bias
    j0, j1 = m["intervals"]["comparison_media_ms"]
    measured_on_grid = run(truth(), t, triangle(t))["impulse"]["predicted_impulse_n_s"]
    assert m["impulse"]["predicted_impulse_n_s"] == pytest.approx(
        measured_on_grid + offset * (j1 - j0) / 1000, rel=1e-12
    )


def test_known_amplitude_error_at_measured_samples() -> None:
    m = run(truth(), T_TRUTH, 1.1 * triangle(T_TRUTH))
    assert m["peak"]["peak_error_n"] == pytest.approx(90.0, rel=1e-12)
    assert m["peak"]["abs_peak_error_bw"] == pytest.approx(90.0 / BW, rel=1e-12)
    assert m["impulse"]["impulse_error_n_s"] == pytest.approx(160.0, rel=1e-9)
    in_rep = triangle(T_TRUTH[(T_TRUTH >= 3000) & (T_TRUTH <= 5000)])
    assert m["pointwise"]["mean_signed_error_n"] == pytest.approx(0.1 * in_rep.mean(), rel=1e-12)
    assert m["pointwise"]["rmse_n"] == pytest.approx(0.1 * math.sqrt(np.mean(in_rep**2)), rel=1e-12)
    assert m["waveform_shape"]["pearson_r"] == pytest.approx(1.0, abs=1e-12)


def test_known_peak_error() -> None:
    f = triangle(T_TRUTH).copy()
    f[4000] += 50.0  # one taller node at the measured peak
    m = run(truth(), T_TRUTH, f)
    assert m["peak"]["peak_error_n"] == 50.0 and m["peak"]["peak_time_difference_ms"] == 0.0
    assert m["impulse"]["impulse_error_n_s"] == pytest.approx(0.5 * 50.0 * 2.0 / 1000.0, rel=1e-9)  # 2 ms-wide spike


def test_known_impulse_for_constant_body_weight() -> None:
    tr = truth(np.full(T_TRUTH.size, BW))
    t = grid()
    m = run(tr, t, np.full(t.size, BW))
    assert m["impulse"]["measured_impulse_n_s"] == pytest.approx(BW * 2.0, rel=1e-12)
    assert m["impulse"]["measured_impulse_bw_s"] == pytest.approx(2.0, rel=1e-12)
    assert m["impulse"]["abs_impulse_error_n_s"] == pytest.approx(0.0, abs=1e-9)


def test_irregular_prediction_timestamps() -> None:
    rng = np.random.default_rng(8)
    steps = rng.uniform(20.0, 120.0, size=200)
    t = 2800.0 + np.cumsum(steps)
    t = t[t <= 5300.0]
    m = run(truth(), t, triangle(t) - 12.5)
    assert m["pointwise"]["mae_n"] == pytest.approx(12.5, abs=1e-9)
    assert m["samples"]["in_repetition"] == int(np.count_nonzero((t >= 3000) & (t <= 5000)))
    assert (
        m["samples"]["before_repetition"] + m["samples"]["after_repetition"] + m["samples"]["in_repetition"] == t.size
    )
    assert m["samples"]["max_prediction_segment_in_repetition_ms"] <= 120.0


def test_interpolation_edges_are_exact() -> None:
    linear = 650.0 + 0.05 * T_TRUTH
    t = np.array([3000.0, 3000.25, 3166.5, 3333.333, 3500.0, 3750.0, 3999.999, 4250.0, 4500.5, 4750.0, 4999.75, 5000.0])
    t.sort()
    m = run(truth(linear), t, 650.0 + 0.05 * t)
    assert m["pointwise"]["mae_n"] < 1e-9  # linear truth is interpolated exactly between samples
    assert m["intervals"]["comparison_media_ms"] == [3000.0, 5000.0]  # samples exactly at the boundaries
    assert m["intervals"]["uncovered_start_ms"] == 0.0 and m["intervals"]["uncovered_end_ms"] == 0.0


def test_prediction_outside_ground_truth_support_is_never_compared_with_extrapolated_truth() -> None:
    t = grid(-600.0, 9000.0)  # beyond the measured support [0, 7000] on both sides
    m = run(truth(), t, triangle(np.clip(t, 0, 7000)))
    assert m["samples"]["before_repetition"] == int(np.count_nonzero(t < 3000))
    assert m["samples"]["after_repetition"] == int(np.count_nonzero(t > 5000))
    assert m["pointwise"]["comparison_samples"] == int(np.count_nonzero((t >= 3000) & (t <= 5000)))
    assert m["intervals"]["prediction_support_media_ms"] == [float(t[0]), float(t[-1])]


def test_insufficient_overlap_is_refused() -> None:
    tr = truth()
    before = grid(0.0, 2900.0)
    assert refused(tr, before, triangle(before)) == "no_prediction_in_repetition"
    few = np.linspace(3000.0, 5000.0, MIN_COMPARISON_SAMPLES - 1)
    assert refused(tr, few, triangle(few)) == "insufficient_prediction_samples"
    hole = np.concatenate([grid(2900.0, 3900.0, 50.0), grid(4250.0, 5100.0, 50.0)])  # 350 ms hole
    assert refused(tr, hole, triangle(hole)) == "prediction_gap_exceeded"
    late_start = grid(3350.0, 5100.0, 50.0)  # first sample 350 ms into the repetition, none before
    assert refused(tr, late_start, triangle(late_start)) == "prediction_gap_exceeded"
    long_bracket = np.concatenate([[2600.0], grid(3100.0, 5100.0, 50.0)])  # 500 ms segment reaching in
    assert refused(tr, long_bracket, triangle(long_bracket)) == "prediction_gap_exceeded"
    ok = np.concatenate([grid(2750.0, 3050.0, 300.0), grid(3100.0, 5000.0, 50.0), [5250.0]])
    assert run(tr, ok, triangle(ok))["samples"]["max_prediction_segment_in_repetition_ms"] <= MAX_PREDICTION_GAP_MS


def test_correlation_is_undefined_for_a_constant_series() -> None:
    t = grid()
    m = run(truth(), t, np.full(t.size, BW))  # TEST / NULL BASELINE: constant body weight
    assert m["waveform_shape"] == {
        "pearson_r": None,
        "state": "undefined_constant_series",
        "role": "waveform-shape diagnostic only; not a measure of agreement",
    }
    flat = truth(np.full(T_TRUTH.size, 700.0))
    assert run(flat, t, triangle(t))["waveform_shape"]["pearson_r"] is None


def test_no_hidden_lag_correction() -> None:
    t = grid()
    shifted = triangle(t - 100.0)  # the right waveform, 100 ms late
    m = run(truth(), t, shifted)
    assert m["time_shift_applied_ms"] == 0
    in_rep = (t >= 3000) & (t <= 5000)
    expected = shifted[in_rep] - triangle(t[in_rep])
    assert m["pointwise"]["mae_n"] == pytest.approx(float(np.mean(np.abs(expected))), rel=1e-12)
    assert m["pointwise"]["mae_n"] > 15.0  # a lag is reported as error, never silently removed
    assert m["peak"]["peak_time_difference_ms"] == pytest.approx(100.0, abs=1000 / 15)


def test_metrics_are_deterministic_across_runs_and_processes(tmp_path: Path) -> None:
    t = grid()
    f = triangle(t) + 5.0 * np.sin(t / 97.0)
    first = canonical_digest(run(truth(), t, f))
    assert canonical_digest(run(truth(), t, f)) == first
    script = tmp_path / "again.py"
    script.write_text(
        "import numpy as np, sys\n"
        "sys.path.insert(0, '.')\n"
        "from tests.test_force_plate_evaluation import truth, triangle, grid\n"
        "from physiq_research.force_plate.evaluation import evaluate\n"
        "from physiq_research.canonical import canonical_digest\n"
        "t = grid(); f = triangle(t) + 5.0 * np.sin(t / 97.0)\n"
        "print(canonical_digest(evaluate(truth(), t, f)))\n"
    )
    out = subprocess.run(
        [sys.executable, str(script)], capture_output=True, text=True, check=True, cwd=Path(__file__).parents[1]
    )
    assert out.stdout.strip() == first


# ── the estimate contract ───────────────────────────────────────────────

LIMITS = ForcePlateLimits()


def estimate_doc(**changes: Any) -> dict[str, Any]:
    doc: dict[str, Any] = {
        "contract": "vertical-grf-estimate-v0.1",
        "quantity": "estimated_total_vertical_ground_reaction_force",
        "unit": "N",
        "time_axis": "media_ms_since_first_decoded_frame",
        "assessment_id": str(uuid.uuid4()),
        "assessment_record_sha256": "a" * 64,
        "estimator": {
            "name": "test-null-baseline",
            "version": "0.0.0-test",
            "parameters_sha256": None,
            "development_research_subject_ids": [],
        },
        "t_media_ms": [0.0, 66.7, 133.3],
        "vertical_grf_n": [686.0, 686.0, 686.0],
    }
    for key, value in changes.items():
        if "__" in key:
            outer, inner = key.split("__")
            doc[outer] = {**doc[outer], inner: value}
        else:
            doc[key] = value
    return doc


def est_code(doc: Any) -> tuple[str, str | None]:
    with pytest.raises(ForcePlateError) as info:
        validate_estimate_document(doc, LIMITS)
    return info.value.code, info.value.field


def test_valid_estimate_round_trips() -> None:
    doc = estimate_doc()
    e = validate_estimate_document(doc, LIMITS)
    assert e.estimator.name == "test-null-baseline" and len(e.t_media_ms) == 3
    assert parse_estimate(json.dumps(doc).encode(), LIMITS) == e


@pytest.mark.parametrize(
    ("changes", "code"),
    [
        ({"vertical_grf_n": [686.0, math.nan, 686.0]}, "non_finite_prediction"),
        ({"vertical_grf_n": [686.0, math.inf, 686.0]}, "non_finite_prediction"),
        ({"t_media_ms": [0.0, -math.inf, 1.0]}, "non_finite_prediction"),
        ({"t_media_ms": [], "vertical_grf_n": []}, "empty_prediction"),
        ({"vertical_grf_n": [1.0, 2.0]}, "prediction_length_mismatch"),
        ({"t_media_ms": [0.0, 10.0, 10.0]}, "prediction_timestamps_not_increasing"),
        ({"t_media_ms": [0.0, 20.0, 10.0]}, "prediction_timestamps_not_increasing"),
        ({"t_media_ms": [-5.0, 20.0, 30.0]}, "negative_prediction_time"),
        ({"contract": "vertical-grf-estimate-v2"}, "unsupported_estimate_contract"),
        ({"unit": "kN"}, "invalid_estimate"),
        ({"quantity": "measured_total_vertical_ground_reaction_force"}, "invalid_estimate"),
        ({"time_axis": "frame_index"}, "invalid_estimate"),
        ({"assessment_record_sha256": "xyz"}, "invalid_estimate"),
        ({"estimator__name": "Model With Spaces"}, "invalid_estimate"),
        ({"estimator__development_research_subject_ids": [str(uuid.uuid1())]}, "invalid_estimate"),
        ({"participant_name": "Jane"}, "unknown_field"),
        ({"estimator__notes": "free text"}, "unknown_field"),
    ],
)
def test_bad_estimates_are_rejected(changes: dict[str, Any], code: str) -> None:
    got, _field = est_code(estimate_doc(**changes))
    assert got == code


def test_nan_and_overflow_in_estimate_json_are_rejected() -> None:
    text = json.dumps(estimate_doc()).replace("686.0, 686.0, 686.0", "686.0, NaN, 686.0")
    with pytest.raises(ForcePlateError) as info:
        parse_estimate(text.encode(), LIMITS)
    assert info.value.code == "non_finite_json_number"
    with pytest.raises(ForcePlateError) as info:
        parse_estimate(text.replace("NaN", "1e400").encode(), LIMITS)
    assert info.value.code == "non_finite_json_number"
    doc = estimate_doc(t_media_ms=list(range(5)), vertical_grf_n=[1.0] * 5)
    with pytest.raises(ForcePlateError) as info:
        validate_estimate_document(doc, ForcePlateLimits(max_estimate_samples=4))
    assert info.value.code == "too_many_predictions"


def test_held_out_participants() -> None:
    a, b = uuid.uuid4(), uuid.uuid4()
    none = validate_estimate_document(estimate_doc(), LIMITS)
    assert check_held_out(none, a) == "no_development_participants_declared"
    with pytest.raises(ForcePlateError) as info:
        check_held_out(none, None)
    assert info.value.code == "held_out_status_unverifiable"
    dev = validate_estimate_document(estimate_doc(estimator__development_research_subject_ids=[str(a)]), LIMITS)
    assert check_held_out(dev, b) == "trial_participant_not_in_development_set"
    with pytest.raises(ForcePlateError) as info:
        check_held_out(dev, a)
    assert info.value.code == "subject_not_held_out"
    with pytest.raises(ForcePlateError) as info:
        check_held_out(dev, None)
    assert info.value.code == "held_out_status_unverifiable"
    duplicate = estimate_doc(estimator__development_research_subject_ids=[str(a), str(a)])
    assert est_code(duplicate)[0] == "invalid_estimate"


def test_subject_partition_is_participant_level_and_disjoint() -> None:
    a, b, c = uuid.uuid4(), uuid.uuid4(), uuid.uuid4()
    p = SubjectPartition(development=frozenset({a}), held_out=frozenset({b}))
    assert (p.role(a), p.role(b), p.role(c)) == ("development", "held_out", "unassigned")
    with pytest.raises(ValueError):
        SubjectPartition(development=frozenset({a, b}), held_out=frozenset({b}))
