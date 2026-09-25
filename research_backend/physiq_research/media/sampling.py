"""Deterministic analysis-frame sampling ``video-sampling-v0.1``.

Pose inference is not run on every decoded frame. Frames are chosen by
MEDIA TIME, not by frame count, on a fixed grid aligned with Milestone 6's
≈15 Hz analysis cadence:

    Δ   = 1000/15 ms (exact rational)
    g_k = t₀ + k·Δ,  k = 0, 1, 2, …     t₀ = first accepted frame's time

For each grid time g_k the selected frame is the accepted frame whose
timestamp is NEAREST to g_k (ties → the earlier frame), provided that
    * |t − g_k| ≤ Δ/2               (otherwise the slot stays empty), and
    * it was not already selected for g_{k−1}, and
    * its provider timestamp ⌊t_ms⌋ is strictly greater than that of the
      previously selected frame (the pose runtime's VIDEO mode requires
      strictly increasing integer milliseconds).

All comparisons use exact rationals (PTS × time_base), so the selection is
bit-for-bit reproducible. Selected frames keep their ORIGINAL timestamps —
the grid only decides which frames are analysed; no timestamp is snapped.
Sources at ≤ 15 fps have every frame selected. The algorithm streams with a
one-frame look-ahead, so at most two decoded frames are held at a time.
"""

from __future__ import annotations

import math
from collections.abc import Iterable, Iterator
from dataclasses import dataclass
from fractions import Fraction
from typing import Any, Final, Protocol

TARGET_RATE_HZ: Final = 15
INTERVAL_S: Final = Fraction(1, TARGET_RATE_HZ)

SAMPLING_PARAMETERS: Final[dict[str, Any]] = {
    "algorithm": "nearest_frame_to_fixed_time_grid",
    "target_rate_hz": TARGET_RATE_HZ,
    "grid_interval_ms": "1000/15",
    "grid_origin": "first_accepted_frame",
    "max_offset_from_grid": "half_interval",
    "tie_break": "earlier_frame",
    "provider_timestamp": "floor(t_ms), strictly increasing",
    "arithmetic": "exact_rational",
}


class TimedFrame(Protocol):
    @property
    def t(self) -> Fraction: ...


def provider_timestamp_ms(t: Fraction) -> int:
    return math.floor(t * 1000)


@dataclass
class SamplingStats:
    grid_slots: int = 0
    selected: int = 0
    empty_slots: int = 0
    skipped_timestamp_collision: int = 0

    def as_dict(self) -> dict[str, int]:
        return {
            "grid_slots": self.grid_slots,
            "selected": self.selected,
            "empty_slots": self.empty_slots,
            "skipped_timestamp_collision": self.skipped_timestamp_collision,
        }


def sample_frames(frames: Iterable[Any], stats: SamplingStats | None = None) -> Iterator[Any]:
    """Yield the selected frames (each has an exact rational ``t``) in order."""
    st = stats if stats is not None else SamplingStats()
    half = INTERVAL_S / 2
    k = 0
    t0: Fraction | None = None
    prev: Any = None
    last_selected: Any = None
    last_provider_ms: int | None = None

    def choose(candidate: Any, grid: Fraction) -> Any:
        nonlocal last_selected, last_provider_ms
        st.grid_slots += 1
        if candidate is None or abs(candidate.t - grid) > half or candidate is last_selected:
            st.empty_slots += 1
            return None
        pts_ms = provider_timestamp_ms(candidate.t)
        if last_provider_ms is not None and pts_ms <= last_provider_ms:
            st.skipped_timestamp_collision += 1
            st.empty_slots += 1
            return None
        last_selected = candidate
        last_provider_ms = pts_ms
        st.selected += 1
        return candidate

    for cur in frames:
        if t0 is None:
            t0 = cur.t
            prev = cur
            continue
        # Invariant: every grid time < prev.t has been resolved, so g_k ≥ prev.t.
        while t0 + k * INTERVAL_S < cur.t:
            grid = t0 + k * INTERVAL_S
            nearer = prev if (grid - prev.t) <= (cur.t - grid) else cur
            picked = choose(nearer, grid)
            if picked is not None:
                yield picked
            k += 1
        prev = cur

    if prev is None or t0 is None:
        return
    # Grid times at or after the last frame: only the last frame can match.
    while t0 + k * INTERVAL_S - prev.t <= half:
        picked = choose(prev, t0 + k * INTERVAL_S)
        if picked is not None:
            yield picked
        k += 1
