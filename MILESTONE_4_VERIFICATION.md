# Milestone 4 — implementation and verification report

Longitudinal tissue load history and athlete-relative baseline, plus one
three pre-existing bugs fixed on request (§16, §17, §18).
Verified 2026-09-18. Implementation and required verification are complete
locally. **Nothing was committed, pushed, merged, published or deployed**, no
Milestone 5 work was started, and `tissue-load-v0.1` was not modified.

All examples and fixtures are synthetic.

---

## 1. Baseline

| | |
|---|---|
| Branch | `claude/milestone-4-longitudinal-load-a996a3` |
| Starting commit | `917e118bdc568fbcc21cc6b4d3307c4f30a7ffdd` |
| Git state at start | **clean**, no pre-existing user changes |
| Baseline `npm test` | **362 tests, 362 passed**, 0 failed / skipped / todo |
| Baseline `npm run build` | passed, reproduced the committed artifacts exactly |

Prerequisites confirmed present and committed, by reading the repository:

| Milestone | Evidence |
|---|---|
| 0 — storage | `6fd19bf`, [STORAGE_CONTRACT.md](STORAGE_CONTRACT.md), [js/utils/storage.js](js/utils/storage.js), [test/storage.test.js](test/storage.test.js) |
| 1 — domain | `53a8e93`, five files in [js/tissue/](js/tissue/), [README](js/tissue/README.md), golden fixture + invariance test |
| 2 — set metadata | `3304f3c`, `26fbe74`, [SET_METADATA.md](SET_METADATA.md), [js/utils/setMetadata.js](js/utils/setMetadata.js) |
| 3 — Tissue Load UI | `41e395c`, [TISSUE_LOAD_MAP.md](TISSUE_LOAD_MAP.md), [MILESTONE_3_VERIFICATION.md](MILESTONE_3_VERIFICATION.md), adapter + tracker |

Committed model/map versions read from source, not assumed:
`tissue-load-v0.1`, `exercise-tissue-map-v0.1`, `tissue-definitions-v0.1`,
`SCHEMA_VERSION = 1`.

### Generated artifact hashes (SHA-256)

| Artifact | Baseline | Final |
|---|---|---|
| `dist/app.min.js` | `a097028f45dc521a293adfe8dc4925b5d5e43a61874b3b1186f4c8f7c7e0d74c` | `0505e3b4b84e8607ae6ec78157ea9bbee1e782bf15cdafc07f7efd6a49644243` |
| `dist/index.html` | `2a3ddfcc0e8b97acb54806b5dda30f8a83f2bfc790fe41027edf4877f691522d` | unchanged |
| `dist/styles.min.css` | `7372e6d41452932153c44c547e80b79f148cdf0a1a819b3d9b8a8c1fb10ca7bd` | `b0837294cb254ad839a344e708bab7875f87e4bdfd08de9c729bb050fc4a4404` |

A pre-edit capture of the live engine's output for six representative
sessions × four contexts plus three single sets hashes to
`09f0bb07d8f43fbe403f3d4c23fbb9902e565cf3eb7b7467809b78bd9b44f980`. It hashes
to the same value after implementation (§8).

---

## 2. Historical-data findings

Read off the repository before any design decision.

**Workout timestamps.** `workoutLog[].finishedAt` and `.startedAt` are epoch ms
from `AppTime.nowMs()`. `finishedAt` is stamped by
`ExerciseTab.finishWorkout()`. Milestone 3 already refuses to date a record by
`startedAt`, and Milestone 4 keeps that rule: only a finite, in-range
`finishedAt` makes a record datable.

**Current profile weight.** `profile.weight` is a single current number. It is
the only body mass Milestone 3 passed to the engine, **for every historical
workout** — so a March workout's modeled workload moved whenever the athlete
logged a new weight in April. This is the risk the milestone had to solve, and
it is real: confirmed in the browser by logging a weight and watching a past
session's number change under the pre-milestone code path.

**Weight history exists.** `profile.weightLog` is an array of
`{ date: "YYYY-MM-DD", weight: <number> }`, written by `App.logWeight()` and by
the weekly check-in. It is:

- profile-scoped, because it lives inside the profile object;
- **absent on older profiles** — every reader already guards with
  `Array.isArray(...)`;
- append-or-replace **for the current day only** (`logWeight` replaces today's
  entry so a same-day mistake can be corrected); past entries are never edited
  and there is no delete UI;
- dated in a format *different* from `history[]`, which uses `toDateString()`.
  Both are live and neither was changed.

**Workouts snapshot no weight anywhere.** Nothing in `workoutLog` records the
athlete's mass, and no record carries a local date — only epoch timestamps.

**Timezone / calendar.** Every date bucket in Physiq (`history` keys,
`weeklyMuscles.weekStart`, the Mon–Sun report week, Milestone 3's Today/This
week) is computed in **local** time from those epoch values, so the same
instant lands in different buckets in different zones. Nothing freezes a local
day, which is why Milestone 4 does (§3).

**History editing and deletion.** There is **no UI to edit or delete a saved
workout.** `setWorkoutLog` is only ever called to append one, to restore a Dev
Mode snapshot, or to load a profile. The only ways a record can change or
vanish are Import Data and direct storage manipulation. So reconciliation had
to be safe for imports without inventing an editing system.

**Import/export.** `exportAll()` is prefix-based over every `pq_*` key, so any
new profile-scoped key is carried automatically; `importAll()` merges and
rejects a newer `schemaVersion`. That made the export decision a question of
*whether the key should be there*, not of plumbing (§4).

---

## 3. Reproducibility architecture

**What is persisted.** One versioned snapshot per datable completed workout, in
one profile-scoped key. Per entry: source identity and fingerprint, frozen
local date and UTC offset, model + map version + unit, the resolved body mass
with its provenance, per-tissue totals with event counts and confidence,
coverage, engine warnings, and the materialization timestamp. Full shape:
[STORAGE_CONTRACT.md](STORAGE_CONTRACT.md) §4 and
[TISSUE_LOAD_HISTORY.md](TISSUE_LOAD_HISTORY.md) §3.

