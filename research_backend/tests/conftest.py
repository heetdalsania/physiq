"""Shared fixtures. Every test gets its own SQLite database (migrated with
the real Alembic migrations) and its own restricted upload directory, so
the suite needs no external services. The Postgres integration tests
(``-m postgres``) use RESEARCH_TEST_POSTGRES_URL instead."""

from __future__ import annotations

import os
from collections.abc import Iterator
from pathlib import Path

import pytest
from sqlalchemy import Engine

from physiq_research.config import MediaLimits, Settings
from physiq_research.storage.db import make_engine, upgrade
from physiq_research.storage.repository import ResearchRepository
from tests.support.providers import DotPoseProvider

API_BASE = "http://127.0.0.1:8765"
CLIENT_HEADERS = {"X-Research-Client": "pytest"}


@pytest.fixture
def settings(tmp_path: Path) -> Settings:
    return Settings(
        database_url=f"sqlite+pysqlite:///{tmp_path / 'research.db'}",
        upload_dir=tmp_path / "uploads",
        limits=MediaLimits(),
        lease_seconds=60,
        heartbeat_seconds=5,
        max_attempts=2,
        poll_interval_s=0.01,
    )


@pytest.fixture
def engine(settings: Settings) -> Iterator[Engine]:
    upgrade(settings.database_url)
    eng = make_engine(settings.database_url)
    yield eng
    eng.dispose()


@pytest.fixture
def repo(engine: Engine) -> ResearchRepository:
    return ResearchRepository(engine)


def _postgres_database(admin_url: str) -> Iterator[str]:
    """A fresh, empty Postgres database per test (dropped afterwards)."""
    import uuid

    from sqlalchemy import create_engine, text
    from sqlalchemy.engine import make_url

    name = f"research_test_{uuid.uuid4().hex[:12]}"
    admin = create_engine(admin_url, isolation_level="AUTOCOMMIT")
    with admin.connect() as c:
        c.execute(text(f'CREATE DATABASE "{name}" TEMPLATE template0'))
    try:
        yield make_url(admin_url).set(database=name).render_as_string(hide_password=False)
    finally:
        with admin.connect() as c:
            c.execute(text(f'DROP DATABASE IF EXISTS "{name}" WITH (FORCE)'))
        admin.dispose()


@pytest.fixture(params=["sqlite", pytest.param("postgres", marks=pytest.mark.postgres)])
def db_settings(request: pytest.FixtureRequest, tmp_path: Path) -> Iterator[Settings]:
    """Settings on SQLite, and — with RESEARCH_TEST_POSTGRES_URL — on a real,
    freshly created Postgres database. Not yet migrated."""
    base = Settings(
        database_url=f"sqlite+pysqlite:///{tmp_path / 'research.db'}",
        upload_dir=tmp_path / "uploads",
        lease_seconds=60,
        heartbeat_seconds=5,
        poll_interval_s=0.01,
    )
    if request.param == "sqlite":
        yield base
        return
    admin_url = os.environ["RESEARCH_TEST_POSTGRES_URL"]
    yield from (base.with_overrides(database_url=url) for url in _postgres_database(admin_url))


@pytest.fixture
def db_repo(db_settings: Settings) -> Iterator[ResearchRepository]:
    upgrade(db_settings.database_url)
    eng = make_engine(db_settings.database_url)
    yield ResearchRepository(eng)
    eng.dispose()


@pytest.fixture
def dot_provider() -> DotPoseProvider:
    return DotPoseProvider()


@pytest.fixture(scope="session")
def video_dir(tmp_path_factory: pytest.TempPathFactory) -> Path:
    return tmp_path_factory.mktemp("videos")


@pytest.fixture(scope="session")
def squat_video(video_dir: Path) -> Path:
    """Portrait 360×640, 30 fps CFR, the M6 hand-checkable squat."""
    from tests.support.videos import write_dot_squat_video

    return write_dot_squat_video(video_dir / "squat_cfr30.mp4")


def pytest_collection_modifyitems(config: pytest.Config, items: list[pytest.Item]) -> None:
    pg = os.environ.get("RESEARCH_TEST_POSTGRES_URL")
    real = os.environ.get("RESEARCH_TEST_REAL_POSE") == "1"
    for item in items:
        if "postgres" in item.keywords and not pg:
            item.add_marker(pytest.mark.skip(reason="set RESEARCH_TEST_POSTGRES_URL to run Postgres integration tests"))
        if ("real_pose" in item.keywords or "netmon" in item.keywords) and not real:
            item.add_marker(pytest.mark.skip(reason="set RESEARCH_TEST_REAL_POSE=1 to run the real MediaPipe runtime"))
