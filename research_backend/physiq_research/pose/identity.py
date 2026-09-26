"""Declared pose runtime and model identity (importable without the runtime)."""

from __future__ import annotations

from typing import Any, Final

PINNED_RUNTIME_VERSION: Final = "0.10.31"

POSE_RUNTIME: Final[dict[str, Any]] = {
    "id": "mediapipe-tasks-python",
    "package": "mediapipe",
    "package_version": PINNED_RUNTIME_VERSION,
    "license": "Apache-2.0",
    "api": "mediapipe.tasks.python.vision.PoseLandmarker (libmediapipe C API via ctypes)",
    "task": "PoseLandmarker",
    "running_mode": "VIDEO",
    "delegate": "CPU",
    # Two poses are requested only so that a second person can be DETECTED
    # and the frame rejected; analysis never uses more than one.
    "num_poses": 2,
    "min_pose_detection_confidence": 0.5,
    "min_pose_presence_confidence": 0.5,
    "min_tracking_confidence": 0.5,
    "output_segmentation_masks": False,
    "model_input": "verified_bytes",
    "timestamps": "floor(media t_ms), strictly increasing per video",
}

POSE_MODEL: Final[dict[str, Any]] = {
    "id": "pose_landmarker_full",
    "version": "float16/1",
    "embedded_networks": [
        "blazepose_detector_eff_retina_4kp_sparse_2021_10_18",
        "blazepose_ghum_39kp_full_oss_2021_07_02",
    ],
    "file": "pose_landmarker_full.task",
    "bytes": 9398198,
    "sha256": "5134a3aad27a58b93da0088d431f366da362b44e3ccfbe3462b3827a839011b1",
    "source": "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_full/float16/1/pose_landmarker_full.task",
    "license": "Apache-2.0",
    "vendored_path": "vendor/mediapipe/pose_landmarker_full.task",
}
