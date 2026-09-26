"""Per-trial comparison of an ESTIMATE with MEASURED force (``grf-validation-v0.1``).

The evaluator never produces a prediction. Given a trial's measured ground
truth and a separately supplied estimate (both in M7 media time), it
computes transparent agreement metrics under this pre-declared protocol:

Intervals
    I  repetition interval = M7 [descent_start_ms, ascent_end_ms]
    S  prediction support  = [first, last] prediction timestamp
    J  comparison interval = I ∩ S
Coverage rule (the M6/M7 segmentation limits, restated as literal values
of THIS protocol): every segment of the prediction's piecewise-linear
signal that overlaps I — including a segment reaching in from a prediction
sample just outside I — is ≤ 300 ms long; any stretch of I before the first
or after the last prediction sample is ≤ 300 ms; and ≥ 8 prediction samples
lie inside I. Otherwise the comparison is refused
(``prediction_gap_exceeded`` / ``insufficient_prediction_samples`` /
``no_prediction_in_repetition``).

Pointwise metrics (at the prediction samples inside I)
    measured value at a prediction time = linear interpolation between the
    two bracketing NATIVE force samples (exact at a sample time; no
    filtering; never extrapolated — I lies inside the measured support);
    e_i = predicted_i − measured_i; bias = mean e; MAE = mean |e|;
    RMSE = √(mean e²); the same in body weights (÷ body_weight_n). Samples
    are unweighted, one per prediction timestamp.
Waveform shape (diagnostic only, never "accuracy")
    Pearson r over the same pairs; undefined (null) if either series is
    constant.
Peak and impulse (over J, of the piecewise-linear signals)
    measured peak/impulse from the native force samples, predicted
    peak/impulse from the prediction samples; peak = maximum of the
    interpolant (earliest on ties); impulse = its exact integral (trapezoid);
    newton-seconds and body-weight-seconds.

Never: a time shift or lag search, extrapolation, resampling of the
measured signal, a single combined score, or any label such as
good/bad/pass/fail. Timestamps are used exactly as given.
"""

from __future__ import annotations

import itertools
from dataclasses import dataclass
from typing import Any, Final

import numpy as np

from physiq_research.force_plate.errors import ForcePlateError
from physiq_research.force_plate.numerics import (
    integral_ms_to_s,
    interpolate_linear,
    max_interval,
    peak,
    pearson,
    restrict,
)

MAX_PREDICTION_GAP_MS: Final = 300.0  # = M6/M7 segmentation maxGapMs, fixed here as a protocol value
MIN_COMPARISON_SAMPLES: Final = 8  # = M6/M7 segmentation minRepSamples, fixed here as a protocol value

EVALUATION_PARAMETERS: Final[dict[str, Any]] = {
    "comparison_grid": "prediction timestamps inside the M7 repetition interval",
    "measured_value_at_prediction_time": "linear interpolation between bracketing native force samples",
    "extrapolation": "none",
    "time_shift": "none",
    "sample_weighting": "unweighted, one per prediction timestamp",
    "max_prediction_gap_ms": MAX_PREDICTION_GAP_MS,
    "min_comparison_samples": MIN_COMPARISON_SAMPLES,
    "comparison_interval": "repetition interval intersected with the prediction support",
    "peak": "maximum of the piecewise-linear signal on the comparison interval; earliest on ties",
    "impulse": "exact integral (trapezoidal) of the piecewise-linear signal on the comparison interval",
    "pearson_r": "waveform-shape diagnostic; null when either series is constant",
}


@dataclass(frozen=True)
class TruthSeries:
    """What the evaluator needs from a stored ground-truth artifact."""

    t_media_ms: np.ndarray
    vertical_grf_n: np.ndarray
    body_weight_n: float
    repetition_ms: tuple[float, float]


def _coverage(t: np.ndarray, rep: tuple[float, float]) -> tuple[int, int, float, float]:
    """Indices (k0, k1) of the prediction polyline on J, and uncovered ends."""
    start, end = rep
    inside = np.flatnonzero((t >= start) & (t <= end))
    if inside.size == 0:
        raise ForcePlateError("no_prediction_in_repetition")
    if inside.size < MIN_COMPARISON_SAMPLES:
        raise ForcePlateError("insufficient_prediction_samples")
    first, last = int(inside[0]), int(inside[-1])
    k0 = first - 1 if first > 0 else first  # bracketing sample before I, if any
    k1 = last + 1 if last + 1 < t.size else last  # bracketing sample after I, if any
    uncovered_start = max(0.0, float(t[k0]) - start)
    uncovered_end = max(0.0, end - float(t[k1]))
    return k0, k1, uncovered_start, uncovered_end


