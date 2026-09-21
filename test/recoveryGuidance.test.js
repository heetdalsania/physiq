import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  buildRecoveryGuidance,
  RECOVERY_GUIDANCE_VERSION
} from "../js/utils/tissueRecoveryGuidance.js";
import { addDays } from "../js/utils/tissueLoadHistory.js";

const TODAY = "2026-03-31";
const NOW = new Date(2026, 2, 31, 12, 0, 0, 0);
let sequence = 0;

function atLocalNoon(key) {
  const parts = key.split("-").map(Number);
  return new Date(parts[0], parts[1] - 1, parts[2], 12, 0, 0, 0).getTime();
}

function historyEntry(day, tissues, options) {
  const opts = options || {};
  sequence++;
  return {
    schemaVersion: "tissue-history-v1",
    sourceKey: day + "#guidance-" + sequence,
    sourceId: sequence,
    sourceFinishedAt: opts.finishedAt === undefined ? atLocalNoon(day) : opts.finishedAt,
    sourceFingerprint: "fp1:0000000000000000:1",
    localDate: day,
    utcOffsetMinutes: 0,
    modelVersion: opts.modelVersion || "tissue-load-v0.1",
    mapVersion: "exercise-tissue-map-v0.1",
    workloadUnit: "lb*rep",
    inputs: {
      bodyMass: 180,
      weightUnit: "lb",
      bodyMassProvenance: {
        source: "weight_log",
        measurementDate: day,
        daysBefore: 0,
        contemporaneous: true,
        approximate: opts.approximate === true
      }
    },
    tissues: Object.fromEntries(Object.entries(tissues).map(function(pair) {
      return [pair[0], { workload: pair[1], eventCount: 1, confidence: opts.confidence || "low" }];
    })),
    coverage: {
      completedSets: opts.completedSets === undefined ? 1 : opts.completedSets,
      modeledSets: opts.modeledSets === undefined ? 1 : opts.modeledSets,
      unmappedExercises: []
    },
    warnings: [],
    materializedAt: atLocalNoon(day)
  };
}

function muscle(result, id) {
  return result.muscles.find(function(item) { return item.tissueId === id; });
}

test("v0.1 replaces timers with versioned descriptive load context", function() {
  const recentDay = addDays(TODAY, -1);
  const finishedAt = atLocalNoon(recentDay);
  const result = buildRecoveryGuidance([
    historyEntry(recentDay, { hamstrings: 240 }, { finishedAt: finishedAt, confidence: "medium" }),
    historyEntry(TODAY, { hamstrings: 160 }, { confidence: "low" })
  ], { now: NOW });

  const hamstrings = muscle(result, "hamstrings");
  assert.equal(result.guidanceVersion, RECOVERY_GUIDANCE_VERSION);
  assert.equal(result.guidanceVersion, "recovery-guidance-v0.1");
  assert.equal(result.modelVersion, "tissue-load-v0.1");
  assert.equal(result.analyticsVersion, "load-baseline-v0.1");
  assert.deepEqual(result.recentWindow, { start: "2026-03-25", end: TODAY, days: 7 });
  assert.equal(hamstrings.state, "recent_modeled_load");
  assert.equal(hamstrings.recentSessionCount, 2);
  assert.equal(hamstrings.recent7, 400);
  assert.equal(hamstrings.recent28, 400);
  assert.equal(hamstrings.lastLoadedAt, atLocalNoon(TODAY));
  assert.equal(hamstrings.hoursSinceLastLoad, 0);
  assert.equal(hamstrings.latestSessionWorkload, 160);
  assert.equal(hamstrings.modelConfidence, "low", "weakest relevant model confidence is retained");
});

test("states describe record presence, never biological readiness", function() {
  const oldDay = addDays(TODAY, -20);
  const result = buildRecoveryGuidance([
    historyEntry(oldDay, { chest: 100 })
  ], { now: NOW });

  assert.equal(muscle(result, "chest").state, "no_recent_modeled_load");
  assert.equal(muscle(result, "quadriceps").state, "no_modeled_history");
  assert.equal(muscle(result, "chest").recentSessionCount, 0);
  assert.equal(muscle(result, "chest").recent7, 0);
  assert.equal(result.muscles.length, 10, "only the ten modeled muscle regions are shown");

  const serialized = JSON.stringify(result);
  ["ready", "readiness", "hoursLeft", "progress", "healed", "capacity", "risk"].forEach(function(term) {
    assert.equal(serialized.includes(term), false, "unsupported output field/value: " + term);
  });
});

test("baseline comparison is inherited exactly without a recovery threshold", function() {
  const entries = [
    historyEntry(addDays(TODAY, -34), { hamstrings: 100 }),
    historyEntry(addDays(TODAY, -27), { hamstrings: 100 }),
    historyEntry(addDays(TODAY, -20), { hamstrings: 100 }),
    historyEntry(addDays(TODAY, -7), { hamstrings: 100 }),
    historyEntry(TODAY, { hamstrings: 150 })
  ];
  const result = buildRecoveryGuidance(entries, { now: NOW });
  const baseline = muscle(result, "hamstrings").baseline;

  assert.equal(baseline.state, "available");
  assert.equal(baseline.value, 100);
  assert.equal(baseline.percent, 50);
  assert.equal(baseline.direction, "above");
  assert.equal(Object.keys(baseline).some(function(key) { return /status|recovery|ready|safe/i.test(key); }), false);
});

