# Physiq — Optional workout-set metadata (Milestone 2)

Performed workout sets may now carry four **optional, user-reported** fields
alongside `reps`, `weight` and `done`: **RIR**, **side**, **tempo** and
**ROM**. Nothing else changed: logging a workout without touching them is
byte-for-byte what the app wrote before, the storage schema version is still
`1`, and the TissueOS load model ignores the new fields entirely.

All examples are synthetic. Baseline for this work: `main` at `5f47e24`
(Milestones 0 and 1 merged).

---

## 1. Shape

```json
{ "reps": 5, "weight": 185, "done": true,
  "rir": 2,
  "side": "bilateral",
  "tempo": { "eccentricSeconds": 3, "pauseSeconds": 1, "concentricSeconds": 1 },
  "rom": "full" }
```

| Field | Type | Allowed | Meaning |
|---|---|---|---|
| `rir` | integer | `0`–`5` | Reps in reserve: the lifter's **own estimate** of how many more reps they had. Subjective. |
| `side` | string | `left` \| `right` \| `bilateral` | What the user chose. **Never inferred** from the exercise name. Rep counting is unchanged. |
| `tempo` | object | each phase optional, whole seconds `0`–`30` | `eccentricSeconds` (lowering), `pauseSeconds` (the transition pause after the eccentric), `concentricSeconds` (lifting), in that order. |
| `rom` | string | `partial` \| `standard` \| `full` | The lifter's own category. **Not a measured joint angle**; no calibrated boundaries are claimed. |

`0`–`30` s per tempo phase is a product input bound, not a scientific range.
The four-part "3-1-1-0" tempo convention and the `X` shorthand are
deliberately **not** parsed; each phase is its own labelled control.

The single source of truth for definitions, parsing, validation, immutable
updates and display is [js/utils/setMetadata.js](js/utils/setMetadata.js). It
contains no biomechanics assumptions.

## 2. Missing, zero, clearing

- **Missing means missing.** A field the user never entered is **absent**
  from the set object. New writes never encode "unknown" as `0`, `null`, `""`
  or `{}`.
- **Zero is a value.** `rir: 0` = nothing left; `pauseSeconds: 0` = a
  recorded zero-second pause. Both are shown, not hidden. A blank tempo phase
  renders as `–` (`4-–-–s`), a zero as `0` (`2-0-1s`).
- **Blank is decided before conversion.** `""` clears; `Number("")` is never
  reached, so blank can never become `0`.
- **Clearing deletes the key.** Clearing the last tempo phase deletes `tempo`
  itself. "Clear details" removes `side`, `tempo` and `rom`; RIR is cleared
  from its own control by choosing `–`. With everything cleared the set is
  back to `{ reps, weight, done }`.
- **Old sets are never rewritten.** Loading history adds no defaults; a
  legacy `{ reps, weight, done }` set stays exactly that.

## 3. Validation

Interactive input is parsed by `parseMetadataInput(field, raw)`; the result
is either `{ ok: true, value }` (value `undefined` for blank) or
`{ ok: false, error }`. Rejected, never rounded or clamped:

- fractions (`2.5`), partially numeric text (`2abc`), exponent/hex forms,
  non-finite numbers, booleans, arrays, objects;
- out-of-range integers (`-1`, `6` for RIR; `31` for a tempo phase);
- unsupported enum strings, including case variants (`Left`, `FULL`).

A rejected entry never replaces a prior valid value: the set is returned
untouched and the UI keeps the pending text with a message next to the
control. The write path (`setSetMetadataField`) throws on an invalid value
so malformed data cannot be persisted by a programming error.

**Malformed stored values** (hand-edited or from a future build) are
tolerated by `readSetMetadata()`: each invalid field reads as unavailable,
the UI hides it, and history is not rewritten. Editing that field on an
active set replaces it with the validated value; a malformed tempo phase is
dropped when a sibling phase is edited, unknown keys inside `tempo` are
carried over.

## 4. Immutability

Every update returns a new set; the source is never mutated. `tempo` is
always rebuilt as a fresh object, so two sets can never share one, and a
shallow-copied set gets its own `tempo` on the next edit. Unknown keys on a
set are preserved through every update.

## 5. Lifecycle

| Step | Behaviour | Code |
|---|---|---|
| Start routine | Copies `reps`, `weight`, `done:false` only. Routines carry no metadata, and any such keys on a routine set are dropped, so a fresh workout never starts with earlier observations attached. | `startSessionFromRoutine` |
| Edit reps/weight | Other keys, including metadata, preserved. Negative → `0` as before. | `updateSetNumberField` |
| Toggle done | Only `done` changes. | `toggleSetDone` |
| Edit metadata | Parse, then apply or reject. | `updateSetMetadataInput` |
| Clear details | Removes `side`, `tempo`, `rom` from one set (`clearSessionSetMetadata` also drops `rir`). | `clearSessionSetDetails` |
| Finish | Record `{ id, routineId, title, startedAt, finishedAt, completedSets, totalSets, exercises }`, identical to the pre-Milestone-2 shape; `exercises` pass through by reference, so incomplete sets (`done:false`) keep their metadata too. | `buildCompletedWorkoutRecord` |

