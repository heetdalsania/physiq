"""Import one paired force-plate trial.

    manifest bytes ─┐
    CSV bytes ──────┼─ SHA-256 (== manifest) → strict parse → canonical signal
    M7 assessment ──┘   → link checks → anchors → clock mapping → overlap
                        → measured ground truth → trial record → ONE transaction

The processing contract (every M8 version and parameter) has a digest, the
*processing fingerprint*; the *trial key* combines it with the canonical
manifest (which names the assessment, subject, body mass, units, sign and
anchors), the CSV's SHA-256 and the linked M7 record's SHA-256. Importing
the same inputs under the same contract returns the existing trial; a new
version or parameter gives a new key and a NEW trial — an old one is never
rewritten.

The CSV bytes live only in memory for the duration of the call; they are
never written anywhere, and only derived numbers and the digest are stored.
"""

from __future__ import annotations

import platform
import time
import uuid
from collections.abc import Callable
from dataclasses import dataclass, field
from datetime import datetime
from typing import Any

from sqlalchemy import Engine

from physiq_research import __version__
from physiq_research.canonical import canonical_digest, sha256_hex
from physiq_research.force_plate.errors import ForcePlateError
from physiq_research.force_plate.evaluation import EVALUATION_PARAMETERS
from physiq_research.force_plate.ground_truth import (
    GROUND_TRUTH_PARAMETERS,
    STANDARD_GRAVITY_M_S2,
    GroundTruth,
    build_ground_truth,
)
from physiq_research.force_plate.limits import ForcePlateLimits
from physiq_research.force_plate.linkage import LinkedAssessment, check_manifest_matches, read_linked_assessment
from physiq_research.force_plate.manifest import ForcePlateManifest, parse_manifest
from physiq_research.force_plate.records import (
    GroundTruthArtifact,
    SignalArtifact,
    Strict,
    SyncArtifact,
    TrialProvenance,
    TrialSummary,
)
from physiq_research.force_plate.repository import ForcePlateRepository, TrialRecord
from physiq_research.force_plate.signal import PARSER_PARAMETERS, MeasuredForceSignal, parse_force_csv
from physiq_research.force_plate.sync import (
    SYNC_PARAMETERS,
    ClockMapping,
    Overlap,
    check_anchor_support,
    compute_overlap,
    describe_sync,
    mapping_from_anchors,
)
from physiq_research.force_plate.versions import (
    CSV_FORMAT,
    CSV_PARSER_VERSION,
    FORCE_PLATE_PIPELINE_VERSION,
    FORCE_TIME_AXIS,
    GROUND_TRUTH_ARTIFACT_SCHEMA,
    GROUND_TRUTH_VERSION,
    MANIFEST_CONTRACT,
    MEASURED_QUANTITY,
    MEDIA_TIME_AXIS,
    SIGNAL_ARTIFACT_SCHEMA,
    SIGNAL_CONTRACT,
    SYNC_ARTIFACT_SCHEMA,
    SYNC_VERSION,
    TRIAL_CONTRACT,
    TRIAL_SUMMARY_SCHEMA,
    VALIDATION_PROTOCOL,
    version_families,
)
from physiq_research.storage.repository import ResearchRepository, utcnow

Faults = Callable[[str], None]


def processing_contract() -> dict[str, Any]:
    return {
        "versions": version_families(),
        "parser": dict(PARSER_PARAMETERS),
        "synchronization": dict(SYNC_PARAMETERS),
        "ground_truth": dict(GROUND_TRUTH_PARAMETERS),
    }


def processing_fingerprint(contract: dict[str, Any] | None = None) -> str:
    return canonical_digest(contract if contract is not None else processing_contract())


def trial_key(
    *, manifest: dict[str, Any], force_source_sha256: str, assessment_record_sha256: str, fingerprint: str
) -> str:
    return canonical_digest(
        {
            "manifest": manifest,
            "force_source_sha256": force_source_sha256,
            "assessment_record_sha256": assessment_record_sha256,
            "processing_fingerprint": fingerprint,
        }
    )


@dataclass
class ImportOutcome:
    trial_id: uuid.UUID
    deduplicated: bool
    timings_s: dict[str, float] = field(default_factory=dict)


def _signal_artifact(signal: MeasuredForceSignal) -> SignalArtifact:
    return SignalArtifact.model_validate(
        {
            "schema_version": SIGNAL_ARTIFACT_SCHEMA,
            "signal_contract": SIGNAL_CONTRACT,
            "quantity": MEASURED_QUANTITY,
            "measurement": "single_force_plate_both_feet",
            "time_axis": FORCE_TIME_AXIS,
            "unit": "N",
            "positive_direction": "up",
            "preprocessing": "none",
            "sample_count": signal.sample_count,
            "time_s": signal.time_s.tolist(),
            "vertical_grf_n": signal.vertical_grf_n.tolist(),
            "sampling": signal.sampling(),
        }
    )


