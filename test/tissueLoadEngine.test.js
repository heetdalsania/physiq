/* ─── Tests — TissueOS workload engine (tissue-load-v0.1) ─────────────────
 *
 * Fixed synthetic inputs only. Reuses the Milestone 0 workout fixtures so
 * the engine is exercised against the exact shape the app persists.
 * ───────────────────────────────────────────────────────────────────────── */

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  estimateSetTissueLoad, estimateSessionTissueLoad, weightUnitFactor,
  DEFAULT_BODY_MASS_REFERENCE, CANONICAL_WEIGHT_UNIT, SUPPORTED_WEIGHT_UNITS,
  WORKLOAD_UNIT, WORKLOAD_SCALE,
  WARN_INVALID_REPS, WARN_INVALID_WEIGHT, WARN_ZERO_LOAD,
  WARN_DEFAULT_BODY_MASS, WARN_ZERO_REPS
} from "../js/tissue/loadEngine.js";
import { EXERCISE_TISSUE_MAP, BODY_MASS_BANDS } from "../js/tissue/exerciseTissueMap.js";
import { TISSUE_LOAD_MODEL_VERSION, EXERCISE_TISSUE_MAP_VERSION } from "../js/tissue/modelVersion.js";
import { isTissueId } from "../js/tissue/tissueDefinitions.js";
import { isValidConfidence } from "../js/tissue/uncertainty.js";
import { DEFAULT_PROFILE } from "../js/data/constants.js";
import {
  DEMO_SESSION_COMPLETE, DEMO_SESSION_PARTIAL, DEMO_ACTIVE_SESSION, DEMO_SESSION_B
} from "../js/dev/demoFixtures.js";

const SQUAT = { id: 92001, name: "Squat", muscle: "Quads" };
const SQ = EXERCISE_TISSUE_MAP["Squat"].tissues;
const SQUAT_BAND = BODY_MASS_BANDS[EXERCISE_TISSUE_MAP["Squat"].bodyMass];   // "most" → 0.75
const RDL = EXERCISE_TISSUE_MAP["Romanian Deadlift"].tissues;
const RDL_BAND = BODY_MASS_BANDS[EXERCISE_TISSUE_MAP["Romanian Deadlift"].bodyMass]; // "half" → 0.5

const BM = 180;   // explicit body mass used throughout, in pounds

function clone(x) { return JSON.parse(JSON.stringify(x)); }
function workloadOf(result, tissueId) {
  const hit = result.tissueWorkloads.filter(function(l) { return l.tissueId === tissueId; })[0];
  return hit ? hit.workload : undefined;
}
/* Walk any value and fail on NaN / ±Infinity anywhere. */
function assertAllFinite(value, path) {
  if (typeof value === "number") { assert.ok(Number.isFinite(value), (path || "") + " = " + value); return; }
  if (value && typeof value === "object") {
    Object.keys(value).forEach(function(k) { assertAllFinite(value[k], (path || "") + "." + k); });
  }
}

// ── Set calculation ─────────────────────────────────────────────────────

test("a completed set produces deterministic, explainable output", function() {
  const r = estimateSetTissueLoad(SQUAT, { reps: 5, weight: 225, done: true }, { bodyMass: BM });
  assert.equal(r.status, "mapped");
  assert.equal(r.completed, true);
  assert.equal(r.modelVersion, TISSUE_LOAD_MODEL_VERSION);
  assert.equal(r.mapVersion, EXERCISE_TISSUE_MAP_VERSION);
  assert.equal(r.mappedName, "Squat");
  assert.equal(r.bodyMassBand, "most");
  assert.equal(r.bodyMassFraction, SQUAT_BAND);
  assert.equal(r.effectiveLoad, 225 + SQUAT_BAND * BM);        // 360
  assert.equal(r.setWorkload, 5 * (225 + SQUAT_BAND * BM));    // 1800
  assert.equal(workloadOf(r, "quadriceps"), 1800 * SQ.quadriceps.coefficient);
  assert.equal(workloadOf(r, "glutes"), 1800 * SQ.glutes.coefficient);
  assert.equal(workloadOf(r, "patellar_tendon"), 1800 * SQ.patellar_tendon.coefficient);
  assert.equal(r.tissueWorkloads.length, Object.keys(SQ).length);
  assert.deepEqual(r.tissueWorkloads.map(function(l) { return l.tissueId; }), Object.keys(SQ).sort(),
    "tissue order is canonical");
  r.tissueWorkloads.forEach(function(l) {
    assert.ok(isTissueId(l.tissueId));
    assert.ok(isValidConfidence(l.confidence));
    assert.equal(l.confidence, SQ[l.tissueId].confidence);
    assert.equal(l.coefficient, SQ[l.tissueId].coefficient);
  });
  assert.deepEqual(r.warnings, []);
  assert.deepEqual(r, estimateSetTissueLoad(SQUAT, { reps: 5, weight: 225, done: true }, { bodyMass: BM }));
});

