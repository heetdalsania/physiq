# Physiq — Persistence Contract

**Baseline document for Milestone 0.** Describes how Physiq stores data *today*, so
any later change (including TissueOS work) can be shown not to have broken it.

Everything below was read off the repository, not from a design document. Where the
code and the older handoff notes disagree, the code wins and the discrepancy is
called out.

All examples are synthetic.

- Schema version: **1** (`SCHEMA_VERSION` in [js/utils/storage.js](js/utils/storage.js))
- Backend: **browser `localStorage` only.** No server, no IndexedDB, no native
  storage plugin. The iOS build (Capacitor) uses the WKWebView's `localStorage`.
- Scope: one origin, one device. Moving data between devices is manual, via
  **Export Data / Import Data** in the Profile tab.

---

## 1. Key naming and profile scoping

Every key is prefixed `pq_`. Profile-scoped keys are built by `uKey()`:

```js
uKey(email, suffix)  →  "pq_" + email + "_" + suffix
// uKey("demo-a@example.com", "workoutLog")
//   → "pq_demo-a@example.com_workoutLog"
```

The e-mail is lower-cased and trimmed at login ([js/App.js:794](js/App.js:794)) and then
used **verbatim** inside the key. That string *is* the profile boundary: there is no
user table, no account record, and no index of profiles. Two accounts on the same
device are isolated purely because their keys differ.

Consequences worth knowing:

- Nothing enumerates profiles. "Log out" just clears React state and returns to the
  login screen ([js/screens/ProfileTab.js:113](js/screens/ProfileTab.js:113)); the previous
  profile's keys stay on disk untouched.
- Logging in with a different e-mail reads a different key set. That is the whole of
  profile switching ([js/App.js:794](js/App.js:794)).
- There is no authentication. The e-mail is an identifier, not a credential.

---

## 2. Global keys (not profile-scoped)

| Key | Encoding | Written by | Read by |
|---|---|---|---|
| `pq_schema_version` | **raw string** integer | `runMigrations()`, `importAll()` | `readSchemaVersion()`, `runMigrations()` |
| `pq_theme` | **raw string** `"dark"` \| `"light"` | [js/App.js:352](js/App.js:352) | `loadTheme()` |
| `pq_last_email` | **raw string** | [js/App.js:797](js/App.js:797), [js/App.js:833](js/App.js:833) | `getLastEmail()` |
| `pq_dev_mode` | **raw string** `"1"` \| `"0"` | `AppTime.setDevMode()` | `appTime.js` module init |
| `pq_dev_date` | **raw string** `"YYYY-MM-DD"` | `AppTime.setDevDate()` | `appTime.js` module init |
| `pq_food_search_cache` | JSON object, ≤ 50 entries | `foodSearch.js` | `foodSearch.js` |

> **The five raw-string keys are not JSON.** They must be read with
> `localStorage.getItem()` directly, never with `storage.get()` — `JSON.parse("dark")`
> throws. Every current call site does the right thing.

`pq_nearby_<lat>_<lng>_<radius>` also exists but lives in **`sessionStorage`**, not
`localStorage` ([js/utils/nearbyRestaurants.js:64](js/utils/nearbyRestaurants.js:64)). It is a
10-minute restaurant-search cache, dies with the tab, and is deliberately outside
export/import.

---

## 3. Profile-scoped keys

All are `pq_<email>_<suffix>`. "JSON" means `JSON.stringify` of the value shown.

| Suffix | Encoding | Default when absent | Writer | Reader |
|---|---|---|---|---|
| `profile` | JSON object | `null` → onboarding | `sv(email,"profile")` [App.js:330](js/App.js:330) | `loadUser()` |
| `intake` | JSON object | `EMPTY_INTAKE` | [App.js:334](js/App.js:359) | `loadDaily()` |
| `meals` | JSON array | `[]` | [App.js:339](js/App.js:363) | `loadDaily()` |
| `date` | **raw string** `Date.toDateString()` | — | [App.js:341](js/App.js:368) | `loadDaily()` |
| `history` | JSON array, **≤ 90** | `[]` | `saveHistory()` | `loadHistory()` |
| `routines` | JSON array | `[]` | [App.js:358](js/App.js:387) | direct `JSON.parse` |
| `workoutLog` | JSON array | `[]` | [App.js:362](js/App.js:391) | direct `JSON.parse` |
| `weeklyMuscles` | JSON object | empty week | [App.js:366](js/App.js:395) | direct + `rolloverWeeklyMuscles()` |
| `setTargets` | JSON object | `{}` | [App.js:370](js/App.js:399) | direct `JSON.parse` |
| `recentFoods` | JSON array, **≤ 5** | `[]` | [App.js:630](js/App.js:659) | direct `JSON.parse` |
| `planDrafts` | JSON object | `{training:[],rest:[]}` | [PlanDayScreen.js:67](js/screens/PlanDayScreen.js:67) | `get()` |
| `lastCheckin` | **raw string** Monday key | — | [App.js:455](js/App.js:483) | direct `getItem` |
| `<suffix>__corrupt` | raw string (unparseable original) | — | `quarantineProfile()` | nothing — recovery only |

