"""Pure 2D image-space geometry (port of js/movement/geometry.js).

Angles here are between PROJECTED landmark positions in one camera image;
nothing is a 3D or anatomical joint angle.
"""

from __future__ import annotations

import math
from collections.abc import Iterable
from typing import Protocol

# Segments shorter than this (image pixels in practice) have no direction.
MIN_SEGMENT_LENGTH = 1e-9


class PointLike(Protocol):
    @property
    def x(self) -> float: ...

    @property
    def y(self) -> float: ...


class Point:
    __slots__ = ("x", "y")

    def __init__(self, x: float, y: float) -> None:
        self.x = x
        self.y = y

    def __repr__(self) -> str:  # pragma: no cover - debugging aid only
        return f"Point({self.x!r}, {self.y!r})"


def is_finite_number(value: object) -> bool:
    """True for a finite real number (bool is not a number here)."""
    if isinstance(value, bool):
        return False
    if isinstance(value, (int, float)):
        return math.isfinite(value)
    return False


def _is_point(p: object) -> bool:
    if p is None:
        return False
    x = getattr(p, "x", None)
    y = getattr(p, "y", None)
    return is_finite_number(x) and is_finite_number(y)


def included_angle_deg(a: PointLike | None, b: PointLike | None, c: PointLike | None) -> float | None:
    """Included angle at B formed by A–B–C, degrees, range [0, 180].

    u = A − B, v = C − B, angle = atan2(|u × v|, u · v). Exact at 0° and
    180° (unlike acos). Returns None for missing/non-finite points or when A
    or C coincides with B.
    """
    if not (_is_point(a) and _is_point(b) and _is_point(c)):
        return None
    assert a is not None and b is not None and c is not None
    ux, uy = a.x - b.x, a.y - b.y
    vx, vy = c.x - b.x, c.y - b.y
    len_u = math.hypot(ux, uy)
    len_v = math.hypot(vx, vy)
    if not (math.isfinite(len_u) and math.isfinite(len_v)):
        return None
    if len_u < MIN_SEGMENT_LENGTH or len_v < MIN_SEGMENT_LENGTH:
        return None
    cross = ux * vy - uy * vx
    dot = ux * vx + uy * vy
    deg = math.atan2(abs(cross), dot) * 180 / math.pi
    return deg if math.isfinite(deg) else None


def distance(a: PointLike | None, b: PointLike | None) -> float | None:
    if not (_is_point(a) and _is_point(b)):
        return None
    assert a is not None and b is not None
    d = math.hypot(a.x - b.x, a.y - b.y)
    return d if math.isfinite(d) else None


def midpoint(a: PointLike | None, b: PointLike | None) -> Point | None:
    if not (_is_point(a) and _is_point(b)):
        return None
    assert a is not None and b is not None
    return Point((a.x + b.x) / 2, (a.y + b.y) / 2)


def _finite_sorted(values: Iterable[object]) -> list[float]:
    return sorted(float(v) for v in values if is_finite_number(v))  # type: ignore[arg-type]


def median(values: Iterable[object]) -> float | None:
    """Median of the finite numbers (mean of the middle two for an even count)."""
    v = _finite_sorted(values)
    if not v:
        return None
    mid = len(v) // 2
    return v[mid] if len(v) % 2 == 1 else (v[mid - 1] + v[mid]) / 2


def mean(values: Iterable[object]) -> float | None:
    """Mean of the finite numbers, summed in sorted order (order-independent)."""
    v = _finite_sorted(values)
    if not v:
        return None
    total = 0.0
    for x in v:
        total += x
    return total / len(v)


def percentile(values: Iterable[object], p: float) -> float | None:
    """Nearest-rank percentile (p in [0, 100]) of the finite numbers."""
    v = _finite_sorted(values)
    if not v:
        return None
    rank = math.ceil((p / 100) * len(v))
    return v[min(len(v) - 1, max(0, rank - 1))]
