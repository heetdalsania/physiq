"""Force-plate input contract: strict CSV parser, manifest, body mass.

SYNTHETIC TEST FIXTURE — NOT HUMAN DATA — NOT VALIDATION EVIDENCE.
Rejections must carry stable codes and never echo input values, keys, file
names or paths.
"""

from __future__ import annotations

import json
import math
import uuid
from pathlib import Path
from typing import Any

import numpy as np
import pytest

from physiq_research.force_plate.errors import ERROR_MESSAGES, ForcePlateError
from physiq_research.force_plate.inputs import parse_json_document, read_bounded
from physiq_research.force_plate.limits import ForcePlateLimits, limits_from_env
from physiq_research.force_plate.manifest import (
    BODY_MASS_KG_MAX,
    BODY_MASS_KG_MIN,
    parse_manifest,
    validate_body_mass_kg,
)
from physiq_research.force_plate.signal import parse_force_csv
from tests.support.force_fixtures import csv_bytes, make_fixture

LIMITS = ForcePlateLimits()
HEADER = b"time_s,vertical_force_n\n"


def parse(data: bytes, direction: str = "up", limits: ForcePlateLimits = LIMITS) -> Any:
    return parse_force_csv(data, positive_direction=direction, limits=limits)  # type: ignore[arg-type]


def code_of(fn: Any, *args: Any, **kwargs: Any) -> ForcePlateError:
    with pytest.raises(ForcePlateError) as info:
        fn(*args, **kwargs)
    return info.value


# ── valid canonical CSV ─────────────────────────────────────────────────


def test_valid_canonical_csv_is_parsed_exactly() -> None:
    data = HEADER + b"0,700.5\n0.001,701.25\n0.002,-3.5e-2\n1e-2,1E3\n"
    signal = parse(data)
    assert signal.time_s.tolist() == [0.0, 0.001, 0.002, 0.01]
    assert signal.vertical_grf_n.tolist() == [700.5, 701.25, -0.035, 1000.0]
    assert signal.sample_count == 4 and signal.sign_multiplier == 1
    assert not signal.time_s.flags.writeable and not signal.vertical_grf_n.flags.writeable


def test_crlf_and_either_column_order_are_equivalent() -> None:
    lf = parse(HEADER + b"0,1\n0.5,2\n")
    crlf = parse(b"time_s,vertical_force_n\r\n0,1\r\n0.5,2\r\n")
    swapped = parse(b"vertical_force_n,time_s\n1,0\n2,0.5\n")
    for s in (crlf, swapped):
        assert s.time_s.tolist() == lf.time_s.tolist() and s.vertical_grf_n.tolist() == lf.vertical_grf_n.tolist()


def test_positive_down_is_canonicalized_to_positive_up_exactly() -> None:
    down = parse(HEADER + b"0,-700.125\n0.001,-0\n0.002,12.5\n", "down")
    assert down.vertical_grf_n.tolist() == [700.125, 0.0, -12.5]
    assert down.sign_multiplier == -1 and down.source_positive_direction == "down"


def test_sampling_statistics_use_real_timestamps() -> None:
    s = parse(HEADER + b"0,1\n0.001,1\n0.003,1\n0.004,1\n")
    stats = s.sampling()
    assert stats["sample_count"] == 4 and stats["span_s"] == 0.004
    assert stats["max_interval_s"] == pytest.approx(0.002) and stats["min_interval_s"] == pytest.approx(0.001)
    assert stats["mean_rate_hz"] == pytest.approx(750.0)


# ── malformed input ─────────────────────────────────────────────────────


