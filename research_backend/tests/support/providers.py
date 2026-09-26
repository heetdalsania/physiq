"""Deterministic pose providers for tests (never used by the service).

DotPoseProvider  finds the grey-level landmark disks drawn by
                 tests/support/videos.py and returns MediaPipe-SHAPED output
                 for the camera-side (left) leg; the far (right) side is
                 reported 6 px behind with visibility 0.3, exactly like the
                 M6 synthetic fixture. A second-person marker yields two
                 poses. The image content decides everything, so a frame
                 analysed sideways gives sideways landmarks.
ScriptedPoseProvider
                 returns whatever a function of the timestamp says (M6
                 fixture scenarios), ignoring pixels.
Both implement the PoseProvider / PoseSession protocol and count sessions,
calls and closes so tests can prove lifecycle invariants.
"""

from __future__ import annotations

from collections.abc import Callable
from typing import Any

import numpy as np

from physiq_research.pose.base import PoseProviderError
from tests.support.synthetic_pose import IDX
from tests.support.videos import DOT_LEVELS, SECOND_PERSON_LEVEL

TOLERANCE = 6


def _identity(name: str) -> dict[str, Any]:
    return {
        "runtime": {"id": name, "package_version": "test", "task": "PoseLandmarker", "running_mode": "VIDEO"},
        "installed_runtime_version": "test",
        "native_library_sha256": None,
        "platform": {"system": "test", "machine": "test"},
        "model": {"id": "test_double", "version": "0", "sha256": "0" * 64},
        "model_verified": True,
    }


class _Session:
    def __init__(self, owner: Any) -> None:
        self.owner = owner
        self.closed = False
        self.last_ts: int | None = None
        self.calls: list[int] = []

    def detect(self, rgb: np.ndarray, timestamp_ms: int) -> dict[str, Any]:
        if self.closed:
            raise PoseProviderError("session_closed")
        if self.last_ts is not None and timestamp_ms <= self.last_ts:
            raise PoseProviderError("non_increasing_timestamp")
        self.last_ts = timestamp_ms
        self.calls.append(timestamp_ms)
        self.owner.detect_calls += 1
        if self.owner.fail_on_call is not None and self.owner.detect_calls >= self.owner.fail_on_call:
            raise PoseProviderError("inference_failed")
        self.owner.image_shapes.add(rgb.shape)
        return self.owner.infer(rgb, timestamp_ms)

    def close(self) -> None:
        if not self.closed:
            self.closed = True
            self.owner.sessions_closed += 1


class _Base:
    provider_id = "test-double"
    model_id = "test_double"

    def __init__(self) -> None:
        self.sessions_opened = 0
        self.sessions_closed = 0
        self.detect_calls = 0
        self.fail_on_call: int | None = None
        self.fail_open = False
        self.image_shapes: set[tuple[int, ...]] = set()
        self.sessions: list[_Session] = []

    @property
    def identity(self) -> dict[str, Any]:
        return _identity(self.provider_id)

    def open_session(self) -> _Session:
        if self.fail_open:
            raise PoseProviderError("runtime_init_failed")
        self.sessions_opened += 1
        s = _Session(self)
        self.sessions.append(s)
        return s

    def close(self) -> None:
        pass

    def infer(self, rgb: np.ndarray, timestamp_ms: int) -> dict[str, Any]:  # pragma: no cover - abstract
        raise NotImplementedError


class DotPoseProvider(_Base):
    provider_id = "test-dot-detector"

    def infer(self, rgb: np.ndarray, timestamp_ms: int) -> dict[str, Any]:
        h, w = rgb.shape[:2]
        grey = rgb[:, :, 0].astype(np.int16)
        found: dict[str, tuple[float, float]] = {}
        for part, level in DOT_LEVELS.items():
            ys, xs = np.nonzero(np.abs(grey - level) <= TOLERANCE)
            if len(xs):
                found[part] = (float(xs.mean() + 0.5), float(ys.mean() + 0.5))
        if not found:
            return {"landmarks": []}
        pts = [{"x": 0.5, "y": 0.5, "z": 0.0, "visibility": 0.1, "presence": 0.1} for _ in range(33)]
        for part, (x, y) in found.items():
            names = ["nose"] if part == "nose" else [f"left_{part}", f"right_{part}"]
            for name in names:
                far = name.startswith("right_")
                px = x + 6 if far else x
                pts[IDX[name]] = {
                    "x": px / w,
                    "y": y / h,
                    "z": 0.0,
                    "visibility": 0.3 if far else 0.95,
                    "presence": 0.99,
                }
        poses = [pts]
        ys, xs = np.nonzero(np.abs(grey - SECOND_PERSON_LEVEL) <= TOLERANCE)
        if len(xs):
            poses.append([dict(p) for p in pts])
        return {"landmarks": poses}


class ScriptedPoseProvider(_Base):
    provider_id = "test-scripted"

    def __init__(self, script: Callable[[int, np.ndarray], dict[str, Any]]) -> None:
        super().__init__()
        self.script = script

    def infer(self, rgb: np.ndarray, timestamp_ms: int) -> dict[str, Any]:
        return self.script(timestamp_ms, rgb)
