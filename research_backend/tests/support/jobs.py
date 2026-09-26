"""Enqueue a file as a research job without HTTP (worker/pipeline tests)."""

from __future__ import annotations

import os
import uuid
from pathlib import Path

from physiq_research.config import Settings
from physiq_research.media.digest import file_sha256
from physiq_research.media.tempfiles import create_upload_file, ensure_upload_dir
from physiq_research.pipeline.contract import idempotency_key, processing_fingerprint
from physiq_research.storage.repository import JobView, ResearchRepository
from physiq_research.versions import CAPTURE_MODE_SINGLE_CAMERA_SAGITTAL, MOVEMENT_BODYWEIGHT_SQUAT_SAGITTAL


def stage_upload(settings: Settings, source: Path) -> str:
    upload_dir = ensure_upload_dir(settings.upload_dir)
    token, fd = create_upload_file(upload_dir)
    with os.fdopen(fd, "wb") as out:
        out.write(Path(source).read_bytes())
    return token


def enqueue_file(
    settings: Settings,
    repo: ResearchRepository,
    source: Path,
    *,
    subject: uuid.UUID | None = None,
    fingerprint: str | None = None,
) -> JobView:
    token = stage_upload(settings, source)
    digest, size = file_sha256(Path(settings.upload_dir) / token)
    fp = fingerprint or processing_fingerprint()
    key = idempotency_key(
        source_sha256=digest,
        fingerprint=fp,
        movement_type=MOVEMENT_BODYWEIGHT_SQUAT_SAGITTAL,
        capture_mode=CAPTURE_MODE_SINGLE_CAMERA_SAGITTAL,
        research_subject_id=str(subject) if subject else None,
    )
    return repo.create_job(
        movement_type=MOVEMENT_BODYWEIGHT_SQUAT_SAGITTAL,
        capture_mode=CAPTURE_MODE_SINGLE_CAMERA_SAGITTAL,
        research_subject_id=subject,
        source_sha256=digest,
        source_bytes=size,
        upload_token=token,
        idempotency_key=key,
        processing_fingerprint=fp,
    )
