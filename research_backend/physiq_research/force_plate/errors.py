"""Stable research error codes of the force-plate layer (``force-plate-error-v1``).

Every rejection is a ``ForcePlateError`` with a stable ``code``, an optional
``field`` (a KNOWN contract path such as ``source.sha256`` or a canonical
column name — never a key or value taken from the input) and an optional
1-based ``line`` of the CSV. Messages come from this table only: no
exception text, file path, file name, input value or traceback is ever
printed or stored.
"""

from __future__ import annotations

from typing import Any, Final

from physiq_research.force_plate.versions import ERROR_CONTRACT

ERROR_MESSAGES: Final[dict[str, str]] = {
    # input files
    "source_unreadable": "The force-plate CSV could not be opened for reading.",
    "source_not_regular_file": "The force-plate CSV must be a regular file.",
    "source_too_large": "The force-plate CSV exceeds the configured maximum size.",
    "document_unreadable": "A JSON input document could not be opened for reading.",
    "document_not_regular_file": "A JSON input document must be a regular file.",
    "document_too_large": "A JSON input document exceeds its configured maximum size.",
    # encoding and JSON
    "invalid_utf8": "The input is not valid UTF-8.",
    "byte_order_mark_not_allowed": "The input starts with a byte-order mark; the canonical format has none.",
    "invalid_json": "The JSON document could not be parsed.",
    "duplicate_json_key": "The JSON document repeats a key within one object.",
    "non_finite_json_number": "The JSON document contains NaN, Infinity or a number outside the double range.",
    # manifest
    "invalid_manifest": "The manifest does not match force-plate-manifest-v0.1.",
    "unsupported_manifest_contract": "Unsupported manifest contract; expected force-plate-manifest-v0.1.",
    "unknown_field": "The document contains a field this contract does not accept.",
    "missing_field": "A required field is missing.",
    "invalid_field": "A field has the wrong type or format.",
    "invalid_data_origin": "data_origin must be 'research_recording' or 'synthetic_test_fixture'.",
    "invalid_assessment_id": "assessment_id must be a UUID in canonical 36-character form.",
    "invalid_research_subject_id": "research_subject_id must be null or a random (version 4) UUID in canonical form.",
    "unsupported_movement": "Unsupported movement. Only 'bodyweight_squat_sagittal' is implemented.",
    "unsupported_capture_mode": "Unsupported capture mode. Only 'single_camera_sagittal' is implemented.",
    "unsupported_plate_configuration": "Unsupported plate configuration. Only 'single_plate_both_feet' is implemented.",
    "unsupported_source_format": "Unsupported source format. Only 'force-plate-csv-v0.1' is accepted.",
    "unsupported_quantity": "Unsupported quantity. Only measured total vertical ground-reaction force is accepted.",
    "unsupported_time_reference": "Unsupported time reference. Time must be seconds since force acquisition start.",
    "unsupported_unit": "Unsupported unit. Time must be declared in 's' and force in 'N'; nothing is converted.",
    "unsupported_axis_convention": "vertical_force_positive_direction must be 'up' or 'down'; it is never inferred.",
    "invalid_source_sha256": "source.sha256 must be 64 lowercase hexadecimal characters.",
    "invalid_body_mass": "body_mass_kg must be a finite JSON number of kilograms within the accepted range.",
    "unsupported_synchronization_method": "synchronization.method must be 'one_anchor_offset' or 'two_anchor_affine'.",
    "invalid_synchronization_anchor": "A synchronization anchor is malformed.",
    # CSV
    "source_digest_mismatch": "The SHA-256 of the force-plate CSV does not match source.sha256 in the manifest.",
    "empty_file": "The force-plate CSV is empty.",
    "malformed_csv": "The force-plate CSV is not well-formed CSV.",
    "missing_column": "A required column is missing from the header.",
    "duplicate_column": "A column appears more than once in the header.",
    "unexpected_column": "The header contains a column the canonical format does not allow.",
    "malformed_row": "A data row does not have exactly one value per header column.",
    "missing_value": "A data row has an empty value.",
    "field_too_long": "A value exceeds the maximum field length.",
    "non_numeric_value": "A value is not a decimal number in the canonical number format.",
    "non_finite_value": "A value is NaN, infinite or outside the double range.",
    "negative_time": "A timestamp is negative; time is seconds since force acquisition start.",
    "time_out_of_range": "A timestamp exceeds the configured maximum time.",
    "duplicate_timestamp": "A timestamp repeats the previous timestamp; samples are never merged or dropped.",
    "timestamp_not_increasing": "A timestamp is earlier than the previous one; samples are never re-sorted.",
    "empty_signal": "The force-plate CSV has a header but no samples.",
    "too_few_samples": "The force-plate CSV has fewer than two samples.",
    "too_many_samples": "The force-plate CSV exceeds the configured maximum number of samples.",
    "duration_exceeded": "The force signal spans more than the configured maximum duration.",
    # M7 linkage
    "assessment_not_found": "No Milestone 7 research assessment with this identifier exists.",
    "assessment_deleted": "The Milestone 7 research assessment was deleted.",
    "assessment_integrity_error": "The Milestone 7 assessment failed its integrity or schema check.",
    "unsupported_assessment_movement": "The linked assessment is not a bodyweight_squat_sagittal assessment.",
    "unsupported_assessment_capture_mode": "The linked assessment is not a single_camera_sagittal assessment.",
    "assessment_declaration_mismatch": "The manifest's movement or capture mode differs from the linked assessment.",
    "research_subject_mismatch": "research_subject_id must equal the linked assessment's research_subject_id.",
    "assessment_media_support_unavailable": "The linked assessment does not record a usable media-time support.",
    "assessment_link_mismatch": "The trial does not match its linked assessment.",
    # synchronization
    "anchor_count_mismatch": "The number of anchors does not match the synchronization method.",
    "anchors_not_increasing": "Anchors must be listed in strictly increasing time in both clocks.",
    "anchors_too_close": "The anchors are closer together than the protocol's minimum separation.",
    "implausible_clock_rate": "The anchors imply a clock-rate ratio outside the protocol's plausibility bound.",
    "anchor_outside_force_support": "An anchor's force time lies outside the recorded force signal.",
    "anchor_outside_video_support": "An anchor's video time lies outside the assessment's media time.",
    "no_temporal_overlap": "The synchronized force signal does not overlap the video.",
    # ground truth
    "repetition_not_covered": "The measured force does not cover the whole Milestone 7 repetition.",
    "force_sampling_gap_in_repetition": (
        "The force signal has a gap longer than the protocol allows within the repetition."
    ),
    "non_positive_vertical_force_in_repetition": (
        "Measured vertical force is zero or negative within the repetition; check the declared positive direction "
        "and the plate zero. Nothing is flipped or corrected automatically."
    ),
    # trials and storage
    "invalid_identifier": "The identifier must be a UUID in canonical form.",
    "trial_not_found": "No force-plate trial with this identifier exists.",
    "trial_deleted": "This force-plate trial was deleted.",
    "stored_data_integrity_error": "The stored record failed its integrity or schema check and is not served.",
    # estimates and evaluation
    "invalid_estimate": "The estimate does not match vertical-grf-estimate-v0.1.",
    "unsupported_estimate_contract": "Unsupported estimate contract; expected vertical-grf-estimate-v0.1.",
    "empty_prediction": "The estimate contains no samples.",
    "prediction_length_mismatch": "t_media_ms and vertical_grf_n must have the same length.",
    "too_many_predictions": "The estimate exceeds the configured maximum number of samples.",
    "non_finite_prediction": "The estimate contains NaN or infinite values.",
    "negative_prediction_time": "A prediction timestamp is negative; media time starts at the first decoded frame.",
    "prediction_timestamps_not_increasing": "Prediction timestamps must be strictly increasing.",
    "estimate_assessment_mismatch": "The estimate was not produced from this trial's Milestone 7 assessment record.",
    "subject_not_held_out": "The trial's participant was used to develop the estimator; it is not held out.",
    "held_out_status_unverifiable": (
        "The estimator declares development participants but the trial has no research_subject_id, so held-out "
        "status cannot be verified."
    ),
    "no_prediction_in_repetition": "No prediction sample lies inside the repetition interval.",
    "insufficient_prediction_samples": "Too few prediction samples lie inside the repetition interval.",
    "prediction_gap_exceeded": "The prediction leaves a gap longer than the protocol allows in the repetition.",
    # study aggregation
    "invalid_study_definition": "The study definition does not match grf-study-definition-v0.1.",
    "duplicate_trial_in_study": "A trial is listed more than once in the study definition.",
    "duplicate_assessment_in_study": "Two included trials pair the same Milestone 7 assessment (one physical trial).",
    "duplicate_force_source_in_study": "Two included trials use the same force-plate recording.",
    "ambiguous_validation_results": "A trial has more than one validation result for the declared estimator.",
    "heterogeneous_versions": "Included results were produced under different versions; aggregate them separately.",
    "mixed_data_origin": "Included trials have different data origins.",
    "no_included_trials": "No trial remains after exclusions.",
    # environment
    "database_not_configured": "RESEARCH_DATABASE_URL is required.",
    "database_unavailable": "The research database could not be reached.",
    "database_not_ready": "The research database is not migrated to the revision this code expects.",
    "invalid_configuration": "A RESEARCH_FORCE_* setting is invalid.",
    "interrupted": "Interrupted; the database transaction was rolled back and nothing was stored.",
    "internal_error": "Internal error.",
}

