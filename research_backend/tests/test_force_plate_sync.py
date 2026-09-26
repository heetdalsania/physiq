"""Force ↔ video synchronization against known analytical mappings.

SYNTHETIC TEST FIXTURE — NOT HUMAN DATA — NOT VALIDATION EVIDENCE.
"""

from __future__ import annotations

from typing import Any

import numpy as np
import pytest

from physiq_research.force_plate.errors import ForcePlateError
from physiq_research.force_plate.manifest import Anchor
from physiq_research.force_plate.numerics import OutsideSupport, interpolate_linear
from physiq_research.force_plate.signal import MeasuredForceSignal
from physiq_research.force_plate.sync import (
    MAX_ABS_RATE_DEVIATION,
    MIN_ANCHOR_SEPARATION_MS,
    ClockMapping,
    check_anchor_support,
    compute_overlap,
    describe_sync,
    force_ms_from_media_ms,
    mapping_from_anchors,
    media_ms_from_force_ms,
    media_ms_from_force_s,
)


def anchor(video: float, force: float) -> Anchor:
    return Anchor(event="plate_impact", video_time_ms=video, force_time_ms=force)


def signal(first_s: float, last_s: float, rate_hz: float = 1000.0) -> MeasuredForceSignal:
    n = round((last_s - first_s) * rate_hz) + 1
    t = first_s + np.arange(n, dtype=np.float64) / rate_hz
    t.flags.writeable = False
    f = np.full(n, 700.0)
    f.flags.writeable = False
    return MeasuredForceSignal(time_s=t, vertical_grf_n=f, source_positive_direction="up")


def code_of(fn: Any, *args: Any) -> str:
    with pytest.raises(ForcePlateError) as info:
        fn(*args)
    return info.value.code


def test_one_anchor_offset_is_exact() -> None:
    m = mapping_from_anchors("one_anchor_offset", [anchor(1000.0, 2500.0)])
    assert (m.method, m.offset_ms, m.rate) == ("one_anchor_offset", -1500.0, 1.0)
    assert media_ms_from_force_ms(m, 2500.0) == 1000.0
    assert media_ms_from_force_ms(m, 0.0) == -1500.0
    assert media_ms_from_force_s(m, np.array([0.0, 1.5, 8.5])).tolist() == [-1500.0, 0.0, 7000.0]


def test_two_anchor_affine_is_exact_for_representable_inputs() -> None:
    m = mapping_from_anchors("two_anchor_affine", [anchor(1000.0, 2500.0), anchor(6000.0, 7500.0)])
    assert (m.offset_ms, m.rate) == (-1500.0, 1.0)
    m2 = mapping_from_anchors("two_anchor_affine", [anchor(0.0, 1000.0), anchor(4002.0, 5000.0)])
    assert m2.rate == 4002.0 / 4000.0 and m2.offset_ms == -m2.rate * 1000.0
    for a in (anchor(0.0, 1000.0), anchor(4002.0, 5000.0)):
        assert media_ms_from_force_ms(m2, a.force_time_ms) == pytest.approx(a.video_time_ms, abs=1e-9)


@pytest.mark.parametrize("ppm", [-500.0, -200.0, 50.0, 200.0, 800.0])
def test_known_synthetic_drift_is_recovered(ppm: float) -> None:
    """Truth: t_media = r·(t_force − 1500) with r = 1 + ppm·1e-6 (a force clock
    running at a slightly different rate from the video clock)."""
    r = 1.0 + ppm * 1e-6
    true_offset = -1500.0 * r
    anchors = [anchor(true_offset + r * f, f) for f in (2500.0, 7500.0)]
    m = mapping_from_anchors("two_anchor_affine", anchors)
    assert m.rate == pytest.approx(r, rel=1e-13)
    assert m.offset_ms == pytest.approx(true_offset, abs=1e-9)
    t_force_s = np.linspace(1.5, 8.5, 7001)
    expected = true_offset + r * (t_force_s * 1000.0)
    assert np.max(np.abs(media_ms_from_force_s(m, t_force_s) - expected)) < 1e-9
    # an offset-only alignment of the same clocks accumulates the drift instead
    one = mapping_from_anchors("one_anchor_offset", anchors[:1])
    err_at_end = abs(media_ms_from_force_ms(one, 8500.0) - (true_offset + r * 8500.0))
    assert err_at_end == pytest.approx(abs(ppm) * 1e-6 * 6000.0, rel=1e-6)


@pytest.mark.parametrize(
    ("anchors", "code"),
    [
        ([anchor(1000.0, 2500.0), anchor(1000.0, 2500.0)], "anchors_too_close"),  # identical
        ([anchor(1000.0, 2500.0), anchor(6000.0, 2500.0)], "anchors_too_close"),  # degenerate force axis
        ([anchor(1000.0, 2500.0), anchor(1000.0, 7500.0)], "anchors_too_close"),  # degenerate video axis
        ([anchor(1000.0, 2500.0), anchor(1999.0, 3499.0)], "anchors_too_close"),  # < min separation
        ([anchor(6000.0, 7500.0), anchor(1000.0, 2500.0)], "anchors_not_increasing"),  # listed backwards
        ([anchor(1000.0, 7500.0), anchor(6000.0, 2500.0)], "anchors_not_increasing"),  # reversed clock
        ([anchor(1000.0, 2500.0), anchor(6100.0, 7500.0)], "implausible_clock_rate"),  # 2 % rate error
        ([anchor(0.0, 0.0), anchor(5000.0, 5.0)], "anchors_too_close"),  # s written where ms expected
        ([anchor(0.0, 0.0), anchor(5.0, 5000.0)], "anchors_too_close"),
        ([anchor(0.0, 0.0), anchor(5000.0, 2000.0)], "implausible_clock_rate"),
        ([anchor(1000.0, 2500.0)], "anchor_count_mismatch"),
    ],
)
def test_bad_anchor_pairs_are_rejected(anchors: list[Anchor], code: str) -> None:
    assert code_of(mapping_from_anchors, "two_anchor_affine", anchors) == code


