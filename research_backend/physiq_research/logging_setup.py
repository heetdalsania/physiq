"""Operational logging.

Log lines carry job/assessment ids, a 12-character source-digest prefix,
stable failure codes and version identities. They never carry video bytes,
frames, landmark arrays, research subject identifiers, the uploaded
filename or FFmpeg's error text (which can contain the temporary path).
"""

from __future__ import annotations

import logging
import os


def configure_logging() -> None:
    level = os.environ.get("RESEARCH_LOG_LEVEL", "INFO").upper()
    logging.basicConfig(
        level=getattr(logging, level, logging.INFO),
        format="%(asctime)s %(levelname)s %(name)s %(message)s",
    )
    # PyAV forwards FFmpeg's log callback to Python logging; FFmpeg messages
    # can quote the input path, so keep them out of the default log.
    logging.getLogger("libav").setLevel(logging.CRITICAL)