test("foreign, future and invalid entries never enter current guidance", function() {
  const future = addDays(TODAY, 1);
  const invalid = historyEntry(TODAY, { hamstrings: -1 });
  const result = buildRecoveryGuidance([
    historyEntry(TODAY, { hamstrings: 100 }),
    historyEntry(TODAY, { hamstrings: 99999 }, { modelVersion: "tissue-load-v0.2" }),
    historyEntry(future, { hamstrings: 88888 }),
    invalid
  ], { now: NOW });

  assert.equal(muscle(result, "hamstrings").recent7, 100);
  assert.ok(result.warnings.includes("other_model_series"));
  assert.ok(result.warnings.includes("future_entries"));
  assert.ok(result.warnings.includes("invalid_entries"));
});

test("partial mapping and unavailable completion time remain visible", function() {
  const result = buildRecoveryGuidance([
    historyEntry(TODAY, { chest: 100 }, { finishedAt: null, completedSets: 3, modeledSets: 1 })
  ], { now: NOW });

  assert.equal(muscle(result, "chest").lastLoadedAt, null);
  assert.equal(muscle(result, "chest").hoursSinceLastLoad, null);
  assert.ok(result.warnings.includes("partial_mapping"));
  assert.ok(result.warnings.includes("missing_completion_time"));
});

test("empty input is deterministic, pure and requires an explicit clock", function() {
  const entries = Object.freeze([]);
  const first = buildRecoveryGuidance(entries, { now: NOW });
  const second = buildRecoveryGuidance(entries, { now: NOW });
  assert.deepEqual(first, second);
  assert.equal(first.state, "no_history");
  assert.equal(first.muscles.every(function(item) { return item.state === "no_modeled_history"; }), true);
  assert.throws(function() { buildRecoveryGuidance(entries); }, /valid current date/);
});

test("the guidance adapter has no storage, network or implicit-clock access", function() {
  const source = readFileSync(new URL("../js/utils/tissueRecoveryGuidance.js", import.meta.url), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/.*$/gm, "");
  assert.doesNotMatch(source, /\b(localStorage|sessionStorage|window|document|navigator|fetch|XMLHttpRequest|Date\.now|Math\.random)\b/);
  assert.doesNotMatch(source, /from ["']react|utils\/storage/);
});

test("the retired fixed-hour recovery model is absent from production source", function() {
  const tracker = readFileSync(new URL("../js/components/RecoveryTracker.js", import.meta.url), "utf8");
  const constants = readFileSync(new URL("../js/data/constants.js", import.meta.url), "utf8");
  assert.doesNotMatch(tracker, /RECOVERY_HOURS|hoursLeft|Ready to Train|Ready in /);
  assert.doesNotMatch(constants, /\brecovery\s*:/);
});

test("a completion later today is excluded from exposure and frequency until it occurs", function() {
  const future = historyEntry(TODAY, { chest: 900 }, { finishedAt: NOW.getTime() + 3600000 });
  const past = historyEntry(TODAY, { chest: 100 }, { finishedAt: NOW.getTime() - 3600000 });
  const result = buildRecoveryGuidance([past, future], { now: NOW });
  assert.equal(muscle(result, "chest").recent7, 100);
  assert.equal(muscle(result, "chest").recentSessionCount, 1);
  assert.equal(muscle(result, "chest").hoursSinceLastLoad, 1);
  assert.ok(result.warnings.includes("future_entries"));
  const later = buildRecoveryGuidance([past, future], { now: new Date(NOW.getTime() + 3600000) });
  assert.equal(muscle(later, "chest").recent7, 1000);
  assert.equal(muscle(later, "chest").recentSessionCount, 2);
});

test("missing completion or confidence cannot silently inherit certainty from another entry", function() {
  const dated = historyEntry(addDays(TODAY, -1), { chest: 100 }, { confidence: "medium" });
  const unknown = historyEntry(TODAY, { chest: 100 }, { finishedAt: null });
  delete unknown.tissues.chest.confidence;
  const result = buildRecoveryGuidance([dated, unknown], { now: NOW });
  assert.equal(muscle(result, "chest").lastLoadedAt, null);
  assert.equal(muscle(result, "chest").modelConfidence, null);
  assert.ok(result.warnings.includes("missing_completion_time"));
});

test("baseline-only mapping gaps remain visible even with fully mapped recent work", function() {
  const result = buildRecoveryGuidance([
    historyEntry(addDays(TODAY, -34), { chest: 400 }, { completedSets: 10, modeledSets: 1 }),
    historyEntry(TODAY, { chest: 150 })
  ], { now: NOW });
  assert.ok(result.warnings.includes("partial_mapping"));
  assert.equal(result.recentCoverage.modeledSets, result.recentCoverage.completedSets);
  assert.equal(result.baselineCoverage.modeledSets, 1);
  assert.equal(result.baselineCoverage.completedSets, 10);
});

test("tied completion times and overflowing totals stay deterministic with frozen inputs", function() {
  const entries = [historyEntry(TODAY, { chest: 1e308 }), historyEntry(TODAY, { chest: 1e308 })];
  function freeze(value) {
    if (value && typeof value === "object") { Object.values(value).forEach(freeze); Object.freeze(value); }
    return value;
  }
  freeze(entries);
  const result = buildRecoveryGuidance(entries, { now: NOW });
  assert.equal(muscle(result, "chest").recent7, null);
  assert.deepEqual(result, buildRecoveryGuidance(entries.slice().reverse(), { now: NOW }));
});