test("an incomplete set produces no workload, whatever 'done' looks like", function() {
  [false, undefined, null, 0, 1, "true", "yes", {}].forEach(function(done) {
    const r = estimateSetTissueLoad(SQUAT, { reps: 5, weight: 225, done: done }, { bodyMass: BM });
    assert.equal(r.completed, false, "done=" + String(done));
    assert.deepEqual(r.tissueWorkloads, []);
    assert.equal(r.status, "mapped", "mapping is still reported so the UI can explain");
    assert.equal(r.setWorkload, 1800, "what would have counted is still visible");
  });
  const routineSet = estimateSetTissueLoad(SQUAT, { reps: 5, weight: 225 }, { bodyMass: BM });
  assert.equal(routineSet.completed, false);
  assert.deepEqual(estimateSetTissueLoad(SQUAT, null).tissueWorkloads, []);
  assert.deepEqual(estimateSetTissueLoad(SQUAT, undefined).tissueWorkloads, []);
});

// ── Body mass: one uniform rule, no bodyweight special case ─────────────

test("body mass is applied by band to every exercise, loaded or not", function() {
  // The same zero-external-weight rule reaches a squat and a push-up. This
  // is the inconsistency the hardening pass removed: previously only
  // "bodyweight exercises" carried a fraction.
  const squat0 = estimateSetTissueLoad(SQUAT, { reps: 10, weight: 0, done: true }, { bodyMass: BM });
  const push0 = estimateSetTissueLoad({ name: "Push-Up" }, { reps: 10, weight: 0, done: true }, { bodyMass: BM });
  assert.equal(squat0.effectiveLoad, SQUAT_BAND * BM);
  assert.equal(push0.effectiveLoad, BODY_MASS_BANDS.most * BM);
  assert.ok(squat0.setWorkload > 0 && push0.setWorkload > 0, "neither collapses to zero");
  assert.deepEqual(squat0.warnings, [], "no special-case warning for a zero-weight squat any more");
  assert.deepEqual(push0.warnings, []);

  // A 'none'-band exercise at weight 0 genuinely has no load, and says so.
  const bench0 = estimateSetTissueLoad({ name: "Barbell Bench Press" }, { reps: 10, weight: 0, done: true }, { bodyMass: BM });
  assert.equal(bench0.bodyMassFraction, 0);
  assert.equal(bench0.bodyMass, null);
  assert.equal(bench0.effectiveLoad, 0);
  assert.deepEqual(bench0.warnings, [WARN_ZERO_LOAD]);
  bench0.tissueWorkloads.forEach(function(l) { assert.equal(l.workload, 0); });
  assert.equal(bench0.tissueWorkloads.length, 3, "entries kept for provenance");
});

test("missing or unusable athlete mass falls back deterministically and caps confidence", function() {
  assert.equal(DEFAULT_BODY_MASS_REFERENCE, DEFAULT_PROFILE.weight,
    "reference must track the app's default profile");
  const r = estimateSetTissueLoad({ name: "Pull-Up" }, { reps: 8, weight: 0, done: true });
  assert.equal(r.bodyMass, DEFAULT_BODY_MASS_REFERENCE);
  assert.equal(r.effectiveLoad, DEFAULT_BODY_MASS_REFERENCE);
  assert.equal(r.setWorkload, 8 * DEFAULT_BODY_MASS_REFERENCE);
  assert.deepEqual(r.warnings, [WARN_DEFAULT_BODY_MASS]);
  r.tissueWorkloads.forEach(function(l) { assert.equal(l.confidence, "low", l.tissueId); });

  [0, -1, NaN, "heavy", null, undefined, {}].forEach(function(bm) {
    const rr = estimateSetTissueLoad({ name: "Pull-Up" }, { reps: 8, weight: 0, done: true }, { bodyMass: bm });
    assert.equal(rr.bodyMass, DEFAULT_BODY_MASS_REFERENCE, "bodyMass=" + String(bm));
    assert.deepEqual(rr, r, "every unusable value lands on the identical result");
  });

  // A 'none'-band exercise never depends on body mass, so it is never capped.
  const curl = estimateSetTissueLoad({ name: "Dumbbell Curl" }, { reps: 10, weight: 30, done: true });
  assert.deepEqual(curl.warnings, []);
  assert.equal(curl.tissueWorkloads[0].confidence, "medium");
});

