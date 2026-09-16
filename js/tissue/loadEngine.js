/* ─── TissueOS — set / session workload engine (tissue-load-v0.1) ─────────
 *
 * Pure functions. No React, no DOM, no storage, no clock. Same input →
 * same output, and inputs are never mutated.
 *
 * ── What this computes ───────────────────────────────────────────────────
 *
 *   effectiveLoad = externalWeight + bodyMassBandValue(band) × bodyMass
 *   setWorkload   = reps × effectiveLoad
 *   workload[t]   = setWorkload × coefficient[exercise][t]
 *
 * ── The output is DIMENSIONAL, not normalized ────────────────────────────
 * `workload` has the dimension of weight × repetitions, expressed in
 * CANONICAL_WEIGHT_UNIT (pounds) × reps — see WORKLOAD_UNIT. It is a raw
 * training-volume quantity scaled by a dimensionless relative coefficient.
 *
 * It is NOT normalized. Nothing here divides by a maximum, a baseline or a
 * capacity, so there is no 0–100 score, no percentage, and no upper bound
 * (WORKLOAD_SCALE is "unbounded"). Normalization against an athlete's own
 * history is Milestone 4 work and deliberately absent. Every result carries
 * `workloadUnit` and `scale` so a UI layer cannot mistake a raw 1800 for
 * "1800 out of 100"; the field is called `workload`, never `score`.
 *
 * ── Input unit contract ──────────────────────────────────────────────────
 * Physiq stores `weight` as a bare number with no unit metadata. The app's
 * canonical unit is POUNDS: js/utils/calculations.js converts the profile
 * weight with `* 0.453592` (lb → kg), onboarding asks for "Weight (lbs)",
 * and both CalendarTab and WeeklyReportScreen render set weights with a
 * hard-coded "lb" suffix. There is no unit selector anywhere.
 *
 * So the engine consumes pounds by default, and that default is the app's
 * actual contract rather than a guess. A caller holding data in another
 * unit must say so with `context.weightUnit`, which is converted to pounds
 * before any arithmetic; an unrecognised unit THROWS rather than being
 * silently treated as pounds. `weightUnit` governs both set weights and
 * `context.bodyMass`, since in Physiq both come from the same convention.
 *
 * Known limitation this cannot fix: Physiq's own set-weight input is
 * unlabelled, so a lifter thinking in kilograms produces records the whole
 * app already mislabels as pounds. That is a pre-existing Physiq issue
 * affecting the Calendar and Weekly Report identically. The engine inherits
 * it and does not pretend otherwise — see README, "Can lb-entered and
 * kg-entered workouts be compared?".
 *
 * ── Inputs used ──────────────────────────────────────────────────────────
 * Only what Physiq already records: `done`, `reps`, `weight`, and the
 * exercise name. Nothing reads RIR, RPE, tempo, range of motion, side or
 * velocity.
 *
 * ── Set-level rules ──────────────────────────────────────────────────────
 *   - A set counts as completed only when `done === true`. Anything else
 *     (false, undefined, "true", 1) produces NO workload and no events.
 *   - A completed set of a mapped exercise produces one entry per mapped
 *     tissue, even when the value is 0, so provenance is retained and
 *     "did nothing" is visible.
 *   - A completed set of an UNMAPPED exercise produces no entries and
 *     status "unmapped" — distinguishable from a mapped exercise whose
 *     coefficient table is empty (status "mapped", zero entries).
 *   - Body mass is applied uniformly via the exercise's band. There is no
 *     "bodyweight exercise" special case, so a squat and a push-up logged
 *     at weight 0 are handled by the same rule.
 *   - If the default body mass had to be assumed, every entry of an
 *     exercise whose band is non-zero has its confidence capped at "low"
 *     and records "default_body_mass".
 *
 * ── Aggregation ─────────────────────────────────────────────────────────
 *   Per-tissue totals are plain sums, taken in a canonical (sorted) order
 *   so floating-point summation cannot depend on exercise order. Per-tissue
 *   confidence is the weakest contributing confidence (see uncertainty.js).
 *   No clamping and no rescaling.
 * ───────────────────────────────────────────────────────────────────────── */

import {
  TISSUE_LOAD_MODEL_VERSION,
  EXERCISE_TISSUE_MAP_VERSION,
  SOURCE_TYPE_WORKOUT_MODEL
} from "./modelVersion.js";
import { resolveExerciseMapping, bodyMassBandValue } from "./exerciseTissueMap.js";
import { combineConfidence, confidenceRank, CONFIDENCE_LOW } from "./uncertainty.js";

