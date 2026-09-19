# TissueOS domain layer — Milestone 1

Pure, framework-free computation that turns a Physiq workout session into a
deterministic, versioned, uncertainty-tagged **tissue workload** breakdown.

Nothing in this directory touches React, the DOM, `localStorage`, the network
or the clock (tests enforce this). Milestone 3 consumes this unchanged engine
through a pure presentation adapter; see [Tissue Load Map](../../TISSUE_LOAD_MAP.md).
Milestone 4 adds a versioned history layer **around** the engine — per-session
snapshots and longitudinal windows; see
[Longitudinal Tissue Load](../../TISSUE_LOAD_HISTORY.md). The engine itself is
unchanged by both: same versions, coefficients, bands, units and algorithm,
pinned by a golden test and by a source-hash test.

All examples below are synthetic.

---

## The ten questions

### 1. What mathematical quantity does v0.1 output?

A **workload**: weight multiplied by repetitions, scaled by a dimensionless
relative coefficient per tissue.

```
effectiveLoad = externalWeight + bodyMassBandValue(band) x bodyMass
setWorkload   = reps x effectiveLoad
workload[t]   = setWorkload x coefficient[exercise][t]
```

It is a raw training-volume quantity. It is **not** normalized: nothing
divides by a maximum, a baseline or a capacity, so there is no 0-100 score,
no percentage and no upper bound. Every result states this in two fields:

```js
workloadUnit: "lb*rep",
scale: "unbounded"
```

### 2. What unit does that quantity have?

**Pound-reps** (`lb*rep`) — it is dimensional, not dimensionless. A squat of
5 reps at an effective load of 360 lb yields 1800 lb*rep. Tissue coefficients
are dimensionless, so they do not change the unit.

Input weights are in **pounds**, Physiq's canonical unit. That is not a guess:

- [calculations.js](../utils/calculations.js) converts the profile weight with `* 0.453592`, i.e. lb to kg;
- [OnboardScreen.js](../screens/OnboardScreen.js) asks for "Weight (lbs)";
- [CalendarTab.js](../screens/CalendarTab.js) and [WeeklyReportScreen.js](../screens/WeeklyReportScreen.js) render set weights with a hard-coded `lb` suffix;
- there is no unit selector anywhere in the app, and no unit field in storage.

A caller holding data in another unit must declare `context.weightUnit`
(`"lb"` or `"kg"`); it is converted to pounds before any arithmetic, and
**an unrecognised unit throws** rather than being silently read as pounds.
The declaration governs both set weights and `context.bodyMass`.

### 3. Can two different users' raw outputs be compared?

Only crudely, and only with their body masses in hand. Two users doing
identical sets get identical workloads, so the quantity is comparable in the
narrow sense. But it says nothing about how hard the work was for either of
them: 100 lb is a warm-up for one lifter and a maximum for another, and v0.1
has no notion of intensity relative to capacity. Treat cross-user comparison
as meaningless for any training decision.

Within one user, across sessions produced by the **same model version**, the
comparison is the intended use.

### 4. Can lb-entered and kg-entered workouts be compared?

Yes **if** each was computed with the correct `weightUnit` declared — the
engine converts both to pounds, and the same physical session produces the
same workload either way (a test pins this).

No if the unit was wrong or undeclared. And there is a limitation the engine
cannot fix: Physiq's own set-weight input is **unlabelled**, so a lifter
thinking in kilograms produces records that the whole app already mislabels
as pounds. The Calendar and Weekly Report have the same problem. The engine
inherits Physiq's convention rather than papering over it, and refuses to
accept an unknown unit so the failure is loud rather than silent.

### 5. What does a tissue coefficient mean?

A dimensionless relative weighting in `(0, 1]`: how strongly this tissue is
assumed to be involved in the exercise, relative to its primary target
(`1.0`). Coefficients are independent per tissue and are **not** normalised
to sum to one; two tissues can both be `1.0`.

### 6. What does it explicitly NOT mean?

