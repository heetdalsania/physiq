"""The local research command line, end to end, and the raw-export lifecycle.

SYNTHETIC TEST FIXTURE — NOT HUMAN DATA — NOT VALIDATION EVIDENCE.

Lifecycle invariant: the force-plate CSV is read once into memory. The
command line never creates, copies, moves or deletes a file; the operator's
export is left exactly as it was; no filename, path or raw text reaches the
database; an interrupted or killed import leaves no rows behind.
"""

from __future__ import annotations

import hashlib
import json
import os
import shutil
import signal
import subprocess
import sys
import tempfile
import textwrap
import time
import uuid
from pathlib import Path
from typing import Any

import pytest
from sqlalchemy import func, select

import physiq_research.force_plate.tables as m8
from physiq_research.config import Settings
from physiq_research.force_plate import cli
from physiq_research.storage.db import make_engine, upgrade
from physiq_research.storage.repository import ResearchRepository
from physiq_research.storage.tables import research_assessment_artifacts, research_assessments, research_jobs
from tests.support.force_fixtures import make_fixture, null_baseline_estimate, process_assessment

BACKEND = Path(__file__).resolve().parents[1]
SANDBOX = BACKEND / "tools" / "netmon" / "deny-network.sb"


def run_cli(capsys: pytest.CaptureFixture[str], *args: str) -> tuple[int, Any, Any]:
    status = cli.main(list(args))
    out, err = capsys.readouterr()
    return status, json.loads(out) if out.strip() else None, json.loads(err) if err.strip() else None


def m8_rows(repo: ResearchRepository) -> dict[str, int]:
    with repo.engine.connect() as c:
        return {t: int(c.execute(select(func.count()).select_from(getattr(m8, t))).scalar_one()) for t in m8.M8_TABLES}