test("external load adds to the body-mass term (weighted pull-up)", function() {
  const r = estimateSetTissueLoad({ name: "Pull-Up" }, { reps: 5, weight: 25, done: true }, { bodyMass: 200 });
  assert.equal(r.effectiveLoad, 225);
  assert.equal(r.setWorkload, 1125);
  assert.equal(workloadOf(r, "back"), 1125);
});

// ── Unit contract ───────────────────────────────────────────────────────

test("the canonical input unit is pounds, matching the rest of Physiq", function() {
  assert.equal(CANONICAL_WEIGHT_UNIT, "lb");
  const implicit = estimateSetTissueLoad(SQUAT, { reps: 5, weight: 225, done: true }, { bodyMass: BM });
  const explicit = estimateSetTissueLoad(SQUAT, { reps: 5, weight: 225, done: true }, { bodyMass: BM, weightUnit: "lb" });
  assert.deepEqual(implicit, explicit, "omitting weightUnit means pounds");
  assert.equal(implicit.weightUnit, "lb", "results say which unit their numbers are in");
});

test("declared kilograms convert to pounds, so the same physical session scores the same", function() {
  const LB_TO_KG = 0.45359237;
  const lb = estimateSetTissueLoad(SQUAT, { reps: 5, weight: 225, done: true }, { bodyMass: 180 });
  const kg = estimateSetTissueLoad(SQUAT,
    { reps: 5, weight: 225 * LB_TO_KG, done: true },
    { bodyMass: 180 * LB_TO_KG, weightUnit: "kg" });
  assert.ok(Math.abs(kg.setWorkload - lb.setWorkload) < 0.01,
    "kg " + kg.setWorkload + " vs lb " + lb.setWorkload);
  assert.equal(kg.weightUnit, "lb", "output is always reported in the canonical unit");
  // Without the declaration the SAME numbers are read as pounds and differ
  // wildly — which is exactly why the unit must be declared, not guessed.
  const undeclared = estimateSetTissueLoad(SQUAT, { reps: 5, weight: 225 * LB_TO_KG, done: true }, { bodyMass: 180 * LB_TO_KG });
  assert.ok(undeclared.setWorkload < lb.setWorkload / 2);
});

test("an unrecognised unit throws rather than silently meaning pounds", function() {
  ["stone", "KG", "lbs", "pound", "", "Lb", 1, {}, []].forEach(function(u) {
    assert.throws(function() {
      estimateSetTissueLoad(SQUAT, { reps: 5, weight: 100, done: true }, { weightUnit: u });
    }, /Unsupported context.weightUnit/, "weightUnit=" + JSON.stringify(u));
    assert.throws(function() {
      estimateSessionTissueLoad(DEMO_SESSION_PARTIAL, { weightUnit: u });
    }, /Unsupported context.weightUnit/, "session weightUnit=" + JSON.stringify(u));
  });
  // An empty session must fail just as loudly — no silent pass-through.
  assert.throws(function() { estimateSessionTissueLoad({ exercises: [] }, { weightUnit: "stone" }); },
    /Unsupported context.weightUnit/);
  assert.deepEqual(Object.keys(SUPPORTED_WEIGHT_UNITS).sort(), ["kg", "lb"]);
  assert.equal(weightUnitFactor(undefined), 1);
  assert.equal(weightUnitFactor(null), 1);
  assert.equal(weightUnitFactor("lb"), 1);
  assert.ok(weightUnitFactor("kg") > 2.2 && weightUnitFactor("kg") < 2.21);
});

// ── Degenerate numeric input ────────────────────────────────────────────