Not a measured force. Not a fraction of the force or stress the tissue
experiences. Not an activation percentage. Not Newtons, kilonewtons or
body-weight multiples. Not injury risk, injury probability, tissue damage,
percentage recovered or remaining capacity. Not clinical truth.

The coefficients are engineering heuristics drawn from general
strength-training convention. **No literature review was performed for
Milestone 1** and no citations are attached, because none would be honest.

**Tendon entries need the sharpest reading.** A `patellar_tendon` or
`achilles_tendon` coefficient means only:

> this exercise is provisionally considered mechanically relevant to this
> tissue, and more relevant than an exercise with a lower number

It does **not** approximate the fraction of force or stress the tendon
experiences. They are retained in v0.1 for one architectural reason: they are
the only thing exercising the muscle-versus-tendon type distinction end to
end, through the vocabulary, the map, the engine and aggregation. They are
mapped only where knee-extension or plantar-flexion demand is uncontroversial
(squat pattern, leg extension, calf raises), never sprinkled across every leg
exercise. Every tendon entry is `low` confidence, and a test enforces that a
tendon coefficient never exceeds the exercise's top muscle coefficient, so a
tendon can never be rendered as the dominant loaded structure.

### 7. How are bodyweight exercises handled?

There is **no bodyweight special case**. Every mapped exercise declares a
body-mass band, including `none`, and the engine applies one rule to all of
them. A squat logged at weight 0 and a push-up logged at weight 0 go through
exactly the same arithmetic.

| Band | Value | Meaning | Examples |
|---|---|---|---|
| `none` | 0 | body supported externally | bench press, lat pulldown, leg press, curls, seated calf raise |
| `light` | 0.25 | a small share of the body is moved | hip thrust |
| `half` | 0.5 | roughly half the body is moved or held | deadlift, Romanian deadlift, plank, hanging leg raise |
| `most` | 0.75 | most of the body is moved | squat, lunge, push-up, standing calf raise |
| `full` | 1.0 | essentially the whole body is moved | pull-up, dips |

Bands are referenced **by name, not by decimal**, and there are only five of
them. That is deliberate: it makes the coarseness structural, so no entry can
imply anthropometric precision it does not have. They are provisional
engineering assumptions, not measurements.

Missing athlete mass is deterministic: `DEFAULT_BODY_MASS_REFERENCE` (180 lb,
pinned by a test to `DEFAULT_PROFILE.weight`) is substituted, a
`default_body_mass` warning is recorded, and every affected entry's confidence
is capped at `low`. Every unusable value (`0`, negative, `NaN`, a string,
`undefined`) lands on that identical result. A `none`-band exercise never
depends on body mass, so it is never capped.

A set whose effective load works out to zero (a `none`-band exercise logged at
weight 0) scores zero and records `zero_load`.

### 8. What does confidence mean?

**Categorical model metadata**: how much the authors trust the assumption
behind a number.

- `low` — placeholder-quality heuristic; expect it to change.
- `medium` — coarse but widely-agreed relationship.
- `high` — reserved; **unused in v0.1** because nothing has been validated.

It is not a probability, not a calibrated interval, and no statistical
calibration exists. When several assumptions feed one number the result
carries the **minimum** of their confidences (weakest link). A test enforces
that confidence never becomes numeric.

### 9. Why is this model still useful despite being provisional?

Because the software contract is the deliverable, not the science. What v0.1
establishes is real and does not change when the coefficients do:

- a workout session deterministically becomes per-tissue results, with
  provenance down to the set index;
- every number states which model version, which coefficient table and which
  unit produced it, so a future model cannot silently make old and new numbers
  look comparable;
- uncertainty travels with every value instead of being lost;
- incomplete sets, unknown exercises and malformed numbers all have defined,
  tested behaviour;
- the scientific assumptions are isolated in one data file, so replacing them
  is an edit to `exerciseTissueMap.js` and a version bump, not a refactor.

The heuristics are the part designed to be thrown away. The contract is not.

