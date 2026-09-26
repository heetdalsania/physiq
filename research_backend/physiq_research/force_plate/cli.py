"""Local research command line: ``python -m physiq_research.force_plate``.

    import    --manifest M.json --force-csv F.csv    pair a force-plate CSV with an M7 assessment
    inspect   TRIAL_ID [--include-artifacts]          verified trial record (+ signal arrays)
    list      [--assessment ASSESSMENT_ID]            trial ids (identity columns only)
    evaluate  TRIAL_ID --estimate E.json              compare a supplied estimate; store the result
    export    TRIAL_ID [--include-estimates]          trial + every validation result (report)
    study     --definition S.json                     participant-level aggregation
    delete    TRIAL_ID                                research deletion (idempotent)

Configuration: ``RESEARCH_DATABASE_URL`` (required; never a command-line
flag, so the password does not appear in process listings) and optional
``RESEARCH_FORCE_*`` limits. The database must be migrated to this code's
Alembic head. There is no network server: this is internal research
tooling and adds nothing to the consumer app or the M7 HTTP API.

Output: one JSON document on stdout (exit 0). Rejections: a
``force-plate-error-v1`` document on stderr with a stable code (exit 3
rejected input, 4 not found, 5 stored-data integrity, 6 environment, 1
internal). No path, file name, input value or traceback is printed
(``RESEARCH_LOG_TRACEBACKS=1`` adds a traceback for development).
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import traceback
import uuid
from collections.abc import Callable, Sequence
from pathlib import Path
from typing import Any

from sqlalchemy import Engine
from sqlalchemy.exc import OperationalError

from physiq_research.canonical import canonical_digest
from physiq_research.force_plate.comparison import compare_estimate, read_trial
from physiq_research.force_plate.errors import EXIT_INTEGRITY, ForcePlateError
from physiq_research.force_plate.importer import import_trial
from physiq_research.force_plate.inputs import read_bounded
from physiq_research.force_plate.limits import ForcePlateLimits, limits_from_env
from physiq_research.force_plate.manifest import parse_canonical_uuid
from physiq_research.force_plate.reports import (
    deletion_document,
    export_document,
    list_document,
    study_document,
    trial_document,
    validation_report,
)
from physiq_research.force_plate.repository import ForcePlateRepository
from physiq_research.force_plate.study import ResultFacts, TrialFacts, aggregate, parse_study_definition
from physiq_research.force_plate.versions import DATABASE_SCHEMA_REVISION as M8_DATABASE_SCHEMA_REVISION
from physiq_research.storage.db import check_ready, make_engine
from physiq_research.storage.repository import StoredDataError

Command = Callable[[argparse.Namespace, Engine, ForcePlateLimits], dict[str, Any]]


def _uuid(value: str) -> uuid.UUID:
    try:
        return parse_canonical_uuid(value, require_v4=False)
    except ValueError:
        raise ForcePlateError("invalid_identifier") from None


def _read_document(path: str, max_bytes: int, field: str) -> bytes:
    return read_bounded(Path(path), max_bytes=max_bytes, kind="document", field=field)


def cmd_import(args: argparse.Namespace, engine: Engine, limits: ForcePlateLimits) -> dict[str, Any]:
    manifest = _read_document(args.manifest, limits.max_manifest_bytes, "manifest")
    source = read_bounded(Path(args.force_csv), max_bytes=limits.max_source_bytes, kind="source", field="force_csv")
    outcome = import_trial(engine, manifest, source, limits)
    del source  # the only copy of the raw export bytes; never written anywhere
    trial = read_trial(ForcePlateRepository(engine), outcome.trial_id)
    return trial_document(trial, deduplicated=outcome.deduplicated)


def cmd_inspect(args: argparse.Namespace, engine: Engine, _limits: ForcePlateLimits) -> dict[str, Any]:
    repo = ForcePlateRepository(engine)
    trial = repo.get_trial(_uuid(args.trial_id), include_artifacts=args.include_artifacts)
    if trial is None:
        state = repo.trial_state(_uuid(args.trial_id))
        raise ForcePlateError("trial_deleted" if state == "deleted" else "trial_not_found")
    return trial_document(trial)


def cmd_list(args: argparse.Namespace, engine: Engine, _limits: ForcePlateLimits) -> dict[str, Any]:
    assessment = _uuid(args.assessment) if args.assessment else None
    return list_document(ForcePlateRepository(engine).list_trials(assessment))


def cmd_evaluate(args: argparse.Namespace, engine: Engine, limits: ForcePlateLimits) -> dict[str, Any]:
    trial_id = _uuid(args.trial_id)
    estimate = _read_document(args.estimate, limits.max_estimate_bytes, "estimate")
    outcome = compare_estimate(engine, trial_id, estimate, limits)
    repo = ForcePlateRepository(engine)
    results = repo.list_validations(outcome.trial.id, outcome.trial.record_sha256)
    stored = next((r for r in results if r.id == outcome.result_id), None)
    if stored is None:  # the trial (and with it the result) was deleted meanwhile
        raise ForcePlateError("trial_deleted")
    return validation_report(outcome.trial, stored, deduplicated=outcome.deduplicated)


def cmd_export(args: argparse.Namespace, engine: Engine, _limits: ForcePlateLimits) -> dict[str, Any]:
    repo = ForcePlateRepository(engine)
    trial = read_trial(repo, _uuid(args.trial_id))
    results = repo.list_validations(trial.id, trial.record_sha256)
    return export_document(trial, results, include_estimates=args.include_estimates)


def cmd_study(args: argparse.Namespace, engine: Engine, limits: ForcePlateLimits) -> dict[str, Any]:
    raw = _read_document(args.definition, limits.max_study_definition_bytes, "study_definition")
    definition = parse_study_definition(raw, limits)
    repo = ForcePlateRepository(engine)
    trials: dict[uuid.UUID, TrialFacts | None] = {}
    results: dict[uuid.UUID, list[ResultFacts]] = {}
    for entry in definition.trials:
        trial = repo.get_trial(entry.trial_id, include_artifacts=False)
        if trial is None:
            trials[entry.trial_id] = None
            continue
        link = trial.provenance["link"]
        trials[entry.trial_id] = TrialFacts(
            trial_id=trial.id,
            assessment_id=trial.assessment_id,
            research_subject_id=trial.research_subject_id,
            data_origin=trial.data_origin,
            force_source_sha256=trial.force_source_sha256,
            movement_type=trial.movement_type,
            capture_mode=trial.capture_mode,
            versions={"force_plate": trial.versions, "m7": link["m7_versions"]},
        )
        results[entry.trial_id] = [
            ResultFacts(
                result_id=r.id,
                estimator_name=r.estimator_name,
                estimator_version=r.estimator_version,
                estimator_parameters_sha256=r.provenance["estimate"]["estimator_parameters_sha256"],
                protocol_version=r.protocol_version,
                metrics=r.metrics,
            )
            for r in repo.list_validations(trial.id, trial.record_sha256)
        ]
    body = aggregate(definition, trials, results)
    return study_document(body, canonical_digest(definition.model_dump(mode="json")))


def cmd_delete(args: argparse.Namespace, engine: Engine, _limits: ForcePlateLimits) -> dict[str, Any]:
    return deletion_document(ForcePlateRepository(engine).delete_trial(_uuid(args.trial_id)))


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="python -m physiq_research.force_plate",
        description="Milestone 8 force-plate research tooling (local; no network service).",
    )
    sub = parser.add_subparsers(dest="command", required=True)
    p = sub.add_parser("import", help="pair a canonical force-plate CSV with an existing M7 assessment")
    p.add_argument("--manifest", required=True)
    p.add_argument("--force-csv", required=True)
    p.set_defaults(handler=cmd_import)
    p = sub.add_parser("inspect", help="print a verified trial record")
    p.add_argument("trial_id")
    p.add_argument("--include-artifacts", action="store_true")
    p.set_defaults(handler=cmd_inspect)
    p = sub.add_parser("list", help="list trials")
    p.add_argument("--assessment")
    p.set_defaults(handler=cmd_list)
    p = sub.add_parser("evaluate", help="compare a supplied estimate with a trial's measured force")
    p.add_argument("trial_id")
    p.add_argument("--estimate", required=True)
    p.set_defaults(handler=cmd_evaluate)
    p = sub.add_parser("export", help="machine-readable report: trial and its validation results")
    p.add_argument("trial_id")
    p.add_argument("--include-estimates", action="store_true")
    p.set_defaults(handler=cmd_export)
    p = sub.add_parser("study", help="participant-level aggregation of stored results")
    p.add_argument("--definition", required=True)
    p.set_defaults(handler=cmd_study)
    p = sub.add_parser("delete", help="research deletion of one trial (idempotent)")
    p.add_argument("trial_id")
    p.set_defaults(handler=cmd_delete)
    return parser


def _emit(stream: Any, document: dict[str, Any]) -> None:
    stream.write(json.dumps(document, indent=2, sort_keys=True, ensure_ascii=False, allow_nan=False) + "\n")
    stream.flush()


def _engine() -> Engine:
    url = os.environ.get("RESEARCH_DATABASE_URL", "").strip()
    if not url:
        raise ForcePlateError("database_not_configured")
    engine = make_engine(url)
    try:
        ready = check_ready(engine, required_revision=M8_DATABASE_SCHEMA_REVISION)
    except OperationalError:
        engine.dispose()
        raise ForcePlateError("database_unavailable") from None
    if not ready["schema_current"]:
        engine.dispose()
        raise ForcePlateError("database_not_ready")
    return engine


def main(argv: Sequence[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    handler: Command = args.handler
    engine: Engine | None = None
    try:
        limits = limits_from_env()
        engine = _engine()
        _emit(sys.stdout, handler(args, engine, limits))
        return 0
    except ForcePlateError as exc:
        _emit(sys.stderr, exc.document())
        return exc.exit_status
    except StoredDataError:
        _emit(sys.stderr, ForcePlateError("stored_data_integrity_error").document())
        return EXIT_INTEGRITY
    except OperationalError:
        err = ForcePlateError("database_unavailable")
        _emit(sys.stderr, err.document())
        return err.exit_status
    except KeyboardInterrupt:
        err = ForcePlateError("interrupted")
        _emit(sys.stderr, err.document())
        return err.exit_status
    except Exception:
        if os.environ.get("RESEARCH_LOG_TRACEBACKS") == "1":
            traceback.print_exc(file=sys.stderr)
        err = ForcePlateError("internal_error")
        _emit(sys.stderr, err.document())
        return err.exit_status
    finally:
        if engine is not None:
            engine.dispose()
