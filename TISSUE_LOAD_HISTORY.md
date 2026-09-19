# Longitudinal Tissue Load — Milestone 4

Milestone 3 answered *what modeled training workload occurred in this selected
period?* Milestone 4 adds *how has modeled workload accumulated over time, and
how does recent modeled workload compare with this athlete's own recent
historical exposure?*

It is **longitudinal training-exposure tracking**. It is not recovery
modelling, tissue capacity, readiness, fatigue state, injury prediction or
medical interpretation, and it makes no training recommendation. Everything
below is a sum or a mean of the **unchanged** `tissue-load-v0.1` workload.

All examples are synthetic.

---

## 1. The raw model is frozen

`tissue-load-v0.1` and `exercise-tissue-map-v0.1` are **unchanged by this
milestone**: same tissues, same coefficients, same body-mass bands, same
units, same confidence semantics, same completed-set rule, same event
provenance. See the [domain contract](js/tissue/README.md).

Two tests enforce it. [test/tissueLoadInvariance.test.js](test/tissueLoadInvariance.test.js)
compares live engine output against the golden file captured before
Milestone 2, and [test/tissueModelFreeze.test.js](test/tissueModelFreeze.test.js)
pins the SHA-256 of all five domain files and the golden fixture, so a changed
coefficient fails even if the sampled outputs happened to survive.

Milestone 4 adds a **history layer around** the model. It does not create a
new model.

---

## 2. Why history has to be frozen

Milestone 3 recomputed every historical workout from `workoutLog` plus the
**current** profile weight. Two silent-drift problems followed:

- a workout finished in March changed its modeled workload the day the athlete
  logged a new weight in April;
- a future coefficient table would silently rewrite every past number.

Longitudinal exposure cannot be built on numbers that move. So each completed
workout is materialized **once** into a versioned snapshot that records the
inputs it was computed from:

```
completed workout
+ historically appropriate model inputs   (body mass + provenance)
+ model version + map version
        ↓
frozen tissue-history-v1 entry
        ↓
daily aggregation → 7-day / 28-day windows → baseline
```

The **source of truth remains `workoutLog`.** A snapshot is derived data: it is
rebuilt when its source changes and dropped when its source disappears.

---

## 3. What is stored

One profile-scoped key, `pq_<email>_tissueHistory`, holding one entry per
datable completed workout. Full persistence contract in
[STORAGE_CONTRACT.md](STORAGE_CONTRACT.md) §4; code in
[js/utils/tissueHistorySnapshot.js](js/utils/tissueHistorySnapshot.js) and
[js/utils/tissueHistoryStore.js](js/utils/tissueHistoryStore.js).

```json
{
  "schemaVersion": "tissue-history-v1",
  "sourceKey": "8002@1772634600000#0",
  "sourceId": 8002,
  "sourceFinishedAt": 1772634600000,
  "sourceFingerprint": "fp1:e8387be02fa13992:415",
  "localDate": "2026-03-04",
  "utcOffsetMinutes": -420,
  "modelVersion": "tissue-load-v0.1",
  "mapVersion": "exercise-tissue-map-v0.1",
  "workloadUnit": "lb*rep",
  "inputs": {
    "bodyMass": 178,
    "weightUnit": "lb",
    "bodyMassProvenance": {
      "source": "weight_log",
      "measurementDate": "2026-03-02",
      "daysBefore": 2,
      "contemporaneous": false,
      "approximate": false
    }
  },
  "tissues": { "quadriceps": { "workload": 1792.5, "eventCount": 1, "confidence": "medium" } },
  "coverage": { "completedSets": 1, "modeledSets": 1, "unmappedExercises": [] },
  "warnings": [],
  "materializedAt": 1772650800000
}
```

### Full snapshot vs. minimal snapshot

Two designs were considered.

| | Full engine result | **Minimal snapshot (chosen)** |
|---|---|---|
| Reproducibility of the displayed longitudinal numbers | complete | complete |
| Per-set event provenance frozen | yes | no — recomputed live from `workoutLog` |
| Size per demo session | 2.8–12.0 KB | 0.7–1.2 KB |
| Size, 624 synthetic workouts (3 years × 4/week × 18 sets) | ≈ 4–6 MB | **861 KB** |

The full result is dominated by one event object per (completed set × mapped
tissue), carrying provenance the windows never read. The minimal snapshot
keeps everything the longitudinal contract needs — per-tissue totals, coverage,
frozen inputs, versions and source identity — and a test asserts an entry stays
under 2 KB and under a third of the full result.