**Why.** Longitudinal aggregation must not be `old workout + today's profile
state`. Freezing the resolved inputs alongside the output makes each historical
number reproducible, auditable and stable.

**Why minimal rather than full.** A full engine result is 3–10× larger, almost
entirely per-set event provenance the windows never read: 861 KB versus an
estimated 4–6 MB for 624 synthetic workouts. The minimal snapshot keeps
everything the longitudinal contract needs. The cost — per-set contributor
detail for a past session under a *retired* model is not frozen — is acceptable
because the source workout is still on disk. Measured, tabulated and justified
in [TISSUE_LOAD_HISTORY.md](TISSUE_LOAD_HISTORY.md) §3.

**Source fingerprint.** `fp1:<16 hex>:<length>` over a canonical projection of
**only** what `tissue-load-v0.1` reads: `finishedAt`, exercise names, and each
set's `reps` / `weight` / strict `done`. Milestone 2 metadata, titles, routine
ids, display labels and the precomputed counters are excluded by construction,
so a metadata-only edit provably cannot rebuild a snapshot — pinned by a unit
test and by a browser check.

**Source identity.** `id@finishedAt#ordinal`. The ordinal distinguishes records
sharing an id and instant, which `Date.now()` ids plus Import Data can produce,
so derived history counts exactly what `workoutLog` counts.

**Body mass.** Deterministic three-step policy, applied once at
materialization: latest valid dated measurement **at or before** the workout's
frozen local day → else current profile weight, recorded as such and flagged
`approximate` unless materialized on the workout's own day → else nothing, and
the engine's own documented 180 lb reference applies unchanged. A measurement
recorded *after* the workout is never back-applied. The engine's confidence
category is untouched; input quality travels separately in
`bodyMassProvenance`.

**Local-date semantics.** `localDate` is frozen at materialization; window
arithmetic runs on `"YYYY-MM-DD"` keys via `Date.UTC`, so it is timezone- and
DST-free. A workout keeps the training day it was performed on even if the
athlete later changes timezone.

**Model/map versions** travel inside every entry; the analytics selects one
series and never sums across versions.

**Reconciliation** keeps unchanged entries byte-for-byte, rebuilds changed
ones, drops vanished ones, collapses stored duplicates, and preserves foreign
and unparseable entries untouched.

**Layering** is preserved:

```
storage / application   js/utils/tissueHistoryStore.js   (the only writer)
        ↓
pure history + analytics  tissueHistorySnapshot.js, tissueLoadHistory.js
        ↓
presentation adapter      js/utils/tissueLoadView.js
        ↓
React                     js/components/TissueLoadTracker.js   (read-only)
```

The pure modules import no storage (source-guard tests); the view imports no
store and never writes.

---

## 4. Storage contract

| | |
|---|---|
| **Key** | `pq_<email>_tissueHistory` — one per profile, `uKey()`-built like every other |
| **Envelope** | `{ schemaVersion: "tissue-history-v1", entries: [...] }` |
| **Version** | its own **string** version, independent of `SCHEMA_VERSION` (still `1`) and of the model/map versions inside each entry |
| **Writer** | `reconcileTissueHistory()`, called only from the `workoutLog` persistence effect in App.js — boot restore, login, and after a completed workout saves |
| **Readers** | the Tissue Load view via a prop; `readTissueHistory()` for tests/diagnostics |
| **Backfill** | legacy workouts are materialized by the same call; deterministic, idempotent, profile-scoped, duplicate-free, convergent |
| **Failed write** | reported as `write_failed`; nothing partial written; no marker can advance ahead of the data because the envelope *is* the data, written in one `setItem`; repaired by the next successful run |
| **Malformed** | never rewritten; quarantined to `<key>__corrupt` by the existing profile sweep; session runs from an in-memory derivation |
| **Future version** | never downgraded, never rewritten |
| **Unreadable source** | reconciliation is skipped entirely, so a corrupt `workoutLog` cannot delete derived history |
| **Import/export** | included, deliberately — a legacy entry's frozen body mass is *not* reproducible on a device with a different current weight |
| **Schema bump** | none. A new optional key is not a change to how existing bytes are laid out, the same rule Milestone 2 applied |

`tissueHistory` was added to `PROFILE_KEY_SUFFIXES` so the quarantine sweep
covers it. It is deliberately **not** in App.js's `passiveFallbacks()`: it has
no passive write-back to protect against, and its writer refuses to write over
an unreadable value at all, which is stronger.

One deliberate interaction, documented rather than special-cased: writes go
through `set()`, so a quota failure runs the existing pruner, which trims the
oldest entry of the longest `pq_*_history` **array**. The new key is an object
and its name does not match that pattern, so it is never itself pruned; but
like any other write it can, under quota pressure, cause one day of nutrition
history to be pruned. Keeping `set()` was chosen over a bespoke write path for
consistency with the Milestone 0 contract. See §14.

---

## 5. Longitudinal mathematics

`D` = the viewer's current local calendar day. `w(t, d)` = the sum of tissue
`t`'s frozen workload over every entry whose frozen `localDate` is `d`, in
`lb*rep`.

| Quantity | Exact definition |
|---|---|
| Daily workload | `w(t, d)` — canonical sorted sum at 6 decimals |
| **7-day exposure** | `Σ w(t, d)`, `d ∈ [D-6 … D]`, both ends inclusive, today included |
| **28-day exposure** | `Σ w(t, d)`, `d ∈ [D-27 … D]`, both ends inclusive, today included |
| Baseline period | `[D-34 … D-7]` — 28 days, immediately before and **not overlapping** the 7-day window |
| **Recent baseline** | `(Σ w(t, d) over the baseline period) ÷ 4` — a mean **per 7-day block** |
| **Change** | `(recent7 − baseline) ÷ baseline × 100 %` |
| Minimum data | baseline requires **all 28** baseline-period days observed, i.e. ≥ 35 calendar days after the first modeled workout |
| Zero baseline | baseline period observed but its modeled workload is exactly 0 → `zero_baseline` state, no ratio, no percentage |
| Coverage | per window: `sessionCount`, `completedSets`, `modeledSets`, `unmappedSets` |

