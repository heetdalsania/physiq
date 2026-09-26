"""Stable, safe API errors (``research-error-v1``).

Every error response has the same shape and a message chosen from this
table — never an exception string, traceback, file path, request echo or
binary snippet.
"""

from __future__ import annotations

from typing import Any

from fastapi.responses import JSONResponse

from physiq_research.versions import ERROR_CONTRACT

ERROR_MESSAGES: dict[str, str] = {
    "unsupported_media_type": (
        "Send multipart/form-data with one MP4 or QuickTime video part (video/mp4 or video/quicktime)."
    ),
    "upload_too_large": "The upload exceeds the configured maximum size.",
    "malformed_multipart": "The multipart request could not be parsed.",
    "unknown_field": "The request contains a field this API does not accept.",
    "duplicate_field": "A field was sent more than once.",
    "field_too_large": "A form field exceeds its maximum length.",
    "missing_file": "The request must contain exactly one video part named 'video'.",
    "missing_field": "A required field is missing.",
    "unknown_movement": "Unsupported movement type. Only 'bodyweight_squat_sagittal' is implemented.",
    "unsupported_capture_mode": "Unsupported capture mode. Only 'single_camera_sagittal' is implemented.",
    "invalid_research_subject_id": "research_subject_id must be a random (version 4) UUID in canonical form.",
    "invalid_identifier": "The identifier in the path must be a UUID.",
    "invalid_request": "The request is invalid.",
    "queue_full": "Too many videos are waiting to be processed. Try again later.",
    "job_not_found": "No research job with this identifier exists.",
    "assessment_not_found": "No research assessment with this identifier exists.",
    "assessment_not_available": "This job has no assessment.",
    "stored_data_integrity_error": "The stored research record failed its integrity or schema check and is not served.",
    "missing_client_header": "Mutating requests must carry the X-Research-Client header.",
    "invalid_host": "This service only answers requests addressed to a local host name.",
    "route_not_found": "Not found.",
    "method_not_allowed": "Method not allowed.",
    "client_disconnected": "The client disconnected before the upload completed.",
    "internal_error": "Internal error.",
}


class ApiError(Exception):
    def __init__(self, status: int, code: str, field: str | None = None) -> None:
        super().__init__(code)
        self.status = status
        self.code = code
        self.field = field


def error_body(code: str, field: str | None = None) -> dict[str, Any]:
    error: dict[str, Any] = {"code": code, "message": ERROR_MESSAGES.get(code, ERROR_MESSAGES["internal_error"])}
    if field is not None:
        error["field"] = field
    return {"contract": ERROR_CONTRACT, "error": error}


def error_response(status: int, code: str, field: str | None = None) -> JSONResponse:
    return JSONResponse(status_code=status, content=error_body(code, field), headers=SECURITY_HEADERS)


SECURITY_HEADERS = {"Cache-Control": "no-store", "X-Content-Type-Options": "nosniff"}
