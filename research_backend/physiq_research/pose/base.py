"""Pose-provider interface.

A provider is created ONCE per worker process (it loads and verifies the
model bytes). For each video it opens a fresh ``PoseSession``: VIDEO-mode
pose runtimes carry tracking state and require increasing timestamps, and
tracking state must never leak from one research subject's video into
another's. A session is used by one thread only and closed after the video.

``detect`` returns provider-neutral raw output::

    {"landmarks": [ [ {"x", "y", "z", "visibility", "presence"} × 33 ], … ]}

(normalised image coordinates, one inner list per detected person). The
domain layer (domain/pose_frame.py) treats it as untrusted input.
"""

from __future__ import annotations

from typing import Any, Protocol

import numpy as np


class PoseProviderError(RuntimeError):
    """The pose runtime could not be initialised or failed during inference."""

    def __init__(self, code: str) -> None:
        super().__init__(code)
        self.code = code


class PoseSession(Protocol):
    def detect(self, rgb: np.ndarray, timestamp_ms: int) -> dict[str, Any]: ...

    def close(self) -> None: ...


class PoseProvider(Protocol):
    @property
    def identity(self) -> dict[str, Any]: ...

    @property
    def provider_id(self) -> str: ...

    @property
    def model_id(self) -> str: ...

    def open_session(self) -> PoseSession: ...

    def close(self) -> None: ...
