"""Every independent version identity of the research backend.

Version families are deliberately separate. Changing one never implies
another, and none of them is shared with the consumer app's TissueOS
families (tissue-load-v0.1, exercise-tissue-map-v0.1, tissue-history-v1,
load-baseline-v0.1, recovery-guidance-v0.1), which this service neither
reads nor writes.

Bump rules
    RESEARCH_PIPELINE_VERSION   any change to what the pipeline computes or
                                how stages are wired together.
    VIDEO_DECODING_VERSION      timestamp policy, orientation policy or
                                accepted media changes.
    VIDEO_SAMPLING_VERSION      the frame-selection algorithm or its rate.
    POSE_FRAME_CONTRACT         the shape of one processed pose frame.
    NORMALIZED_SKELETON_VERSION origin, scale or canonical-orientation rules.
    KINEMATIC_FEATURES_VERSION  the stored feature schema or a feature's
                                definition.
    TIME_NORMALIZATION_VERSION  the normalized-time resampling algorithm.
    RESULT/JOB/ERROR contracts  the API response shapes.

The database migration revision (migrations/versions) is independent of all
of the above: a schema change does not change any stored scientific value.

Relationship to Milestone 6
    The squat calibration / smoothing / segmentation / capture-quality
    semantics are an independent Python implementation of the on-device
    JavaScript algorithms identified by ``squat-kinematics-v0.2`` and
    ``movement-assessment-v0.1``. The research record names those as its
    *source semantics* and names ``research-pipeline-v0.1`` as the
    implementation. The two implementations are different software; parity
    is established by shared fixtures (tests/test_m6_parity.py), not by
    sharing a version string.
"""

from __future__ import annotations

from typing import Final

RESEARCH_PIPELINE_VERSION: Final = "research-pipeline-v0.1"
VIDEO_DECODING_VERSION: Final = "video-decoding-v0.1"
VIDEO_SAMPLING_VERSION: Final = "video-sampling-v0.1"
POSE_FRAME_CONTRACT: Final = "research-pose-frame-v1"
NORMALIZED_SKELETON_VERSION: Final = "normalized-skeleton-v0.1"
KINEMATIC_FEATURES_VERSION: Final = "kinematic-features-v0.1"
TIME_NORMALIZATION_VERSION: Final = "time-normalization-v0.1"

# API contracts.
JOB_CONTRACT: Final = "research-job-v1"
RESULT_CONTRACT: Final = "research-assessment-result-v1"
DELETION_CONTRACT: Final = "research-deletion-v1"
ERROR_CONTRACT: Final = "research-error-v1"

# Stored artifact schemas (each artifact carries its own schema identity).
POSE_SERIES_SCHEMA: Final = "research-pose-series-v1"
NORMALIZED_SKELETON_SCHEMA: Final = "research-normalized-skeleton-v1"
KINEMATIC_TRACES_SCHEMA: Final = "research-kinematic-traces-v1"
TIME_NORMALIZED_TRACES_SCHEMA: Final = "research-time-normalized-traces-v1"
SUMMARY_SCHEMA: Final = "research-assessment-summary-v1"
FAILURE_DIAGNOSTICS_SCHEMA: Final = "research-failure-diagnostics-v1"

# Milestone 6 source semantics this implementation reproduces.
M6_SOURCE_KINEMATICS: Final = "squat-kinematics-v0.2"
M6_SOURCE_RESULT_SEMANTICS: Final = "movement-assessment-v0.1"
M6_SOURCE_POSE_FRAME: Final = "pose-frame-v1"

# The only movement and capture mode implemented in Milestone 7.
MOVEMENT_BODYWEIGHT_SQUAT_SAGITTAL: Final = "bodyweight_squat_sagittal"
CAPTURE_MODE_SINGLE_CAMERA_SAGITTAL: Final = "single_camera_sagittal"
SUPPORTED_MOVEMENTS: Final = (MOVEMENT_BODYWEIGHT_SQUAT_SAGITTAL,)
SUPPORTED_CAPTURE_MODES: Final = (CAPTURE_MODE_SINGLE_CAMERA_SAGITTAL,)

# Alembic head this code expects (readiness checks it). 0002 adds the
# Milestone 8 force-plate tables only (physiq_research/force_plate/tables.py);
# no Milestone 7 table or stored value changes.
DATABASE_SCHEMA_REVISION: Final = "0002_force_plate_validation"


def version_families() -> dict[str, str]:
    """All version identities recorded in every research result."""
    return {
        "research_pipeline": RESEARCH_PIPELINE_VERSION,
        "video_decoding": VIDEO_DECODING_VERSION,
        "video_sampling": VIDEO_SAMPLING_VERSION,
        "pose_frame_contract": POSE_FRAME_CONTRACT,
        "normalized_skeleton": NORMALIZED_SKELETON_VERSION,
        "kinematic_features": KINEMATIC_FEATURES_VERSION,
        "time_normalization": TIME_NORMALIZATION_VERSION,
        "source_semantics_kinematics": M6_SOURCE_KINEMATICS,
        "source_semantics_result": M6_SOURCE_RESULT_SEMANTICS,
        "source_semantics_pose_frame": M6_SOURCE_POSE_FRAME,
    }