### 10. What later milestone makes the output athlete-relative?

**Milestone 4 (longitudinal baseline), now implemented outside this directory.**
Rolling 7-day and 28-day exposure and an athlete-specific baseline are what turn
a raw workload into something that can honestly be expressed as "above your own
recent logged exposure". They live in
[js/utils/tissueLoadHistory.js](../utils/tissueLoadHistory.js) over frozen
per-session snapshots, never inside the model: v0.1 still has no baseline, no
capacity, no recovery and no tissue state, and every number it returns means
exactly what it meant before. A history entry records which model and map
version produced it, so incomparable model outputs are never summed together.

---

## Modules

| File | Responsibility | Kind |
|---|---|---|
| `modelVersion.js` | Version strings stamped on every result; source-type tag | software contract |
| `uncertainty.js` | `low / medium / high` vocabulary and its combination rule | software contract |
| `tissueDefinitions.js` | Canonical tissue ids, names, types, link to the body map | contract (ids) + provisional (which tissues) |
| `exerciseTissueMap.js` | Coefficient table, body-mass bands, name resolution | **provisional scientific assumptions** |
| `loadEngine.js` | `estimateSetTissueLoad`, `estimateSessionTissueLoad` | contract (shape, units, determinism) + provisional (formula) |

"Software contract" means later milestones may rely on it and a change is a
breaking change. "Provisional" means an author-chosen assumption a later model
version is expected to replace; it is versioned precisely so that it *can* be
replaced without corrupting comparisons.

---

## Tissue definitions

```js
{ id: "patellar_tendon", name: "Patellar tendon", type: "tendon", physiqMuscle: null }
```

- `id` — stable machine identifier, never renamed once results exist against it.
- `name` — display label, free to change.
- `type` — one of `muscle | tendon | ligament | joint | other`.
- `physiqMuscle` — id of the existing muscle-tracker region this tissue sits
  under (`TRACKED_MUSCLES` in [constants.js](../data/constants.js)), or `null`.
  Recorded so a later UI can colour the current body map; the engine ignores it.

The vocabulary is the handoff's suggested coarse set of twelve: ten muscle
regions plus `patellar_tendon` and `achilles_tendon`. Physiq says `quads`; the
tissue id is `quadriceps`, linked through `physiqMuscle`. No left/right
instances exist because Physiq records no side information. The `back` bucket
deliberately covers lats, upper back **and** spinal erectors, because Physiq's
own catalog files Deadlift under "back".

---

## Exercise mapping and coverage

25 exercises, not the 106-name catalog. Since every coefficient is an
unreviewed heuristic, each one is a liability a later evidence pass must
re-examine, so the set is sized to prove the software contract across the
movement patterns Milestone 1 cares about and no larger. Catalog percentage is
explicitly not a goal.

| Pattern | Exercises |
|---|---|
| Upper push | Barbell Bench Press, Overhead Press, Push-Up, Dips |
| Upper pull | Pull-Up, Lat Pulldown, Barbell Row, Seated Cable Row |
| Knee-dominant | Squat, Front Squat, Leg Press, Lunge |
| Hip-dominant | Deadlift, Romanian Deadlift, Good Morning, Hip Thrust |
| Plantar-flexor | Standing Calf Raise, Seated Calf Raise |
| Isolation | Dumbbell Curl, Tricep Pushdown, Lateral Raise, Leg Extension, Lying Leg Curl |
| Core | Plank, Hanging Leg Raise |

All twelve tissues are reachable. Cardio is intentionally unmapped: Physiq
logs it as sets x reps x weight, which does not describe it. Unmapped
exercises are handled safely and are the honest default.

---

## API

```js
estimateSetTissueLoad(exercise, set, context)
// exercise: { name, id? }              a Physiq workout exercise entry
// set:      { reps, weight, done }     one of its sets
// context:  { bodyMass?, weightUnit?, exerciseTissueMap? }   optional

estimateSessionTissueLoad(session, context)
// session: a workoutLog entry, or the in-memory active session
```

