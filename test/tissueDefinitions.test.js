/* ─── Tests — TissueOS tissue definitions + uncertainty + versions ───────── */

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import {
  TISSUES, TISSUE_BY_ID, TISSUE_IDS, TISSUE_TYPES, isTissueId, getTissue
} from "../js/tissue/tissueDefinitions.js";
import {
  CONFIDENCE_LEVELS, isValidConfidence, confidenceRank, combineConfidence
} from "../js/tissue/uncertainty.js";
import {
  TISSUE_LOAD_MODEL_VERSION, EXERCISE_TISSUE_MAP_VERSION, TISSUE_DEFINITIONS_VERSION
} from "../js/tissue/modelVersion.js";
import { SCHEMA_VERSION } from "../js/utils/storage.js";
import { TRACKED_MUSCLES } from "../js/data/constants.js";

const HANDOFF_SUGGESTED = [
  "chest", "shoulders", "biceps", "triceps", "back", "core", "glutes",
  "quadriceps", "hamstrings", "calves", "patellar_tendon", "achilles_tendon"
];

// ── Tissue definitions ──────────────────────────────────────────────────

test("tissue ids are unique, stable machine identifiers", function() {
  const ids = TISSUES.map(function(t) { return t.id; });
  assert.equal(new Set(ids).size, ids.length, "duplicate id");
  ids.forEach(function(id) { assert.match(id, /^[a-z][a-z0-9_]*$/, id); });
  assert.deepEqual(TISSUE_IDS, ids);
});

test("every tissue has a valid type and a display name separate from its id", function() {
  TISSUES.forEach(function(t) {
    assert.ok(TISSUE_TYPES.indexOf(t.type) >= 0, t.id + " type " + t.type);
    assert.equal(typeof t.name, "string");
    assert.ok(t.name.trim().length > 0, t.id + " needs a display name");
    assert.notEqual(t.name, t.id, "display name should not just repeat the id: " + t.id);
  });
});

test("no duplicate definitions and the lookup table matches the list", function() {
  assert.equal(Object.keys(TISSUE_BY_ID).length, TISSUES.length);
  TISSUES.forEach(function(t) { assert.equal(TISSUE_BY_ID[t.id], t); });
});

test("initial vocabulary is exactly the handoff's suggested coarse set", function() {
  assert.deepEqual(TISSUE_IDS.slice().sort(), HANDOFF_SUGGESTED.slice().sort());
  assert.equal(TISSUES.filter(function(t) { return t.type === "tendon"; }).length, 2);
  assert.equal(TISSUES.filter(function(t) { return t.type === "muscle"; }).length, 10);
});

test("physiqMuscle links point at real muscle-tracker regions or null", function() {
  const regions = TRACKED_MUSCLES.map(function(m) { return m.id; });
  TISSUES.forEach(function(t) {
    if (t.physiqMuscle === null) {
      assert.equal(t.type, "tendon", "only tendons lack a body-map region today: " + t.id);
    } else {
      assert.ok(regions.indexOf(t.physiqMuscle) >= 0, t.id + " → " + t.physiqMuscle);
    }
  });
  // Every muscle tissue maps to a region, and no region is used twice —
  // a later UI can colour the existing map one-to-one.
  const used = TISSUES.map(function(t) { return t.physiqMuscle; }).filter(Boolean);
  assert.equal(new Set(used).size, used.length);
});

test("definitions are frozen and lookups are total", function() {
  assert.ok(Object.isFrozen(TISSUES));
  TISSUES.forEach(function(t) { assert.ok(Object.isFrozen(t)); });
  assert.throws(function() { "use strict"; TISSUES[0].id = "x"; });
  assert.equal(isTissueId("hamstrings"), true);
  assert.equal(isTissueId("quads"), false, "Physiq's 'quads' is not a tissue id — use physiqMuscle");
  assert.equal(isTissueId("toString"), false);
  assert.equal(isTissueId(null), false);
  assert.equal(getTissue("achilles_tendon").type, "tendon");
  assert.equal(getTissue("nope"), null);
});

// ── Uncertainty ─────────────────────────────────────────────────────────

test("confidence accepts only the three documented levels", function() {
  assert.deepEqual(CONFIDENCE_LEVELS, ["low", "medium", "high"]);
  ["low", "medium", "high"].forEach(function(l) { assert.equal(isValidConfidence(l), true); });
  ["", "LOW", "moderate", 0.8, null, undefined, {}].forEach(function(v) {
    assert.equal(isValidConfidence(v), false, String(v));
  });
  assert.throws(function() { confidenceRank("moderate"); }, /Unknown confidence/);
});

test("combineConfidence is the weakest link, and null for no inputs", function() {
  assert.equal(combineConfidence(["medium", "medium"]), "medium");
  assert.equal(combineConfidence(["medium", "low", "high"]), "low");
  assert.equal(combineConfidence(["high"]), "high");
  assert.equal(combineConfidence(["high", "medium"]), "medium");
  assert.equal(combineConfidence([]), null);
  assert.equal(combineConfidence(undefined), null);
  assert.throws(function() { combineConfidence(["medium", "bogus"]); });
});

// ── Model version ───────────────────────────────────────────────────────

test("model versions follow the documented naming and are independent of the schema version", function() {
  assert.equal(TISSUE_LOAD_MODEL_VERSION, "tissue-load-v0.1");
  assert.match(EXERCISE_TISSUE_MAP_VERSION, /^exercise-tissue-map-v\d+\.\d+$/);
  assert.match(TISSUE_DEFINITIONS_VERSION, /^tissue-definitions-v\d+\.\d+$/);
  // Different concepts: one is a string naming a formula, the other an
  // integer naming an on-disk layout. Nothing derives one from the other.
  assert.equal(typeof SCHEMA_VERSION, "number");
  assert.equal(typeof TISSUE_LOAD_MODEL_VERSION, "string");
  assert.equal(String(TISSUE_LOAD_MODEL_VERSION).indexOf(String(SCHEMA_VERSION)) === -1 ||
               TISSUE_LOAD_MODEL_VERSION.indexOf("schema") === -1, true);
});

// ── Boundary: the domain layer stays framework-free ─────────────────────

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function walk(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap(function(d) {
    const p = resolve(dir, d.name);
    return d.isDirectory() ? walk(p) : (p.endsWith(".js") ? [p] : []);
  });
}

test("js/tissue/ never touches React, the DOM, storage, network or the clock", function() {
  const files = walk(resolve(ROOT, "js/tissue"));
  assert.ok(files.length >= 5);
  const forbidden = /\b(localStorage|sessionStorage|window|document|navigator|fetch|XMLHttpRequest|Date\.now|new Date|Math\.random|setTimeout)\b|from ["']react|utils\/storage/;
  files.forEach(function(f) {
    const src = readFileSync(f, "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
    assert.equal(forbidden.test(src), false, f + " must stay pure");
  });
});

test("Milestone 3 consumes the domain only through the pure presentation adapter", function() {
  const files = walk(resolve(ROOT, "js")).filter(function(f) { return f.indexOf("/js/tissue/") < 0; });
  files.forEach(function(f) {
    const src = readFileSync(f, "utf8");
    if (/from\s+["'][^"']*tissue\//.test(src)) {
      assert.equal(f, resolve(ROOT, "js/utils/tissueLoadView.js"), "Only the presentation adapter may import the domain");
    }
  });
});