def test_rate_bound_and_separation_are_the_declared_parameters() -> None:
    assert (MIN_ANCHOR_SEPARATION_MS, MAX_ABS_RATE_DEVIATION) == (1000.0, 0.01)
    assert mapping_from_anchors("two_anchor_affine", [anchor(0.0, 0.0), anchor(1009.0, 1000.0)]).rate == 1.009
    assert code_of(mapping_from_anchors, "two_anchor_affine", [anchor(0.0, 0.0), anchor(1011.0, 1000.0)]) == (
        "implausible_clock_rate"
    )
    ok = mapping_from_anchors("two_anchor_affine", [anchor(0.0, 0.0), anchor(1000.0, 1000.0)])
    assert ok.rate == 1.0  # exactly the minimum separation is allowed
    assert code_of(mapping_from_anchors, "one_anchor_offset", [anchor(0, 0), anchor(1, 1)]) == "anchor_count_mismatch"


def test_anchor_support_in_both_clocks() -> None:
    s = signal(0.0, 10.0)
    check_anchor_support([anchor(0.0, 0.0), anchor(7000.0, 10_000.0)], s, 7000.0)  # closed bounds
    assert code_of(check_anchor_support, [anchor(1000.0, 10_000.5)], s, 7000.0) == "anchor_outside_force_support"
    late = signal(1.0, 10.0)
    assert code_of(check_anchor_support, [anchor(1000.0, 999.0)], late, 7000.0) == "anchor_outside_force_support"
    assert code_of(check_anchor_support, [anchor(7000.5, 2000.0)], s, 7000.0) == "anchor_outside_video_support"


def test_full_overlap_in_both_clocks() -> None:
    m = ClockMapping("one_anchor_offset", -1500.0, 1.0)
    o = compute_overlap(m, signal(0.0, 10.0), 7000.0)
    assert o.media_ms == (0.0, 7000.0) and o.force_s == (1.5, 8.5)
    assert o.force_support_media_ms == (-1500.0, 8500.0) and o.duration_ms == 7000.0


def test_partial_overlap_is_explicit() -> None:
    m = ClockMapping("one_anchor_offset", 2000.0, 1.0)  # force starts 2 s into the video
    s = signal(0.0, 3.0)
    o = compute_overlap(m, s, 7000.0)
    assert o.media_ms == (2000.0, 5000.0) and o.force_s == (0.0, 3.0)
    body = describe_sync(m, [anchor(2000.0, 0.0)], o, s)
    assert body["overlap"]["video_coverage_fraction"] == pytest.approx(3 / 7)
    assert body["overlap"]["force_coverage_fraction"] == 1.0
    assert body["media_support_ms"] == [0.0, 7000.0] and body["force_support"]["force_s"] == [0.0, 3.0]
    assert body["anchors"][0]["residual_ms"] == 0.0


@pytest.mark.parametrize("offset", [-20_000.0, 7000.0, 7500.0, -10_000.0])
def test_no_overlap_is_rejected(offset: float) -> None:
    m = ClockMapping("one_anchor_offset", offset, 1.0)
    assert code_of(compute_overlap, m, signal(0.0, 10.0), 7000.0) == "no_temporal_overlap"


def test_boundaries_are_closed_and_nothing_is_extrapolated() -> None:
    m = ClockMapping("one_anchor_offset", -1000.0, 1.0)
    s = signal(0.0, 8.0)  # maps to [-1000, 7000]: the last sample is exactly the video end
    o = compute_overlap(m, s, 7000.0)
    assert o.media_ms == (0.0, 7000.0) and o.force_s == (1.0, 8.0)
    t = np.array([0.0, 1.0, 2.0])
    v = np.array([10.0, 20.0, 40.0])
    assert interpolate_linear(t, v, np.array([0.0, 2.0, 1.0, 0.5, 1.5])).tolist() == [10.0, 40.0, 20.0, 15.0, 30.0]
    for q in (-1e-12, 2.0 + 1e-12):
        with pytest.raises(OutsideSupport):
            interpolate_linear(t, v, np.array([q]))


@pytest.mark.parametrize("rate", [1.0, 1.0002, 0.9995])
def test_round_trip_is_deterministic(rate: float) -> None:
    m = ClockMapping("two_anchor_affine", -1500.123, rate)
    force_ms = np.linspace(0.0, 10_000.0, 1001)
    back = np.array([force_ms_from_media_ms(m, media_ms_from_force_ms(m, f)) for f in force_ms])
    assert np.max(np.abs(back - force_ms)) < 1e-9
    media = np.linspace(-1000.0, 7000.0, 801)
    again = np.array([media_ms_from_force_ms(m, force_ms_from_media_ms(m, x)) for x in media])
    assert np.max(np.abs(again - media)) < 1e-9
    # vectorized and scalar mappings give identical bits
    vec = media_ms_from_force_s(m, force_ms / 1000.0)
    scalar = [media_ms_from_force_ms(m, (f / 1000.0) * 1000.0) for f in force_ms]
    assert vec.tolist() == scalar
