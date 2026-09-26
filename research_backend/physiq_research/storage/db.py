"""Engine creation, migrations and readiness checks."""

from __future__ import annotations

from pathlib import Path
from typing import Any

from sqlalchemy import Engine, create_engine, event, text

from physiq_research.canonical import strict_json_dumps, strict_json_loads
from physiq_research.versions import DATABASE_SCHEMA_REVISION

BACKEND_ROOT = Path(__file__).resolve().parents[2]
ALEMBIC_INI = BACKEND_ROOT / "alembic.ini"
MIGRATIONS_DIR = BACKEND_ROOT / "migrations"


def make_engine(url: str, **kwargs: Any) -> Engine:
    """JSON columns are (de)serialized strictly: NaN/Infinity are rejected."""
    engine = create_engine(
        url,
        json_serializer=strict_json_dumps,
        json_deserializer=strict_json_loads,
        pool_pre_ping=True,
        future=True,
        **kwargs,
    )
    if engine.dialect.name == "sqlite":

        @event.listens_for(engine, "connect")
        def _sqlite_pragmas(dbapi_connection: Any, _record: Any) -> None:
            cursor = dbapi_connection.cursor()
            cursor.execute("PRAGMA foreign_keys=ON")
            cursor.execute("PRAGMA busy_timeout=5000")
            cursor.close()

    return engine


def alembic_config(url: str) -> Any:
    from alembic.config import Config

    cfg = Config(str(ALEMBIC_INI))
    cfg.set_main_option("script_location", str(MIGRATIONS_DIR))
    cfg.set_main_option("sqlalchemy.url", url.replace("%", "%%"))
    return cfg


def upgrade(url: str, revision: str = "head") -> None:
    from alembic import command

    command.upgrade(alembic_config(url), revision)


def downgrade(url: str, revision: str) -> None:
    from alembic import command

    command.downgrade(alembic_config(url), revision)


def current_revision(engine: Engine) -> str | None:
    with engine.connect() as conn:
        try:
            row = conn.execute(text("SELECT version_num FROM alembic_version")).first()
        except Exception:
            return None
    return row[0] if row else None


def check_ready(engine: Engine) -> dict[str, Any]:
    """Database reachable and migrated to the revision this code expects."""
    with engine.connect() as conn:
        conn.execute(text("SELECT 1"))
    revision = current_revision(engine)
    return {"database": "ok", "schema_revision": revision, "schema_current": revision == DATABASE_SCHEMA_REVISION}