test("zero reps is completed-but-empty, and flagged", function() {
  const r = estimateSetTissueLoad(SQUAT, { reps: 0, weight: 225, done: true }, { bodyMass: BM });
  assert.equal(r.completed, true);
  assert.equal(r.setWorkload, 0);
  assert.ok(r.warnings.indexOf(WARN_ZERO_REPS) >= 0);
  r.tissueWorkloads.forEach(function(l) { assert.equal(l.workload, 0); });
});

test("malformed numeric input never yields NaN, Infinity or negative workload", function() {
  const bad = [NaN, Infinity, -Infinity, -5, "abc", "", null, undefined, {}, [], true];
  bad.forEach(function(v) {
    const r1 = estimateSetTissueLoad(SQUAT, { reps: v, weight: 225, done: true }, { bodyMass: BM });
    assertAllFinite(r1, "reps=" + String(v));
    assert.ok(r1.warnings.indexOf(WARN_INVALID_REPS) >= 0, "reps=" + String(v));
    assert.equal(r1.reps, 0);
    r1.tissueWorkloads.forEach(function(l) { assert.ok(l.workload >= 0); });

    const r2 = estimateSetTissueLoad(SQUAT, { reps: 5, weight: v, done: true }, { bodyMass: BM });
    assertAllFinite(r2, "weight=" + String(v));
    assert.ok(r2.warnings.indexOf(WARN_INVALID_WEIGHT) >= 0, "weight=" + String(v));
    assert.equal(r2.externalWeight, 0);
    r2.tissueWorkloads.forEach(function(l) { assert.ok(l.workload >= 0); });
  });
  const both = estimateSetTissueLoad(SQUAT, { reps: "x", weight: -1, done: true }, { bodyMass: Infinity });
  assertAllFinite(both);
  assert.equal(both.setWorkload, 0);
});

test("numeric strings are accepted as numbers", function() {
  const r = estimateSetTissueLoad(SQUAT, { reps: "5", weight: "225", done: true }, { bodyMass: BM });
  assert.equal(r.setWorkload, 1800);
  assert.deepEqual(r.warnings, []);
});

test("an unknown exercise is safe and distinguishable from a mapped-to-nothing exercise", function() {
  const unknown = estimateSetTissueLoad({ name: "Treadmill Run" }, { reps: 10, weight: 100, done: true });
  assert.equal(unknown.status, "unmapped");
  assert.equal(unknown.mappedName, null);
  assert.equal(unknown.completed, true);
  assert.deepEqual(unknown.tissueWorkloads, []);
  assert.equal(unknown.bodyMassBand, null, "no band is invented for an unmapped exercise");
  assert.equal(unknown.modelVersion, TISSUE_LOAD_MODEL_VERSION);

  const zeroMap = { "Zero Move": { bodyMass: "none", tissues: {} } };
  const mappedEmpty = estimateSetTissueLoad({ name: "Zero Move" }, { reps: 10, weight: 100, done: true },
    { exerciseTissueMap: zeroMap });
  assert.equal(mappedEmpty.status, "mapped");
  assert.equal(mappedEmpty.mappedName, "Zero Move");
  assert.deepEqual(mappedEmpty.tissueWorkloads, []);
  assert.notEqual(unknown.status, mappedEmpty.status);

  [null, undefined, {}, { name: 7 }, { name: "" }, "Squat"].forEach(function(ex) {
    const r = estimateSetTissueLoad(ex, { reps: 5, weight: 100, done: true });
    assert.equal(r.status, "unmapped", JSON.stringify(ex));
    assertAllFinite(r);
  });
});

test("estimateSetTissueLoad does not mutate its inputs", function() {
  const ex = Object.freeze({ id: 1, name: "Push-Up", sets: [] });
  const set = Object.freeze({ reps: 10, weight: 0, done: true });
  const ctx = Object.freeze({ bodyMass: 160 });
  const exBefore = clone(ex), setBefore = clone(set), ctxBefore = clone(ctx);
  estimateSetTissueLoad(ex, set, ctx);
  assert.deepEqual(ex, exBefore);
  assert.deepEqual(set, setBefore);
  assert.deepEqual(ctx, ctxBefore);
});

// ── Session aggregation ─────────────────────────────────────────────────

