# Milestone 8 — Force-plate validation infrastructure: Verification

This records implementation-time checks at `ac637eb`. The independent review
in [MILESTONE_8_ADVERSARIAL_REVIEW.md](MILESTONE_8_ADVERSARIAL_REVIEW.md)
supersedes its schema-readiness and held-out enforcement conclusions and
contains final branch verification after review fixes.

> **M8 engineering infrastructure complete; scientific force-plate validation
> pending approved paired human data.**
>
> Everything below was observed at the implementation head. Every force signal, pairing and
> "estimate" used is a **SYNTHETIC TEST FIXTURE — NOT HUMAN DATA — NOT
> VALIDATION EVIDENCE**; no number in this report is a scientific result.

Design, contracts and non-claims: [FORCE_PLATE_VALIDATION.md](FORCE_PLATE_VALIDATION.md).
Setup and commands: [research_backend/README.md](research_backend/README.md).

| Evidence | Proves | Does not prove |
|---|---|---|
| Unit tests against analytical answers (synthetic signals) | parser, synchronization, interpolation, metrics, aggregation rules | anything about a real force plate, person or estimator |
| Real M7 worker (deterministic dot pose double, real encoded video) + M8 import | M8 consumes a genuine stored M7 record; linkage, overlap, ground truth, storage | real pose-model behaviour, real human movement |
| SQLite and real Postgres 17 | migrations, triggers, foreign keys, transactions, races, integrity on read | production readiness |
| Separate-process CLI runs (macOS deny-network sandbox for SQLite) | the operator workflow, exit codes, no network, no files written | multi-user or remote use |

---

## 1. Starting state

