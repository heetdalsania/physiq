"""Bounded, timestamp-correct video decoding (``video-decoding-v0.1``).

Library: PyAV (FFmpeg bindings). Only the ``mov`` demuxer is used
(MP4 / QuickTime — what phones record), the only I/O protocol allowed is
``file`` (no network, no external data references), and only H.264 and
HEVC video is accepted. Audio is never decoded.

Timestamp policy (never ``frame_index / nominal_fps``):
    * A frame's time is its presentation timestamp: ``t = (pts − pts₀) ×
      time_base`` as an EXACT rational (``fractions.Fraction``), where pts₀
      is the first decoded frame's pts. ``t_ms`` is its value in ms. Variable
      frame rate therefore needs no special case.
    * Frames arrive in presentation order (the decoder reorders B-frames).
    * A frame without a pts is dropped (``missing_pts``); a frame whose pts
      equals the previous accepted pts is dropped (``duplicate_pts``); a
      frame whose pts is lower is dropped (``non_monotonic_pts``). Accepted
      timestamps are therefore strictly increasing.
    * More than 10% of frames dropped for these reasons → the file's timing
      cannot be trusted → ``decode_failed / invalid_timestamps``.

Bounds (config.MediaLimits), checked BEFORE decoding where the container
declares them and again on every decoded frame: byte size, dimensions (long
and short side), decoded frame count and media duration. Frames are
decoded lazily and converted to RGB only when the sampler selects them, so
memory is bounded by a couple of frames regardless of video length.

Orientation: the first frame's display matrix must be a pure rotation
(media/orientation.py); every later frame's rotation must equal it
(``orientation_changed`` otherwise). Frame dimensions must not change
mid-stream. (In MP4 the matrix is a track property, so a change within one
video track does not occur in conformant files; the check is defensive.)

Memory: PyAV's ``frame.side_data`` container forms a reference cycle with
its frame, so touching it on every frame keeps every decoded frame alive
until Python's cyclic GC runs (measured: 840 MB for 211 decoded 1080p
frames vs 56 MB without). The full matrix is therefore read ONLY from the
first frame (followed by one explicit collection), and later frames are
compared through ``frame.rotation``, which reads the same side data in C
without creating Python objects. tests/test_decoder.py pins this with a
peak-memory regression test.

Errors raised here are always ``PipelineFailure`` with a stable code and
detail. FFmpeg's own error text can contain the temporary file path, so it
is never stored or returned.
"""

from __future__ import annotations

import gc
import logging
import math
import os
from collections.abc import Iterator
from dataclasses import dataclass, field
from fractions import Fraction
from pathlib import Path
from typing import Any, Final

import av
import av.error
import numpy as np

from physiq_research.config import MediaLimits
from physiq_research.failures import FailureCode, PipelineFailure, Stage
from physiq_research.media.decoding_contract import (
    DEMUXER,
    MAX_TIMESTAMP_ANOMALY_FRACTION,
    OPEN_OPTIONS,
    SUPPORTED_CODECS,
)
from physiq_research.media.orientation import Orientation, UnsupportedOrientation, classify, parse_display_matrix

log = logging.getLogger(__name__)

# Coarse pre-decode guard: the declared video stream duration may exceed
# the frame-time limit by this much before the file is rejected unseen
# (the per-frame check is authoritative).
DECLARED_DURATION_TOLERANCE_MS: Final = 1000


def _fail(code: FailureCode, detail: str, stage: Stage = Stage.DECODE) -> PipelineFailure:
    return PipelineFailure(code, detail, stage)


def decoder_identity() -> dict[str, Any]:
    versions = getattr(av, "library_versions", {})
    return {
        "library": "PyAV",
        "library_version": av.__version__,
        "ffmpeg_version": getattr(av, "ffmpeg_version_info", None),
        "libavcodec": ".".join(str(x) for x in versions.get("libavcodec", ())),
        "libavformat": ".".join(str(x) for x in versions.get("libavformat", ())),
        "libswscale": ".".join(str(x) for x in versions.get("libswscale", ())),
    }