test("session: only completed sets contribute, with exact predictable totals", function() {
  // DEMO_SESSION_PARTIAL: Squat 5x225 done, done, NOT done; RDL 8x155 done, NOT done.
  const r = estimateSessionTissueLoad(DEMO_SESSION_PARTIAL, { bodyMass: BM });
  const squatSet = 5 * (225 + SQUAT_BAND * BM);   // 1800
  const rdlSet = 8 * (155 + RDL_BAND * BM);       // 1960

  assert.equal(r.events.length, 2 * Object.keys(SQ).length + 1 * Object.keys(RDL).length);
  assert.equal(r.tissues.quadriceps.totalWorkload, 2 * squatSet * SQ.quadriceps.coefficient);
  assert.equal(r.tissues.hamstrings.totalWorkload,
    2 * squatSet * SQ.hamstrings.coefficient + rdlSet * RDL.hamstrings.coefficient);
  assert.equal(r.tissues.glutes.totalWorkload,
    2 * squatSet * SQ.glutes.coefficient + rdlSet * RDL.glutes.coefficient);
  assert.equal(r.tissues.hamstrings.eventCount, 3);
  assert.equal(r.tissues.hamstrings.contributors.length, 2, "two exercises feed one tissue");
  assert.deepEqual(r.tissues.hamstrings.contributors.map(function(c) { return c.exerciseName; }),
    ["Squat", "Romanian Deadlift"]);
  assert.equal(r.tissues.hamstrings.contributors[0].setCount, 2);
  assert.equal(r.tissues.hamstrings.contributors[1].setCount, 1);

  assert.deepEqual(r.exercises.map(function(e) { return [e.exerciseName, e.status, e.completedSets, e.incompleteSets]; }),
    [["Squat", "mapped", 2, 1], ["Romanian Deadlift", "mapped", 1, 1]]);
  assert.deepEqual(r.unmappedExercises, []);
  assert.deepEqual(r.warnings, []);
  assert.equal(r.sessionId, 8002);
  assert.equal(r.title, "Demo Legs");
  assert.equal(r.finishedAt, DEMO_SESSION_PARTIAL.finishedAt);

  // Finishing the remaining sets strictly increases the totals.
  const full = clone(DEMO_SESSION_PARTIAL);
  full.exercises.forEach(function(ex) { ex.sets.forEach(function(s) { s.done = true; }); });
  const rf = estimateSessionTissueLoad(full, { bodyMass: BM });
  assert.equal(rf.events.length, 3 * Object.keys(SQ).length + 2 * Object.keys(RDL).length);
  assert.ok(rf.tissues.quadriceps.totalWorkload > r.tissues.quadriceps.totalWorkload);
});

test("session: every event carries provenance, version and source", function() {
  const r = estimateSessionTissueLoad(DEMO_SESSION_PARTIAL, { bodyMass: BM });
  r.events.forEach(function(ev) {
    assert.equal(ev.modelVersion, TISSUE_LOAD_MODEL_VERSION);
    assert.equal(ev.sourceType, "workout_model");
    assert.equal(ev.workloadUnit, WORKLOAD_UNIT);
    assert.equal(ev.timestamp, DEMO_SESSION_PARTIAL.finishedAt);
    assert.ok(isTissueId(ev.tissueId));
    assert.ok(isValidConfidence(ev.confidence));
    assert.ok(Number.isFinite(ev.workload) && ev.workload >= 0);
    assert.equal(ev.provenance.sessionId, 8002);
    assert.ok(ev.provenance.exerciseId === 92001 || ev.provenance.exerciseId === 92002);
    assert.equal(typeof ev.provenance.exerciseName, "string");
    assert.equal(typeof ev.provenance.exerciseIndex, "number");
    assert.equal(typeof ev.provenance.setIndex, "number");
  });
  const rdlEvents = r.events.filter(function(ev) { return ev.provenance.exerciseName === "Romanian Deadlift"; });
  assert.ok(rdlEvents.length > 0);
  rdlEvents.forEach(function(ev) { assert.equal(ev.provenance.setIndex, 0, "only the first RDL set was done"); });
  const squatSetIdx = r.events.filter(function(ev) { return ev.provenance.exerciseName === "Squat"; })
    .map(function(ev) { return ev.provenance.setIndex; });
  assert.deepEqual(Array.from(new Set(squatSetIdx)).sort(), [0, 1]);
});

