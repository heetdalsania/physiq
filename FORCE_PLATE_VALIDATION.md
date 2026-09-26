# Force-plate validation infrastructure (Milestone 8)

TissueOS Milestone 8. Code: [`research_backend/physiq_research/force_plate/`](research_backend/physiq_research/force_plate/).
Verification evidence: [MILESTONE_8_VERIFICATION.md](MILESTONE_8_VERIFICATION.md).
Milestone 7 research backend (which this builds on): [RESEARCH_BACKEND.md](RESEARCH_BACKEND.md).

> **Status: M8 engineering infrastructure complete; scientific force-plate
> validation pending approved paired human data.**
>
> No approved recording of a person performing the squat on a force plate
> while being filmed exists in this repository, so no genuine pairing, no
> measured-versus-estimated comparison and no scientific result exist. Every
> number produced so far comes from a **synthetic test fixture** and is a
> software-test output, not evidence.

---

## 1. Scientific purpose

The long-term research question is whether video can estimate the
**measured** vertical ground-reaction force (GRF) of a movement. Answering it
requires, in this order:

1. measured force-plate ground truth recorded at the same time as the video;
2. an explicit, auditable mapping between the force clock and the video clock;
3. a pre-declared, transparent way to compare a video-derived estimate with
   the measured force;
4. participant-level evaluation on held-out participants.

Milestone 8 builds items 1–3 (and the participant-level seam of 4) as local
research software: it turns an approved force-plate export plus an existing,
immutable Milestone 7 squat assessment into a versioned **measured
vertical-GRF ground-truth artifact** in M7's media time, and provides an
evaluator for **future** estimates. It does not estimate force, and it does
not train anything. Only after validated kinematics/kinetics may later
milestones look at biomechanical models (e.g. OpenSim) or tissue quantities;
M8 does neither.

## 2. Current scientific status

| Question | Status |
|---|---|
| Engineering infrastructure (import, sync, ground truth, storage, evaluator, aggregation, CLI) | implemented and tested (see the verification report) |
| Approved real human data used | **no** — none exists here |
| Real human M7 squat assessment succeeded | **no** (the M7 limitation still stands; RESEARCH_BACKEND.md §9, MILESTONE_7_ADVERSARIAL_REVIEW.md §21) |
| Genuine force-plate trial paired with video | **no** |
| Video→GRF estimator implemented or evaluated | **no** — none exists; only a labelled TEST / NULL BASELINE in the tests |
| Scientific GRF accuracy established | **no** |

## 3. Exact supported movement

`bodyweight_squat_sagittal`, captured as `single_camera_sagittal` — the only
movement and capture mode Milestone 7 implements. An M8 trial must link to an
M7 assessment of exactly that movement and capture mode; anything else is
rejected (`unsupported_assessment_movement`, `unsupported_assessment_capture_mode`,
`unsupported_movement`, `unsupported_capture_mode`). No jump, landing, running,
gait or single-leg movement.

## 4. Exact measured target

**Total vertical ground-reaction force** (`measured_total_vertical_ground_reaction_force`)
from **one force plate with both feet on it** (`single_plate_both_feet`).
No horizontal GRF, no centre of pressure, no free moment, no left/right
separation — a single plate cannot measure left/right kinetic asymmetry, and
none is claimed. Dual plates would need a new contract.

## 5. Data contract

An import is two files: a canonical CSV and a JSON manifest.

### 5.1 Canonical exchange CSV (`force-plate-csv-v0.1`)

```text
time_s,vertical_force_n
0,686.4654999999999
0.001,686.4654999999999
0.002,686.4655
…
```

* UTF-8, **no byte-order mark**; LF or CRLF line endings (a lone CR is
  rejected); comma-separated; **no quoting**.
* The first line is the header with exactly `time_s` and `vertical_force_n`
  (either order, each once, no other column). No fuzzy or case-insensitive
  matching, no trimming, no metadata preamble.