# Process exit status per error family (0 = success, 2 = command-line usage).
EXIT_INTERNAL: Final = 1
EXIT_REJECTED: Final = 3
EXIT_NOT_FOUND: Final = 4
EXIT_INTEGRITY: Final = 5
EXIT_ENVIRONMENT: Final = 6
EXIT_INTERRUPTED: Final = 130

_EXIT_BY_CODE: Final[dict[str, int]] = {
    "assessment_not_found": EXIT_NOT_FOUND,
    "assessment_deleted": EXIT_NOT_FOUND,
    "trial_not_found": EXIT_NOT_FOUND,
    "trial_deleted": EXIT_NOT_FOUND,
    "assessment_integrity_error": EXIT_INTEGRITY,
    "assessment_link_mismatch": EXIT_INTEGRITY,
    "stored_data_integrity_error": EXIT_INTEGRITY,
    "database_not_configured": EXIT_ENVIRONMENT,
    "database_unavailable": EXIT_ENVIRONMENT,
    "database_not_ready": EXIT_ENVIRONMENT,
    "invalid_configuration": EXIT_ENVIRONMENT,
    "interrupted": EXIT_INTERRUPTED,
    "internal_error": EXIT_INTERNAL,
}


class ForcePlateError(Exception):
    """A classified, expected rejection with a stable code."""

    def __init__(self, code: str, *, field: str | None = None, line: int | None = None) -> None:
        if code not in ERROR_MESSAGES:  # pragma: no cover - programming error
            raise ValueError(f"unregistered force-plate error code {code!r}")
        super().__init__(code)
        self.code = code
        self.field = field
        self.line = line

    @property
    def exit_status(self) -> int:
        return _EXIT_BY_CODE.get(self.code, EXIT_REJECTED)

    def document(self) -> dict[str, Any]:
        error: dict[str, Any] = {"code": self.code, "message": ERROR_MESSAGES[self.code]}
        if self.field is not None:
            error["field"] = self.field
        if self.line is not None:
            error["line"] = self.line
        return {"contract": ERROR_CONTRACT, "error": error}
