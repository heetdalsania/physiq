"""Alembic environment: online migrations against RESEARCH_DATABASE_URL."""

from __future__ import annotations

import os
from logging.config import fileConfig

from alembic import context
from sqlalchemy import pool

from physiq_research.storage.db import make_engine
from physiq_research.storage.tables import metadata

config = context.config
if config.config_file_name is not None and config.attributes.get("configure_logger", True):
    fileConfig(config.config_file_name, disable_existing_loggers=False)

target_metadata = metadata


def _url() -> str:
    url = config.get_main_option("sqlalchemy.url") or os.environ.get("RESEARCH_DATABASE_URL", "")
    if not url:
        raise RuntimeError("RESEARCH_DATABASE_URL is required to run migrations")
    return url


def run_migrations_offline() -> None:
    context.configure(url=_url(), target_metadata=target_metadata, literal_binds=True, render_as_batch=True)
    with context.begin_transaction():
        context.run_migrations()


def run_migrations_online() -> None:
    engine = make_engine(_url(), poolclass=pool.NullPool)
    with engine.connect() as connection:
        context.configure(connection=connection, target_metadata=target_metadata, render_as_batch=True)
        with context.begin_transaction():
            context.run_migrations()
    engine.dispose()


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
