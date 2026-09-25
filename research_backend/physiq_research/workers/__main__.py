"""``python -m physiq_research.workers`` — run one research worker process."""

from __future__ import annotations

import logging
import sys

from physiq_research.config import ConfigError, settings_from_env
from physiq_research.logging_setup import configure_logging
from physiq_research.pose.base import PoseProviderError
from physiq_research.pose.mediapipe_provider import MediaPipePoseProvider
from physiq_research.storage.db import check_ready, make_engine
from physiq_research.storage.repository import ResearchRepository
from physiq_research.versions import DATABASE_SCHEMA_REVISION
from physiq_research.workers.worker import Worker, install_signal_handlers

log = logging.getLogger("physiq_research.worker")


def main() -> int:
    configure_logging()
    try:
        settings = settings_from_env()
    except ConfigError as exc:
        log.error("configuration error: %s", exc)
        return 2
    engine = make_engine(settings.database_url)
    ready = check_ready(engine)
    if not ready["schema_current"]:
        log.error(
            "database schema is %s, expected %s; run `alembic upgrade head`",
            ready["schema_revision"],
            DATABASE_SCHEMA_REVISION,
        )
        return 3
    try:
        provider = MediaPipePoseProvider(settings.pose_model_path)
    except PoseProviderError as exc:
        log.error("pose provider unavailable: %s", exc.code)
        return 4
    log.info(
        "pose provider %s %s, model %s sha256 %s… verified",
        provider.identity["runtime"]["id"],
        provider.identity["installed_runtime_version"],
        provider.identity["model"]["id"],
        provider.identity["model"]["sha256"][:12],
    )
    worker = Worker(settings, ResearchRepository(engine), provider)
    install_signal_handlers(worker)
    worker.maintenance()
    worker.run_forever()
    provider.close()
    return 0


if __name__ == "__main__":
    sys.exit(main())
