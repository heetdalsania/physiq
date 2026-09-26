# Milestone 8 independent adversarial review

Review date: 2026-09-25 (America/Phoenix). Scope: [PR #32](https://github.com/heetdalsania/physiq/pull/32), `claude/milestone-8-force-plate-validation`. This is an engineering review of research infrastructure, not a scientific validation result. All force and estimate inputs used here were synthetic software fixtures. PR #32 was not merged and M9 was not started.

## 1. Reviewed repository state

I fetched `origin` and verified the original PR head `ac637eb10305d266ea2a0ef89a40b2b6d2aff071`, base branch `main`, and base SHA `8a909974638d9f190b9ca16a1db169ad0ef7a036` against both local git and `gh pr view`. The initial local branch was an older M7 commit; I fast-forwarded it to the fetched PR head before reviewing. The original M8 diff changes 44 files, adding 9,187 lines and removing 18. I inspected the migration, parser, manifest, synchronization, ground truth, evaluator, study, linkage and storage code, their boundary and regression tests, the M7 readiness and deletion paths, and the required M7/M8 documentation. The M8 implementation report was read after the code.

## 2. Architecture assessment

M8 is a local CLI layer over the M7 assessment repository. It reads bounded CSV/JSON bytes, stores canonical measured force, explicit clock mapping and derived ground truth, and evaluates a separately supplied estimate. The consumer app has no M8 path. The design is coherent after restoring independent M7 and M8 schema requirements. `data_origin`, event matching, sensor origin and estimator development membership remain declarations by research operators.

## 3. Confirmed findings and fixes

| Severity | Reproduction and consequence | Why prior coverage missed it | Fix and regression |
|---|---|---|---|
| HIGH | On a valid `0001_research_initial` database, M7 `/health/ready` returned 503 and its worker refused startup solely because the M8 migration was absent. | Tests migrated every M7 fixture to head. | M7 now requires `0001` or a known descendant; M8 CLI separately requires `0002` or a descendant. The new API test proves M7 submission and successful worker processing on SQLite and real Postgres, both direct at `0001` and after downgrade from `0002`. |
| MEDIUM | `check_held_out` allowed a trial with no subject ID whenever an estimate declared an empty development list, despite documentation saying such a trial was refused. | The old test asserted the permissive result. | Refuse missing subject IDs regardless of declaration; regression failed before the fix. Documentation now states that the list is self-declared, not proof of an unseen participant. |
| HIGH | Finite `1e308` force over 20 ms produced infinite impulse; a large finite anticorrelated series produced Pearson `r=+1` instead of `-1`, while RMSE overflowed. | Ordinary-magnitude fixtures and a Pearson clamp hid overflow. | Scale integration and error statistics safely; center and scale Pearson before products. Analytical regressions failed before the fix and pass afterward. A separate M8 numerical version changes trial and evaluation fingerprints; M7's fingerprint stays fixed. |
| MEDIUM | Timestamps `0` and `5e-324` seconds parsed, then produced infinite observed sampling rate. | Parser tests checked finite source values, not finite derived statistics. | Reject with stable `non_finite_derived_value`; bump the parser implementation version. |
| MEDIUM | Two participant metrics of `1e308` raised `OverflowError` in `statistics.fmean`; the even-length median would overflow. | Aggregation tests used small metrics. | Scale the mean, compute the median without an overflowing sum, reject unrepresentable derived statistics, and bump the aggregation version. |
| LOW | M7 deletion reported `artifacts_removed: 4` although its cascade also deleted M8 artifacts and results. | Existing tests asserted only the M7 count. | Clarified the M7 API field and documentation: it counts M7 assessment artifacts only. M8 cascade is additional. |

## 4. M7/M8 schema-coupling verdict

The original exact-head check was an architecture defect, not a cosmetic choice. M7 tables and processing do not require M8 tables; an M7-only `0001` database is valid. Readiness now checks Alembic ancestry from the service's minimum revision. The M8 CLI names its own minimum. Known descendants remain acceptable, including a future migration shipped with the code; an unknown revision remains conservatively unready. Direct and downgraded `0001` databases processed an M7 assessment on both SQLite and Postgres. Downgrading deletes M8 records by the migration's explicit semantics and leaves M7 records intact.

## 5. Force parser verdict

I checked byte digesting before parsing, strict UTF-8/BOM handling, LF/CRLF handling, exact headers, JSON-number grammar, no trimming/sorting, monotonic timestamps and source bounds. The parser uses the same in-memory byte buffer for SHA-256 and decoding, so a path replacement cannot make the digest describe different parsed bytes. Independent subnormal and huge-value probes found the derived-range defects in §3. No silent unit inference or repair path was found. Parser version `force-plate-csv-parser-v0.2` distinguishes new imports.

## 6. Manifest/PII verdict

Strict Pydantic models forbid extra fields, including nested fields; the JSON loader rejects duplicate keys and nonfinite tokens before model validation. Error documents use fixed codes and contract field paths rather than input values, unknown keys or filenames. The manifest contains UUID linkage, body mass, units, sign, digest and anchors, but no name, email, phone, free-text event or local path. These stored research values remain sensitive and are not anonymous.

## 7. M7 linkage verdict

Import reads M7 through its integrity-verifying repository, requires an exact assessment ID, record digest, movement, capture mode and null-safe subject equality, then persists the subject inherited from M7. The migration's foreign key and insert trigger repeat the link checks at the database boundary. A normal application role cannot insert a mismatched or orphan trial; a database owner can change triggers and rewrite unkeyed digests. Concurrency tests cover deletion between validation and save.

## 8. Synchronization math verdict

I re-derived `media_ms = offset_ms + rate × force_ms`. One anchor fixes rate at 1; two anchors give the stated quotient and offset. Support, ordering, 1,000 ms anchor separation and ±0.01 rate checks are explicit. The overlap is a closed intersection and repetition evaluation refuses extrapolation. Time conversion is `seconds × 1000`, not frame count or nominal frame rate. The two-anchor residual is nearly zero by construction and is not evidence of synchronization accuracy.

## 9. Synchronization scientific-semantics verdict

Event labels are provenance and do not affect the math. Two anchors may use different event types, and the software cannot tell whether either video time names the same physical event as its force time. The documentation now states that operator verification, timing uncertainty and sensor authenticity remain outside the software. This declared-anchor protocol is appropriate for infrastructure, with no claim of measured synchronization certainty.

## 10. Units/sign/bodyweight verdict

The input contract accepts seconds and newtons only, requires an explicit up/down sign, and stores canonical positive-up Newtons while preserving the source digest and sign multiplier. Body weight is declared mass times exactly `9.80665`; the M7 mass is never inferred from standing force. Wrongly declared units or sign cannot always be detected from magnitudes. A controlled mutation to `9.8` and one reversing sign were caught by tests and restored.

## 11. Ground-truth-window verdict

The M7 repetition window must be bracketed by native force samples. A gap greater than 20 ms between its bracketing samples and a non-positive force in this one-plate, both-feet squat protocol are rejected; these are capture rules, not universal biomechanical facts. Native overlap samples retain source indices. Endpoints between samples are linearly interpolated for repetition quantities.

## 12. Interpolation/impulse verdict

Pointwise measured values use linear interpolation at prediction timestamps without extrapolation. Peak and impulse use each signal's own piecewise-linear nodes over the comparison interval; the measured native peak is not silently downsampled to the prediction grid. Impulse integrates in seconds. The finite-overflow defect and its regression are in §3. A temporary mutation omitting the ms-to-s conversion was caught by the perfect-prediction analytical test and restored.

## 13. Evaluator verdict

Bias, MAE and RMSE are signed error `prediction − measurement`, with separate N and BW units. Pearson is a shape diagnostic, undefined for constant series; the overflow regression now distinguishes huge anticorrelated traces correctly. Peak and impulse are independent signal summaries over the same comparison interval. There is no aggregate accuracy score, classification or threshold. Prediction gap and sample-count gates remain explicit.

## 14. No-hidden-lag verdict

Import uses only declared anchors. Evaluation uses prediction timestamps as supplied, records `time_shift_applied_ms: 0`, and has no signal search, cross-correlation or timing optimization. The existing 100 ms delayed-waveform test reports worse error rather than recovering the shift.

## 15. Estimator-contract verdict

Production code defines a typed estimate document and future estimator interface but no estimator, training routine, model weights or inference implementation. The test-only null baseline is under `tests/support`. Estimate artifacts name estimator identity/version, M7 record digest, quantity, unit, time axis and timestamped force values.

## 16. Held-out-semantics verdict

The check excludes a trial whose subject appears in the estimate's declared development-subject list and now refuses a null subject even when that list is empty. An empty or false list can still be supplied; neither code nor an unkeyed digest proves training membership. Reports therefore describe the declaration and require independent study governance before calling any real trial held out.

## 17. Study aggregation verdict

Included trials are grouped by research subject and averaged within subject before cross-subject statistics. Duplicate trial, assessment and force-source identities and mixed versions/origins are rejected; excluded and missing trials are enumerated. No confidence interval is invented. The extreme finite mean/median bug is fixed, and aggregation now identifies itself as `grf-study-aggregation-v0.2`. A person assigned two UUIDs cannot be detected by software.

## 18. Dedup/reprocessing/versioning verdict

Trial identity includes canonical manifest, source SHA, exact M7 record SHA and M8 processing fingerprint. Validation identity includes trial record, canonical estimate and evaluation fingerprint. The parser and numerical version changes create new processing identities; the numerical version is included in evaluation identity. A mutation test changed that version and verified both M8 fingerprints changed while the pinned M7 fingerprint stayed `8942bc0fab92ac4a516d4eabe673a48f3c249e9db7967029d69ac3ba17862b78`.

## 19. Postgres/immutability verdict

The full backend suite ran against real Postgres with fresh databases per parameterized test. I also created a separate temporary Postgres database, imported a synthetic M7/M8 pair, and independently tried raw SQL `UPDATE force_plate_trials`: the trigger rejected it. Deleting the linked M7 assessment removed its M8 trial. The migration creates FKs, checks and update-rejecting triggers; the integration tests additionally exercise raw SQL update, orphan/mismatch insertion, owner-trigger bypass and read-time digest rejection. This is application-role and ordinary database integrity. A database owner or superuser can disable triggers and rewrite both data and unkeyed digests; it is not cryptographic tamper proof.

## 20. Deletion/race verdict

Deleting M8 never deletes M7. Deleting M7 cascades to M8 trials, artifacts and validations and writes M8 tombstones. The suite exercises duplicate imports, delete-between-link-and-save, delete-between-evaluate-and-save, and threaded deletion/evaluation. `get_trial` rechecks a vanished row after a partial read. These tests cover named interleavings, not every possible scheduler sequence. M7's `artifacts_removed` field is scoped as explained in §3.
Fault injection after the trial row, artifact writes and validation row verifies transactional rollback; no partial scientifically valid-looking record survives those injected stages.

## 21. Migration verdict

The migration is additive to M7. I independently ran an empty temporary Postgres database through `0001 → 0002 → 0001 → 0002 → base → 0002`, checked three M8 trial triggers at head, verified M7 readiness at `0001`, and checked the M8 tables were absent after downgrade. The real Postgres suite also checks schema reflection against SQLAlchemy metadata. The new M7-only regression processes a successful assessment after a `0002 → 0001` downgrade. M7 values are not rewritten by the `0002` migration.

## 22. Raw-export/privacy verdict

The CLI opens a path read-only and nonblocking, checks the opened descriptor with `fstat`, reads bounded chunks once, and parses/hash-checks the resulting buffer. It stores no raw CSV, filename or local path. Its fixed-code errors do not echo paths. The source is operator-managed; M8 cannot authenticate that bytes came from a physical plate. The `data_origin` field is operator-declared, not sensor or ethics proof.

## 23. Canonicalization/integrity verdict

Artifacts, provenance, summary and record use canonical JSON digests; reads verify digests, schemas, the M7 link and ground-truth arrays derived from the stored signal/mapping. The suite checks restart reads and SQLite/Postgres JSON round trips. Digests detect ordinary corruption, not coordinated rewriting by a database owner.

## 24. M7 scientific-boundary regression verdict

The M7 identifier scan excludes only the M8 `force_plate` subtree; it still scans shared utilities, API, workers, storage and pipeline. I inserted a temporary forbidden `calculate_tissue_force` identifier in the shared package root; the M7 boundary test failed and the mutation was removed. M7 version families and processing fingerprint remain unchanged.

## 25. Consumer regression verdict

No consumer source or dependency changed in this PR. After `npm ci`, all 656 JS tests and the production build passed. Browser acceptance passed for M3 (20), M4/M5 (35 grouped), M6 (28 grouped), and real-pose M6 smoke (6). The M6 request trace contained app assets and the pre-existing font request, with no M8 upload, endpoint or result display.

## 26. Dependencies/performance verdict

M8 added no dependency. `pip check` still reports the pre-existing MediaPipe wheel-platform metadata issue. `pip-audit` was unavailable locally. `npm audit --omit=dev` reported the same untouched consumer dependency chain with one critical (`tar`) and two high (`brace-expansion`, `@xmldom/xmldom`) findings; this review did not change unrelated npm packages. The synthetic SQLite performance run measured 30,001 samples in 0.154 s import and 599,501 samples in 2.435 s, with cumulative peak RSS 372.2 MiB and 16.8 MB of stored JSON at the large case. These are engineering timings, not scientific evidence.

## 27. Scientific claims verdict

No video-derived GRF accuracy, joint moments, inverse dynamics, tissue forces, risk, readiness, recovery, clinical validity, or safe/unsafe movement is established. Synthetic tests verify software behavior only. “Measured ground truth” names the intended physical plate input for real research, conditional on externally verified sensor origin; the parser does not authenticate it. The `research_recording` report text now explicitly says operator-declared and disclaims sensor authentication. Zero anchor residual does not establish synchronization quality.

## 28. Real-data gate

Approved real human data used: no
Real successful M7 human squat: no
Real synchronized force-plate trial: no
Scientific GRF validation complete: no

## 29. Remaining limitations

No approved paired human trial, learned estimator or pre-registered held-out study exists. Event correspondence, plate calibration/zero, units as actually exported, consent, participant identity across UUIDs, training membership and sensor authenticity require external controls. The tests do not establish every race interleaving or protection from a malicious database owner. An old binary that does not know a future migration revision conservatively reports unready.

## 30. Final status

Final-state verification: clean Python 3.12 environment installed from `requirements-dev.lock.txt`; full real Postgres backend suite **685 passed, 7 real-runtime opt-in skips**; separate real MediaPipe and network-monitor suite **7 passed**; static `ruff check`, `ruff format --check`, `mypy` and `git diff --check` passed. Consumer: `npm ci`, **656 tests**, build, M3/M4-M5/M6 browser acceptance and real-pose smoke passed. The branch remains unmerged. No M9 work was done.

M8 architecture sound: yes
M7/M8 schema coupling acceptable: yes
Measured-force parser/canonicalization sound: yes
Force/video synchronization mathematics sound: yes
Synchronization scientific semantics sound: yes
Units/sign handling sound: yes
Bodyweight normalization sound: yes
Ground-truth window sound: yes
Interpolation/impulse calculations sound: yes
Validation evaluator sound: yes
No hidden lag optimization: yes
Estimator boundary preserved: yes
Held-out semantics accurately scoped: yes
Study aggregation sound: yes
M7 linkage sound: yes
Postgres persistence/immutability sound: yes
Deletion/race semantics sound: yes
Raw-export/privacy boundary sound: yes
Versioning/reproducibility sound: yes
M7 processing semantics unchanged: yes
Consumer app remains disconnected: yes
Scientific claim boundary preserved: yes
Approved real human data used: no
Real successful M7 human squat: no
Real synchronized force-plate trial: no
Learned GRF estimator implemented: no
Scientific GRF accuracy established: no
M0–M7 regressions clear: yes
Blocking engineering defects remaining: no
Review fixes pushed to PR #32: yes
Ready to merge M8 engineering infrastructure: yes
M8 scientific validation complete: no
Ready to begin M9: NO
