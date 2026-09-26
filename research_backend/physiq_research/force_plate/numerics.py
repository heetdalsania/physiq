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
    dt = np.diff(t_ms)
    return float(np.sum(0.5 * (v[:-1] + v[1:]) * dt) / 1000.0)


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
    dx = x - np.mean(x)
    dy = y - np.mean(y)
    sxx = float(np.sum(dx * dx))
    syy = float(np.sum(dy * dy))
    if sxx == 0.0 or syy == 0.0:  # pragma: no cover - excluded by the exact test above
        return None
    r = float(np.sum(dx * dy)) / float(np.sqrt(sxx * syy))
    return max(-1.0, min(1.0, r))  # rounding guard only


def max_interval(t: np.ndarray) -> float:
    return float(np.max(np.diff(t))) if t.size > 1 else 0.0


def require_finite(values: np.ndarray, code: str) -> None:
    if not np.all(np.isfinite(values)):
        raise ForcePlateError(code)