* One sample per row, one value per column, no blank rows.
* Values are decimal numbers in JSON number grammar
  (`-?(0|[1-9]\d*)(\.\d+)?([eE][+-]?\d+)?`): no `NaN`/`inf`, thousands
  separators, whitespace, locale decimal commas, `+5`, `.5` or `5.`.
* `time_s`: seconds since force acquisition start; ≥ 0; strictly increasing.
* `vertical_force_n`: **measured** total vertical GRF in newtons, with the
  positive direction declared in the manifest.

A lab export in any other shape (vendor text formats, C3D, multi-channel
files) is converted into this format **outside** the scientific core, or by a
future, separately versioned adapter. The core never guesses.

### 5.2 Manifest (`force-plate-manifest-v0.1`)

```json
{
  "contract": "force-plate-manifest-v0.1",
  "data_origin": "research_recording",
  "assessment_id": "<M7 assessment id>",
  "research_subject_id": "<the assessment's research_subject_id, or null>",
  "movement_type": "bodyweight_squat_sagittal",
  "capture_mode": "single_camera_sagittal",
  "plate_configuration": "single_plate_both_feet",
  "body_mass_kg": 72.4,
  "source": {
    "format": "force-plate-csv-v0.1",
    "sha256": "<SHA-256 of the CSV bytes>",
    "quantity": "measured_total_vertical_ground_reaction_force",
    "time_reference": "seconds_since_force_acquisition_start",
    "time_unit": "s",
    "force_unit": "N",
    "vertical_force_positive_direction": "up"
  },
  "synchronization": {
    "method": "two_anchor_affine",
    "anchors": [
      {"event": "plate_impact", "video_time_ms": 412.0, "force_time_ms": 2411.0},
      {"event": "plate_impact", "video_time_ms": 8923.0, "force_time_ms": 10922.0}
    ]
  }
}
```

Rules (every violation is a stable error code, never a repair):

| Field | Rule |
|---|---|
| any key not listed | `unknown_field` (the unknown key is never echoed) |
| `contract` | exactly `force-plate-manifest-v0.1` |
| `data_origin` | `research_recording` or `synthetic_test_fixture` — an operator-declared provenance label that travels into every report (§16). It is **not** verified sensor origin, approval, ethics or consent evidence. |
| `assessment_id` | canonical UUID of an existing, non-deleted M7 assessment |
| `research_subject_id` | **required key**; must equal the assessment's value (both `null`, or the same version-4 UUID). The trial inherits it from M7; the manifest can only confirm it. |
| `movement_type`, `capture_mode`, `plate_configuration` | the only supported values |
| `body_mass_kg` | finite JSON number, 10–500 kg (§7) |
| `source.sha256` | 64 lowercase hex; must equal the SHA-256 of the CSV bytes read (`source_digest_mismatch`) |
| `source.time_unit` / `source.force_unit` | exactly `s` / `N`; anything else is `unsupported_unit` — **no unit conversion exists** |
| `source.vertical_force_positive_direction` | `up` or `down`, never inferred from the data (`unsupported_axis_convention`) |
| `synchronization` | §8 |

JSON documents are strict: UTF-8 without BOM, no duplicate keys in an object,
no `NaN`/`Infinity` and no number outside the double range.

### 5.3 Input bounds (`RESEARCH_FORCE_*`)

| Bound | Default | Error |
|---|---|---|
| CSV size | 32 MiB | `source_too_large` |
| samples | 600,000 | `too_many_samples` |
| span (last − first timestamp) | 120 s | `duration_exceeded` |
| any timestamp | 86,400 s | `time_out_of_range` |
| one value | 64 characters | `field_too_long` |
| manifest / estimate / study definition | 64 KiB / 16 MiB / 1 MiB | `document_too_large` |
| estimate samples / study trials | 100,000 / 10,000 | `too_many_predictions` / `invalid_study_definition` |

Only regular files are read (`*_not_regular_file`; a FIFO never blocks the
reader). Limits are recorded in each trial's provenance; changing one never
changes a stored value.

## 6. Canonical units

