"""One research job: temporary video → versioned derived research record.

    digest check → probe → [decode → orient → sample → pose] (streamed)
      → pose frames → M6 protocol replay → squat analysis (segmentation)
      → normalized skeleton → kinematic features / traces → record

The processor never writes to the database and never deletes the video:
the worker owns both (workers/worker.py), so the raw-video ``finally`` and
the atomic save live in one place. The decoder and the pose session are
always closed here.

Every classified failure is a ``PipelineFailure`` (stable code/detail/stage).
Unexpected exceptions are wrapped as ``pipeline_error`` with the stage
they happened in; their text is never stored.
"""

from __future__ import annotations

import logging
import platform
import uuid
from collections.abc import Callable
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from physiq_research import __version__
from physiq_research.config import Settings
from physiq_research.domain.calibration import CALIBRATION
from physiq_research.domain.kinematics import KNEE, TRUNK_THIGH
from physiq_research.domain.pose_frame import LANDMARK_NAMES, PoseFrame, landmark_to_dict, normalize_pose_result
from physiq_research.domain.protocol import ProtocolReplay, replay_protocol
from physiq_research.domain.skeleton import (
    SKELETON_PARAMETERS,
    SkeletonReferenceUnavailable,
    SkeletonTransform,
    derive_transform,
    normalize_frame,
    transform_description,
)
from physiq_research.domain.smoothing import SMOOTHING, SmoothedSample
from physiq_research.domain.squat_analysis import (
    SYMMETRY_UNAVAILABLE,
    SquatAnalysis,
    analyze_squat_capture,
    m6_parameters,
)
from physiq_research.domain.time_normalization import TIME_NORMALIZATION, percent_times, resample
from physiq_research.failures import FailureCode, JobCancelled, LeaseLost, PipelineFailure, Stage
from physiq_research.media.decoder import SourceTechnical, VideoDecoder, decoder_identity
from physiq_research.media.decoding_contract import DECODER_PARAMETERS
from physiq_research.media.digest import digest_prefix, file_sha256
from physiq_research.media.sampling import SAMPLING_PARAMETERS, SamplingStats, provider_timestamp_ms, sample_frames
from physiq_research.pipeline.record import AssessmentRecord, ProvenanceRecord
from physiq_research.pose.base import PoseProvider, PoseProviderError, PoseSession
from physiq_research.records import (
    AssessmentSummary,
    FailureDiagnostics,
    KinematicTracesArtifact,
    NormalizedSkeletonArtifact,
    PoseSeriesArtifact,
    TimeNormalizedTracesArtifact,
)
from physiq_research.versions import (
    KINEMATIC_FEATURES_VERSION,
    M6_SOURCE_KINEMATICS,
    M6_SOURCE_POSE_FRAME,
    M6_SOURCE_RESULT_SEMANTICS,
    NORMALIZED_SKELETON_VERSION,
    RESEARCH_PIPELINE_VERSION,
    TIME_NORMALIZATION_VERSION,
    VIDEO_DECODING_VERSION,
    VIDEO_SAMPLING_VERSION,
    version_families,
)

log = logging.getLogger(__name__)

UNITS = {
    "angles": "degrees; apparent 2D included angles between projected landmarks in the image plane",
    "times": "milliseconds of media time (presentation timestamps) since the first decoded video frame",
    "durations": "milliseconds of media time",
    "normalized_skeleton": "dimensionless; standing apparent nose-to-ankle image height (not metres, not 3D)",
    "image_landmarks": "pixels of the display-oriented frame, origin top-left, y down",
}