### Two read styles

Reads are split, for historical reasons, between the hardened helpers in
`storage.js` (`get`, `loadUser`, `loadDaily`, `loadHistory`) and **direct
`JSON.parse(localStorage.getItem(...))` calls inside App.js state initialisers**
(`routines`, `workoutLog`, `weeklyMuscles`, `setTargets`, `recentFoods`).

The direct readers are each individually wrapped in `try/catch` with a literal
fallback, so malformed data degrades to an empty value rather than white-screening —
but they bypass the toast and the corruption handling in `get()`. This is why
migrations must run **before React mounts** ([js/App.js:1168](js/App.js:1168)): the direct
readers never see a pre-migration shape.

Unifying these on `get()` is a reasonable future cleanup. It was deliberately **not**
done in Milestone 0 — it is a behaviour-affecting refactor of code that works.

---

## 4. Data shapes

### `profile`

`DEFAULT_PROFILE` ([js/data/constants.js](js/data/constants.js)) plus fields added at runtime.

```json
{
  "age": 27, "weight": 178, "height": 71,
  "sex": "male", "bodyfat": 17,
  "goal": "build", "activity": "moderate",
  "gymDays": 4, "steps": 9000,
  "todayMuscles": [], "bmrOverride": null, "name": "Demo A",
  "calorieAdjustment": 0, "calorieAdjustmentUpdatedAt": null,
  "weightLog": [
    { "date": "2026-02-23", "weight": 176 },
    { "date": "2026-03-02", "weight": 178 }
  ]
}
```

- `goal` ∈ `build | lean | maintain | debloat | cut`; `activity` ∈ `sedentary |
  light | moderate | active | extreme`.
- `weightLog` is **absent on older profiles** and created on first weigh-in
  ([js/App.js:556](js/App.js:556)). Every reader guards with `Array.isArray(p.weightLog) ? … : []`.
  Its `date` is `"YYYY-MM-DD"` — *different* from the `toDateString()` format used by
  `history`. Both formats are live; neither is being changed.
- `calorieAdjustment*` were added by the adaptive-coaching feature and are likewise
  absent on older profiles. `Object.assign({}, DEFAULT_PROFILE, stored)` is **not**
  applied on load, so readers must tolerate `undefined` — they do, via `|| 0` guards.

### `workoutLog` — the completed-session record

One entry per finished workout, appended in chronological order
([js/App.js:593](js/App.js:593)). Written by `ExerciseTab.finishWorkout()`
([js/screens/ExerciseTab.js:202](js/screens/ExerciseTab.js:202)).

```json
[
  {
    "id": 8002,
    "routineId": 9002,
    "title": "Demo Legs",
    "startedAt": 1772634600000,
    "finishedAt": 1772637000000,
    "completedSets": 3,
    "totalSets": 5,
    "exercises": [
      {
        "id": 92001, "name": "Squat", "muscle": "Quads",
        "sets": [
          { "reps": 5, "weight": 225, "done": true  },
          { "reps": 5, "weight": 225, "done": true  },
          { "reps": 5, "weight": 225, "done": false }
        ]
      }
    ]
  }
]
```

Contract points that later work must not break:

- **`done` is the unit of truth.** A session is saved whether or not it was
  completed; unfinished sets persist with `done: false` and are *not* stripped.
  `completedSets`/`totalSets` are precomputed counters that must stay consistent with
  the per-set flags.
