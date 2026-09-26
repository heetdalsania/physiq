"""Study-level aggregation rules (grf-study-aggregation-v0.2).

SYNTHETIC TEST FIXTURE — NOT HUMAN DATA — NOT VALIDATION EVIDENCE. Every
number below is a hand-written software-test input; the resulting "study"
is a software-test output and not evidence of anything.
"""

from __future__ import annotations

import copy
import json
import statistics
import uuid
from typing import Any

import pytest

from physiq_research.force_plate.errors import ForcePlateError
from physiq_research.force_plate.limits import ForcePlateLimits
from physiq_research.force_plate.reports import study_document
from physiq_research.force_plate.study import (
    AGGREGATED_METRICS,
    ResultFacts,
    StudyDefinition,
    TrialFacts,
    aggregate,
    parse_study_definition,
)

VERSIONS = {
    "force_plate": {"ground_truth": "force-ground-truth-v0.1"},
    "m7": {"research_pipeline": "research-pipeline-v0.1"},
}
P1, P2, P3 = (uuid.UUID(f"00000000-0000-4000-8000-00000000000{i}") for i in (1, 2, 3))


def metrics(rmse: float, r: float | None = 0.9) -> dict[str, Any]:
    return {
        "pointwise": {
            "mean_signed_error_n": rmse / 2,
            "mae_n": rmse * 0.8,
            "rmse_n": rmse,
            "mean_signed_error_bw": rmse / 1400,
            "mae_bw": rmse * 0.8 / 700,
            "rmse_bw": rmse / 700,
        },
        "peak": {
            "peak_error_n": -rmse,
            "abs_peak_error_n": rmse,
            "peak_error_bw": -rmse / 700,
            "abs_peak_error_bw": rmse / 700,
        },
        "impulse": {"impulse_error_n_s": 1.0, "abs_impulse_error_n_s": 1.0, "abs_impulse_error_bw_s": 1 / 700},
        "waveform_shape": {"pearson_r": r},
        "intervals": {"repetition_coverage_fraction": 0.97},
    }


class Study:
    """Builds synthetic facts for aggregate()."""

    def __init__(self) -> None:
        self.trials: dict[uuid.UUID, TrialFacts | None] = {}
        self.results: dict[uuid.UUID, list[ResultFacts]] = {}
        self.entries: list[dict[str, Any]] = []

    def add(
        self,
        subject: uuid.UUID | None,
        rmse: float,
        *,
        r: float | None = 0.9,
        origin: str = "synthetic_test_fixture",
        versions: dict[str, Any] | None = None,
        estimator: tuple[str, str] = ("est", "1.0"),
        params: str | None = None,
        assessment: uuid.UUID | None = None,
        source: str | None = None,
        exclusion: str | None = None,
        extra_results: int = 0,
    ) -> uuid.UUID:
        tid = uuid.uuid4()
        self.trials[tid] = TrialFacts(
            trial_id=tid,
            assessment_id=assessment or uuid.uuid4(),
            research_subject_id=subject,
            data_origin=origin,
            force_source_sha256=source or uuid.uuid4().hex * 2,
            movement_type="bodyweight_squat_sagittal",
            capture_mode="single_camera_sagittal",
            versions=versions or VERSIONS,
        )
        self.results[tid] = [
            ResultFacts(uuid.uuid4(), estimator[0], estimator[1], params, "grf-validation-v0.1", metrics(rmse, r))
            for _ in range(1 + extra_results)
        ]
        entry: dict[str, Any] = {"trial_id": str(tid)}
        if exclusion:
            entry["declared_exclusion"] = exclusion
        self.entries.append(entry)
        return tid

    def definition(self, **changes: Any) -> StudyDefinition:
        doc = {
            "contract": "grf-study-definition-v0.1",
            "estimator": {"name": "est", "version": "1.0"},
            "validation_protocol": "grf-validation-v0.1",
            "trials": self.entries,
            **changes,
        }
        return parse_study_definition(json.dumps(doc).encode(), ForcePlateLimits())

    def run(self, **changes: Any) -> dict[str, Any]:
        return aggregate(self.definition(**changes), self.trials, self.results)


def refused(study: Study) -> str:
    with pytest.raises(ForcePlateError) as info:
        study.run()
    return info.value.code


def test_participants_not_trials_are_the_unit_of_analysis() -> None:
    s = Study()
    for rmse in (10.0, 20.0, 30.0):
        s.add(P1, rmse)  # three trials of ONE participant
    s.add(P2, 40.0)
    out = s.run()
    assert out["counts"] == {"participants": 2, "trials_listed": 4, "trials_included": 4, "trials_excluded": 0}
    rmse = out["metrics"]["pointwise.rmse_n"]
    assert rmse["participant_level"]["n"] == 2  # never 4 (trials) and never a sample/frame count
    assert rmse["participant_level"]["mean"] == pytest.approx((20.0 + 40.0) / 2)
    assert rmse["participant_level"]["sd"] == pytest.approx(statistics.stdev([20.0, 40.0]))
    assert rmse["trial_level_descriptive"]["n_trials"] == 4
    assert rmse["trial_level_descriptive"]["mean"] == pytest.approx(25.0)
    assert "not independent" in rmse["trial_level_descriptive"]["note"]
    p1 = next(p for p in out["participants"] if p["research_subject_id"] == str(P1))
    assert p1["trial_count"] == 3 and p1["metric_means"]["pointwise.rmse_n"] == pytest.approx(20.0)
    assert out["aggregation_rules"]["confidence_intervals"] == "not computed"
    assert set(out["metrics"]) == {path for path, _ in AGGREGATED_METRICS}
    text = json.dumps(out)
    for word in ("score", "grade", "pass", "fail", "accura", "validated", "ranking"):
        assert word not in text


