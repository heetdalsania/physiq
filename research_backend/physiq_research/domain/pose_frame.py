"""Internal pose-frame contract ``research-pose-frame-v1``.

The Python counterpart of the concept behind Milestone 6 ``pose-frame-v1``
(js/movement/poseContract.js). Everything downstream consumes THIS shape,
never a provider object, so the pose runtime can be replaced without
touching geometry, segmentation or storage.

    PoseFrame
      t_ms          media time (ms) of the source frame, measured from the
                    first decoded video frame (PTS × time_base; see
                    media/decoder.py). Never wall-clock time.
      frame_width   width of the analysed, display-oriented frame (pixels)
      frame_height  height of the analysed frame (pixels)
      status        "pose" | "no_pose" | "multiple_poses" | "malformed"
      pose_count    poses the provider returned
      landmarks     {name: Landmark | None} (all None unless status "pose")
      source_pts    the frame's presentation timestamp in stream time_base
                    units (None for synthetic frames)
      frame_index   0-based index in decode (presentation) order (None for
                    synthetic frames)

    Landmark = (x, y, visibility, in_frame)
      x, y        IMAGE PIXELS of the display-oriented frame, origin top-left,
                  y down (provider-normalised values × frame size, converted
                  once so every angle is aspect-correct)
      visibility  provider probability in [0, 1] that the point is in frame
                  and not occluded
      in_frame    provider-normalised x and y both within [0, 1]

Same landmark set, gating threshold and malformed-input rules as M6:
the 13 landmarks used (nose, shoulders, hips, knees, ankles, heels, toes).
Face landmarks other than the nose are never kept (data minimisation), and
``z`` is dropped (the model card calls it synthetic and not metric).

Provider output is untrusted. Non-finite or out-of-range values, short
arrays and wrong types become ``None`` landmarks or a ``malformed`` frame —
never (0, 0) and never NaN. Two poses → ``multiple_poses`` with no
landmarks: which person is the subject is ambiguous, so no person is chosen.
"""

from __future__ import annotations

import math
from collections.abc import Mapping, Sequence
from dataclasses import dataclass, field
from typing import Any, Final, Literal

from physiq_research.domain.geometry import is_finite_number
from physiq_research.domain.jsnum import js_round
from physiq_research.versions import POSE_FRAME_CONTRACT

PoseStatus = Literal["pose", "no_pose", "multiple_poses", "malformed"]
POSE_STATUSES: Final = ("pose", "no_pose", "multiple_poses", "malformed")

# BlazePose (33-point) indices of the landmarks kept. "left"/"right" are the
# SUBJECT'S anatomical sides as labelled by the model, not image sides.
BLAZEPOSE_INDEX: Final[Mapping[str, int]] = {
    "nose": 0,
    "left_shoulder": 11,
    "right_shoulder": 12,
    "left_hip": 23,
    "right_hip": 24,
    "left_knee": 25,
    "right_knee": 26,
    "left_ankle": 27,
    "right_ankle": 28,
    "left_heel": 29,
    "right_heel": 30,
    "left_foot_index": 31,
    "right_foot_index": 32,
}
LANDMARK_NAMES: Final = tuple(BLAZEPOSE_INDEX.keys())
BLAZEPOSE_LANDMARK_COUNT: Final = 33

# MEASUREMENT-QUALITY threshold (not an athlete threshold): a landmark takes
# part in an angle only when the model rates it more likely visible than not.
LANDMARK_MIN_VISIBILITY: Final = 0.5

# Normalised coordinates beyond this magnitude are garbage, not
# "slightly outside the frame" predictions.
MAX_ABS_NORMALISED: Final = 10

LandmarkState = Literal["valid", "missing", "out_of_frame", "low_confidence"]


@dataclass(frozen=True, slots=True)
class Landmark:
    x: float
    y: float
    visibility: float
    in_frame: bool


@dataclass(frozen=True, slots=True)
class PoseFrame:
    t_ms: float | None
    frame_width: int | None
    frame_height: int | None
    status: PoseStatus
    pose_count: int
    landmarks: Mapping[str, Landmark | None]
    provider: str
    model_id: str
    source_pts: int | None = None
    frame_index: int | None = None
    contract: str = field(default=POSE_FRAME_CONTRACT)

    def landmark(self, name: str) -> Landmark | None:
        return self.landmarks.get(name)


