"""Stable failure taxonomy of research jobs.

A failed job stores ``failure_code`` (coarse, stable), ``failure_detail``
(finer, stable) and ``failure_stage``. These are the ONLY failure texts ever
stored or returned: no exception message, file path, request metadata or
binary snippet is persisted or sent in an API response.
"""

from __future__ import annotations

from enum import StrEnum
from typing import Any, Final


class FailureCode(StrEnum):
    INVALID_VIDEO = "invalid_video"
    DECODE_FAILED = "decode_failed"
    NO_POSE = "no_pose"
    MULTIPLE_PEOPLE = "multiple_people"
    INSUFFICIENT_CALIBRATION = "insufficient_calibration"
    NO_CLEAR_REPETITION = "no_clear_repetition"
    DATA_GAP = "data_gap"
    INSUFFICIENT_CAPTURE_QUALITY = "insufficient_capture_quality"
    UPLOAD_EXPIRED = "upload_expired"
    WORKER_LOST = "worker_lost"
    PIPELINE_ERROR = "pipeline_error"


class Stage(StrEnum):
    QUEUE = "queue"
    DIGEST = "digest"
    PROBE = "probe"
    DECODE = "decode"
    POSE_INIT = "pose_init"
    POSE_INFERENCE = "pose_inference"
    PROTOCOL = "protocol"
    NORMALIZATION = "normalization"
    SEGMENTATION = "segmentation"
    FEATURES = "features"
    DATABASE_SAVE = "database_save"


# failure_detail values (stable). Detail strings from the M6 algorithms
# (calibration guidance and segmentation reasons) are passed through as-is.
MEDIA_DETAILS: Final = frozenset(
    {
        "file_too_large",
        "empty_file",
        "digest_mismatch",
        "unsupported_container",
        "container_open_failed",
        "no_video_stream",
        "multiple_video_streams",
        "unsupported_codec",
        "dimensions_exceeded",
        "invalid_dimensions",
        "non_square_pixels",
        "duration_exceeded",
        "frame_count_exceeded",
        "no_video_frames",
        "truncated_or_corrupt",
        "invalid_timestamps",
        "unsupported_orientation",
        "orientation_changed",
        "frame_dimensions_changed",
        "decoder_error",
    }
)


class PipelineFailure(Exception):
    """A classified, expected failure of one research job."""

    def __init__(self, code: FailureCode, detail: str, stage: Stage, diagnostics: dict[str, Any] | None = None) -> None:
        super().__init__(f"{code}:{detail}@{stage}")
        self.code = code
        self.detail = detail
        self.stage = stage
        self.diagnostics = diagnostics or {}


class JobCancelled(Exception):
    """The job was deleted while it was being processed."""


class LeaseLost(Exception):
    """This worker no longer owns the job (lease expired and was reclaimed)."""


# Failures that another submission could plausibly fix. Everything else is
# treated as a deterministic property of (source bytes, processing contract):
# resubmitting the same video under the same contract returns the existing
# failed job instead of processing it again.
RETRYABLE_CODES: Final = frozenset({FailureCode.PIPELINE_ERROR, FailureCode.WORKER_LOST, FailureCode.UPLOAD_EXPIRED})
