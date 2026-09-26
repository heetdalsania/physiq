# PhysiQ research backend (Milestones 7–8) — setup and commands

Local research prototype that turns an approved research video of one
bodyweight squat into versioned derived Stage-3 movement data (Milestone 7),
and pairs such an assessment with measured force-plate data (Milestone 8).
Design, contracts, privacy and non-claims:
[../RESEARCH_BACKEND.md](../RESEARCH_BACKEND.md) and
[../FORCE_PLATE_VALIDATION.md](../FORCE_PLATE_VALIDATION.md).
Verification: [../MILESTONE_7_VERIFICATION.md](../MILESTONE_7_VERIFICATION.md),
[../MILESTONE_8_VERIFICATION.md](../MILESTONE_8_VERIFICATION.md).
Independent review: [../MILESTONE_7_ADVERSARIAL_REVIEW.md](../MILESTONE_7_ADVERSARIAL_REVIEW.md).

> Local / internal use only. Never expose it publicly: there is no
> authentication, authorization or participant-consent control. Only approved
> research media may be submitted; the Physiq app never sends anything here.

The consumer app (repository root) does not need this directory, Python or
Docker; `npm ci && npm test && npm run build` are unaffected.

## Requirements

- Python **3.12** (the pinned runtime `mediapipe==0.10.31` ships wheels for
  macOS arm64 and Linux x86-64)
- Postgres 17 for real use (tests default to per-test SQLite databases)
- Docker (optional) for the full local stack

## Install and test (clean checkout)

```bash
cd research_backend
python3.12 -m venv .venv
source .venv/bin/activate
python -m pip install --no-deps -r requirements-dev.lock.txt
python -m pytest
ruff check . && ruff format --check . && mypy
```

`pytest` alone is hermetic: no network, no database server, no real pose
model. Opt-in suites:

| Suite | Command |
|---|---|
| Real Postgres (every storage/API/E2E test also runs against a fresh database per test) | `RESEARCH_TEST_POSTGRES_URL=postgresql+psycopg://research:research-local-only@127.0.0.1:55432/research python -m pytest` |
| Real MediaPipe runtime + model (fetches the hash-pinned MediaPipe test image once into `.local/fixtures/`) | `RESEARCH_TEST_REAL_POSE=1 python -m pytest -m real_pose` |
| macOS network monitor around 180 s of real inference | `RESEARCH_TEST_REAL_POSE=1 python -m pytest -s -m netmon` |
| M6 parity fixtures (regenerate from the real M6 JavaScript, from the repo root) | `node research_backend/tools/m6_parity/generate.mjs` |

For the Postgres suite, start a database first, e.g.
`docker compose up -d postgres`.

## Run the service locally (without Docker)

```bash
source .venv/bin/activate
export RESEARCH_DATABASE_URL=postgresql+psycopg://research:research-local-only@127.0.0.1:55432/research
alembic upgrade head                      # schema is created ONLY by migrations
python -m physiq_research.api &           # 127.0.0.1:8765
python -m physiq_research.workers         # separate process; loads + verifies the model once
```

Submit a video (curl must declare the part type; the filename is ignored):

```bash
curl -s -H 'X-Research-Client: cli' \
  -F 'video=@squat.mp4;type=video/mp4' \
  -F movement_type=bodyweight_squat_sagittal \
  -F capture_mode=single_camera_sagittal \
  -F research_subject_id=$(python3 -c 'import uuid; print(uuid.uuid4())') \
  http://127.0.0.1:8765/research/v1/jobs
curl -s http://127.0.0.1:8765/research/v1/jobs/<job_id>
curl -s http://127.0.0.1:8765/research/v1/assessments/<assessment_id>
curl -s -X DELETE -H 'X-Research-Client: cli' http://127.0.0.1:8765/research/v1/assessments/<assessment_id>
```

## Force-plate validation (Milestone 8, command line only)

Scientific status: **engineering infrastructure only; scientific force-plate
validation is pending approved paired human data.** There is no estimator.

