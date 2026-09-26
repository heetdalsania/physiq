"""Measured ground truth, bodyweight normalization and the link to M7.

SYNTHETIC TEST FIXTURE — NOT HUMAN DATA — NOT VALIDATION EVIDENCE. The M7
assessments here come from the real M7 worker run on a generated dot-figure
video with the deterministic dot pose double.
"""

from __future__ import annotations

import json
import uuid
from pathlib import Path
from typing import Any

import numpy as np
import pytest
from sqlalchemy import select, text, update

from physiq_research.canonical import canonical_digest
from physiq_research.config import Settings
from physiq_research.force_plate.errors import ForcePlateError
from physiq_research.force_plate.ground_truth import (
    MAX_FORCE_SAMPLE_INTERVAL_IN_REPETITION_MS,
    STANDARD_GRAVITY_M_S2,
    body_weight_n,
    build_ground_truth,
    verify_consistency,
)
from physiq_research.force_plate.importer import import_trial
from physiq_research.force_plate.limits import ForcePlateLimits
from physiq_research.force_plate.linkage import (
    LinkedAssessment,
    check_supported,
    linked_from_stored,
    read_linked_assessment,
)
from physiq_research.force_plate.repository import ForcePlateRepository
from physiq_research.force_plate.signal import MeasuredForceSignal
from physiq_research.force_plate.sync import ClockMapping, compute_overlap
from physiq_research.storage.repository import ResearchRepository
from physiq_research.storage.tables import research_assessment_artifacts, research_assessments
from tests.support.force_fixtures import G, csv_bytes, make_fixture, process_assessment, with_csv

LIMITS = ForcePlateLimits()


def linked(**changes: Any) -> LinkedAssessment:
    base = {
        "assessment_id": uuid.uuid4(),
        "record_sha256": "a" * 64,
        "research_subject_id": None,
        "movement_type": "bodyweight_squat_sagittal",
        "capture_mode": "single_camera_sagittal",
        "source_video_sha256": "b" * 64,
        "pipeline_version": "research-pipeline-v0.1",
        "processing_fingerprint": "c" * 64,
        "versions": {},
        "media_end_ms": 7000.0,
        "descent_start_ms": 3000.0,
        "deepest_ms": 4000.0,
        "ascent_end_ms": 5000.0,
        "calibration_start_ms": 500.0,
        "calibration_end_ms": 2500.0,
    }
    return LinkedAssessment(**{**base, **changes})  # type: ignore[arg-type]


def measured(time_s: np.ndarray, force_n: np.ndarray) -> MeasuredForceSignal:
    t, f = np.array(time_s, dtype=np.float64), np.array(force_n, dtype=np.float64)
    t.flags.writeable = False
    f.flags.writeable = False
    return MeasuredForceSignal(time_s=t, vertical_grf_n=f, source_positive_direction="up")


def truth_for(sig: MeasuredForceSignal, mapping: ClockMapping, link: LinkedAssessment, mass: float = 70.0) -> Any:
    return build_ground_truth(sig, mapping, compute_overlap(mapping, sig, link.media_end_ms), link, mass)


# ── pure ground-truth rules ─────────────────────────────────────────────


def test_bodyweight_uses_standard_gravity_exactly() -> None:
    assert STANDARD_GRAVITY_M_S2 == 9.80665
    assert body_weight_n(70.0) == 70.0 * 9.80665 and body_weight_n(70.0) != 70.0 * 9.8
    t = np.arange(0, 8001) / 1000.0
    sig = measured(t, np.full(t.size, 686.4655))
    gt = truth_for(sig, ClockMapping("one_anchor_offset", -500.0, 1.0), linked())
    assert gt.body_weight_n == 70.0 * 9.80665
    assert gt.vertical_grf_bw.tolist() == (gt.vertical_grf_n / (70.0 * 9.80665)).tolist()
    assert gt.standing_reference["state"] == "covered"
    assert gt.standing_reference["mean_vertical_grf_bw"] == pytest.approx(686.4655 / (70 * 9.80665), abs=1e-12)