def _sync_artifact(sync_body: dict[str, Any]) -> SyncArtifact:
    return SyncArtifact.model_validate(
        {
            "schema_version": SYNC_ARTIFACT_SCHEMA,
            "sync_version": SYNC_VERSION,
            "media_clock": MEDIA_TIME_AXIS,
            "force_clock": FORCE_TIME_AXIS,
            **sync_body,
        }
    )


def _truth_artifact(truth: GroundTruth) -> GroundTruthArtifact:
    return GroundTruthArtifact.model_validate(
        {
            "schema_version": GROUND_TRUTH_ARTIFACT_SCHEMA,
            "ground_truth_version": GROUND_TRUTH_VERSION,
            "quantity": MEASURED_QUANTITY,
            "ground_truth_source": "force_plate_measurement",
            "time_axis": MEDIA_TIME_AXIS,
            "units": {
                "t_media_ms": "milliseconds of M7 media time",
                "vertical_grf_n": "newtons, positive up, measured",
                "vertical_grf_bw": "body weights: vertical_grf_n / (body_mass_kg * 9.80665 m/s^2)",
            },
            **truth.artifact_body(),
        }
    )


def _summary(
    manifest: ForcePlateManifest,
    signal: MeasuredForceSignal,
    truth: GroundTruth,
    sync_body: dict[str, Any],
) -> TrialSummary:
    rep = truth.repetition
    residuals = [abs(a["residual_ms"]) for a in sync_body["anchors"]]
    sampling = signal.sampling()
    return TrialSummary.model_validate(
        {
            "schema_version": TRIAL_SUMMARY_SCHEMA,
            "trial_contract": TRIAL_CONTRACT,
            "data_origin": manifest.data_origin,
            "movement_type": manifest.movement_type,
            "capture_mode": manifest.capture_mode,
            "plate_configuration": manifest.plate_configuration,
            "quantity": MEASURED_QUANTITY,
            "body_mass_kg": truth.body_mass_kg,
            "standard_gravity_m_s2": STANDARD_GRAVITY_M_S2,
            "body_weight_n": truth.body_weight_n,
            "synchronization": {
                "method": sync_body["method"],
                "offset_ms": sync_body["mapping"]["offset_ms"],
                "rate": sync_body["mapping"]["rate"],
                "anchor_count": len(residuals),
                "max_abs_anchor_residual_ms": max(residuals),
            },
            "overlap": sync_body["overlap"],
            "repetition": {
                "media_ms": rep["media_ms"],
                "force_s": rep["force_s"],
                "duration_ms": rep["duration_ms"],
                "max_sample_interval_ms": rep["max_sample_interval_ms"],
                "measured_peak_vertical_grf_bw": rep["measured_peak_vertical_grf_bw"],
                "measured_trough_vertical_grf_bw": rep["measured_trough_vertical_grf_bw"],
                "measured_impulse_bw_s": rep["measured_impulse_bw_s"],
            },
            "standing_reference": {
                "state": truth.standing_reference["state"],
                "mean_vertical_grf_bw": truth.standing_reference["mean_vertical_grf_bw"],
            },
            "signal": {
                "sample_count": sampling["sample_count"],
                "span_s": sampling["span_s"],
                "median_interval_s": sampling["median_interval_s"],
                "max_interval_s": sampling["max_interval_s"],
                "mean_rate_hz": sampling["mean_rate_hz"],
                "source_positive_direction": signal.source_positive_direction,
            },
        }
    )


def _provenance(
    *,
    manifest: ForcePlateManifest,
    manifest_doc: dict[str, Any],
    source_sha256: str,
    source_bytes: int,
    signal: MeasuredForceSignal,
    linked: LinkedAssessment,
    mapping: ClockMapping,
    overlap: Overlap,
    truth: GroundTruth,
    fingerprint: str,
    key: str,
    limits: ForcePlateLimits,
    started: datetime,
    finished: datetime,
) -> TrialProvenance:
    src = manifest.source
    return TrialProvenance.model_validate(
        {
            "link": linked.describe(),
            "manifest": {
                "contract": MANIFEST_CONTRACT,
                "sha256": canonical_digest(manifest_doc),
                "content": manifest_doc,
            },
            "source": {
                "format": CSV_FORMAT,
                "csv_parser": CSV_PARSER_VERSION,
                "sha256": source_sha256,
                "byte_size": source_bytes,
                "raw_bytes_persisted": False,
                "declared_quantity": src.quantity,
                "declared_time_reference": src.time_reference,
                "declared_time_unit": src.time_unit,
                "declared_force_unit": src.force_unit,
                "declared_vertical_force_positive_direction": src.vertical_force_positive_direction,
                "sign_multiplier": signal.sign_multiplier,
                "unit_conversion": "none",
                "canonical": {"time_axis": FORCE_TIME_AXIS, "unit": "N", "positive_direction": "up"},
                "parser_parameters": dict(PARSER_PARAMETERS),
            },
            "signal": {"contract": SIGNAL_CONTRACT, "sampling": signal.sampling(), "preprocessing": "none"},
            "synchronization": {
                "version": SYNC_VERSION,
                "method": mapping.method,
                "anchors": [a.model_dump(mode="json") for a in manifest.synchronization.anchors],
                "mapping": {"offset_ms": mapping.offset_ms, "rate": mapping.rate},
                "parameters": dict(SYNC_PARAMETERS),
                "force_support_s": [float(signal.time_s[0]), float(signal.time_s[-1])],
                "overlap_media_ms": list(overlap.media_ms),
                "overlap_force_s": list(overlap.force_s),
            },
            "ground_truth": {
                "version": GROUND_TRUTH_VERSION,
                "parameters": dict(GROUND_TRUTH_PARAMETERS),
                "body_mass_kg": truth.body_mass_kg,
                "standard_gravity_m_s2": STANDARD_GRAVITY_M_S2,
                "body_weight_n": truth.body_weight_n,
                "source_sample_index_range": list(truth.source_index_range),
            },
            "validation_protocol": {"version": VALIDATION_PROTOCOL, "parameters": dict(EVALUATION_PARAMETERS)},
            "pipeline": {
                "version": FORCE_PLATE_PIPELINE_VERSION,
                "service_version": __version__,
                "processing_fingerprint": fingerprint,
                "trial_key": key,
                "processed_started_at": started.isoformat(),
                "processed_finished_at": finished.isoformat(),
                "python": platform.python_version(),
            },
            "limits": limits.as_dict(),
        }
    )


