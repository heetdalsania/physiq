"""FastAPI application factory and routes.

Routes:
    POST   /research/v1/jobs                    submit one research video → job
    GET    /research/v1/jobs/{job_id}           job status (+ failure code)
    DELETE /research/v1/jobs/{job_id}           cancel / research-delete a job
    GET    /research/v1/assessments/{id}        one derived research record
    DELETE /research/v1/assessments/{id}        research deletion of a record
    GET    /health/live                         liveness (no dependencies)
    GET    /health/ready                        readiness (database + schema + upload dir)

There is deliberately no route that returns video, frames or images (raw
video is never retained), no consumer endpoint, no CORS, and no route that
performs decoding or inference: the POST handler only streams the upload to
a restricted temporary file, hashes it and enqueues a job.

Local-only safeguards (not authentication): the Host header must be a
loopback name (blocks DNS rebinding), and every mutating request must carry
``X-Research-Client`` — a custom header that browsers cannot send
cross-origin without a CORS preflight, which this service never approves.
"""

from __future__ import annotations

import logging
import uuid
from typing import Any

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from sqlalchemy import Engine
from starlette.concurrency import run_in_threadpool
from starlette.exceptions import HTTPException as StarletteHTTPException
from starlette.types import ASGIApp, Message, Receive, Scope, Send

from physiq_research import __version__
from physiq_research.api.errors import SECURITY_HEADERS, ApiError, error_body, error_response
from physiq_research.api.schemas import (
    SCIENTIFIC_NON_CLAIMS,
    ArtifactV1,
    FailureV1,
    HealthV1,
    IntegrityV1,
    JobLinksV1,
    ResearchAssessmentResultV1,
    ResearchDeletionResponseV1,
    ResearchJobResponseV1,
    ScientificScopeV1,
)
from physiq_research.api.upload import receive_submission
from physiq_research.config import Settings
from physiq_research.failures import RETRYABLE_CODES
from physiq_research.media.digest import digest_prefix
from physiq_research.media.tempfiles import delete_upload, ensure_upload_dir
from physiq_research.pipeline.contract import idempotency_key, processing_fingerprint
from physiq_research.records import FailureDiagnostics
from physiq_research.storage.db import check_ready, make_engine
from physiq_research.storage.repository import JobView, ResearchRepository, StoredDataError

log = logging.getLogger(__name__)

MUTATING_METHODS = frozenset({"POST", "PUT", "PATCH", "DELETE"})
CLIENT_HEADER = b"x-research-client"


class LocalOnlyGuard:
    """Pure ASGI middleware (does not buffer request bodies)."""

    def __init__(self, app: ASGIApp, allowed_hosts: tuple[str, ...]) -> None:
        self.app = app
        self.allowed = {h.lower() for h in allowed_hosts}

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return
        headers = dict(scope.get("headers") or [])
        host = headers.get(b"host", b"").decode("latin-1").strip().lower()
        hostname = host.rsplit(":", 1)[0] if not host.startswith("[") else host.split("]")[0] + "]"
        if hostname not in self.allowed:
            await error_response(400, "invalid_host")(scope, receive, send)
            return
        if scope.get("method", "GET").upper() in MUTATING_METHODS and not headers.get(CLIENT_HEADER, b"").strip():
            await error_response(403, "missing_client_header")(scope, receive, send)
            return

        async def send_with_headers(message: Message) -> None:
            if message["type"] == "http.response.start":
                raw = list(message.get("headers") or [])
                present = {k.lower() for k, _ in raw}
                for name, value in SECURITY_HEADERS.items():
                    if name.lower().encode() not in present:
                        raw.append((name.lower().encode(), value.encode()))
                message["headers"] = raw
            await send(message)

        await self.app(scope, receive, send_with_headers)


def _job_response(job: JobView, *, deduplicated: bool = False) -> ResearchJobResponseV1:
    failure = None
    if job.failure_code is not None:
        failure = FailureV1(
            code=job.failure_code,
            detail=job.failure_detail,
            stage=job.failure_stage,
            diagnostics=FailureDiagnostics.model_validate(job.failure_diagnostics) if job.failure_diagnostics else None,
        )
    return ResearchJobResponseV1(
        job_id=job.id,
        status=job.status,  # type: ignore[arg-type]
        deduplicated=deduplicated,
        movement_type=job.movement_type,
        capture_mode=job.capture_mode,
        research_subject_id=job.research_subject_id,
        source_sha256=job.source_sha256,
        source_bytes=job.source_bytes,
        pipeline_version=job.pipeline_version,
        processing_fingerprint=job.processing_fingerprint,
        attempts=job.attempts,
        created_at=job.created_at,
        updated_at=job.updated_at,
        started_at=job.started_at,
        finished_at=job.finished_at,
        deleted_at=job.deleted_at,
        assessment_id=job.assessment_id if job.status in ("succeeded", "deleted") else None,
        failure=failure,
        links=JobLinksV1(
            self=f"/research/v1/jobs/{job.id}",
            assessment=f"/research/v1/assessments/{job.assessment_id}"
            if job.status == "succeeded" and job.assessment_id
            else None,
        ),
    )


