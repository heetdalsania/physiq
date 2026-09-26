"""Milestone 8 size and timing sanity measurement (not a benchmark).

SYNTHETIC TEST FIXTURE — NOT HUMAN DATA — NOT VALIDATION EVIDENCE: the force
signals are generated from a formula and the "estimate" is the TEST / NULL
BASELINE (constant body weight). Only sizes and timings are meaningful here.

For each case (sampling rate × recording length) it measures the CSV size,
the import stages (parse, synchronize, ground truth, database save), the
verified read, one evaluation, the stored JSON sizes and peak RSS.

    python tools/measure_force_plate_performance.py /tmp/m8perf [DATABASE_URL] [--case RATE_HZ:SECONDS ...]

Without DATABASE_URL a fresh SQLite database in the work directory is used.
``--case`` restricts the run (e.g. ``--case 1000:30`` for a typical trial's
peak RSS in a fresh process); peak RSS is cumulative over the cases run.
"""

from __future__ import annotations

import json
import resource
import sys
import time
import uuid
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

CASES = (  # (sample rate Hz, recording length s)
    (1000.0, 30.0),
    (2000.0, 30.0),
    (5000.0, 119.9),  # the default bound: 600,000 samples
)


def main() -> int:
    args = sys.argv[1:]
    cases = [
        (float(v.split(":")[0]), float(v.split(":")[1])) for i, v in enumerate(args) if i and args[i - 1] == "--case"
    ]
    positional = [v for i, v in enumerate(args) if v != "--case" and not (i and args[i - 1] == "--case")]
    work = Path(positional[0])
    work.mkdir(parents=True, exist_ok=True)
    url = positional[1] if len(positional) > 1 else f"sqlite+pysqlite:///{work / f'm8-{time.time_ns()}.db'}"

    from physiq_research.canonical import canonical_bytes
    from physiq_research.config import Settings
    from physiq_research.force_plate.comparison import compare_estimate
    from physiq_research.force_plate.importer import import_trial
    from physiq_research.force_plate.limits import ForcePlateLimits
    from physiq_research.force_plate.repository import ForcePlateRepository
    from physiq_research.storage.db import make_engine, upgrade
    from physiq_research.storage.repository import ResearchRepository
    from tests.support.force_fixtures import make_fixture, null_baseline_estimate, process_assessment
    from tests.support.videos import write_dot_squat_video

    settings = Settings(database_url=url, upload_dir=work / "uploads")
    upgrade(url)
    engine = make_engine(url)
    repo = ResearchRepository(engine)
    video = write_dot_squat_video(work / "squat.mp4")
    rss_div = 1024 * 1024 if sys.platform == "darwin" else 1024
    out: dict[str, object] = {
        "banner": "SYNTHETIC TEST FIXTURE — NOT HUMAN DATA — NOT VALIDATION EVIDENCE",
        "database": engine.dialect.name,
        "peak_rss_mb_at_start": round(resource.getrusage(resource.RUSAGE_SELF).ru_maxrss / rss_div, 1),
        "cases": [],
    }
    for rate_hz, seconds in cases or CASES:
        subject = uuid.uuid4()
        assessment = process_assessment(settings, repo, video, subject=subject)
        fx = make_fixture(assessment.id, subject=subject, sample_rate_hz=rate_hz, duration_s=seconds)
        t = time.perf_counter()
        outcome = import_trial(engine, fx.manifest_bytes(), fx.csv, ForcePlateLimits())
        import_s = time.perf_counter() - t
        m8 = ForcePlateRepository(engine)
        t = time.perf_counter()
        trial = m8.get_trial(outcome.trial_id)
        read_s = time.perf_counter() - t
        assert trial is not None
        estimate = json.dumps(null_baseline_estimate(assessment)).encode()
        t = time.perf_counter()
        compare_estimate(engine, outcome.trial_id, estimate, ForcePlateLimits())
        evaluate_s = time.perf_counter() - t
        sizes = {kind: a.byte_size for kind, a in trial.artifacts.items()}
        stored = sum(sizes.values()) + len(canonical_bytes(trial.summary)) + len(canonical_bytes(trial.provenance))
        rows = out["cases"]
        assert isinstance(rows, list)
        rows.append(
            {
                "sample_rate_hz": rate_hz,
                "recording_s": seconds,
                "samples": trial.summary["signal"]["sample_count"],
                "ground_truth_samples": len(trial.artifacts["ground_truth"].data["t_media_ms"]),  # type: ignore[index]
                "csv_bytes": len(fx.csv),
                "import_total_s": round(import_s, 3),
                "import_stages_s": {k: round(v, 3) for k, v in outcome.timings_s.items()},
                "verified_read_s": round(read_s, 3),
                "evaluate_s": round(evaluate_s, 3),
                "stored_bytes": {
                    **sizes,
                    "summary": len(canonical_bytes(trial.summary)),
                    "provenance": len(canonical_bytes(trial.provenance)),
                    "total": stored,
                },
            }
        )
    out["peak_rss_mb"] = round(resource.getrusage(resource.RUSAGE_SELF).ru_maxrss / rss_div, 1)
    engine.dispose()
    print(json.dumps(out, indent=1))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
