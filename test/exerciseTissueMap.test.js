/* ─── Tests — TissueOS exercise → tissue mapping ─────────────────────────── */

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  EXERCISE_TISSUE_MAP, EXERCISE_TISSUE_MAP_VERSION,
  BODY_MASS_BANDS, BODY_MASS_BAND_NAMES, bodyMassBandValue,
  resolveExerciseMapping, normalizeExerciseName, listMappedExerciseNames
} from "../js/tissue/exerciseTissueMap.js";
import { isTissueId, TISSUE_IDS, getTissue } from "../js/tissue/tissueDefinitions.js";
import { isValidConfidence } from "../js/tissue/uncertainty.js";
import { EXERCISES_BY_CATEGORY, EXERCISE_MUSCLE } from "../js/data/constants.js";

const CATALOG = Object.keys(EXERCISES_BY_CATEGORY).reduce(function(acc, cat) {
  return acc.concat(EXERCISES_BY_CATEGORY[cat]);
}, []);
const NAMES = Object.keys(EXERCISE_TISSUE_MAP);

test("every mapped exercise is a real catalog name (identity is the display name)", function() {
  NAMES.forEach(function(n) { assert.ok(CATALOG.indexOf(n) >= 0, "not in catalog: " + n); });
  assert.equal(new Set(NAMES).size, NAMES.length);
});

test("every referenced tissue id exists", function() {
  NAMES.forEach(function(n) {
    Object.keys(EXERCISE_TISSUE_MAP[n].tissues).forEach(function(t) {
      assert.ok(isTissueId(t), n + " references unknown tissue " + t);
    });
  });
});

test("coefficients are finite and within the documented (0, 1] domain", function() {
  NAMES.forEach(function(n) {
    const tissues = EXERCISE_TISSUE_MAP[n].tissues;
    assert.ok(Object.keys(tissues).length > 0, n + " maps to nothing");
    Object.keys(tissues).forEach(function(t) {
      const c = tissues[t].coefficient;
      assert.ok(Number.isFinite(c), n + "/" + t);
      assert.ok(c > 0 && c <= 1, n + "/" + t + " = " + c);
    });
  });
});

test("every entry has a valid confidence, and v0.1 never claims 'high'", function() {
  NAMES.forEach(function(n) {
    Object.keys(EXERCISE_TISSUE_MAP[n].tissues).forEach(function(t) {
      const conf = EXERCISE_TISSUE_MAP[n].tissues[t].confidence;
      assert.ok(isValidConfidence(conf), n + "/" + t + " " + conf);
      assert.notEqual(conf, "high", "nothing is validated yet: " + n + "/" + t);
    });
  });
});

test("each mapped exercise's primary tissue agrees with Physiq's own muscle category", function() {
  // Coarse sanity check on the heuristics: the tissue(s) at the top
  // coefficient must include the region Physiq already files the exercise
  // under. The only translation is quads→quadriceps.
  const toTissue = { quads: "quadriceps" };
  NAMES.forEach(function(n) {
    const physiq = toTissue[EXERCISE_MUSCLE[n]] || EXERCISE_MUSCLE[n];
    const tissues = EXERCISE_TISSUE_MAP[n].tissues;
    const top = Math.max.apply(null, Object.keys(tissues).map(function(t) { return tissues[t].coefficient; }));
    const primaries = Object.keys(tissues).filter(function(t) { return tissues[t].coefficient === top; });
    assert.ok(primaries.indexOf(physiq) >= 0, n + ": primaries " + primaries + " vs Physiq " + physiq);
  });
});

// ── Tendon guardrails ───────────────────────────────────────────────────

test("tendon entries are always provisional (low confidence)", function() {
  NAMES.forEach(function(n) {
    ["patellar_tendon", "achilles_tendon"].forEach(function(t) {
      const spec = EXERCISE_TISSUE_MAP[n].tissues[t];
      if (spec) assert.equal(spec.confidence, "low", n + "/" + t);
    });
  });
});