`estimateSessionTissueLoad` accepts exactly the shape
[STORAGE_CONTRACT.md](../../STORAGE_CONTRACT.md) documents for `workoutLog`;
missing ids or timestamps become `null`. The `context.exerciseTissueMap`
override exists for tests and experiments; it replaces the table rather than
extending it.

### Set-level rules

| Situation | Behaviour |
|---|---|
| `done !== true` (false, missing, `1`, `"true"`) | `completed: false`, no workload entries, no events. Numeric fields still show what *would* have counted. |
| Mapped exercise, completed | one entry per mapped tissue, even when the value is 0, so provenance is retained |
| Unmapped exercise | `status: "unmapped"`, `mappedName: null`, no entries, no invented band. Distinguishable from a mapped exercise with an empty table (`status: "mapped"`, no entries). |
| `reps` or `weight` not a finite number >= 0 | treated as 0, with `invalid_reps` / `invalid_weight`. Numeric strings accepted. Output is never `NaN`, `Infinity` or negative. |
| Effective load works out to 0 | scores 0; `zero_load` warning |
| `reps: 0` | scores 0; `zero_reps` warning |
| `context.weightUnit` unrecognised | **throws** |
| Inputs | never mutated |

Aggregation: per-tissue totals are plain sums taken in a canonical sorted
order, so floating-point results cannot depend on exercise order. Per-tissue
confidence is the weakest contributing confidence. `events` are shaped so a
later milestone can persist them as TissueLoadEvents (they lack only an `id`);
nothing here mints ids or writes anything.

---

## Worked example

Synthetic session: two completed squat sets and one unfinished, one Romanian
deadlift set, and a treadmill entry that is not in the map. Body mass 180 lb.

```js
estimateSessionTissueLoad({
  id: 8002, title: "Leg Day", startedAt: 1772634600000, finishedAt: 1772637000000,
  exercises: [
    { id: 92001, name: "Squat", sets: [
      { reps: 5, weight: 225, done: true },
      { reps: 5, weight: 225, done: true },
      { reps: 5, weight: 225, done: false } ] },
    { id: 92002, name: "Romanian Deadlift", sets: [
      { reps: 8, weight: 155, done: true } ] },
    { id: 92003, name: "Treadmill Run", sets: [
      { reps: 1, weight: 0, done: true } ] }
  ]
}, { bodyMass: 180 });
```

One squat set works out as `225 + 0.75 x 180 = 360` lb effective load, times 5
reps = `1800` lb*rep, times the quadriceps coefficient `1.0` = `1800`.

Aggregated result (`totalWorkload` in `lb*rep`, `scale: "unbounded"`):

| Tissue | totalWorkload | events | confidence | contributors |
|---|---|---|---|---|
| back | 2256 | 3 | low | Squat 1080, Romanian Deadlift 1176 |
| core | 2028 | 3 | low | Squat 1440, Romanian Deadlift 588 |
| glutes | 4448 | 3 | medium | Squat 2880, Romanian Deadlift 1568 |
| hamstrings | 3040 | 3 | low | Squat 1080, Romanian Deadlift 1960 |
| patellar_tendon | 2880 | 2 | low | Squat 2880 |
| quadriceps | 3600 | 2 | medium | Squat 3600 |

```js
modelVersion: "tissue-load-v0.1", mapVersion: "exercise-tissue-map-v0.1",
workloadUnit: "lb*rep", scale: "unbounded", weightUnit: "lb",
unmappedExercises: ["Treadmill Run"], warnings: [],
exercises: [ ["Squat", "mapped", 2 done, 1 incomplete],
             ["Romanian Deadlift", "mapped", 1, 0],
             ["Treadmill Run", "unmapped", 1, 0] ]
```

The third squat set contributes nothing. The treadmill entry is reported, not
scored. `hamstrings` is `low` because the squat's hamstring coefficient is
`low`, even though the Romanian deadlift's is `medium`.

---

## Model version vs. schema version