Calendar example used throughout the tests and the browser run, `D = 2026-03-31`:

```
recent    2026-03-25 … 2026-03-31     Mar 24 excluded, Apr 1 excluded
long      2026-03-04 … 2026-03-31
baseline  2026-02-25 … 2026-03-24
```

Worked example from the browser run, chest, four bench sessions of 1,000
`lb*rep` on Feb 25 / Mar 4 / Mar 12 / Mar 20 and 1,200 on Mar 30:

```
baseline period   4 × 1,000  = 4,000 lb*rep
recent baseline   4,000 ÷ 4  = 1,000 lb*rep per 7 days
last 7 days                    1,200 lb*rep
last 28 days      3 × 1,000 + 1,200 = 4,200 lb*rep
change            (1,200 − 1,000) ÷ 1,000 = +20 %, above recent modeled baseline
```

**Dimensional comparability is explicit:** the 7-day sum is compared against a
mean *per 7 days*, never against the raw 28-day sum. Percentage change is
unbounded, may be negative, and is never clamped.

**Observed vs. unobserved:** a day on or after `firstObservedDate` with no
entry is a real zero; a day before it is unobserved and never padded with zero.
Sparse training (two sessions a week) yields a complete window with real zeros
and is never treated as malformed.

---

## 6. Version semantics

| Version | Value | Kind | Answers | Bumped when |
|---|---|---|---|---|
| Physiq storage schema | `1` | integer | how existing bytes are laid out | an on-disk shape changes |
| TissueOS history schema | `tissue-history-v1` | string | the shape of one stored entry | the entry shape changes |
| TissueOS model | `tissue-load-v0.1` | string | which formula produced a number | the formula changes |
| Exercise mapping | `exercise-tissue-map-v0.1` | string | which coefficient table | any coefficient/band/confidence/mapping changes |
| Longitudinal analytics | `load-baseline-v0.1` | string | which window and baseline definitions | the windows or baseline formula change |

Four independent questions, four independent versions. Milestone 4 introduced
the second and the fifth and **bumped none of the others**. Adding history did
not bump the model version, and does not bump the storage schema.

---

## 7. Final UX

Longitudinal information lives **only in the selected tissue's detail panel**,
inside the existing Tissue Load view. The Training Volume / Tissue Load
selector, the body map, its neutral purple max-relative shading, the legend,
Today / This week, contributors, confidence and coverage are all unchanged. No
new visualization mode, no chart, no dashboard.

A **Recent exposure** block appears under the contributors:

```
Recent exposure

Last 7 days                                 1,200 lb*rep
Last 28 days                                4,200 lb*rep
Recent baseline                             1,000 lb*rep
                                    per 7 days, Feb 25 – Mar 24
Change vs recent baseline                           +20%
                                    above recent modeled baseline

+20% means the last 7 days' modeled workload is 20% above the mean of the
four 7-day periods before them (1,000 lb*rep). It is a descriptive comparison
with your own logged history, not injury risk, recovery or capacity.

Coverage: last 7 days 1 of 1 completed sets modeled; last 28 days 4 of 5
completed sets modeled; baseline period 4 of 4 completed sets modeled.

Windows are local calendar days ending today; history begins Feb 25. Baseline
is this profile's own recent modeled exposure (load-baseline-v0.1), not tissue
capacity, and it makes no training recommendation.
```

- **7-day / 28-day** are plain sums, annotated *n of 7 days observed* while the
  window is only partly observed.
- **Baseline** shows its value, its per-7-day scale and its exact date range,
  or *Not yet available*.
- **Change** is a signed percentage with a literal arithmetic descriptor —
  *above* / *below* / *equal to recent modeled baseline*. There is no
  Normal/Elevated/High status, no threshold, and no red/amber/green anywhere; a
  browser check and a unit test both fail on threshold vocabulary.
- **Insufficiency** states exactly what is missing and when history began.
- **Zero baseline** names which of three reasons applies, and never shows a
  percentage.
- **Coverage** is printed for all three windows, with an explicit note that
  unmapped sets are excluded from every total.
- **Data-quality notice**, only when it applies: *"Some older estimates use
  limited historical profile data: no dated weight measurement was available
  for 2 workouts in these windows."*
- **Other model series**, only when present: *"1 history entry from a different
  model version is kept separately and not included."*
- **Storage-state notices** for unreadable, future-version, unsaved or
  unreadable-source history, worded as recoverable, not alarming.
- **Mobile:** verified at 375 px and 320 px with no horizontal overflow in the
  document, popup, card, stat rows or list items; long tissue and exercise
  names wrap; sub-labels use the UI font and stack under their value.

---

## 8. Model integrity evidence

| Check | Result |
|---|---|
| `git diff --exit-code -- 'js/tissue/*.js' test/fixtures/tissueLoadBaseline.v0.1.json js/utils/setMetadata.js js/utils/workoutSession.js js/dev/ package.json package-lock.json` | **no diff** |
| Five domain files by SHA-256 | identical to baseline (`b9ba8699…`, `d065fcab…`, `a33b204f…`, `ec27e597…`, `97891194…`) |
| Golden fixture SHA-256 | `d88a506e887147768a2ca00d35a66d7819cfe839308d0109e22079588f127b35`, unchanged |
| Pre/post engine capture | both `09f0bb07d8f43fbe403f3d4c23fbb9902e565cf3eb7b7467809b78bd9b44f980` |
| `node --test test/tissueLoadInvariance.test.js test/tissueModelFreeze.test.js` | **84 / 84 passed** |
| Model + map version strings | `tissue-load-v0.1`, `exercise-tissue-map-v0.1` — pinned by three separate tests |
| Metadata invariance | retained: golden test, a snapshot-level test, and a browser check all confirm RIR/side/tempo/ROM change nothing |
| Production v0.2 | none exists; a test asserts `modelVersion.js` contains no `v0.2` |