@pytest.fixture
def workspace(
    db_settings: Settings,
    db_repo: ResearchRepository,
    squat_video: Path,
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> dict[str, Any]:
    subject = uuid.uuid4()
    assessment = process_assessment(db_settings, db_repo, squat_video, subject=subject)
    fx = make_fixture(assessment.id, subject=subject)
    folder = tmp_path / "participant jane doe exports"
    manifest, source = fx.write(folder, csv_name="participant-jane-doe-2026-force.csv", manifest_name="jane.json")
    estimate = folder / "estimate.json"
    estimate.write_text(json.dumps(null_baseline_estimate(db_repo.get_assessment(assessment.id))))  # type: ignore[arg-type]
    monkeypatch.setenv("RESEARCH_DATABASE_URL", db_settings.database_url)
    return {
        "assessment": assessment,
        "subject": subject,
        "manifest": manifest,
        "source": source,
        "estimate": estimate,
        "repo": db_repo,
        "settings": db_settings,
        "folder": folder,
    }


# ── the workflow ────────────────────────────────────────────────────────


def test_full_workflow_in_process(
    workspace: dict[str, Any], capsys: pytest.CaptureFixture[str], tmp_path: Path
) -> None:
    w = workspace
    status, trial, _ = run_cli(capsys, "import", "--manifest", str(w["manifest"]), "--force-csv", str(w["source"]))
    assert status == 0 and trial["contract"] == "force-plate-trial-report-v1" and trial["deduplicated"] is False
    tid = trial["trial_id"]
    assert trial["research_subject_id"] == str(w["subject"]) and trial["assessment_id"] == str(w["assessment"].id)
    assert trial["evidence_statement"] == "SYNTHETIC TEST FIXTURE — NOT HUMAN DATA — NOT VALIDATION EVIDENCE"
    assert trial["artifacts_included"] is True and trial["integrity"]["verified_on_read"] is True
    assert trial["scientific_scope"]["claim_stage"] == "measured_force_plate_ground_truth_and_comparison_framework"

    status, again, _ = run_cli(capsys, "import", "--manifest", str(w["manifest"]), "--force-csv", str(w["source"]))
    assert status == 0 and again["trial_id"] == tid and again["deduplicated"] is True

    status, brief, _ = run_cli(capsys, "inspect", tid)
    assert status == 0 and brief["artifacts_included"] is False
    assert all("data" not in a for a in brief["artifacts"].values())
    status, full, _ = run_cli(capsys, "inspect", tid, "--include-artifacts")
    assert full["artifacts"]["ground_truth"]["data"]["quantity"] == "measured_total_vertical_ground_reaction_force"

    status, listing, _ = run_cli(capsys, "list", "--assessment", str(w["assessment"].id))
    assert [t["trial_id"] for t in listing["trials"]] == [tid]

    status, result, _ = run_cli(capsys, "evaluate", tid, "--estimate", str(w["estimate"]))
    assert status == 0 and result["contract"] == "grf-validation-report-v1" and result["deduplicated"] is False
    assert result["metrics"]["waveform_shape"]["pearson_r"] is None  # constant TEST / NULL BASELINE
    assert result["metrics"]["time_shift_applied_ms"] == 0
    assert result["evidence_statement"].startswith("SYNTHETIC TEST FIXTURE")

    status, export, _ = run_cli(capsys, "export", tid, "--include-estimates")
    assert export["contract"] == "grf-validation-export-v1" and len(export["validation_results"]) == 1
    assert export["validation_results"][0]["estimate"]["estimator"]["name"] == "test-null-baseline"

    definition = tmp_path / "study.json"
    definition.write_text(
        json.dumps(
            {
                "contract": "grf-study-definition-v0.1",
                "estimator": {"name": "test-null-baseline", "version": "0.0.0-test"},
                "validation_protocol": "grf-validation-v0.1",
                "trials": [{"trial_id": tid}],
            }
        )
    )
    status, study, _ = run_cli(capsys, "study", "--definition", str(definition))
    assert status == 0 and study["counts"]["participants"] == 1
    assert study["evidence_statement"].startswith("SOFTWARE TEST OUTPUT — SYNTHETIC TEST FIXTURE")

    status, deleted, _ = run_cli(capsys, "delete", tid)
    assert deleted == {
        "contract": "force-plate-deletion-v1",
        "trial_id": tid,
        "state": "deleted",
        "artifacts_removed": 3,
        "validation_results_removed": 1,
        "linked_assessment": "unchanged",
    }
    status, repeat, _ = run_cli(capsys, "delete", tid)
    assert status == 0 and repeat["state"] == "already_deleted"
    status, _, err = run_cli(capsys, "inspect", tid)
    assert status == 4 and err["error"]["code"] == "trial_deleted"
    assert w["repo"].get_assessment(w["assessment"].id).record_sha256 == w["assessment"].record_sha256


@pytest.mark.parametrize(
    ("args", "code", "status"),
    [
        (("inspect", "not-a-uuid"), "invalid_identifier", 3),
        (("inspect", str(uuid.uuid4())), "trial_not_found", 4),
        (("evaluate", str(uuid.uuid4()), "--estimate", "/nonexistent/jane/estimate.json"), "document_unreadable", 3),
        (
            ("import", "--manifest", "/nonexistent/jane/m.json", "--force-csv", "/nonexistent/jane/f.csv"),
            "document_unreadable",
            3,
        ),
    ],
)
def test_errors_are_stable_and_leak_no_path(
    workspace: dict[str, Any], capsys: pytest.CaptureFixture[str], args: tuple[str, ...], code: str, status: int
) -> None:
    got, out, err = run_cli(capsys, *args)
    assert (got, out, err["error"]["code"]) == (status, None, code)
    assert (
        err["contract"] == "force-plate-error-v1"
        and "jane" not in json.dumps(err)
        and "/nonexistent" not in json.dumps(err)
    )


def test_environment_errors(
    tmp_path: Path, capsys: pytest.CaptureFixture[str], monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.delenv("RESEARCH_DATABASE_URL", raising=False)
    status, _, err = run_cli(capsys, "list")
    assert (status, err["error"]["code"]) == (6, "database_not_configured")
    monkeypatch.setenv("RESEARCH_DATABASE_URL", f"sqlite+pysqlite:///{tmp_path / 'empty.db'}")
    status, _, err = run_cli(capsys, "list")
    assert (status, err["error"]["code"]) == (6, "database_not_ready")
    monkeypatch.setenv("RESEARCH_FORCE_MAX_SAMPLES", "lots")
    status, _, err = run_cli(capsys, "list")
    assert (status, err["error"]["code"]) == (6, "invalid_configuration")


# ── raw-export lifecycle and privacy ────────────────────────────────────


def test_import_never_writes_copies_or_deletes_files(
    workspace: dict[str, Any], capsys: pytest.CaptureFixture[str], monkeypatch: pytest.MonkeyPatch
) -> None:
    w = workspace
    source: Path = w["source"]
    before = (
        hashlib.sha256(source.read_bytes()).hexdigest(),
        source.stat().st_mtime_ns,
        sorted(os.listdir(w["folder"])),
    )
    writes: list[str] = []

    def forbid(*_a: Any, **_k: Any) -> Any:
        raise AssertionError("the force-plate layer must never create a temporary file")

    for name in ("mkstemp", "mkdtemp", "NamedTemporaryFile", "TemporaryFile", "SpooledTemporaryFile"):
        monkeypatch.setattr(tempfile, name, forbid)
    real_open, real_os_open = open, os.open

    def watched_open(file: Any, mode: str = "r", *a: Any, **k: Any) -> Any:
        if any(flag in mode for flag in "wax+"):
            writes.append(str(file))
        return real_open(file, mode, *a, **k)

    def watched_os_open(path: Any, flags: int, *a: Any, **k: Any) -> Any:
        if flags & (os.O_WRONLY | os.O_RDWR | os.O_CREAT | os.O_TRUNC | os.O_APPEND):
            writes.append(str(path))
        return real_os_open(path, flags, *a, **k)

    monkeypatch.setattr("builtins.open", watched_open)
    monkeypatch.setattr(os, "open", watched_os_open)
    status, trial, _ = run_cli(capsys, "import", "--manifest", str(w["manifest"]), "--force-csv", str(source))
    assert status == 0, trial
    for failing, code in (
        (b"time_s,vertical_force_n\n0,1\n0,1\n", "duplicate_timestamp"),  # parser failure
        (b"", "empty_file"),
        (w["source"].read_bytes() + b"99,700\n", "source_digest_mismatch"),  # digest failure
    ):
        bad, bad_manifest = w["folder"] / "bad.csv", w["folder"] / "bad.json"
        doc = json.loads(w["manifest"].read_bytes())
        if code != "source_digest_mismatch":
            doc["source"]["sha256"] = hashlib.sha256(failing).hexdigest()
        with real_open(bad, "wb") as fh:
            fh.write(failing)
        with real_open(bad_manifest, "w") as fh:
            fh.write(json.dumps(doc))
        status, _, err = run_cli(capsys, "import", "--manifest", str(bad_manifest), "--force-csv", str(bad))
        assert status == 3 and err["error"]["code"] == code
        os.unlink(bad)
        os.unlink(bad_manifest)
    assert writes == []
    after = (
        hashlib.sha256(source.read_bytes()).hexdigest(),
        source.stat().st_mtime_ns,
        sorted(os.listdir(w["folder"])),
    )
    assert after == before  # the operator's export is untouched and still exists


def test_no_filename_path_or_raw_text_reaches_the_database(
    workspace: dict[str, Any], capsys: pytest.CaptureFixture[str]
) -> None:
    w = workspace
    run_cli(capsys, "import", "--manifest", str(w["manifest"]), "--force-csv", str(w["source"]))
    tid = run_cli(capsys, "list")[1]["trials"][0]["trial_id"]
    run_cli(capsys, "evaluate", tid, "--estimate", str(w["estimate"]))
    tables = [
        research_jobs,
        research_assessments,
        research_assessment_artifacts,
        *(getattr(m8, t) for t in m8.M8_TABLES),
    ]
    with w["repo"].engine.connect() as c:
        dump = json.dumps([[dict(r._mapping) for r in c.execute(select(t)).all()] for t in tables], default=str)
    for needle in (
        "jane",
        "Jane",
        "participant-jane",
        "exports",
        "force.csv",
        str(w["folder"]),
        "time_s,vertical_force_n",
        "manifest.json",
        "estimate.json",
    ):
        assert needle not in dump, needle


def test_parser_database_and_interrupt_failures_leave_no_rows(
    workspace: dict[str, Any], capsys: pytest.CaptureFixture[str], monkeypatch: pytest.MonkeyPatch
) -> None:
    from physiq_research.force_plate import importer

    w = workspace
    real = importer.import_trial
    for stage, exc in (
        ("parse", KeyboardInterrupt()),
        ("ground_truth", KeyboardInterrupt()),
        ("database_save", KeyboardInterrupt()),
        ("after_trial_row", KeyboardInterrupt()),
        ("after_artifacts", KeyboardInterrupt()),
        ("after_trial_row", RuntimeError("db down")),
    ):

        def failing(*a: Any, stage: str = stage, exc: BaseException = exc, **k: Any) -> Any:
            def fault(name: str) -> None:
                if name == stage:
                    raise exc

            return real(*a, faults=fault, **k)

        monkeypatch.setattr(cli, "import_trial", failing)
        status, out, err = run_cli(capsys, "import", "--manifest", str(w["manifest"]), "--force-csv", str(w["source"]))
        expected = ("interrupted", 130) if isinstance(exc, KeyboardInterrupt) else ("internal_error", 1)
        assert (err["error"]["code"], status, out) == (*expected, None)
        assert "db down" not in json.dumps(err)
        assert m8_rows(w["repo"]) == dict.fromkeys(m8.M8_TABLES, 0)
    assert w["source"].exists()


def test_killed_import_leaves_no_rows(workspace: dict[str, Any], tmp_path: Path) -> None:
    """SIGKILL while the trial and its artifacts are inserted but uncommitted."""
    w = workspace
    marker = tmp_path / "inside-transaction"
    harness = tmp_path / "harness.py"
    harness.write_text(
        textwrap.dedent(f"""
        import sys, time
        from pathlib import Path
        sys.path.insert(0, {str(BACKEND)!r})
        from physiq_research.force_plate import importer
        from physiq_research.force_plate.limits import ForcePlateLimits
        from physiq_research.storage.db import make_engine
        marker, url, manifest, source = Path(sys.argv[1]), sys.argv[2], sys.argv[3], sys.argv[4]
        def hang(point):
            if point == "after_artifacts":  # inside the transaction: rows inserted, not committed
                marker.write_text("uncommitted")
                time.sleep(120)
        importer.import_trial(make_engine(url), Path(manifest).read_bytes(), Path(source).read_bytes(),
                              ForcePlateLimits(), faults=hang)
    """)
    )
    proc = subprocess.Popen(
        [sys.executable, str(harness), str(marker), w["settings"].database_url, str(w["manifest"]), str(w["source"])],
        cwd=BACKEND,
    )
    try:
        deadline = time.monotonic() + 60
        while not marker.exists():
            assert proc.poll() is None and time.monotonic() < deadline, "harness did not reach the transaction"
            time.sleep(0.05)
        os.kill(proc.pid, signal.SIGKILL)
        proc.wait(timeout=30)
    finally:
        if proc.poll() is None:
            proc.kill()
    engine = make_engine(w["settings"].database_url)
    repo = ResearchRepository(engine)
    assert m8_rows(repo) == dict.fromkeys(m8.M8_TABLES, 0)
    assert repo.get_assessment(w["assessment"].id) is not None
    engine.dispose()


# ── a separate process, as an operator would run it ─────────────────────


def test_separate_process_end_to_end(workspace: dict[str, Any], tmp_path: Path) -> None:
    w = workspace
    env = {k: v for k, v in os.environ.items() if not k.startswith("RESEARCH_")}
    env["RESEARCH_DATABASE_URL"] = w["settings"].database_url
    prefix = network_denied_prefix() if w["settings"].database_url.startswith("sqlite") else []

    def call(*args: str) -> tuple[int, Any, Any]:
        done = subprocess.run(
            [*prefix, sys.executable, "-m", "physiq_research.force_plate", *args],
            cwd=BACKEND,
            env=env,
            capture_output=True,
            text=True,
            timeout=300,
            check=False,  # the exit status is asserted by each caller
        )
        out = json.loads(done.stdout) if done.stdout.strip() else None
        err = json.loads(done.stderr) if done.stderr.strip() else None
        return done.returncode, out, err

    status, trial, err = call("import", "--manifest", str(w["manifest"]), "--force-csv", str(w["source"]))
    assert status == 0, err
    tid = trial["trial_id"]
    assert call("inspect", tid)[1]["integrity"]["verified_on_read"] is True
    status, result, err = call("evaluate", tid, "--estimate", str(w["estimate"]))
    assert status == 0, err
    assert call("export", tid)[1]["validation_results"][0]["result_id"] == result["result_id"]
    assert call("delete", tid)[1]["state"] == "deleted"
    assert call("delete", tid)[1]["state"] == "already_deleted"
    status, _, err = call("evaluate", tid, "--estimate", str(w["estimate"]))
    assert (status, err["error"]["code"]) == (4, "trial_deleted")
    status, out, err = call("inspect", "../../etc/passwd")
    assert (status, out, err["error"]["code"]) == (3, None, "invalid_identifier")
    assert w["repo"].get_assessment(w["assessment"].id) is not None


def network_denied_prefix() -> list[str]:
    """macOS: run under the deny-network sandbox profile when it can be applied
    here (a positive control proves the profile blocks a socket connect)."""
    if sys.platform != "darwin" or not shutil.which("sandbox-exec"):
        return []
    prefix = ["sandbox-exec", "-f", str(SANDBOX)]
    if subprocess.run([*prefix, "/usr/bin/true"], capture_output=True, check=False).returncode != 0:
        return []  # nested sandboxing not permitted in this environment
    probe = subprocess.run(
        [
            *prefix,
            sys.executable,
            "-c",
            "import socket\ntry:\n socket.create_connection(('127.0.0.1', 9), timeout=2)\n"
            "except PermissionError: print('denied')\nexcept OSError as e: print('other', e.errno)",
        ],
        capture_output=True,
        text=True,
        check=False,
    )
    assert probe.stdout.strip() == "denied", probe.stdout  # the profile really blocks networking
    return prefix


def test_help_describes_a_local_tool_only(capsys: pytest.CaptureFixture[str]) -> None:
    with pytest.raises(SystemExit) as info:
        cli.main(["--help"])
    assert info.value.code == 0
    text = capsys.readouterr().out
    for command in ("import", "inspect", "list", "evaluate", "export", "study", "delete"):
        assert command in text
    assert "no network service" in text


def test_upgrade_is_idempotent_for_the_cli_database(tmp_path: Path) -> None:
    url = f"sqlite+pysqlite:///{tmp_path / 'r.db'}"
    upgrade(url)
    upgrade(url)
    engine = make_engine(url)
    assert ResearchRepository(engine).count_by_status() == {}
    engine.dispose()