test("a tendon can never be an exercise's dominant mapped structure", function() {
  // Enforces the documented meaning: a tendon coefficient records that the
  // exercise is provisionally mechanically RELEVANT to the tendon, not that
  // the tendon is the most loaded thing in the movement. Without this a UI
  // could rank a tendon top and imply a stress estimate that does not exist.
  NAMES.forEach(function(n) {
    const tissues = EXERCISE_TISSUE_MAP[n].tissues;
    const muscles = Object.keys(tissues).filter(function(t) { return getTissue(t).type === "muscle"; });
    const tendons = Object.keys(tissues).filter(function(t) { return getTissue(t).type === "tendon"; });
    if (tendons.length === 0) return;
    assert.ok(muscles.length > 0, n + " maps a tendon with no muscle");
    const topMuscle = Math.max.apply(null, muscles.map(function(t) { return tissues[t].coefficient; }));
    tendons.forEach(function(t) {
      assert.ok(tissues[t].coefficient <= topMuscle, n + "/" + t + " outranks every muscle");
    });
  });
});

test("tendons are mapped only where the movement pattern is uncontroversial", function() {
  const withPatellar = NAMES.filter(function(n) { return !!EXERCISE_TISSUE_MAP[n].tissues.patellar_tendon; });
  const withAchilles = NAMES.filter(function(n) { return !!EXERCISE_TISSUE_MAP[n].tissues.achilles_tendon; });
  // Knee-extension demand only, plantar-flexion demand only.
  assert.deepEqual(withPatellar.slice().sort(), ["Front Squat", "Leg Extension", "Leg Press", "Lunge", "Squat"]);
  assert.deepEqual(withAchilles.slice().sort(), ["Seated Calf Raise", "Standing Calf Raise"]);
  // Nothing hip-dominant or upper-body carries a tendon entry.
  ["Deadlift", "Romanian Deadlift", "Hip Thrust", "Barbell Bench Press", "Pull-Up"].forEach(function(n) {
    const t = EXERCISE_TISSUE_MAP[n].tissues;
    assert.equal(t.patellar_tendon, undefined, n);
    assert.equal(t.achilles_tendon, undefined, n);
  });
});

// ── Body-mass bands ─────────────────────────────────────────────────────

test("every exercise declares a body-mass band — there is no bodyweight special case", function() {
  NAMES.forEach(function(n) {
    const band = EXERCISE_TISSUE_MAP[n].bodyMass;
    assert.equal(typeof band, "string", n + " has no bodyMass band");
    assert.ok(BODY_MASS_BAND_NAMES.indexOf(band) >= 0, n + " band " + band);
  });
});

test("bands are a coarse named scale, not per-exercise decimals", function() {
  assert.deepEqual(BODY_MASS_BAND_NAMES, ["none", "light", "half", "most", "full"]);
  const values = BODY_MASS_BAND_NAMES.map(function(b) { return BODY_MASS_BANDS[b]; });
  assert.deepEqual(values, [0, 0.25, 0.5, 0.75, 1.0]);
  values.forEach(function(v) { assert.ok(Number.isFinite(v) && v >= 0 && v <= 1); });
  // Only these five values can ever reach the engine.
  const used = new Set(NAMES.map(function(n) { return BODY_MASS_BANDS[EXERCISE_TISSUE_MAP[n].bodyMass]; }));
  used.forEach(function(v) { assert.ok(values.indexOf(v) >= 0); });
  assert.throws(function() { bodyMassBandValue("0.65"); }, /Unknown body-mass band/);
  assert.throws(function() { bodyMassBandValue(0.5); }, /Unknown body-mass band/);
  assert.equal(bodyMassBandValue("none"), 0);
  assert.equal(bodyMassBandValue("full"), 1);
});

test("band assignment is sane: externally supported exercises are 'none', hanging/bodyweight ones are not", function() {
  ["Barbell Bench Press", "Lat Pulldown", "Leg Press", "Dumbbell Curl", "Leg Extension", "Seated Calf Raise"]
    .forEach(function(n) { assert.equal(EXERCISE_TISSUE_MAP[n].bodyMass, "none", n); });
  ["Pull-Up", "Dips"].forEach(function(n) { assert.equal(EXERCISE_TISSUE_MAP[n].bodyMass, "full", n); });
  ["Squat", "Push-Up", "Lunge", "Standing Calf Raise"].forEach(function(n) {
    assert.equal(EXERCISE_TISSUE_MAP[n].bodyMass, "most", n);
  });
});

// ── Coverage ────────────────────────────────────────────────────────────