def _empty_landmarks() -> dict[str, Landmark | None]:
    return dict.fromkeys(LANDMARK_NAMES)


def _is_positive_dimension(v: object) -> bool:
    return is_finite_number(v) and 0 < float(v) <= 100000  # type: ignore[arg-type]


def _get(point: Any, key: str) -> Any:
    if isinstance(point, Mapping):
        return point.get(key)
    return getattr(point, key, None)


def normalize_landmark(point: Any, frame_width: int, frame_height: int) -> Landmark | None:
    """One provider point (normalised x, y, visibility) → Landmark | None."""
    if point is None or isinstance(point, (str, bytes, bool, int, float)):
        return None
    x = _get(point, "x")
    y = _get(point, "y")
    visibility = _get(point, "visibility")
    if not (is_finite_number(x) and is_finite_number(y)):
        return None
    x = float(x)
    y = float(y)
    if abs(x) > MAX_ABS_NORMALISED or abs(y) > MAX_ABS_NORMALISED:
        return None
    if not is_finite_number(visibility):
        return None
    visibility = float(visibility)
    if visibility < 0 or visibility > 1:
        return None
    return Landmark(
        x=x * frame_width,
        y=y * frame_height,
        visibility=visibility,
        in_frame=(0 <= x <= 1 and 0 <= y <= 1),
    )


def normalize_pose_result(
    raw: Any,
    *,
    t_ms: float | None,
    frame_width: object,
    frame_height: object,
    provider: str,
    model_id: str,
    source_pts: int | None = None,
    frame_index: int | None = None,
) -> PoseFrame:
    """Provider result ``{"landmarks": [[33 points], ...]}`` → PoseFrame.

    Never raises for any ``raw``; anything unexpected becomes ``malformed``.
    """
    ts = float(t_ms) if is_finite_number(t_ms) and float(t_ms) >= 0 else None  # type: ignore[arg-type]
    width = js_round(float(frame_width)) if _is_positive_dimension(frame_width) else None  # type: ignore[arg-type]
    height = js_round(float(frame_height)) if _is_positive_dimension(frame_height) else None  # type: ignore[arg-type]

    def frame(status: PoseStatus, pose_count: int, landmarks: dict[str, Landmark | None]) -> PoseFrame:
        return PoseFrame(
            t_ms=ts,
            frame_width=int(width) if width is not None else None,
            frame_height=int(height) if height is not None else None,
            status=status,
            pose_count=pose_count,
            landmarks=landmarks,
            provider=provider,
            model_id=model_id,
            source_pts=source_pts,
            frame_index=frame_index,
        )

    if ts is None or width is None or height is None:
        return frame("malformed", 0, _empty_landmarks())
    poses = _get(raw, "landmarks") if raw is not None else None
    if not isinstance(poses, Sequence) or isinstance(poses, (str, bytes)):
        return frame("malformed", 0, _empty_landmarks())
    count = len(poses)
    if count == 0:
        return frame("no_pose", 0, _empty_landmarks())
    if count > 1:
        return frame("multiple_poses", count, _empty_landmarks())
    pose = poses[0]
    if not isinstance(pose, Sequence) or isinstance(pose, (str, bytes)) or len(pose) < BLAZEPOSE_LANDMARK_COUNT:
        return frame("malformed", count, _empty_landmarks())
    landmarks = {
        name: normalize_landmark(pose[BLAZEPOSE_INDEX[name]], int(width), int(height)) for name in LANDMARK_NAMES
    }
    return frame("pose", count, landmarks)


def landmark_state(landmark: Landmark | None) -> LandmarkState:
    """Why a landmark can or cannot be used, as an explicit state."""
    if landmark is None:
        return "missing"
    if not landmark.in_frame:
        return "out_of_frame"
    if landmark.visibility < LANDMARK_MIN_VISIBILITY:
        return "low_confidence"
    return "valid"


def side_landmark_name(side: str, part: str) -> str:
    return f"{side}_{part}"


def landmark_to_dict(lm: Landmark | None) -> dict[str, Any] | None:
    if lm is None:
        return None
    return {"x": lm.x, "y": lm.y, "visibility": lm.visibility, "in_frame": lm.in_frame}


def is_finite_landmark(lm: Landmark | None) -> bool:
    return lm is None or (math.isfinite(lm.x) and math.isfinite(lm.y) and math.isfinite(lm.visibility))
