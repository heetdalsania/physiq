"""The research worker: claims jobs, runs the pipeline, stores results.

Process model
    * One worker process = one pose provider (model bytes loaded and
      verified once) = one job at a time on one thread. Concurrency is
      achieved, if ever needed, by running more worker processes; a pose
      session is never shared between threads.
    * The API process never decodes or runs inference; it only enqueues.

Raw-video lifecycle (the high-priority invariant)
    ``process_job`` deletes the job's temporary upload in a ``finally``
    block — after success, after every classified failure, after an
    unexpected exception (including a failed database save), after
    cancellation (job deleted via the API) and after losing the lease. The
    decoder and pose session are closed inside the processor before that.

    A process kill or power loss skips ``finally``. On start-up and every
    ``MAINTENANCE_INTERVAL_S`` the worker therefore (1) recovers jobs whose
    lease expired (re-queue while attempts and the upload remain, otherwise
    fail as ``worker_lost`` and delete the upload), (2) expires queued jobs
    older than ``upload_max_age_s`` and deletes their uploads, and (3) sweeps
    our own upload directory for files no active job references that are
    older than ``ORPHAN_GRACE_S`` (in-flight uploads are younger and keep
    being written).
"""

from __future__ import annotations

import logging
import os
import signal
import socket
import threading
import time
import uuid
from collections.abc import Callable
from dataclasses import dataclass
from typing import Any

from physiq_research.config import Settings
from physiq_research.failures import FailureCode, JobCancelled, LeaseLost, PipelineFailure, Stage
from physiq_research.media.digest import digest_prefix
from physiq_research.media.tempfiles import (
    delete_upload,
    ensure_upload_dir,
    is_valid_token,
    resolve_token,
    sweep_stale,
    upload_exists,
)
from physiq_research.pipeline.processor import FaultInjector, JobInput, ResearchProcessor
from physiq_research.pose.base import PoseProvider
from physiq_research.storage.repository import JobView, ResearchRepository

log = logging.getLogger(__name__)

MAINTENANCE_INTERVAL_S = 60.0
ORPHAN_GRACE_S = 600


@dataclass
class JobOutcome:
    job_id: uuid.UUID
    status: str  # "succeeded" | "failed" | "cancelled" | "lease_lost"
    failure_code: str | None = None
    failure_detail: str | None = None
    failure_stage: str | None = None
    assessment_id: uuid.UUID | None = None
    upload_deleted: bool = False
    timings: dict[str, float] | None = None


