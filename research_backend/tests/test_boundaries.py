"""Scientific, privacy and product boundaries, enforced mechanically.

* No output key, enum or code identifier for force, GRF, moments, kinetics,
  tissue load/stress, injury/risk, readiness, capacity, diagnosis or any
  score/grade in the Milestone 7 (Stage 3) service. The Milestone 8
  measured-force layer (physiq_research/force_plate/) is the only place
  where measured force and GRF may be named; it has its own boundary test
  (tests/test_force_plate_boundaries.py) that still forbids joint kinetics,
  tissue, injury/risk, readiness, capacity, diagnosis, scores and verdicts.
* No training code, no remote inference, no object-storage or HTTP clients
  in the service code.
* The consumer app (js/, index.html, build.mjs, dist/) has no reference to
  the research backend: no upload button, no sync, no endpoint.
"""

from __future__ import annotations

import ast
import re
from pathlib import Path
from typing import Any

import pytest
from pydantic import BaseModel

from physiq_research import records
from physiq_research.api import schemas as api_schemas

BACKEND = Path(__file__).resolve().parents[1]
REPO = BACKEND.parent
PACKAGE = BACKEND / "physiq_research"
FORCE_PLATE = PACKAGE / "force_plate"  # Milestone 8; see tests/test_force_plate_boundaries.py


def m7_modules() -> list[Path]:
    """Every service module except the Milestone 8 force-plate layer."""
    return [p for p in PACKAGE.rglob("*.py") if FORCE_PLATE not in p.parents]


FORBIDDEN_TOKENS = {
    "grf",
    "force",
    "forces",
    "moment",
    "moments",
    "kinetic",
    "kinetics",
    "torque",
    "inverse",
    "dynamics",
    "load",
    "loading",
    "stress",
    "strain",
    "tissue",
    "tendon",
    "muscle",
    "injury",
    "injuries",
    "risk",
    "readiness",
    "capacity",
    "diagnosis",
    "diagnostic_score",
    "score",
    "scores",
    "grade",
    "rating",
    "safe",
    "unsafe",
    "safety",
    "recommendation",
    "recommendations",
    "return_to_play",
    "rtp",
}
# Identifiers that contain a forbidden token but are measurement plumbing, not outputs.
ALLOWED_IDENTIFIERS = {"model_dump", "loads", "json_loads", "strict_json_loads", "read_verified_model"}


def _tokens(name: str) -> set[str]:
    parts = re.split(r"[^a-z0-9]+", re.sub(r"([a-z])([A-Z])", r"\1_\2", name).lower())
    return {p for p in parts if p}


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
    for module in (records, api_schemas):
        for obj in vars(module).values():
            if isinstance(obj, type) and issubclass(obj, BaseModel) and obj.__module__ == module.__name__:
                out.append(obj)
    return out


@pytest.mark.parametrize("model", _models(), ids=lambda m: m.__name__)
def test_no_forbidden_output_fields_or_enum_values(model: type[BaseModel]) -> None:
    keys = _schema_keys(model.model_json_schema(), set())
    bad = {k for k in keys if _tokens(k) & FORBIDDEN_TOKENS}
    assert not bad, bad


def test_stored_record_keys_have_no_forbidden_concepts(settings: Any, repo: Any, squat_video: Path) -> None:
    from physiq_research.workers.worker import Worker
    from tests.support.jobs import enqueue_file
    from tests.support.providers import DotPoseProvider

    enqueue_file(settings, repo, squat_video)
    out = Worker(settings, repo, DotPoseProvider()).process_next()
    stored = repo.get_assessment(out.assessment_id)
    keys: set[str] = set()

    def walk(v: Any) -> None:
        if isinstance(v, dict):
            for k, x in v.items():
                keys.add(k)
                walk(x)
        elif isinstance(v, list):
            for x in v:
                walk(x)

    walk(stored.summary)
    for a in stored.artifacts.values():
        walk(a.data)
    walk({k: v for k, v in stored.provenance.items() if k != "segmentation"})  # M6 parameter names are inputs
    bad = {k for k in keys if _tokens(k) & FORBIDDEN_TOKENS}
    assert not bad, bad