@pytest.mark.parametrize(
    ("data", "code", "line"),
    [
        (b"", "empty_file", None),
        (b"\xef\xbb\xbftime_s,vertical_force_n\n0,1\n0.1,1\n", "byte_order_mark_not_allowed", None),
        (b"time_s,vertical_force_n\n0,1\n\xff\xfe,1\n", "invalid_utf8", None),
        (HEADER, "empty_signal", None),
        (HEADER + b"0,700\n", "too_few_samples", None),
        (HEADER + b"0,1\r7\n", "malformed_csv", 2),
        (b"time_s,vertical_force_n\r0,1\r0.1,1\r", "malformed_csv", 1),
        (HEADER + b"0," + b"1" * 200_000 + b"\n0.1,1\n", "malformed_csv", 2),
        (HEADER + b'"0","1"\n0.1,1\n', "non_numeric_value", 2),
        (HEADER + b"0,1\n\n0.2,1\n", "malformed_row", 3),
        (HEADER + b"0,1,2\n", "malformed_row", 2),
        (HEADER + b"0\n", "malformed_row", 2),
        (HEADER + b"0,1\n0.1,\n", "missing_value", 3),
        (HEADER + b",1\n0.1,1\n", "missing_value", 2),
        (HEADER + b"0,nan\n0.1,1\n", "non_finite_value", 2),
        (HEADER + b"0,1\n0.1,NaN\n", "non_finite_value", 3),
        (HEADER + b"0,inf\n0.1,1\n", "non_finite_value", 2),
        (HEADER + b"0,-Infinity\n0.1,1\n", "non_finite_value", 2),
        (HEADER + b"0,1e999\n0.1,1\n", "non_finite_value", 2),
        (HEADER + b"0,abc\n0.1,1\n", "non_numeric_value", 2),
        (HEADER + b"0, 5\n0.1,1\n", "non_numeric_value", 2),
        (HEADER + b"0,1_000\n0.1,1\n", "non_numeric_value", 2),
        (HEADER + b"0,+5\n0.1,1\n", "non_numeric_value", 2),
        (HEADER + b"0,.5\n0.1,1\n", "non_numeric_value", 2),
        (HEADER + b"0,5.\n0.1,1\n", "non_numeric_value", 2),
        (HEADER + b"0,0x10\n0.1,1\n", "non_numeric_value", 2),
        (HEADER + b"0,1\n0.1,1\n0.1,1\n", "duplicate_timestamp", 4),
        (HEADER + b"0,1\n0.2,1\n0.1,1\n", "timestamp_not_increasing", 4),
        (HEADER + b"-0.001,1\n0.1,1\n", "negative_time", 2),
        (HEADER + b"0,1\n0.1," + b"1" * 65 + b"\n", "field_too_long", 3),
    ],
)
def test_malformed_input_is_rejected_with_a_stable_code(data: bytes, code: str, line: int | None) -> None:
    err = code_of(parse, data)
    assert err.code == code and err.line == line


def test_nonnumeric_force_with_a_locale_comma_is_a_malformed_row() -> None:
    assert code_of(parse, HEADER + b"0,700,5\n").code == "malformed_row"


@pytest.mark.parametrize(
    ("header", "code", "field"),
    [
        (b"time_s\n", "missing_column", "vertical_force_n"),
        (b"vertical_force_n\n", "missing_column", "time_s"),
        (b"time,force\n", "missing_column", "time_s"),
        (b"0,700\n", "missing_column", "time_s"),  # no header at all
        (b"Time_s,vertical_force_n\n", "missing_column", "time_s"),  # no case folding
        (b" time_s,vertical_force_n\n", "missing_column", "time_s"),  # no trimming
        (b"time_s,time_s,vertical_force_n\n", "duplicate_column", "time_s"),
        (b"time_s,vertical_force_n,vertical_force_n\n", "duplicate_column", "vertical_force_n"),
        (b"time_s,vertical_force_n,fx_n\n", "unexpected_column", None),
        (b"time_s,vertical_force_n,Jane Doe,Jane Doe\n", "duplicate_column", None),
    ],
)
def test_header_is_matched_exactly(header: bytes, code: str, field: str | None) -> None:
    err = code_of(parse, header + b"0,1\n0.1,1\n")
    assert (err.code, err.field) == (code, field)
    assert "Jane" not in json.dumps(err.document())  # an unknown column name is never echoed


def test_bounds_on_size_rows_duration_and_time() -> None:
    data = csv_bytes([i / 100 for i in range(50)], [700.0] * 50)
    assert code_of(parse, data, "up", ForcePlateLimits(max_source_bytes=len(data) - 1)).code == "source_too_large"
    err = code_of(parse, data, "up", ForcePlateLimits(max_samples=10))
    assert err.code == "too_many_samples" and err.line == 12
    assert code_of(parse, data, "up", ForcePlateLimits(max_duration_s=0.4)).code == "duration_exceeded"
    assert code_of(parse, HEADER + b"0,1\n90000,1\n").code == "time_out_of_range"
    assert parse(data, "up", ForcePlateLimits(max_samples=50, max_duration_s=0.49)).sample_count == 50


