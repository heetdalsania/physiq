"""Deterministic numerical primitives on sampled signals.

A sampled signal (t, v) — t strictly increasing — is treated as its
piecewise-linear interpolant on [t₀, t_last] and as NOTHING outside that
closed support: there is no extrapolation anywhere in this module.

    interpolate_linear   v at query times (exact node values at nodes)
    restrict             the interpolant's nodes on [a, b] (interior nodes plus
                         interpolated endpoints) — its exact graph on [a, b]
    integral_ms_to_s     trapezoidal rule, i.e. the EXACT integral of the
                         piecewise-linear interpolant (t in ms → result in value·s)
    peak / trough        extremum of the interpolant (attained at a node or an
                         endpoint of the restriction); earliest time on ties
    pearson              Pearson correlation; ``None`` when either series has
                         zero variance (undefined, never reported as 0 or NaN)

All arithmetic is IEEE double via NumPy with a fixed operation order, so the
same inputs always give the same bits.
"""

from __future__ import annotations

import numpy as np

from physiq_research.force_plate.errors import ForcePlateError


class OutsideSupport(ValueError):
    """A query lies outside the closed support of a sampled signal."""


def interpolate_linear(t: np.ndarray, v: np.ndarray, query: np.ndarray) -> np.ndarray:
    if t.size < 2:
        raise OutsideSupport("a sampled support needs at least two nodes")
    q = np.asarray(query, dtype=np.float64)
    if q.size and (q.min() < t[0] or q.max() > t[-1]):
        raise OutsideSupport("query outside the sampled support (no extrapolation)")
    # j: index of the last node ≤ q (clamped so that j+1 exists).
    j = np.searchsorted(t, q, side="right") - 1
    j = np.clip(j, 0, t.size - 2)
    t0, t1 = t[j], t[j + 1]
    v0, v1 = v[j], v[j + 1]
    out: np.ndarray = np.asarray(v0 + (v1 - v0) * ((q - t0) / (t1 - t0)), dtype=np.float64)
    exact = q == t0
    out[exact] = v0[exact]  # a query at a node returns that node's value exactly
    at_end = q == t1
    out[at_end] = v1[at_end]
    return out


def restrict(t: np.ndarray, v: np.ndarray, a: float, b: float) -> tuple[np.ndarray, np.ndarray]:
    """Nodes of the interpolant on [a, b]: a, interior nodes, b."""
    if not a < b:
        raise ValueError("empty interval")
    ends = interpolate_linear(t, v, np.array([a, b]))
    inner = (t > a) & (t < b)
    return (
        np.concatenate(([a], t[inner], [b])),
        np.concatenate(([ends[0]], v[inner], [ends[1]])),
    )


def integral_ms_to_s(t_ms: np.ndarray, v: np.ndarray) -> float:
    """∫ v dt with t in milliseconds; result in value·seconds (trapezoidal)."""
    dt_s = np.diff(t_ms) / 1000.0
    # Halve before adding and convert the time interval before multiplying:
    # both the midpoint force and the true integral may be finite even when
    # (v0 + v1) or a millisecond-scaled intermediate would overflow.
    with np.errstate(over="ignore", invalid="ignore"):
        result = float(np.sum((0.5 * v[:-1] + 0.5 * v[1:]) * dt_s))
    if not np.isfinite(result):
        raise ForcePlateError("non_finite_derived_value")
    return result


def peak(t: np.ndarray, v: np.ndarray) -> tuple[float, float]:
    k = int(np.argmax(v))  # first occurrence → earliest time on ties
    return float(v[k]), float(t[k])


def trough(t: np.ndarray, v: np.ndarray) -> tuple[float, float]:
    k = int(np.argmin(v))
    return float(v[k]), float(t[k])


def pearson(x: np.ndarray, y: np.ndarray) -> float | None:
    # Exact constancy test first: the mean of a constant array can differ from
    # its elements by one ulp, which would leave a meaningless ~1e-16 variance.
    if x.size < 2 or np.all(x == x[0]) or np.all(y == y[0]):
        return None

    def centered_scaled(values: np.ndarray) -> np.ndarray:
        # Subtract a reference before scaling so tiny variation on a large
        # offset survives. Fall back to scaling first if subtraction itself
        # overflows (e.g. opposite-sign values near the float limit).
        with np.errstate(over="ignore", invalid="ignore"):
            shifted = values - values[0]
        if not np.all(np.isfinite(shifted)):
            magnitude = float(np.max(np.abs(values)))
            shifted = values / magnitude - values[0] / magnitude
        scale = float(np.max(np.abs(shifted)))
        if scale == 0.0:
            zeros: np.ndarray = np.zeros(values.shape, dtype=np.float64)
            return zeros
        scaled = shifted / scale
        centered: np.ndarray = scaled - np.mean(scaled)
        return centered

    dx = centered_scaled(x)
    dy = centered_scaled(y)
    sxx = float(np.sum(dx * dx))
    syy = float(np.sum(dy * dy))
    if sxx == 0.0 or syy == 0.0:
        return None
    r = float(np.sum(dx * dy)) / float(np.sqrt(sxx * syy))
    if not np.isfinite(r):
        raise ForcePlateError("non_finite_derived_value")
    return max(-1.0, min(1.0, r))  # rounding guard only


def stable_mean(values: np.ndarray) -> float:
    """Mean without overflow in an intermediate sum."""
    scale = float(np.max(np.abs(values)))
    if scale == 0.0:
        return 0.0
    return float(np.mean(values / scale) * scale)


def stable_rmse(values: np.ndarray) -> float:
    """Root mean square without squaring full-magnitude values."""
    scale = float(np.max(np.abs(values)))
    if scale == 0.0:
        return 0.0
    return float(np.sqrt(np.mean((values / scale) ** 2)) * scale)


def max_interval(t: np.ndarray) -> float:
    return float(np.max(np.diff(t))) if t.size > 1 else 0.0


def require_finite(values: np.ndarray, code: str) -> None:
    if not np.all(np.isfinite(values)):
        raise ForcePlateError(code)