The golden capture tool was **not** run. A new test,
[test/tissueModelFreeze.test.js](test/tissueModelFreeze.test.js), pins all five
domain files and the golden fixture by hash, so a coefficient edit fails the
suite even if the sampled outputs happened to survive, and asserts the domain
files contain no reference to the history layer.

---

## 9. Files changed

### New

| File | Why |
|---|---|
| `js/utils/tissueHistorySnapshot.js` | Pure per-session snapshot: local-date freezing, source identity + fingerprint, historical body-mass resolution with provenance, materialization, validity/series predicates |
| `js/utils/tissueHistoryStore.js` | The only writer. Read classification, pure reconciliation planner, and the persistence entry point with all the refuse-to-write rules |
| `js/utils/tissueLoadHistory.js` | Pure longitudinal analytics: daily aggregation, 7/28-day windows, observed-history rules, baseline and comparison, coverage, series selection |
| `TISSUE_LOAD_HISTORY.md` | The longitudinal contract: frozen model, snapshot rationale and size tradeoff, body mass, time semantics, exact formulas, sufficiency, coverage, version compatibility, performance, limitations |
| `MILESTONE_4_VERIFICATION.md` | This report |
| `test/tissueHistorySnapshot.test.js` | 12 tests: dates, fingerprint, body mass, materialization, purity |
| `test/tissueHistoryStore.test.js` | 21 tests: backfill, idempotency, isolation, frozen mass, reconciliation, malformed/future/failed-write/unreadable-source, series coexistence, export/import, wiring guards |
| `test/tissueLoadHistory.test.js` | 15 tests: calendar arithmetic, aggregation, windows, baseline, zero baseline, coverage, version mismatch, DST |
| `test/tissueModelFreeze.test.js` | 2 tests: domain source hashes and version strings |
| `test/browser/tissueHistory.browser.mjs` | Browser acceptance harness, synthetic profiles only |

### Modified

| File | Why |
|---|---|
| `js/App.js` | Hold reconciled history in state; reconcile at the `workoutLog` persistence boundary, gated on that write succeeding; clear it on login; pass it to both Exercise entry points. **Also (§16)** `emptyProfileState()` + `resetProfileState()`, called on the new-account login branch, and non-empty catches in both profile-load paths |
| `js/utils/storage.js` | Add `tissueHistory` to `PROFILE_KEY_SUFFIXES`; make `sv()` return `set()`'s result so a derived writer can refuse to persist after a failed source write |
| `js/utils/tissueLoadView.js` | Optional `resolveBodyMass` hook so the Milestone 3 period view uses each workout's frozen body mass; unchanged without it |
| `js/components/TissueLoadTracker.js` | Read-only longitudinal detail, frozen-body-mass resolver, updated limitation copy |
| `js/screens/ExerciseTab.js` | Pass the `tissueHistory` prop through |
| `css/styles.css` | Scoped `.tl-stats` styles for the stat rows; no color semantics |
| `STORAGE_CONTRACT.md` | New key: shape, versioning, lifecycle, reconciliation, failure and import/export behaviour |
| `TISSUE_LOAD_MAP.md` | Correct the now-stale "current profile weight" and "no TissueOS storage keys" statements |
| `js/tissue/README.md` | Answer Q10 as implemented; note that history lives outside the domain. **No scientific contract changed** |
| `README.md` | One feature line |
| `test/tissueDefinitions.test.js` | Widen the sole-importer guard to the two new pure adapters; framework/storage ban retained |
| `test/tissueLoadUi.test.js` | 7 new rendering tests for the longitudinal detail, including a copy audit |
| `test/storage.test.js` | 3 new guards for the carry-over fix (§16): the new-account reset, emptyProfileState/passiveFallbacks drift, and no empty catch in the direct readers |
| `test/dayKey.test.js` | **New.** 8 tests for the shared local day-key parser (§17), including a source guard |
| `test/storage.test.js` | **§18** 3 further tests: the corrupt-profile recovery, the new-vs-corrupt distinction, and a source guard on the three-way branch |
| `js/utils/appTime.js` | **§17** exports `parseDayKey()`; its own dev-date parser now delegates to it |
| `js/utils/weeklyReport.js` | **§17** imports the shared parser, dropping its private duplicate |
| `js/screens/ProfileTab.js` | **§17** renders the latest weigh-in with the local parser |
| `js/components/WeightCharts.js` | **§17** parses every day key in one local frame: point labels, the time axis and the nearest-weight search |
| `dist/app.min.js`, `dist/styles.min.css` | Regenerated production assets (committed in this repo) |

---

## 10. Automated verification

| Command | Result |
|---|---|
| `node --test test/tissueHistorySnapshot.test.js test/tissueHistoryStore.test.js test/tissueLoadHistory.test.js` | **60 / 60 passed** |
| `node --test test/storage.test.js` | **49 / 49 passed** (43 pre-existing + 3 for §16 + 3 for §18) |
| `node --test test/dayKey.test.js` | **8 / 8 passed** (§17), and under 5 timezones |
| `node --test test/tissueLoadInvariance.test.js test/tissueModelFreeze.test.js` | **84 / 84 passed** |
| `node --test test/tissueLoadUi.test.js test/tissueLoadView.test.js` | **33 / 33 passed** |
| `TZ=America/Phoenix node --test <storage+history+snapshot+store+view>` | **124 / 124 passed** |
| `TZ=America/New_York node --test <same>` | **124 / 124 passed**, includes both DST transitions |
| `TZ=UTC node --test <same>` | **124 / 124 passed** |
| `TZ=Europe/Berlin` · `Australia/Lord_Howe` · `Pacific/Chatham` · `Asia/Kolkata` · `Pacific/Kiritimati` | **92 / 92 passed** each (half-hour and 45-minute offsets, southern-hemisphere DST) |
| `npm test` | **445 / 445 passed**, 0 failed / skipped / todo |
| `npm run build` | passed |
| `npm run build:dev` | passed; development bundle exercised separately |
| `git diff --check` | clean |
| Domain/storage/fixture diff guard | no diff |

