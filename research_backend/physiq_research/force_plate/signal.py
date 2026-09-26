"""Canonical measured force signal (``force-plate-signal-v0.1``) and its
strict CSV parser (``force-plate-csv-parser-v0.2``).

Accepted file (``force-plate-csv-v0.1``)
    * UTF-8, no byte-order mark; LF or CRLF line endings; comma-separated;
      no quoting (a quote character is simply not part of any number);
    * the FIRST line is the header with exactly the two columns ``time_s``
      and ``vertical_force_n`` (either order, each exactly once, nothing
      else — no fuzzy matching, no trimming, no preamble);
    * then one row per sample, one value per column, no blank lines;
    * every value is a decimal number in JSON number grammar
      (``-?(0|[1-9]\\d*)(\\.\\d+)?([eE][+-]?\\d+)?``): no ``NaN``/``inf``,
      no thousands separators, no whitespace, no locale commas;
    * ``time_s``: seconds since force acquisition start, ≥ 0, STRICTLY
      increasing (duplicates and backward steps are rejected, never merged,
      dropped or re-sorted);
    * ``vertical_force_n``: MEASURED total vertical ground-reaction force of
      one plate with both feet on it, in newtons, with the positive direction
      declared in the manifest.

Canonical signal
    time_s          as recorded (no re-referencing, no resampling)
    vertical_grf_n  newtons, positive UP: the declared ``down`` convention is
                    multiplied by −1 (an exact IEEE operation); ``up`` is
                    kept as is. Nothing else is changed: no filtering, no
                    offset/zero correction, no gap filling.

Any scientifically meaningful defect is a rejection with a stable code and
the 1-based line number — never a silent repair.
"""

from __future__ import annotations

import csv
import io
import math
import re
from array import array
from dataclasses import dataclass
from typing import Any, Final, Literal

import numpy as np

from physiq_research.force_plate.errors import ForcePlateError
from physiq_research.force_plate.inputs import decode_utf8
from physiq_research.force_plate.limits import ForcePlateLimits

TIME_COLUMN: Final = "time_s"
FORCE_COLUMN: Final = "vertical_force_n"
COLUMNS: Final = (TIME_COLUMN, FORCE_COLUMN)
NUMBER: Final = re.compile(r"-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?")
_NON_FINITE_WORDS: Final = frozenset(
    w + v for w in ("", "+", "-") for v in ("nan", "inf", "infinity", "snan", "qnan", "1.#inf", "1.#ind")
)

PARSER_PARAMETERS: Final[dict[str, Any]] = {
    "encoding": "utf-8 (strict, no byte-order mark)",
    "delimiter": ",",
    "header": list(COLUMNS),
    "column_order": "either",
    "quoting": "none",
    "extra_columns": "rejected",
    "number_grammar": "json_number",
    "timestamps": "strictly_increasing_non_negative_seconds",
    "repairs": "none",
}


@dataclass(frozen=True)
class MeasuredForceSignal:
    """Measured vertical GRF in force acquisition time (read-only arrays)."""

    time_s: np.ndarray
    vertical_grf_n: np.ndarray  # positive up, newtons
    source_positive_direction: Literal["up", "down"]

    @property
    def sign_multiplier(self) -> int:
        return 1 if self.source_positive_direction == "up" else -1

    @property
    def sample_count(self) -> int:
        return int(self.time_s.shape[0])

    def sampling(self) -> dict[str, Any]:
        """Observed sampling statistics (never a declared nominal rate)."""
        intervals = np.diff(self.time_s)
        span = float(self.time_s[-1] - self.time_s[0])
        return {
            "sample_count": self.sample_count,
            "first_time_s": float(self.time_s[0]),
            "last_time_s": float(self.time_s[-1]),
            "span_s": span,
            "min_interval_s": float(intervals.min()),
            "median_interval_s": float(np.median(intervals)),
            "max_interval_s": float(intervals.max()),
            "mean_rate_hz": (self.sample_count - 1) / span,
        }


def _readonly(values: array[float]) -> np.ndarray:
    out = np.frombuffer(values, dtype=np.float64).copy()
    out.flags.writeable = False
    return out