| Quantity | Unit / convention |
|---|---|
| force time | seconds since force acquisition start (`seconds_since_force_acquisition_start`) |
| media time | milliseconds since the first decoded video frame (`media_ms_since_first_decoded_frame`, M7) |
| vertical GRF | newtons, **positive up**. A column declared `down` is multiplied by −1 (an exact IEEE operation); `up` is kept bit-for-bit. |
| normalized GRF | body weights (§7) |
| impulse | newton-seconds (N·s) and body-weight-seconds |

## 7. Body-mass normalization

```text
body_weight_n   = body_mass_kg × 9.80665          (standard gravity, exact by definition; never 9.8)
vertical_grf_bw = vertical_grf_n / body_weight_n
```

* `body_mass_kg` is the **only** anthropometric field (data minimization). No
  sex, age, height or other anthropometrics are collected; introducing any
  would need a new, versioned protocol.
* It is a declared input and is **never estimated** from quiet-standing force.
* The accepted range 10–500 kg is a gross-error guard, not an eligibility
  rule: it rejects values that cannot be kilograms of a participant (e.g.
  grams, 72500, or tonnes, 0.0725). No value is ever converted — 160 is
  160 kg even if someone meant pounds (the standing check in §10 exposes such
  a mistake).
* Rejected: 0, negatives, NaN/∞, booleans, strings (`"70"`, `"70kg"`), lists,
  objects, null.
* The constant is recorded in the ground-truth artifact, the trial summary and
  the provenance.

## 8. Synchronization protocol (`force-video-sync-v0.1`)

Force and video are never aligned by assuming frame 0 = force sample 0, and
never by `frame_index / nominal_fps`. The clock model is explicit:

```text
t_media_ms = offset_ms + rate × t_force_ms          (t_force_ms = 1000 × t_force_s)
```

estimated only from **declared anchors** — the same physical event observed in
both clocks (`event`: `plate_impact`, `trigger_signal` or
`other_declared_event`):

| Method | Anchors | Mapping |
|---|---|---|
| `one_anchor_offset` | 1 | `rate = 1` exactly; `offset_ms = video_time_ms − force_time_ms` |
| `two_anchor_affine` | 2 | `rate = (v₂ − v₁)/(f₂ − f₁)`; `offset_ms = v₁ − rate·f₁` — a constant offset plus a small constant clock-rate difference |

Rejected (never repaired): anchor count ≠ method (`anchor_count_mismatch`);
anchors not strictly increasing in both clocks, including reversed order
(`anchors_not_increasing`); identical anchors or anchors closer than
**1000 ms** in either clock (`anchors_too_close`); `|rate − 1| > 0.01`
(`implausible_clock_rate` — a plausibility bound against unit or
transcription mistakes, about 100× typical crystal drift; it is **not** a
drift estimate); a force anchor outside the recorded force samples
(`anchor_outside_force_support`); a video anchor outside
`[0, last decoded frame]` (`anchor_outside_video_support`); a mapped force
signal that does not overlap the video (`no_temporal_overlap`).

Anchor timing uncertainty is not modelled numerically in v0.1. A video anchor
is known to about ±½ frame interval; with anchors Δ apart that becomes a rate
uncertainty of about 2δ/Δ — hence the minimum separation and the advice to
place the two anchors **several seconds apart** (e.g. one event before the
squat and one after). Anchor residuals (mapped − declared video time) are
stored; with one or two anchors they are zero up to rounding by construction,
so they check arithmetic, not synchronization quality.
Event labels are provenance only and do not change the clock calculation.
The two anchors may name different event types; for each pair, an operator
must establish that its video and force times refer to the same physical
event. The software cannot detect a transcribed time, mismatched event,
sensor-authenticity error or uncertainty in the event observation.

**Nothing is derived from the signals.** There is no cross-correlation, peak
matching or other signal-based alignment, and no lag search anywhere — not in
the import and not in the evaluator.

