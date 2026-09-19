# Tissue Load Map — Milestone 3

Tissue Load visualizes modeled tissue-specific training workload from completed
workout sets. Open **+ → Exercise → Tissue Load**, beside **Training Volume**.
The existing Weekly Muscle Tracker stays mounted with its original calculations,
colors, targets and selection. Recovery Tracker remains a separate, unchanged card.

## Model quantity and limits

The committed **`tissue-load-v0.1`** model returns unbounded workload in
**`lb*rep`** (pound-reps), using **`exercise-tissue-map-v0.1`**.
The UI shows that raw quantity, with up to the engine's six decimal places;
there is no score, upper bound, percentage, or cross-user comparison.
Contributors are shown in the same unit, not as percentages.

This is a heuristic based on provisional coefficients, not measured tissue force,
stress, strain, damage, injury probability, recovery, readiness, capacity, medical
status or safety. Nothing recommends what to train. The model is unvalidated,
covers only 25 exercise names, and uses coarse body-mass assumptions. RIR, side,
tempo and ROM remain source metadata and do not affect v0.1. See the frozen
[domain contract](js/tissue/README.md) and [metadata contract](SET_METADATA.md).

**Body mass changed in Milestone 4.** Milestone 3 used the *current* profile
weight for every historical workout, so old numbers moved whenever the athlete
logged a new weight. Each workout now carries a frozen body mass in its
[tissue-history-v1 record](TISSUE_LOAD_HISTORY.md): the latest logged weight on
or before that day, else the profile weight at the time the record was made,
else nothing — in which case the domain's 180 lb fallback and Low confidence
apply exactly as before. The period view here consumes that frozen value, so
this screen no longer drifts with the profile.

## Periods and dates

**Today** is the default: local midnight inclusive to next midnight exclusive.
**This week** is Monday 00:00 through the following Monday exclusive, matching
Physiq's existing `getWeekStart` and Weekly Muscle Tracker semantics. These are
calendar periods, not rolling 7/28-day windows. Calendar arithmetic handles DST.

The pure adapter takes an explicit `now`; the component supplies `AppTime.now()`,
including the existing development date feature. While open, a minute timer and
focus/visibility listeners refresh the day. The history scan is memoized by
history reference, body mass, period and local calendar day, not tissue selection.
History is unbounded in the existing storage contract; only selected-period
sessions are sent to the engine. No cache is shared across profiles.

Only saved records with a valid finite numeric `finishedAt` are dated. Missing,
string, nonfinite and out-of-Date-range timestamps are excluded and counted in a
visible **period unknown** message. We deliberately do not infer completion from
`startedAt`, and never rewrite old records. Malformed/missing arrays are tolerated.
Stored `completedSets` counters are not trusted: only strict `done === true` counts.

## Presentation-only intensity

```
displayIntensity = tissue.totalWorkload / maximumTissueWorkloadInSelectedPeriod
```

The maximum is across all twelve tissue definitions, including list-only tendons.
If the maximum is zero, every intensity is zero. The result is bounded `[0,1]`,
and **display intensity is not a scientific model output**. It lives only in the
presentation adapter and is never returned by or passed back into the domain.
Raw workload stays separate and unbounded.

A darker region means more modeled workload relative to other modeled tissues in
the selected view, not greater injury risk. Even the largest contribution from a
tiny workout receives maximum intensity. This explanation and a neutral purple
legend are visible next to the map. There are no safe/caution/danger color bands.

## Anatomy and interaction

The existing MuscleTracker SVG paths are reused without changing their geometry:

| View | Tissue definitions with existing shapes |
| --- | --- |
| Front | Chest, shoulders, biceps, core, quadriceps (`quads` region) |
| Back | Back, shoulders, triceps, glutes, hamstrings, calves |
| List only | Patellar tendon, Achilles tendon |

The paths are coarse, bilateral muscle-group illustrations, not precise anatomy
or measured laterality. Neither tendon has suitable existing geometry. They stay
visible in **Other modeled tissues**, with identical detail access. No knee,
quadriceps, calf or ankle shape is relabeled as a tendon. `physiqMuscle` provides
the explicit geometry association; a future geometry renderer can be extended
without changing workload aggregation.

Tendon detail states **provisional mechanical relevance**, not an estimated tendon
force/stress fraction. Every tendon assumption remains Low confidence.

