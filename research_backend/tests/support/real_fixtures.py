"""Hash-pinned MediaPipe test image for real-runtime smoke tests.

The same controlled input Milestone 6 used: MediaPipe's own published
PoseLandmarker test image and its expected landmarks. Downloaded once into
research_backend/.local/fixtures (git-ignored), verified by SHA-256, never
committed, never bundled. This is runtime-integration evidence only — one
still image says nothing about angle accuracy.
"""

from __future__ import annotations

import hashlib
import re
import urllib.request
from pathlib import Path

import av
import numpy as np

CACHE = Path(__file__).resolve().parents[2] / ".local" / "fixtures"
POSE_IMAGE = {
    "name": "pose.jpg",
    "url": "https://storage.googleapis.com/mediapipe-assets/pose.jpg",
    "sha256": "c8a830ed683c0276d713dd5aeda28f415f10cd6291972084a40d0d8b934ed62b",
}
POSE_EXPECTED = {
    "name": "pose_landmarks.pbtxt",
    "url": "https://storage.googleapis.com/mediapipe-assets/pose_landmarks.pbtxt",
    "sha256": "69c79cdf3964d7819776eab1172e47e70684139d72a6d7edcbdd62dbb2ca5527",
}


def _fetch(spec: dict[str, str], cache: Path = CACHE) -> Path:
    cache.mkdir(parents=True, exist_ok=True)
    path = cache / spec["name"]
    if not path.exists():
        with urllib.request.urlopen(spec["url"], timeout=30) as resp:
            path.write_bytes(resp.read())
    digest = hashlib.sha256(path.read_bytes()).hexdigest()
    if digest != spec["sha256"]:
        path.unlink()
        raise RuntimeError(f"{spec['name']}: SHA-256 mismatch")
    return path


def pose_image() -> np.ndarray:
    with av.open(str(_fetch(POSE_IMAGE))) as c:
        frame = next(c.decode(video=0))
        return frame.to_ndarray(format="rgb24")


def expected_landmarks() -> list[tuple[float, float, float]]:
    text = _fetch(POSE_EXPECTED).read_text()
    found = re.findall(r"landmark \{\s*x: ([-\d.e]+)\s*y: ([-\d.e]+)\s*z: [-\d.e]+\s*visibility: ([-\d.e]+)", text)
    return [(float(x), float(y), float(v)) for x, y, v in found]