- `startedAt` / `finishedAt` are epoch milliseconds from `AppTime.nowMs()`. Every
  date bucket the app derives from them (`history` keys, `weeklyMuscles.weekStart`,
  the Mon–Sun report week) is computed in **local** time, so the same instant lands
  in different buckets in different timezones. The literals above are from the
  fixtures as evaluated in `America/Phoenix`.
- `id` is `Date.now()` at finish time — unique in practice, not guaranteed.
- **`ex.muscle` is a display label** (`"Quads"`), produced by `categoryLabel()`. It is
  presentational. Real muscle attribution goes through `EXERCISE_MUSCLE[ex.name]`,
  keyed by exercise **name** and returning a lowercase id (`"quads"`). An exercise
  whose name is missing from that map contributes nothing to the muscle tracker.
- `workoutLog` is **never trimmed**. It grows without bound; only `history` (90 days)
  and `recentFoods` (5) have caps.

#### Optional per-set metadata (Milestone 2)

A performed set may additionally carry any of four **optional, user-reported**
fields. Full contract: [SET_METADATA.md](SET_METADATA.md); code:
[js/utils/setMetadata.js](js/utils/setMetadata.js).

```json
{ "reps": 5, "weight": 185, "done": true,
  "rir": 2,
  "side": "bilateral",
  "tempo": { "eccentricSeconds": 3, "pauseSeconds": 1, "concentricSeconds": 1 },
  "rom": "full" }
```

| Field | Allowed | Notes |
|---|---|---|
| `rir` | integer `0`–`5` | subjective reps-in-reserve estimate |
| `side` | `left` \| `right` \| `bilateral` | recorded from the user's choice, never inferred |
| `tempo` | object; each phase optional; whole seconds `0`–`30` | phases in eccentric / pause-after-eccentric / concentric order |
| `rom` | `partial` \| `standard` \| `full` | self-assessed category, not a measured angle |

- **Absent means not entered.** New writes never encode "unknown" as `0`, `null`,
  `""` or `{}`; clearing a field deletes the key, and clearing the last tempo phase
  deletes `tempo`. `rir: 0` and `pauseSeconds: 0` are recorded zeros.
- **Old sets are never rewritten** to add these keys, and no reader requires them.
- **Writers:** only the active-workout view, via the helpers in
  [js/utils/workoutSession.js](js/utils/workoutSession.js) → `finishWorkout()` →
  `logCompletedWorkout()` → the existing `workoutLog` effect. Nothing else writes
  them; routines (§4 `routines`) never carry them.
- **Readers:** the Calendar day panel's set recap shows a compact summary
  (`formatSetMetadataSummary`) and hides it when absent. Every other reader
  (`weeklyMuscles` rollup, weekly report, progression, lift history, TissueOS)
  ignores the fields. Malformed values are read as unavailable, not deleted.
- **`completedSets`/`totalSets` and `done` semantics are unchanged.** An incomplete
  set persists with `done: false` *and* whatever metadata was entered.
- **No schema bump.** These are additive optional keys on an existing value that
  older readers ignore; `SCHEMA_VERSION` stays `1` and no migration was added.

### `weeklyMuscles`

Derived rollup for the muscle tracker, rebuilt each Monday.

```json
{
  "weekStart": "2026-03-02",
  "dates":    { "chest": ["2026-03-02", "2026-03-06"] },
  "sessions": { "chest": [ { "id": 8001, "title": "Demo Push", "finishedAt": 1772503500000 } ] },
  "sets":     { "chest": 6, "shoulders": 4, "quads": 2 }
}
```

- `weekStart` is the Monday 00:00 local key. `rolloverWeeklyMuscles()` resets the
  whole object when `weekStart` no longer matches the current week — this is a
  **derived cache, not a historical record**; last week's numbers are discarded.
  `workoutLog` remains the durable history.
- `sets[muscle]` counts only sets with `done: true`.
- ⚠️ **Known inconsistency:** the mid-session rollover at
  [js/App.js:407](js/App.js:407) writes `{ weekStart, counts: {}, sessions: {} }` — `counts`
  is not part of the schema, and `dates`/`sets` are omitted. It is harmless today
  because `rolloverWeeklyMuscles()` normalises missing members to `{}` on read and a
  fresh week is empty anyway, so no data is lost; the only effect is a stray unused
  `counts` key. Pre-existing; deliberately not changed in Milestone 0.

### `history` — daily nutrition snapshots

