"""Milestone 8 scientific, privacy and product boundaries, enforced mechanically.

The force-plate layer may name MEASURED force and GRF — nothing else beyond
Stage 3. It must never define or emit joint kinetics (moments, torque,
inverse dynamics), tissue/tendon/muscle quantities, stress/strain, load,
injury/risk, readiness/recovery/fatigue/capacity, diagnosis, clinical or
quality judgements, scores/grades/ratings/verdicts, or claims such as
"accurate"/"validated". It adds no estimator, no training, no network or
HTTP surface, no dependency, and nothing to the consumer app.
"""

from __future__ import annotations

import ast
import inspect as pyinspect
import json
import re
import uuid
from pathlib import Path
from typing import Any

import pytest
from pydantic import BaseModel

from physiq_research.config import Settings
from physiq_research.force_plate import estimate, manifest, records, reports, study
from physiq_research.force_plate.errors import ERROR_MESSAGES
from physiq_research.force_plate.versions import version_families as m8_versions
from physiq_research.storage.repository import ResearchRepository
from physiq_research.versions import version_families as m7_versions

BACKEND = Path(__file__).resolve().parents[1]
REPO = BACKEND.parent
FORCE_PLATE = BACKEND / "physiq_research" / "force_plate"

M8_FORBIDDEN_TOKENS = {
    "moment",
    "moments",
    "torque",
    "torques",
    "inverse",
    "dynamics",
    "kinetic",
    "kinetics",
    "tissue",
    "tissues",
    "tendon",
    "muscle",
    "muscles",
    "stress",
    "strain",
    "load",
    "loading",
    "loads",
    "injury",
    "injuries",
    "risk",
    "risks",
    "readiness",
    "recovery",
    "fatigue",
    "capacity",
    # "diagnostic" in the statistical sense (a shape diagnostic) is allowed; clinical terms are not
    "diagnosis",
    "diagnoses",
    "clinical",
    "clinically",
    "quality",
    "score",
    "scores",
    "grade",
    "grades",
    "rating",
    "ratings",
    "rank",
    "ranking",
    "safe",
    "unsafe",
    "safety",
    "good",
    "bad",
    "pass",
    "passed",
    "fail",
    "failed",
    "recommendation",
    "recommendations",
    "return_to_play",
    "rtp",
    "accuracy",
    "accurate",
    "validated",
    "opensim",
    "ai",
}
# Identifiers that contain a forbidden token but are plumbing, not outputs.
ALLOWED_IDENTIFIERS: set[str] = set()


def _tokens(name: str) -> set[str]:
    parts = re.split(r"[^a-z0-9]+", re.sub(r"([a-z])([A-Z])", r"\1_\2", name).lower())
    return {p for p in parts if p}


def _modules() -> list[Path]:
    return sorted(FORCE_PLATE.rglob("*.py"))


def test_force_plate_identifiers_stay_inside_the_m8_boundary() -> None:
    offenders = []
    for path in _modules():
        for node in ast.walk(ast.parse(path.read_text())):
            name = None
            if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)):
                name = node.name
            elif isinstance(node, ast.Name) and isinstance(node.ctx, ast.Store):
                name = node.id
            elif isinstance(node, ast.arg):
                name = node.arg
            elif isinstance(node, ast.Attribute) and isinstance(node.ctx, ast.Store):
                name = node.attr
            if name and name not in ALLOWED_IDENTIFIERS and _tokens(name) & M8_FORBIDDEN_TOKENS:
                offenders.append(f"{path.name}:{getattr(node, 'lineno', '?')} {name}")
    assert len(_modules()) >= 15 and not offenders, offenders


def _schema_keys(schema: Any, acc: set[str]) -> set[str]:
    if isinstance(schema, dict):
        for k, v in schema.items():
            if k in ("properties", "$defs"):
                acc.update(v.keys())
            if k == "enum":
                acc.update(str(e) for e in v)
            if k == "const":
                acc.add(str(v))
            _schema_keys(v, acc)
    elif isinstance(schema, list):
        for v in schema:
            _schema_keys(v, acc)
    return acc


def _models() -> list[type[BaseModel]]:
    out = []
    for module in (records, manifest, estimate, study):
        for obj in vars(module).values():
            if isinstance(obj, type) and issubclass(obj, BaseModel) and obj.__module__ == module.__name__:
                out.append(obj)
    return out