**Cost of the choice:** per-set contributor detail for a *past* session is not
frozen. The Milestone 3 selected-period detail still derives contributors live
from `workoutLog`, using the body mass frozen here, so today's and this week's
contributor lists remain exact. Reconstructing contributors for an older
session under a *retired* model version would require that model's
implementation. That is acceptable because the source workout is still on disk
and the only frozen claim is the aggregate.

Measured overhead is **1.43×** the source `workoutLog` for the same data. Both
grow without bound, as `workoutLog` already does. See §11.

---

## 4. Historical body mass

`tissue-load-v0.1` multiplies a body-mass band by the athlete's mass, so the
mass used is part of the result's meaning. Resolution is deterministic, and is
applied **once**, at materialization:

1. **`weight_log`** — the latest valid `profile.weightLog` measurement dated
   **on or before** the workout's frozen local day. A valid entry has a
   `"YYYY-MM-DD"` date and a finite positive number; anything else is ignored,
   never repaired.
2. **`profile_weight`** — the profile's current weight at materialization,
   recorded as exactly that. It is marked `contemporaneous` when the workout is
   being materialized on its own day (a workout just finished), and
   `approximate: true` otherwise, which is the legacy-backfill case.
3. **`model_default`** — nothing usable. No mass is passed, so the engine
   applies its own documented 180 lb reference and its own
   `default_body_mass` warning. Milestone 4 invents nothing.

**A measurement dated after the workout is never back-applied**, however
numerically close it is. Equal-date ties use the last valid record in log order.
Numeric strings, nonpositive/nonfinite weights and impossible dates are ignored.
Bare numeric weights are pounds; there is no metadata to infer accidental kg.

**Historical measurement corrections do not invalidate an existing snapshot.**
Weight-log and profile changes are excluded from the workout fingerprint on
purpose. Its inputs record what was used at materialization, not a continuously
updated estimate. Rebuilding after a model-relevant workout edit resolves the
context again. There is no dedicated historical-context correction workflow;
adding one requires an explicit audited recomputation design.

The engine's **confidence category is not touched** by input provenance. How
much the model's authors trust a coefficient and how good the historical
context was are different facts, so `bodyMassProvenance` travels separately.

```
weightLog: 2026-03-03 → 178 lb, 2026-03-08 → 160 lb;  current profile weight 160 lb

workout 2026-03-01   → 160 lb  profile_weight  approximate  (no earlier measurement)
workout 2026-03-05   → 178 lb  weight_log      2 days before
workout 2026-03-09   → 160 lb  weight_log      1 day before
```

---

## 5. Time semantics

Each entry freezes `localDate`, the local calendar day of `finishedAt` **at the
moment it was materialized**. Window arithmetic then runs on those
`"YYYY-MM-DD"` keys through `Date.UTC`, so it is timezone- and DST-free: a
7-day window is always exactly seven calendar keys, never 7 × 24 hours.

Consequences, chosen deliberately:

- a newly materialized workout keeps its frozen training day even if the athlete
  later travels to another timezone — history is stable rather than shifting
  under the viewer;
- DST days are whole days: a 23-hour or 25-hour local day is one key;
- only a finite, in-range `finishedAt` makes a record datable. `startedAt` is
  never a substitute, matching Milestone 3.

For legacy backfill, the historical timezone is unknown. `localDate` and
`utcOffsetMinutes` use the materializing device's timezone at the historical
instant, not evidence of where the athlete trained. A source edit that causes
rebuilding can also re-resolve this context. No original timezone is invented.

Milestone 3's **Today** and **This week** (Monday–Sunday) periods and the rest
of Physiq's calendar are untouched. The longitudinal windows are rolling
calendar windows and are labelled as such; they do not redefine Physiq's week.

---

## 6. Exact quantities

Let `D` be the viewer's current local calendar day, and `w(t, day)` the sum of
tissue `t`'s frozen workload over every entry on that day, in `lb*rep`.

| Quantity | Definition | Days |
|---|---|---|
| Today | `w(t, D)` | 1 |
| **7-day exposure** | `Σ w(t, d)` for `d ∈ [D-6 … D]` | 7, today included |
| **28-day exposure** | `Σ w(t, d)` for `d ∈ [D-27 … D]` | 28, today included |
| Baseline period | `[D-34 … D-7]` — the 28 days immediately before the 7-day window | 28 |
| **Recent baseline** | `(Σ w(t, d) over the baseline period) ÷ 4` | mean per 7-day block |
| Change vs baseline | `(recent7 − baseline) ÷ baseline × 100 %` | — |

