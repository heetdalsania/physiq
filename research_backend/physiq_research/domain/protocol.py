"""Offline replay of the Milestone 6 capture protocol on media time.

The on-device session (js/movement/assessmentSession.js ``handleFrame``)
decides which pose frames form the calibration window and which form the
capture. A research video is the recording of that same protocol, so the
research pipeline replays the identical rules over the sampled frames, with
MEDIA timestamps standing in for the session clock:

  positioning/calibrating
      * if t > positioningTimeoutMs (45 s; media time zero = the first
        decoded frame, standing in for the camera start) → no calibration
        (the frame is not processed; M6 checks this before inference);
      * append the frame, keep frames with (t_latest − t) ≤ windowMs,
        evaluate the calibration on that window;
      * the first "complete" evaluation freezes the calibration at t_cal and
        switches to capturing (the calibrating frame is not a capture frame).
  capturing
      * if t − t_cal ≥ maxDurationMs (10 s) → capture ends, frame excluded
        (M6 checks the capture clock before inference);
      * append the frame;
      * a ``multiple_poses`` frame ends the capture immediately (subject
        identity is ambiguous; M6 adversarial-review rule);
      * one repetition segmented plus ≥ 1 s of frames after it ends the
        capture (``repetition_finished``).
  end of video while capturing
      * the capture ends with the frames seen (the on-device equivalent is
        the user tapping Done).

Frames after the capture ended are not analysed. The replay records the
phase of every frame so the stored record shows exactly which frames formed
the calibration window and the capture.
"""

from __future__ import annotations

from collections.abc import Sequence
from dataclasses import dataclass, field
from typing import Literal

from physiq_research.domain.calibration import CALIBRATION, Calibration, evaluate_calibration
from physiq_research.domain.pose_frame import PoseFrame
from physiq_research.domain.squat_analysis import CAPTURE, repetition_finished

FramePhase = Literal["positioning", "calibration_window", "capture", "after_capture", "not_processed"]
ProtocolEnd = Literal[
    "repetition_finished",
    "multiple_people",
    "max_duration",
    "end_of_video",
    "positioning_timeout",
    "no_calibration_before_end",
    "frame_dimensions_changed",
]


@dataclass
class ProtocolReplay:
    calibration: Calibration | None = None
    last_guidance: str | None = None
    calibration_complete_ms: float | None = None
    calibration_window: list[PoseFrame] = field(default_factory=list)
    capture_frames: list[PoseFrame] = field(default_factory=list)
    phases: list[FramePhase] = field(default_factory=list)
    end: ProtocolEnd | None = None

    @property
    def calibrated(self) -> bool:
        return self.calibration is not None and self.calibration.complete


def replay_protocol(frames: Sequence[PoseFrame]) -> ProtocolReplay:
    """Replays the M6 protocol over time-ordered pose frames (never raises)."""
    out = ProtocolReplay()
    window: list[tuple[int, PoseFrame]] = []
    dims: tuple[int, int] | None = None
    state = "positioning"
    for index, frame in enumerate(frames):
        if state == "done":
            out.phases.append("after_capture" if out.calibrated else "not_processed")
            continue
        if frame.frame_width and frame.frame_height:
            if dims is None:
                dims = (frame.frame_width, frame.frame_height)
            elif dims != (frame.frame_width, frame.frame_height):
                out.end = "frame_dimensions_changed"
                out.phases.append("not_processed")
                state = "done"
                continue
        if frame.t_ms is None:
            out.phases.append("not_processed")
            continue

        if state == "positioning":
            if frame.t_ms > CAPTURE["positioningTimeoutMs"]:
                out.end = "positioning_timeout"
                out.phases.append("not_processed")
                state = "done"
                continue
            window.append((index, frame))
            latest = frame.t_ms
            window = [(i, f) for i, f in window if f.t_ms is not None and latest - f.t_ms <= CALIBRATION["windowMs"]]
            evaluation = evaluate_calibration([f for _, f in window])
            out.phases.append("positioning")
            if evaluation.complete:
                out.calibration = evaluation
                out.calibration_complete_ms = frame.t_ms
                out.calibration_window = [f for _, f in window]
                for i, _ in window:
                    out.phases[i] = "calibration_window"
                state = "capturing"
            else:
                out.last_guidance = evaluation.reason
            continue

        # capturing
        assert out.calibration_complete_ms is not None
        if frame.t_ms - out.calibration_complete_ms >= CAPTURE["maxDurationMs"]:
            out.end = "max_duration"
            out.phases.append("after_capture")
            state = "done"
            continue
        out.capture_frames.append(frame)
        out.phases.append("capture")
        if frame.status == "multiple_poses":
            out.end = "multiple_people"
            state = "done"
            continue
        if repetition_finished(out.capture_frames, out.calibration):
            out.end = "repetition_finished"
            state = "done"
            continue

    if out.end is None:
        out.end = "end_of_video" if out.calibrated else "no_calibration_before_end"
    return out