/* Physiq's canonical weight unit. See the header for the evidence. */
export const CANONICAL_WEIGHT_UNIT = "lb";

/* Accepted `context.weightUnit` values → multiplier into pounds. Kept
   minimal on purpose: the app offers no unit choice, so this exists to let
   a caller be explicit, not to invite a unit system. */
export const SUPPORTED_WEIGHT_UNITS = Object.freeze({ lb: 1, kg: 2.2046226218 });

/* The dimension of every workload value this engine emits. Not a score,
   not a percentage, not a force. */
export const WORKLOAD_UNIT = "lb*rep";
export const WORKLOAD_SCALE = "unbounded";

/* Reference body mass used when the caller supplies none, in
   CANONICAL_WEIGHT_UNIT. Mirrors DEFAULT_PROFILE.weight in
   js/data/constants.js (a test pins the two together). */
export const DEFAULT_BODY_MASS_REFERENCE = 180;

export const SET_STATUS_MAPPED = "mapped";
export const SET_STATUS_UNMAPPED = "unmapped";

/* Warnings the engine can attach. Strings, so they serialise as-is. */
export const WARN_INVALID_REPS = "invalid_reps";
export const WARN_INVALID_WEIGHT = "invalid_weight";
export const WARN_ZERO_LOAD = "zero_load";
export const WARN_DEFAULT_BODY_MASS = "default_body_mass";
export const WARN_ZERO_REPS = "zero_reps";

/* Number coercion with one rule: finite and >= 0, else null. Numeric
   strings are accepted because older hand-entered data may hold them. */
function nonNegativeFinite(value) {
  const n = typeof value === "number" ? value
          : (typeof value === "string" && value.trim() !== "") ? Number(value)
          : NaN;
  return Number.isFinite(n) && n >= 0 ? n : null;
}

function isCompleted(set) {
  return !!set && set.done === true;
}

function round(n) {
  /* Six decimals is far beyond the meaning of these numbers and keeps
     results stable across platforms. */
  return Math.round(n * 1e6) / 1e6;
}

/* Sum in a canonical order so the result is independent of input order. */
function sumCanonical(values) {
  const sorted = values.slice().sort(function(a, b) { return a - b; });
  let total = 0;
  for (let i = 0; i < sorted.length; i++) total += sorted[i];
  return round(total);
}

/**
 * Multiplier converting the caller's weights into CANONICAL_WEIGHT_UNIT.
 * Throws on an unrecognised unit: a wrong unit silently treated as pounds
 * would corrupt every number downstream, which is exactly the failure this
 * contract exists to prevent.
 */
export function weightUnitFactor(unit) {
  if (unit === undefined || unit === null) return 1;
  if (typeof unit !== "string" || !Object.prototype.hasOwnProperty.call(SUPPORTED_WEIGHT_UNITS, unit)) {
    throw new Error(
      "Unsupported context.weightUnit: " + JSON.stringify(unit) +
      ". Supported: " + Object.keys(SUPPORTED_WEIGHT_UNITS).join(", ") +
      ". Physiq's canonical unit is " + CANONICAL_WEIGHT_UNIT + "."
    );
  }
  return SUPPORTED_WEIGHT_UNITS[unit];
}

/**
 * estimateSetTissueLoad(exercise, set, context)
 *
 * exercise  { name, id? }              — a Physiq workout exercise entry
 * set       { reps, weight, done }     — one of its sets
 * context   { bodyMass?, weightUnit?, exerciseTissueMap? } — optional
 *
 * Returns
 * {
 *   modelVersion, mapVersion, workloadUnit, scale, weightUnit,
 *   exerciseName, mappedName, status, completed,
 *   reps, externalWeight, bodyMassBand, bodyMassFraction, bodyMass,
 *   effectiveLoad, setWorkload,
 *   tissueWorkloads: [ { tissueId, coefficient, workload, confidence } ],
 *   warnings: [ ... ]
 * }
 * All weight-bearing numbers are reported in CANONICAL_WEIGHT_UNIT, after
 * conversion. For an incomplete or unmapped set, `tissueWorkloads` is empty
 * and the numeric fields describe what WOULD have been used, so callers can
 * explain "why nothing".
 */
