"""video-sampling-v0.1: deterministic, time-based frame selection."""

from __future__ import annotations

import itertools
from dataclasses import dataclass
from fractions import Fraction

import pytest

from physiq_research.media.sampling import INTERVAL_S, SamplingStats, provider_timestamp_ms, sample_frames


@dataclass(frozen=True)
class F:
    t: Fraction


def select(times: list[Fraction]) -> list[Fraction]:
    return [f.t for f in sample_frames(F(t) for t in times)]


def cfr(fps: Fraction, n: int) -> list[Fraction]:
    return [Fraction(i) / fps for i in range(n)]


def reference_selection(times: list[Fraction]) -> list[Fraction]:
    """Brute-force (non-streaming) statement of the documented rule."""
    if not times:
        return []
    t0, out, last_ms = times[0], [], None
    k = 0
    while t0 + k * INTERVAL_S - times[-1] <= INTERVAL_S / 2:
        g = t0 + k * INTERVAL_S
        best = min(times, key=lambda t: (abs(t - g), t))  # nearest, ties → earlier
        if abs(best - g) <= INTERVAL_S / 2 and (not out or best != out[-1]):
            ms = provider_timestamp_ms(best)
            if last_ms is None or ms > last_ms:
                out.append(best)
                last_ms = ms
        k += 1
    return out


@pytest.mark.parametrize(
    ("fps", "every"), [(Fraction(30), 2), (Fraction(60), 4), (Fraction(15), 1), (Fraction(120), 8)]
)
def test_cfr_sources_sample_at_15hz(fps: Fraction, every: int) -> None:
    times = cfr(fps, int(fps) * 3 + 1)  # 3 s inclusive: the last frame sits on the grid
    got = select(times)
    assert got == times[::every]
    assert got == reference_selection(times)


def test_last_frame_is_nearest_to_a_trailing_grid_point() -> None:
    # 30 fps ending on an odd frame: the final grid point (3.0 s) has only the
    # 2.9667 s frame within Δ/2, so it is selected — the documented nearest-frame rule.
    times = cfr(Fraction(30), 90)
    got = select(times)
    assert got[-1] == times[-1] and got[:-1] == times[:-1:2]
    assert got == reference_selection(times)


def test_streaming_matches_brute_force_rule_on_random_vfr() -> None:
    import random

    rng = random.Random(11)
    for _ in range(50):
        t = Fraction(0)
        times = [t]
        for _ in range(rng.randint(1, 120)):
            t += Fraction(rng.randint(3, 140), 1000)
            times.append(t)
        assert select(times) == reference_selection(times)


def test_ntsc_29_97_uses_exact_timestamps() -> None:
    times = [Fraction(1001 * i, 30000) for i in range(90)]
    got = select(times)
    assert got[:5] == [times[0], times[2], times[4], times[6], times[8]]
    for a, b in itertools.pairwise(got):
        assert b > a


def test_low_rate_sources_keep_every_frame() -> None:
    times = cfr(Fraction(10), 30)
    assert select(times) == times
    times = cfr(Fraction(12), 30)
    assert select(times) == times


def test_variable_frame_rate_chooses_by_time_not_count() -> None:
    # 30 fps with ±5 ms jitter and a 300 ms hole: grid-nearest selection stays on the 15 Hz grid.
    jitter = [0, 3, -4, 5, -2, 1, 4, -5, 2, -1] * 10
    times = [Fraction(1000 * i, 30) / 1000 + Fraction(j, 1000) for i, j in enumerate(jitter)]
    times = sorted(t for t in times if not (Fraction(1) <= t <= Fraction(13, 10)))
    stats = SamplingStats()
    got = [f.t for f in sample_frames((F(t) for t in times), stats)]
    for t in got:
        k = round((t - times[0]) / INTERVAL_S)
        assert abs(t - (times[0] + k * INTERVAL_S)) <= INTERVAL_S / 2
    assert stats.empty_slots > 0  # the hole leaves grid slots empty instead of inventing frames
    assert all(b > a for a, b in itertools.pairwise(got))


def test_selection_is_deterministic_and_keeps_original_timestamps() -> None:
    times = [Fraction(i * 37, 1000) for i in range(200)]
    a = select(times)
    b = select(times)
    assert a == b
    assert set(a) <= set(times)


def test_ties_go_to_the_earlier_frame() -> None:
    half = INTERVAL_S / 2
    times = [Fraction(0), INTERVAL_S - half, INTERVAL_S + half]
    assert select(times)[1] == INTERVAL_S - half


def test_provider_timestamps_strictly_increase() -> None:
    # Two frames 0.4 ms apart around a grid boundary would collide at integer ms.
    times = [Fraction(0), Fraction(1, 30), Fraction(3333, 100000), Fraction(3337, 100000), Fraction(1, 10)]
    got = select(sorted(times))
    stamps = [provider_timestamp_ms(t) for t in got]
    assert stamps == sorted(set(stamps))


def test_single_and_empty_inputs() -> None:
    assert select([Fraction(5)]) == [Fraction(5)]
    assert select([]) == []