test("coverage: a deliberately small reference set spanning every movement pattern", function() {
  const mapped = listMappedExerciseNames();
  assert.equal(mapped.length, 25);
  assert.ok(mapped.length < CATALOG.length / 2, "a reference set, not catalog coverage");

  const patterns = {
    upperPush:    ["Barbell Bench Press", "Overhead Press", "Push-Up", "Dips"],
    upperPull:    ["Pull-Up", "Lat Pulldown", "Barbell Row", "Seated Cable Row"],
    kneeDominant: ["Squat", "Front Squat", "Leg Press", "Lunge"],
    hipDominant:  ["Deadlift", "Romanian Deadlift", "Good Morning", "Hip Thrust"],
    plantarFlex:  ["Standing Calf Raise", "Seated Calf Raise"],
    isolation:    ["Dumbbell Curl", "Tricep Pushdown", "Lateral Raise", "Leg Extension", "Lying Leg Curl"],
    core:         ["Plank", "Hanging Leg Raise"]
  };
  Object.keys(patterns).forEach(function(p) {
    assert.ok(patterns[p].length >= 2, p);
    patterns[p].forEach(function(n) { assert.ok(mapped.indexOf(n) >= 0, p + " missing " + n); });
  });
  // The pattern lists account for the whole map — nothing unclassified.
  const claimed = Object.keys(patterns).reduce(function(a, p) { return a.concat(patterns[p]); }, []);
  assert.deepEqual(claimed.slice().sort(), mapped);

  // Cardio stays out: Physiq logs it as sets x reps x weight, which does
  // not describe it.
  EXERCISES_BY_CATEGORY.cardio.forEach(function(n) { assert.equal(mapped.indexOf(n), -1, n); });

  // Every tissue in the vocabulary is still reachable.
  TISSUE_IDS.forEach(function(t) {
    assert.ok(NAMES.some(function(n) { return !!EXERCISE_TISSUE_MAP[n].tissues[t]; }), "no exercise reaches " + t);
  });
});

test("the map is frozen data with a version", function() {
  assert.match(EXERCISE_TISSUE_MAP_VERSION, /^exercise-tissue-map-v/);
  assert.ok(Object.isFrozen(EXERCISE_TISSUE_MAP));
  assert.ok(Object.isFrozen(BODY_MASS_BANDS));
  assert.ok(Object.isFrozen(EXERCISE_TISSUE_MAP["Squat"].tissues.quadriceps));
});

// ── Resolution ──────────────────────────────────────────────────────────

test("resolution is deterministic: exact, trimmed, case-folded, else null", function() {
  const exact = resolveExerciseMapping("Romanian Deadlift");
  assert.equal(exact.name, "Romanian Deadlift");
  assert.equal(exact.entry, EXERCISE_TISSUE_MAP["Romanian Deadlift"]);
  assert.equal(resolveExerciseMapping("  romanian deadlift ").name, "Romanian Deadlift");
  assert.equal(resolveExerciseMapping("ROMANIAN DEADLIFT").entry, exact.entry);
  assert.equal(resolveExerciseMapping("Romanian  Deadlift"), null, "no fuzzy matching");
  assert.equal(resolveExerciseMapping("Treadmill Run"), null);
  assert.equal(resolveExerciseMapping(""), null);
  assert.equal(resolveExerciseMapping(null), null);
  assert.equal(resolveExerciseMapping(undefined), null);
  assert.equal(resolveExerciseMapping(42), null);
  assert.equal(resolveExerciseMapping("hasOwnProperty"), null);
  assert.equal(resolveExerciseMapping("__proto__"), null);
  assert.deepEqual(resolveExerciseMapping("Squat"), resolveExerciseMapping("Squat"));
});

test("a custom map can be supplied and is resolved the same way", function() {
  const custom = {
    "Zero Move": { bodyMass: "none", tissues: {} },
    "Chest Only": { bodyMass: "none", tissues: { chest: { coefficient: 1, confidence: "low" } } }
  };
  assert.deepEqual(resolveExerciseMapping("zero move", custom), { name: "Zero Move", entry: custom["Zero Move"] });
  assert.equal(resolveExerciseMapping("Squat", custom), null, "custom map replaces, not extends");
  assert.deepEqual(listMappedExerciseNames(custom), ["Chest Only", "Zero Move"]);
});

test("normalizeExerciseName is total", function() {
  assert.equal(normalizeExerciseName("  Pull-Up "), "pull-up");
  assert.equal(normalizeExerciseName(null), "");
  assert.equal(normalizeExerciseName({}), "");
});