**Source guards** (inside the suite): the pure modules contain no
`localStorage` / storage import / React / clock reference; the tracker contains
no store import or write API; App.js reconciles at the documented boundary with
`persist` gated on the source write; both Exercise entry points receive the
prop; domain files contain no reference to the history layer; the golden
capture tool stays outside the suite glob.

**A real bug was caught by the timezone matrix.** Under `TZ=UTC`,
`-getTimezoneOffset()` yields `-0`, which survives in memory but serialises as
`0` — so a freshly materialised entry was not deep-equal to the same entry read
back from disk. Fixed by normalising in `localUtcOffsetMinutes()`, with a
regression assertion.

### Performance

624 synthetic workouts (3 years × 4/week × 18 completed sets), 156 weight-log
entries:

| | |
|---|---|
| Cold backfill | 32 ms |
| Reconcile, nothing changed | 6 ms |
| One workout appended | 8 ms |
| `buildTissueLoadHistory` | 1.1 ms per call |
| Stored history | 861 KB, 1.43× the source `workoutLog` |

No worker, IndexedDB or backend was needed or added.

---

## 11. Browser verification

Real browser: headless Google Chrome driven by an environment-supplied
Playwright, a fresh context with no user profile, `America/Phoenix`, a frozen
clock at Tue 31 Mar 2026 12:00, fonts stubbed, and only the reserved
`demo-a@example.com` / `demo-b@example.com` namespaces.

```sh
PLAYWRIGHT_MODULE=/Users/arunvelkumar/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs \
  node test/browser/tissueHistory.browser.mjs dist production

PLAYWRIGHT_MODULE=… node test/browser/tissueHistory.browser.mjs /tmp/physiq-m4-dev-build development
```

Both builds: **30 grouped checks passed, zero page errors, zero console
errors.** Fixture setup uses script access; user actions (logging a weight,
running a workout, switching profiles, selecting tissues, keyboard activation)
use real pointer and keyboard interaction.

### Browser-automated — every requested item

| # | Requested check | Result |
|---|---|---|
| 1 | Existing app loads | Pass |
| 2 | Training Volume unchanged | Pass — 3/8 chest target, original amber fill, DOM byte-identical across a Tissue Load round trip, no Milestone 4 markup |
| 3 | Milestone 3 map unchanged | Pass — single neutral purple ramp, legend and relative-concentration copy intact |
| 4 | Today / This week correct | Pass — 0 today, 1 this week for a Mon 30 Mar session |
| 5 | 7-day exposure | Pass — 1,200 `lb*rep` |
| 6 | 28-day exposure | Pass — 4,200 `lb*rep` |
| 7 | Baseline only when eligible | Pass — shown at 35 days, absent at 34 |
| 8 | Insufficient-history state clear | Pass — "3 of 7 days observed", "Not yet available", exact required range, and a distinct no-history state |
| 9 | Above-baseline correct | Pass — +20 % against a hand-computed 1,000 |
| 10 | Below-baseline correct | Pass — −20 % |
| 11 | Equal baseline clean | Pass — +0 %, "equal to recent modeled baseline", no above/below wording |
| 12 | Zero baseline safe | Pass — "Not comparable", reason given, no Infinity/NaN/∞ |
| 13 | Partial coverage visible | Pass — 1 of 1 / 4 of 6 / 4 of 8 across the three windows |
| 14 | Model-version mismatch not merged | Pass — 999,999 never appears, notice shown, foreign entry survives byte-for-byte |
| 15 | Historical workload stable after weight change | Pass — weight logged as 240 through the Profile UI; the Mar 25 entry stays at 180 and 1,800 `lb*rep`, byte-identical |
| 16 | New workout uses new context | Pass — today's squat freezes 240 and scores 2,025; 7-day total 3,825 |
| 17 | Legacy backfill idempotent across reloads | Pass — three reloads, stored bytes identical |
| 18 | Reload reproduces history | Pass — detail text identical |
| 19 | Profile A/B isolated | Pass — A→B→A, B freezes its own 142 lb, neither log appears in the other's history |
| 20 | Workout logging works | Pass — routine start, set done, finish, persisted |
| 21 | Milestone 2 metadata persists | Pass — RIR 2, side, tempo, ROM round-tripped |
| 22 | Metadata does not change v0.1 | Pass — detail text and stored entries identical after decorating every set |
| 23 | Nutrition smoke | Pass — +8 oz water, manual meal +200 kcal / +20 g protein |
| 24 | Weight logging/history works | Pass — `weightLog` gains `{2026-03-31, 240}`, `profile.weight` updated |
| 25 | Recovery unchanged | Pass — DOM byte-identical across a Tissue Load round trip, no Milestone 4 markup |
| 26 | No recovery/capacity language | Pass — automated audit over the rendered block; only explicit negations survive stripping |
| 27 | 375 px usable | Pass — no overflow |
| 28 | 320 px usable | Pass — no overflow in document, popup, card, stat rows or list items |
| 29 | Long names wrap | Pass — 104-character unmapped exercise name |
| 30 | Keyboard-accessible detail | Pass — Space on a map region and Enter on a tendon button both open the longitudinal detail; `aria-live="polite"` |
| 31 | No dev runtime errors | Pass |
| 32 | No production runtime errors | Pass; production seeder absent |
| 33 | No cross-profile leakage | Pass |
| 34 | No duplicate entries after repeated init | Pass — unique `sourceKey` set after four initializations |