Map regions support click, Enter and Space, accessible names, pressed state and a
selection outline. Native buttons in the expandable muscle list also reach every
region without relying on SVG or small touch targets. Tendon buttons are always
available. Detail is inline, never hover-only. Mode/period/front-back controls are
native buttons with `aria-pressed`; selected list items say “Selected.”

## Contributors, confidence and coverage

The adapter calls the committed session engine. Each tissue's total and exercise
contributions are canonical sums of its **events**, using event provenance and
the engine-resolved exercise name. Repeated appearances, including case/whitespace
variants recognized by the engine, combine across sessions. Contributors sort by
descending workload, then code-point exercise-name order for stable ties. Totals
use the same six-decimal rounding precision as the engine.

Confidence uses the existing `combineConfidence`: the weakest event confidence
across the period. Low means a placeholder-quality assumption; Medium a coarse
relationship; High is reserved and unused in v0.1. Categories express trust in
model assumptions/mapping, not accuracy percentages or permission to train. More
sets never upgrade confidence. No contributing events means no confidence.

Coverage is **mapped completed sets / all completed sets** in the selected period,
using the engine's exercise summaries. It is not accuracy. Unmapped exercise names
with completed sets are inspectable; incomplete-only exercises do not dilute
coverage. Invalid rep/weight warnings surface the engine's zero substitution.

Distinct states:

- No dated saved workouts: invitation to complete a workout.
- Saved workouts but no completed sets: only completed sets contribute.
- Completed sets, all unmapped: workload unknown, model does not cover activity.
- Partially mapped: show modeled results alongside coverage and unmapped names.
- No events for a tissue: gray/dashed map and “No modeled contribution.” This is
  not zero biological load.
- Mapped events with numeric zero: light purple and explicit zero workload with
  provenance; detail explains that this still does not establish biological zero.

## Persistence and milestone boundary

The view reads the active profile's already-loaded `workoutLog`, the reconciled
`tissueHistory`, and `profile.weight` as the fallback for any workout that has
no history entry yet. It never imports storage, writes records, or mutates
inputs — reconciliation happens in the application layer
([js/utils/tissueHistoryStore.js](js/utils/tissueHistoryStore.js)), invoked from
App.js at the `workoutLog` persistence boundary, never from a render.
Schema remains **1**. Milestone 4 adds one profile-scoped derived key,
`pq_<email>_tissueHistory`, with its own string version `tissue-history-v1`;
no TissueOS event store and no model change are introduced.
The two Exercise entry points receive active-profile state and are keyed by email.
Opening/selecting the view does not trigger existing persistence effects; tests
compare storage before/after. The app's existing boot/writeback behavior is unchanged.

Personal baselines, stored/rolling exposure and longitudinal comparisons arrived in
**Milestone 4** — see [TISSUE_LOAD_HISTORY.md](TISSUE_LOAD_HISTORY.md). They live in
the selected tissue's detail panel; the body map keeps its Milestone 3 meaning
(relative concentration within the selected period) and is never recoloured by
baseline deviation. Recovery-model replacement belongs to **Milestone 5** and has
not started. The five domain JS files, golden JSON, metadata and workout lifecycle
remain unchanged.

The Milestone 1 test that prohibited *any* app import of TissueOS is intentionally
updated for this milestone: only the pure presentation adapter may import the
domain. The framework/storage/clock ban inside `js/tissue/` remains enforced.

## Verification commands

```sh
node --test test/tissueLoadView.test.js test/tissueLoadUi.test.js
node --test test/tissueLoadInvariance.test.js
TZ=America/Phoenix node --test test/tissueLoadView.test.js
TZ=America/New_York node --test test/tissueLoadView.test.js
TZ=UTC node --test test/tissueLoadView.test.js
npm test
npm run build
```

The optional browser harness uses an environment-provided Playwright installation
and Chrome. It creates a fresh browser context, serves only the requested build
on loopback, and seeds only synthetic `demo-a@example.com` / `demo-b@example.com`
profiles. It never connects to an existing browser profile. No dependency or large
testing framework was added to the application.

```sh
PLAYWRIGHT_MODULE=/absolute/path/to/playwright/index.mjs \
  node test/browser/tissueLoad.browser.mjs dist production
```

Use `npm run build:dev` and label `development` to exercise the development bundle;
finish with `npm run build` so committed generated files remain production assets.
Browser screenshots/results go to `/tmp/physiq-m3-browser-<label>/`.
See [the verification report](MILESTONE_3_VERIFICATION.md) for this run's baseline,
results, artifact hashes and remaining limitations.