def test_samples_are_the_native_signal_in_the_closed_overlap() -> None:
    t = np.arange(0, 10_001) / 1000.0
    f = 700.0 + np.arange(t.size) * 0.01
    sig = measured(t, f)
    mapping = ClockMapping("one_anchor_offset", -1500.0, 1.0)
    gt = truth_for(sig, mapping, linked())
    i0, i1 = gt.source_index_range
    assert (i0, i1) == (1500, 8500)  # force samples at media 0 ms and 7000 ms are both included
    assert gt.t_media_ms[0] == 0.0 and gt.t_media_ms[-1] == 7000.0
    assert gt.vertical_grf_n.tolist() == f[1500:8501].tolist()  # unfiltered, unresampled
    assert not gt.t_media_ms.flags.writeable


def test_source_signal_is_unchanged_by_derivation() -> None:
    t = np.arange(0, 10_001) / 1000.0
    sig = measured(t, 700.0 + np.sin(t))
    before = (sig.time_s.tobytes(), sig.vertical_grf_n.tobytes())
    gt = truth_for(sig, ClockMapping("two_anchor_affine", -1500.0 * 1.0001, 1.0001), linked())
    assert (sig.time_s.tobytes(), sig.vertical_grf_n.tobytes()) == before
    assert gt.vertical_grf_bw is not sig.vertical_grf_n


def test_repetition_must_be_bracketed_by_samples() -> None:
    t = np.arange(0, 4001) / 1000.0  # force ends at media 4000 < ascent end 5000
    sig = measured(t, np.full(t.size, 700.0))
    with pytest.raises(ForcePlateError) as info:
        truth_for(sig, ClockMapping("one_anchor_offset", 0.0, 1.0), linked())
    assert info.value.code == "repetition_not_covered"


def test_partial_overlap_that_covers_the_repetition_is_accepted() -> None:
    t = np.arange(0, 3001) / 1000.0  # media 2500..5500 only
    sig = measured(t, np.full(t.size, 700.0))
    gt = truth_for(sig, ClockMapping("one_anchor_offset", 2500.0, 1.0), linked())
    assert (gt.t_media_ms[0], gt.t_media_ms[-1]) == (2500.0, 5500.0)
    assert gt.standing_reference["state"] == "not_covered"  # calibration window 500–2500 is not bracketed
    assert gt.standing_reference["mean_vertical_grf_bw"] is None


def test_sampling_gap_in_the_repetition_is_rejected() -> None:
    t = np.arange(0, 8001) / 1000.0
    keep = (t < 3.5) | (t > 3.521)  # a 22 ms hole inside the repetition
    sig = measured(t[keep], np.full(int(keep.sum()), 700.0))
    with pytest.raises(ForcePlateError) as info:
        truth_for(sig, ClockMapping("one_anchor_offset", 0.0, 1.0), linked())
    assert info.value.code == "force_sampling_gap_in_repetition"
    # the same hole outside the repetition is only reported
    keep = (t < 1.2) | (t > 1.25)
    gt = truth_for(
        measured(t[keep], np.full(int(keep.sum()), 700.0)), ClockMapping("one_anchor_offset", 0.0, 1.0), linked()
    )
    assert gt.measurement_checks["max_sample_interval_ms"] == pytest.approx(52.0)  # 1.199 s → 1.251 s
    assert gt.repetition["max_sample_interval_ms"] == pytest.approx(1.0)
    assert MAX_FORCE_SAMPLE_INTERVAL_IN_REPETITION_MS == 20.0