```json
[
  { "date": "Mon Mar 02 2026", "calories": 2850, "protein": 165,
    "carbs": 310, "fats": 82, "sodium": 2300 }
]
```

`date` is `Date.toDateString()`. One entry per day, upserted by date
([js/App.js:374](js/App.js:374)); `saveHistory()` keeps the **last 90** entries.

### `intake` / `meals` — today only

`intake` holds the `EMPTY_INTAKE` nutrient keys as running totals. `meals` is the
day's log:

```json
[ { "id": 7001, "name": "Demo Oats & Whey", "time": "08:15",
    "period": "breakfast", "calories": 520, "protein": 42, "carbs": 70, "fats": 10 } ]
```

Both are **cleared at day rollover** — see §5.

### `routines`

Same shape as a session's `exercises`, but sets carry only `{ reps, weight }`; `done`
appears when `startRoutine()` copies them into an active session. Routine sets never
carry the Milestone 2 metadata fields; `startSessionFromRoutine()` copies `reps` and
`weight` only, so a new workout never inherits a previous session's RIR / side /
tempo / ROM.

---

## 5. Behaviour that surprises people

**`loadDaily()` writes.** Despite the name, it compares `pq_<email>_date` against
today and, on a mismatch, **removes `intake` and `meals`** and stamps the new date
([js/utils/storage.js](js/utils/storage.js)). It is the day-rollover mechanism. Today's
nutrition is intentionally ephemeral; the durable record is the `history` snapshot
written before rollover. Anything that merely wants to *inspect* storage must not
call `loadDaily()`.

**Dev Mode suppresses all writes.** With Dev Mode on (`AppTime.getDevMode()`), every
persistence effect in App.js is skipped and changes live only in memory, restored
from a snapshot when Dev Mode is switched off ([js/App.js:355](js/App.js:355)). Dev Mode is
a separate mechanism from the `?dev=1` flag used by `isDevMode()`.

**Reload survival.** On boot, `pq_last_email` → `loadUser()`; if a profile exists the
app restores profile, intake, meals, history, routines, workoutLog, weeklyMuscles and
setTargets, then renders ([js/App.js:326](js/App.js:326)). Workout history and nutrition
history survive reloads and profile switches because they are plain keyed values and
nothing clears them except the day-rollover (intake/meals) and the week-rollover
(weeklyMuscles).

**Not persisted at all** — lost on reload by design:

- the **in-progress workout** (`active` in ExerciseTab: exercises, per-set `done`
  toggles, `startedAt`, and — since Milestone 2 — any per-set RIR / side / tempo /
  ROM typed so far). Only finished sessions reach storage; there is no draft autosave.
- toast state, the selected tab, scroll positions, the weekly check-in prompt.

---

## 6. Missing, malformed, older and newer data

| Situation | Behaviour |
|---|---|
| Key absent | Caller's default is returned. Every reader supplies one. |
| Value is `null` after parse | Treated as absent. |
| **Malformed JSON** | `get()` returns the default, emits **one** toast per key per session, and **leaves the raw value on disk**. Direct `JSON.parse` readers in App.js fall back to their literal default, also without deleting. The raw bytes are additionally copied to `<key>__corrupt` — see below. |
| `localStorage` throws (Safari private mode, disabled storage) | Every access is wrapped in `try/catch`; the app runs in-memory. |
| Quota exceeded on write | `set()` prunes the oldest entry from the longest `pq_*_history` array, retries once, then toasts and returns `false`. |
| Older / unversioned data | Read as-is. Pre-v1 data was written in exactly the shape v1 reads. |
| Unknown fields | Preserved. Nothing whitelists keys or rebuilds objects from a schema. |
| Unrelated keys | Untouched. Migrations only address keys they explicitly own. |
| **Newer** `pq_schema_version` than the build | Left alone. `runMigrations()` returns an error report and refuses to downgrade; `importAll()` rejects a newer payload outright. |

### Malformed data is never destroyed

Two separate mechanisms are needed here, because a malformed value was at risk from
two different directions.

**1. Reads no longer delete.** Before Milestone 0, `get()` called `removeItem()` on a
parse failure — a single corrupted byte destroyed the value outright. `get()` is now
strictly read-only: it returns the caller's default and warns once per key.

