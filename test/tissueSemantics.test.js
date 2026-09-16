/* ─── Tests — TissueOS v0.1 semantic invariants ───────────────────────────
 *
 * These protect the MEANING of the model's output rather than its
 * arithmetic. They are the tests that should fail if a future change makes
 * the engine claim more than it can support: a normalized score, a force,
 * an injury probability, a recovery percentage, or a silently different
 * model version.
 *
 * They inspect engine RESULTS (keys and values), not prose.
 * ───────────────────────────────────────────────────────────────────────── */

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  estimateSetTissueLoad, estimateSessionTissueLoad,
  WORKLOAD_UNIT, WORKLOAD_SCALE, CANONICAL_WEIGHT_UNIT
} from "../js/tissue/loadEngine.js";
import {
  TISSUE_LOAD_MODEL_VERSION, EXERCISE_TISSUE_MAP_VERSION, TISSUE_DEFINITIONS_VERSION
} from "../js/tissue/modelVersion.js";
import { EXERCISE_TISSUE_MAP } from "../js/tissue/exerciseTissueMap.js";
import { DEMO_SESSION_COMPLETE, DEMO_SESSION_PARTIAL } from "../js/dev/demoFixtures.js";

const BM = 180;

/* A broad, realistic sample of engine output to inspect. */
function sampleResults() {
  const sessions = [
    estimateSessionTissueLoad(DEMO_SESSION_COMPLETE, { bodyMass: BM }),
    estimateSessionTissueLoad(DEMO_SESSION_PARTIAL, { bodyMass: BM }),
    estimateSessionTissueLoad(DEMO_SESSION_PARTIAL)
  ];
  const sets = Object.keys(EXERCISE_TISSUE_MAP).map(function(name) {
    return estimateSetTissueLoad({ name: name }, { reps: 10, weight: 100, done: true }, { bodyMass: BM });
  });
  return sessions.concat(sets);
}

function walk(value, visit, path) {
  visit(value, path || "");
  if (Array.isArray(value)) {
    value.forEach(function(v, i) { walk(v, visit, (path || "") + "[" + i + "]"); });
  } else if (value && typeof value === "object") {
    Object.keys(value).forEach(function(k) { walk(value[k], visit, (path || "") + "." + k); });
  }
}

// ── The output is not a normalized score ────────────────────────────────

test("v0.1 declares itself unbounded and dimensional, never a 0-100 score", function() {
  assert.equal(WORKLOAD_SCALE, "unbounded");
  assert.equal(WORKLOAD_UNIT, "lb*rep");
  assert.equal(CANONICAL_WEIGHT_UNIT, "lb");
  sampleResults().forEach(function(r) {
    assert.equal(r.scale, "unbounded", "every result states it has no maximum");
    assert.equal(r.workloadUnit, "lb*rep", "every result states its dimension");
    assert.equal(r.weightUnit, "lb");
  });
});

test("ordinary workouts exceed 100, so a raw value cannot be read as a percentage", function() {
  // If these ever fit in 0-100 by coincidence, someone could plausibly
  // render "74 / 100". A realistic session must blow past that.
  const r = estimateSessionTissueLoad(DEMO_SESSION_PARTIAL, { bodyMass: BM });
  assert.ok(r.tissues.quadriceps.totalWorkload > 100, r.tissues.quadriceps.totalWorkload);
  assert.ok(r.events.some(function(ev) { return ev.workload > 100; }));
  const set = estimateSetTissueLoad({ name: "Squat" }, { reps: 5, weight: 225, done: true }, { bodyMass: BM });
  assert.ok(set.setWorkload > 100);
  // And the value genuinely scales with input rather than saturating.
  const heavier = estimateSetTissueLoad({ name: "Squat" }, { reps: 5, weight: 450, done: true }, { bodyMass: BM });
  assert.ok(heavier.setWorkload > set.setWorkload, "no clamping");
  const huge = estimateSetTissueLoad({ name: "Squat" }, { reps: 100, weight: 1000, done: true }, { bodyMass: BM });
  assert.ok(huge.setWorkload > 100000, "no upper bound at all");
});

test("no result field is named as a normalized score, percentage or rating", function() {
  // Naming is the first thing a UI author reads. `workload` must not drift
  // back to `normalizedLoad` / `score` / `percent` without a deliberate
  // change to this test.
  // Note: "index" is deliberately absent — exerciseIndex/setIndex are array
  // positions, not ratings.
  const banned = /normali[sz]ed|score|percent|pct|rating|out_?of|_100/i;
  const seen = new Set();
  sampleResults().forEach(function(r) {
    walk(r, function(v, path) {
      path.split(/[.\[]/).forEach(function(seg) {
        const key = seg.replace(/\]$/, "");
        if (key && !/^\d+$/.test(key)) seen.add(key);
      });
    });
  });
  seen.forEach(function(key) { assert.equal(banned.test(key), false, "field name implies normalization: " + key); });
  // The intended names are present, so this test cannot pass vacuously.
  ["workload", "totalWorkload", "setWorkload", "workloadUnit", "scale", "coefficient"].forEach(function(k) {
    assert.ok(seen.has(k), "expected field missing: " + k);
  });
});

// ── No unsupported biomechanical or clinical claims ─────────────────────