@dataclass(frozen=True, slots=True)
class DecodedFrame:
    """One accepted frame, still in the decoder's pixel format."""

    index: int  # 0-based among ACCEPTED frames, presentation order
    decoded_index: int  # 0-based among all decoded frames
    pts: int
    t: Fraction  # seconds since the first decoded frame (exact)
    av_frame: Any  # av.VideoFrame; converted to RGB only if sampled

    @property
    def t_ms(self) -> float:
        return float(self.t * 1000)


@dataclass
class DecodeStats:
    packets: int = 0
    decoded_frames: int = 0
    accepted_frames: int = 0
    dropped_missing_pts: int = 0
    dropped_duplicate_pts: int = 0
    dropped_non_monotonic_pts: int = 0
    last_t_ms: float | None = None

    def as_dict(self) -> dict[str, Any]:
        return {
            "packets": self.packets,
            "decoded_frames": self.decoded_frames,
            "accepted_frames": self.accepted_frames,
            "dropped_missing_pts": self.dropped_missing_pts,
            "dropped_duplicate_pts": self.dropped_duplicate_pts,
            "dropped_non_monotonic_pts": self.dropped_non_monotonic_pts,
            "last_frame_t_ms": self.last_t_ms,
        }


@dataclass
class SourceTechnical:
    byte_size: int
    demuxer: str
    major_brand: str | None
    codec: str
    profile: str | None
    pixel_format: str | None
    coded_width: int
    coded_height: int
    display_width: int
    display_height: int
    time_base: str
    average_frame_rate: str | None
    declared_duration_ms: float | None
    indexed_frames: int | None
    orientation: Orientation
    has_audio: bool
    stats: DecodeStats = field(default_factory=DecodeStats)

    def as_dict(self) -> dict[str, Any]:
        return {
            "byte_size": self.byte_size,
            "demuxer": self.demuxer,
            "major_brand": self.major_brand,
            "codec": self.codec,
            "profile": self.profile,
            "pixel_format": self.pixel_format,
            "coded_width": self.coded_width,
            "coded_height": self.coded_height,
            "display_width": self.display_width,
            "display_height": self.display_height,
            "time_base": self.time_base,
            "average_frame_rate": self.average_frame_rate,
            "declared_duration_ms": self.declared_duration_ms,
            "indexed_frames": self.indexed_frames,
            "has_audio_stream": self.has_audio,
            "orientation": self.orientation.describe(),
            "decode": self.stats.as_dict(),
        }


def _display_matrix(frame: Any) -> tuple[int, ...] | None:
    for sd in frame.side_data:
        if getattr(getattr(sd, "type", None), "name", "") == "DISPLAYMATRIX":
            return parse_display_matrix(bytes(sd))
    return None


def _major_brand(path: Path) -> str | None:
    with open(path, "rb") as fh:
        head = fh.read(12)
    if len(head) == 12 and head[4:8] == b"ftyp":
        return head[8:12].decode("latin-1")
    return None