Determining `video_time_ms`: it must be M7 media time,
`(pts − pts₀) × time_base` in ms with `pts₀` the first decoded frame. With
FFmpeg: `ffprobe -v error -select_streams v:0 -show_entries frame=pts_time -of csv=p=0 video.mp4`
lists presentation times in order; subtract the first value and multiply by
1000 for the frame on which the event is seen. Timestamp anomalies that M7
drops (missing, duplicate or backward PTS) must be accounted for by whoever
reads the frames.

## 9. Time coordinate systems

| Name in data | Clock | Origin | Unit |
|---|---|---|---|
| `time_s` (signal artifact) | force plate | force acquisition start | s |
| `force_time_ms` (anchors) | force plate | force acquisition start | ms |
| `t_media_ms`, `*_media_ms`, `video_time_ms` | video (M7) | first decoded frame | ms |
| `force_s` intervals | force plate | force acquisition start | s |

Synchronized outputs state their valid interval in **both** clocks:

* `overlap` — closed intersection of the mapped force support with the
  video's media support `[0, last decoded frame]`, as `media_ms` and
  `force_s`, with `video_coverage_fraction` and `force_coverage_fraction`
  (a partial overlap is represented explicitly and accepted if it covers the
  repetition);
* `sample_support_media_ms` — first and last synchronized force sample;
* `repetition` — M7's `[descent_start_ms, ascent_end_ms]` and `deepest_ms`,
  plus the same instants in force time.

Nothing is extrapolated beyond these intervals, anywhere.

## 10. Preprocessing

**None** (`preprocessing: "none"`, recorded in every artifact). The canonical
measured signal is stored unfiltered and unresampled; the ground truth
consists of the canonical signal's own samples inside the overlap, each
traceable to its source index. There is no filter, cutoff, resampling,
smoothing, offset/zero correction or gap filling. The plate must be zeroed by
the acquisition system.

No universal cutoff frequency is implied. If a future protocol needs a
filtered or resampled signal, it will be a separate artifact kind with its own
version, recording filter type, order, cutoff and phase behaviour, without
overwriting the canonical signal (a migration adds the kind).

### Ground-truth rules (`force-ground-truth-v0.1`)

Rejections:

* the synchronized samples must **bracket the whole M7 repetition**
  (`repetition_not_covered`);