def test_error_documents_are_stable_and_leak_nothing(tmp_path: Path) -> None:
    for code in ERROR_MESSAGES:
        doc = ForcePlateError(code, field="source.sha256", line=3).document()
        assert doc["contract"] == "force-plate-error-v1" and doc["error"]["message"] == ERROR_MESSAGES[code]
    with pytest.raises(ValueError):
        ForcePlateError("made_up_code")
    secret = tmp_path / "participant-jane-doe-force.csv"
    err = code_of(read_bounded, secret, max_bytes=10, kind="source", field="force_csv")
    assert err.code == "source_unreadable" and "jane" not in json.dumps(err.document())


# ── bounded reading: regular files only, never blocking ─────────────────


def test_reader_refuses_directories_fifos_and_oversize(tmp_path: Path) -> None:
    import os

    assert code_of(read_bounded, tmp_path, max_bytes=10, kind="source", field="f").code == "source_not_regular_file"
    fifo = tmp_path / "pipe"
    os.mkfifo(fifo)
    assert code_of(read_bounded, fifo, max_bytes=10, kind="document", field="f").code == "document_not_regular_file"
    big = tmp_path / "big.csv"
    big.write_bytes(b"x" * 11)
    assert code_of(read_bounded, big, max_bytes=10, kind="source", field="f").code == "source_too_large"
    ok = tmp_path / "ok.csv"
    ok.write_bytes(b"x" * 10)
    assert read_bounded(ok, max_bytes=10, kind="source", field="f") == b"x" * 10


# ── strict JSON ─────────────────────────────────────────────────────────


@pytest.mark.parametrize(
    ("text", "code"),
    [
        (b'{"a": 1, "a": 2}', "duplicate_json_key"),
        (b'{"a": {"b": 1, "b": 1}}', "duplicate_json_key"),
        (b'{"a": NaN}', "non_finite_json_number"),
        (b'{"a": -Infinity}', "non_finite_json_number"),
        (b'{"a": 1e400}', "non_finite_json_number"),
        (b'{"a": ' + b"9" * 400 + b"}", "non_finite_json_number"),
        (b'{"a": 1', "invalid_json"),
        (b'{"a": 1} trailing', "invalid_json"),
        (b"\xef\xbb\xbf{}", "byte_order_mark_not_allowed"),
        (b'{"a": "\xff"}', "invalid_utf8"),
        (b"[" * 100_000 + b"]" * 100_000, "invalid_json"),
    ],
)
def test_json_documents_are_strict(text: bytes, code: str) -> None:
    assert code_of(parse_json_document, text, field="manifest").code == code


# ── manifest ────────────────────────────────────────────────────────────

AID = uuid.UUID("0b4f1c2e-6f7a-4d8b-9c0d-1e2f3a4b5c6d")
SUBJECT = uuid.UUID("9c7b5b5e-2f0c-4a53-9a57-1b2a3c4d5e6f")


def manifest(**changes: Any) -> dict[str, Any]:
    doc = make_fixture(AID, subject=SUBJECT, duration_s=1).manifest
    for path, value in changes.items():
        node = doc
        parts = path.split("__")
        for p in parts[:-1]:
            node = node[p]
        if value is DELETE:
            del node[parts[-1]]
        else:
            node[parts[-1]] = value
    return doc


DELETE = object()


def mparse(doc: Any) -> Any:
    return parse_manifest(json.dumps(doc).encode())


def test_valid_manifest_and_canonical_form() -> None:
    m = mparse(manifest(assessment_id=str(AID).upper()))
    assert m.assessment_id == AID and m.research_subject_id == SUBJECT
    canonical = m.canonical()
    assert canonical["assessment_id"] == str(AID) and canonical["body_mass_kg"] == 70.0
    assert mparse(manifest(research_subject_id=None)).research_subject_id is None


