"""JavaScript number semantics needed for exact Milestone 6 parity.

Python's built-in ``round`` rounds half to even; JavaScript's ``Math.round``
rounds half towards +∞. The M6 result contract rounds with
``Math.round(value * f) / f``, so the parity view must do the same.
"""

from __future__ import annotations

import math


def js_round(value: float) -> float:
    """``Math.round(value)`` for a finite double (half rounds towards +∞)."""
    floor = math.floor(value)
    return float(floor + 1) if value - floor >= 0.5 else float(floor)


def js_round_digits(value: float | None, digits: int, *, no_negative_zero: bool) -> float | None:
    """``Math.round(value * 10**digits) / 10**digits`` or None for non-finite.

    ``no_negative_zero`` mirrors squatAssessment.js, which maps -0 to 0;
    captureQuality.js does not (the two helpers differ in M6 and both are
    reproduced). JSON cannot express -0 anyway.
    """
    if value is None or isinstance(value, bool) or not math.isfinite(value):
        return None
    f = 10.0**digits
    r = js_round(value * f) / f
    if no_negative_zero and r == 0:
        return 0.0
    return r
