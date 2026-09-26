"""SYNTHETIC TEST FIXTURE — NOT HUMAN DATA — NOT VALIDATION EVIDENCE.

Deterministic, closed-form vertical-force signals, canonical CSV bytes and
import manifests for SOFTWARE tests of the Milestone 8 force-plate layer
(parsing, synchronization, interpolation, metrics, storage, deletion, error
handling). They are generated from a formula, not measured; no person, force
plate or recording is involved, and nothing computed from them says anything
about the accuracy of any estimator. Every manifest built here declares
``data_origin: synthetic_test_fixture``, so every report derived from it
carries the synthetic-fixture banner.

Clock model of the fixtures: force acquisition starts ``lead_ms`` before the
first video frame and may run at a slightly different rate,

    t_media_ms = offset_ms + rate × t_force_ms,   offset_ms = −lead_ms·rate

The force follows the dot-squat timing of tests/support/synthetic_pose.py
(descent 3000→4200 ms, pause, ascent 4600→5800 ms of media time): body
weight plus m·a(t) for a cosine centre-of-mass displacement of ``depth_m``.
"""

from __future__ import annotations

import hashlib
import json
import math
import uuid
from collections.abc import Callable, Sequence
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import numpy as np

from physiq_research.config import Settings
from physiq_research.storage.repository import ResearchRepository, StoredAssessment
from physiq_research.workers.worker import Worker
from tests.support.jobs import enqueue_file
from tests.support.providers import DotPoseProvider
from tests.support.synthetic_pose import DEFAULT_SQUAT

BANNER = "SYNTHETIC TEST FIXTURE — NOT HUMAN DATA — NOT VALIDATION EVIDENCE"
G = 9.80665
BODY_MASS_KG = 70.0


def synthetic_vertical_grf_n(
    t_media_ms: np.ndarray, *, body_mass_kg: float = BODY_MASS_KG, depth_m: float = 0.30
) -> np.ndarray:
    """SYNTHETIC: m·(g + a(t)), a from a cosine displacement profile per phase."""
    t = np.asarray(t_media_ms, dtype=np.float64)
    a = np.zeros_like(t)
    s = DEFAULT_SQUAT
    for start, end, sign in ((s["descentAt"], s["bottomAt"], 1.0), (s["riseAt"], s["standAt"], -1.0)):
        dur = (end - start) / 1000.0
        inside = (t >= start) & (t <= end)
        u = (t[inside] - start) / (end - start)
        # descending: y = −D(1 − cos πu)/2 → a = −D π²/(2T²) cos πu (and the mirror on ascent)
        a[inside] = -sign * depth_m * math.pi**2 / (2 * dur**2) * np.cos(math.pi * u)
    return body_mass_kg * (G + a)


def csv_bytes(
    time_s: Sequence[float],
    force_n: Sequence[float],
    *,
    header: str = "time_s,vertical_force_n",
    newline: str = "\n",
) -> bytes:
    lines = [header] + [f"{t!r},{f!r}" for t, f in zip(time_s, force_n, strict=True)]
    return (newline.join(lines) + newline).encode("utf-8")


def sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


@dataclass
class ForceFixture:
    """SYNTHETIC TEST FIXTURE — NOT HUMAN DATA — NOT VALIDATION EVIDENCE."""

    csv: bytes
    manifest: dict[str, Any]
    time_s: np.ndarray
    force_n: np.ndarray  # positive UP (before any declared sign flip)
    offset_ms: float
    rate: float
    notes: list[str] = field(default_factory=lambda: [BANNER])

    def manifest_bytes(self) -> bytes:
        return json.dumps(self.manifest).encode("utf-8")

    def write(
        self, directory: Path, *, csv_name: str = "force.csv", manifest_name: str = "manifest.json"
    ) -> tuple[Path, Path]:
        directory.mkdir(parents=True, exist_ok=True)
        c, m = directory / csv_name, directory / manifest_name
        c.write_bytes(self.csv)
        m.write_bytes(self.manifest_bytes())
        return m, c


