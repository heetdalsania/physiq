"""Local-only defaults and configuration validation."""

from __future__ import annotations

import pytest

from physiq_research.config import ConfigError, MediaLimits, is_loopback_host, settings_from_env

BASE = {"RESEARCH_DATABASE_URL": "sqlite+pysqlite:///:memory:"}


def test_defaults_are_local_only_and_bounded() -> None:
    s = settings_from_env(dict(BASE))
    assert s.api_host == "127.0.0.1"
    assert s.allow_non_loopback_bind is False
    assert "*" not in s.allowed_hosts
    assert s.limits == MediaLimits()
    assert s.limits.max_upload_bytes == 100 * 1024 * 1024
    assert s.limits.max_duration_ms == 30_000
    assert (s.limits.max_long_side_px, s.limits.max_short_side_px) == (3840, 2160)
    assert s.limits.max_decoded_frames == 3600
    assert s.log_tracebacks is False


def test_database_url_is_required() -> None:
    with pytest.raises(ConfigError):
        settings_from_env({})


@pytest.mark.parametrize("host", ["0.0.0.0", "192.168.1.10", "::", "example.org"])
def test_refuses_public_bind_without_explicit_container_opt_in(host: str) -> None:
    with pytest.raises(ConfigError):
        settings_from_env({**BASE, "RESEARCH_API_HOST": host})
    s = settings_from_env({**BASE, "RESEARCH_API_HOST": host, "RESEARCH_ALLOW_NON_LOOPBACK_BIND": "1"})
    assert s.api_host == host


def test_wildcard_allowed_hosts_rejected() -> None:
    with pytest.raises(ConfigError):
        settings_from_env({**BASE, "RESEARCH_ALLOWED_HOSTS": "*"})


def test_limits_are_configurable_and_validated() -> None:
    s = settings_from_env({**BASE, "RESEARCH_MAX_UPLOAD_BYTES": "2048", "RESEARCH_MAX_DURATION_MS": "5000"})
    assert s.limits.max_upload_bytes == 2048
    assert s.limits.max_duration_ms == 5000
    with pytest.raises(ConfigError):
        settings_from_env({**BASE, "RESEARCH_MAX_UPLOAD_BYTES": "0"})
    with pytest.raises(ConfigError):
        settings_from_env({**BASE, "RESEARCH_MAX_DURATION_MS": "lots"})
    with pytest.raises(ConfigError):
        settings_from_env({**BASE, "RESEARCH_LEASE_SECONDS": "10", "RESEARCH_HEARTBEAT_SECONDS": "15"})


@pytest.mark.parametrize(
    ("host", "expected"),
    [("127.0.0.1", True), ("::1", True), ("[::1]", True), ("localhost", True), ("10.0.0.1", False)],
)
def test_loopback_detection(host: str, expected: bool) -> None:
    assert is_loopback_host(host) is expected
