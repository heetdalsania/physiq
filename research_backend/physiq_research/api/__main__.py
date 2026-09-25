"""``python -m physiq_research.api`` — serve the research API with uvicorn.

Binds 127.0.0.1:8765 by default and refuses a non-loopback address unless
RESEARCH_ALLOW_NON_LOOPBACK_BIND=1 (containers whose port is published to
127.0.0.1 only). No TLS, no authentication: local research use only.
"""

from __future__ import annotations

import logging
import sys

import uvicorn

from physiq_research.api.app import create_app
from physiq_research.config import ConfigError, settings_from_env
from physiq_research.logging_setup import configure_logging

log = logging.getLogger("physiq_research.api")


def main() -> int:
    configure_logging()
    try:
        settings = settings_from_env()
    except ConfigError as exc:
        log.error("configuration error: %s", exc)
        return 2
    app = create_app(settings)
    uvicorn.run(
        app,
        host=settings.api_host,
        port=settings.api_port,
        proxy_headers=False,
        server_header=False,
        date_header=False,
        access_log=True,
        log_config=None,
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