@pytest.mark.parametrize("bad", [0.0, -1.0, -700.0])
def test_non_positive_force_in_the_repetition_is_rejected_never_flipped(bad: float) -> None:
    t = np.arange(0, 8001) / 1000.0
    f = np.full(t.size, 700.0)
    f[4000] = bad
    with pytest.raises(ForcePlateError) as info:
        truth_for(measured(t, f), ClockMapping("one_anchor_offset", 0.0, 1.0), linked())
    assert info.value.code == "non_positive_vertical_force_in_repetition"
    # a sign-inverted recording declared "up" is rejected, not silently flipped
    with pytest.raises(ForcePlateError):
        truth_for(measured(t, -np.full(t.size, 700.0)), ClockMapping("one_anchor_offset", 0.0, 1.0), linked())


def test_measured_repetition_quantities_are_exact_for_a_piecewise_linear_signal() -> None:
    # triangle bump over the repetition [3000, 5000]: 700 N → 900 N at 4000 → 700 N
    t = np.arange(0, 8001) / 1000.0
    ms = t * 1000.0
    f = np.where((ms >= 3000) & (ms <= 5000), 900.0 - 200.0 * np.abs(ms - 4000) / 1000.0, 700.0)
    gt = truth_for(measured(t, f), ClockMapping("one_anchor_offset", 0.0, 1.0), linked(), mass=70.0)
    rep = gt.repetition
    assert rep["measured_peak_vertical_grf_n"] == 900.0 and rep["measured_peak_media_ms"] == 4000.0
    assert rep["measured_trough_vertical_grf_n"] == 700.0 and rep["measured_trough_media_ms"] == 3000.0
    assert rep["measured_impulse_n_s"] == pytest.approx(700.0 * 2.0 + 0.5 * 2.0 * 200.0, rel=1e-12)
    assert rep["measured_impulse_bw_s"] == pytest.approx(rep["measured_impulse_n_s"] / (70 * G), rel=1e-15)
    assert rep["force_s"] == [3.0, 5.0] and rep["samples_inside"] == 2001


def test_verify_consistency_detects_semantic_tampering() -> None:
    t = np.arange(0, 8001) / 1000.0
    sig = measured(t, np.full(t.size, 700.0))
    mapping = ClockMapping("one_anchor_offset", 0.0, 1.0)
    gt = truth_for(sig, mapping, linked())
    signal_doc = {"time_s": t.tolist(), "vertical_grf_n": sig.vertical_grf_n.tolist()}
    sync_doc = {
        "method": "one_anchor_offset",
        "mapping": {"offset_ms": 0.0, "rate": 1.0},
        "overlap": {"media_ms": [0.0, 7000.0]},
    }
    truth_doc = gt.artifact_body()
    verify_consistency(signal_doc, sync_doc, truth_doc)
    for _key, change in (
        ("vertical_grf_n", lambda d: d["vertical_grf_n"].__setitem__(10, 701.0)),
        ("vertical_grf_bw", lambda d: d["vertical_grf_bw"].__setitem__(10, 1.5)),
        ("t_media_ms", lambda d: d["t_media_ms"].__setitem__(10, 10.5)),
        ("body_mass_kg", lambda d: d.__setitem__("body_mass_kg", 71.0)),
        ("source_sample_index_range", lambda d: d.__setitem__("source_sample_index_range", [1, 7001])),
    ):
        doc = json.loads(json.dumps(truth_doc))
        change(doc)
        with pytest.raises(ValueError):
            verify_consistency(signal_doc, sync_doc, doc)
    shifted = {**sync_doc, "mapping": {"offset_ms": 0.5, "rate": 1.0}}
    with pytest.raises(ValueError):
        verify_consistency(signal_doc, shifted, truth_doc)


# ── linkage against real stored M7 assessments ─────────────────────────