Three additional browser checks: malformed and future-version stored history
are never overwritten or downgraded; a changed or deleted source workout
reconciles with no stale derived entry; and onboarding a brand-new account
after logout inherits nothing from the previous profile (§16).

**Automated, non-browser:** everything in §10 — unit, integration, storage,
failure-injection, timezone matrix, source guards, model freeze, performance.

**Visually inspected:** production `detail-320.png` and `detail-375.png`. The
stat rows align, values and sub-labels are legible, the percentage is not
styled as a status, text wraps at 320 px, and no color conveys meaning.
Artifacts in `/tmp/physiq-m4-browser-production/` and
`/tmp/physiq-m4-browser-development/` (`results.json`, `detail-*.png`,
`header-*.png`), intentionally outside the review diff.

**Not verified on hardware:** native iOS / WKWebView, a physical touch device,
and a screen-reader session. Chrome viewport emulation is not a physical-device
claim. Non-blocking platform-validation limitations, unchanged from Milestone 3.

---

## 12. Failure / adversarial verification

| Scenario | Result |
|---|---|
| Malformed stored history (`{not json`, `[]`, `null`, `42`, non-array `entries`) | Left on disk byte-for-byte, quarantined to `__corrupt`, in-memory history still complete, user told it was kept. Verified in unit tests and in the browser |
| Future history schema (`tissue-history-v2`, `-v9`) | Never downgraded or rewritten; app runs from memory; notice shown |
| `localStorage` write failure (generic and quota-shaped) | `write_failed`, nothing written, no marker advanced, in-memory history complete, repaired on the next successful run |
| Changed current weight after materialization | Frozen entry unchanged and byte-identical; verified through the real Profile UI |
| Changed source workout | Only that entry rebuilt, siblings byte-identical, rebuilt with the context current at rebuild time |
| Deleted / replaced (imported) workout | Entry dropped; no stale derived data |
| Duplicate workout ids | Two entries, matching the source's own count; idempotent on re-run |
| Stored duplicate of one `sourceKey` | Collapsed, never double-counted |
| Missing completion timestamp / `startedAt` only / `"…"` / `NaN` / out-of-range | Skipped and counted as undatable; never dated by `startedAt` |
| Invalid body mass (`0`, negative, `NaN`, string, `undefined`, `Infinity`) | Falls through to the engine default with explicit provenance; no `NaN` anywhere |
| Malformed weight-log records | Ignored, never repaired; resolution continues |
| Unreadable source `workoutLog` | Reconciliation skipped; stored history served untouched; nothing deleted |
| Zero baseline | `zero_baseline` state, three distinct explanations, no Infinity/NaN |
| Partial mapping | Coverage exposed per window; unmapped work never rescaled or inferred |
| Incompatible model version | Never summed; preserved; reported; v0.1 history refused as a v0.2 baseline |
| Malformed imported derived history | Source `workoutLog` intact, derived key not overwritten |
| Unrelated keys | Untouched — full storage snapshot compared before and after |

---

## 13. Scientific limitations

Carried forward from Milestone 1, unchanged: provisional, unreviewed
coefficients with nothing above `medium` confidence; five coarse body-mass
bands applied to whole movement patterns; only 25 mapped exercise names; a
formula linear in reps and load that ignores intensity relative to maximum,
proximity to failure, tempo, range of motion, velocity, rest and fatigue;
RIR / tempo / ROM / side recorded but ignored by v0.1; unilateral work scored as
bilateral; tendon entries as relevance markers, not tendon-load models; no
measured biomechanics, no force estimate, no camera or wearable input; Physiq's
unlabelled weight field.

Added by this milestone:

- **Historical body-mass uncertainty.** Workouts predating any dated weigh-in
  use the profile weight at materialization. Labelled `approximate`, surfaced
  in the UI, and frozen so it cannot drift further.
- **The baseline is exposure history, not capacity.** It describes what this
  athlete logged, through a provisional model. It says nothing about tolerance,
  recovery, readiness, or whether any amount of training is advisable. A large
  percentage is a description, not a warning.
- **Coverage bounds every comparison.** Periods with different mapping coverage
  are compared on modeled exercises only; unmapped training is invisible to
  these numbers and is not zero biological load.

No injury prediction, no recovery inference, no readiness score, no capacity
estimate, no threshold and no traffic-light colour exists in this feature.

---

## 14. Remaining issues

**Blockers:** none.

