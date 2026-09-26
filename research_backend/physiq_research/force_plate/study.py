"""Study-level aggregation of already-computed per-trial results
(``grf-study-aggregation-v0.1``).

Input: a study definition (``grf-study-definition-v0.1``) naming ONE
estimator version, the validation protocol, and the trials (optionally with
a declared, enumerated exclusion reason from the external analysis plan).

Conservative by construction:
    * the unit of analysis is the PARTICIPANT (research_subject_id). Each
      participant's trials are averaged first; study statistics are computed
      across participants; n is the number of participants — never trials,
      never samples or frames. Trial-level means are reported only as
      descriptive and explicitly not independent;
    * a trial without a research_subject_id cannot be attributed to a
      participant and is excluded (``missing_research_subject_id``);
    * every listed trial that is not included appears in ``exclusions`` with
      a stable reason;
    * refused outright: the same trial listed twice, two included trials of
      one M7 assessment (one physical repetition) or of one force recording,
      more than one result of the declared estimator for a trial, results or
      trials produced under different versions, or mixed data origins;
    * no confidence intervals are computed (with few participants and no
      pre-registered model they would suggest more than the data support);
    * no single combined score, ranking or pass/fail.

Synthetic-fixture studies are labelled SOFTWARE TEST OUTPUT — NOT EVIDENCE.
"""

from __future__ import annotations

import statistics
import uuid
from collections import defaultdict
from dataclasses import dataclass
from typing import Annotated, Any, Final, Literal

from pydantic import BaseModel, ConfigDict, Field, ValidationError, field_validator

from physiq_research.canonical import canonical_json
from physiq_research.force_plate.errors import ForcePlateError
from physiq_research.force_plate.estimate import ESTIMATOR_NAME, ESTIMATOR_VERSION
from physiq_research.force_plate.inputs import parse_json_document
from physiq_research.force_plate.limits import ForcePlateLimits
from physiq_research.force_plate.manifest import parse_canonical_uuid
from physiq_research.force_plate.versions import STUDY_AGGREGATION_VERSION, STUDY_DEFINITION_CONTRACT

DeclaredExclusion = Literal[
    "protocol_deviation",
    "measurement_check_exclusion",
    "synchronization_exclusion",
    "other_declared_exclusion",
]

# metric path → (label unit, only-defined values)
AGGREGATED_METRICS: Final[tuple[tuple[str, str], ...]] = (
    ("pointwise.mean_signed_error_n", "N"),
    ("pointwise.mae_n", "N"),
    ("pointwise.rmse_n", "N"),
    ("pointwise.mean_signed_error_bw", "body weights"),
    ("pointwise.mae_bw", "body weights"),
    ("pointwise.rmse_bw", "body weights"),
    ("peak.peak_error_n", "N"),
    ("peak.abs_peak_error_n", "N"),
    ("peak.peak_error_bw", "body weights"),
    ("peak.abs_peak_error_bw", "body weights"),
    ("impulse.impulse_error_n_s", "N·s"),
    ("impulse.abs_impulse_error_n_s", "N·s"),
    ("impulse.abs_impulse_error_bw_s", "body-weight·s"),
    ("waveform_shape.pearson_r", "dimensionless (shape diagnostic)"),
    ("intervals.repetition_coverage_fraction", "fraction of the repetition compared"),
)

AGGREGATION_RULES: Final[dict[str, Any]] = {
    "unit_of_analysis": "participant (research_subject_id)",
    "within_participant": "arithmetic mean of that participant's per-trial values",
    "across_participants": "n, mean, sample standard deviation (n-1), median, min, max",
    "pearson_r": "only trials where it is defined; undefined trials are counted",
    "confidence_intervals": "not computed",
    "trial_level": "descriptive only; trials of one participant are not independent",
}


class _Strict(BaseModel):
    model_config = ConfigDict(strict=True, extra="forbid", frozen=True, allow_inf_nan=False)


class StudyEstimator(_Strict):
    name: str
    version: str

    @field_validator("name")
    @classmethod
    def _name(cls, value: str) -> str:
        if not ESTIMATOR_NAME.match(value):
            raise ValueError("estimator name must be a lowercase slug")
        return value

    @field_validator("version")
    @classmethod
    def _version(cls, value: str) -> str:
        if not ESTIMATOR_VERSION.match(value):
            raise ValueError("estimator version must be a short version string")
        return value


class StudyTrial(_Strict):
    trial_id: uuid.UUID
    declared_exclusion: DeclaredExclusion | None = None

    @field_validator("trial_id", mode="before")
    @classmethod
    def _id(cls, value: object) -> uuid.UUID:
        return parse_canonical_uuid(value, require_v4=False)


class StudyDefinition(_Strict):
    contract: Literal["grf-study-definition-v0.1"]
    estimator: StudyEstimator
    validation_protocol: Literal["grf-validation-v0.1"]
    trials: Annotated[list[StudyTrial], Field(min_length=1)]


assert STUDY_DEFINITION_CONTRACT == "grf-study-definition-v0.1"


def parse_study_definition(data: bytes, limits: ForcePlateLimits) -> StudyDefinition:
    value = parse_json_document(data, field="study_definition")
    if not isinstance(value, dict):
        raise ForcePlateError("invalid_study_definition", field="$")
    try:
        definition = StudyDefinition.model_validate(value)
    except ValidationError:
        raise ForcePlateError("invalid_study_definition") from None
    if len(definition.trials) > limits.max_study_trials:
        raise ForcePlateError("invalid_study_definition", field="trials")
    ids = [t.trial_id for t in definition.trials]
    if len(set(ids)) != len(ids):
        raise ForcePlateError("duplicate_trial_in_study", field="trials")
    return definition