def test_linkage_reads_the_immutable_m7_record(settings: Settings, repo: ResearchRepository, squat_video: Path) -> None:
    subject = uuid.uuid4()
    stored = process_assessment(settings, repo, squat_video, subject=subject)
    link = read_linked_assessment(repo, stored.id)
    events = stored.summary["segmentation"]["events"]
    assert (link.descent_start_ms, link.deepest_ms, link.ascent_end_ms) == (
        events["descent_start_ms"],
        events["deepest_ms"],
        events["ascent_end_ms"],
    )
    assert link.record_sha256 == stored.record_sha256 and link.research_subject_id == subject
    assert link.media_end_ms == stored.provenance["source"]["technical"]["decode"]["last_frame_t_ms"] == 7000.0
    assert link.describe()["m7_versions"] == stored.versions


def test_unknown_and_deleted_assessments_are_rejected(
    settings: Settings, repo: ResearchRepository, squat_video: Path
) -> None:
    with pytest.raises(ForcePlateError) as info:
        read_linked_assessment(repo, uuid.uuid4())
    assert info.value.code == "assessment_not_found"
    stored = process_assessment(settings, repo, squat_video)
    repo.delete_assessment(stored.id)
    with pytest.raises(ForcePlateError) as info:
        read_linked_assessment(repo, stored.id)
    assert info.value.code == "assessment_deleted"
    fx = make_fixture(stored.id)
    with pytest.raises(ForcePlateError) as info:
        import_trial(repo.engine, fx.manifest_bytes(), fx.csv, LIMITS)
    assert info.value.code == "assessment_deleted"


@pytest.mark.parametrize(
    ("changes", "code"),
    [
        ({"movement_type": "countermovement_jump"}, "unsupported_assessment_movement"),
        ({"movement_type": "single_leg_landing"}, "unsupported_assessment_movement"),
        ({"capture_mode": "frontal"}, "unsupported_assessment_capture_mode"),
    ],
)
def test_wrong_movement_or_capture_mode_is_rejected(changes: dict[str, str], code: str) -> None:
    with pytest.raises(ForcePlateError) as info:
        check_supported(linked(**changes))
    assert info.value.code == code


def test_tampered_or_relabelled_m7_row_is_refused(
    settings: Settings, repo: ResearchRepository, squat_video: Path
) -> None:
    stored = process_assessment(settings, repo, squat_video)
    with repo.engine.begin() as c:
        c.execute(text("DROP TRIGGER research_assessments_immutable"))
        c.execute(
            update(research_assessments)
            .where(research_assessments.c.id == stored.id)
            .values(movement_type="countermovement_jump")
        )
    with pytest.raises(ForcePlateError) as info:
        read_linked_assessment(repo, stored.id)
    assert info.value.code == "assessment_integrity_error"


@pytest.mark.parametrize("declared", ["other", "none_for_subject", "subject_for_none"])
def test_subject_mismatch_is_impossible(
    settings: Settings, repo: ResearchRepository, squat_video: Path, declared: str
) -> None:
    subject = uuid.uuid4()
    stored = process_assessment(
        settings, repo, squat_video, subject=None if declared == "subject_for_none" else subject
    )
    manifest_subject = {"other": uuid.uuid4(), "none_for_subject": None, "subject_for_none": subject}[declared]
    fx = make_fixture(stored.id, subject=manifest_subject)
    with pytest.raises(ForcePlateError) as info:
        import_trial(repo.engine, fx.manifest_bytes(), fx.csv, LIMITS)
    assert (info.value.code, info.value.field) == ("research_subject_mismatch", "research_subject_id")
    assert ForcePlateRepository(repo.engine).list_trials() == []


