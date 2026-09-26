"""Performance and data-size sanity measurement (not a benchmark).

(a) REAL provider: a 1080×1920 portrait, 30 fps, 8 s H.264 video of the
    pinned MediaPipe test image (the job ends at calibration — frontal pose —
    so this measures decode + inference cost, not a successful record).
(b) Success path with the dot test double on a 1080×1920, 30 fps, 7 s squat,
    to measure the size of every persisted derived artifact.
Prints JSON. Run from research_backend/ with the venv active:
    python tools/measure_performance.py --generate /tmp/perf && python tools/measure_performance.py /tmp/perf
"""

from __future__ import annotations

import json
import resource
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))


def main() -> int:
    if "--generate" in sys.argv:
        return generate(Path(sys.argv[-1]))
    return measure(Path(sys.argv[-1]))


def generate(work: Path) -> int:
    import numpy as np

    from tests.support.real_fixtures import pose_image
    from tests.support.videos import write_dot_squat_video, write_image_video

    work.mkdir(parents=True, exist_ok=True)
    canvas = np.zeros((1920, 1080, 3), dtype=np.uint8)
    img = pose_image()[:, :1000]
    canvas[600 : 600 + img.shape[0], 40 : 40 + img.shape[1]] = img
    write_image_video(work / "real_1080p.mp4", canvas, fps=30, duration_ms=8000, options={"crf": "23"})
    write_dot_squat_video(work / "dot_1080p.mp4", size=(1080, 1920), fps=30, duration_ms=7000)
    return 0


def measure(work: Path) -> int:

    from physiq_research.canonical import canonical_bytes
    from physiq_research.config import Settings
    from physiq_research.media.decoder import VideoDecoder
    from physiq_research.media.sampling import sample_frames
    from physiq_research.pose.mediapipe_provider import MediaPipePoseProvider
    from physiq_research.storage.db import make_engine, upgrade
    from physiq_research.storage.repository import ResearchRepository
    from physiq_research.workers.worker import Worker
    from tests.support.jobs import enqueue_file
    from tests.support.providers import DotPoseProvider

    settings = Settings(
        database_url=f"sqlite+pysqlite:///{work / f'perf-{time.time_ns()}.db'}", upload_dir=work / "uploads"
    )
    upgrade(settings.database_url)
    repo = ResearchRepository(make_engine(settings.database_url))
    out: dict[str, object] = {}

    # (a) real provider, 1080p portrait
    rss_div = 1024 * 1024 if sys.platform == "darwin" else 1024
    rss_start = resource.getrusage(resource.RUSAGE_SELF).ru_maxrss / rss_div
    video = work / "real_1080p.mp4"
    t = time.perf_counter()
    decoded = sampled = 0
    with VideoDecoder(video, settings.limits) as dec:
        dec.probe()
        for f in sample_frames(dec.frames()):
            dec.to_rgb(f)
            sampled += 1
        decoded = dec.technical.stats.decoded_frames  # type: ignore[union-attr]
    decode_s = time.perf_counter() - t
    t = time.perf_counter()
    provider = MediaPipePoseProvider(settings.pose_model_path)
    init_s = time.perf_counter() - t
    worker = Worker(settings, repo, provider)
    enqueue_file(settings, repo, video)
    t = time.perf_counter()
    res = worker.process_next()
    total_s = time.perf_counter() - t
    assert res is not None
    out["real_provider_1080p"] = {
        "input_bytes": video.stat().st_size,
        "peak_temporary_disk_bytes": video.stat().st_size,  # the single upload copy
        "duration_s": 8,
        "decoded_frames": decoded,
        "sampled_frames": sampled,
        "decode_sample_convert_s": round(decode_s, 3),
        "provider_init_s": round(init_s, 3),
        "pose_session_init_s": round((res.timings or {}).get("pose_init_s", 0), 3),
        "pose_inference_s": round((res.timings or {}).get("pose_inference_s", 0), 3),
        "pose_ms_per_frame": round(1000 * (res.timings or {}).get("pose_inference_s", 0) / max(sampled, 1), 1),
        "total_job_s": round(total_s, 3),
        "outcome": [res.status, res.failure_code, res.failure_detail],
        "upload_deleted": res.upload_deleted,
    }

    # (b) success path, derived data sizes
    squat = work / "dot_1080p.mp4"
    enqueue_file(settings, repo, squat)
    ok = Worker(settings, repo, DotPoseProvider()).process_next()
    assert ok is not None and ok.status == "succeeded", ok
    stored = repo.get_assessment(ok.assessment_id)  # type: ignore[arg-type]
    assert stored is not None
    sizes = {kind: a.byte_size for kind, a in stored.artifacts.items()}
    out["derived_record_sizes_bytes"] = {
        "input_video_bytes": squat.stat().st_size,
        **sizes,
        "summary": len(canonical_bytes(stored.summary)),
        "provenance": len(canonical_bytes(stored.provenance)),
        "total_persisted_json": sum(sizes.values())
        + len(canonical_bytes(stored.summary))
        + len(canonical_bytes(stored.provenance)),
        "sampled_frames": stored.summary["frame_statistics"]["sampled_frames"],
    }
    out["peak_rss_mb_at_start"] = round(rss_start, 1)
    out["peak_rss_mb"] = round(resource.getrusage(resource.RUSAGE_SELF).ru_maxrss / rss_div, 1)
    out["model_reads"] = 1
    print(json.dumps(out, indent=1))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
