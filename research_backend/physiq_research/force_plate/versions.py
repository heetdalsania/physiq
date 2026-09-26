"""Version identities of the Milestone 8 force-plate layer.

Every independently evolving concept has its own identity. None of them is
added to ``physiq_research.versions.version_families()``: that dict is part
of the Milestone 7 processing fingerprint, and adding keys to it would
silently change every M7 idempotency key. M7 identities are recorded in M8
provenance as *linked* versions, never reused as M8's own.

Bump rules
    FORCE_PLATE_PIPELINE_VERSION  any change to how the import stages are wired
                                  or to what a trial record contains.
    MANIFEST_CONTRACT             the import manifest's fields or meaning.
    CSV_FORMAT                    the accepted canonical exchange file.
    CSV_PARSER_VERSION            the parser implementation (strictness,
                                  number grammar, bounds handling).
    SIGNAL_CONTRACT               the canonical measured signal (quantity,
                                  unit, sign, time reference).
    TRIAL_CONTRACT                the stored trial record (identity/provenance).
    SYNC_VERSION                  the force→media time mapping, its anchor
                                  rules or its parameters.
    GROUND_TRUTH_VERSION          overlap selection, repetition window,
                                  bodyweight normalization, measurement checks.
    VALIDATION_PROTOCOL           evaluator metric definitions, interpolation,
                                  gap and sample-count rules.
    ESTIMATE_CONTRACT             the input contract for future estimates.
    STUDY_*                       study definition input / aggregation rules.
    *_SCHEMA / *_CONTRACT (v1)    stored JSON shapes and CLI output shapes.

The Alembic revision (``0002_force_plate_validation``) is independent of all
of these: a schema change never changes a stored value.
"""

from __future__ import annotations

from typing import Final

FORCE_PLATE_PIPELINE_VERSION: Final = "force-plate-pipeline-v0.1"
MANIFEST_CONTRACT: Final = "force-plate-manifest-v0.1"
CSV_FORMAT: Final = "force-plate-csv-v0.1"
CSV_PARSER_VERSION: Final = "force-plate-csv-parser-v0.1"
SIGNAL_CONTRACT: Final = "force-plate-signal-v0.1"
TRIAL_CONTRACT: Final = "force-plate-trial-v0.1"
SYNC_VERSION: Final = "force-video-sync-v0.1"
GROUND_TRUTH_VERSION: Final = "force-ground-truth-v0.1"
VALIDATION_PROTOCOL: Final = "grf-validation-v0.1"
ESTIMATE_CONTRACT: Final = "vertical-grf-estimate-v0.1"
STUDY_DEFINITION_CONTRACT: Final = "grf-study-definition-v0.1"
STUDY_AGGREGATION_VERSION: Final = "grf-study-aggregation-v0.1"

# Stored JSON shapes (each stored document carries its own schema identity).
SIGNAL_ARTIFACT_SCHEMA: Final = "force-plate-signal-artifact-v1"
SYNC_ARTIFACT_SCHEMA: Final = "force-video-sync-artifact-v1"
GROUND_TRUTH_ARTIFACT_SCHEMA: Final = "force-ground-truth-artifact-v1"
TRIAL_SUMMARY_SCHEMA: Final = "force-plate-trial-summary-v1"
VALIDATION_METRICS_SCHEMA: Final = "grf-validation-metrics-v1"

# Command-line output contracts.
TRIAL_REPORT_CONTRACT: Final = "force-plate-trial-report-v1"
TRIAL_LIST_CONTRACT: Final = "force-plate-trial-list-v1"
VALIDATION_REPORT_CONTRACT: Final = "grf-validation-report-v1"
VALIDATION_EXPORT_CONTRACT: Final = "grf-validation-export-v1"
STUDY_REPORT_CONTRACT: Final = "grf-study-report-v1"
DELETION_CONTRACT: Final = "force-plate-deletion-v1"
ERROR_CONTRACT: Final = "force-plate-error-v1"

# The only movement, capture mode, plate setup and target of Milestone 8.
MOVEMENT: Final = "bodyweight_squat_sagittal"
CAPTURE_MODE: Final = "single_camera_sagittal"
PLATE_CONFIGURATION: Final = "single_plate_both_feet"
MEASURED_QUANTITY: Final = "measured_total_vertical_ground_reaction_force"
ESTIMATED_QUANTITY: Final = "estimated_total_vertical_ground_reaction_force"

# Time axes (explicit domains; see FORCE_PLATE_VALIDATION.md §9).
FORCE_TIME_AXIS: Final = "seconds_since_force_acquisition_start"
MEDIA_TIME_AXIS: Final = "media_ms_since_first_decoded_frame"

# Declared origin of the paired data. A label that travels into every report
# so that software-test outputs can never be mistaken for evidence. It is NOT
# an approval, ethics or consent record (those stay outside this service).
DATA_ORIGINS: Final = ("research_recording", "synthetic_test_fixture")


def version_families() -> dict[str, str]:
    """The M8 versions recorded in every force-plate trial."""
    return {
        "force_plate_pipeline": FORCE_PLATE_PIPELINE_VERSION,
        "manifest": MANIFEST_CONTRACT,
        "csv_format": CSV_FORMAT,
        "csv_parser": CSV_PARSER_VERSION,
        "signal": SIGNAL_CONTRACT,
        "trial": TRIAL_CONTRACT,
        "synchronization": SYNC_VERSION,
        "ground_truth": GROUND_TRUTH_VERSION,
        "validation_protocol": VALIDATION_PROTOCOL,
    }