# Failure mapping from the M6 algorithms' reasons to research failure codes.
_SEGMENTATION_FAILURES: dict[str, FailureCode] = {
    "no_clear_repetition": FailureCode.NO_CLEAR_REPETITION,
    "repetition_started_before_capture": FailureCode.NO_CLEAR_REPETITION,
    "did_not_return_to_standing": FailureCode.NO_CLEAR_REPETITION,
    "multiple_repetitions": FailureCode.NO_CLEAR_REPETITION,
    "too_few_samples_in_repetition": FailureCode.NO_CLEAR_REPETITION,
    "invalid_timing": FailureCode.NO_CLEAR_REPETITION,
    "data_gap_during_repetition": FailureCode.DATA_GAP,
    "insufficient_valid_frames": FailureCode.DATA_GAP,
    "multiple_people_during_capture": FailureCode.MULTIPLE_PEOPLE,
    "insufficient_capture_quality": FailureCode.INSUFFICIENT_CAPTURE_QUALITY,
}

Checkpoint = Callable[[], None]
FaultInjector = Callable[[Stage], None]


@dataclass(frozen=True)
class JobInput:
    job_id: uuid.UUID
    upload_path: Path
    expected_sha256: str
    expected_bytes: int
    movement_type: str
    capture_mode: str
    research_subject_id: uuid.UUID | None
    processing_fingerprint: str
    processing_key: str


@dataclass
class _Sampled:
    sample_index: int
    frame_index: int
    source_pts: int
    t_ms: float
    provider_ms: int
    frame: PoseFrame


def _now() -> datetime:
    return datetime.now(UTC)