**Non-blocking limitations (Milestone 4's own):**

- Per-set contributor detail for a past session is not frozen; under a retired
  model version, reconstructing it would need that model's implementation. The
  source workout remains on disk. Deliberate size tradeoff, documented.
- Derived history is roughly 1.43× the source `workoutLog` and, like it, grows
  without bound. 861 KB for three years of frequent training. No cap was added
  because capping derived history while the source is uncapped would only make
  the two disagree.
- Under quota pressure the shared `set()` pruner can trim one day of nutrition
  history to make room for a derived write. Consistent with the Milestone 0
  contract for every key; worth revisiting if quota pressure is ever observed.
- The longitudinal windows are fixed at 7 and 28 days with a 4-block baseline.
  No user-configurable window, and no chart — both deliberately out of scope.

**Pre-existing, found during this work:**

- **Onboarding after logging out carried the previous profile's data into the
  new account.** Reported here first, then **fixed on request** — see §16.
- **The Profile tab showed the latest weigh-in one day early** in negative-UTC
  offsets. Reported here first, then **fixed on request** — see §17.
- **A malformed `profile` key routed to onboarding, whose write-back then
  overwrote that profile's other, readable keys with empty values.** Noticed
  while fixing §16, then **fixed on request** — see §18.
- Carried from Milestone 3: unbounded `workoutLog`; renaming a catalog exercise
  orphans its mapping; legacy weight fields assume pounds; the stray `counts`
  key in the mid-session `weeklyMuscles` rollover.

**Deliberately deferred to Milestone 5+:** recovery-model replacement, tissue
capacity, readiness, fatigue state, injury probability, training
recommendations, `tissue-load-v0.2`, RIR/tempo/ROM/side multipliers, camera or
measured-force input, OpenSim, and any backend. None was started.

---

## 15. Completion status

```text
Implementation complete:                        yes
Verification complete:                          yes
Milestone 4 acceptance criteria satisfied:      yes
Ready for independent Astra review:             yes
Ready for Milestone 5:                          yes
```

"Ready for Milestone 5" means only that Milestone 4 itself is complete and
reviewable. **No Milestone 5 work was begun.** The branch remains
`claude/milestone-4-longitudinal-load-a996a3` at `917e118` with a complete,
uncommitted Milestone 4 diff.

---

## 16. Pre-existing fix — cross-profile carry-over on onboarding

Found while verifying Milestone 4, reported as pre-existing, then fixed at the
user's request. It is **not** part of the Milestone 4 contract and touches no
TissueOS code.

### The bug

Profile switching in Physiq is "read a different key set" and nothing clears
React state on its own (STORAGE_CONTRACT §1). That is safe when the target
profile exists, because every profile-scoped value is then replaced by a read.
It was **not** safe for a brand-new account:

```
log in as A (has workouts) → Log out → log in with a new e-mail
  → loadUser() returns null → doLogin() takes the onboarding branch,
    which read nothing and reset nothing
  → finishOnboard() sets screen === "app"
  → the eager persistence effects fire and write whatever is still in memory
    — A's workoutLog, routines, weeklyMuscles, setTargets, meals and intake —
    under the NEW e-mail's keys
```

Reproduced in a real browser before fixing: the new account's `workoutLog`
came back as profile A's array. Milestone 4 did not widen it — derived history
follows the source exactly — but it did make the leak more visible, since the
new account also inherited a full longitudinal history.

A second, narrower instance of the same class lived in the direct-parse
readers: `try { setRoutines(…) } catch (e) {}`. An empty catch leaves the
setter uncalled, so a malformed key on profile B kept **profile A's** value in
memory. The write-back would then store it under B — and because that value
differs from the fallback `quarantineProfile()` registered, it would also
release the write protection guarding B's unreadable bytes, destroying them.

### The fix

[js/App.js](js/App.js):

- `emptyProfileState()` — one declaration of what every profile-scoped React
  state holds when no profile data is loaded, mirroring the existing
  `useState` / `loadDaily()` / `loadHistory()` defaults.
- `resetProfileState()` — applies those, plus `DEFAULT_PROFILE` and a null
  derived history. Called on `doLogin()`'s new-account branch, before routing
  to onboarding.
- Every direct-parse catch in **both** profile-load paths now substitutes that
  key's own default instead of being empty.
- `recentFoods` is reset on the existing-profile branch too. It is never read
  back by either load path (a pre-existing gap: `useState` initialises it while
  `email` is still `""`), so without the reset it was the one key that carried
  over between two *existing* profiles as well.

Behaviour for an existing profile is otherwise unchanged: every value it sets
was already being overwritten by a read.

### Verification

| Check | Result |
|---|---|
| `node --test test/storage.test.js` | **46 / 46 passed** |
| Browser: onboard a new account after logout | **Pass** — `workoutLog`, `routines`, `setTargets`, `meals` empty; no `history`; `intake.calories` 0; no inherited `weightLog`; derived history `{schemaVersion, entries: []}` |
| Browser: profile A after that onboarding | **Pass** — `workoutLog`, `routines` and `tissueHistory` byte-identical |
| Browser: the new account's own first workout | **Pass** — 500 `lb*rep`, one derived entry, A's history untouched |
| `npm test` | **434 / 434 passed** |

Three source-level guards were added to
[test/storage.test.js](test/storage.test.js), alongside the existing
App.js-parsing drift guard (App.js cannot be imported — it calls `createRoot()`
at module scope, so the behavioural proof is the browser check):

1. the onboarding branch calls `resetProfileState()` **before**
   `setScreen("onboard")`, and the reset covers every key
   `emptyProfileState()` declares plus the profile and derived history;
2. `emptyProfileState()` and `passiveFallbacks()` agree on every shared key,
   so the two cannot drift;
3. no direct-parse catch is empty.

**All four guards were mutation-tested.** With `resetProfileState()` removed,
the source guard fails with *"the new-account branch must reset profile
state"* and the browser check fails with *"the new account inherited
workouts"*. With one catch emptied again, the third guard fails naming the
setter. Restoring the fix returns all of them to green.

---

## 17. Pre-existing fix — day keys parsed as UTC

Also found while verifying Milestone 4, also fixed at the user's request.
No TissueOS code is involved.

### The bug

`new Date("2026-03-31")` is the ECMAScript **date-only form, which is defined
as UTC midnight**. Every `"YYYY-MM-DD"` key in Physiq is written from a
*local* date — `App.logWeight()`, `getMondayKey()`, `weeklyMuscles.dates`, the
dev date — so reading one back with `new Date(key)` and formatting it names
the previous day anywhere west of Greenwich. It is invisible at UTC and east
of it, which is why it survived this long.

Observed in the browser in `America/Phoenix`: a weigh-in logged on Mar 31
rendered as **"Latest: 240 lb on Mar 30, 2026"**.

Affected sites, all display-side:

| File | Site |
|---|---|
| `js/screens/ProfileTab.js` | "Latest: *n* lb on *date*" — the reported bug |
| `js/components/WeightCharts.js` | Actual Weight point labels (`fmtDate`) |
| `js/components/WeightCharts.js` | the x-axis tick labels, via timestamps built from day keys |

### The fix

`parseDayKey()` is now exported from [js/utils/appTime.js](js/utils/appTime.js)
— the module that already had a private copy for the dev date, which now
delegates to it. It splits the key and builds a **local** date, and returns an
Invalid Date for anything that is not three numeric parts, so callers can
guard instead of rendering a wrong day.

[js/utils/weeklyReport.js](js/utils/weeklyReport.js) had a second private copy
of the same helper; it now imports the shared one. ProfileTab and WeightCharts
use it at every site above. In WeightCharts the whole chart, including the
nearest-weight search, is now parsed in one local frame; those comparisons
were already self-consistent under the old UTC parse, so plotted positions are
unchanged and only the derived labels move — onto the right day.

### What was deliberately *not* changed

- **`Date.toDateString()` keys.** The `weeklyMuscles` session rows and the
  nutrition `history` array are keyed by `toDateString()` ("Tue Mar 31 2026"),
  which JavaScript parses in **local** time. Those call sites are correct, and
  "fixing" them would be the actual regression. I initially changed
  `MuscleTracker.js` on the assumption that its tooltip read a `"YYYY-MM-DD"`
  key; it reads a `toDateString()` key derived from `finishedAt`, so the change
  was wrong and was reverted — the file is byte-identical to `HEAD`. A test
  now pins the distinction so the same mistake is not made again.
- **`buildActualSeries()` validation and sorting.** Both sides of every
  comparison are parsed the same way, so they are correct as they stand, and
  tightening the parse there would start silently dropping entries in any
  other date format.

### Verification

| Check | Result |
|---|---|
| `node --test test/dayKey.test.js` | **8 / 8 passed** |
| The same, under `America/Phoenix`, `America/New_York`, `UTC`, `Europe/Berlin`, `Pacific/Chatham` | **101 / 101 passed** each, with the weekly-report, adaptive-target and storage suites |
| Browser: the Profile tab after logging a weight on Mar 31 in Phoenix | **Pass** — "Latest: 240 lb on **Mar 31**, 2026" |
| `npm test` | **442 / 442 passed** |

[test/dayKey.test.js](test/dayKey.test.js) covers round-tripping through
`dayKey()`, the year/month/leap-day boundaries, both DST transition days,
malformed input, and a source guard that fails if any of the three files
parses a day key with `new Date(...)` again. The guard is deliberately narrow:
it skips `new Date(someDate)` (an ordinary Date clone) and the `toDateString()
` readers.

**Mutation-tested, both layers.** Restoring `new Date(key)` in ProfileTab makes
the source guard fail naming the exact expression, and makes the browser check
fail with the literal *"Latest: 240 lb on Mar 30, 2026"*. Restoring the fix
returns both to green. The browser assertion had been written as `Mar 3[01]`
while the bug stood; tightening it to `Mar 31` is itself part of this fix.

---

## 18. Pre-existing fix — a corrupt profile destroyed the rest of the account

The third pre-existing bug found during this milestone, fixed on request.
No TissueOS code is involved.

### The bug

`loadUser()` returns `null` both when a profile key is **absent** and when it
is **unreadable**. `doLogin()` treated the two identically and routed to
onboarding. For the unreadable case that is an existing account, so when
onboarding finished the eager persistence effects wrote the in-memory values —
empty — over that account's perfectly readable data:

```
profile key corrupted (one truncated byte)
  → loadUser() null → onboarding, as though the account were new
  → finishOnboard() → screen === "app"
  → the eager effects flatten workoutLog, routines, weeklyMuscles,
    setTargets, intake and meals to empty
```

One corrupted byte in `profile` cost the user every workout they had logged.
It is the sharpest possible counter-example to the Milestone 0 promise that
malformed data is never destroyed: that protection covers the corrupted key
itself, and this destroyed all the *others*.

Reproduced in a real browser before fixing: profile `demo-r@example.com` with
a saved workout, routine, targets, weekly rollup and nutrition history came
back empty after re-onboarding.

### The fix

`quarantineProfile()` already returns the list of keys that would not parse —
the return value was simply being discarded. `doLogin()` now uses it to tell
the two cases apart:

| `loadUser()` | `profile` unreadable? | Meaning | Action |
|---|---|---|---|
| a profile | — | normal login | load every key |
| `null` | **yes** | existing account, corrupt profile | **load every other key**, then onboard |
| `null` | no | brand-new account | reset state (§16), then onboard |

In the recovery branch the account's other keys are read into memory exactly
as a normal login would, so onboarding replaces only the profile and the
write-back rewrites each other key with the value it already held. The
original profile bytes remain in `<key>__corrupt`, as before.

The three load paths — boot restore, normal login, recovery — now share one
reader, `loadProfileScopedState()`. Keeping three hand-written copies of that
sequence in sync is precisely how §16 and this bug arose.

### Verification

| Check | Result |
|---|---|
| `node --test test/storage.test.js` | **49 / 49 passed** |
| Browser: corrupt a profile, re-onboard | **Pass** — `workoutLog`, `routines`, `setTargets`, `weeklyMuscles` and `history` byte-identical; new profile named as entered; original bytes in `__corrupt`; derived TissueOS history still matches the surviving source; 2,000 `lb*rep` visible in the UI |
| `npm test` | **445 / 445 passed** |
| Both builds | **30 grouped checks passed** |

Three tests were added to [test/storage.test.js](test/storage.test.js): a
behavioural simulation of the recovery path against the in-memory stub that
asserts every sibling key survives byte-for-byte and profile B is untouched;
a test that the recovery path fires **only** for an unreadable profile and
never for an absent one; and a source guard on the three-way branch.

**Mutation-tested, both layers.** Making the recovery branch call
`resetProfileState()` — the original behaviour — fails the source guard with
*"recovery must LOAD the account's other keys"* and fails the browser check
with *"the account's workouts were destroyed"*. Discarding
`quarantineProfile()`'s return value fails the guard with *"the unreadable-key
report must be captured, not discarded"*. Restoring the fix returns all of
them to green.

### Remaining limitation

The user is still sent through onboarding to rebuild their profile, and is
told only by the existing toast (*"Some saved data could not be read — the
original was kept"*). A dedicated recovery screen that offers to restore from
the `__corrupt` sidecar would be a better experience, but it is a new feature
rather than a bug fix and was not built.
