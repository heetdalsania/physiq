"""Streaming, bounded multipart intake for one research video.

The request body is parsed incrementally (python-multipart's low-level
parser) and the video part is written straight into ONE restricted
temporary file (media/tempfiles.py) while its SHA-256 is computed. There is
no second spooled copy, the byte limit is enforced while streaming (the
upload is aborted and the file deleted the moment it is exceeded), and the
client's filename is never read into any path.

Accepted parts (anything else is rejected — the API takes no free text and
no personal data):
    video                 the file (declared type video/mp4 or
                          video/quicktime; content must start with an ISO
                          BMFF ``ftyp`` box)
    movement_type         "bodyweight_squat_sagittal"
    capture_mode          "single_camera_sagittal"
    research_subject_id   optional opaque UUID

On ANY rejection or exception the temporary file is deleted before the
error is returned.
"""

from __future__ import annotations

import hashlib
import os
import uuid
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from python_multipart.exceptions import MultipartParseError
from python_multipart.multipart import MultipartParser, parse_options_header
from starlette.requests import ClientDisconnect, Request

from physiq_research.api.errors import ApiError
from physiq_research.config import Settings
from physiq_research.media.sniff import SNIFF_BYTES, looks_like_iso_bmff
from physiq_research.media.tempfiles import create_upload_file, delete_upload, list_uploads
from physiq_research.versions import SUPPORTED_CAPTURE_MODES, SUPPORTED_MOVEMENTS

TEXT_FIELDS = ("movement_type", "capture_mode", "research_subject_id")
FILE_FIELD = "video"
ALLOWED_VIDEO_TYPES = frozenset({"video/mp4", "video/quicktime"})
MAX_TEXT_FIELD_BYTES = 128
MAX_PARTS = 8
# Room for boundaries, part headers and the small text fields.
FORM_OVERHEAD_BYTES = 64 * 1024


@dataclass
class Submission:
    upload_token: str
    source_sha256: str
    source_bytes: int
    movement_type: str
    capture_mode: str
    research_subject_id: uuid.UUID | None


@dataclass
class _Part:
    headers: dict[str, bytes] = field(default_factory=dict)
    name: str | None = None
    is_file: bool = False
    text: bytearray = field(default_factory=bytearray)


class _Intake:
    """Parser callbacks. Raise ApiError to abort; the caller cleans up."""

    def __init__(self, fd: int, max_bytes: int) -> None:
        self.fd = fd
        self.max_bytes = max_bytes
        self.hash = hashlib.sha256()
        self.size = 0
        self.head = bytearray()
        self.sniffed = False
        self.parts = 0
        self.seen: set[str] = set()
        self.text: dict[str, str] = {}
        self.file_parts = 0
        self.part: _Part | None = None
        self._header_field = bytearray()
        self._header_value = bytearray()

    # header plumbing
    def on_part_begin(self) -> None:
        self.parts += 1
        if self.parts > MAX_PARTS:
            raise ApiError(400, "malformed_multipart")
        self.part = _Part()

    def on_header_field(self, data: bytes, start: int, end: int) -> None:
        self._header_field += data[start:end]

    def on_header_value(self, data: bytes, start: int, end: int) -> None:
        self._header_value += data[start:end]

    def on_header_end(self) -> None:
        assert self.part is not None
        self.part.headers[bytes(self._header_field).decode("latin-1").strip().lower()] = bytes(
            self._header_value
        ).strip()
        self._header_field = bytearray()
        self._header_value = bytearray()

    def on_headers_finished(self) -> None:
        part = self.part
        assert part is not None
        disposition = part.headers.get("content-disposition")
        if disposition is None:
            raise ApiError(400, "malformed_multipart")
        kind, params = parse_options_header(disposition)
        if kind != b"form-data" or b"name" not in params:
            raise ApiError(400, "malformed_multipart")
        try:
            name = params[b"name"].decode("utf-8")
        except UnicodeDecodeError:
            raise ApiError(400, "malformed_multipart") from None
        if name != FILE_FIELD and name not in TEXT_FIELDS:
            raise ApiError(422, "unknown_field")
        if name in self.seen:
            raise ApiError(422, "duplicate_field", name)
        self.seen.add(name)
        part.name = name
        # The filename parameter is deliberately ignored (never used in a path).
        if name == FILE_FIELD:
            part.is_file = True
            self.file_parts += 1
            declared, _ = parse_options_header(part.headers.get("content-type", b""))
            if declared.decode("latin-1").lower() not in ALLOWED_VIDEO_TYPES:
                raise ApiError(415, "unsupported_media_type", FILE_FIELD)

    def on_part_data(self, data: bytes, start: int, end: int) -> None:
        part = self.part
        assert part is not None
        chunk = data[start:end]
        if not part.is_file:
            part.text += chunk
            if len(part.text) > MAX_TEXT_FIELD_BYTES:
                raise ApiError(422, "field_too_large", part.name)
            return
        self.size += len(chunk)
        if self.size > self.max_bytes:
            raise ApiError(413, "upload_too_large", FILE_FIELD)
        if not self.sniffed:
            self.head += chunk[: SNIFF_BYTES - len(self.head)]
            if len(self.head) >= SNIFF_BYTES:
                if not looks_like_iso_bmff(bytes(self.head)):
                    raise ApiError(415, "unsupported_media_type", FILE_FIELD)
                self.sniffed = True
        self.hash.update(chunk)
        view = memoryview(chunk)
        while view:
            written = os.write(self.fd, view)
            view = view[written:]

    def on_part_end(self) -> None:
        part = self.part
        assert part is not None
        if part.is_file:
            if not self.sniffed:
                raise ApiError(415, "unsupported_media_type", FILE_FIELD)
        elif part.name is not None:
            try:
                value = bytes(part.text).decode("utf-8").strip()
            except UnicodeDecodeError:
                raise ApiError(422, "invalid_request", part.name) from None
            self.text[part.name] = value
            _validate_text(part.name, value)
        self.part = None

    def callbacks(self) -> dict[str, Any]:
        return {
            "on_part_begin": self.on_part_begin,
            "on_header_field": self.on_header_field,
            "on_header_value": self.on_header_value,
            "on_header_end": self.on_header_end,
            "on_headers_finished": self.on_headers_finished,
            "on_part_data": self.on_part_data,
            "on_part_end": self.on_part_end,
        }