class ResearchProcessor:
    def __init__(
        self,
        settings: Settings,
        provider: PoseProvider,
        *,
        faults: FaultInjector | None = None,
        clock: Callable[[], datetime] = _now,
    ) -> None:
        self.settings = settings
        self.provider = provider
        self.faults = faults
        self.clock = clock
        self.stage: Stage = Stage.QUEUE
        self.last_diagnostics: FailureDiagnostics | None = None
        self.timings: dict[str, float] = {}

    # ── helpers ─────────────────────────────────────────────────────────
    def _enter(self, stage: Stage) -> None:
        self.stage = stage
        if self.faults is not None:
            self.faults(stage)

    def process(self, job: JobInput, checkpoint: Checkpoint) -> AssessmentRecord:
        started = self.clock()
        self.last_diagnostics = None
        try:
            return self._process(job, checkpoint, started)
        except (PipelineFailure, JobCancelled, LeaseLost):
            raise
        except PoseProviderError as exc:
            raise PipelineFailure(FailureCode.PIPELINE_ERROR, f"pose_{exc.code}", self.stage) from None
        except (KeyboardInterrupt, SystemExit):
            raise
        except Exception as exc:
            log.warning("job %s: unexpected %s at stage %s", job.job_id, type(exc).__name__, self.stage.value)
            if self.settings.log_tracebacks:
                log.exception("traceback (development logging enabled)")
            raise PipelineFailure(FailureCode.PIPELINE_ERROR, "unexpected_exception", self.stage) from None

    def _process(self, job: JobInput, checkpoint: Checkpoint, started: datetime) -> AssessmentRecord:
        import time

        t_start = time.perf_counter()
        self._enter(Stage.DIGEST)
        digest, size = file_sha256(job.upload_path)
        if digest != job.expected_sha256 or size != job.expected_bytes:
            raise PipelineFailure(FailureCode.INVALID_VIDEO, "digest_mismatch", Stage.DIGEST)
        checkpoint()

        decoder = VideoDecoder(job.upload_path, self.settings.limits)
        session: PoseSession | None = None
        sampled: list[_Sampled] = []
        sampling_stats = SamplingStats()
        try:
            self._enter(Stage.PROBE)
            technical = decoder.probe()
            checkpoint()

            self._enter(Stage.POSE_INIT)
            t_pose_init = time.perf_counter()
            session = self.provider.open_session()
            self.timings["pose_init_s"] = time.perf_counter() - t_pose_init

            self._enter(Stage.DECODE)
            pose_s = 0.0
            for decoded in sample_frames(decoder.frames(), sampling_stats):
                self.stage = Stage.DECODE
                rgb = decoder.to_rgb(decoded)
                self._enter(Stage.POSE_INFERENCE)
                ts = provider_timestamp_ms(decoded.t)
                t0 = time.perf_counter()
                raw = session.detect(rgb, ts)
                pose_s += time.perf_counter() - t0
                frame = normalize_pose_result(
                    raw,
                    t_ms=decoded.t_ms,
                    frame_width=rgb.shape[1],
                    frame_height=rgb.shape[0],
                    provider=self.provider.provider_id,
                    model_id=self.provider.model_id,
                    source_pts=decoded.pts,
                    frame_index=decoded.index,
                )
                sampled.append(_Sampled(len(sampled), decoded.index, decoded.pts, decoded.t_ms, ts, frame))
                del rgb
                checkpoint()
            self.timings["pose_inference_s"] = pose_s
            self.timings["decode_and_pose_s"] = time.perf_counter() - t_start
        finally:
            if session is not None:
                try:
                    session.close()
                except Exception:  # pragma: no cover - best effort
                    log.warning("job %s: pose session close failed", job.job_id)
            decoder.close()

        tech = technical
        self._enter(Stage.PROTOCOL)
        frames = [s.frame for s in sampled]
        replay = replay_protocol(frames)
        diagnostics = self._diagnostics(tech, sampling_stats, sampled, replay, None)
        self.last_diagnostics = diagnostics
        self._classify_protocol(replay, frames, diagnostics)
        checkpoint()

        self._enter(Stage.SEGMENTATION)
        analysis = analyze_squat_capture(replay.calibration, replay.capture_frames)
        diagnostics = self._diagnostics(tech, sampling_stats, sampled, replay, analysis)
        self.last_diagnostics = diagnostics
        if not analysis.complete:
            reason = analysis.insufficient_reason or "not_segmented"
            code = _SEGMENTATION_FAILURES.get(reason, FailureCode.NO_CLEAR_REPETITION)
            detail = reason
            if code is FailureCode.INSUFFICIENT_CAPTURE_QUALITY:
                bad = [f.id for f in analysis.quality.factors if f.state == "insufficient"]
                detail = bad[0] if bad else reason
            raise PipelineFailure(code, detail, Stage.SEGMENTATION, diagnostics.model_dump())
        checkpoint()

        self._enter(Stage.NORMALIZATION)
        assert replay.calibration is not None
        try:
            transform = derive_transform(replay.calibration, replay.calibration_window)
        except SkeletonReferenceUnavailable as exc:
            raise PipelineFailure(
                FailureCode.INSUFFICIENT_CALIBRATION,
                f"skeleton_{exc.detail}",
                Stage.NORMALIZATION,
                diagnostics.model_dump(),
            ) from None
        checkpoint()

        self._enter(Stage.FEATURES)
        finished = self.clock()
        record = self._build_record(job, tech, sampling_stats, sampled, replay, analysis, transform, started, finished)
        self.timings["total_s"] = time.perf_counter() - t_start
        log.info(
            "job %s: derived record built (source %s, %d sampled frames, pipeline %s)",
            job.job_id,
            digest_prefix(job.expected_sha256),
            len(sampled),
            RESEARCH_PIPELINE_VERSION,
        )
        return record

    # ── classification ──────────────────────────────────────────────────
    def _classify_protocol(
        self, replay: ProtocolReplay, frames: list[PoseFrame], diagnostics: FailureDiagnostics
    ) -> None:
        diag = diagnostics.model_dump()
        if replay.end == "frame_dimensions_changed":
            raise PipelineFailure(FailureCode.INVALID_VIDEO, "frame_dimensions_changed", Stage.PROTOCOL, diag)
        if not frames or all(f.status == "no_pose" for f in frames):
            raise PipelineFailure(FailureCode.NO_POSE, "no_person_detected", Stage.PROTOCOL, diag)
        if replay.calibrated:
            return
        if replay.end == "positioning_timeout":
            raise PipelineFailure(FailureCode.INSUFFICIENT_CALIBRATION, "positioning_timeout", Stage.PROTOCOL, diag)
        guidance = replay.last_guidance or "no_calibration"
        if guidance == "multiple_people":
            raise PipelineFailure(
                FailureCode.MULTIPLE_PEOPLE, "multiple_people_during_calibration", Stage.PROTOCOL, diag
            )
        raise PipelineFailure(FailureCode.INSUFFICIENT_CALIBRATION, guidance, Stage.PROTOCOL, diag)

    def _diagnostics(
        self,
        tech: SourceTechnical,
        stats: SamplingStats,
        sampled: list[_Sampled],
        replay: ProtocolReplay,
        analysis: SquatAnalysis | None,
    ) -> FailureDiagnostics:
        counts = {"pose": 0, "no_pose": 0, "multiple_poses": 0, "malformed": 0}
        for s in sampled:
            counts[s.frame.status] += 1
        seg = analysis.segmentation if analysis is not None else None
        return FailureDiagnostics(
            decoded_frames=tech.stats.decoded_frames,
            sampled_frames=len(sampled),
            status_counts=counts,
            protocol_end=replay.end,
            last_calibration_guidance=None if replay.calibrated else replay.last_guidance,
            segmentation_reason=(
                analysis.insufficient_reason if analysis is not None and not analysis.complete else None
            ),
            segmentation_excursion_deg=seg.excursion_deg if seg is not None else None,
            quality_state=analysis.quality.state if analysis is not None else None,
            insufficient_quality_factors=(
                [f.id for f in analysis.quality.factors if f.state == "insufficient"] if analysis is not None else None
            ),
            source_technical=tech.as_dict(),
        )

    # ── record assembly ────────────────────────────────────────────────
    def _build_record(
        self,
        job: JobInput,
        tech: SourceTechnical,
        stats: SamplingStats,
        sampled: list[_Sampled],
        replay: ProtocolReplay,
        analysis: SquatAnalysis,
        transform: SkeletonTransform,
        started: datetime,
        finished: datetime,
    ) -> AssessmentRecord:
        cal = replay.calibration
        seg = analysis.segmentation
        assert cal is not None and cal.side is not None and cal.side_selection is not None
        assert seg.descent_start_ms is not None and seg.deepest_ms is not None and seg.ascent_end_ms is not None
        side = cal.side
        phases = replay.phases
        frame_w, frame_h = sampled[0].frame.frame_width, sampled[0].frame.frame_height
        assert frame_w is not None and frame_h is not None

        pose_series = PoseSeriesArtifact(
            frame_width=frame_w,
            frame_height=frame_h,
            landmark_names=list(LANDMARK_NAMES),
            frames=[
                {
                    "sample_index": s.sample_index,
                    "frame_index": s.frame_index,
                    "source_pts": s.source_pts,
                    "t_ms": s.t_ms,
                    "provider_timestamp_ms": s.provider_ms,
                    "status": s.frame.status,
                    "pose_count": s.frame.pose_count,
                    "phase": phases[i],
                    "landmarks": {n: landmark_to_dict(s.frame.landmarks.get(n)) for n in LANDMARK_NAMES},
                }
                for i, s in enumerate(sampled)
            ],
        )

        skeleton = NormalizedSkeletonArtifact(
            axes={
                "x": "subject facing direction when canonicalised (see transform.mirror_applied)",
                "y": "up (opposite to image rows)",
                "origin": "standing hip centre (median over calibration reference frames)",
            },
            analysis_side=side,
            transform=transform_description(transform),
            parameters=dict(SKELETON_PARAMETERS),
            frames=[
                {
                    "sample_index": s.sample_index,
                    "t_ms": s.t_ms,
                    "status": s.frame.status,
                    "phase": phases[i],
                    "landmarks": {n: landmark_to_dict(v) for n, v in normalize_frame(s.frame, transform).items()},
                }
                for i, s in enumerate(sampled)
            ],
        )

        def trace(samples: tuple[SmoothedSample, ...]) -> list[dict[str, Any]]:
            return [
                {"t_ms": s.t_ms, "raw_deg": s.raw, "smoothed_deg": s.value, "state": s.state}
                for s in samples
                if s.t_ms is not None
            ]

        events = {
            "descent_start_ms": seg.descent_start_ms,
            "deepest_ms": seg.deepest_ms,
            "ascent_end_ms": seg.ascent_end_ms,
        }
        traces = KinematicTracesArtifact(
            analysis_side=side,
            angle_definitions={
                "knee": {"points": list(KNEE.points), "vertex": "knee", "label": KNEE.label, "formula": KNEE.formula},
                "trunk_thigh": {
                    "points": list(TRUNK_THIGH.points),
                    "vertex": "hip",
                    "label": TRUNK_THIGH.label,
                    "formula": TRUNK_THIGH.formula,
                    "note": "combines hip flexion with trunk and pelvic motion; not hip flexion",
                },
            },
            smoothing=dict(SMOOTHING),
            capture_start_ms=analysis.trace_origin_ms,
            events=events,
            knee=trace(analysis.knee_trace),
            trunk_thigh=trace(analysis.trunk_thigh_trace),
        )

        times = percent_times(seg.descent_start_ms, seg.ascent_end_ms)
        tt = analysis.trunk_thigh
        normalized = TimeNormalizedTracesArtifact(
            parameters=dict(TIME_NORMALIZATION),
            repetition_start_ms=seg.descent_start_ms,
            repetition_end_ms=seg.ascent_end_ms,
            percent=list(range(101)),
            t_ms=times,
            knee_deg=resample(analysis.knee_trace, times),
            trunk_thigh_state="available" if tt.state == "available" else "unavailable",
            trunk_thigh_deg=resample(analysis.trunk_thigh_trace, times) if tt.state == "available" else None,
        )

        status_counts = {"pose": 0, "no_pose": 0, "multiple_poses": 0, "malformed": 0}
        for s in sampled:
            status_counts[s.frame.status] += 1
        phase_counts = {"positioning": 0, "calibration_window": 0, "capture": 0, "after_capture": 0, "not_processed": 0}
        for p in phases:
            phase_counts[p] += 1
        q = analysis.quality
        ss = cal.side_selection
        window_times = [f.t_ms for f in replay.calibration_window if f.t_ms is not None]
        summary = AssessmentSummary(
            movement_type=job.movement_type,
            capture_mode=job.capture_mode,
            status="complete",
            analysis_side=side,
            facing_in_image=transform.facing,
            mirror_applied=transform.mirror_applied,
            units=dict(UNITS),
            quality={
                "state": q.state,
                "factors": [{"id": f.id, "state": f.state, "value": f.value} for f in q.factors],
                "total_frames": q.total_frames,
                "capture_duration_ms": q.capture_duration_ms,
                "usable_frames": q.usable_frames,
                "usable_fraction": q.usable_fraction,
                "median_landmark_visibility": q.median_landmark_visibility,
                "frame_status_counts": q.frame_status_counts,
                "body_in_frame_fraction": q.body_in_frame_fraction,
                "foot_drift_fraction": q.foot_drift_fraction,
            },
            frame_statistics={
                "decoded_frames": tech.stats.decoded_frames,
                "accepted_frames": tech.stats.accepted_frames,
                "sampled_frames": len(sampled),
                "status_counts": status_counts,
                "phase_counts": phase_counts,
                "dropped_missing_pts": tech.stats.dropped_missing_pts,
                "dropped_duplicate_pts": tech.stats.dropped_duplicate_pts,
                "dropped_non_monotonic_pts": tech.stats.dropped_non_monotonic_pts,
                "sampling": stats.as_dict(),
            },
            calibration={
                "complete_at_ms": replay.calibration_complete_ms,
                "window_start_ms": min(window_times),
                "window_end_ms": max(window_times),
                "frame_count": cal.frame_count,
                "usable_frames": cal.usable_frames,
                "span_ms": cal.span_ms,
                "knee_range_deg": cal.knee_range_deg,
                "hip_separation_ratio": cal.hip_separation_ratio,
                "standing_apparent_height_px": cal.standing_height_px,
                "side_selection": {
                    "rule": ss.rule,
                    "frame_count": ss.frame_count,
                    "left_median": ss.left_median,
                    "right_median": ss.right_median,
                    "left_mean": ss.left_mean,
                    "right_mean": ss.right_mean,
                    "tie_break": ss.tie_break,
                    "side": ss.side,
                },
            },
            segmentation={
                "state": "segmented",
                "reference_deg": seg.reference_deg,
                "minimum_deg": seg.minimum_deg,
                "excursion_deg": seg.excursion_deg,
                "threshold_deg": seg.threshold_deg,
                "events": events,
                "rep_samples": seg.rep_samples,
                "max_gap_ms": seg.max_gap_ms,
                "valid_samples": seg.valid_samples,
                "protocol_end": replay.end,
            },
            kinematics={
                "knee": {
                    "standing_reference_deg": seg.reference_deg,
                    "minimum_deg": seg.minimum_deg,
                    "apparent_rom_deg": seg.excursion_deg,
                },
                "trunk_thigh": {
                    "state": tt.state,
                    "reason": tt.reason,
                    "standing_reference_deg": tt.reference_deg,
                    "minimum_deg": tt.minimum_deg,
                    "apparent_change_deg": tt.value_deg,
                    "samples_in_repetition": tt.samples_in_repetition,
                    "valid_in_repetition": tt.valid_in_repetition,
                },
                "timing": {"descent_ms": seg.descent_ms, "ascent_ms": seg.ascent_ms, "repetition_ms": seg.total_ms},
                "symmetry": dict(SYMMETRY_UNAVAILABLE),
            },
        )

        provenance = ProvenanceRecord(
            source={"sha256": job.expected_sha256, "technical": tech.as_dict()},
            decoder={
                "contract": VIDEO_DECODING_VERSION,
                "identity": decoder_identity(),
                "parameters": dict(DECODER_PARAMETERS),
            },
            orientation=tech.orientation.describe(),
            sampling={
                "contract": VIDEO_SAMPLING_VERSION,
                "parameters": dict(SAMPLING_PARAMETERS),
                "stats": stats.as_dict(),
            },
            pose=dict(self.provider.identity),
            normalization={"contract": NORMALIZED_SKELETON_VERSION, "transform": transform_description(transform)},
            segmentation={
                "source_semantics": {
                    "kinematics": M6_SOURCE_KINEMATICS,
                    "result": M6_SOURCE_RESULT_SEMANTICS,
                    "pose_frame": M6_SOURCE_POSE_FRAME,
                },
                "implementation": RESEARCH_PIPELINE_VERSION,
                "parameters": m6_parameters(),
                "calibration_window_ms": CALIBRATION["windowMs"],
                "protocol_end": replay.end,
            },
            features={
                "kinematic_features": KINEMATIC_FEATURES_VERSION,
                "time_normalization": TIME_NORMALIZATION_VERSION,
            },
            pipeline={
                "version": RESEARCH_PIPELINE_VERSION,
                "service_version": __version__,
                "processing_fingerprint": job.processing_fingerprint,
                "processing_key": job.processing_key,
                "processed_started_at": started.isoformat(),
                "processed_finished_at": finished.isoformat(),
                "python": platform.python_version(),
            },
            media_limits=self.settings.limits.as_dict(),
        )

        return AssessmentRecord(
            assessment_id=uuid.uuid4(),
            job_id=job.job_id,
            research_subject_id=job.research_subject_id,
            movement_type=job.movement_type,
            capture_mode=job.capture_mode,
            source_sha256=job.expected_sha256,
            processing_fingerprint=job.processing_fingerprint,
            processing_key=job.processing_key,
            versions=version_families(),
            provenance=provenance,
            summary=summary,
            artifacts={
                "pose_series": pose_series,
                "normalized_skeleton": skeleton,
                "kinematic_traces": traces,
                "time_normalized_traces": normalized,
            },
            processing_started_at=started,
            processing_finished_at=finished,
        )