@pytest.mark.parametrize(
    ("changes", "code", "field"),
    [
        ({"participant_name": "Jane Doe"}, "unknown_field", "$"),
        ({"email": "jane@example.com"}, "unknown_field", "$"),
        ({"date_of_birth": "1990-01-01"}, "unknown_field", "$"),
        ({"consent": True}, "unknown_field", "$"),
        ({"notes": "free text"}, "unknown_field", "$"),
        ({"source__filename": "jane.csv"}, "unknown_field", "source"),
        (
            {
                "synchronization__anchors": [
                    {"event": "plate_impact", "video_time_ms": 1, "force_time_ms": 1, "who": "x"}
                ]
            },
            "unknown_field",
            "synchronization.anchors",
        ),
        ({"research_subject_id": DELETE}, "missing_field", "research_subject_id"),
        ({"body_mass_kg": DELETE}, "missing_field", "body_mass_kg"),
        ({"contract": "force-plate-manifest-v9"}, "unsupported_manifest_contract", "contract"),
        ({"contract": DELETE}, "missing_field", "contract"),
        ({"data_origin": "approved"}, "invalid_data_origin", "data_origin"),
        ({"assessment_id": "not-a-uuid"}, "invalid_assessment_id", "assessment_id"),
        ({"assessment_id": AID.hex}, "invalid_assessment_id", "assessment_id"),
        ({"research_subject_id": str(uuid.uuid1())}, "invalid_research_subject_id", "research_subject_id"),
        ({"research_subject_id": 5}, "invalid_research_subject_id", "research_subject_id"),
        ({"movement_type": "countermovement_jump"}, "unsupported_movement", "movement_type"),
        ({"movement_type": "single_leg_landing"}, "unsupported_movement", "movement_type"),
        ({"capture_mode": "dual_camera"}, "unsupported_capture_mode", "capture_mode"),
        ({"plate_configuration": "dual_plate_left_right"}, "unsupported_plate_configuration", "plate_configuration"),
        ({"source__format": "vendor-export"}, "unsupported_source_format", "source.format"),
        ({"source__quantity": "horizontal_ground_reaction_force"}, "unsupported_quantity", "source.quantity"),
        ({"source__time_reference": "wall_clock"}, "unsupported_time_reference", "source.time_reference"),
        ({"source__time_unit": "ms"}, "unsupported_unit", "source.time_unit"),
        ({"source__force_unit": "kN"}, "unsupported_unit", "source.force_unit"),
        ({"source__force_unit": "lbf"}, "unsupported_unit", "source.force_unit"),
        (
            {"source__vertical_force_positive_direction": "z_up"},
            "unsupported_axis_convention",
            "source.vertical_force_positive_direction",
        ),
        (
            {"source__vertical_force_positive_direction": "auto"},
            "unsupported_axis_convention",
            "source.vertical_force_positive_direction",
        ),
        (
            {"source__vertical_force_positive_direction": DELETE},
            "missing_field",
            "source.vertical_force_positive_direction",
        ),
        ({"source__sha256": "ABC"}, "invalid_source_sha256", "source.sha256"),
        (
            {"synchronization__method": "cross_correlation"},
            "unsupported_synchronization_method",
            "synchronization.method",
        ),
        ({"synchronization__anchors": []}, "invalid_synchronization_anchor", "synchronization.anchors"),
        (
            {"synchronization__anchors": [{"event": "plate_impact", "video_time_ms": -1, "force_time_ms": 1}]},
            "invalid_synchronization_anchor",
            "synchronization.anchors",
        ),
        (
            {"synchronization__anchors": [{"event": "clap", "video_time_ms": 1, "force_time_ms": 1}]},
            "invalid_synchronization_anchor",
            "synchronization.anchors",
        ),
        (
            {"synchronization__anchors": [{"event": "plate_impact", "video_time_ms": "1", "force_time_ms": 1}]},
            "invalid_synchronization_anchor",
            "synchronization.anchors",
        ),
    ],
)
def test_manifest_rejections(changes: dict[str, Any], code: str, field: str) -> None:
    err = code_of(mparse, manifest(**changes))
    assert (err.code, err.field) == (code, field)
    text = json.dumps(err.document())
    for leaked in ("Jane", "jane", "free text", "participant_name", "email", "notes"):
        assert leaked not in text