def evaluate(truth: TruthSeries, t_pred: np.ndarray, f_pred: np.ndarray) -> dict[str, Any]:
    """Metrics document body (schema: records.ValidationMetrics)."""
    rep = truth.repetition_ms
    bw = truth.body_weight_n
    if not (truth.t_media_ms[0] <= rep[0] and rep[1] <= truth.t_media_ms[-1]):
        # Import guarantees this; a stored artifact that breaks it is not served.
        raise ForcePlateError("stored_data_integrity_error")
    k0, k1, uncovered_start, uncovered_end = _coverage(t_pred, rep)
    # Segments of the prediction polyline that overlap I, and uncovered ends.
    poly_t = t_pred[k0 : k1 + 1]
    segments = [float(b - a) for a, b in itertools.pairwise(poly_t) if b > rep[0] and a < rep[1]]
    worst = max([uncovered_start, uncovered_end, *segments])
    if worst > MAX_PREDICTION_GAP_MS:
        raise ForcePlateError("prediction_gap_exceeded")

    comp_start = max(rep[0], float(t_pred[0]))
    comp_end = min(rep[1], float(t_pred[-1]))

    in_rep = (t_pred >= rep[0]) & (t_pred <= rep[1])
    tp = t_pred[in_rep]
    fp = f_pred[in_rep]
    fm = interpolate_linear(truth.t_media_ms, truth.vertical_grf_n, tp)
    e = fp - fm
    pointwise = {
        "comparison_samples": int(tp.size),
        "mean_signed_error_n": float(np.mean(e)),
        "mae_n": float(np.mean(np.abs(e))),
        "rmse_n": float(np.sqrt(np.mean(e * e))),
    }
    e_bw = e / bw
    pointwise |= {
        "mean_signed_error_bw": float(np.mean(e_bw)),
        "mae_bw": float(np.mean(np.abs(e_bw))),
        "rmse_bw": float(np.sqrt(np.mean(e_bw * e_bw))),
    }
    r = pearson(fp, fm)

    mt, mv = restrict(truth.t_media_ms, truth.vertical_grf_n, comp_start, comp_end)
    pt, pv = restrict(t_pred, f_pred, comp_start, comp_end)
    m_peak, m_peak_t = peak(mt, mv)
    p_peak, p_peak_t = peak(pt, pv)
    m_imp = integral_ms_to_s(mt, mv)
    p_imp = integral_ms_to_s(pt, pv)

    rep_duration = rep[1] - rep[0]
    return {
        "body_weight_n": bw,
        "time_shift_applied_ms": 0,
        "intervals": {
            "repetition_media_ms": [rep[0], rep[1]],
            "prediction_support_media_ms": [float(t_pred[0]), float(t_pred[-1])],
            "comparison_media_ms": [comp_start, comp_end],
            "repetition_coverage_fraction": (comp_end - comp_start) / rep_duration,
            "uncovered_start_ms": uncovered_start,
            "uncovered_end_ms": uncovered_end,
        },
        "samples": {
            "prediction_samples": int(t_pred.size),
            "in_repetition": int(tp.size),
            "before_repetition": int(np.count_nonzero(t_pred < rep[0])),
            "after_repetition": int(np.count_nonzero(t_pred > rep[1])),
            "max_prediction_segment_in_repetition_ms": max(segments) if segments else 0.0,
            "max_measured_interval_in_comparison_ms": max_interval(mt),
        },
        "pointwise": pointwise,
        "waveform_shape": {
            "pearson_r": r,
            "state": "defined" if r is not None else "undefined_constant_series",
            "role": "waveform-shape diagnostic only; not a measure of agreement",
        },
        "peak": {
            "measured_peak_n": m_peak,
            "measured_peak_bw": m_peak / bw,
            "measured_peak_media_ms": m_peak_t,
            "predicted_peak_n": p_peak,
            "predicted_peak_bw": p_peak / bw,
            "predicted_peak_media_ms": p_peak_t,
            "peak_error_n": p_peak - m_peak,
            "abs_peak_error_n": abs(p_peak - m_peak),
            "peak_error_bw": (p_peak - m_peak) / bw,
            "abs_peak_error_bw": abs(p_peak - m_peak) / bw,
            "peak_time_difference_ms": p_peak_t - m_peak_t,
        },
        "impulse": {
            "interval_media_ms": [comp_start, comp_end],
            "measured_impulse_n_s": m_imp,
            "predicted_impulse_n_s": p_imp,
            "impulse_error_n_s": p_imp - m_imp,
            "abs_impulse_error_n_s": abs(p_imp - m_imp),
            "measured_impulse_bw_s": m_imp / bw,
            "predicted_impulse_bw_s": p_imp / bw,
            "abs_impulse_error_bw_s": abs(p_imp - m_imp) / bw,
        },
    }