class Worker:
    def __init__(
        self,
        settings: Settings,
        repository: ResearchRepository,
        provider: PoseProvider,
        *,
        faults: FaultInjector | None = None,
        owner: str | None = None,
        monotonic: Callable[[], float] = time.monotonic,
    ) -> None:
        self.settings = settings
        self.repo = repository
        self.provider = provider
        self.faults = faults
        self.owner = owner or f"worker-{socket.gethostname()[:32]}-{os.getpid()}-{uuid.uuid4().hex[:8]}"
        self.monotonic = monotonic
        self.upload_dir = ensure_upload_dir(settings.upload_dir)
        self._stop = threading.Event()
        self._last_maintenance = -float("inf")

    # ── maintenance ─────────────────────────────────────────────────────
    def maintenance(self) -> dict[str, Any]:
        recovered = self.repo.recover_expired(
            max_attempts=self.settings.max_attempts,
            upload_exists=lambda token: upload_exists(self.upload_dir, token),
        )
        for job_id, action, token in recovered:
            if token:
                delete_upload(self.upload_dir, token)
            log.warning("job %s: lease expired → %s", job_id, action)
        expired = self.repo.expire_old_queued(self.settings.upload_max_age_s)
        for job_id, token in expired:
            delete_upload(self.upload_dir, token)
            log.warning("job %s: upload expired in queue; deleted", job_id)
        swept = sweep_stale(self.upload_dir, max_age_s=ORPHAN_GRACE_S, keep=self.repo.active_upload_tokens())
        if swept:
            log.warning("swept %d orphaned upload file(s)", len(swept))
        self._last_maintenance = self.monotonic()
        return {"recovered": recovered, "expired": expired, "swept": swept}

    # ── processing ──────────────────────────────────────────────────────
    def process_next(self) -> JobOutcome | None:
        job = self.repo.claim_next(self.owner, self.settings.lease_seconds)
        if job is None:
            return None
        return self.process_job(job)

    def process_job(self, job: JobView) -> JobOutcome:
        token = job.upload_token
        processor = ResearchProcessor(self.settings, self.provider, faults=self.faults)
        last_beat = -float("inf")

        def checkpoint(immediately: bool = False) -> None:
            nonlocal last_beat
            now = self.monotonic()
            if immediately or now - last_beat >= self.settings.heartbeat_seconds:
                self.repo.heartbeat(job.id, self.owner, self.settings.lease_seconds)
                last_beat = now

        outcome = JobOutcome(job_id=job.id, status="failed")
        log.info("job %s: processing (attempt %d, source %s)", job.id, job.attempts, digest_prefix(job.source_sha256))
        try:
            checkpoint(immediately=True)
            if not is_valid_token(token) or not upload_exists(self.upload_dir, token):
                raise PipelineFailure(FailureCode.PIPELINE_ERROR, "upload_missing", Stage.QUEUE)
            assert token is not None and job.source_sha256 and job.source_bytes is not None
            assert job.movement_type and job.capture_mode and job.processing_fingerprint and job.idempotency_key
            job_input = JobInput(
                job_id=job.id,
                upload_path=resolve_token(self.upload_dir, token),
                expected_sha256=job.source_sha256,
                expected_bytes=job.source_bytes,
                movement_type=job.movement_type,
                capture_mode=job.capture_mode,
                research_subject_id=job.research_subject_id,
                processing_fingerprint=job.processing_fingerprint,
                processing_key=job.idempotency_key,
            )
            record = processor.process(job_input, checkpoint)
            processor.stage = Stage.DATABASE_SAVE
            if self.faults is not None:
                self.faults(Stage.DATABASE_SAVE)
            assessment_id = self.repo.save_success(record, self.owner)
            outcome.status = "succeeded"
            outcome.assessment_id = assessment_id
            log.info("job %s: succeeded → assessment %s", job.id, assessment_id)
        except PipelineFailure as failure:
            self._fail(job, outcome, failure.code, failure.detail, failure.stage.value, failure.diagnostics)
        except JobCancelled:
            outcome.status = "cancelled"
            log.info("job %s: cancelled (deleted) during processing", job.id)
        except LeaseLost:
            outcome.status = "lease_lost"
            log.warning("job %s: lease lost; result discarded", job.id)
        except Exception as exc:
            log.warning("job %s: unexpected %s at stage %s", job.id, type(exc).__name__, processor.stage.value)
            if self.settings.log_tracebacks:
                log.exception("traceback (development logging enabled)")
            self._fail(job, outcome, FailureCode.PIPELINE_ERROR, "unexpected_exception", processor.stage.value, None)
        finally:
            removed = delete_upload(self.upload_dir, token)
            outcome.upload_deleted = not upload_exists(self.upload_dir, token)
            outcome.timings = dict(processor.timings)
            log.info("job %s: temporary upload %s", job.id, "deleted" if removed else "already absent")
        return outcome

    def _fail(
        self,
        job: JobView,
        outcome: JobOutcome,
        code: FailureCode,
        detail: str,
        stage: str,
        diagnostics: dict[str, Any] | None,
    ) -> None:
        outcome.failure_code = str(code)
        outcome.failure_detail = detail
        outcome.failure_stage = stage
        try:
            stored = self.repo.mark_failed(
                job.id, self.owner, code=code, detail=detail, stage=stage, diagnostics=diagnostics
            )
        except Exception as exc:  # database down: the lease expiry recovers the job later
            log.error("job %s: could not record failure (%s)", job.id, type(exc).__name__)
            stored = False
        outcome.status = "failed" if stored else "lease_lost"
        log.info("job %s: failed %s/%s at %s", job.id, code, detail, stage)

    # ── loop ────────────────────────────────────────────────────────────
    def stop(self) -> None:
        self._stop.set()

    def run_forever(self) -> None:
        log.info("research worker %s started", self.owner)
        while not self._stop.is_set():
            if self.monotonic() - self._last_maintenance >= MAINTENANCE_INTERVAL_S:
                try:
                    self.maintenance()
                except Exception as exc:
                    log.error("maintenance failed (%s)", type(exc).__name__)
            try:
                outcome = self.process_next()
            except Exception as exc:
                log.error("claim failed (%s)", type(exc).__name__)
                outcome = None
            if outcome is None:
                self._stop.wait(self.settings.poll_interval_s)
        log.info("research worker %s stopped", self.owner)


def install_signal_handlers(worker: Worker) -> None:
    def _handle(signum: int, _frame: Any) -> None:
        log.info("signal %d: finishing the current job, then stopping", signum)
        worker.stop()

    signal.signal(signal.SIGTERM, _handle)
    signal.signal(signal.SIGINT, _handle)
