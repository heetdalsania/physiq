"""Real pose-runtime smoke run (runtime integration evidence, NOT validation).

Runs the production worker with the REAL MediaPipe provider and model on
controlled, hash-pinned, non-user media, repeatedly, for ``--seconds``
seconds of wall time, against a throw-away SQLite database. Used by
tests/test_real_pose.py under the macOS network monitor (tools/netmon) and
by the Docker smoke. Prints a JSON report.

    python tools/real_pose_smoke.py --seconds 180 --fixtures .local/fixtures
"""

from __future__ import annotations

import argparse
import json
import resource
import socket
import sys
import tempfile
import time
from pathlib import Path

HERE = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(HERE))


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--seconds", type=float, default=60)
    parser.add_argument(
        "--positive-control", action="store_true", help="finish with one deliberate loopback connection"
    )
    args = parser.parse_args()

    import numpy as np

    from physiq_research.config import Settings
    from physiq_research.pose.mediapipe_provider import MediaPipePoseProvider
    from physiq_research.storage.db import make_engine, upgrade
    from physiq_research.storage.repository import ResearchRepository
    from physiq_research.workers.worker import Worker
    from tests.support.jobs import enqueue_file
    from tests.support.real_fixtures import pose_image
    from tests.support.videos import write_blank_video, write_image_video

    work = Path(tempfile.mkdtemp(prefix="physiq-real-smoke-"))
    image = pose_image()  # verified, cached (fetched before the monitored run)
    videos = {
        "person_upright": write_image_video(work / "person.mp4", image, fps=15, duration_ms=3000),
        "person_rotation_metadata": write_image_video(
            work / "person_rot.mp4", image, fps=15, duration_ms=3000, rotation=90
        ),
        "no_person": write_blank_video(work / "blank.mp4", size=(640, 480), fps=15, duration_ms=3000),
        "two_people": write_image_video(
            work / "two.mp4", np.concatenate([image[:, 150:850], image[:, 150:850]], axis=1), fps=15, duration_ms=2000
        ),
    }
    settings = Settings(database_url=f"sqlite+pysqlite:///{work / 'smoke.db'}", upload_dir=work / "uploads")
    upgrade(settings.database_url)
    repo = ResearchRepository(make_engine(settings.database_url))

    t0 = time.perf_counter()
    provider = MediaPipePoseProvider(settings.pose_model_path)
    init_s = time.perf_counter() - t0
    worker = Worker(settings, repo, provider)
    results: list[dict[str, object]] = []
    started = time.monotonic()
    rounds = 0
    peak_rss_by_round: list[float] = []
    rss_div = 1024 * 1024 if sys.platform == "darwin" else 1024
    while True:
        for name, path in videos.items():
            job = enqueue_file(settings, repo, path, subject=None)
            t = time.perf_counter()
            out = worker.process_next()
            assert out is not None and out.job_id == job.id
            results.append(
                {
                    "video": name,
                    "status": out.status,
                    "failure_code": out.failure_code,
                    "failure_detail": out.failure_detail,
                    "upload_deleted": out.upload_deleted,
                    "seconds": round(time.perf_counter() - t, 3),
                    "pose_inference_s": round((out.timings or {}).get("pose_inference_s", 0.0), 3),
                    "sampled_frames": (repo.get_job(job.id).failure_diagnostics or {}).get("sampled_frames"),  # type: ignore[union-attr]
                }
            )
            repo.delete_job(job.id)
        rounds += 1
        peak_rss_by_round.append(round(resource.getrusage(resource.RUSAGE_SELF).ru_maxrss / rss_div, 1))
        if time.monotonic() - started >= args.seconds:
            break

    control = None
    if args.positive_control:
        srv = socket.socket()
        srv.bind(("127.0.0.1", 0))
        srv.listen(1)
        cli = socket.socket()
        cli.connect(srv.getsockname())
        control = srv.getsockname()[1]
        cli.close()
        srv.close()

    report = {
        "runtime": provider.identity,
        "provider_init_s": round(init_s, 3),
        "sessions_opened": getattr(provider, "sessions_opened", None),
        "rounds": rounds,
        "wall_seconds": round(time.monotonic() - started, 1),
        "results": results,
        "leftover_uploads": sorted(p.name for p in (work / "uploads").iterdir()),
        "max_rss_mb": round(resource.getrusage(resource.RUSAGE_SELF).ru_maxrss / rss_div, 1),
        "peak_rss_mb_by_round": peak_rss_by_round,
        "positive_control_port": control,
    }
    print(json.dumps(report))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