Malformed entries with negative/nonfinite workloads or inconsistent, negative
or fractional set counts are excluded. Finite numeric overflow is shown as
unavailable, never an invented zero or infinite percentage; ordinary values
retain six-decimal rounding. Tiny positive baselines that round to zero use
the zero-baseline state.

All are **sums**, boundary-inclusive at both ends, in `lb*rep`. Sums are taken
in canonical sorted order at six decimal places, the same rule the engine and
the Milestone 3 adapter use, so a total never depends on entry order.

With `D = 2026-03-31`:

```
recent    2026-03-25 … 2026-03-31     (Mar 24 is outside; Apr 1 is outside)
long      2026-03-04 … 2026-03-31
baseline  2026-02-25 … 2026-03-24
```

**The baseline is dimensionally comparable with the 7-day sum.** Dividing the
28-day baseline period by its four non-overlapping 7-day blocks produces a mean
*per 7 days*, so `recent7 ÷ baseline` is meaningful. A 7-day sum is never
compared against a raw 28-day sum. The baseline period also does not overlap
the window it is compared with, so the current week cannot inflate its own
reference.

Worked example, hamstrings:

```
baseline period   400 + 400 + 400 + 400  =  1600 lb*rep
recent baseline   1600 ÷ 4               =   400 lb*rep per 7 days
last 7 days                                  480 lb*rep
change            (480 − 400) ÷ 400      =   +20 %   above recent modeled baseline
```

Percentage change is unbounded in both directions, may exceed 100 %, may be
negative, and is never clamped to 0–100. It is a descriptive statistic, not a
score and not a probability.

---

## 7. Elapsed logging history, sufficiency, sparse training

`firstObservedDate` is retained as an API field name, but means the earliest
valid frozen date **on or before today** in the selected series. It is not
telemetry proving app use or complete training observation.

Days without entries after the first log contribute zero **logged modeled
workload**. They may represent no training, unlogged training, or discontinued
app use. A Jan 1 workout followed by an Apr 1 return makes the intervening
windows eligible under this explicit logging assumption; it does not prove
three months of rest. Before the first log, no baseline is offered.

`observedDays` and `complete` are compatibility field names for the portion of
a window lying within this elapsed logging span. UI copy says “days since
first log” and explains that absent entries are zero logged workload. A
baseline requires the earliest log to be on or before D-34, so it first becomes
eligible on the 35th calendar day including the first log. Sparse training
remains valid. No adherence or training-frequency threshold is invented.

Future-dated entries are preserved but excluded from today's coverage and
exposure; the UI explains this, including when all history is future-dated.

---

## 8. Zero baseline

If the baseline period lies within the elapsed logging span but its modeled workload for that
tissue is exactly zero, the result is the `zero_baseline` state — never
`Infinity`, `NaN`, `+∞%` or an invented number. The UI says which of the three
reasons applies:

```
No completed workouts in the baseline period (Feb 25 – Mar 24), so no percentage is shown.
Completed sets in the baseline period (Feb 25 – Mar 24) were not covered by the model, …
No prior modeled workload for this tissue in the baseline period (Feb 25 – Mar 24), …
```

---

## 9. Coverage across compared periods

Milestone 3's distinction between **modeled zero** and **not modeled** is
preserved longitudinally. Every window carries its own coverage:

```
sessionCount · completedSets · modeledSets · unmappedSets
```

and the detail prints coverage for the recent window, the 28-day window and the
baseline period, so a comparison between a fully mapped week and a barely mapped
baseline is visible rather than implied:

```
Coverage: last 7 days 10 of 10 completed sets modeled; last 28 days 7 of 31
completed sets modeled; baseline period 8 of 40 completed sets modeled.
Unmapped sets are excluded from every total above, so the comparison covers
modeled exercises only.
```

The comparison is **still computed**, from modeled data only, with that coverage
stated. No threshold suppresses it, because any cut-off would be arbitrary.
Unmapped work is never rescaled, inferred or treated as biological zero, and
there is no "accuracy percentage".

---

## 10. Version compatibility

Five independent version concepts:

| Version | Where | Kind | Answers |
|---|---|---|---|
| `SCHEMA_VERSION` = `1` | [js/utils/storage.js](js/utils/storage.js) | integer | how Physiq's bytes are laid out |
| `tissue-history-v1` | [tissueHistorySnapshot.js](js/utils/tissueHistorySnapshot.js) | string | the shape of a stored history entry |
| `tissue-load-v0.1` | [js/tissue/modelVersion.js](js/tissue/modelVersion.js) | string | which formula produced a number |
| `exercise-tissue-map-v0.1` | same | string | which coefficient table |
| `load-baseline-v0.1` | [tissueLoadHistory.js](js/utils/tissueLoadHistory.js) | string | which window/baseline definitions |

They move independently. History gaining a schema does **not** bump the model
version; the storage schema stays `1` because this is a new optional key, not a
change to how existing bytes are laid out (the same rule Milestone 2 applied).

**Incomparable model outputs are never silently mixed.** Every entry carries its
model version, map version and unit. The analytics selects one series — this
build's engine by default — sums only entries from that series, and reports the
rest as `otherSeriesEntries`, surfaced in the UI as

> *1 history entry from a different model version is kept separately and not
> included.*

A synthetic `tissue-load-v0.2` entry is tested in both directions: it never
contributes to a v0.1 total, and v0.1 history never serves as a v0.2 baseline.
Entries from an unrecognised series are preserved untouched by reconciliation.
For a recognized v1 entry whose source key/fingerprint is gone or changed, the
original object moves into the envelope's optional `detachedEntries` array.
It is excluded from active analytics, exported for recovery, and reactivated
if the exact source returns. Unknown entry schemas remain opaque and ignored.
This preserves future data without treating deleted workouts as active history,
and permits a future model to coexist or deliberately recompute history. **No production v0.2 exists**; Milestone 4 does not
create one.

---

## 11. Performance

Measured on 624 synthetic workouts (3 years, 4 sessions/week, 18 completed sets
each) with a 156-entry weight log:

| | |
|---|---|
| Cold backfill of all 624 | 32 ms |
| Reconciliation, nothing changed | 6 ms |
| One new workout appended | 8 ms |
| Analytics (`buildTissueLoadHistory`) | 1.1 ms per call |
| Stored history | 861 KB (1.43× the source `workoutLog`) |

Reconciliation fingerprints each source record and re-runs the engine only for
records that are new or changed, which is the point of materializing. The
analytics never re-runs the model. The React layer memoizes both, so selecting a
tissue re-renders without recomputing. No worker, no IndexedDB and no backend
was needed or added.

---

## 12. Scientific limitations

Everything Milestone 1 listed still applies, unchanged: provisional unreviewed
coefficients, five coarse body-mass bands, 25 mapped exercise names, a formula
linear in reps and load that ignores intensity relative to maximum, proximity
to failure, tempo, range of motion and velocity, unilateral work scored as
bilateral, tendon entries that are relevance markers rather than tendon-load
models, and no measured biomechanics anywhere.

Milestone 4 adds three of its own:

- **Historical body mass is uncertain for legacy workouts.** Before Physiq
  recorded weights, or for any workout with no earlier measurement, the frozen
  mass is the profile weight at materialization. It is labelled `approximate`,
  surfaced to the user, and frozen so it cannot drift further.
- **The baseline is exposure history, not capacity.** It describes what this
  athlete logged, through a provisional model. It says nothing about what they
  can tolerate, how recovered they are, or whether any amount is advisable.
  A large percentage change is a description, not a warning.
- **Coverage bounds the comparison.** Periods with different mapping coverage
  are compared on modeled exercises only. Unmapped training is invisible to
  these numbers and is not zero biological load.

There is no injury prediction, no recovery inference, no readiness score, no
threshold, and no traffic-light colour anywhere in this feature.

---

## 13. Verifying

```sh
node --test test/tissueHistorySnapshot.test.js test/tissueHistoryStore.test.js test/tissueLoadHistory.test.js
node --test test/tissueModelFreeze.test.js test/tissueLoadInvariance.test.js
TZ=America/Phoenix node --test test/tissueLoadHistory.test.js
TZ=America/New_York node --test test/tissueLoadHistory.test.js
TZ=UTC node --test test/tissueLoadHistory.test.js
npm test
npm run build
```

Browser acceptance, isolated synthetic profiles only:

```sh
PLAYWRIGHT_MODULE=/absolute/path/to/playwright/index.mjs \
  node test/browser/tissueHistory.browser.mjs dist production
```

See [MILESTONE_4_VERIFICATION.md](MILESTONE_4_VERIFICATION.md) for this run's
baseline, results and remaining limitations.