@dataclass(frozen=True)
class TrialFacts:
    """What aggregation needs from a verified stored trial."""

    trial_id: uuid.UUID
    assessment_id: uuid.UUID
    research_subject_id: uuid.UUID | None
    data_origin: str
    force_source_sha256: str
    movement_type: str
    capture_mode: str
    versions: dict[str, Any]  # M8 versions + linked M7 versions


@dataclass(frozen=True)
class ResultFacts:
    result_id: uuid.UUID
    estimator_name: str
    estimator_version: str
    estimator_parameters_sha256: str | None
    protocol_version: str
    metrics: dict[str, Any]


def _metric(metrics: dict[str, Any], path: str) -> float | None:
    node: Any = metrics
    for part in path.split("."):
        node = node[part]
    return None if node is None else float(node)


def _describe(values: list[float]) -> dict[str, Any]:
    return {
        "n": len(values),
        "mean": statistics.fmean(values),
        "sd": statistics.stdev(values) if len(values) > 1 else None,
        "median": statistics.median(values),
        "min": min(values),
        "max": max(values),
    }


def aggregate(
    definition: StudyDefinition,
    trials: dict[uuid.UUID, TrialFacts | None],
    results: dict[uuid.UUID, list[ResultFacts]],
) -> dict[str, Any]:
    """Pure aggregation (report body; see the module docstring for rules)."""
    name, version = definition.estimator.name, definition.estimator.version
    included: list[tuple[TrialFacts, ResultFacts]] = []
    exclusions: list[dict[str, str]] = []
    for entry in definition.trials:
        tid = entry.trial_id
        facts = trials.get(tid)
        reason: str | None = entry.declared_exclusion
        if reason is None and facts is None:
            reason = "trial_not_available"
        elif reason is None and facts is not None and facts.research_subject_id is None:
            reason = "missing_research_subject_id"
        matching: list[ResultFacts] = []
        if reason is None:
            matching = [
                r
                for r in results.get(tid, [])
                if (r.estimator_name, r.estimator_version, r.protocol_version)
                == (name, version, definition.validation_protocol)
            ]
            if not matching:
                reason = "no_validation_result"
            elif len(matching) > 1:
                raise ForcePlateError("ambiguous_validation_results")
        if reason is not None:
            exclusions.append({"trial_id": str(tid), "reason": reason})
            continue
        assert facts is not None
        included.append((facts, matching[0]))

    if not included:
        raise ForcePlateError("no_included_trials")
    for attr, code in (
        ("assessment_id", "duplicate_assessment_in_study"),
        ("force_source_sha256", "duplicate_force_source_in_study"),
    ):
        seen = [getattr(f, attr) for f, _ in included]
        if len(set(seen)) != len(seen):
            raise ForcePlateError(code)
    if len({f.data_origin for f, _ in included}) != 1:
        raise ForcePlateError("mixed_data_origin")
    version_sets = {canonical_json(f.versions) for f, _ in included}
    parameter_sets = {r.estimator_parameters_sha256 for _, r in included}
    movements = {(f.movement_type, f.capture_mode) for f, _ in included}
    if len(version_sets) != 1 or len(parameter_sets) != 1 or len(movements) != 1:
        raise ForcePlateError("heterogeneous_versions")

    by_participant: dict[uuid.UUID, list[tuple[TrialFacts, ResultFacts]]] = defaultdict(list)
    for facts, result in included:
        assert facts.research_subject_id is not None
        by_participant[facts.research_subject_id].append((facts, result))

    participants: list[dict[str, Any]] = []
    participant_values: dict[str, list[float]] = defaultdict(list)
    trial_values: dict[str, list[float]] = defaultdict(list)
    undefined: dict[str, int] = defaultdict(int)
    for subject in sorted(by_participant, key=str):
        rows = by_participant[subject]
        means: dict[str, float | None] = {}
        for path, _unit in AGGREGATED_METRICS:
            values = [v for v in (_metric(r.metrics, path) for _, r in rows) if v is not None]
            undefined[path] += len(rows) - len(values)
            trial_values[path].extend(values)
            means[path] = statistics.fmean(values) if values else None
            if values:
                participant_values[path].append(statistics.fmean(values))
        participants.append(
            {
                "research_subject_id": str(subject),
                "trials": sorted(str(f.trial_id) for f, _ in rows),
                "trial_count": len(rows),
                "metric_means": means,
            }
        )

    metrics = {
        path: {
            "unit": unit,
            "participant_level": _describe(participant_values[path]) if participant_values[path] else None,
            "trial_level_descriptive": (
                {
                    "n_trials": len(trial_values[path]),
                    "mean": statistics.fmean(trial_values[path]),
                    "note": "trials of one participant are not independent observations",
                }
                if trial_values[path]
                else None
            ),
            "undefined_trials": undefined[path],
        }
        for path, unit in AGGREGATED_METRICS
    }
    facts0, result0 = included[0]
    return {
        "aggregation_version": STUDY_AGGREGATION_VERSION,
        "aggregation_rules": dict(AGGREGATION_RULES),
        "data_origin": facts0.data_origin,
        "movement_type": facts0.movement_type,
        "capture_mode": facts0.capture_mode,
        "estimator": {
            "name": name,
            "version": version,
            "parameters_sha256": result0.estimator_parameters_sha256,
        },
        "validation_protocol": definition.validation_protocol,
        "versions": dict(facts0.versions),
        "counts": {
            "participants": len(by_participant),
            "trials_listed": len(definition.trials),
            "trials_included": len(included),
            "trials_excluded": len(exclusions),
        },
        "exclusions": exclusions,
        "participants": participants,
        "metrics": metrics,
    }
