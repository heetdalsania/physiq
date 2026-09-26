"""Minimal PoseLandmarker loop for comparing mediapipe builds under the network monitor.

Independent of physiq_research (whose provider refuses any runtime other
than the pinned 0.10.31) so the SAME workload can be run with a rejected
build, e.g. mediapipe 0.10.35, inside a network-denying sandbox:

    sandbox-exec -f tools/netmon/deny-network.sb env NETMON_LOG=… DYLD_INSERT_LIBRARIES=…/netmon.dylib \
        python tools/netmon/pose_loop.py --model ../vendor/mediapipe/pose_landmarker_full.task --seconds 180

The sandbox blocks every network operation, so a build that tries to phone
home is observed (its attempts are logged) without anything leaving the
machine. Prints a JSON summary.
"""

from __future__ import annotations

import argparse
import importlib.metadata
import json
import time

import numpy as np


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--model", required=True)
    ap.add_argument("--seconds", type=float, default=60)
    args = ap.parse_args()
    import mediapipe as mp
    from mediapipe.tasks.python import vision
    from mediapipe.tasks.python.core import base_options

    model = open(args.model, "rb").read()  # noqa: SIM115
    rng = np.random.default_rng(0)
    frame = rng.integers(0, 255, (480, 640, 3), dtype=np.uint8)
    started = time.monotonic()
    frames = sessions = 0
    while time.monotonic() - started < args.seconds:
        opts = vision.PoseLandmarkerOptions(
            base_options=base_options.BaseOptions(model_asset_buffer=model),
            running_mode=vision.RunningMode.VIDEO,
            num_poses=2,
        )
        with vision.PoseLandmarker.create_from_options(opts) as lm:
            sessions += 1
            for i in range(150):
                lm.detect_for_video(mp.Image(image_format=mp.ImageFormat.SRGB, data=frame), i * 66)
                frames += 1
    print(
        json.dumps(
            {
                "mediapipe": importlib.metadata.version("mediapipe"),
                "sessions": sessions,
                "frames": frames,
                "seconds": round(time.monotonic() - started, 1),
            }
        )
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
