"""Configuration (environment variables prefixed ``RESEARCH_``).

Defaults are conservative and local-only. This service is a local/internal
research prototype and must not be exposed publicly without
authentication, authorization, participant-consent controls and a
production security review.
"""

from __future__ import annotations

import ipaddress
import os
import tempfile
from dataclasses import dataclass, field, replace
from pathlib import Path
from typing import Any

REPO_ROOT = Path(__file__).resolve().parents[2]
DEFAULT_MODEL_PATH = REPO_ROOT / "vendor" / "mediapipe" / "pose_landmarker_full.task"

MIB = 1024 * 1024


class ConfigError(ValueError):
    pass


@dataclass(frozen=True)
class MediaLimits:
    """Bounds on untrusted research media (research-prototype values).

    A 1-repetition squat protocol takes ~5–12 s. The limits leave room for
    positioning while bounding CPU, memory and disk for a malicious file.
    Changing a limit never changes a stored value; it only changes which
    inputs are accepted.
    """

    max_upload_bytes: int = 100 * MIB  # 30 s of 1080p60 HEVC is ~50 MB
    max_duration_ms: int = 30_000
    max_long_side_px: int = 3840  # 4K UHD in either orientation
    max_short_side_px: int = 2160
    max_decoded_frames: int = 3600  # 30 s at 120 fps
    max_pending_uploads: int = 8  # bounds temporary disk use to 8 × max_upload_bytes

    def as_dict(self) -> dict[str, int]:
        return {
            "max_upload_bytes": self.max_upload_bytes,
            "max_duration_ms": self.max_duration_ms,
            "max_long_side_px": self.max_long_side_px,
            "max_short_side_px": self.max_short_side_px,
            "max_decoded_frames": self.max_decoded_frames,
            "max_pending_uploads": self.max_pending_uploads,
        }


@dataclass(frozen=True)
class Settings:
    database_url: str
    upload_dir: Path
    pose_model_path: Path = DEFAULT_MODEL_PATH
    limits: MediaLimits = field(default_factory=MediaLimits)
    api_host: str = "127.0.0.1"
    api_port: int = 8765
    allow_non_loopback_bind: bool = False
    allowed_hosts: tuple[str, ...] = ("127.0.0.1", "localhost", "[::1]", "::1")
    # Uploads waiting longer than this are expired and deleted.
    upload_max_age_s: int = 3600
    lease_seconds: int = 120
    heartbeat_seconds: int = 15
    max_attempts: int = 2
    poll_interval_s: float = 1.0
    log_tracebacks: bool = False

    def with_overrides(self, **changes: Any) -> Settings:
        return replace(self, **changes)


def _bool(value: str) -> bool:
    v = value.strip().lower()
    if v in {"1", "true", "yes", "on"}:
        return True
    if v in {"0", "false", "no", "off", ""}:
        return False
    raise ConfigError(f"not a boolean: {value!r}")


def _int(name: str, value: str, minimum: int = 1) -> int:
    try:
        n = int(value)
    except ValueError as exc:
        raise ConfigError(f"{name} must be an integer") from exc
    if n < minimum:
        raise ConfigError(f"{name} must be ≥ {minimum}")
    return n


def default_upload_dir() -> Path:
    """Application-specific directory under the OS temp dir (per user)."""
    return Path(tempfile.gettempdir()) / f"physiq-research-uploads-{os.getuid()}"


def is_loopback_host(host: str) -> bool:
    if host == "localhost":
        return True
    try:
        return ipaddress.ip_address(host.strip("[]")).is_loopback
    except ValueError:
        return False


def settings_from_env(env: dict[str, str] | None = None) -> Settings:
    e = dict(os.environ if env is None else env)
    url = e.get("RESEARCH_DATABASE_URL", "").strip()
    if not url:
        raise ConfigError("RESEARCH_DATABASE_URL is required (e.g. postgresql+psycopg://…)")
    limits = MediaLimits(
        max_upload_bytes=_int("RESEARCH_MAX_UPLOAD_BYTES", e.get("RESEARCH_MAX_UPLOAD_BYTES", str(100 * MIB))),
        max_duration_ms=_int("RESEARCH_MAX_DURATION_MS", e.get("RESEARCH_MAX_DURATION_MS", "30000")),
        max_long_side_px=_int("RESEARCH_MAX_LONG_SIDE_PX", e.get("RESEARCH_MAX_LONG_SIDE_PX", "3840")),
        max_short_side_px=_int("RESEARCH_MAX_SHORT_SIDE_PX", e.get("RESEARCH_MAX_SHORT_SIDE_PX", "2160")),
        max_decoded_frames=_int("RESEARCH_MAX_DECODED_FRAMES", e.get("RESEARCH_MAX_DECODED_FRAMES", "3600")),
        max_pending_uploads=_int("RESEARCH_MAX_PENDING_UPLOADS", e.get("RESEARCH_MAX_PENDING_UPLOADS", "8")),
    )
    settings = Settings(
        database_url=url,
        upload_dir=Path(e.get("RESEARCH_UPLOAD_DIR") or default_upload_dir()),
        pose_model_path=Path(e.get("RESEARCH_POSE_MODEL_PATH") or DEFAULT_MODEL_PATH),
        limits=limits,
        api_host=e.get("RESEARCH_API_HOST", "127.0.0.1"),
        api_port=_int("RESEARCH_API_PORT", e.get("RESEARCH_API_PORT", "8765")),
        allow_non_loopback_bind=_bool(e.get("RESEARCH_ALLOW_NON_LOOPBACK_BIND", "0")),
        allowed_hosts=tuple(
            h.strip() for h in e.get("RESEARCH_ALLOWED_HOSTS", "127.0.0.1,localhost,[::1],::1").split(",") if h.strip()
        ),
        upload_max_age_s=_int("RESEARCH_UPLOAD_MAX_AGE_S", e.get("RESEARCH_UPLOAD_MAX_AGE_S", "3600")),
        lease_seconds=_int("RESEARCH_LEASE_SECONDS", e.get("RESEARCH_LEASE_SECONDS", "120")),
        heartbeat_seconds=_int("RESEARCH_HEARTBEAT_SECONDS", e.get("RESEARCH_HEARTBEAT_SECONDS", "15")),
        max_attempts=_int("RESEARCH_MAX_ATTEMPTS", e.get("RESEARCH_MAX_ATTEMPTS", "2")),
        poll_interval_s=float(e.get("RESEARCH_POLL_INTERVAL_S", "1.0")),
        log_tracebacks=_bool(e.get("RESEARCH_LOG_TRACEBACKS", "0")),
    )
    validate_bind(settings)
    if "*" in settings.allowed_hosts:
        raise ConfigError("wildcard allowed hosts are not permitted")
    if settings.heartbeat_seconds * 2 > settings.lease_seconds:
        raise ConfigError("RESEARCH_LEASE_SECONDS must be at least twice RESEARCH_HEARTBEAT_SECONDS")
    return settings


def validate_bind(settings: Settings) -> None:
    """Refuse a non-loopback bind unless explicitly allowed (containers only)."""
    if not is_loopback_host(settings.api_host) and not settings.allow_non_loopback_bind:
        raise ConfigError(
            f"refusing to bind {settings.api_host!r}: the research API is local-only. Set "
            "RESEARCH_ALLOW_NON_LOOPBACK_BIND=1 only inside a container whose port is published "
            "to 127.0.0.1."
        )