@pytest.mark.parametrize("model", _models(), ids=lambda m: m.__name__)
def test_no_forbidden_output_fields_or_enum_values(model: type[BaseModel]) -> None:
    keys = _schema_keys(model.model_json_schema(), set())
    bad = {k for k in keys if _tokens(k) & M8_FORBIDDEN_TOKENS}
    assert not bad, bad


def _walk_keys(value: Any, acc: set[str]) -> set[str]:
    if isinstance(value, dict):
        for k, v in value.items():
            acc.add(k)
            _walk_keys(v, acc)
    elif isinstance(value, list):
        for v in value:
            _walk_keys(v, acc)
    return acc


def _walk_strings(value: Any, acc: list[str]) -> list[str]:
    if isinstance(value, dict):
        for v in value.values():
            _walk_strings(v, acc)
    elif isinstance(value, list):
        for v in value:
            _walk_strings(v, acc)
    elif isinstance(value, str):
        acc.append(value)
    return acc


def test_stored_records_and_reports_have_no_forbidden_keys(
    settings: Settings, repo: ResearchRepository, squat_video: Path, tmp_path: Path
) -> None:
    from physiq_research.force_plate.comparison import compare_estimate
    from physiq_research.force_plate.importer import import_trial
    from physiq_research.force_plate.limits import ForcePlateLimits
    from physiq_research.force_plate.repository import ForcePlateRepository
    from tests.support.force_fixtures import make_fixture, null_baseline_estimate, process_assessment

    subject = uuid.uuid4()
    a = process_assessment(settings, repo, squat_video, subject=subject)
    fx = make_fixture(a.id, subject=subject)
    out = import_trial(repo.engine, fx.manifest_bytes(), fx.csv, ForcePlateLimits())
    compare_estimate(repo.engine, out.trial_id, json.dumps(null_baseline_estimate(a)).encode(), ForcePlateLimits())
    m8 = ForcePlateRepository(repo.engine)
    trial = m8.get_trial(out.trial_id)
    assert trial is not None
    results = m8.list_validations(trial.id, trial.record_sha256)
    documents = [
        reports.export_document(trial, results, include_estimates=True),
        reports.deletion_document(m8.delete_trial(uuid.uuid4())),
    ]
    keys = _walk_keys(documents, set())
    # link provenance restates M7 identities (M7's own version keys) — checked by M7's boundary test
    bad = {k for k in keys if _tokens(k) & M8_FORBIDDEN_TOKENS}
    assert not bad, bad
    # values: every non-claim is a negation; every other string is free of verdict words
    non_claims = set(reports.NON_CLAIMS)
    for text in _walk_strings(documents, []):
        if text in non_claims:
            continue
        lowered = text.lower()
        for word in ("accurate", "accuracy", "validated", "injury", "readiness", "clinically", "score"):
            assert word not in lowered, (word, text)
    for doc in documents[:1]:
        assert doc["scientific_scope"]["non_claims"] == list(reports.NON_CLAIMS)
        assert doc["evidence_statement"] == "SYNTHETIC TEST FIXTURE — NOT HUMAN DATA — NOT VALIDATION EVIDENCE"


def test_error_messages_make_no_claims() -> None:
    for code, message in ERROR_MESSAGES.items():
        assert not _tokens(code) & M8_FORBIDDEN_TOKENS, code
        lowered = message.lower()
        for word in ("accurate", "validated", "injury", "risk", "readiness", "score", "unsafe"):
            assert word not in lowered, (code, message)


def test_non_claims_are_negations() -> None:
    for text in reports.NON_CLAIMS:
        assert re.search(r"\b(no|not|only|nothing|external)\b", text.lower()), text


def test_no_estimator_training_network_or_http_surface() -> None:
    banned_roots = {
        "torch",
        "tensorflow",
        "keras",
        "jax",
        "sklearn",
        "scipy",
        "pandas",
        "statsmodels",
        "xgboost",
        "lightgbm",
        "opensim",
        "mediapipe",
        "av",
        "fastapi",
        "starlette",
        "uvicorn",
        "requests",
        "httpx",
        "urllib",
        "urllib3",
        "http",
        "socket",
        "aiohttp",
        "boto3",
        "google",
        "azure",
        "supabase",
        "openai",
        "anthropic",
        "subprocess",
        "multiprocessing",
        "tempfile",
        "shutil",
        "pickle",
    }
    for path in _modules():
        tree = ast.parse(path.read_text())
        for node in ast.walk(tree):
            if isinstance(node, ast.Import):
                roots = {a.name.split(".")[0] for a in node.names}
            elif isinstance(node, ast.ImportFrom):
                roots = {(node.module or "").split(".")[0]}
            else:
                continue
            assert not roots & banned_roots, (path.name, roots & banned_roots)
        text = path.read_text().lower()
        for marker in (
            "optimizer",
            "backward(",
            "fit(",
            "train_step",
            "loss_fn",
            "fine_tune",
            "finetune",
            "gradient",
            ".train(",
            "epoch",
        ):
            assert marker not in text, (path.name, marker)