class VideoDecoder:
    """Opens, validates and lazily decodes one research video."""

    def __init__(self, path: Path, limits: MediaLimits) -> None:
        self.path = Path(path)
        self.limits = limits
        self._container: Any = None
        self._stream: Any = None
        self.technical: SourceTechnical | None = None

    def __enter__(self) -> VideoDecoder:
        return self

    def __exit__(self, *exc: object) -> None:
        self.close()

    def close(self) -> None:
        if self._container is not None:
            try:
                self._container.close()
            finally:
                self._container = None
                self._stream = None

    # ── probe ────────────────────────────────────────────────────────────
    def probe(self) -> SourceTechnical:
        size = os.path.getsize(self.path)
        if size == 0:
            raise _fail(FailureCode.INVALID_VIDEO, "empty_file", Stage.PROBE)
        if size > self.limits.max_upload_bytes:
            raise _fail(FailureCode.INVALID_VIDEO, "file_too_large", Stage.PROBE)
        try:
            container = av.open(
                str(self.path), mode="r", format=DEMUXER, options=dict(OPEN_OPTIONS), metadata_errors="ignore"
            )
        except (av.error.FFmpegError, OSError, ValueError) as exc:
            log.info("container open failed: %s", type(exc).__name__)
            raise _fail(FailureCode.INVALID_VIDEO, "container_open_failed", Stage.PROBE) from None
        self._container = container
        videos = list(container.streams.video)
        if not videos:
            raise _fail(FailureCode.INVALID_VIDEO, "no_video_stream", Stage.PROBE)
        if len(videos) > 1:
            raise _fail(FailureCode.INVALID_VIDEO, "multiple_video_streams", Stage.PROBE)
        stream = videos[0]
        self._stream = stream
        cc = stream.codec_context
        codec = (cc.name or "").lower()
        if codec not in SUPPORTED_CODECS:
            raise _fail(FailureCode.INVALID_VIDEO, "unsupported_codec", Stage.PROBE)
        width, height = int(cc.width or 0), int(cc.height or 0)
        if width <= 0 or height <= 0:
            raise _fail(FailureCode.INVALID_VIDEO, "invalid_dimensions", Stage.PROBE)
        self._check_dimensions(width, height, Stage.PROBE)
        sar = stream.sample_aspect_ratio
        if sar is not None and sar not in (0, 1):
            raise _fail(FailureCode.INVALID_VIDEO, "non_square_pixels", Stage.PROBE)
        time_base = stream.time_base
        if time_base is None or time_base <= 0:
            raise _fail(FailureCode.INVALID_VIDEO, "invalid_timestamps", Stage.PROBE)
        declared_ms: float | None = None
        if stream.duration is not None and stream.duration > 0:
            declared_ms = float(Fraction(stream.duration) * time_base * 1000)
            if declared_ms > self.limits.max_duration_ms + DECLARED_DURATION_TOLERANCE_MS:
                raise _fail(FailureCode.INVALID_VIDEO, "duration_exceeded", Stage.PROBE)
        indexed = int(stream.frames) if stream.frames else None
        if indexed is not None and indexed > self.limits.max_decoded_frames:
            raise _fail(FailureCode.INVALID_VIDEO, "frame_count_exceeded", Stage.PROBE)
        rate = stream.average_rate
        self.technical = SourceTechnical(
            byte_size=size,
            demuxer=container.format.name,
            major_brand=_major_brand(self.path),
            codec=codec,
            profile=cc.profile if isinstance(cc.profile, str) else None,
            pixel_format=cc.pix_fmt,
            coded_width=width,
            coded_height=height,
            display_width=width,
            display_height=height,
            time_base=f"{time_base.numerator}/{time_base.denominator}",
            average_frame_rate=f"{rate.numerator}/{rate.denominator}" if rate else None,
            declared_duration_ms=declared_ms,
            indexed_frames=indexed,
            orientation=classify(None),
            has_audio=len(container.streams.audio) > 0,
        )
        return self.technical

    def _check_dimensions(self, width: int, height: int, stage: Stage) -> None:
        if max(width, height) > self.limits.max_long_side_px or min(width, height) > self.limits.max_short_side_px:
            raise _fail(FailureCode.INVALID_VIDEO, "dimensions_exceeded", stage)

    # ── decode ───────────────────────────────────────────────────────────
    def frames(self) -> Iterator[DecodedFrame]:
        """Validated frames in presentation order, lazily decoded."""
        if self.technical is None or self._container is None:
            self.probe()
        tech = self.technical
        assert tech is not None
        stream = self._stream
        time_base = Fraction(stream.time_base)
        stats = tech.stats
        first_pts: int | None = None
        last_pts: int | None = None
        dims: tuple[int, int] | None = None
        matrix_seen = False
        first_rotation = 0
        try:
            for packet in self._container.demux(stream):
                if packet.size:
                    stats.packets += 1
                for frame in packet.decode():
                    stats.decoded_frames += 1
                    if stats.decoded_frames > self.limits.max_decoded_frames:
                        raise _fail(FailureCode.INVALID_VIDEO, "frame_count_exceeded")
                    if getattr(frame, "is_corrupt", False):
                        raise _fail(FailureCode.DECODE_FAILED, "truncated_or_corrupt")
                    fdims = (int(frame.width), int(frame.height))
                    if dims is None:
                        self._check_dimensions(*fdims, Stage.DECODE)
                        dims = fdims
                    elif fdims != dims:
                        raise _fail(FailureCode.INVALID_VIDEO, "frame_dimensions_changed")
                    if not matrix_seen:
                        matrix_seen = True
                        matrix = _display_matrix(frame)
                        gc.collect()  # release the side-data reference cycle of this one frame
                        try:
                            orientation = classify(matrix)
                        except UnsupportedOrientation:
                            raise _fail(FailureCode.INVALID_VIDEO, "unsupported_orientation") from None
                        tech.orientation = orientation
                        tech.display_width, tech.display_height = orientation.displayed_size(*fdims)
                        first_rotation = int(frame.rotation)
                    elif int(frame.rotation) != first_rotation:
                        raise _fail(FailureCode.INVALID_VIDEO, "orientation_changed")
                    pts = frame.pts
                    if pts is None:
                        stats.dropped_missing_pts += 1
                        continue
                    if first_pts is None:
                        first_pts = pts
                    if last_pts is not None and pts == last_pts:
                        stats.dropped_duplicate_pts += 1
                        continue
                    if last_pts is not None and pts < last_pts:
                        stats.dropped_non_monotonic_pts += 1
                        continue
                    last_pts = pts
                    t = (Fraction(pts) - Fraction(first_pts)) * time_base
                    t_ms = float(t * 1000)
                    if t_ms > self.limits.max_duration_ms:
                        raise _fail(FailureCode.INVALID_VIDEO, "duration_exceeded")
                    stats.last_t_ms = t_ms
                    index = stats.accepted_frames
                    stats.accepted_frames += 1
                    yield DecodedFrame(
                        index=index, decoded_index=stats.decoded_frames - 1, pts=int(pts), t=t, av_frame=frame
                    )
        except PipelineFailure:
            raise
        except av.error.InvalidDataError:
            raise _fail(FailureCode.DECODE_FAILED, "truncated_or_corrupt") from None
        except av.error.FFmpegError:
            raise _fail(FailureCode.DECODE_FAILED, "decoder_error") from None

        if stats.accepted_frames == 0:
            raise _fail(FailureCode.INVALID_VIDEO, "no_video_frames")
        if tech.indexed_frames is not None and stats.packets < tech.indexed_frames:
            raise _fail(FailureCode.DECODE_FAILED, "truncated_or_corrupt")
        anomalies = stats.dropped_missing_pts + stats.dropped_duplicate_pts + stats.dropped_non_monotonic_pts
        if anomalies > MAX_TIMESTAMP_ANOMALY_FRACTION * stats.decoded_frames:
            raise _fail(FailureCode.DECODE_FAILED, "invalid_timestamps")

    def to_rgb(self, decoded: DecodedFrame) -> np.ndarray:
        """Display-oriented RGB (H×W×3 uint8) of one accepted frame."""
        assert self.technical is not None
        rgb = decoded.av_frame.to_ndarray(format="rgb24")
        upright = self.technical.orientation.apply(rgb)
        if upright.ndim != 3 or upright.shape[2] != 3 or not math.isfinite(float(upright.shape[0])):
            raise _fail(FailureCode.DECODE_FAILED, "decoder_error")
        return upright