* within the repetition (including the two bracketing samples) no two
  consecutive force samples may be more than **20 ms** apart
  (`force_sampling_gap_in_repetition`) — a data-completeness rule keeping
  linear interpolation of measured force to spans far shorter than the video
  comparison cadence (≈ 67 ms at M7's 15 Hz sampling); it is not a claim about
  an optimal sampling rate (lab plates typically sample at 500–2000 Hz);
* measured force must be **> 0 N throughout the repetition**
  (`non_positive_vertical_force_in_repetition`): with both feet on the plate a
  bodyweight squat never unloads it, so zero or negative force means the
  declared sign, the plate zero or the setup is wrong. Nothing is flipped.

Descriptive only (never used to correct or reject):

* **standing reference** — time-averaged measured force over M7's standing
  calibration window and its ratio to the declared body weight
  (`mean_vertical_grf_bw`; `not_covered` when the window is not bracketed). A
  ratio far from 1 points to a wrong body mass, unit, zero, sign, foot
  placement or pairing. Exclusion thresholds belong to the external analysis
  plan (§11.3), not to this software;
* sampling intervals, non-positive sample counts and ranges over the overlap;
* measured peak, trough and impulse over the repetition.

## 11. Validation metrics (`grf-validation-v0.1`)

The evaluator compares a **separately supplied estimate** with the measured
ground truth. It never produces a prediction.

### 11.1 Estimate contract (`vertical-grf-estimate-v0.1`)

```json
{
  "contract": "vertical-grf-estimate-v0.1",
  "quantity": "estimated_total_vertical_ground_reaction_force",
  "unit": "N",
  "time_axis": "media_ms_since_first_decoded_frame",
  "assessment_id": "<the trial's M7 assessment id>",
  "assessment_record_sha256": "<that M7 record's SHA-256>",
  "estimator": {
    "name": "slug-name",
    "version": "1.2.0",
    "parameters_sha256": "<digest of the model parameters, or null>",
    "development_research_subject_ids": ["<every participant used to build, train or tune it>"]
  },
  "t_media_ms": [0.0, 66.7, 133.3],
  "vertical_grf_n": [686.1, 690.4, 701.9]
}
```

An estimate is bound to the exact M7 record it was computed from
(`estimate_assessment_mismatch` otherwise). Timestamps must be finite,
non-negative and strictly increasing; values finite; lengths equal.

**Held-out participants.** A trial without a `research_subject_id` is refused
(`held_out_status_unverifiable`). A trial whose subject appears in the
estimate's `development_research_subject_ids` is refused
(`subject_not_held_out`). An empty list is accepted for a trial with a subject,
but the result records `no_development_participants_declared`. This list is
supplied by the estimator author; the software has no independent training
membership record and cannot prove the participant was genuinely unseen.
External study governance must verify that claim. `SubjectPartition` enforces
disjoint sets only for the sets supplied to it; partitioning is by participant,
never by frame or trial.

### 11.2 Per-trial metrics

Let I = M7 repetition `[descent_start_ms, ascent_end_ms]`, S = the
prediction's `[first, last]` timestamp, J = I ∩ S.

| Rule | Definition |
|---|---|
| comparison grid | the prediction timestamps inside I (unweighted, one per timestamp) |
| measured value at a prediction time | linear interpolation between the two bracketing **native** force samples (exact at a sample time; never extrapolated — I is inside the measured support) |
| time shift | none (`time_shift_applied_ms: 0`) — a lag is error, never removed |
| coverage | every prediction segment overlapping I ≤ **300 ms** long (including a segment reaching in from just outside I), uncovered start/end of I ≤ 300 ms, ≥ **8** prediction samples inside I — the M6/M7 segmentation limits, restated as literal protocol values; otherwise `prediction_gap_exceeded` / `insufficient_prediction_samples` / `no_prediction_in_repetition` |
| pointwise | e = predicted − measured; `mean_signed_error_n`, `mae_n`, `rmse_n`, and the same in body weights |
| waveform shape | Pearson r over the same pairs — a shape diagnostic only, **not** agreement or accuracy; `null` (`undefined_constant_series`) when either series is constant |
| peak | maximum of each piecewise-linear signal on J (measured from native samples, predicted from prediction samples; earliest on ties): values, times, signed and absolute error in N and BW, time difference |
| impulse | exact integral (trapezoid) of each piecewise-linear signal on J: measured, predicted, signed and absolute error in N·s and BW·s |
| support | I, S, J, coverage fraction, uncovered ends, sample counts before/inside/after I, longest prediction segment, longest measured interval |

There is no combined score, ranking, threshold, good/bad or pass/fail label.
Each result stores the estimate itself, so it can be re-examined.

### 11.3 Study-level aggregation (`grf-study-aggregation-v0.2`)

A study definition (`grf-study-definition-v0.1`) names one estimator version,
the protocol and the trials, each optionally with a declared exclusion from
the external analysis plan (`protocol_deviation`,
`measurement_check_exclusion`, `synchronization_exclusion`,
`other_declared_exclusion`).

* **The participant is the unit of analysis.** Each participant's trials are
  averaged first; `n` is the number of participants — never trials, samples
  or frames. Study statistics: n, mean, sample SD (n−1), median, min, max.
  Trial-level means are reported only as descriptive and labelled "not
  independent".
* Every listed trial not included is reported with a stable reason
  (`trial_not_available`, `missing_research_subject_id`,
  `no_validation_result`, or the declared exclusion).
* Refused: the same trial twice, two trials of one M7 assessment (one
  physical repetition), two trials of one force recording, more than one
  result per trial for the estimator, mixed versions (M8 and linked M7
  versions, estimator parameters), mixed data origins.
* **No confidence intervals** are computed in v0.1: with few participants and
  no pre-registered model they would suggest more than the data support. If
  added, they must resample participants, not trials.

## 12. Privacy

Sensitive research data — **not anonymous**: the measured force trace, body
mass, subject linkage, derived validation metrics, and (from M7) pose
landmarks, normalized skeleton and kinematic traces. A person's movement and
force pattern can be identifying; the CSV and video SHA-256 values let anyone
holding the files confirm they were processed. Digests are not anonymization.

| Question | Answer |
|---|---|
| Raw force export persisted or copied? | **No** — read once into memory, never written anywhere (§13) |
| Filename, path or free text stored? | **No** — tested by scanning every stored row |
| Name, e-mail, phone, address, date of birth, account id, sex, age, height? | **No** — no such field exists; the manifest rejects unknown fields |
| Identity | only M7's opaque version-4 `research_subject_id`, inherited, never re-paired (a database trigger also enforces it) |
| Consent | external. There is no `consent=true` flag — a boolean would not be consent. Approval, consent records and the person↔`research_subject_id` mapping live in the approved research workflow outside this service. |
| Training data | none is created; nothing is used for model training |
| Network | none: the CLI makes no network call; no HTTP route was added; the separate-process test runs under a macOS deny-network sandbox |
| Consumer app | unchanged: no force-plate UI, upload path, result, network call, consent change or dependency |

## 13. Data retention

* **Raw force export.** The service never creates a copy: the CSV is read
  once into memory (bounded), hashed and parsed from that buffer, and the
  buffer is released when the command ends. There is no temporary file, so
  there is nothing to clean up after success, failure, cancellation or a
  killed process (all four are tested). The operator's own export file is
  **not** touched — not modified, moved or deleted — exactly like the original
  video on a researcher's device in M7; its retention or deletion is governed
  by the external research data-management plan.
* **Persisted:** the canonical numeric signal, synchronization, ground truth,
  summary, provenance, digests, validation results (including the estimate
  that was compared) and tombstones (trial id + deletion time only).
* **Raw video:** unchanged M7 rules (deleted after processing).
* Derived data is kept until research deletion (§20); there is no automatic
  expiry.

## 14. Exclusions / non-claims

* No force is estimated from video; no estimator exists; nothing is trained.
* No statement that video-estimated GRF is accurate, valid or clinically
  useful — none can be made without approved paired data and a held-out study.
* No joint moments, inverse dynamics, muscle, tendon or tissue forces, stress,
  strain or load; nothing reads or writes TissueOS Tissue Load.
* No injury, risk, readiness, recovery, fatigue, capacity, diagnosis, safe/
  unsafe, movement-quality or pass/fail judgement — not in outputs, not
  internally (tests enumerate every key, enum value and identifier).
* No left/right asymmetry (one plate); no horizontal GRF; no other movement.
* M7's non-claims remain true: M7 still estimates no GRF.
* Synthetic fixtures are not evidence (§16).

## 15. Real-data requirements

Before real data may enter:

1. an approved research protocol covering filmed squats on a force plate, with
   consent handled outside this service;
2. a real smartphone sagittal squat video that completes the **real** M7
   provider success path (still unverified — §2);
3. a simultaneously recorded force-plate export for the same repetition,
   converted into the canonical CSV outside the core;
4. synchronization events visible in both recordings, identified per a
   written procedure (event kind, how the frame and the force sample were
   chosen), ideally several seconds apart;
5. the participant's body mass measured per protocol;
6. raw media and exports kept in approved storage outside git; only opaque
   research ids in any file given to this software; `data_origin:
   research_recording`;
7. a pre-specified analysis plan (exclusions, held-out participants,
   statistics) before any estimator is evaluated.

## 16. Synthetic-fixture warning

**SYNTHETIC TEST FIXTURE — NOT HUMAN DATA — NOT VALIDATION EVIDENCE.**

The test fixtures (`research_backend/tests/support/force_fixtures.py`) are
closed-form signals (body weight plus m·a(t) for a cosine centre-of-mass
profile, or piecewise-linear shapes with known answers) paired with M7
assessments of a generated dot-figure video processed by M7 with its
deterministic dot pose double. The "estimate" in tests is a labelled
**TEST / NULL BASELINE** (constant body weight, or a known transformation of
the measured signal). They test parsing, synchronization, interpolation,
metrics, storage, deletion and errors — nothing else. Every fixture manifest
declares `data_origin: synthetic_test_fixture`, so every trial report says
`SYNTHETIC TEST FIXTURE — NOT HUMAN DATA — NOT VALIDATION EVIDENCE` and every
study report adds `SOFTWARE TEST OUTPUT`. No fixture number appears in this
document as a result.

## 17. How to import a trial

```bash
cd research_backend && source .venv/bin/activate
export RESEARCH_DATABASE_URL=postgresql+psycopg://research:research-local-only@127.0.0.1:55432/research
alembic upgrade head                                   # adds the 0002 force-plate tables
# 1. run M7 on the approved squat video (README: POST /research/v1/jobs) → assessment_id
# 2. convert the lab export to the canonical CSV; compute its SHA-256 (shasum -a 256 force.csv)
# 3. write the manifest (§5.2) with that digest, the anchors and the body mass
python -m physiq_research.force_plate import --manifest manifest.json --force-csv force.csv
```

Output: `force-plate-trial-report-v1` (trial id, versions, summary,
provenance, digests, `deduplicated`). Importing the same inputs under the same
versions returns the existing trial.

## 18. How to inspect a trial

```bash
python -m physiq_research.force_plate inspect <trial_id>                      # verified record, artifact digests
python -m physiq_research.force_plate inspect <trial_id> --include-artifacts  # + signal, sync, ground-truth arrays
python -m physiq_research.force_plate list [--assessment <assessment_id>]
```

Every read recomputes every digest, re-validates every schema, re-derives the
ground-truth arrays from the canonical signal and mapping bit-for-bit, checks
that summary and artifacts agree, and re-verifies the linked M7 record; any
failure is `stored_data_integrity_error` (exit 5) — never served.

## 19. How to evaluate a future estimator

```bash
python -m physiq_research.force_plate evaluate <trial_id> --estimate estimate.json   # grf-validation-report-v1
python -m physiq_research.force_plate export <trial_id> [--include-estimates]        # grf-validation-export-v1
python -m physiq_research.force_plate study --definition study.json                  # grf-study-report-v1
```

A future estimator implements `VerticalGrfEstimator` (`estimate.py`): its
input (`EstimatorInputs`) is the M7 record and the declared body mass —
**never measured force**. It must be separately versioned
(`name`, `version`, `parameters_sha256`) and declare every participant used to
build, train or tune it. That declaration needs independent verification under
the study protocol. Only after evaluation on real held-out trials may a
result be reported, and then only in the form:

> Estimator X, version Y, evaluated on N participants / M held-out trials
> under protocols grf-validation-v0.1 / force-ground-truth-v0.1 /
> force-video-sync-v0.1, had participant-level RMSE … — for this population,
> movement, camera setup and force-plate setup only.

## 20. Deletion behavior

```bash
python -m physiq_research.force_plate delete <trial_id>
```

* removes the trial, its three artifacts and its validation results (one
  transaction; `force-plate-deletion-v1` reports the counts);
* **never touches the linked M7 assessment** (`linked_assessment:
  "unchanged"`);
* idempotent: a database trigger writes a tombstone (trial id + time only),
  so a repeat answers `already_deleted`; an unknown id is `not_found`;
* raw source files are never resurrected (none are kept);
* deleting an **M7 assessment** (`DELETE /research/v1/assessments/{id}`)
  cascades to every M8 trial derived from it and its results (foreign key
  `ON DELETE CASCADE`), and the same trigger writes their tombstones — one
  research-deletion request removes everything derived from a recording. The
  M7 API's response contract is unchanged (it counts M7 artifacts only);
* races are closed by the database: an import whose assessment is deleted
  mid-way fails with `assessment_not_found` and writes nothing; an evaluation
  whose trial is deleted mid-way fails with `trial_deleted` and writes
  nothing; a concurrent duplicate import returns the one trial (tested on
  SQLite and Postgres);
* re-importing the same files after deletion is an explicit research
  operation that creates a **new** trial id.

Backups and logs outside this service follow the research data-management
plan.

## 21. Versioning / reproducibility

Independent families (`force_plate/versions.py`), none shared with M7 or
TissueOS, and **not** added to M7's `version_families()` (that would change
every M7 processing fingerprint — pinned by a test):