def test_trial_inherits_the_subject_and_never_mutates_m7(
    settings: Settings, repo: ResearchRepository, squat_video: Path
) -> None:
    subject = uuid.uuid4()
    stored = process_assessment(settings, repo, squat_video, subject=subject)

    def m7_rows() -> str:
        with repo.engine.connect() as c:
            rows = [dict(r._mapping) for r in c.execute(select(research_assessments)).all()]
            arts = [dict(r._mapping) for r in c.execute(select(research_assessment_artifacts)).all()]
        return canonical_digest(json.loads(json.dumps([rows, arts], default=str)))

    before = m7_rows()
    fx = make_fixture(stored.id, subject=subject)
    out = import_trial(repo.engine, fx.manifest_bytes(), fx.csv, LIMITS)
    trial = ForcePlateRepository(repo.engine).get_trial(out.trial_id)
    assert trial is not None and trial.research_subject_id == subject
    assert trial.assessment_record_sha256 == stored.record_sha256
    ForcePlateRepository(repo.engine).delete_trial(out.trial_id)
    assert m7_rows() == before
    again = repo.get_assessment(stored.id)
    assert again is not None and again.record_sha256 == stored.record_sha256


def test_import_end_to_end_values(settings: Settings, repo: ResearchRepository, squat_video: Path) -> None:
    stored = process_assessment(settings, repo, squat_video)
    fx = make_fixture(stored.id, positive_direction="down")
    out = import_trial(repo.engine, fx.manifest_bytes(), fx.csv, LIMITS)
    trial = ForcePlateRepository(repo.engine).get_trial(out.trial_id)
    assert trial is not None
    gt = trial.artifacts["ground_truth"].data
    sig = trial.artifacts["measured_signal"].data
    assert gt is not None and sig is not None
    # positive-down file → canonical positive-up values equal the fixture's up values
    assert sig["vertical_grf_n"] == fx.force_n.tolist()
    assert sig["positive_direction"] == "up" and trial.provenance["source"]["sign_multiplier"] == -1
    assert gt["t_media_ms"][0] == 0.0 and gt["t_media_ms"][-1] == 7000.0
    assert gt["vertical_grf_n"] == fx.force_n[1500:8501].tolist()
    assert trial.provenance["ground_truth"]["standard_gravity_m_s2"] == 9.80665
    assert trial.summary["standing_reference"]["mean_vertical_grf_bw"] == pytest.approx(1.0, abs=1e-12)
    rep = trial.summary["repetition"]["media_ms"]
    events = stored.summary["segmentation"]["events"]
    assert rep == [events["descent_start_ms"], events["ascent_end_ms"]]
    assert trial.summary["repetition"]["force_s"] == pytest.approx([(r + 1500.0) / 1000.0 for r in rep], abs=1e-12)


def test_mislabelled_sign_is_rejected_not_repaired(
    settings: Settings, repo: ResearchRepository, squat_video: Path
) -> None:
    stored = process_assessment(settings, repo, squat_video)
    fx = make_fixture(stored.id, positive_direction="down")
    doc = json.loads(fx.manifest_bytes())
    doc["source"]["vertical_force_positive_direction"] = "up"  # wrong declaration
    with pytest.raises(ForcePlateError) as info:
        import_trial(repo.engine, json.dumps(doc).encode(), fx.csv, LIMITS)
    assert info.value.code == "non_positive_vertical_force_in_repetition"


def test_digest_mismatch_and_anchor_outside_supports(
    settings: Settings, repo: ResearchRepository, squat_video: Path
) -> None:
    stored = process_assessment(settings, repo, squat_video)
    fx = make_fixture(stored.id)
    with pytest.raises(ForcePlateError) as info:
        import_trial(repo.engine, fx.manifest_bytes(), fx.csv + b"0,0\n", LIMITS)
    assert info.value.code == "source_digest_mismatch"
    far = make_fixture(stored.id, anchor_force_ms=(9000.0,))  # maps to video 7500 ms > 7000
    with pytest.raises(ForcePlateError) as info:
        import_trial(repo.engine, far.manifest_bytes(), far.csv, LIMITS)
    assert info.value.code == "anchor_outside_video_support"
    short = csv_bytes([i / 1000 for i in range(2001)], [700.0] * 2001)  # 2 s of force only
    manifest, data = with_csv(fx, short)
    with pytest.raises(ForcePlateError) as info:
        import_trial(repo.engine, manifest, data, LIMITS)
    assert info.value.code == "anchor_outside_force_support"


