"""The import manifest (``force-plate-manifest-v0.1``).

A JSON document that states EXPLICITLY how the canonical CSV relates to the
canonical measured signal and to the existing Milestone 7 assessment.
Nothing in it is inferred from the data:

    * units are declared (time ``s``, force ``N``) and never converted —
      another unit is rejected, never guessed from magnitude;
    * the positive direction of the vertical-force column is declared
      (``up`` or ``down``); the canonical signal is positive-up, and the
      sign is never inferred from the data;
    * the CSV header is fixed by the format (``time_s``, ``vertical_force_n``)
      — no fuzzy header matching;
    * the SHA-256 of the CSV is declared by whoever exported it and must
      match the bytes read;
    * synchronization anchors are declared event pairs; no alignment is
      derived from the signals.

Data minimization: the only anthropometric field is ``body_mass_kg`` (for
bodyweight normalization). There is no name, e-mail, phone, address, date
of birth, account id, free-text note, filename or consent flag, and any
field not listed here is rejected (``unknown_field``). ``research_subject_id``
is REQUIRED as a key and must equal the linked assessment's value (null when
the assessment has none), so a trial can never silently pair a different
participant with an assessment.
"""

from __future__ import annotations

import math
import re
import uuid
from typing import Annotated, Any, Final, Literal

from pydantic import BaseModel, ConfigDict, Field, ValidationError, field_validator

from physiq_research.force_plate.errors import ForcePlateError
from physiq_research.force_plate.inputs import parse_json_document
from physiq_research.force_plate.versions import (
    CAPTURE_MODE,
    CSV_FORMAT,
    FORCE_TIME_AXIS,
    MANIFEST_CONTRACT,
    MEASURED_QUANTITY,
    MOVEMENT,
    PLATE_CONFIGURATION,
)

# Gross-error guard on the declared body mass, NOT an eligibility rule
# (eligibility belongs to the external study protocol). The bounds reject
# values that cannot be a participant's mass in kilograms, e.g. grams
# (72500) or tonnes (0.0725); nothing is ever converted.
BODY_MASS_KG_MIN: Final = 10.0
BODY_MASS_KG_MAX: Final = 500.0

SHA256_PATTERN: Final = re.compile(r"^[0-9a-f]{64}$")
_CANONICAL_UUID: Final = re.compile(r"^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$")

AnchorEvent = Literal["plate_impact", "trigger_signal", "other_declared_event"]
SyncMethod = Literal["one_anchor_offset", "two_anchor_affine"]
PositiveDirection = Literal["up", "down"]
DataOrigin = Literal["research_recording", "synthetic_test_fixture"]
NonNegativeMs = Annotated[float, Field(ge=0)]


def validate_body_mass_kg(value: object) -> float:
    """A finite JSON number of kilograms within the gross-error bounds."""
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise ForcePlateError("invalid_body_mass", field="body_mass_kg")
    try:
        mass = float(value)
    except OverflowError:
        raise ForcePlateError("invalid_body_mass", field="body_mass_kg") from None
    if not math.isfinite(mass) or not BODY_MASS_KG_MIN <= mass <= BODY_MASS_KG_MAX:
        raise ForcePlateError("invalid_body_mass", field="body_mass_kg")
    return mass


def parse_canonical_uuid(value: object, *, require_v4: bool) -> uuid.UUID:
    if not isinstance(value, str) or not _CANONICAL_UUID.match(value):
        raise ValueError("not a canonical UUID")
    parsed = uuid.UUID(value)
    if require_v4 and parsed.version != 4:
        raise ValueError("not a version 4 UUID")
    return parsed


class _Strict(BaseModel):
    model_config = ConfigDict(strict=True, extra="forbid", frozen=True, allow_inf_nan=False)


class Anchor(_Strict):
    """One declared event observed in BOTH clocks."""

    event: AnchorEvent
    video_time_ms: NonNegativeMs  # M7 media time: (pts − pts₀) × time_base, in ms
    force_time_ms: NonNegativeMs  # force acquisition time, in ms


class SynchronizationSpec(_Strict):
    method: SyncMethod
    anchors: Annotated[list[Anchor], Field(min_length=1, max_length=2)]


class SourceSpec(_Strict):
    format: Literal["force-plate-csv-v0.1"]
    sha256: str
    quantity: Literal["measured_total_vertical_ground_reaction_force"]
    time_reference: Literal["seconds_since_force_acquisition_start"]
    time_unit: Literal["s"]
    force_unit: Literal["N"]
    vertical_force_positive_direction: PositiveDirection

    @field_validator("sha256")
    @classmethod
    def _sha(cls, value: str) -> str:
        if not SHA256_PATTERN.match(value):
            raise ValueError("not a lowercase SHA-256")
        return value