```
SCHEMA_VERSION            (js/utils/storage.js)   integer  - how bytes are laid out on disk
TISSUE_LOAD_MODEL_VERSION (js/tissue/)            string   - which formula produced a number
EXERCISE_TISSUE_MAP_VERSION                       string   - which coefficient table
TISSUE_DEFINITIONS_VERSION                        string   - which tissue vocabulary
```

Different concepts, moving independently. A model bump changes numbers, not
storage; a schema bump changes storage, not numbers. Milestone 1 touches
neither the schema version nor the migration list. When TissueOS results are
eventually stored, the model version travels *inside* the record so historical
scores from an older model are never mistaken for current ones.

Bump rules: formula change → model version; any coefficient, confidence, band
or mapped-exercise change → map version; tissue added, removed or renamed →
definitions version **and** model version. A test pins all three strings, so
an incidental bump fails the suite.

v0.1 is defined by its first commit. It has never been released and nothing is
persisted, so no stored result predates this definition.

---

## Exercise identity

Physiq identifies an exercise by its **display name** (`ex.name`), chosen from
the fixed catalog in [constants.js](../data/constants.js); the numeric `ex.id`
on a workout entry is a per-routine `Date.now()`-derived value, not a catalog
id. The muscle tracker already keys `EXERCISE_MUSCLE` by the same name, so
TissueOS follows that rather than inventing a parallel id system.

Consequences, contained in `resolveExerciseMapping()`:

- lookup is exact, then trimmed and case-folded; no fuzzy matching;
- renaming a catalog entry orphans its history for **both** the muscle tracker
  and TissueOS, a shared pre-existing limitation;
- historical `workoutLog` records are read as-is and never rewritten.

---

## Known scientific limitations (v0.1)

- Coefficients and body-mass bands are un-reviewed heuristics; nothing is
  `high` confidence.
- The formula is linear in reps and load. It ignores intensity relative to
  maximum, proximity to failure, tempo, range of motion, eccentric emphasis,
  velocity, rest, fatigue and technique, some of which dominate real tissue
  loading. Milestone 2 added optional **user-reported** `rir`, `side`,
  `tempo` and `rom` fields to set records ([SET_METADATA.md](../../SET_METADATA.md));
  v0.1 still ignores them by design, and
  [test/tissueLoadInvariance.test.js](../../test/tissueLoadInvariance.test.js)
  pins its outputs against a golden file captured before those fields existed.
- Body-mass bands are five coarse values applied to whole movement patterns,
  not per-exercise biomechanics.
- Unilateral exercises are scored as if bilateral. A `side` value on a set
  is recorded for the user and not read by the engine; no per-side tissue
  state or event splitting exists.
- Tendon entries are relevance markers, not tendon-load models.
- A lifter entering kilograms into Physiq's unlabelled weight field produces
  data the whole app mislabels; the engine inherits that.
- The domain has no cross-session tissue state, capacity, recovery or baseline.
  Milestone 3 sums existing events for the selected calendar period at display
  time. Milestone 4 stores per-session snapshots and derives rolling calendar
  exposure and an athlete-relative baseline from them — all outside this
  directory, all plain sums and means of the numbers below. A baseline there
  is *logged exposure history*, not capacity, and still supports no inference
  about recovery or injury.
- Body mass is a v0.1 input, so it is part of a result's meaning. Milestone 4
  freezes the mass each stored session was computed with, preferring a dated
  measurement at or before that session; a later measurement is never
  back-applied. Historical context quality is recorded separately and never
  alters the confidence category defined here.

**This layer estimates a relative training workload per coarse tissue region
for one session.** It cannot say what force a tissue experienced, how it is
recovering, or whether it is at risk, and no downstream feature should imply
that it can. It is not a medical or injury-prediction system.

## Verifying

```bash
node --test test/tissueDefinitions.test.js test/exerciseTissueMap.test.js test/tissueLoadEngine.test.js test/tissueSemantics.test.js
npm test
```