**2. The passive write-back no longer replaces.** That alone was not enough. App.js's
persistence effects fire on mount and write the current in-memory value back — and
for a key whose read just failed, that value *is* the fallback. Merely opening the app
would have overwritten the malformed bytes with `{}` or `[]`.

So both profile-load paths — boot restore ([js/App.js:330](js/App.js:330)) and login
([js/App.js:799](js/App.js:799)) — call `quarantineProfile(email, passiveFallbacks())`
**before** `loadUser()`. For every key that will not parse, that:

- copies the raw bytes to `<key>__corrupt` (a recovery sidecar), and
- **write-protects the key** against exactly one payload: the serialized fallback
  App.js declared for it.

`set()` then suppresses a write whose payload equals that registered fallback — the
passive write-back becomes a no-op and the original bytes stay put. **Any other
payload is a genuine user edit**: it releases the protection and writes through
normally. The result is the intended split:

```
open the app            → malformed bytes untouched, UI renders from a safe fallback
open it again, and again→ still untouched (idempotent)
user edits that key     → protection released, value replaced as usual
```

The declared fallbacks live in `passiveFallbacks()` in [js/App.js:100](js/App.js:100),
mirroring the literal defaults used by the state initialisers, `loadDaily()` and
`loadHistory()`. A test parses App.js and fails if any `sv(email, "…")` writer lacks a
declared fallback, so adding a new persistence effect cannot silently opt a key out.

**`profile` is deliberately exempt** from protection (though still quarantined): a
malformed profile makes `loadUser()` return `null`, the app routes to onboarding, and
the app never reaches the screen where that effect runs. Protecting it would suppress
the user's onboarding write, which must land.

**The day rollover was the last hole.** `loadDaily()` used to `remove()` `intake` and
`meals` unconditionally on a date change, which destroyed malformed values as routine
housekeeping. It now uses `removeIfReadable()`, which declines to discard anything it
could not parse. In-memory behaviour is unchanged — a new day still starts empty.

`get()` itself deliberately neither quarantines nor protects, so reads, diagnostics
and tests stay free of side effects.

Sidecar keys are `pq_`-prefixed, so **Export Data carries them** alongside the
originals.

### Which keys are written back eagerly

This matters because it determines which keys were exposed to the overwrite. Counting
precisely:

| Writer class | Keys | Count |
|---|---|---|
| **Eager** — writes on mount with the value from the initial read | `profile`, `intake`, `meals`, `routines`, `workoutLog`, `weeklyMuscles`, `setTargets` | **7** |
| Conditionally eager — gated on `intake.calories !== 0` | `history` | 1 |
| Explicit action only | `recentFoods` (logging food), `planDrafts` (editing a plan) | 2 |

`quarantineProfile()` sweeps all ten `PROFILE_KEY_SUFFIXES` regardless of class, so
coverage does not depend on getting this classification right. The raw-string keys
(`date`, `lastCheckin`) are not JSON and cannot be malformed, so they are out of scope.

**What is still not covered:** nothing repairs a quarantined key automatically, and
nothing surfaces one in the UI beyond a single toast. A corrupted value still costs
the user that key's data in the running app — the guarantee is that the original bytes
survive, at the original key, and are recoverable.

## 7. Schema versioning and migrations

`pq_schema_version` holds a single integer for the whole storage layer. There is **no
per-key or per-record version**, and values are stored bare — no `{version, data}`
envelope — so direct `JSON.parse(getItem(...))` call sites keep working.

`runMigrations()` runs once at boot, before React mounts ([js/App.js:1168](js/App.js:1168)),
and walks the `MIGRATIONS` list in order:

```js
export const MIGRATIONS = [
  { to: 1, describe: "Stamp the baseline version. Values are already in v1 shape.",
    run: function () { return true; } }
];
```

Guarantees (each covered by a test in [test/storage.test.js](test/storage.test.js)):

1. **Idempotent** — re-running applies nothing; records are byte-identical afterwards.
2. **No false advance** — the version is committed *after* each step succeeds. If a
   step throws, or the sentinel write itself fails, the runner stops and the on-disk
   version stays where it was, so the next boot retries.
3. **No downgrade** — a version above `SCHEMA_VERSION` is left untouched.
4. **Non-destructive** — v1 performs no transform; unversioned data is stamped, not
   rewritten.
5. **Profile-agnostic** — the version is global; migrations that touch profile data
   must iterate keys themselves and stay within each profile's namespace.