class ForcePlateManifest(_Strict):
    contract: Literal["force-plate-manifest-v0.1"]
    data_origin: DataOrigin
    assessment_id: uuid.UUID
    research_subject_id: uuid.UUID | None
    movement_type: Literal["bodyweight_squat_sagittal"]
    capture_mode: Literal["single_camera_sagittal"]
    plate_configuration: Literal["single_plate_both_feet"]
    body_mass_kg: float
    source: SourceSpec
    synchronization: SynchronizationSpec

    @field_validator("assessment_id", mode="before")
    @classmethod
    def _assessment(cls, value: object) -> uuid.UUID:
        return parse_canonical_uuid(value, require_v4=False)

    @field_validator("research_subject_id", mode="before")
    @classmethod
    def _subject(cls, value: object) -> uuid.UUID | None:
        return None if value is None else parse_canonical_uuid(value, require_v4=True)

    @field_validator("body_mass_kg", mode="before")
    @classmethod
    def _mass(cls, value: object) -> float:
        try:
            return validate_body_mass_kg(value)
        except ForcePlateError:
            raise ValueError("invalid body mass") from None

    def canonical(self) -> dict[str, Any]:
        """JSON form used for digests and provenance (UUIDs lowercase)."""
        return self.model_dump(mode="json")


assert (MANIFEST_CONTRACT, CSV_FORMAT, MEASURED_QUANTITY, FORCE_TIME_AXIS) == (
    "force-plate-manifest-v0.1",
    "force-plate-csv-v0.1",
    "measured_total_vertical_ground_reaction_force",
    "seconds_since_force_acquisition_start",
)
assert (MOVEMENT, CAPTURE_MODE, PLATE_CONFIGURATION) == (
    "bodyweight_squat_sagittal",
    "single_camera_sagittal",
    "single_plate_both_feet",
)

# Validation error → stable code, by field path. Paths are contract field
# names only; an unknown key is never echoed (it could be anything).
_LITERAL_CODES: Final[dict[tuple[str, ...], str]] = {
    ("contract",): "unsupported_manifest_contract",
    ("data_origin",): "invalid_data_origin",
    ("assessment_id",): "invalid_assessment_id",
    ("research_subject_id",): "invalid_research_subject_id",
    ("movement_type",): "unsupported_movement",
    ("capture_mode",): "unsupported_capture_mode",
    ("plate_configuration",): "unsupported_plate_configuration",
    ("body_mass_kg",): "invalid_body_mass",
    ("source", "format"): "unsupported_source_format",
    ("source", "sha256"): "invalid_source_sha256",
    ("source", "quantity"): "unsupported_quantity",
    ("source", "time_reference"): "unsupported_time_reference",
    ("source", "time_unit"): "unsupported_unit",
    ("source", "force_unit"): "unsupported_unit",
    ("source", "vertical_force_positive_direction"): "unsupported_axis_convention",
    ("synchronization", "method"): "unsupported_synchronization_method",
}


def _path(loc: tuple[Any, ...]) -> tuple[str, ...]:
    return tuple(str(p) for p in loc)


def _first_error(exc: ValidationError) -> ForcePlateError:
    """The first error in document order, as a stable code."""
    for err in exc.errors():
        loc = _path(err["loc"])
        kind = err["type"]
        if kind == "extra_forbidden":
            parent = ".".join(p for p in loc[:-1] if not p.isdigit()) or "$"
            return ForcePlateError("unknown_field", field=parent)
        if kind == "missing":
            return ForcePlateError("missing_field", field=".".join(loc))
        if loc and loc[0] == "synchronization" and "anchors" in loc:
            return ForcePlateError("invalid_synchronization_anchor", field="synchronization.anchors")
        code = _LITERAL_CODES.get(loc)
        if code is not None:
            return ForcePlateError(code, field=".".join(loc))
        return ForcePlateError("invalid_field", field=".".join(loc) or "$")
    return ForcePlateError("invalid_manifest")  # pragma: no cover - pydantic always reports one


def parse_manifest(data: bytes) -> ForcePlateManifest:
    value = parse_json_document(data, field="manifest")
    if not isinstance(value, dict):
        raise ForcePlateError("invalid_manifest", field="$")
    if value.get("contract") != MANIFEST_CONTRACT:
        # Check the contract first: a different contract's fields are not ours.
        raise ForcePlateError(
            "unsupported_manifest_contract" if "contract" in value else "missing_field", field="contract"
        )
    try:
        manifest = ForcePlateManifest.model_validate(value)
    except ValidationError as exc:
        raise _first_error(exc) from None
    anchors = manifest.synchronization.anchors
    expected = 1 if manifest.synchronization.method == "one_anchor_offset" else 2
    if len(anchors) != expected:
        raise ForcePlateError("anchor_count_mismatch", field="synchronization.anchors")
    return manifest
