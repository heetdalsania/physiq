# Milestone 7 — Research Backend: Verification

Verified 2026-09-25 on branch `claude/milestone-7-research-backend`, based on
`origin/main` at `512e61f69511e52c63e0a86b7e3c393bf349853f` (PR #30). Design and
contracts: [RESEARCH_BACKEND.md](RESEARCH_BACKEND.md). Setup:
[research_backend/README.md](research_backend/README.md).

Kinds of evidence, and what each does and does not prove:

| Evidence | Proves | Does not prove |
|---|---|---|
| Unit/integration tests on synthetic data (hand-derived) | algorithms, contracts, lifecycle, storage, API behaviour | anything about a learned model |
| Real encoded media + deterministic "dot" pose double | decoder, timestamps, orientation, sampling, pipeline, storage, cleanup on actual MP4 files | pose-model behaviour |
| Cross-language parity against the real M6 JavaScript | the Python implementation reproduces M6 semantics on identical input | that either implementation is accurate |
| Real MediaPipe runtime + model on a pinned test image | the runtime/model initialise, detect, reject no-person / two-person input, respect rotation metadata, make no network calls | joint-angle accuracy; any scientific validity |
| Real Postgres and Docker process-level runs | migrations, transactions, queue, separate API/worker processes, network isolation | production readiness |

---

## 1. Starting state

| Check | Result |
|---|---|
| `git fetch`; `HEAD`, `origin/main` | both `512e61f69511e52c63e0a86b7e3c393bf349853f` (the expected SHA). The session ran in an isolated git worktree already at that commit; `git switch main` was not possible there (a worktree cannot check out a branch in use elsewhere) and was unnecessary. Feature branch `claude/milestone-7-research-backend` created from it. |
| Recent history | #30 M6 follow-ups, #29 M3 harness fix, #28 Milestone 6 … as expected; M0–M6 architecture present (nothing rebuilt) |
| Worktree | clean |
| `npm ci` | succeeded |
| `npm test` (baseline) | **636 passed**, 0 failed / skipped / cancelled / todo |
| `npm run build` (baseline) | passed; `dist/` unchanged |
| Environment | macOS 26.6.2 (arm64, Apple M4), Node 22.23.1, npm 10.9.8, Python **3.12.14** (Homebrew), Docker Desktop 29.7.2 (Compose v5.3.1), Postgres 17.7 (container), Playwright 1.63.0 + system Chrome |

## 2. Backend architecture

`research_backend/physiq_research/` — FastAPI API process (`api/`) → Postgres
job queue (`storage/`) → separate worker process (`workers/`) → pipeline
(`pipeline/processor.py`): digest check → probe → streamed decode →
orientation → time-grid sampling → local pose inference → `research-pose-frame-v1`
→ M6 protocol replay → squat analysis → normalized skeleton → features /
traces / time-normalized traces → one atomic database transaction. Pose
provider, decoder and repository sit behind explicit interfaces; tests swap the
pose provider. Diagram and file map: RESEARCH_BACKEND.md §2.

## 3. API

| Route | Schema |
|---|---|
| `POST /research/v1/jobs` | multipart in → `ResearchJobResponseV1` (`research-job-v1`), 202 / 200 deduplicated |
| `GET /research/v1/jobs/{job_id}` | `ResearchJobResponseV1` |
| `DELETE /research/v1/jobs/{job_id}` | `ResearchDeletionResponseV1` (`research-deletion-v1`) |
| `GET /research/v1/assessments/{id}` | `ResearchAssessmentResultV1` (`research-assessment-result-v1`); `?include_artifacts=false` for descriptors only |
| `DELETE /research/v1/assessments/{id}` | `ResearchDeletionResponseV1` |
| `GET /health/live`, `GET /health/ready` | `HealthV1` (ready → 503 without database or migrations) |
| any error | `research-error-v1` `{code, message, field?}` |

A test asserts the route table is exactly this set (plus the OpenAPI JSON); no
video/frame route exists.

## 4. Worker / job architecture

Postgres rows as a durable queue; atomic compare-and-set claim (plus
`FOR UPDATE SKIP LOCKED` on Postgres); 120 s lease renewed by heartbeat; every
worker write conditional on owning the lease; recovery re-queues expired jobs
(attempt < 2 and upload present) or fails them `worker_lost`; queued uploads
expire after 1 h (`upload_expired`); success is one transaction (job +
assessment + 4 artifacts). Verified: three concurrent claimers over six jobs
claim each exactly once (SQLite and Postgres); a stale owner cannot heartbeat
or fail a job; a crashed worker's job is re-queued then failed `worker_lost`
on the second crash; a database outage during save leaves the job
`processing` with an expiring lease (never "healthy"); deletion during
processing cancels the job and discards the result; stolen leases discard the
result. Details: RESEARCH_BACKEND.md §6.

## 5. Video lifecycle

Raw video exists only in the request stream, as one `mkstemp` file
(`0600`, in a `0700` service-owned directory, name `rv-<random>.upload`) and in
decoder buffers. Deletion paths, each tested: API rejection of any kind (415,
413 by header and by streaming, 422 fields, malformed multipart — a client
disconnect takes the same `finally` path but has no dedicated test),
deduplicated submission, `DELETE` of a queued/processing job;
worker `finally` after success, every classified failure, injected exceptions
at **digest, probe, pose init, decode, pose inference, protocol, segmentation,
normalization, features and database save**, real pose-runtime init and
inference failures, a failed database write, a database outage that also
prevents recording the failure, `KeyboardInterrupt`, cancellation and lease
loss; recovery when a crashed job fails; the orphan sweep (only our
`rv-*.upload` regular files older than 10 min, not referenced by an active
job — a decoy with the right name outside the directory, a foreign file, a
young in-flight file and a symlink were all left alone). Verified in the
Docker stack: files present at `0600` while queued, gone after processing.
Crash limitation documented (RESEARCH_BACKEND.md §6).

## 6. Decoder

PyAV **18.1.0** (FFmpeg 8.1.2, bundled). `mov` demuxer only, `file` protocol
only (a test shows FFmpeg would connect to a `tcp://` URL without the whitelist
and does not with it), external data references off, H.264/HEVC only, audio
never decoded. Time = `(pts − pts₀) × time_base` as an exact `Fraction`;
missing/duplicate/non-monotonic pts dropped and counted; > 10% → failure.
Tests on generated media: constant frame rate (exact times), variable frame
rate with a misleading declared 30 fps (index/fps would be wrong; the decoder
is exact), four time bases, B-frame reordering, portrait and landscape,
rotation metadata ±90° and 180° (pixels identical to the upright source),
mirrored matrix rejected, garbage, empty, zero-frame, audio-only, truncated
(50%, 90%, and before the index), oversized dimensions (rejected before
decoding), over-duration (declared and per-frame), frame-count and byte
limits, MPEG-4 Part 2 and anamorphic pixels rejected, two video streams
rejected, FFmpeg error text never exposed. Timestamp anomalies are exercised
through the real decode loop with a fake demuxer, because conformant MP4
muxers refuse to write them.

**Defect found and fixed during verification:** reading `frame.side_data` on
every frame created a PyAV reference cycle that kept every decoded frame alive
(211 decoded 1080p frames: 840 MB vs 56 MB). The full display matrix is now read
from the first frame only, later frames are compared via `frame.rotation`, and
a subprocess test bounds peak memory (< 250 MB for 121 1080×1920 frames).

## 7. Sampling

`video-sampling-v0.1`: nearest frame to each point of a 1000/15 ms grid anchored
at the first frame, ties to the earlier frame, within half an interval, no
frame twice, strictly increasing integer provider timestamps; exact rational
arithmetic; original timestamps kept. Tests: 30/60/120 fps → every 2nd/4th/8th
frame, ≤ 15 fps keeps every frame, 29.97 fps, VFR with jitter and a hole
(empty slots, no invented frames), ties, timestamp collisions, and a
brute-force implementation of the stated rule agreeing with the streaming one
on 50 random VFR sequences.

## 8. Pose provider

`mediapipe` **0.10.31** (Apache-2.0), `PoseLandmarker`, VIDEO mode, CPU,
`num_poses=2`, confidences 0.5, no masks; model `pose_landmarker_full.task`
`float16/1`, SHA-256 `5134a3aad27a58b93da0088d431f366da362b44e3ccfbe3462b3827a839011b1`
(M6's vendored file, verified before every session, passed as bytes);
native library SHA-256 recorded (macOS arm64 `da58c7d34d9da7432c0722383329479f1b69c81ce1e34f9f676612fa44c32444`,
Linux x86-64 `715145a5556c567f4603c7f329e2c7382aba0123ac76b90108f64f8843e20639`).
The worker refuses any other runtime version and a tampered model (tested).

**Release audit.** The macOS arm64 wheels of 0.10.21, 0.10.30–0.10.33, 0.10.35
and 1.0.1 (and the Linux x86-64 wheels of 0.10.32 and 0.10.35) were
downloaded and their native libraries inspected:

| Version | `play.googleapis.com/log` | Clearcut / `LogRequest` | host-environment / TLS | extra native deps |
|---|---|---|---|---|
| 0.10.21 | 0 | 0 | 0 | jax, jaxlib, opencv, matplotlib, `numpy<2` |
| 0.10.30, **0.10.31** | 0 | 0 | 0 | — |
| 0.10.32 | 0 | 0 | 0 | opencv-contrib-python, matplotlib |
| 0.10.33 | 0 | 0 | yes | opencv, matplotlib |
| 0.10.35 macOS wheel / 1.0.1 (the 0.10.35 Linux x86-64 wheel showed neither marker; 0.10.31 is pinned on both platforms) | 1 | yes (`portable_clearcut_uploader`, `ion_http_client`) | yes; Python passes host OS/version and a `certifi` CA bundle | opencv, matplotlib |

**Behavioural confirmation.** The same PoseLandmarker workload (fresh graph,
150 frames per graph, 180 s) was run with each build inside a macOS sandbox
that denies all networking and DNS, under the libc network monitor
(`tools/netmon`):

| Build | Graphs / frames | `getaddrinfo(play.googleapis.com)` | "Failed to send to clearcut" (its own log) | Internet sockets |
|---|---|---|---|---|
| 0.10.35 (rejected) | 134 / 20,100 | **134** (one per graph) | **134** | blocked by the sandbox |
| **0.10.31 (pinned)** | 131 / 19,650 | **0** | **0** | **0** |

Nothing left the machine: the sandbox denied the lookups. The Linux 0.10.31
library also contains none of the markers.

Python MediaPipe 0.10.31 and the on-device `@mediapipe/tasks-vision` 0.10.35
(WASM) are **separate implementations** that share the model file and the
intended kinematic semantics; they are not claimed to produce identical
landmarks.

## 9. Normalized skeleton

`normalized-skeleton-v0.1`: one transform per assessment from the M6-usable
calibration frames — origin = median hip centre, scale = median nose-to-ankle
distance (M6's standing height), facing = sign of median toe−heel x, mirror if
facing −x; `x_n = m(x − O.x)/s`, `y_n = (O.y − y)/s`. Recorded: analysis side,
facing, mirror flag, origin, fixed scale, reference counts, version. Tests:
translation, uniform scale, 2× resolution, half-size person and left/right
mirror give identical skeletons (1e-9); normalized angles equal pixel angles
(1e-9°); the squat is preserved (95° at the bottom; the hip descends in +y-up
coordinates); nose-to-ankle standing ≈ 1; missing landmarks stay null;
reference failure is explicit. Units: dimensionless image-space, never metres/3D.

## 10. Cross-language parity

19 scenarios generated by driving the **real M6 session controller**
(`tools/m6_parity/scenarios.mjs`): clean squat at 100 ms and at 15 Hz, no
motion, shallow, partial, two reps (the session stops after the first rep, so
M6 reports one complete rep — reproduced), back-to-back reps
(`multiple_repetitions`), missing frames throughout (never calibrates) and
during capture, 500 ms tracking gap (`data_gap_during_repetition`), bottom
pause, 5 Hz, 3 Hz (never calibrates), irregular 50–110 ms ticks (session's
66 ms gate applies), ±2° noise, right side, second person mid-capture,
frontal, low visibility.

| Compared | Result |
|---|---|
| calibration-window and capture frame timestamps | identical in all 19 |
| standing knee / trunk–thigh reference, knee range, hip ratio, standing height, ankle reference | within tolerance |
| minimum knee angle, apparent ROM (excursion), threshold | within tolerance |
| descent crossing, deepest point, ascent crossing, descent / ascent / repetition durations, max gap, samples | within tolerance / equal |
| full smoothed and raw knee and trunk–thigh traces | within tolerance |
| failure reasons / states, session phase | identical |
| rounded M6 result fields | identical except 20 rounding-boundary ties |
| **largest difference** | **5.68e-14°** (angle-like) and **4.55e-13 ms** (tolerances 1e-9°, 1e-6 ms) |

The 20 ties are all one sample value, the fixture's exact 121.25° trunk–thigh
angle: identical inputs give `atan2` results one ulp apart (V8
`2.1162117180431244`, macOS libm `2.116211718043124`), i.e. 121.25 vs
121.24999999999996°, which round to 121.3 vs 121.2. A mismatch is accepted
only when it is exactly one rounding unit and the unrounded value is within
1e-7 units of the midpoint; values are never rounded before comparison.
`test/researchParityFixtures.test.js` (20 tests in `npm test`) regenerates the
fixtures from the live M6 code and fails on drift.

## 11. Segmentation

Exactly M6's algorithm (RESEARCH_BACKEND.md §12; MOVEMENT_ASSESSMENT.md §12):
reference R from calibration; deepest = earliest minimum; E = R − A_min ≥ 20°;
T = R − 0.1E; interpolated crossings; second-rep check at R − 0.5E; ≤ 300 ms
gaps; ≥ 8 samples. Shared semantics, no redefinition. Research-only
additions (new identities): M6 protocol replay on media time, full-precision
storage, time-normalized traces.

## 12. Kinematic features (`kinematic-features-v0.1`)

Standing knee reference (°), minimum knee angle (°), apparent 2D knee ROM (°),
trunk–thigh reference/minimum/apparent change (°, when available), descent /
ascent / detected-repetition durations (ms media time), events (ms media time),
analysis side, facing, mirror flag, capture-quality factors and state,
usable-frame statistics, full knee and trunk–thigh traces (°, ms), 101-sample
time-normalized traces. Hand-derived truth on real encoded video (30 fps, 60
fps, VFR, rotated, mirrored): ROM 80 ± 0.6°, descent 1080, ascent 1480,
repetition 2560 ± 12 ms (VFR ± 25 ms), deepest at 4200 ms.

## 13. Persistence

Alembic `0001_research_initial`: `research_jobs`, `research_assessments`,
`research_assessment_artifacts` (JSONB on Postgres), update-rejecting
triggers on both assessment tables, per-artifact and record SHA-256 digests,
schema validation on read. Migration from an empty database, zero diff between
migration and table definitions (`alembic` `compare_metadata`), downgrade and
re-upgrade — all verified on SQLite and Postgres.

## 14. Versioning

Independent families (RESEARCH_BACKEND.md §15): `research-pipeline-v0.1`,
`video-decoding-v0.1`, `video-sampling-v0.1`, `research-pose-frame-v1`,
`normalized-skeleton-v0.1`, `kinematic-features-v0.1`,
`time-normalization-v0.1`, API contracts `*-v1`, artifact schemas `*-v1`,
runtime `mediapipe 0.10.31` + model hash, source semantics
`squat-kinematics-v0.2` / `movement-assessment-v0.1` (recorded, not reused),
migration `0001_research_initial`. Tested: all distinct; no TissueOS or M6
identity used as ours; the processing fingerprint changes with any version,
parameter or model hash; a new pipeline version creates a new assessment and
leaves the old record byte-identical.

## 15. Privacy

| Question | Answer |
|---|---|
| Raw video retained after processing? | **No** |
| Raw video uploaded externally? | **No** |
| Frames uploaded externally? | **No** |
| Landmarks sent externally? | **No** |
| PII stored? | **No** (optional opaque v4 `research_subject_id` only; PII fields rejected; no filename; verified by scanning every stored row in the E2E test and the Docker database dump) |
| Derived movement data persisted? | **Yes**, intentionally; documented as sensitive, not anonymous |
| Model training performed? | **No** |

No consumer integration: tests scan `js/`, `index.html`, `build.mjs` and the
built `dist/` for any research endpoint, port or identifier (none), and
re-check that M6 movement code has no upload/persistence API.

## 16. Security

Input limits (100 MiB, 30 s, 3840×2160, 3600 frames, 8 pending uploads) enforced
and tested; content sniffed, not trusted from name/extension/type; FFmpeg
confined to `mov` + `file`; filenames never used (tested with `../../../../etc/…`,
absolute, backslash, Unicode/emoji, 300-char, NUL, empty — and a 20,000-char
name rejected by header limits); OS-created 0600 temp files in a 0700
directory; path identifiers validated as UUIDs; stable errors without
tracebacks, paths or input echo (tested, including a forced internal error);
loopback-only bind by default, Host-header allowlist, custom-header CSRF guard,
no CORS; worker without Internet route in Compose. `pip-audit` over the runtime
lock: no known vulnerabilities. Not present, by design of a local prototype:
authentication, authorization, TLS, rate limiting.

## 17. Automated tests

| Suite | Command | Result |
|---|---|---|
| Python, complete (macOS, real Postgres + real MediaPipe + 180 s network monitor) | `RESEARCH_TEST_POSTGRES_URL=… RESEARCH_TEST_REAL_POSE=1 pytest` | **320 passed** |
| Python, hermetic default (fresh venv from the lock file) | `pytest` | 273 passed, 47 skipped (40 Postgres, 7 real-runtime — opt-in) |
| Python on Linux x86-64 (Docker test image, compose Postgres, real MediaPipe) | `docker compose --profile test run tests` | **317 passed**, 3 skipped (2 consumer-source scans — sources not in the image; 1 macOS-only monitor) |
| Lint / format / types | `ruff check .`, `ruff format --check .`, `mypy` (strict, pydantic plugin) | clean; 50 source files |
| JavaScript | `npm test` | **656 passed** (636 baseline + 20 M6-parity drift guards) |

Per file: API 53, boundaries 40, storage 26, cleanup 23, decoder 33, pipeline 21,
M6 parity 21, pose-frame/geometry 30, protocol/skeleton/time-normalization 15,
sampling 13, segmentation 12, config 13, canonical/versions 11, real runtime 7,
E2E 2.

## 18. Postgres integration

Real Postgres 17.7 (Docker), a freshly created database per test (40 tests):
migration from empty and schema diff, reversible migration, job insert,
atomic concurrent claiming, heartbeat/lease rules, processing, successful
result insert and retrieval, restart durability (new engine, identical
digests), failed-job persistence, immutability triggers, tamper and schema
rejection on read, NaN rejection, duplicate source, new pipeline version,
deletion and double deletion, the full API suite and the E2E flow. Also the
Docker stack's own Postgres for the process-level run (§20).

## 19. Real provider smoke test (runtime integration, not validation)

| Check | Result |
|---|---|
| Model/runtime initialisation (provider incl. SHA-256) | 0.11–0.15 s; per-video graph ≈ 0.12 s |
| MediaPipe test image (hash-pinned `pose.jpg`) vs its published landmarks | max \|Δ\| **0.019** (normalised) |
| Same image stored sideways + rotation metadata → decoder → model | max \|Δ\| **0.020**; the raw sideways pixels give landmarks that cannot match (> 0.1) |
| No person | no landmarks → `no_pose` |
| Two people side by side | two poses → `multiple_people` |
| Real worker end to end (person / blank / two people) | `insufficient_calibration/not_side_on` (frontal lunge), `no_pose`, `multiple_people`; uploads deleted; weights read once; one fresh graph per video |
| Sustained run under the network monitor | 180.3 s, **212 real jobs**: 0 DNS lookups, 0 datagrams, 0 Internet sockets; only socket activity = the deliberate loopback positive control and one local `/var/run/syslog` connection; 90 `lsof` samples with no inet socket; peak RSS flat at 298 MB across all jobs |

This proves the runtime works locally and silently. It says nothing about
joint-angle accuracy — the test image is a frontal lunge, not a squat.

## 20. End-to-end test

- **In-process, SQLite and Postgres** (`tests/test_e2e.py`): POST (filename
  `participant-jane-doe-2026.mp4`, subject UUID) → queued row + one 0600 file →
  a worker with its own engine claims and processes the real encoded squat →
  file gone → GET job (succeeded) → GET assessment (ROM 80°, descent 1080 ms,
  ascent 1480 ms, repetition 2560 ms; four artifacts) → no filename, name,
  media bytes or temp token anywhere in the database → DELETE → artifacts and
  assessment gone, job tombstoned and scrubbed → repeat DELETE
  `already_deleted`; a socket guard fails the test on any connection other than
  the database.
- **Process level, Docker Compose** (separate API and worker containers, real
  MediaPipe, Postgres): three videos via `curl` (filenames
  `../../../etc/*.mp4`); the portrait person video carrying rotation metadata →
  `insufficient_calibration/not_side_on`, the empty room and the dot figure →
  `no_pose` (the real model sees no human in dots); uploads `0600` while queued
  and gone afterwards; DELETE ×3 then repeat → `already_deleted`; database dump
  contains none of the filenames; logs contain job ids, digest prefixes and
  stable codes only. The worker container cannot reach the Internet
  (`Network is unreachable`, DNS fails). A packet capture in the worker's
  network namespace over the whole run contains worker↔Postgres traffic only,
  plus the DNS query of our own egress probe (ServFail) before the first job.
- **Not demonstrated:** a *successful* assessment with the real model. No
  approved squat video of a person exists in this repository, and none was
  obtained (§24). The success path is proven end to end with the deterministic
  pose double on real encoded video.

## 21. Performance (MacBook, Apple M4; sanity, not a benchmark)

| Measure (1080×1920 portrait, 30 fps, 8 s, H.264, real MediaPipe) | Value |
|---|---|
| input size / peak temporary disk (the single upload copy) | 142,910 B |
| decode + sample + RGB conversion (241 decoded, 121 sampled) | 0.11–0.20 s |
| provider init / per-video graph | 0.11–0.15 s / 0.11–0.13 s |
| pose inference | 2.42 s (≈ 20 ms per sampled frame) |
| total job (ends at calibration: frontal pose) | 2.7 s |
| peak RSS of the processing process | ≈ 280 MB; flat across 212 jobs in the sustained run |

| Derived data for one successful 7 s squat (1080×1920, 106 sampled frames) | Bytes |
|---|---|
| input video | 2,040,639 |
| pose series (image-space landmarks) | 116,126 |
| normalized skeleton | 143,082 |
| kinematic traces | 16,183 |
| time-normalized traces | 6,406 |
| summary / provenance | 3,256 / 4,218 |
| **total persisted JSON** | **289,271** |

No unbounded frame accumulation (fixed §6; regression-tested), no duplicate
model initialisation (weights read once per worker, tested), memory flat over
212 jobs. Docker on Apple silicon runs the amd64 image emulated (slower).

## 22. Frontend regressions

| Check | Result |
|---|---|
| `npm ci`, `npm test` | 656 passed |
| `npm run build` | passed; `dist/` byte-identical to the committed build (no diff) |
| M6 Movement Assessment browser acceptance (`movementAssessment.browser.mjs dist production`) | **28 grouped checks passed** |
| M6 real-runtime smoke (`poseSmoke.browser.mjs dist`) | **6 checks passed** |
| M4/M5 history and recovery (`tissueHistory.browser.mjs dist production`) | **35 grouped checks passed** |
| M3 Tissue Load (`tissueLoad.browser.mjs dist production`) | **20 checks passed** |

The consumer camera flow still stays local, uploads nothing and persists nothing
(M6 acceptance network and storage checks, unchanged code). No app file was
changed except a README pointer.

## 23. Scientific limitations (non-claims)

No comparison with optical motion capture. No force-plate validation. No GRF,
joint moments, inverse dynamics, kinetics, muscle/tendon/tissue force, stress
or load. No injury, risk, readiness, capacity, diagnosis, form or quality
score, safe/unsafe rating or recommendation. Apparent 2D angles from one
monocular view, dependent on camera placement; landmarks are model estimates;
normalized coordinates are dimensionless image units. No accuracy of the
Python runtime against the on-device runtime or against ground truth is
claimed. No validation metrics (MAE, RMSE, repeatability, camera-angle
sensitivity) were computed — there is no ground truth.

## 24. Remaining issues

**Blocking defects:** none known.

**Research limitations / follow-ups (not blockers):**
- A successful real-model assessment needs an approved squat recording of a
  consenting participant; obtaining one is a research-governance step.
- Docker image is `linux/amd64` only (no mediapipe 0.10.31 Linux arm64 wheel);
  emulated on Apple silicon.
- PyAV's wheel bundles GPL-licensed x264/x265 and LGPL-3.0 FFmpeg; publishing
  the image requires a licence review (RESEARCH_BACKEND.md §20).
- `pip check` reports "mediapipe 0.10.31 is not supported on this platform": the
  wheel's internal `WHEEL` file declares `cp39-cp39-linux_x86_64` (upstream
  packaging slip); the filename tags are correct and the runtime works.
- The network monitor is macOS-specific; on Linux the evidence is the
  internal-network isolation, a packet capture and the static marker check.
- A process kill skips `finally`; leftovers wait for the next worker
  maintenance pass (documented, tested).
- No authentication/TLS/rate limiting — acceptable only for local use.

## 25. Final status

```
Milestone 7 implementation complete: yes
Research API architecture sound: yes
Video timestamps handled correctly: yes
Raw video ephemeral by default: yes
Derived data versioned and reproducible: yes
M6 semantic parity established: yes
Python pose runtime telemetry-free in tested scope: yes
Real Postgres integration verified: yes
End-to-end research pipeline verified: yes
No consumer upload integration added: yes
No GRF/force/kinetics implemented: yes
M0–M6 regressions clear: yes
Blocking defects remaining: no
Ready for independent Astra review: yes
Ready for Milestone 8: no
```
