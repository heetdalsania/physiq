"""Processing contract, processing fingerprint and idempotency key.

The processing contract is every input to the computation OTHER than the
video itself: all version identities, every algorithm parameter, and the
pose runtime + model identity. Its canonical-JSON SHA-256 is the
*processing fingerprint*. Two pipeline versions (or the same version with a
different parameter or model) therefore never share a fingerprint.

    idempotency key = SHA-256(canonical JSON of {
        source_sha256, processing_fingerprint, movement_type, capture_mode,
        research_subject_id })

Same source bytes + same processing contract + same submission metadata →
same logical processing key → the existing job/assessment is returned
instead of processing again (see api/routes.py for the exact rules).

The fingerprint is computable without the pose runtime installed (the API
process never imports it). The platform-specific binary identity of the
runtime (native library SHA-256, OS, CPU architecture) is recorded in each
result's provenance but is not part of the key: it is the same declared
contract executed on a different build, and Python/JS/platform builds are
never assumed to produce bit-identical landmarks.
"""

from __future__ import annotations

from typing import Any

from physiq_research.canonical import canonical_digest
from physiq_research.domain.skeleton import SKELETON_PARAMETERS
from physiq_research.domain.squat_analysis import m6_parameters
from physiq_research.domain.time_normalization import TIME_NORMALIZATION
from physiq_research.media.decoding_contract import DECODER_PARAMETERS
from physiq_research.media.sampling import SAMPLING_PARAMETERS
from physiq_research.pose.identity import POSE_MODEL, POSE_RUNTIME
from physiq_research.versions import version_families


def processing_contract(overrides: dict[str, Any] | None = None) -> dict[str, Any]:
    contract: dict[str, Any] = {
        "versions": version_families(),
        "decoding": dict(DECODER_PARAMETERS),
        "sampling": dict(SAMPLING_PARAMETERS),
        "pose_runtime": dict(POSE_RUNTIME),
        "pose_model": {"id": POSE_MODEL["id"], "version": POSE_MODEL["version"], "sha256": POSE_MODEL["sha256"]},
        "squat_kinematics_parameters": m6_parameters(),
        "normalized_skeleton": dict(SKELETON_PARAMETERS),
        "time_normalization": dict(TIME_NORMALIZATION),
    }
    if overrides:
        contract = {**contract, **overrides}
    return contract


def processing_fingerprint(contract: dict[str, Any] | None = None) -> str:
    return canonical_digest(contract if contract is not None else processing_contract())


def idempotency_key(
    *,
    source_sha256: str,
    fingerprint: str,
    movement_type: str,
    capture_mode: str,
    research_subject_id: str | None,
) -> str:
    return canonical_digest(
        {
            "source_sha256": source_sha256,
            "processing_fingerprint": fingerprint,
            "movement_type": movement_type,
            "capture_mode": capture_mode,
            "research_subject_id": research_subject_id,
        }
    )