def _validate_text(name: str, value: str) -> None:
    if name == "movement_type" and value not in SUPPORTED_MOVEMENTS:
        raise ApiError(422, "unknown_movement", name)
    if name == "capture_mode" and value not in SUPPORTED_CAPTURE_MODES:
        raise ApiError(422, "unsupported_capture_mode", name)
    if name == "research_subject_id" and value:
        # Canonical 36-character random (version 4) UUID only: other UUID
        # versions can embed a MAC address or a timestamp.
        try:
            parsed = uuid.UUID(value)
        except ValueError:
            raise ApiError(422, "invalid_research_subject_id", name) from None
        if len(value) != 36 or parsed.version != 4:
            raise ApiError(422, "invalid_research_subject_id", name)


async def receive_submission(request: Request, settings: Settings, upload_dir: Path) -> Submission:
    content_type = request.headers.get("content-type")
    if not content_type:
        raise ApiError(415, "unsupported_media_type")
    mime, params = parse_options_header(content_type)
    if mime != b"multipart/form-data":
        raise ApiError(415, "unsupported_media_type")
    boundary = params.get(b"boundary")
    if not boundary or len(boundary) > 70:
        raise ApiError(400, "malformed_multipart")
    max_bytes = settings.limits.max_upload_bytes
    declared_length = request.headers.get("content-length")
    if declared_length is not None:
        try:
            if int(declared_length) > max_bytes + FORM_OVERHEAD_BYTES:
                raise ApiError(413, "upload_too_large")
        except ValueError:
            raise ApiError(400, "malformed_multipart") from None
    if len(list_uploads(upload_dir)) >= settings.limits.max_pending_uploads:
        raise ApiError(503, "queue_full")

    token, fd = create_upload_file(upload_dir)
    intake = _Intake(fd, max_bytes)
    ok = False
    try:
        parser = MultipartParser(boundary, intake.callbacks(), max_header_count=8, max_header_size=4096)  # type: ignore[arg-type]
        total = 0
        async for chunk in request.stream():
            total += len(chunk)
            if total > max_bytes + FORM_OVERHEAD_BYTES:
                raise ApiError(413, "upload_too_large")
            parser.write(chunk)
        parser.finalize()
        if intake.part is not None:
            raise ApiError(400, "malformed_multipart")
        if intake.file_parts != 1 or intake.size == 0:
            raise ApiError(422, "missing_file", FILE_FIELD)
        for required in ("movement_type", "capture_mode"):
            if required not in intake.text:
                raise ApiError(422, "missing_field", required)
        os.fsync(fd)
        subject = intake.text.get("research_subject_id") or None
        submission = Submission(
            upload_token=token,
            source_sha256=intake.hash.hexdigest(),
            source_bytes=intake.size,
            movement_type=intake.text["movement_type"],
            capture_mode=intake.text["capture_mode"],
            research_subject_id=uuid.UUID(subject) if subject else None,
        )
        ok = True
        return submission
    except ApiError:
        raise
    except MultipartParseError:
        raise ApiError(400, "malformed_multipart") from None
    except ClientDisconnect:
        raise ApiError(400, "client_disconnected") from None
    except (ValueError, UnicodeDecodeError):
        raise ApiError(400, "malformed_multipart") from None
    finally:
        os.close(fd)
        if not ok:
            delete_upload(upload_dir, token)