test("no result exposes a force, a stress or a physical force unit", function() {
  const bannedKey = /force|newton|stress|torque|moment|\bgrf\b|kilonewton/i;
  const bannedValue = /\b(N|kN|kilonewtons?|newtons?|MPa|Pa)\b/;
  sampleResults().forEach(function(r) {
    walk(r, function(v, path) {
      const leaf = path.split(".").pop() || "";
      assert.equal(bannedKey.test(leaf), false, "field implies force: " + path);
      if (typeof v === "string") {
        assert.equal(bannedValue.test(v), false, "value carries a force unit: " + path + " = " + v);
      }
    });
  });
});

test("no result exposes injury risk, recovery, damage or capacity", function() {
  // Everything in this list belongs to a later milestone or to no milestone
  // at all. None of it can be derived from what v0.1 computes.
  const banned = /injur|risk|probabilit|damage|recover|readiness|capacity|fatigue|healed|diagnos|prognos/i;
  sampleResults().forEach(function(r) {
    walk(r, function(v, path) {
      const leaf = path.split(".").pop() || "";
      assert.equal(banned.test(leaf), false, "field implies an unsupported claim: " + path);
      if (typeof v === "string") {
        assert.equal(banned.test(v), false, "value implies an unsupported claim: " + path + " = " + v);
      }
    });
  });
});

test("confidence is categorical metadata, never a numeric probability", function() {
  sampleResults().forEach(function(r) {
    walk(r, function(v, path) {
      if (/\.confidence$/.test(path)) {
        assert.equal(typeof v === "string" || v === null, true,
          "confidence must stay categorical, got " + typeof v + " at " + path);
        if (typeof v === "string") assert.ok(["low", "medium", "high"].indexOf(v) >= 0, path + " = " + v);
      }
    });
  });
});

// ── Coefficients stay in their documented domain, as applied ────────────

test("every coefficient reaching a result is finite and within (0, 1]", function() {
  sampleResults().forEach(function(r) {
    walk(r, function(v, path) {
      if (/\.coefficient$/.test(path)) {
        assert.ok(Number.isFinite(v), path + " = " + v);
        assert.ok(v > 0 && v <= 1, path + " = " + v);
      }
    });
  });
});

test("a tissue's workload never exceeds the set workload that produced it", function() {
  // Follows from coefficient <= 1. Stated as an invariant so a future
  // "amplifying" coefficient cannot slip in unnoticed.
  Object.keys(EXERCISE_TISSUE_MAP).forEach(function(name) {
    const r = estimateSetTissueLoad({ name: name }, { reps: 8, weight: 135, done: true }, { bodyMass: BM });
    r.tissueWorkloads.forEach(function(tw) {
      assert.ok(tw.workload <= r.setWorkload + 1e-9, name + "/" + tw.tissueId);
      assert.ok(tw.workload >= 0, name + "/" + tw.tissueId);
    });
  });
});

// ── Versioning is explicit ──────────────────────────────────────────────

test("model, map and definition versions are pinned — changing one is a deliberate edit", function() {
  // This test exists to FAIL on an incidental version bump. If you are
  // changing the science, change these strings here too, and say why in
  // js/tissue/README.md.
  assert.equal(TISSUE_LOAD_MODEL_VERSION, "tissue-load-v0.1");
  assert.equal(EXERCISE_TISSUE_MAP_VERSION, "exercise-tissue-map-v0.1");
  assert.equal(TISSUE_DEFINITIONS_VERSION, "tissue-definitions-v0.1");
});

test("every result and every event carries the model version that produced it", function() {
  sampleResults().forEach(function(r) {
    assert.equal(r.modelVersion, TISSUE_LOAD_MODEL_VERSION);
    assert.equal(r.mapVersion, EXERCISE_TISSUE_MAP_VERSION);
    (r.events || []).forEach(function(ev) {
      assert.equal(ev.modelVersion, TISSUE_LOAD_MODEL_VERSION);
      assert.equal(ev.workloadUnit, WORKLOAD_UNIT);
    });
  });
});

test("two model versions can never be silently mixed in one aggregate", function() {
  // Aggregation is per-session and every event in it shares one version,
  // so a cross-version total is impossible today. Pin that property.
  const r = estimateSessionTissueLoad(DEMO_SESSION_COMPLETE, { bodyMass: BM });
  const versions = new Set(r.events.map(function(ev) { return ev.modelVersion; }));
  assert.equal(versions.size, 1);
  assert.equal(Array.from(versions)[0], r.modelVersion);
});

// ── Nothing is persisted ────────────────────────────────────────────────

test("computing tissue results touches no storage", function() {
  // The domain layer has no storage import (enforced elsewhere); this
  // checks the observable consequence with a throwing global in place.
  const had = Object.prototype.hasOwnProperty.call(globalThis, "localStorage");
  const original = globalThis.localStorage;
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    get: function() { throw new Error("TissueOS must not touch localStorage"); }
  });
  try {
    const r = estimateSessionTissueLoad(DEMO_SESSION_COMPLETE, { bodyMass: BM });
    assert.ok(r.events.length > 0);
  } finally {
    delete globalThis.localStorage;
    if (had) globalThis.localStorage = original;
  }
});