These live in [js/utils/workoutSession.js](js/utils/workoutSession.js) and are
the functions `ExerciseTab` calls (a source guard test pins that).

**Routine editing** is unchanged: the routine builder has no metadata
controls, and `editRoutine` still copies `{ reps, weight }` only. There is no
duplicate-set action in the active view; "+ Add Set" exists only in the
routine builder and inherits reps/weight there, never metadata. No new
copy or history-editing workflow was added.

**Active sessions are memory-only** (unchanged): the in-progress workout,
including any metadata typed so far, is lost on reload. Reload persistence
applies to **saved workout history**. No draft autosave was added.

## 6. Persistence

- Written through the existing profile-scoped `workoutLog` key by
  `App.logCompletedWorkout` → `sv(email, "workoutLog", …)`. Read by the same
  direct `JSON.parse` readers as before. No allowlist drops the fields: the
  record is serialised as-is, and export/import copies raw strings.
- **Schema version stays `1`.** Optional fields on an existing key that
  older readers ignore are additive; no migration is needed or was written.
- Profile isolation is unchanged: metadata logged under one e-mail is
  invisible under another (tested).

## 7. UI

Active workout view only. Weight, reps and the done button remain primary;
a user who ignores metadata logs and finishes with no additional taps.

- **RIR**: a compact `–/0…5` select in each set row (one tap).
- **Details** (`▾` at the end of the row, `aria-expanded`/`aria-controls`):
  Side select, three labelled tempo inputs (`inputmode="numeric"`, invalid
  text kept with an inline `role="alert"` message and `aria-invalid`), ROM
  select whose hint line describes the chosen category, and **Clear
  details** (side / tempo / ROM). A dot on the toggle marks a set that
  already carries details. Details expand *below* the row, so
  the done button is never covered.
- All controls are native `<button>`, `<select>` and `<input>` elements with
  an accessible name, `tabindex` 0, and a `:focus-visible` outline defined in
  CSS. Nothing carries a positive `tabindex`, so tab order follows DOM order:
  reps, weight, RIR, done, details toggle, then that set's details panel.
  There is no `<form>`, so Enter cannot submit anything.
- **History**: the Calendar day panel's per-exercise recap appends a muted
  summary to each completed-set pill, e.g. `5×185lb · RIR 5 · Both sides ·
  Tempo 3-1-1s · Full ROM`, hidden when the set has none.

**Known display limitation (intentional).** That recap has always listed
**completed sets only** — `sets.filter(s => s.done)` — and Milestone 2 did not
redesign it. Metadata entered on a set that was never completed is saved,
reloaded and readable, but has no display slot, exactly as its reps and weight
already had none. Surfacing incomplete sets would be a history-UI change this
milestone deliberately does not make. Both halves are pinned by tests in
[test/workoutSession.test.js](test/workoutSession.test.js): the data survives a
storage round-trip unchanged, and the recap's own predicate excludes it.

## 8. Why the load model ignores these fields

`tissue-load-v0.1` (Milestone 1) computes `reps × effectiveLoad ×
coefficient` from `done`, `reps`, `weight` and the exercise name. Proximity
to failure, tempo, range of motion and laterality would each need a model
change and a model-version bump; none has been validated, so v0.1 stays as
committed. [test/tissueLoadInvariance.test.js](test/tissueLoadInvariance.test.js)
compares the engine against a golden file captured **before** this milestone
([test/fixtures/tissueLoadBaseline.v0.1.json](test/fixtures/tissueLoadBaseline.v0.1.json),
commit `5f47e24`) and checks that adding or changing only metadata leaves
every output field identical, that events and provenance carry no metadata,
and that no side-based splitting occurs.

**The golden file is a static artifact and the suite cannot regenerate it.**
`npm test` runs `node --test "test/*.test.js"`; the capture script is a `.mjs`
one directory deeper, so the glob never reaches it, and it refuses to write
without an explicit output path. A test asserts both of those properties and
that no file in the suite calls a filesystem write API at all. Expected values
are read from the JSON, never recomputed by the code under test, so any change
to the engine's output fails the suite until a maintainer deliberately reviews
it. Regenerating the file is correct **only** alongside a reviewed model-version
bump per [js/tissue/modelVersion.js](js/tissue/modelVersion.js) — never to make a
failing test pass.

## 9. Fixtures and tests

- [js/dev/demoFixtures.js](js/dev/demoFixtures.js): `DEMO_SESSION_METADATA_B`
  (profile B, Sat 7 Mar) covers legacy sets, RIR 0 and 5, an RIR-only set,
  all fields at once, left/right, partial tempo, explicit zero pause, and an
  incomplete set with metadata. Profile A's history is untouched, so legacy
  coverage stays legacy.
- [test/setMetadata.test.js](test/setMetadata.test.js) — contract, parsing,
  validation, immutability, nested independence, tolerant reads, display.
- [test/workoutSession.test.js](test/workoutSession.test.js) — production
  lifecycle helpers, finish record, storage round-trip, export/import,
  profile isolation, legacy history, fixture summaries, source guard.
- [test/tissueLoadInvariance.test.js](test/tissueLoadInvariance.test.js) — §8.

```bash
npm test
npm run build
```
