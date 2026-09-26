"""Canonical serialization, version families, fingerprints and idempotency keys."""

from __future__ import annotations

import json
import math

import pytest

from physiq_research.canonical import CanonicalizationError, canonical_digest, canonical_json, strict_json_loads
from physiq_research.pipeline.contract import idempotency_key, processing_contract, processing_fingerprint
from physiq_research.versions import (
    DATABASE_SCHEMA_REVISION,
    KINEMATIC_FEATURES_VERSION,
    NORMALIZED_SKELETON_VERSION,
    RESEARCH_PIPELINE_VERSION,
    VIDEO_SAMPLING_VERSION,
    version_families,
)


def test_canonical_json_is_order_independent_and_compact() -> None:
    a = {"b": 1, "a": [1.5, {"y": None, "x": True}]}
    b = {"a": [1.5, {"x": True, "y": None}], "b": 1}
    assert canonical_json(a) == canonical_json(b) == '{"a":[1.5,{"x":true,"y":null}],"b":1}'
    assert canonical_digest(a) == canonical_digest(b)


def test_canonical_json_normalises_integral_floats_and_negative_zero() -> None:
    assert canonical_json({"v": 5.0}) == canonical_json({"v": 5}) == '{"v":5}'
    assert canonical_json(-0.0) == "0"
    assert canonical_json(0.1) == "0.1"
    assert canonical_json(1e-7) == "1e-07"


@pytest.mark.parametrize("bad", [math.nan, math.inf, -math.inf])
def test_canonical_json_rejects_non_finite(bad: float) -> None:
    with pytest.raises(CanonicalizationError):
        canonical_json({"x": [1, bad]})


def test_canonical_json_rejects_unhashable_python_objects() -> None:
    with pytest.raises(CanonicalizationError):
        canonical_json({"x": object()})
    with pytest.raises(CanonicalizationError):
        canonical_json({1: "non-string key"})


def test_strict_loads_rejects_nan_tokens() -> None:
    with pytest.raises(CanonicalizationError):
        strict_json_loads('{"x": NaN}')
    with pytest.raises(CanonicalizationError):
        strict_json_loads("[Infinity]")
    assert strict_json_loads('{"x": 1.5}') == {"x": 1.5}


def test_version_families_are_independent_of_tissueos_and_m6_identities() -> None:
    fams = version_families()
    assert fams["research_pipeline"] == RESEARCH_PIPELINE_VERSION == "research-pipeline-v0.1"
    assert fams["normalized_skeleton"] == NORMALIZED_SKELETON_VERSION == "normalized-skeleton-v0.1"
    assert fams["kinematic_features"] == KINEMATIC_FEATURES_VERSION == "kinematic-features-v0.1"
    assert fams["video_sampling"] == VIDEO_SAMPLING_VERSION == "video-sampling-v0.1"
    # M6 identities are recorded as SOURCE SEMANTICS, never as our own version.
    assert fams["source_semantics_kinematics"] == "squat-kinematics-v0.2"
    assert fams["source_semantics_result"] == "movement-assessment-v0.1"
    ours = {v for k, v in fams.items() if not k.startswith("source_semantics")}
    assert not ours & {"squat-kinematics-v0.2", "movement-assessment-v0.1", "pose-frame-v1"}
    everything = json.dumps(fams)
    for tissue in ("tissue-load", "exercise-tissue-map", "tissue-history", "load-baseline", "recovery-guidance"):
        assert tissue not in everything
    # The database migration revision is a separate family.
    assert DATABASE_SCHEMA_REVISION not in fams.values()
    assert len(set(fams.values())) == len(fams)


def test_processing_fingerprint_is_stable_and_sensitive() -> None:
    fp = processing_fingerprint()
    assert fp == processing_fingerprint()
    assert len(fp) == 64
    contract = processing_contract()
    # Any version or parameter change gives a different fingerprint.
    changed_version = processing_contract(
        {"versions": {**contract["versions"], "research_pipeline": "research-pipeline-v0.2"}}
    )
    params = json.loads(json.dumps(contract["squat_kinematics_parameters"]))
    params["segmentation"]["minExcursionDeg"] = 21
    changed_param = processing_contract({"squat_kinematics_parameters": params})
    changed_model = processing_contract({"pose_model": {**contract["pose_model"], "sha256": "f" * 64}})
    fps = {
        fp,
        processing_fingerprint(changed_version),
        processing_fingerprint(changed_param),
        processing_fingerprint(changed_model),
    }
    assert len(fps) == 4


def test_processing_contract_records_every_parameter_family() -> None:
    c = processing_contract()
    assert set(c) == {
        "versions",
        "decoding",
        "sampling",
        "pose_runtime",
        "pose_model",
        "squat_kinematics_parameters",
        "normalized_skeleton",
        "time_normalization",
    }
    assert c["pose_model"]["sha256"] == "5134a3aad27a58b93da0088d431f366da362b44e3ccfbe3462b3827a839011b1"
    assert c["pose_runtime"]["package_version"] == "0.10.31"
    assert c["squat_kinematics_parameters"]["segmentation"]["minExcursionDeg"] == 20


def test_idempotency_key_semantics() -> None:
    base = {
        "source_sha256": "a" * 64,
        "fingerprint": processing_fingerprint(),
        "movement_type": "bodyweight_squat_sagittal",
        "capture_mode": "single_camera_sagittal",
        "research_subject_id": None,
    }
    k = idempotency_key(**base)
    assert k == idempotency_key(**base)
    assert k != idempotency_key(**{**base, "source_sha256": "b" * 64})
    assert k != idempotency_key(**{**base, "fingerprint": "0" * 64})
    assert k != idempotency_key(**{**base, "research_subject_id": "9c7b5b5e-2f0c-4a53-9a57-1b2a3c4d5e6f"})