def create_app(
    settings: Settings, *, engine: Engine | None = None, repository: ResearchRepository | None = None
) -> FastAPI:
    engine = engine or make_engine(settings.database_url)
    repo = repository or ResearchRepository(engine)
    upload_dir = ensure_upload_dir(settings.upload_dir)
    fingerprint = processing_fingerprint()

    app = FastAPI(
        title="PhysiQ research backend (local prototype)",
        version=__version__,
        docs_url=None,
        redoc_url=None,
        openapi_url="/research/v1/openapi.json",
        debug=False,
    )
    app.state.settings = settings
    app.state.repository = repo
    app.state.engine = engine
    app.state.upload_dir = upload_dir

    # ── error handling: stable codes, never exception text ─────────────
    @app.exception_handler(ApiError)
    async def _api_error(_: Request, exc: ApiError) -> JSONResponse:
        return error_response(exc.status, exc.code, exc.field)

    @app.exception_handler(RequestValidationError)
    async def _validation(_: Request, exc: RequestValidationError) -> JSONResponse:
        loc = exc.errors()[0].get("loc", ()) if exc.errors() else ()
        where = loc[0] if loc else None
        name = str(loc[-1]) if loc else None
        if where == "path":
            return error_response(422, "invalid_identifier", name)
        return error_response(422, "invalid_request", name if where == "query" else None)

    @app.exception_handler(StarletteHTTPException)
    async def _http(_: Request, exc: StarletteHTTPException) -> JSONResponse:
        if exc.status_code == 405:
            return error_response(405, "method_not_allowed")
        if exc.status_code == 404:
            return error_response(404, "route_not_found")
        return error_response(exc.status_code, "invalid_request")

    @app.exception_handler(StoredDataError)
    async def _stored(_: Request, exc: StoredDataError) -> JSONResponse:
        log.error("stored research record rejected on read: %s", exc.code)
        return error_response(500, "stored_data_integrity_error")

    @app.exception_handler(Exception)
    async def _unexpected(_: Request, exc: Exception) -> JSONResponse:
        log.error("unhandled %s in research API", type(exc).__name__)
        if settings.log_tracebacks:
            log.exception("traceback (development logging enabled)")
        return JSONResponse(status_code=500, content=error_body("internal_error"), headers=SECURITY_HEADERS)

    # ── health ─────────────────────────────────────────────────────────
    @app.get("/health/live", response_model=HealthV1)
    async def live() -> HealthV1:
        return HealthV1(status="ok")

    @app.get("/health/ready", response_model=HealthV1, responses={503: {"model": HealthV1}})
    def ready() -> Any:
        checks: dict[str, Any] = {}
        ok = True
        try:
            db = check_ready(engine)
            checks.update(db)
            ok = ok and bool(db["schema_current"])
        except Exception:
            checks["database"] = "unavailable"
            ok = False
        try:
            ensure_upload_dir(settings.upload_dir)
            checks["upload_dir"] = "ok"
        except Exception:
            checks["upload_dir"] = "unavailable"
            ok = False
        body = HealthV1(status="ok" if ok else "not_ready", checks=checks)
        return JSONResponse(
            status_code=200 if ok else 503, content=body.model_dump(mode="json"), headers=SECURITY_HEADERS
        )

    # ── jobs ───────────────────────────────────────────────────────────
    @app.post(
        "/research/v1/jobs",
        response_model=ResearchJobResponseV1,
        status_code=202,
        responses={200: {"model": ResearchJobResponseV1, "description": "Deduplicated submission"}},
    )
    async def submit(request: Request) -> Any:
        submission = await receive_submission(request, settings, upload_dir)
        subject = str(submission.research_subject_id) if submission.research_subject_id else None
        key = idempotency_key(
            source_sha256=submission.source_sha256,
            fingerprint=fingerprint,
            movement_type=submission.movement_type,
            capture_mode=submission.capture_mode,
            research_subject_id=subject,
        )
        try:
            existing = await run_in_threadpool(repo.find_job_by_key, key)
            retryable = {str(code) for code in RETRYABLE_CODES}
            reuse = existing is not None and (
                existing.status in ("queued", "processing", "succeeded")
                or (existing.status == "failed" and existing.failure_code not in retryable)
            )
            if reuse:
                assert existing is not None
                delete_upload(upload_dir, submission.upload_token)
                log.info(
                    "job %s: deduplicated submission (source %s)", existing.id, digest_prefix(submission.source_sha256)
                )
                body = _job_response(existing, deduplicated=True)
                return JSONResponse(status_code=200, content=body.model_dump(mode="json"), headers=SECURITY_HEADERS)
            job = await run_in_threadpool(
                repo.create_job,
                movement_type=submission.movement_type,
                capture_mode=submission.capture_mode,
                research_subject_id=submission.research_subject_id,
                source_sha256=submission.source_sha256,
                source_bytes=submission.source_bytes,
                upload_token=submission.upload_token,
                idempotency_key=key,
                processing_fingerprint=fingerprint,
            )
        except BaseException:
            delete_upload(upload_dir, submission.upload_token)
            raise
        log.info(
            "job %s: queued (source %s, %d bytes)", job.id, digest_prefix(job.source_sha256), job.source_bytes or 0
        )
        body = _job_response(job)
        return JSONResponse(status_code=202, content=body.model_dump(mode="json"), headers=SECURITY_HEADERS)

    @app.get("/research/v1/jobs/{job_id}", response_model=ResearchJobResponseV1)
    def get_job(job_id: uuid.UUID) -> ResearchJobResponseV1:
        job = repo.get_job(job_id)
        if job is None:
            raise ApiError(404, "job_not_found")
        return _job_response(job)

    @app.delete("/research/v1/jobs/{job_id}", response_model=ResearchDeletionResponseV1)
    def delete_job(job_id: uuid.UUID) -> ResearchDeletionResponseV1:
        outcome = repo.delete_job(job_id)
        if outcome.state == "not_found":
            raise ApiError(404, "job_not_found")
        for token in outcome.upload_tokens:
            delete_upload(upload_dir, token)
        log.info("job %s: research deletion (%s)", job_id, outcome.state)
        return ResearchDeletionResponseV1(
            target="job",
            id=job_id,
            state=outcome.state,  # type: ignore[arg-type]
            assessment_id=outcome.assessment_id,
            jobs_tombstoned=outcome.jobs_tombstoned,
            artifacts_removed=outcome.artifacts_removed,
        )

    # ── assessments ────────────────────────────────────────────────────
    @app.get("/research/v1/assessments/{assessment_id}", response_model=ResearchAssessmentResultV1)
    def get_assessment(assessment_id: uuid.UUID, include_artifacts: bool = True) -> ResearchAssessmentResultV1:
        stored = repo.get_assessment(assessment_id, include_artifacts=include_artifacts)
        if stored is None:
            raise ApiError(404, "assessment_not_found")
        artifacts = {
            kind: ArtifactV1(
                schema_version=a.schema_version,
                content_sha256=a.content_sha256,
                byte_size=a.byte_size,
                data=a.data,
            )
            for kind, a in stored.artifacts.items()
        }
        return ResearchAssessmentResultV1(
            assessment_id=stored.id,
            job_id=stored.job_id,
            research_subject_id=stored.research_subject_id,
            movement_type=stored.movement_type,
            capture_mode=stored.capture_mode,
            source_sha256=stored.source_sha256,
            processing_key=stored.processing_key,
            processing_fingerprint=stored.processing_fingerprint,
            pipeline_version=stored.pipeline_version,
            versions=stored.versions,
            provenance=stored.provenance,
            summary=stored.summary,  # type: ignore[arg-type]
            integrity=IntegrityV1(
                record_sha256=stored.record_sha256,
                summary_sha256=stored.summary_sha256,
                provenance_sha256=stored.provenance_sha256,
            ),
            processing_started_at=stored.processing_started_at,
            processing_finished_at=stored.processing_finished_at,
            created_at=stored.created_at,
            artifacts=artifacts,
            artifacts_included=include_artifacts,
            scientific_scope=ScientificScopeV1(non_claims=list(SCIENTIFIC_NON_CLAIMS)),
        )

    @app.delete("/research/v1/assessments/{assessment_id}", response_model=ResearchDeletionResponseV1)
    def delete_assessment(assessment_id: uuid.UUID) -> ResearchDeletionResponseV1:
        outcome = repo.delete_assessment(assessment_id)
        if outcome.state == "not_found":
            raise ApiError(404, "assessment_not_found")
        for token in outcome.upload_tokens:
            delete_upload(upload_dir, token)
        log.info("assessment %s: research deletion (%s)", assessment_id, outcome.state)
        return ResearchDeletionResponseV1(
            target="assessment",
            id=assessment_id,
            state=outcome.state,  # type: ignore[arg-type]
            assessment_id=assessment_id,
            jobs_tombstoned=outcome.jobs_tombstoned,
            artifacts_removed=outcome.artifacts_removed,
        )

    app.add_middleware(LocalOnlyGuard, allowed_hosts=settings.allowed_hosts)
    return app