| Family | Identity |
|---|---|
| pipeline | `force-plate-pipeline-v0.1` |
| input contracts | `force-plate-manifest-v0.1`, `force-plate-csv-v0.1`, `vertical-grf-estimate-v0.1`, `grf-study-definition-v0.1` |
| parser | `force-plate-csv-parser-v0.2` (finite sampling-rate guard) |
| numerical implementation | `force-numerics-v0.2` (finite trapezoid, RMSE and Pearson arithmetic) |
| signal / trial | `force-plate-signal-v0.1` / `force-plate-trial-v0.1` |
| synchronization | `force-video-sync-v0.1` |
| ground truth | `force-ground-truth-v0.1` |
| validation protocol | `grf-validation-v0.1` |
| aggregation | `grf-study-aggregation-v0.2` |
| stored schemas | `force-plate-signal-artifact-v1`, `force-video-sync-artifact-v1`, `force-ground-truth-artifact-v1`, `force-plate-trial-summary-v1`, `grf-validation-metrics-v1` |
| command-line output | `force-plate-trial-report-v1`, `force-plate-trial-list-v1`, `grf-validation-report-v1`, `grf-validation-export-v1`, `grf-study-report-v1`, `force-plate-deletion-v1`, `force-plate-error-v1` |
| database | Alembic `0002_force_plate_validation` (additive; revises `0001_research_initial`) |