export function estimateSetTissueLoad(exercise, set, context) {
  const ctx = context || {};
  const factor = weightUnitFactor(ctx.weightUnit);
  const name = exercise && typeof exercise.name === "string" ? exercise.name : "";
  const resolved = resolveExerciseMapping(name, ctx.exerciseTissueMap);
  const warnings = [];

  const rawReps = nonNegativeFinite(set ? set.reps : undefined);
  const rawWeight = nonNegativeFinite(set ? set.weight : undefined);
  if (rawReps === null) warnings.push(WARN_INVALID_REPS);
  if (rawWeight === null) warnings.push(WARN_INVALID_WEIGHT);
  const reps = rawReps === null ? 0 : rawReps;
  const externalWeight = rawWeight === null ? 0 : round(rawWeight * factor);

  const entry = resolved ? resolved.entry : null;
  const band = entry && typeof entry.bodyMass === "string" ? entry.bodyMass : "none";
  const fraction = entry ? bodyMassBandValue(band) : 0;

  let bodyMass = nonNegativeFinite(ctx.bodyMass);
  let usedDefaultBodyMass = false;
  if (bodyMass === null || bodyMass === 0) {
    bodyMass = DEFAULT_BODY_MASS_REFERENCE;
    usedDefaultBodyMass = true;
  } else {
    bodyMass = round(bodyMass * factor);
  }

  const completed = isCompleted(set);
  const effectiveLoad = round(externalWeight + fraction * bodyMass);
  const setWorkload = round(reps * effectiveLoad);

  const result = {
    modelVersion: TISSUE_LOAD_MODEL_VERSION,
    mapVersion: EXERCISE_TISSUE_MAP_VERSION,
    workloadUnit: WORKLOAD_UNIT,
    scale: WORKLOAD_SCALE,
    weightUnit: CANONICAL_WEIGHT_UNIT,
    exerciseName: name,
    mappedName: resolved ? resolved.name : null,
    status: resolved ? SET_STATUS_MAPPED : SET_STATUS_UNMAPPED,
    completed: completed,
    reps: reps,
    externalWeight: externalWeight,
    bodyMassBand: resolved ? band : null,
    bodyMassFraction: fraction,
    bodyMass: fraction > 0 ? bodyMass : null,
    effectiveLoad: effectiveLoad,
    setWorkload: setWorkload,
    tissueWorkloads: [],
    warnings: warnings
  };

  if (!completed || !resolved) return result;

  if (reps === 0) warnings.push(WARN_ZERO_REPS);
  if (effectiveLoad === 0) warnings.push(WARN_ZERO_LOAD);
  if (fraction > 0 && usedDefaultBodyMass) warnings.push(WARN_DEFAULT_BODY_MASS);

  const tissues = entry.tissues || {};
  Object.keys(tissues).sort().forEach(function(tissueId) {
    const spec = tissues[tissueId];
    let confidence = spec.confidence;
    if (fraction > 0 && usedDefaultBodyMass && confidenceRank(confidence) > confidenceRank(CONFIDENCE_LOW)) {
      confidence = CONFIDENCE_LOW;
    }
    result.tissueWorkloads.push({
      tissueId: tissueId,
      coefficient: spec.coefficient,
      workload: round(setWorkload * spec.coefficient),
      confidence: confidence
    });
  });

  return result;
}

/**
 * estimateSessionTissueLoad(session, context)
 *
 * session  a Physiq workoutLog entry (or the in-memory active session):
 *          { id?, title?, startedAt?, finishedAt?, exercises: [ { id?, name, sets } ] }
 * context  as for estimateSetTissueLoad
 *
 * Returns
 * {
 *   modelVersion, mapVersion, sourceType, workloadUnit, scale, weightUnit,
 *   sessionId, title, startedAt, finishedAt,
 *   events: [ {                       // one per (completed set x mapped tissue)
 *     tissueId, workload, workloadUnit, confidence, modelVersion, sourceType, timestamp,
 *     provenance: { sessionId, exerciseId, exerciseName, exerciseIndex, setIndex }
 *   } ],
 *   tissues: { [tissueId]: {          // aggregated, keys sorted
 *     tissueId, totalWorkload, eventCount, confidence,
 *     contributors: [ { exerciseName, exerciseIndex, workload, setCount } ]
 *   } },
 *   exercises: [ { exerciseIndex, exerciseId, exerciseName, mappedName, status,
 *                  completedSets, incompleteSets, warnings } ],
 *   unmappedExercises: [ names ],     // deduplicated, in first-seen order
 *   warnings: [ ... ]                 // deduplicated union of set warnings
 * }
 *
 * Events are shaped to become TissueLoadEvents later; nothing is persisted
 * and no ids are minted here.
 */