def test_no_forbidden_identifiers_in_service_code() -> None:
    offenders = []
    modules = m7_modules()
    assert len(modules) > 40 and not [p for p in modules if "force_plate" in p.parts]
    for path in modules:
        tree = ast.parse(path.read_text())
        for node in ast.walk(tree):
            name = None
            if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)):
                name = node.name
            elif isinstance(node, ast.Name) and isinstance(node.ctx, ast.Store):
                name = node.id
            elif isinstance(node, ast.arg):
                name = node.arg
            elif isinstance(node, ast.Attribute) and isinstance(node.ctx, ast.Store):
                name = node.attr
            if name and name not in ALLOWED_IDENTIFIERS and _tokens(name) & FORBIDDEN_TOKENS:
                offenders.append(f"{path.relative_to(BACKEND)}:{getattr(node, 'lineno', '?')} {name}")
    assert not offenders, offenders


def test_no_training_remote_inference_or_network_clients() -> None:
    banned_imports = {
        "torch",
        "tensorflow",
        "keras",
        "jax",
        "sklearn",
        "opensim",
        "boto3",
        "botocore",
        "google",
        "azure",
        "supabase",
        "requests",
        "httpx",
        "urllib3",
        "aiohttp",
        "openai",
        "anthropic",
    }
    banned_calls = ("urllib.request", "http.client", "socket.create_connection")
    for path in PACKAGE.rglob("*.py"):
        text = path.read_text()
        tree = ast.parse(text)
        for node in ast.walk(tree):
            if isinstance(node, ast.Import):
                roots = {a.name.split(".")[0] for a in node.names}
            elif isinstance(node, ast.ImportFrom):
                roots = {(node.module or "").split(".")[0]}
            else:
                continue
            assert not roots & banned_imports, (path, roots & banned_imports)
        for call in banned_calls:
            assert call not in text, (path, call)
    lock = (BACKEND / "requirements.lock.txt").read_text().lower()
    for pkg in (
        "torch",
        "tensorflow",
        "opensim",
        "boto3",
        "google-cloud",
        "requests",
        "openai",
        "opencv",
        "matplotlib",
    ):
        assert f"\n{pkg}" not in lock and not lock.startswith(pkg), pkg


def test_training_and_model_updates_do_not_exist() -> None:
    for path in PACKAGE.rglob("*.py"):
        text = path.read_text().lower()
        for marker in ("optimizer", "backward(", "fit(", "train_step", "loss_fn", "fine_tune", "finetune"):
            assert marker not in text, (path, marker)


@pytest.mark.skipif(
    not (REPO / "js").is_dir(), reason="consumer app sources are not in this environment (container image)"
)
def test_consumer_app_is_not_wired_to_the_research_backend() -> None:
    needles = ("research/v1", "research_backend", "physiq_research", "8765", "x-research-client", "research-job-v1")
    roots = [
        REPO / "js",
        REPO / "index.html",
        REPO / "build.mjs",
        REPO / "dist" / "index.html",
        REPO / "dist" / "app.min.js",
    ]
    checked = 0
    for root in roots:
        files = [root] if root.is_file() else list(root.rglob("*.js")) if root.exists() else []
        for f in files:
            text = f.read_text(errors="ignore").lower()
            checked += 1
            for needle in needles:
                assert needle not in text, (f, needle)
    assert checked > 50


@pytest.mark.skipif(
    not (REPO / "js").is_dir(), reason="consumer app sources are not in this environment (container image)"
)
def test_movement_assessment_still_has_no_upload_or_persistence_path() -> None:
    """M6's local-only guarantees are untouched: the movement code has no
    network or storage API (mirrors test/movementPrivacy.test.js)."""
    for f in (REPO / "js" / "movement").glob("*.js"):
        text = f.read_text()
        if f.name in ("poseProvider.js", "modelVersion.js"):
            # poseProvider.js: same-origin GETs of its own runtime/model files;
            # modelVersion.js: the list of FORBIDDEN telemetry markers itself.
            # Both are covered by test/movementPrivacy.test.js.
            continue
        for api in ("XMLHttpRequest", "sendBeacon", "localStorage", "indexedDB", "WebSocket", "research"):
            assert api not in text, (f.name, api)
