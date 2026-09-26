"""MediaPipe Pose Landmarker (Python) — the research worker's local pose provider.

Runtime: ``mediapipe`` from PyPI, pinned EXACTLY to 0.10.31 (Apache-2.0).
It drives MediaPipe's C API (``libmediapipe``) through ctypes, on the CPU.

Why 0.10.31 (audited while building Milestone 7; see RESEARCH_BACKEND.md):
    * 0.10.35 and 1.0.1 wheels contain a Clearcut usage logger — the
      native library embeds ``https://play.googleapis.com/log`` plus
      LogRequest/log_source machinery, and the Python layer hands it the
      host OS, Python version and a TLS CA bundle. That is the same class of
      telemetry Milestone 6 rejected for the JavaScript runtime.
    * 0.10.33 adds host-environment reporting and a TLS stack.
    * 0.10.30–0.10.32 contain none of these; 0.10.32 additionally pulls in
      opencv-contrib-python and matplotlib. 0.10.31 is the newest release
      with neither the logger markers nor those extra native dependencies.
The worker refuses to start with any other installed version.

The model is Milestone 6's vendored ``pose_landmarker_full.task`` (same
file, not duplicated). Its size and SHA-256 are verified when the provider
is created and the in-memory bytes are re-verified before every session;
the runtime receives the verified BYTES (``model_asset_buffer``), never a
path or URL.

Python MediaPipe and the JavaScript/WASM build used on device are different
software builds; their landmarks are NOT assumed to be identical. The
provider identity below is therefore separate from Milestone 6's.

Concurrency: a PoseLandmarker graph is not documented as thread-safe, and
VIDEO mode needs strictly increasing timestamps per graph. The worker uses
one provider per process, one session (graph) per video, from one thread.
"""

from __future__ import annotations

import hashlib
import importlib.metadata
import logging
import platform
from pathlib import Path
from typing import Any

import numpy as np

from physiq_research.pose.base import PoseProviderError
from physiq_research.pose.identity import PINNED_RUNTIME_VERSION, POSE_MODEL, POSE_RUNTIME

log = logging.getLogger(__name__)


def read_verified_model(path: Path) -> bytes:
    try:
        data = Path(path).read_bytes()
    except OSError:
        raise PoseProviderError("model_unreadable") from None
    verify_model_bytes(data)
    return data


def verify_model_bytes(data: bytes) -> None:
    if len(data) != POSE_MODEL["bytes"] or hashlib.sha256(data).hexdigest() != POSE_MODEL["sha256"]:
        raise PoseProviderError("model_integrity_failed")


def installed_runtime_version() -> str | None:
    try:
        return importlib.metadata.version("mediapipe")
    except importlib.metadata.PackageNotFoundError:
        return None


def _native_library_sha256() -> str | None:
    """SHA-256 of the installed libmediapipe binary (platform-specific build)."""
    import importlib.util

    spec = importlib.util.find_spec("mediapipe")
    if spec is None or not spec.submodule_search_locations:
        return None
    base = Path(next(iter(spec.submodule_search_locations))) / "tasks" / "c"
    for name in ("libmediapipe.so", "libmediapipe.dylib"):
        candidate = base / name
        if candidate.exists():
            h = hashlib.sha256()
            with open(candidate, "rb") as fh:
                for chunk in iter(lambda: fh.read(1 << 20), b""):
                    h.update(chunk)
            return h.hexdigest()
    return None


class _MediaPipeSession:
    def __init__(self, landmarker: Any, mp: Any) -> None:
        self._landmarker = landmarker
        self._mp = mp
        self._last_ts: int | None = None

    def detect(self, rgb: np.ndarray, timestamp_ms: int) -> dict[str, Any]:
        if self._landmarker is None:
            raise PoseProviderError("session_closed")
        if self._last_ts is not None and timestamp_ms <= self._last_ts:
            raise PoseProviderError("non_increasing_timestamp")
        if rgb.dtype != np.uint8 or rgb.ndim != 3 or rgb.shape[2] != 3:
            raise PoseProviderError("invalid_image")
        self._last_ts = timestamp_ms
        try:
            image = self._mp.Image(image_format=self._mp.ImageFormat.SRGB, data=np.ascontiguousarray(rgb))
            result = self._landmarker.detect_for_video(image, int(timestamp_ms))
        except Exception:
            raise PoseProviderError("inference_failed") from None
        poses = []
        for pose in result.pose_landmarks or []:
            poses.append(
                [{"x": lm.x, "y": lm.y, "z": lm.z, "visibility": lm.visibility, "presence": lm.presence} for lm in pose]
            )
        return {"landmarks": poses}

    def close(self) -> None:
        if self._landmarker is not None:
            try:
                self._landmarker.close()
            finally:
                self._landmarker = None


class MediaPipePoseProvider:
    """One per worker process: verified model bytes + runtime identity."""

    provider_id = POSE_RUNTIME["id"]
    model_id = POSE_MODEL["id"]

    def __init__(self, model_path: Path) -> None:
        version = installed_runtime_version()
        if version != PINNED_RUNTIME_VERSION:
            raise PoseProviderError("runtime_version_mismatch")
        self._model = read_verified_model(model_path)
        try:
            import mediapipe as mp  # type: ignore[import-untyped]
            from mediapipe.tasks.python import vision  # type: ignore[import-untyped]
            from mediapipe.tasks.python.core import base_options  # type: ignore[import-untyped]
        except Exception:
            raise PoseProviderError("runtime_import_failed") from None
        self._mp = mp
        self._vision = vision
        self._base_options = base_options
        self._identity = {
            "runtime": dict(POSE_RUNTIME),
            "installed_runtime_version": version,
            "native_library_sha256": _native_library_sha256(),
            "platform": {"system": platform.system(), "machine": platform.machine()},
            "model": dict(POSE_MODEL),
            "model_verified": True,
        }
        self.sessions_opened = 0

    @property
    def identity(self) -> dict[str, Any]:
        return self._identity

    def open_session(self) -> _MediaPipeSession:
        verify_model_bytes(self._model)  # cheap re-check of the in-memory copy
        options = self._vision.PoseLandmarkerOptions(
            base_options=self._base_options.BaseOptions(model_asset_buffer=self._model),
            running_mode=self._vision.RunningMode.VIDEO,
            num_poses=POSE_RUNTIME["num_poses"],
            min_pose_detection_confidence=POSE_RUNTIME["min_pose_detection_confidence"],
            min_pose_presence_confidence=POSE_RUNTIME["min_pose_presence_confidence"],
            min_tracking_confidence=POSE_RUNTIME["min_tracking_confidence"],
            output_segmentation_masks=POSE_RUNTIME["output_segmentation_masks"],
        )
        try:
            landmarker = self._vision.PoseLandmarker.create_from_options(options)
        except Exception:
            raise PoseProviderError("runtime_init_failed") from None
        self.sessions_opened += 1
        return _MediaPipeSession(landmarker, self._mp)

    def close(self) -> None:
        self._model = b""