test("session: same input always yields identical output", function() {
  const a = estimateSessionTissueLoad(DEMO_SESSION_COMPLETE, { bodyMass: BM });
  const b = estimateSessionTissueLoad(clone(DEMO_SESSION_COMPLETE), { bodyMass: BM });
  assert.deepEqual(a, b);
  assert.equal(JSON.stringify(a), JSON.stringify(b));
});

test("session: exercise order does not change per-tissue totals", function() {
  // Coefficients and bands like 0.3 and 0.75 are not exact in binary, so
  // this also checks the canonical-order summation, not just the arithmetic.
  const base = clone(DEMO_SESSION_PARTIAL);
  base.exercises.push({ id: 1, name: "Deadlift", sets: [{ reps: 3, weight: 315, done: true }, { reps: 3, weight: 335, done: true }] });
  base.exercises.push({ id: 2, name: "Barbell Row", sets: [{ reps: 8, weight: 135, done: true }] });
  base.exercises.push({ id: 3, name: "Good Morning", sets: [{ reps: 10, weight: 95, done: true }] });
  const reversed = clone(base);
  reversed.exercises.reverse();
  const shuffled = clone(base);
  shuffled.exercises = [shuffled.exercises[2], shuffled.exercises[0], shuffled.exercises[4], shuffled.exercises[1], shuffled.exercises[3]];

  const a = estimateSessionTissueLoad(base, { bodyMass: BM });
  const b = estimateSessionTissueLoad(reversed, { bodyMass: BM });
  const c = estimateSessionTissueLoad(shuffled, { bodyMass: BM });
  assert.deepEqual(Object.keys(a.tissues), Object.keys(b.tissues));
  Object.keys(a.tissues).forEach(function(t) {
    assert.equal(a.tissues[t].totalWorkload, b.tissues[t].totalWorkload, t);
    assert.equal(a.tissues[t].totalWorkload, c.tissues[t].totalWorkload, t);
    assert.equal(a.tissues[t].eventCount, b.tissues[t].eventCount, t);
    assert.equal(a.tissues[t].confidence, b.tissues[t].confidence, t);
  });
  assert.equal(a.events.length, b.events.length);
});

test("session: unknown exercises do not crash and are reported, not scored", function() {
  const s = clone(DEMO_SESSION_B);
  s.exercises.push({ id: 5, name: "Treadmill Run", muscle: "Cardio", sets: [{ reps: 1, weight: 0, done: true }] });
  s.exercises.push({ id: 6, name: "Mystery Move", sets: [{ reps: 10, weight: 50, done: true }] });
  s.exercises.push({ id: 7, name: "Treadmill Run", sets: [{ reps: 1, weight: 0, done: false }] });
  const r = estimateSessionTissueLoad(s, { bodyMass: BM });
  assert.deepEqual(r.unmappedExercises, ["Treadmill Run", "Mystery Move"]);
  assert.equal(r.exercises[2].status, "unmapped");
  assert.equal(r.exercises[2].completedSets, 1, "completion is still counted");
  assert.equal(r.events.filter(function(ev) { return ev.provenance.exerciseIndex >= 2; }).length, 0);
  assert.equal(r.tissues.back.contributors.length, 1);
  assert.equal(r.tissues.back.contributors[0].exerciseName, "Lat Pulldown");
});

test("session: degenerate inputs are safe", function() {
  [null, undefined, {}, { exercises: null }, { exercises: "nope" }, { exercises: [] }].forEach(function(s) {
    const r = estimateSessionTissueLoad(s);
    assert.deepEqual(r.events, []);
    assert.deepEqual(r.tissues, {});
    assert.equal(r.modelVersion, TISSUE_LOAD_MODEL_VERSION);
    assert.equal(r.sessionId, null);
  });
  const odd = estimateSessionTissueLoad({ id: 1, exercises: [
    null,
    { name: "Squat" },
    { name: "Squat", sets: [null, { reps: 5, weight: 100, done: true }] },
    { sets: [{ done: true }] }
  ] }, { bodyMass: BM });
  assertAllFinite(odd);
  assert.equal(odd.exercises.length, 4);
  assert.equal(odd.exercises[0].status, "unmapped");
  assert.equal(odd.exercises[1].status, "mapped");
  assert.equal(odd.exercises[1].completedSets, 0);
  assert.equal(odd.exercises[2].completedSets, 1);
  assert.equal(odd.exercises[2].incompleteSets, 1);
  assert.equal(odd.tissues.quadriceps.totalWorkload, 5 * (100 + SQUAT_BAND * BM));
  assert.deepEqual(odd.unmappedExercises, [""]);
});