def _number(text: str, column: str, line: int, limits: ForcePlateLimits) -> float:
    if text == "":
        raise ForcePlateError("missing_value", field=column, line=line)
    if len(text) > limits.max_field_chars:
        raise ForcePlateError("field_too_long", field=column, line=line)
    if text.lower() in _NON_FINITE_WORDS:
        raise ForcePlateError("non_finite_value", field=column, line=line)
    if not NUMBER.fullmatch(text):
        raise ForcePlateError("non_numeric_value", field=column, line=line)
    value = float(text)
    if not math.isfinite(value):  # e.g. 1e999
        raise ForcePlateError("non_finite_value", field=column, line=line)
    return value


def _bare_carriage_return(text: str) -> int | None:
    """1-based line of the first CR not followed by LF, if any."""
    at = text.find("\r")
    while at != -1:
        if not text.startswith("\n", at + 1):
            return text.count("\n", 0, at) + 1
        at = text.find("\r", at + 1)
    return None


def _header(row: list[str]) -> tuple[int, int]:
    seen: set[str] = set()
    for name in row:
        if name in seen:
            raise ForcePlateError("duplicate_column", field=name if name in COLUMNS else None, line=1)
        seen.add(name)
    for name in COLUMNS:
        if name not in seen:
            raise ForcePlateError("missing_column", field=name, line=1)
    if len(row) != len(COLUMNS):
        raise ForcePlateError("unexpected_column", line=1)
    return row.index(TIME_COLUMN), row.index(FORCE_COLUMN)


def parse_force_csv(
    data: bytes, *, positive_direction: Literal["up", "down"], limits: ForcePlateLimits
) -> MeasuredForceSignal:
    """Strictly parse canonical CSV bytes into the canonical measured signal."""
    if not data:
        raise ForcePlateError("empty_file", field="force_csv")
    if len(data) > limits.max_source_bytes:
        raise ForcePlateError("source_too_large", field="force_csv")
    text = decode_utf8(data, field="force_csv")
    bare_cr = _bare_carriage_return(text)
    if bare_cr is not None:  # only LF or CRLF line endings; a lone CR is not a line break here
        raise ForcePlateError("malformed_csv", line=bare_cr)
    reader = csv.reader(io.StringIO(text, newline=""), quoting=csv.QUOTE_NONE, strict=True)
    try:
        header = next(reader, None)
    except csv.Error:
        raise ForcePlateError("malformed_csv", line=1) from None
    if header is None:
        raise ForcePlateError("empty_file", field="force_csv")
    time_idx, force_idx = _header(header)

    times: array[float] = array("d")
    forces: array[float] = array("d")
    previous: float | None = None
    sign = 1.0 if positive_direction == "up" else -1.0
    while True:
        try:
            row = next(reader)
        except StopIteration:
            break
        except csv.Error:
            raise ForcePlateError("malformed_csv", line=reader.line_num) from None
        line = reader.line_num
        if len(row) != len(COLUMNS):
            raise ForcePlateError("malformed_row", line=line)
        if len(times) >= limits.max_samples:
            raise ForcePlateError("too_many_samples", line=line)
        t = _number(row[time_idx], TIME_COLUMN, line, limits)
        f = _number(row[force_idx], FORCE_COLUMN, line, limits)
        if t < 0:
            raise ForcePlateError("negative_time", field=TIME_COLUMN, line=line)
        if t > limits.max_time_s:
            raise ForcePlateError("time_out_of_range", field=TIME_COLUMN, line=line)
        if previous is not None:
            if t == previous:
                raise ForcePlateError("duplicate_timestamp", field=TIME_COLUMN, line=line)
            if t < previous:
                raise ForcePlateError("timestamp_not_increasing", field=TIME_COLUMN, line=line)
        previous = t
        times.append(t)
        forces.append(sign * f)
    if not times:
        raise ForcePlateError("empty_signal", field="force_csv")
    if len(times) < 2:
        raise ForcePlateError("too_few_samples", field="force_csv")
    if times[-1] - times[0] > limits.max_duration_s:
        raise ForcePlateError("duration_exceeded", field=TIME_COLUMN)
    if not math.isfinite((len(times) - 1) / (times[-1] - times[0])):
        raise ForcePlateError("non_finite_derived_value", field=TIME_COLUMN)
    return MeasuredForceSignal(
        time_s=_readonly(times), vertical_grf_n=_readonly(forces), source_positive_direction=positive_direction
    )