### Adding v2

1. Append a step to `MIGRATIONS`:

   ```js
   { to: 2,
     describe: "…",
     run: function () {
       // Idempotent and additive. Throw (or return false) on failure so the
       // runner does not stamp v2. Never delete keys you do not own, and
       // never drop unknown fields inside keys you do.
     } }
   ```
2. Bump `SCHEMA_VERSION` to `2`.
3. Add tests: applied once from v1, no-op on re-run, older data still readable,
   unrelated keys preserved, failure leaves the version at 1.

Installs sitting at v1 replay only the v2 step; a fresh install runs v1 then v2 in
order. `importAll()` stamps the version the *imported data* was written at and then
calls `runMigrations()`, so an older export is upgraded rather than over-stamped.

**Milestone 0 deliberately does not define a TissueOS storage format.** No key,
field, or version has been reserved for it. Tissue data should arrive as its own
migration step when Milestone 1 actually needs it.

**Milestone 2 did not bump the version.** The optional per-set fields (§4) are
additive keys inside an existing value; readers that predate them ignore them and
readers that know them treat absence as "not entered", so no transform exists for a
migration to perform. A version bump is reserved for a change in how bytes are laid
out, not for new optional keys.

---

## 8. Export / import

`exportAll()` snapshots **every** `pq_*` key in `localStorage` as raw strings:

```json
{ "schemaVersion": 1,
  "exportedAt": "2026-03-02T18:00:00.000Z",
  "data": { "pq_demo-a@example.com_profile": "{\"age\":27,…}" } }
```

Because it is prefix-based, an export carries **all profiles on the device**, plus
theme, dev-mode flags and the food-search cache. `importAll()` writes back any
`pq_*` key, rejects a payload with a missing or newer `schemaVersion`, and merges
rather than replaces — existing keys not present in the payload survive.

---

## 9. Verifying this contract

```bash
npm test
```

[test/storage.test.js](test/storage.test.js) and [test/devSeed.test.js](test/devSeed.test.js) cover
migration idempotency, unversioned reads, downgrade refusal, failed writes, malformed
data, profile isolation, unknown-field preservation, completed-vs-incomplete set
semantics, and nutrition data surviving migration. They run against an in-memory
`localStorage` stub ([test/helpers/localStorageStub.js](test/helpers/localStorageStub.js)) and
never touch real browser storage.

[test/setMetadata.test.js](test/setMetadata.test.js),
[test/workoutSession.test.js](test/workoutSession.test.js) and
[test/tissueLoadInvariance.test.js](test/tissueLoadInvariance.test.js) (Milestone 2)
cover the optional per-set metadata: parsing and validation, immutable updates,
the production session lifecycle, the `workoutLog` round-trip through `sv()`/`get()`
and export/import, profile isolation, legacy history, and that the tissue-load model's
outputs are unchanged by the new fields.

Deterministic fixtures live in [js/dev/demoFixtures.js](js/dev/demoFixtures.js).
Profile B's log includes `DEMO_SESSION_METADATA_B`, the one fixture that carries
per-set metadata; profile A's history is deliberately still metadata-free.

**The seeder is not in the production bundle.** It is a separate esbuild entry point
([js/dev/seedEntry.js](js/dev/seedEntry.js)) that is only compiled — and only
referenced from the emitted HTML — by a development build:

```bash
npm run build      # production: no dist/dev-seed.js, no script tag, no fixtures
npm run build:dev  # development: also emits dist/dev-seed.js and links it
npm run dev        # same, with watch
```

A separate entry point rather than a runtime flag or a guarded import, so that its
absence from the shipped app does not depend on dead-code elimination succeeding.
Verified: a production build serves `dev-seed.js` as 404 and exposes no seed handle
even when loaded with `?dev=1`.

In a development build, open the app with `?dev=1` and run:

```js
window.__physiqSeed.status()   // which demo profiles exist — read-only
window.__physiqSeed.seed()     // writes demo-a@ / demo-b@; refuses to overwrite
window.__physiqSeed.clear()    // removes demo keys only
```

Loading `dev-seed.js` seeds nothing by itself — it only installs the handle, and only
when `?dev=1` is present. `seed()` skips any demo profile that already exists, and
every read and write is guarded by `assertDemoKey()`, which throws on any key outside
the two reserved `@example.com` namespaces.