```bash
source .venv/bin/activate
export RESEARCH_DATABASE_URL=postgresql+psycopg://research:research-local-only@127.0.0.1:55432/research
alembic upgrade head    # 0002_force_plate_validation
python -m physiq_research.force_plate import --manifest manifest.json --force-csv force.csv
python -m physiq_research.force_plate inspect <trial_id> [--include-artifacts]
python -m physiq_research.force_plate list [--assessment <assessment_id>]
python -m physiq_research.force_plate evaluate <trial_id> --estimate estimate.json
python -m physiq_research.force_plate export <trial_id> [--include-estimates]
python -m physiq_research.force_plate study --definition study.json
python -m physiq_research.force_plate delete <trial_id>
```

JSON on stdout; errors as `force-plate-error-v1` on stderr (exit 3 rejected,
4 not found, 5 integrity, 6 environment). The CSV is read once into memory
and never copied, moved or deleted. Contracts, rules and limits:
[../FORCE_PLATE_VALIDATION.md](../FORCE_PLATE_VALIDATION.md).
`RESEARCH_FORCE_MAX_SOURCE_BYTES`, `RESEARCH_FORCE_MAX_SAMPLES`,
`RESEARCH_FORCE_MAX_DURATION_S` and `RESEARCH_FORCE_MAX_ESTIMATE_SAMPLES`
override the input bounds.

## Docker Compose stack

```bash
cd research_backend
docker compose up --build -d          # postgres, migrate (one-shot), api, worker
curl -s http://127.0.0.1:8765/health/ready
docker compose --profile test run --rm tests            # full pytest on Linux x86-64 (+ Postgres)
RESEARCH_TEST_REAL_POSE=1 docker compose --profile test run --rm \
  -e RESEARCH_POSE_MODEL_PATH=/srv/models/pose_landmarker_full.task tests   # + real MediaPipe
docker compose down            # add -v to delete the database and upload volumes
```

Host ports are bound to 127.0.0.1 only and can be moved with
`RESEARCH_API_HOST_PORT` / `RESEARCH_PG_HOST_PORT`. The worker has no route to
the Internet (`internal` network). The image is `linux/amd64` and reuses the
repository's vendored model (`vendor/mediapipe/pose_landmarker_full.task`,
SHA-256 checked at build).

## Configuration (`RESEARCH_*`)

| Variable | Default |
|---|---|
| `RESEARCH_DATABASE_URL` | required |
| `RESEARCH_API_HOST` / `RESEARCH_API_PORT` | `127.0.0.1` / `8765` |
| `RESEARCH_ALLOW_NON_LOOPBACK_BIND` | `0` (containers only) |
| `RESEARCH_ALLOWED_HOSTS` | `127.0.0.1,localhost,[::1],::1` |
| `RESEARCH_UPLOAD_DIR` | `<tmp>/physiq-research-uploads-<uid>` (created 0700) |
| `RESEARCH_POSE_MODEL_PATH` | `../vendor/mediapipe/pose_landmarker_full.task` |
| `RESEARCH_MAX_UPLOAD_BYTES` | 104857600 (100 MiB) |
| `RESEARCH_MAX_DURATION_MS` | 30000 |
| `RESEARCH_MAX_LONG_SIDE_PX` / `RESEARCH_MAX_SHORT_SIDE_PX` | 3840 / 2160 |
| `RESEARCH_MAX_DECODED_FRAMES` | 3600 |
| `RESEARCH_MAX_PENDING_UPLOADS` | 8 |
| `RESEARCH_UPLOAD_MAX_AGE_S` | 3600 |
| `RESEARCH_LEASE_SECONDS` / `RESEARCH_HEARTBEAT_SECONDS` / `RESEARCH_MAX_ATTEMPTS` | 120 / 15 / 2 |
| `RESEARCH_LOG_LEVEL` / `RESEARCH_LOG_TRACEBACKS` | `INFO` / `0` |

## Tools

| Path | Purpose |
|---|---|
| `tools/m6_parity/` | builds the cross-language fixtures by driving the real M6 session |
| `tools/netmon/` | macOS libc network-call monitor, deny-network sandbox profile, runtime comparison loop |
| `tools/real_pose_smoke.py` | sustained real-runtime smoke run (JSON report) |
| `tools/measure_performance.py` | timing and derived-data size sanity measurement |
| `tools/measure_force_plate_performance.py` | Milestone 8 import/evaluate timing and stored-size measurement (synthetic fixtures) |