@pytest.mark.parametrize("doc", [[], "manifest", 5, None, True])
def test_impossible_manifest_shapes(doc: Any) -> None:
    assert code_of(mparse, doc).code == "invalid_manifest"


def test_anchor_count_must_match_method() -> None:
    doc = manifest()
    doc["synchronization"]["anchors"] = doc["synchronization"]["anchors"] * 2
    assert code_of(mparse, doc).code == "anchor_count_mismatch"
    doc["synchronization"] = {"method": "two_anchor_affine", "anchors": doc["synchronization"]["anchors"][:1]}
    assert code_of(mparse, doc).code == "anchor_count_mismatch"


# ── body mass ───────────────────────────────────────────────────────────


@pytest.mark.parametrize("value", [70, 70.5, 72.25, BODY_MASS_KG_MIN, BODY_MASS_KG_MAX, 160])
def test_valid_body_mass(value: float) -> None:
    assert validate_body_mass_kg(value) == float(value)
    assert mparse(manifest(body_mass_kg=value)).body_mass_kg == float(value)


@pytest.mark.parametrize(
    "value",
    [
        0,
        0.0,
        -70,
        -0.001,
        math.nan,
        math.inf,
        -math.inf,
        True,
        False,
        "70",
        "70kg",
        "70,5",
        None,
        [70],
        {"kg": 70},
        72500,
        0.0725,
        BODY_MASS_KG_MIN - 1e-9,
        BODY_MASS_KG_MAX + 1e-9,
        10**400,
    ],
)
def test_invalid_body_mass_is_rejected_never_converted(value: Any) -> None:
    assert code_of(validate_body_mass_kg, value).code == "invalid_body_mass"
    if isinstance(value, float) and not math.isfinite(value):
        return  # not representable in JSON; covered by the strict JSON tests
    if isinstance(value, int) and not isinstance(value, bool) and value > 10**300:
        doc = json.dumps(manifest()).replace('"body_mass_kg": 70.0', '"body_mass_kg": ' + str(value))
        assert code_of(parse_manifest, doc.encode()).code == "non_finite_json_number"
        return
    assert code_of(mparse, manifest(body_mass_kg=value)).code == "invalid_body_mass"


def test_no_magnitude_based_unit_inference() -> None:
    # 160 could be pounds; it is accepted as 160 kg exactly — never converted.
    assert mparse(manifest(body_mass_kg=160)).body_mass_kg == 160.0
    # a value in grams is rejected, not divided by 1000
    assert code_of(mparse, manifest(body_mass_kg=70000)).code == "invalid_body_mass"
    # force magnitudes are never used to guess units: 0.7 "N" is just 0.7 N
    assert parse(HEADER + b"0,0.7\n0.1,0.7\n").vertical_grf_n.tolist() == [0.7, 0.7]


def test_limits_from_environment() -> None:
    assert limits_from_env({}) == ForcePlateLimits()
    custom = limits_from_env({"RESEARCH_FORCE_MAX_SAMPLES": "100", "RESEARCH_FORCE_MAX_DURATION_S": "12.5"})
    assert (custom.max_samples, custom.max_duration_s) == (100, 12.5)
    for env in (
        {"RESEARCH_FORCE_MAX_SAMPLES": "many"},
        {"RESEARCH_FORCE_MAX_SAMPLES": "1"},
        {"RESEARCH_FORCE_MAX_DURATION_S": "nan"},
        {"RESEARCH_FORCE_MAX_DURATION_S": "-1"},
    ):
        assert code_of(limits_from_env, env).code == "invalid_configuration"


def test_large_signal_is_bounded_and_fast() -> None:
    """600,000 samples (the default bound) parse into two float64 arrays."""
    import time

    n = 600_000
    data = csv_bytes((np.arange(n) / 5000).tolist(), [700.0] * n)
    t = time.perf_counter()
    s = parse(data)
    assert s.sample_count == n and time.perf_counter() - t < 20
    assert code_of(parse, data + b"120.0002,700.0\n").code == "too_many_samples"