export function estimateSessionTissueLoad(session, context) {
  const s = session || {};
  weightUnitFactor((context || {}).weightUnit); // fail fast, even for an empty session
  const sessionId = s.id === undefined ? null : s.id;
  const timestamp = Number.isFinite(s.finishedAt) ? s.finishedAt
                  : Number.isFinite(s.startedAt) ? s.startedAt : null;

  const events = [];
  const exerciseSummaries = [];
  const unmapped = [];
  const warningSet = {};

  const exercises = Array.isArray(s.exercises) ? s.exercises : [];
  exercises.forEach(function(ex, exerciseIndex) {
    const exercise = ex || {};
    const sets = Array.isArray(exercise.sets) ? exercise.sets : [];
    const summary = {
      exerciseIndex: exerciseIndex,
      exerciseId: exercise.id === undefined ? null : exercise.id,
      exerciseName: typeof exercise.name === "string" ? exercise.name : "",
      mappedName: null,
      status: SET_STATUS_UNMAPPED,
      completedSets: 0,
      incompleteSets: 0,
      warnings: []
    };
    const exWarn = {};

    sets.forEach(function(set, setIndex) {
      const r = estimateSetTissueLoad(exercise, set, context);
      summary.mappedName = r.mappedName;
      summary.status = r.status;
      if (!r.completed) { summary.incompleteSets++; return; }
      summary.completedSets++;
      r.warnings.forEach(function(w) { exWarn[w] = true; warningSet[w] = true; });
      r.tissueWorkloads.forEach(function(tw) {
        events.push({
          tissueId: tw.tissueId,
          workload: tw.workload,
          workloadUnit: WORKLOAD_UNIT,
          confidence: tw.confidence,
          modelVersion: r.modelVersion,
          sourceType: SOURCE_TYPE_WORKOUT_MODEL,
          timestamp: timestamp,
          provenance: {
            sessionId: sessionId,
            exerciseId: summary.exerciseId,
            exerciseName: summary.exerciseName,
            exerciseIndex: exerciseIndex,
            setIndex: setIndex
          }
        });
      });
    });

    if (sets.length === 0) {
      /* No sets at all: still classify, so an empty exercise is explainable. */
      const probe = estimateSetTissueLoad(exercise, null, context);
      summary.mappedName = probe.mappedName;
      summary.status = probe.status;
    }
    summary.warnings = Object.keys(exWarn).sort();
    if (summary.status === SET_STATUS_UNMAPPED && unmapped.indexOf(summary.exerciseName) < 0) {
      unmapped.push(summary.exerciseName);
    }
    exerciseSummaries.push(summary);
  });

  /* Aggregate per tissue. */
  const byTissue = {};
  events.forEach(function(ev) {
    const t = byTissue[ev.tissueId] || (byTissue[ev.tissueId] = { loads: [], confidences: [], byExercise: {} });
    t.loads.push(ev.workload);
    t.confidences.push(ev.confidence);
    const key = ev.provenance.exerciseIndex;
    const contrib = t.byExercise[key] || (t.byExercise[key] = {
      exerciseName: ev.provenance.exerciseName, exerciseIndex: key, loads: [], setCount: 0
    });
    contrib.loads.push(ev.workload);
    contrib.setCount++;
  });

  const tissues = {};
  Object.keys(byTissue).sort().forEach(function(tissueId) {
    const t = byTissue[tissueId];
    tissues[tissueId] = {
      tissueId: tissueId,
      totalWorkload: sumCanonical(t.loads),
      eventCount: t.loads.length,
      confidence: combineConfidence(t.confidences),
      contributors: Object.keys(t.byExercise)
        .map(function(k) { return t.byExercise[k]; })
        .sort(function(a, b) { return a.exerciseIndex - b.exerciseIndex; })
        .map(function(cx) {
          return {
            exerciseName: cx.exerciseName,
            exerciseIndex: cx.exerciseIndex,
            workload: sumCanonical(cx.loads),
            setCount: cx.setCount
          };
        })
    };
  });

  return {
    modelVersion: TISSUE_LOAD_MODEL_VERSION,
    mapVersion: EXERCISE_TISSUE_MAP_VERSION,
    sourceType: SOURCE_TYPE_WORKOUT_MODEL,
    workloadUnit: WORKLOAD_UNIT,
    scale: WORKLOAD_SCALE,
    weightUnit: CANONICAL_WEIGHT_UNIT,
    sessionId: sessionId,
    title: typeof s.title === "string" ? s.title : null,
    startedAt: Number.isFinite(s.startedAt) ? s.startedAt : null,
    finishedAt: Number.isFinite(s.finishedAt) ? s.finishedAt : null,
    events: events,
    tissues: tissues,
    exercises: exerciseSummaries,
    unmappedExercises: unmapped,
    warnings: Object.keys(warningSet).sort()
  };
}
