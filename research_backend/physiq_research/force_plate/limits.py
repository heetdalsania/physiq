"""Bounds on untrusted force-plate inputs (``RESEARCH_FORCE_*``).

The force-plate CSV, the manifest, estimates and study definitions are
untrusted files. Each is read at most once, into memory, with a hard byte
bound; the CSV additionally has sample-count, span and field-length bounds.

The defaults are research-prototype values sized well above a typical
trial: a ≤ 30 s squat trial at 1000 Hz is ~30,000 samples and ~0.5–1 MB of
CSV. Changing a limit never changes a stored value; it only changes which
inputs are accepted. The limits in force are recorded in each trial's
provenance (like M7's ``media_limits``) but are not part of the trial key.
"""

from __future__ import annotations

import math
import os
from dataclasses import dataclass
from typing import Any

from physiq_research.force_plate.errors import ForcePlateError

MIB = 1024 * 1024


@dataclass(frozen=True)
class ForcePlateLimits:
    max_source_bytes: int = 32 * MIB  # ≈ 600,000 rows of ~50 bytes
    max_samples: int = 600_000  # 120 s at 5 kHz
    max_duration_s: float = 120.0  # span of one recording: last − first timestamp
    max_time_s: float = 86_400.0  # any timestamp (float64 resolution stays < 2e-11 s)
    max_field_chars: int = 64  # one CSV value; a double needs ≤ 24 characters
    max_manifest_bytes: int = 64 * 1024
    max_estimate_bytes: int = 16 * MIB
    max_estimate_samples: int = 100_000
    max_study_definition_bytes: int = 1 * MIB
    max_study_trials: int = 10_000

    def as_dict(self) -> dict[str, Any]:
        return {
            "max_source_bytes": self.max_source_bytes,
            "max_samples": self.max_samples,
            "max_duration_s": self.max_duration_s,
            "max_time_s": self.max_time_s,
            "max_field_chars": self.max_field_chars,
            "max_manifest_bytes": self.max_manifest_bytes,
            "max_estimate_bytes": self.max_estimate_bytes,
            "max_estimate_samples": self.max_estimate_samples,
            "max_study_definition_bytes": self.max_study_definition_bytes,
            "max_study_trials": self.max_study_trials,
        }


_INT_SETTINGS = {
    "RESEARCH_FORCE_MAX_SOURCE_BYTES": "max_source_bytes",
    "RESEARCH_FORCE_MAX_SAMPLES": "max_samples",
    "RESEARCH_FORCE_MAX_ESTIMATE_SAMPLES": "max_estimate_samples",
}
_FLOAT_SETTINGS = {"RESEARCH_FORCE_MAX_DURATION_S": "max_duration_s"}


def limits_from_env(env: dict[str, str] | None = None) -> ForcePlateLimits:
    e = dict(os.environ if env is None else env)
    values: dict[str, Any] = {}
    for name, attr in _INT_SETTINGS.items():
        if name in e:
            try:
                n = int(e[name])
            except ValueError:
                raise ForcePlateError("invalid_configuration", field=name) from None
            if n < 2:
                raise ForcePlateError("invalid_configuration", field=name)
            values[attr] = n
    for name, attr in _FLOAT_SETTINGS.items():
        if name in e:
            try:
                x = float(e[name])
            except ValueError:
                raise ForcePlateError("invalid_configuration", field=name) from None
            if not math.isfinite(x) or x <= 0:
                raise ForcePlateError("invalid_configuration", field=name)
            values[attr] = x
    return ForcePlateLimits(**values)