def test_large_finite_metrics_do_not_overflow_study_mean_or_median() -> None:
    s = Study()
    s.add(P1, 1e308)
    s.add(P2, 1e308)
    output = s.run()["metrics"]["pointwise.rmse_n"]["participant_level"]
    assert output["mean"] == 1e308
    assert output["median"] == 1e308


def test_single_participant_has_no_sd_and_undefined_r_is_counted() -> None:
    s = Study()
    s.add(P1, 10.0, r=None)
    s.add(P1, 20.0, r=0.5)
    out = s.run()
    rmse = out["metrics"]["pointwise.rmse_n"]["participant_level"]
    assert rmse["n"] == 1 and rmse["sd"] is None
    r = out["metrics"]["waveform_shape.pearson_r"]
    assert r["undefined_trials"] == 1 and r["participant_level"]["mean"] == 0.5


def test_exclusions_are_reported_with_stable_reasons() -> None:
    s = Study()
    kept = s.add(P1, 10.0)
    declared = s.add(P2, 10.0, exclusion="protocol_deviation")
    no_subject = s.add(None, 10.0)
    other_estimator = s.add(P3, 10.0, estimator=("est", "2.0"))
    gone = s.add(P3, 10.0)
    s.trials[gone] = None  # deleted before aggregation
    out = s.run()
    reasons = {e["trial_id"]: e["reason"] for e in out["exclusions"]}
    assert reasons == {
        str(declared): "protocol_deviation",
        str(no_subject): "missing_research_subject_id",
        str(other_estimator): "no_validation_result",
        str(gone): "trial_not_available",
    }
    assert out["counts"]["trials_included"] == 1 and out["participants"][0]["trials"] == [str(kept)]


@pytest.mark.parametrize(
    ("build", "code"),
    [
        (lambda s: (s.add(P1, 1.0), s.add(P2, 1.0, extra_results=1)), "ambiguous_validation_results"),
        (lambda s: (s.add(P1, 1.0, assessment=P3), s.add(P2, 1.0, assessment=P3)), "duplicate_assessment_in_study"),
        (
            lambda s: (s.add(P1, 1.0, source="a" * 64), s.add(P2, 1.0, source="a" * 64)),
            "duplicate_force_source_in_study",
        ),
        (lambda s: (s.add(P1, 1.0), s.add(P2, 1.0, origin="research_recording")), "mixed_data_origin"),
        (
            lambda s: (s.add(P1, 1.0), s.add(P2, 1.0, versions={**VERSIONS, "m7": {"research_pipeline": "v0.2"}})),
            "heterogeneous_versions",
        ),
        (lambda s: (s.add(P1, 1.0, params="b" * 64), s.add(P2, 1.0, params="c" * 64)), "heterogeneous_versions"),
        (lambda s: (s.add(P1, 1.0, exclusion="protocol_deviation"),), "no_included_trials"),
        (lambda s: (s.add(None, 1.0),), "no_included_trials"),
    ],
)
def test_ambiguous_or_heterogeneous_studies_are_refused(build: Any, code: str) -> None:
    s = Study()
    build(s)
    assert refused(s) == code


@pytest.mark.parametrize(
    "mutate",
    [
        lambda d: d.update(contract="grf-study-definition-v9"),
        lambda d: d.update(validation_protocol="grf-validation-v0.2"),
        lambda d: d["estimator"].update(name="Has Spaces"),
        lambda d: d.update(notes="free text"),
        lambda d: d["trials"][0].update(declared_exclusion="looked_bad"),
        lambda d: d["trials"][0].update(participant_name="Jane"),
        lambda d: d.update(trials=[]),
    ],
)
def test_invalid_definitions(mutate: Any) -> None:
    doc = {
        "contract": "grf-study-definition-v0.1",
        "estimator": {"name": "est", "version": "1.0"},
        "validation_protocol": "grf-validation-v0.1",
        "trials": [{"trial_id": str(uuid.uuid4())}],
    }
    bad = copy.deepcopy(doc)
    mutate(bad)
    with pytest.raises(ForcePlateError) as info:
        parse_study_definition(json.dumps(bad).encode(), ForcePlateLimits())
    assert info.value.code == "invalid_study_definition"
    assert "Jane" not in json.dumps(info.value.document())


def test_duplicate_trials_in_a_definition_are_refused() -> None:
    tid = str(uuid.uuid4())
    doc = {
        "contract": "grf-study-definition-v0.1",
        "estimator": {"name": "est", "version": "1.0"},
        "validation_protocol": "grf-validation-v0.1",
        "trials": [{"trial_id": tid}, {"trial_id": tid}],
    }
    with pytest.raises(ForcePlateError) as info:
        parse_study_definition(json.dumps(doc).encode(), ForcePlateLimits())
    assert info.value.code == "duplicate_trial_in_study"
    many = {**doc, "trials": [{"trial_id": str(uuid.uuid4())} for _ in range(3)]}
    with pytest.raises(ForcePlateError):
        parse_study_definition(json.dumps(many).encode(), ForcePlateLimits(max_study_trials=2))


def test_synthetic_studies_are_labelled_software_test_output() -> None:
    s = Study()
    s.add(P1, 1.0)
    doc = study_document(s.run(), "d" * 64)
    assert doc["evidence_statement"] == (
        "SOFTWARE TEST OUTPUT — SYNTHETIC TEST FIXTURE — NOT HUMAN DATA — NOT VALIDATION EVIDENCE"
    )
    assert doc["contract"] == "grf-study-report-v1" and doc["scientific_scope"]["non_claims"]
    real = Study()
    real.add(P1, 1.0, origin="research_recording")
    statement = study_document(real.run(), "d" * 64)["evidence_statement"]
    assert "SYNTHETIC" not in statement and "describes this trial only" in statement
