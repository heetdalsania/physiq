"""Measured vertical-GRF ground truth in M7 media time (``force-ground-truth-v0.1``).

The force plate is the MEASURED ground truth. The ground-truth series is the
canonical measured signal's OWN samples whose synchronized media time lies in
the closed overlap interval — no filtering, no resampling, no smoothing, no
offset correction, no gap filling, no extrapolation (``preprocessing:
none``). Each sample keeps its source index, so it can be traced back to the
canonical signal and recomputed bit-for-bit (``verify_consistency``).

Bodyweight normalization
    body_weight_n   = body_mass_kg × 9.80665      (standard gravity, exact by
                                                   definition; never a rounded 9.8)
    vertical_grf_bw = vertical_grf_n / body_weight_n
body_mass_kg is the declared input. It is never estimated from quiet-standing
force.

Protocol rules (rejections, never repairs)
    * the synchronized samples must bracket the whole M7 repetition
      [descent_start_ms, ascent_end_ms] (``repetition_not_covered``);
    * within the repetition (including the two bracketing samples) no two
      consecutive force samples may be more than 20 ms apart
      (``force_sampling_gap_in_repetition``) — a data-completeness rule that
      keeps linear interpolation of the measured signal to spans far shorter
      than the video comparison cadence (≈ 67 ms at M7's 15 Hz sampling); it
      is not a claim about an optimal sampling rate;
    * measured vertical force must be > 0 N throughout the repetition: with
      both feet on the plate a bodyweight squat never unloads it, so a
      non-positive value means the declared sign, the plate zero or the setup
      is wrong (``non_positive_vertical_force_in_repetition``). Nothing is
      flipped or corrected.

Descriptive only (reported, never used to correct or reject)
    * standing reference: time-averaged measured force over the M7 standing
      calibration window, and its ratio to the declared body weight;
    * sampling intervals, non-positive sample counts and ranges over the
      overlap; measured peak, trough and impulse over the repetition.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Final

import numpy as np

from physiq_research.force_plate.errors import ForcePlateError
from physiq_research.force_plate.linkage import LinkedAssessment
from physiq_research.force_plate.numerics import integral_ms_to_s, max_interval, peak, restrict, trough
from physiq_research.force_plate.signal import MeasuredForceSignal
from physiq_research.force_plate.sync import ClockMapping, Overlap, force_ms_from_media_ms, media_ms_from_force_s

STANDARD_GRAVITY_M_S2: Final = 9.80665  # m/s², conventional value (3rd CGPM, 1901); exact
MAX_FORCE_SAMPLE_INTERVAL_IN_REPETITION_MS: Final = 20.0

GROUND_TRUTH_PARAMETERS: Final[dict[str, Any]] = {
    "standard_gravity_m_s2": STANDARD_GRAVITY_M_S2,
    "body_weight": "body_mass_kg * standard_gravity_m_s2 (declared mass; never estimated from force)",
    "normalization": "vertical_grf_bw = vertical_grf_n / body_weight_n",
    "samples": "native canonical samples whose synchronized media time lies in the closed overlap",
    "preprocessing": "none",
    "repetition_window": "M7 summary.segmentation.events [descent_start_ms, ascent_end_ms], bracketed by samples",
    "max_force_sample_interval_in_repetition_ms": MAX_FORCE_SAMPLE_INTERVAL_IN_REPETITION_MS,
    "vertical_force_in_repetition": "must be > 0 N",
    "standing_reference": "descriptive: time-averaged force over the M7 calibration window when bracketed",
}


def body_weight_n(body_mass_kg: float) -> float:
    return body_mass_kg * STANDARD_GRAVITY_M_S2


@dataclass(frozen=True)
class GroundTruth:
    source_index_range: tuple[int, int]  # inclusive, into the canonical signal
    t_media_ms: np.ndarray
    vertical_grf_n: np.ndarray
    vertical_grf_bw: np.ndarray
    body_mass_kg: float
    body_weight_n: float
    repetition: dict[str, Any]
    standing_reference: dict[str, Any]
    measurement_checks: dict[str, Any]

    def artifact_body(self) -> dict[str, Any]:
        return {
            "body_mass_kg": self.body_mass_kg,
            "standard_gravity_m_s2": STANDARD_GRAVITY_M_S2,
            "body_weight_n": self.body_weight_n,
            "preprocessing": "none",
            "sample_support_media_ms": [float(self.t_media_ms[0]), float(self.t_media_ms[-1])],
            "source_sample_index_range": list(self.source_index_range),
            "t_media_ms": self.t_media_ms.tolist(),
            "vertical_grf_n": self.vertical_grf_n.tolist(),
            "vertical_grf_bw": self.vertical_grf_bw.tolist(),
            "repetition": self.repetition,
            "standing_reference": self.standing_reference,
            "measurement_checks": self.measurement_checks,
        }


def select_overlap(mapped_ms: np.ndarray, overlap: Overlap) -> tuple[int, int]:
    inside = np.flatnonzero((mapped_ms >= overlap.media_ms[0]) & (mapped_ms <= overlap.media_ms[1]))
    if inside.size < 2:
        raise ForcePlateError("repetition_not_covered")
    i0, i1 = int(inside[0]), int(inside[-1])
    if inside.size != i1 - i0 + 1:  # pragma: no cover - mapped times are strictly increasing
        raise ForcePlateError("internal_error")
    return i0, i1


def _repetition(
    t: np.ndarray, n: np.ndarray, bw: float, linked: LinkedAssessment, mapping: ClockMapping
) -> dict[str, Any]:
    ds, ae = linked.descent_start_ms, linked.ascent_end_ms
    if not (t[0] <= ds and ae <= t[-1]):
        raise ForcePlateError("repetition_not_covered")
    j0 = int(np.searchsorted(t, ds, side="right")) - 1  # last sample ≤ descent start
    j1 = int(np.searchsorted(t, ae, side="left"))  # first sample ≥ ascent end
    gap = max_interval(t[j0 : j1 + 1])
    if gap > MAX_FORCE_SAMPLE_INTERVAL_IN_REPETITION_MS:
        raise ForcePlateError("force_sampling_gap_in_repetition")
    if not np.all(n[j0 : j1 + 1] > 0.0):
        raise ForcePlateError("non_positive_vertical_force_in_repetition")
    rt, rv = restrict(t, n, ds, ae)
    peak_n, peak_t = peak(rt, rv)
    trough_n, trough_t = trough(rt, rv)
    impulse = integral_ms_to_s(rt, rv)
    return {
        "media_ms": [ds, ae],
        "deepest_media_ms": linked.deepest_ms,
        "force_s": [force_ms_from_media_ms(mapping, ds) / 1000.0, force_ms_from_media_ms(mapping, ae) / 1000.0],
        "deepest_force_s": force_ms_from_media_ms(mapping, linked.deepest_ms) / 1000.0,
        "duration_ms": ae - ds,
        "bracketing_sample_range": [j0, j1],
        "samples_inside": int(np.count_nonzero((t >= ds) & (t <= ae))),
        "max_sample_interval_ms": gap,
        "measured_peak_vertical_grf_n": peak_n,
        "measured_peak_vertical_grf_bw": peak_n / bw,
        "measured_peak_media_ms": peak_t,
        "measured_trough_vertical_grf_n": trough_n,
        "measured_trough_vertical_grf_bw": trough_n / bw,
        "measured_trough_media_ms": trough_t,
        "measured_impulse_n_s": impulse,
        "measured_impulse_bw_s": impulse / bw,
    }


def _standing(t: np.ndarray, n: np.ndarray, bw: float, linked: LinkedAssessment) -> dict[str, Any]:
    cs, ce = linked.calibration_start_ms, linked.calibration_end_ms
    base: dict[str, Any] = {
        "window_media_ms": [cs, ce],
        "role": "descriptive consistency check of declared body mass vs measured standing force; corrects nothing",
    }
    if not (ce > cs and t[0] <= cs and ce <= t[-1]):
        return {**base, "state": "not_covered", "mean_vertical_grf_n": None, "mean_vertical_grf_bw": None}
    wt, wv = restrict(t, n, cs, ce)
    mean_n = integral_ms_to_s(wt, wv) / ((ce - cs) / 1000.0)
    return {**base, "state": "covered", "mean_vertical_grf_n": mean_n, "mean_vertical_grf_bw": mean_n / bw}


def build_ground_truth(
    signal: MeasuredForceSignal,
    mapping: ClockMapping,
    overlap: Overlap,
    linked: LinkedAssessment,
    body_mass_kg: float,
) -> GroundTruth:
    mapped = media_ms_from_force_s(mapping, signal.time_s)
    i0, i1 = select_overlap(mapped, overlap)
    t = mapped[i0 : i1 + 1]
    n = signal.vertical_grf_n[i0 : i1 + 1]
    bw = body_weight_n(body_mass_kg)
    bw_series = n / bw
    repetition = _repetition(t, n, bw, linked, mapping)
    standing = _standing(t, n, bw, linked)
    checks = {
        "sample_count": int(t.size),
        "max_sample_interval_ms": max_interval(t),
        "non_positive_samples": int(np.count_nonzero(n <= 0.0)),
        "min_vertical_grf_n": float(n.min()),
        "max_vertical_grf_n": float(n.max()),
    }
    for arr in (t, n, bw_series):
        arr.flags.writeable = False
    return GroundTruth(
        source_index_range=(i0, i1),
        t_media_ms=t,
        vertical_grf_n=n,
        vertical_grf_bw=bw_series,
        body_mass_kg=body_mass_kg,
        body_weight_n=bw,
        repetition=repetition,
        standing_reference=standing,
        measurement_checks=checks,
    )


def verify_consistency(signal_doc: dict[str, Any], sync_doc: dict[str, Any], truth_doc: dict[str, Any]) -> None:
    """Recompute the stored ground truth from the stored signal and mapping.

    Raises ValueError unless every stored ground-truth value equals the value
    recomputed from the canonical signal, the stored clock mapping and the
    declared body mass — bit for bit. Catches a writer (or an editor of the
    database) that keeps digests consistent but breaks the derivation.
    """
    time_s = np.asarray(signal_doc["time_s"], dtype=np.float64)
    force_n = np.asarray(signal_doc["vertical_grf_n"], dtype=np.float64)
    mapping = ClockMapping(
        sync_doc["method"], float(sync_doc["mapping"]["offset_ms"]), float(sync_doc["mapping"]["rate"])
    )
    i0, i1 = truth_doc["source_sample_index_range"]
    mapped = media_ms_from_force_s(mapping, time_s)
    start, end = (float(x) for x in sync_doc["overlap"]["media_ms"])
    if not (0 <= i0 < i1 < time_s.size):
        raise ValueError("ground-truth index range outside the signal")
    if not (start <= mapped[i0] and mapped[i1] <= end):
        raise ValueError("ground-truth samples outside the overlap")
    if (i0 > 0 and mapped[i0 - 1] >= start) or (i1 + 1 < time_s.size and mapped[i1 + 1] <= end):
        raise ValueError("ground truth omits samples inside the overlap")
    bw = body_weight_n(float(truth_doc["body_mass_kg"]))
    if float(truth_doc["body_weight_n"]) != bw:
        raise ValueError("body weight does not follow from body mass")
    expected = {
        "t_media_ms": mapped[i0 : i1 + 1],
        "vertical_grf_n": force_n[i0 : i1 + 1],
        "vertical_grf_bw": force_n[i0 : i1 + 1] / bw,
    }
    for key, values in expected.items():
        stored = np.asarray(truth_doc[key], dtype=np.float64)
        if stored.shape != values.shape or not np.array_equal(stored, values):
            raise ValueError(f"ground-truth {key} does not follow from the canonical signal")