def import_trial(
    engine: Engine,
    manifest_bytes: bytes,
    source_bytes: bytes,
    limits: ForcePlateLimits,
    *,
    clock: Callable[[], datetime] = utcnow,
    faults: Faults | None = None,
) -> ImportOutcome:
    def stage(name: str) -> None:
        if faults is not None:
            faults(name)

    timings: dict[str, float] = {}
    t0 = time.perf_counter()
    started = clock()
    stage("manifest")
    manifest = parse_manifest(manifest_bytes)
    manifest_doc = manifest.canonical()

    stage("digest")
    if len(source_bytes) > limits.max_source_bytes:
        raise ForcePlateError("source_too_large", field="force_csv")
    source_sha = sha256_hex(source_bytes)
    if source_sha != manifest.source.sha256:
        raise ForcePlateError("source_digest_mismatch", field="source.sha256")

    stage("parse")
    t = time.perf_counter()
    signal = parse_force_csv(
        source_bytes, positive_direction=manifest.source.vertical_force_positive_direction, limits=limits
    )
    timings["parse_s"] = time.perf_counter() - t

    stage("link")
    linked = read_linked_assessment(ResearchRepository(engine), manifest.assessment_id)
    check_manifest_matches(manifest, linked)

    stage("synchronize")
    t = time.perf_counter()
    anchors = manifest.synchronization.anchors
    mapping = mapping_from_anchors(manifest.synchronization.method, anchors)
    check_anchor_support(anchors, signal, linked.media_end_ms)
    overlap = compute_overlap(mapping, signal, linked.media_end_ms)
    sync_body = describe_sync(mapping, anchors, overlap, signal)
    timings["synchronize_s"] = time.perf_counter() - t

    stage("ground_truth")
    t = time.perf_counter()
    truth = build_ground_truth(signal, mapping, overlap, linked, manifest.body_mass_kg)
    timings["ground_truth_s"] = time.perf_counter() - t

    stage("record")
    fingerprint = processing_fingerprint()
    key = trial_key(
        manifest=manifest_doc,
        force_source_sha256=source_sha,
        assessment_record_sha256=linked.record_sha256,
        fingerprint=fingerprint,
    )
    artifacts: dict[str, Strict] = {
        "measured_signal": _signal_artifact(signal),
        "synchronization": _sync_artifact(sync_body),
        "ground_truth": _truth_artifact(truth),
    }
    record = TrialRecord(
        trial_id=uuid.uuid4(),
        assessment_id=linked.assessment_id,
        assessment_record_sha256=linked.record_sha256,
        research_subject_id=linked.research_subject_id,  # inherited from M7, never from input
        movement_type=linked.movement_type,
        capture_mode=linked.capture_mode,
        data_origin=manifest.data_origin,
        force_source_sha256=source_sha,
        trial_key=key,
        processing_fingerprint=fingerprint,
        pipeline_version=FORCE_PLATE_PIPELINE_VERSION,
        versions=version_families(),
        provenance=_provenance(
            manifest=manifest,
            manifest_doc=manifest_doc,
            source_sha256=source_sha,
            source_bytes=len(source_bytes),
            signal=signal,
            linked=linked,
            mapping=mapping,
            overlap=overlap,
            truth=truth,
            fingerprint=fingerprint,
            key=key,
            limits=limits,
            started=started,
            finished=clock(),
        ),
        summary=_summary(manifest, signal, truth, sync_body),
        artifacts=artifacts,
    )

    stage("database_save")
    t = time.perf_counter()
    trial_id, deduplicated = ForcePlateRepository(engine, clock=clock, faults=faults).save_trial(record)
    timings["database_save_s"] = time.perf_counter() - t
    timings["total_s"] = time.perf_counter() - t0
    return ImportOutcome(trial_id=trial_id, deduplicated=deduplicated, timings_s=timings)