* **Processing fingerprint** = SHA-256 of the canonical JSON of every M8
  version and parameter (parser, synchronization, ground truth).
* **Trial key** = SHA-256 of {canonical manifest, CSV SHA-256, linked M7 record
  SHA-256, fingerprint} — same inputs + same contract → the existing trial; any
  new version or parameter → a **new** trial; an old one is never rewritten.
* **Result key** = SHA-256 of {trial id, trial record SHA-256, estimate
  SHA-256, evaluation fingerprint}.
* Every M8 table rejects `UPDATE` (database triggers, Postgres and SQLite).
  Changing a rule means a new version and new rows.
* Provenance records the M7 link (assessment id, record SHA-256, subject,
  source-video SHA-256, M7 versions and fingerprint), the declared manifest,
  the source digest and declared units/sign, every contract and parameter, the
  body mass and g, the anchors and mapping, force time support, overlap, the
  limits, and the software version and processing times.
* Aggregate statistics (sums, means, medians) are reproducible under the
  pinned numerical stack (numpy 2.5.3); a future numpy upgrade could change
  the last bits of such statistics, so the integrity check on read verifies
  digests and exact element-wise derivations, not re-computed aggregates.

## 22. Current limitations

* **No approved paired human data; no scientific result.** The whole
  pathway has only seen synthetic fixtures and M7's deterministic dot pose
  double. The real M7 provider has not completed a successful human squat.
* Anchor identification is manual and its timing uncertainty is not modelled
  (§8). No automatic synchronization exists by design.
* One plate, total vertical force, one movement; no dual-plate, horizontal or
  asymmetry analysis.
* No preprocessing protocol exists (by design); plate zeroing is the
  acquisition system's responsibility; the non-positive-force rule rejects
  unloading or sign errors but cannot detect a small zero offset.
* The standing check is descriptive; exclusion thresholds must come from the
  analysis plan.
* Pointwise metrics weight each prediction timestamp equally; unevenly sampled
  estimates are not time-weighted.
* No confidence intervals.
* Local command-line tooling only: no authentication, authorization or
  multi-user controls (same posture as M7 — never expose it).
* Database owners can bypass triggers and rewrite digests: integrity here is
  application/database-role integrity, not cryptographic tamper-proofing.