def test_linked_from_stored_requires_media_support(
    settings: Settings, repo: ResearchRepository, squat_video: Path
) -> None:
    stored = process_assessment(settings, repo, squat_video)
    broken = json.loads(json.dumps(stored.provenance))
    del broken["source"]["technical"]["decode"]["last_frame_t_ms"]
    from dataclasses import replace

    with pytest.raises(ForcePlateError) as info:
        linked_from_stored(replace(stored, provenance=broken))
    assert info.value.code == "assessment_media_support_unavailable"


def test_trial_provenance_identifies_every_required_item(
    settings: Settings, repo: ResearchRepository, squat_video: Path
) -> None:
    """The minimum provenance of a force trial (Milestone 8 specification)."""
    subject = uuid.uuid4()
    stored = process_assessment(settings, repo, squat_video, subject=subject)
    fx = make_fixture(stored.id, subject=subject, method="two_anchor_affine", positive_direction="down")
    out = import_trial(repo.engine, fx.manifest_bytes(), fx.csv, LIMITS)
    trial = ForcePlateRepository(repo.engine).get_trial(out.trial_id)
    assert trial is not None
    p = trial.provenance
    link, src, sync, gt = p["link"], p["source"], p["synchronization"], p["ground_truth"]
    required = {
        "M7 assessment id": link["assessment_id"] == str(stored.id),
        "M7 record digest": link["assessment_record_sha256"] == stored.record_sha256,
        "research subject id": link["research_subject_id"] == str(subject),
        "movement type": link["movement_type"] == "bodyweight_squat_sagittal",
        "capture mode": link["capture_mode"] == "single_camera_sagittal",
        "force source SHA-256": src["sha256"] == fx.manifest["source"]["sha256"] == trial.force_source_sha256,
        "force signal contract": p["signal"]["contract"] == "force-plate-signal-v0.1",
        "synchronization contract": sync["version"] == "force-video-sync-v0.1",
        "validation protocol": p["validation_protocol"]["version"] == "grf-validation-v0.1",
        "input units": (src["declared_time_unit"], src["declared_force_unit"], src["unit_conversion"])
        == ("s", "N", "none"),
        "canonical units": src["canonical"]
        == {"time_axis": "seconds_since_force_acquisition_start", "unit": "N", "positive_direction": "up"},
        "sign mapping": (src["declared_vertical_force_positive_direction"], src["sign_multiplier"]) == ("down", -1),
        "body mass": gt["body_mass_kg"] == 70.0 and gt["standard_gravity_m_s2"] == 9.80665,
        "synchronization method": sync["method"] == "two_anchor_affine",
        "synchronization parameters": sync["parameters"]["min_anchor_separation_ms"] == 1000.0
        and len(sync["anchors"]) == 2
        and set(sync["mapping"]) == {"offset_ms", "rate"},
        "force time support": sync["force_support_s"] == [0.0, 10.0],
        "overlapping media-time support": sync["overlap_media_ms"] == [0.0, 7000.0],
        "parser implementation": src["csv_parser"] == "force-plate-csv-parser-v0.1",
        "pipeline version": p["pipeline"]["version"] == "force-plate-pipeline-v0.1"
        and p["pipeline"]["service_version"],
        "raw bytes not persisted": src["raw_bytes_persisted"] is False,
        "limits": p["limits"]["max_samples"] == LIMITS.max_samples,
        "declared manifest": p["manifest"]["content"]["body_mass_kg"] == 70.0,
    }
    missing = [name for name, ok in required.items() if not ok]
    assert not missing, missing
    assert (
        trial.versions["ground_truth"] == "force-ground-truth-v0.1"
        and trial.pipeline_version == "force-plate-pipeline-v0.1"
    )
    text = json.dumps(p)
    assert "force.csv" not in text and "manifest.json" not in text  # no file names anywhere