test("session: the in-memory active session (no id, no finishedAt) is accepted", function() {
  const r = estimateSessionTissueLoad(DEMO_ACTIVE_SESSION, { bodyMass: BM });
  assert.equal(r.sessionId, null);
  assert.equal(r.finishedAt, null);
  assert.equal(r.startedAt, DEMO_ACTIVE_SESSION.startedAt);
  assert.equal(r.events.length, Object.keys(SQ).length, "exactly one squat set is done");
  r.events.forEach(function(ev) {
    assert.equal(ev.timestamp, DEMO_ACTIVE_SESSION.startedAt);
    assert.equal(ev.provenance.sessionId, null);
  });
});

test("session: warnings and body-mass context flow through", function() {
  const s = { id: 1, exercises: [
    { id: 1, name: "Push-Up", sets: [{ reps: 15, weight: 0, done: true }] },
    { id: 2, name: "Lunge", sets: [{ reps: 10, weight: 0, done: true }] },
    { id: 3, name: "Barbell Bench Press", sets: [{ reps: 10, weight: 0, done: true }] }
  ] };
  const withMass = estimateSessionTissueLoad(s, { bodyMass: 160 });
  assert.deepEqual(withMass.warnings, [WARN_ZERO_LOAD], "only the 'none'-band bench press has no load");
  assert.deepEqual(withMass.exercises[2].warnings, [WARN_ZERO_LOAD]);
  assert.deepEqual(withMass.exercises[0].warnings, []);
  assert.equal(withMass.tissues.chest.totalWorkload, 15 * BODY_MASS_BANDS.most * 160);
  assert.ok(withMass.tissues.quadriceps.totalWorkload > 0, "the lunge still counts");

  const noMass = estimateSessionTissueLoad(s);
  assert.deepEqual(noMass.warnings, [WARN_DEFAULT_BODY_MASS, WARN_ZERO_LOAD]);
  assert.equal(noMass.tissues.chest.confidence, "low");
  assert.equal(withMass.tissues.chest.confidence, "medium");
});

test("session: per-tissue confidence is the weakest contributing assumption", function() {
  const r = estimateSessionTissueLoad(DEMO_SESSION_PARTIAL, { bodyMass: BM });
  // glutes: medium from both squat and RDL → medium.
  assert.equal(SQ.glutes.confidence, "medium"); assert.equal(RDL.glutes.confidence, "medium");
  assert.equal(r.tissues.glutes.confidence, "medium");
  // hamstrings: squat's hamstring entry is low, RDL's is medium → low.
  assert.equal(SQ.hamstrings.confidence, "low"); assert.equal(RDL.hamstrings.confidence, "medium");
  assert.equal(r.tissues.hamstrings.confidence, "low");
  Object.keys(r.tissues).forEach(function(t) { assert.ok(isValidConfidence(r.tissues[t].confidence), t); });
});

test("estimateSessionTissueLoad does not mutate its input", function() {
  const before = clone(DEMO_SESSION_PARTIAL);
  const frozen = clone(DEMO_SESSION_PARTIAL);
  Object.freeze(frozen); frozen.exercises.forEach(function(ex) { Object.freeze(ex); ex.sets.forEach(Object.freeze); });
  estimateSessionTissueLoad(frozen, { bodyMass: BM });
  estimateSessionTissueLoad(DEMO_SESSION_PARTIAL, { bodyMass: BM });
  assert.deepEqual(DEMO_SESSION_PARTIAL, before);
  assert.deepEqual(frozen, before);
});

test("results serialise cleanly and expose the model version at every level", function() {
  const r = estimateSessionTissueLoad(DEMO_SESSION_COMPLETE, { bodyMass: BM });
  const round = JSON.parse(JSON.stringify(r));
  assert.deepEqual(round, r);
  assert.equal(round.modelVersion, "tissue-load-v0.1");
  assert.equal(round.mapVersion, EXERCISE_TISSUE_MAP_VERSION);
  assert.equal(round.workloadUnit, WORKLOAD_UNIT);
  assert.equal(round.scale, WORKLOAD_SCALE);
  round.events.forEach(function(ev) { assert.equal(ev.modelVersion, "tissue-load-v0.1"); });
});