def make_fixture(
    assessment_id: uuid.UUID,
    *,
    subject: uuid.UUID | None = None,
    lead_ms: float = 1500.0,
    rate: float = 1.0,
    sample_rate_hz: float = 1000.0,
    duration_s: float = 10.0,
    positive_direction: str = "up",
    method: str = "one_anchor_offset",
    anchor_force_ms: Sequence[float] = (2500.0, 7500.0),
    body_mass_kg: float = BODY_MASS_KG,
    force_fn: Callable[[np.ndarray], np.ndarray] | None = None,
    data_origin: str = "synthetic_test_fixture",
) -> ForceFixture:
    """SYNTHETIC force export + manifest for an existing M7 assessment id."""
    n = round(duration_s * sample_rate_hz) + 1
    time_s = np.arange(n, dtype=np.float64) / sample_rate_hz
    offset = -lead_ms * rate
    t_media = offset + rate * (time_s * 1000.0)
    force_up = (
        force_fn(t_media) if force_fn is not None else synthetic_vertical_grf_n(t_media, body_mass_kg=body_mass_kg)
    )
    column = force_up if positive_direction == "up" else -force_up
    data = csv_bytes(time_s.tolist(), column.tolist())
    count = 1 if method == "one_anchor_offset" else 2
    anchors = [
        {"event": "plate_impact", "video_time_ms": offset + rate * f, "force_time_ms": f}
        for f in list(anchor_force_ms)[:count]
    ]
    manifest = {
        "contract": "force-plate-manifest-v0.1",
        "data_origin": data_origin,
        "assessment_id": str(assessment_id),
        "research_subject_id": str(subject) if subject else None,
        "movement_type": "bodyweight_squat_sagittal",
        "capture_mode": "single_camera_sagittal",
        "plate_configuration": "single_plate_both_feet",
        "body_mass_kg": body_mass_kg,
        "source": {
            "format": "force-plate-csv-v0.1",
            "sha256": sha256(data),
            "quantity": "measured_total_vertical_ground_reaction_force",
            "time_reference": "seconds_since_force_acquisition_start",
            "time_unit": "s",
            "force_unit": "N",
            "vertical_force_positive_direction": positive_direction,
        },
        "synchronization": {"method": method, "anchors": anchors},
    }
    return ForceFixture(csv=data, manifest=manifest, time_s=time_s, force_n=force_up, offset_ms=offset, rate=rate)


def with_csv(fixture: ForceFixture, data: bytes) -> tuple[bytes, bytes]:
    """(manifest bytes, csv bytes) with the manifest digest updated to ``data``."""
    manifest = json.loads(json.dumps(fixture.manifest))
    manifest["source"]["sha256"] = sha256(data)
    return json.dumps(manifest).encode("utf-8"), data


def process_assessment(
    settings: Settings, repo: ResearchRepository, video: Path, *, subject: uuid.UUID | None = None
) -> StoredAssessment:
    """Run the REAL M7 worker (dot pose double) on a generated squat video."""
    enqueue_file(settings, repo, video, subject=subject)
    outcome = Worker(settings, repo, DotPoseProvider()).process_next()
    assert outcome is not None and outcome.status == "succeeded", outcome
    stored = repo.get_assessment(outcome.assessment_id)  # type: ignore[arg-type]
    assert stored is not None
    return stored


def null_baseline_estimate(
    assessment: StoredAssessment,
    *,
    body_mass_kg: float = BODY_MASS_KG,
    name: str = "test-null-baseline",
    version: str = "0.0.0-test",
    development_subjects: Sequence[uuid.UUID] = (),
    values: Callable[[np.ndarray], np.ndarray] | None = None,
    times_ms: Sequence[float] | None = None,
) -> dict[str, Any]:
    """TEST / NULL BASELINE — NOT AN ESTIMATOR.

    Predicts a constant body weight (or ``values(t)`` for tests with a known
    answer) at the assessment's sampled frame times. It exists only to drive
    the evaluator in software tests and is never a scientific claim.
    """
    if times_ms is None:
        frames = assessment.artifacts["pose_series"].data["frames"]  # type: ignore[index]
        times_ms = [f["t_ms"] for f in frames]
    t = np.asarray(times_ms, dtype=np.float64)
    f = values(t) if values is not None else np.full_like(t, body_mass_kg * G)
    return {
        "contract": "vertical-grf-estimate-v0.1",
        "quantity": "estimated_total_vertical_ground_reaction_force",
        "unit": "N",
        "time_axis": "media_ms_since_first_decoded_frame",
        "assessment_id": str(assessment.id),
        "assessment_record_sha256": assessment.record_sha256,
        "estimator": {
            "name": name,
            "version": version,
            "parameters_sha256": None,
            "development_research_subject_ids": [str(s) for s in development_subjects],
        },
        "t_media_ms": t.tolist(),
        "vertical_grf_n": f.tolist(),
    }