| Check | Result |
|---|---|
| `git fetch`; `origin/main`, `HEAD` | both `8a909974638d9f190b9ca16a1db169ad0ef7a036` (merge of PR #31, Milestone 7 + its adversarial hardening) — the expected SHA; main had not advanced |
| Worktree | clean. The session ran in an isolated git worktree already at that commit; branch `claude/milestone-8-force-plate-validation` was created from it (`git switch -c`). |
| Baseline backend suite on the base SHA (fresh Python 3.12.14 venv from `requirements-dev.lock.txt`, real Postgres 17.7) | **318 passed, 7 skipped** (real-MediaPipe opt-ins) |
| M7 processing fingerprint on the base SHA | `8942bc0fab92ac4a516d4eabe673a48f3c249e9db7967029d69ac3ba17862b78` (now pinned by a test) |
| Environment | macOS 26.6.2 (arm64, Apple M4), Python 3.12.14, Node 22.23.1, npm 10.9.8, Docker Desktop 29.7.2 (Compose v5.3.1), Postgres 17.7 (container), Playwright + system Chrome |

## 2. Branch and commits

| | SHA |
|---|---|
| Base | `8a909974638d9f190b9ca16a1db169ad0ef7a036` |
| Implementation commit | `a0647394733200b6c490322f0c9dd34804226bcd` |
| Final branch head | the commit that adds this report and one provenance test (see the PR; a report cannot contain its own SHA) |

## 3. Changed files

44 files, all under `research_backend/` except documentation; **no consumer-app
file** (`js/`, `index.html`, `build.mjs`, `dist/`, `package*.json`, iOS) changed.

| Area | Files |
|---|---|
| New package `physiq_research/force_plate/` (≈ 4,500 lines) | `versions`, `errors`, `limits`, `inputs`, `manifest`, `signal`, `sync`, `linkage`, `numerics`, `ground_truth`, `records`, `tables`, `repository`, `importer`, `estimate`, `evaluation`, `comparison`, `study`, `reports`, `cli`, `__main__`, `__init__` |
| Migration | `migrations/versions/0002_force_plate_validation.py` (new); `migrations/env.py` (+1 import registering the M8 tables) |
| M7 files touched at implementation head | `physiq_research/versions.py` (`DATABASE_SCHEMA_REVISION` → `0002_force_plate_validation`, reversed by the adversarial review); `physiq_research/__init__.py` and `pyproject.toml` (description text); `tests/test_boundaries.py` (identifier scan scoped to M7 modules — M8 has its own suite); `tests/test_storage.py` (+1 explicit import of the M8 tables for the schema diff) |
| New tests | `tests/support/force_fixtures.py`; `tests/test_force_plate_{parser,sync,ground_truth,evaluation,study,storage,cli,boundaries}.py` |
| Tool | `tools/measure_force_plate_performance.py` |
| Docs | `FORCE_PLATE_VALIDATION.md`, this report (new); `RESEARCH_BACKEND.md`, `research_backend/README.md`, `README.md` (pointers, database and deletion notes) |

## 4. Architecture implemented

```text
python -m physiq_research.force_plate import --manifest M --force-csv F
  inputs.read_bounded (regular file, byte bound, read once, no temp file)
  manifest.parse_manifest ──────────── force-plate-manifest-v0.1 (strict JSON, extra=forbid)
  SHA-256(bytes) == manifest.source.sha256
  signal.parse_force_csv ───────────── force-plate-csv-v0.1 / parser-v0.1 → canonical signal (N, up)
  linkage.read_linked_assessment ───── M7 ResearchRepository.get_assessment (digest-verified)
  sync.mapping_from_anchors / compute_overlap ── force-video-sync-v0.1
  ground_truth.build_ground_truth ──── force-ground-truth-v0.1 (native samples, BW, rules)
  repository.save_trial ────────────── ONE transaction: trial + 3 artifacts (dedup by trial key)
python -m physiq_research.force_plate evaluate TRIAL --estimate E
  estimate.parse_estimate ─ binding + held-out checks ─ evaluation.evaluate (grf-validation-v0.1)
  repository.save_validation ──────── one immutable result (dedup by result key)
study.aggregate (participant level) · reports (contracts, evidence statement, non-claims)
```

No HTTP route, no worker, no network client; nothing in the consumer app.

## 5. Migration

| Check | Result |
|---|---|
| `alembic current` → `alembic upgrade head` on an **empty real Postgres** database (Alembic CLI) | ran `→ 0001_research_initial → 0002_force_plate_validation`; `0002_force_plate_validation (head)` |
| Objects created | tables `force_plate_trials`, `force_plate_trial_artifacts`, `grf_validation_results`, `force_plate_trial_tombstones`; triggers `*_immutable` ×4, `force_plate_trials_link`, `force_plate_trials_tombstone` (plus M7's 2); foreign keys `force_plate_trials_assessment_id_fkey` (→ M7, CASCADE), `force_plate_trial_artifacts_trial_id_fkey`, `grf_validation_results_trial_id_fkey` |
| `alembic downgrade 0001_research_initial` then `upgrade head` | removes exactly the M8 tables, then recreates them |
| Schema diff (Alembic `compare_metadata`) after migration, SQLite and Postgres | **no difference** from the SQLAlchemy definitions |
| Downgrade to `base` and upgrade again (tests, both databases) | works |
| `create_all()` | not used anywhere |

## 6. Automated tests

All counts are fresh runs on this branch (the final tree = the implementation
commit plus one added provenance test), not quotes of earlier reports.

| Suite | Command | Result |
|---|---|---|
| Backend, hermetic default — **clean Python 3.12.14 venv** created from `requirements-dev.lock.txt` (`pip install --no-deps`) | `pytest` | **599 passed, 83 skipped** (76 Postgres + 7 real-runtime opt-ins); 682 collected |
| Backend with **real Postgres 17.7** (a fresh database per test) | `RESEARCH_TEST_POSTGRES_URL=… pytest` | **675 passed, 7 skipped** (real-runtime opt-ins) |
| Real MediaPipe runtime + 180 s network monitor (macOS) | `RESEARCH_TEST_REAL_POSE=1 pytest -m "real_pose or netmon"` | **7 passed** (189 s; M7's runtime, telemetry and failure-case tests — unaffected by M8) |
| Linux x86-64 container (`docker compose --profile test`, compose Postgres, **real MediaPipe**) at implementation commit `a064739` | `RESEARCH_TEST_REAL_POSE=1 … run tests` | **677 passed, 4 skipped** (3 consumer-source scans — sources not in the image; 1 macOS-only interposer) |
| Base SHA, for comparison | `RESEARCH_TEST_POSTGRES_URL=… pytest` | 318 passed, 7 skipped |
| Consumer JS | `npm test` | **656 passed** |

Every pre-existing Milestone 7 test passes unchanged, including the
cross-language M6 parity suite; the two M7 test edits are listed in §3.

New M8 tests by file (Postgres runs are the same tests parametrized onto a
fresh real Postgres database each):

| File | Tests | of which real Postgres |
|---|---|---|
| `test_force_plate_parser.py` — CSV contract, strict JSON, manifest, body mass, bounds | 130 | 0 |
| `test_force_plate_sync.py` — exact offset/affine, drift recovery (±50…800 ppm), degenerate/reversed/implausible anchors, supports, overlap, round trips | 30 | 0 |
| `test_force_plate_ground_truth.py` — native samples, g = 9.80665, rules, derivation checks, M7 linkage, provenance | 26 | 0 |
| `test_force_plate_evaluation.py` — analytical metrics, edges, refusals, no lag, determinism, estimate contract, held-out | 35 | 0 |
| `test_force_plate_study.py` — participant-level aggregation, exclusions, refusals | 20 | 0 |
| `test_force_plate_storage.py` — migration, FKs, triggers, integrity on read, reprocessing, deletion, rollback, races | 48 | 24 |
| `test_force_plate_cli.py` — workflow, errors, raw-export lifecycle, SIGKILL, separate process | 23 | 10 |
| `test_force_plate_boundaries.py` — vocabulary, no estimator/training/network/HTTP, consumer app, M7 fingerprint | 45 | 0 |
| **Total new** | **357** | **34** |

### 6.1 Force parser

Accepted: exact values, LF/CRLF, either column order, `down` → exact
negation. Rejected with stable codes and line numbers: empty file, BOM,
invalid UTF-8, lone CR, oversized field, quoted values, blank row, wrong
field count, empty value, `nan`/`NaN`/`inf`/`-Infinity`/`1e999`, `abc`,
` 5`, `1_000`, `+5`, `.5`, `5.`, `0x10`, duplicate and backward timestamps,
negative time, over-long field, missing/duplicate/unexpected/case-changed/
space-padded headers, byte/sample/span/time bounds. A 600,000-sample file
parses within the default bounds and one more sample is rejected. Unknown
column names and keys are never echoed.

### 6.2 Body mass

Accepted: 70, 70.5, 72.25, 10, 500, 160 (kept as 160 kg — never converted).
Rejected: 0, −70, −0.001, NaN, ±∞, `true`/`false`, `"70"`, `"70kg"`,
`"70,5"`, `null`, `[70]`, `{"kg": 70}`, 72500 (grams), 0.0725 (tonnes),
just outside 10/500, a 401-digit integer (`non_finite_json_number`).

### 6.3 Synchronization

One anchor (1000 ms ↔ 2500 ms) → offset −1500 ms, rate 1, exactly;
two anchors exact for representable inputs; known drift of −500, −200, 50,
200 and 800 ppm recovered to 1e-13 relative (rate) and 1e-9 ms (offset),
mapped times within 1e-9 ms over 7 s, and an offset-only mapping of the same
clocks accumulates exactly the predicted |ppm|·10⁻⁶ × elapsed time (e.g.
1.2 ms after 6 s at 200 ppm). Rejected: identical, degenerate-axis,
< 1000 ms, listed-backwards, reversed-clock, 2 % rate, s-for-ms mix-ups,
wrong anchor count, anchors outside force support or video support, no
overlap (including a single-point overlap). Partial overlap reported with
coverage fractions; closed boundaries (a force sample exactly at media 0 and
at the last frame is included); interpolation outside the support raises.
Round trips force→media→force and media→force→media within 1e-9 ms;
vectorized and scalar mappings are bit-identical.

### 6.4 Ground truth and M7 linkage

Samples are the canonical signal's own (source indices 1500–8500 for a 1.5 s
lead), unfiltered; the source arrays are byte-identical after derivation;
`vertical_grf_bw == vertical_grf_n / (70 × 9.80665)` exactly (≠ 9.8);
triangle signal → peak 900 N at 4000 ms, impulse 1600 N·s; rejections for an
uncovered repetition, a 22 ms gap inside the repetition (a 52 ms gap outside
is only reported), zero/negative force and a mislabelled sign. A real stored
M7 record links with identical events and media end (7000 ms); unknown and
deleted assessments are refused (`assessment_not_found` /
`assessment_deleted`); a relabelled M7 row is refused by M7's integrity check;
wrong movement / capture mode refused; three subject mismatches (other,
dropped, added) refused and nothing stored; the trial inherits the subject;
M7 rows are byte-identical before and after import and deletion. Provenance
names every item the specification lists (M7 id and record digest, subject,
movement, capture mode, source SHA-256, signal/sync/validation versions,
declared and canonical units, sign mapping, body mass and g, method,
parameters, anchors, force time support, overlapping media support, parser
and pipeline versions, limits) and no file name.

### 6.5 Numerical evaluator

Perfect prediction at every measured sample: all errors exactly 0, r = 1,
peak/impulse error 0, impulse 1600 N·s. At 15 Hz: pointwise error exactly 0.
Constant offsets +25/−40 N: bias, MAE, RMSE = offset (1e-9), r = 1, impulse
shifted by offset × |J|. ×1.1 amplitude: peak error 90 N, impulse error
160 N·s. Known single-node peak error 50 N. Constant body weight: impulse
BW × 2 s. Irregular timestamps (20–120 ms): MAE 12.5 N. Linear truth
interpolated exactly at non-node times and at interval boundaries. Predictions
beyond the measured support are counted, never compared with extrapolated
force. Refusals: no sample inside, 7 samples, a 350 ms hole, a 350 ms late
start, a 500 ms segment reaching in. Constant series → r `null`. A 100 ms late
waveform is reported as error (MAE > 15 N), `time_shift_applied_ms: 0`. The
metric digest is identical across runs and across processes. Estimate
contract: NaN/∞ values, empty, length mismatch, non-increasing and negative
timestamps, wrong contract/unit/quantity/axis, bad digest, bad name, non-v4
or duplicate development subjects, unknown fields, too many samples — all
rejected; held-out checks (`subject_not_held_out`,
`held_out_status_unverifiable`); `SubjectPartition` refuses overlap.

### 6.6 Storage, integrity, deletion and races (SQLite and real Postgres)

Foreign keys and the link trigger reject an unknown assessment, a different or
dropped or added participant, a different M7 record digest and a different
movement; an orphan artifact is rejected. `UPDATE` is rejected on all four M8
tables. After disabling the immutability triggers as the database owner,
reads refuse: changed artifact content (`artifact_integrity`), summary,
provenance, record digest, a schema violation with consistent digests
(`artifact_schema`), a changed force value with every digest recomputed
(`ground_truth_derivation`), a summary that disagrees with its artifacts, a
missing artifact and a changed M7 record digest (`assessment_link`); a
tampered validation metric is refused (`metrics_integrity`). Restart
durability: a new engine reads identical digests. Reprocessing under a changed
contract creates a new trial and leaves the old record byte-identical; a
repeated evaluation deduplicates, a changed evaluation fingerprint creates a
new result. Deletion: `deleted` (3 artifacts, 1 result) → `already_deleted`
→ unknown `not_found`; the M7 assessment and its 4 artifacts unchanged;
re-import creates a new trial. Deleting the M7 assessment cascades to the
trial, its artifacts and results, and the trigger writes the tombstone
(trial id + time only). Partial writes (fault after the trial row, after the
artifacts, and `KeyboardInterrupt` after the result row) leave no rows.
Races: three concurrent identical imports → one trial, `[False, True, True]`
deduplicated; the M7 assessment deleted between linkage and save → 
`assessment_not_found`, nothing written; the trial deleted between evaluation
and save → `trial_deleted`, nothing written; threaded delete-vs-evaluate
(3 rounds) never leaves an orphaned result. One defect found by these tests is
in §12.

### 6.7 Privacy and the raw-export lifecycle

With `tempfile.mkstemp/mkdtemp/NamedTemporaryFile/TemporaryFile/
SpooledTemporaryFile` replaced by failures and every write-mode `open`/
`os.open` recorded, a successful import, a parser failure, an empty file and
a digest failure performed **no write and created no file**; the operator's
CSV kept its SHA-256, mtime and directory listing. A dump of every M7 and M8
row contains no file name (`participant-jane-doe-2026-force.csv`), folder
path, `jane`, CSV header text or document name. `KeyboardInterrupt` at parse,
ground truth, before save, after the trial row and after the artifacts → exit
130 `interrupted`, no rows; an injected database failure → exit 1
`internal_error` without the exception text, no rows. A separate process was
**SIGKILLed while its trial and artifacts were inserted but uncommitted**:
afterwards no M8 row exists and the M7 record reads back (SQLite and
Postgres).

### 6.8 Command line, separate process

In process: import → dedup import → inspect (with and without arrays) → list
→ evaluate → export → study → delete → repeat delete → inspect (`trial_deleted`,
exit 4). As an operator runs it (`python -m physiq_research.force_plate` in a
separate process): the same flow; on SQLite under the macOS deny-network
sandbox profile, after a positive control showed the profile turns a socket
connect into EPERM (outside it: ECONNREFUSED). Errors: invalid identifier
(3), unknown trial (4), unreadable document (3), missing database URL,
unmigrated database and invalid limits (6) — none printing a path.

## 7. Real Postgres

Real Postgres 17.7 (`postgres:17.7-bookworm` container, loopback only), a
freshly created database per test: all 675 non-real-runtime tests pass,
including 34 M8 Postgres runs — migration from empty with zero schema diff and
reversible downgrade (to 0001 and to base), the plpgsql immutability, link and
tombstone triggers, foreign keys and `ON DELETE CASCADE` from M7, JSONB
round-trips verified bit-for-bit by the derivation check on every read,
tamper detection, reprocessing, idempotent deletion and cascade, partial-write
rollback, three concurrent identical imports, the M7-deletion/import race, the
trial-deletion/evaluation race, threaded delete-vs-evaluate, the SIGKILLed
uncommitted import, and the separate-process CLI flow. Separately, the Alembic
CLI migrated an empty Postgres database (§5).

## 8. Consumer app regressions

| Check | Result |
|---|---|
| `npm ci` | succeeded |
| `npm test` | **656 passed**, 0 failed/skipped |
| `npm run build` | passed; `dist/` **byte-identical** to the committed build (0 diff lines) |
| M3 Tissue Load browser acceptance (`tissueLoad.browser.mjs dist production`) | **20 checks passed** |
| M4/M5 history and recovery (`tissueHistory.browser.mjs dist production`) | **35 grouped checks passed** |
| M6 Movement Assessment acceptance (`movementAssessment.browser.mjs dist production`) | **28 grouped checks passed**, including "network: only same-origin static files; no upload, no POST" |
| M6 real on-device pose smoke (`poseSmoke.browser.mjs dist`) | **6 checks passed** |
| M6 camera-flow request trace | 17 requests, all GET: 5 same-origin app assets, Google Fonts and the pre-existing Open Food Facts barcode check; **no research, force-plate, GRF or upload request** |
| Consumer sources and `dist/` scanned for `force_plate`, `force-plate`, `vertical_grf`, `grf-validation`, `physiq_research`, `research/v1`, `force plate` | none (test) |

M8 adds no force-plate UI, upload path, force result, network call, consent
change or dependency to the app; no consumer source file changed.

## 9. Lint, formatting, types

| Check | Result (clean venv, final tree) |
|---|---|
| `ruff check .` (E, F, W, I, B, UP, S, N, C4, SIM, RUF, PL) | **All checks passed** |
| `ruff format --check .` | **112 files already formatted** |
| `mypy` (strict, pydantic plugin) | **Success: no issues found in 72 source files** |
| `git diff --check` | clean |

## 10. Performance (MacBook, Apple M4; sanity, not a benchmark; synthetic fixtures)

Import of a trial paired with a 7 s M7 assessment; the estimate is the TEST /
NULL BASELINE at M7's 106 sampled frames.

| Case | Samples | CSV | Import (parse / sync / GT / save) | Verified read | Evaluate | Stored JSON (signal / GT / total) |
|---|---|---|---|---|---|---|
| SQLite, 1 kHz × 30 s | 30,001 | 736 KB | 0.102 s (0.029 / <0.001 / <0.001 / 0.057) | 0.044 s | 0.046 s | 737 KB / 218 KB / 964 KB |
| SQLite, 2 kHz × 30 s | 60,001 | 1.51 MB | 0.199 s (0.067 / <0.001 / <0.001 / 0.116) | 0.083 s | 0.082 s | 1.51 MB / 448 KB / 1.96 MB |
| SQLite, 5 kHz × 119.9 s (default bound) | 599,501 | 15.5 MB | 1.555 s (0.564 / <0.001 / 0.001 / 0.934) | 0.605 s | 0.609 s | 15.5 MB / 1.30 MB / 16.8 MB |
| Postgres, 1 kHz × 30 s | 30,001 | 736 KB | 0.154 s (0.029 / – / – / 0.104) | 0.059 s | 0.064 s | 964 KB total |
| Postgres, 2 kHz × 30 s | 60,001 | 1.51 MB | 0.254 s | 0.115 s | 0.105 s | 1.96 MB total |
| Postgres, 5 kHz × 119.9 s | 599,501 | 15.5 MB | 1.927 s | 0.752 s | 0.784 s | 16.8 MB total |

Memory: a typical 1 kHz × 30 s trial in a fresh process peaked at **130.9 MB
RSS** (104.8 MB after imports, including M7's processing of the video);
running all three cases in one process, including the 600,000-sample bound,
peaked at 388 MB (SQLite) / 446 MB (Postgres). The CSV is bounded before it is
read (32 MiB) and parsed into two float64 arrays; synchronization itself is
sub-millisecond. The ground truth stores only the overlap (7 s of the video),
so its size is independent of how long the plate recorded.

## 11. Dependencies and vulnerability checks

| Check | Result |
|---|---|
| New Python or npm dependencies | **none** (no pandas, SciPy, scikit-learn, PyTorch or other ML framework; NumPy and Pydantic were already pinned); lock files unchanged (test) |
| `pip-audit` 2.10.1 over `requirements.lock.txt` and `requirements-dev.lock.txt` (throwaway venv) | **No known vulnerabilities found** |
| `pip check` in the fresh venv | only the known cosmetic `mediapipe 0.10.31 is not supported on this platform` (WHEEL tag; RESEARCH_BACKEND.md §20) |
| `npm audit --omit=dev` | 3 findings — `tar` (critical), `brace-expansion` (high), `@xmldom/xmldom` (high) — the **pre-existing** advisories in the unchanged `@capacitor/cli` chain reported by the M7 review; not introduced or touched by M8 |

## 12. Defects found and fixed during M8 development

| Defect | Found by | Fix |
|---|---|---|
| Pearson r of a constant prediction came out as 4.5e-16 instead of undefined: the mean of a constant array can differ from its elements by one ulp | scratch smoke run | exact constancy test before computing r |
| A trial deleted between `get_trial`'s separate statements was reported as corrupted (`artifacts_incomplete`) instead of absent | threaded delete-vs-evaluate race test | re-check existence and report a concurrently deleted trial as absent; the CLI maps a vanished result to `trial_deleted` |
| CR-only line endings were silently accepted (Python universal newlines), contradicting the documented LF/CRLF format | parser test | explicit rejection of a lone CR (`malformed_csv` with its line) |
| `Literal[9.80665]` is not a valid `typing.Literal` | review before tests | validator comparing with the constant |

## 13. Milestone 0–7 contracts

No M6 or M7 scientific contract changed: M6 camera contract, pose semantics
and displayed metrics; M7 media timing, sampling, pose provider, normalized
skeleton, segmentation, immutable storage, privacy lifecycle and raw-video
deletion; M3/M4/M5 models and Tissue Load. Evidence: M7's processing
fingerprint is byte-identical to the base (pinned test); M7's version families
are unchanged; every pre-existing M7 test passes (the parity suite included);
no JS file changed; `npm test` and the browser suites pass. Operational
notes at implementation head: M7 services required the database at Alembic
head `0002_force_plate_validation` (`alembic upgrade head`; additive), and an
M7 research deletion now also removes M8 rows derived from that assessment
(its API response is unchanged). **No COORDINATION / CONTRACT CHANGE REQUIRED
was triggered.**

## 14. Scientific language review

The whole diff was searched for validated, validation, accurate, accuracy,
ground truth, force, GRF, kinetics, moment, injury, risk, readiness, safe,
unsafe, recovery, capacity, tissue, clinical and diagnosis, and each hit was
inspected. Outcome: "ground truth" refers only to measured force-plate data
(the one video mention is "nothing derived from video is ground truth");
"validation" names the framework, protocol and result records, never an
outcome; "accurate/accuracy/validated", injury, risk, readiness, recovery,
capacity, tissue, moment, kinetics and diagnosis appear only in negations,
non-claims and boundary word lists; "readiness" also appears as M7's database
readiness probe and "NULL-safe" as a SQL term; "diagnostic" is used only in
the statistical sense requested for Pearson r. Three docstrings that said
"validated" for schema checking were reworded. The boundary tests enforce the
vocabulary mechanically for identifiers, schema keys, enum values, stored
records, reports and error messages.

## 15. Real-data gate

| Question | Answer |
|---|---|
| Approved real human data used | **no** — none exists in the repository or was obtained; no internet or dataset source was used |
| Real human M7 squat assessment succeeded | **no** — still unverified (M7 limitation unchanged) |
| Genuine force-plate trial paired | **no** |
| Any estimator evaluated | **no** — only the TEST / NULL BASELINE on synthetic fixtures, to exercise software |
| Any scientific accuracy claim justified | **no** |

## 16. Remaining limitations

See FORCE_PLATE_VALIDATION.md §22: no real paired data; manual anchors
without modelled timing uncertainty; one plate, total vertical force, one
movement; no preprocessing protocol (plate zeroing is external; small zero
offsets are not detectable); descriptive standing check; unweighted pointwise
metrics; no confidence intervals; local tooling without authentication;
database owners can bypass triggers.

**Blocking engineering defects:** none known.

## 17. Final status

```text
M8 engineering infrastructure sound: yes
Measured-force canonicalization sound: yes
Force/video synchronization sound: yes
M7 linkage sound: yes
Bodyweight normalization sound: yes
Validation evaluator sound: yes
Postgres persistence sound: yes
Stored outputs reproducible/immutable: yes
Deletion semantics sound: yes
Derived-data privacy boundary sound: yes
Consumer app remains disconnected: yes
Stage-3/M8 scientific boundary preserved: yes
Approved real human M7 squat validated: no
Real synchronized force-plate trial validated: no
Learned GRF estimator implemented: no
Scientific GRF accuracy established: no
M0–M7 regressions clear: yes
Blocking engineering defects remaining: no
Ready for independent review: yes
Ready to merge engineering infrastructure: yes
M8 scientific validation complete: no
Ready to begin M9: no
```