def test_no_estimator_is_implemented() -> None:
    """Only the interface exists: no class in the package produces estimates."""
    implementers = []
    for module_path in _modules():
        tree = ast.parse(module_path.read_text())
        for node in ast.walk(tree):
            if isinstance(node, ast.ClassDef) and node.name != "VerticalGrfEstimator":
                if any(isinstance(b, ast.FunctionDef) and b.name == "estimate" for b in node.body):
                    implementers.append(f"{module_path.name}:{node.name}")
    assert implementers == []
    protocol = estimate.VerticalGrfEstimator
    assert getattr(protocol, "_is_protocol", False)
    assert "EstimatorInputs" in pyinspect.getsource(estimate)
    fields = set(estimate.EstimatorInputs.__dataclass_fields__)
    assert fields == {"assessment", "body_mass_kg"}  # measured force can never reach an estimator


def test_m8_versions_are_independent_of_m7_and_tissueos() -> None:
    ours = m8_versions()
    theirs = m7_versions()
    assert not set(ours.values()) & set(theirs.values())
    assert len(set(ours.values())) == len(ours)
    everything = json.dumps(ours)
    for other in (
        "tissue-load",
        "exercise-tissue-map",
        "tissue-history",
        "load-baseline",
        "recovery-guidance",
        "research-pipeline",
        "squat-kinematics",
        "movement-assessment",
    ):
        assert other not in everything


def test_no_new_python_dependencies() -> None:
    lock = (BACKEND / "requirements.lock.txt").read_text().lower()
    pyproject = (BACKEND / "pyproject.toml").read_text().lower()
    for package in ("scipy", "pandas", "scikit-learn", "sklearn", "torch", "tensorflow", "statsmodels", "opensim"):
        assert f"\n{package}" not in lock and f'"{package}' not in pyproject, package


@pytest.mark.skipif(
    not (REPO / "js").is_dir(), reason="consumer app sources are not in this environment (container image)"
)
def test_consumer_app_has_no_force_plate_integration() -> None:
    needles = (
        "force_plate",
        "force-plate",
        "vertical_grf",
        "vertical-grf",
        "grf-validation",
        "grf_validation",
        "physiq_research",
        "research/v1",
        "force plate",
    )
    roots = [REPO / "js", REPO / "index.html", REPO / "build.mjs", REPO / "dist"]
    checked = 0
    for root in roots:
        files = [root] if root.is_file() else [p for p in root.rglob("*") if p.suffix in (".js", ".html", ".mjs")]
        for f in files:
            text = f.read_text(errors="ignore").lower()
            checked += 1
            for needle in needles:
                assert needle not in text, (f, needle)
    assert checked > 50


def test_synthetic_fixture_banner_is_present() -> None:
    support = (BACKEND / "tests" / "support" / "force_fixtures.py").read_text()
    assert "SYNTHETIC TEST FIXTURE — NOT HUMAN DATA — NOT VALIDATION EVIDENCE" in support
    assert "TEST / NULL BASELINE — NOT AN ESTIMATOR" in support
    assert '"synthetic_test_fixture"' in support
    for test_file in (BACKEND / "tests").glob("test_force_plate_*.py"):
        if test_file.name != "test_force_plate_boundaries.py":
            assert "NOT VALIDATION EVIDENCE" in test_file.read_text(), test_file.name


def test_m7_processing_contract_is_unchanged_by_m8() -> None:
    """M8 adds no key to M7's version families and no parameter to its processing
    contract: M7's fingerprint (hence every M7 idempotency key) is byte-identical
    to the value on the Milestone 7 base commit 8a909974."""
    from physiq_research.pipeline.contract import processing_fingerprint

    assert processing_fingerprint() == "8942bc0fab92ac4a516d4eabe673a48f3c249e9db7967029d69ac3ba17862b78"
    assert set(m7_versions()) == {
        "research_pipeline",
        "video_decoding",
        "video_sampling",
        "pose_frame_contract",
        "normalized_skeleton",
        "kinematic_features",
        "time_normalization",
        "source_semantics_kinematics",
        "source_semantics_result",
        "source_semantics_pose_frame",
    }
