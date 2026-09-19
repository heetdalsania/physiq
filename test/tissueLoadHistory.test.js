/* ─── Tests — Milestone 4 longitudinal analytics (load-baseline-v0.1) ─────
 *
 * Daily aggregation, exact 7/28-day calendar windows, the athlete-relative
 * baseline and its sufficiency / zero / coverage / version rules. Entries
 * are synthetic tissue-history-v1 records; expected values are computed by
 * hand from the documented definitions.
 *
 * Run under TZ=America/Phoenix, TZ=America/New_York and TZ=UTC — the key
 * arithmetic is timezone-free and the local-day derivation is checked
 * across DST in the last group.
 * ───────────────────────────────────────────────────────────────────────── */

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  LOAD_BASELINE_VERSION, RECENT_WINDOW_DAYS, LONG_WINDOW_DAYS, BASELINE_PERIOD_DAYS, BASELINE_BLOCKS,
  addDays, dayKeyOf, dayRange, selectSeries, aggregateDaily, compareToBaseline, buildTissueLoadHistory
} from "../js/utils/tissueLoadHistory.js";
import { localDateKey, materializeTissueHistoryEntry } from "../js/utils/tissueHistorySnapshot.js";
import { TISSUE_IDS } from "../js/tissue/tissueDefinitions.js";

const D = "2026-03-31";                 // "today" for most cases
const day = n => addDays(D, n);         // D-6 → day(-6)
let seq = 0;
/* Synthetic entry. `tissues` = { id: workload }. */
function E(localDate, tissues, opts = {}) {
  const o = { completed: 1, modeled: 1, approx: false, ...opts };
  return {
    schemaVersion: "tissue-history-v1",
    sourceKey: o.key || (localDate + "#" + (seq++)),
    sourceId: 1, sourceFinishedAt: 0, sourceFingerprint: "fp1:0000000000000000:1",
    localDate, utcOffsetMinutes: 0,
    modelVersion: o.model || "tissue-load-v0.1", mapVersion: o.map || "exercise-tissue-map-v0.1", workloadUnit: o.unit || "lb*rep",
    inputs: { bodyMass: 180, weightUnit: "lb", bodyMassProvenance: { source: o.approx ? "profile_weight" : "weight_log", measurementDate: null, daysBefore: null, contemporaneous: !o.approx, approximate: o.approx } },
    tissues: Object.fromEntries(Object.entries(tissues).map(([id, w]) => [id, { workload: w, eventCount: 1, confidence: "low" }])),
    coverage: { completedSets: o.completed, modeledSets: o.modeled, unmappedExercises: [] },
    warnings: [], materializedAt: 0
  };
}
const build = (entries, today = D) => buildTissueLoadHistory(entries, { today });
const chest = h => h.tissues.chest;
const noNaN = h => {
  const json = JSON.stringify(h);
  assert.doesNotMatch(json, /NaN|Infinity/);
  Object.values(h.tissues).forEach(t => [t.today, t.recent7, t.recent28].forEach(v => assert.equal(Number.isFinite(v), true)));
  Object.values(h.tissues).forEach(t => ["delta", "ratio", "percent", "value"].forEach(k => assert.ok(t.baseline[k] === null || Number.isFinite(t.baseline[k]), k)));
};

// ── calendar arithmetic ─────────────────────────────────────────────────

test("day-key arithmetic is timezone-free and handles month, year and leap boundaries", () => {
  assert.equal(addDays("2026-03-01", -1), "2026-02-28");
  assert.equal(addDays("2028-02-28", 1), "2028-02-29");
  assert.equal(addDays("2028-02-29", 1), "2028-03-01");
  assert.equal(addDays("2025-12-31", 1), "2026-01-01");
  assert.equal(addDays("2026-03-10", -7), "2026-03-03");
  assert.equal(addDays("bad", 1), null);
  assert.equal(dayRange("2026-03-04", "2026-03-10").length, 7);
  assert.deepEqual(dayRange("2026-03-10", "2026-03-04"), []);
  assert.equal(dayKeyOf(new Date(2026, 2, 4, 23, 59)), "2026-03-04");
  assert.throws(() => dayKeyOf(new Date(NaN)));
  assert.throws(() => build([], "2026/03/31"));
  assert.equal(RECENT_WINDOW_DAYS, 7); assert.equal(LONG_WINDOW_DAYS, 28); assert.equal(BASELINE_PERIOD_DAYS, 28); assert.equal(BASELINE_BLOCKS, 4);
  assert.equal(LOAD_BASELINE_VERSION, "load-baseline-v0.1");
});

test("windows are exact calendar ranges ending today: recent D-6..D, long D-27..D, baseline D-34..D-7", () => {
  const h = build([E(D, { chest: 1 })]);
  assert.deepEqual([h.windows.recent.start, h.windows.recent.end], [day(-6), D]);
  assert.deepEqual([h.windows.long.start, h.windows.long.end], [day(-27), D]);
  assert.deepEqual([h.windows.baseline.start, h.windows.baseline.end], [day(-34), day(-7)]);
  assert.equal(h.windows.recent.days, 7); assert.equal(h.windows.long.days, 28); assert.equal(h.windows.baseline.days, 28);
});

// ── daily aggregation ───────────────────────────────────────────────────

test("no sessions → no history, all windows unobserved, every tissue zero and baseline insufficient", () => {
  for (const input of [[], null, undefined, "x"]) {
    const h = build(input);
    assert.equal(h.historyState, "no_history");
    assert.equal(h.firstObservedDate, null);
    assert.equal(h.windows.recent.state, "none");
    assert.equal(h.windows.baseline.state, "none");
    TISSUE_IDS.forEach(id => {
      assert.deepEqual(h.tissues[id], { tissueId: id, today: 0, recent7: 0, recent28: 0, baseline: { state: "insufficient_history", value: null, delta: null, ratio: null, percent: null, direction: null } });
    });
    noNaN(h);
  }
});

test("one session, several same-day sessions, several tissues and repeated tissues aggregate by day", () => {
  const one = build([E(D, { chest: 1000, triceps: 600 })]);
  assert.equal(one.historyState, "history");
  assert.equal(one.firstObservedDate, D);
  assert.equal(chest(one).today, 1000);
  assert.equal(one.tissues.triceps.recent7, 600);
  assert.equal(one.tissues.calves.recent7, 0);
  const daily = aggregateDaily([E(D, { chest: 1000, triceps: 600 }), E(D, { chest: 250.5, back: 10 }), E(day(-1), { chest: 4 })]);
  assert.deepEqual(daily[D].workload, { back: 10, chest: 1250.5, triceps: 600 });
  assert.equal(daily[D].sessionCount, 2);
  assert.equal(daily[D].completedSets, 2);
  assert.equal(daily[day(-1)].workload.chest, 4);
  const h = build([E(D, { chest: 1000 }), E(D, { chest: 250.5 }), E(day(-1), { chest: 4 })]);
  assert.equal(chest(h).today, 1250.5);
  assert.equal(chest(h).recent7, 1254.5);
  assert.equal(h.windows.recent.coverage.sessionCount, 3);
});

test("modeled zero, unmapped sets and partial coverage are distinguishable through coverage, not through workload", () => {
  const zero = build([E(D, { chest: 0 }, { completed: 1, modeled: 1 })]);
  const unmapped = build([E(D, {}, { completed: 3, modeled: 0 })]);
  const partial = build([E(D, { chest: 500 }, { completed: 5, modeled: 2 })]);
  assert.equal(chest(zero).recent7, 0);
  assert.equal(chest(unmapped).recent7, 0);
  assert.deepEqual(zero.windows.recent.coverage, { sessionCount: 1, completedSets: 1, modeledSets: 1, unmappedSets: 0 });
  assert.deepEqual(unmapped.windows.recent.coverage, { sessionCount: 1, completedSets: 3, modeledSets: 0, unmappedSets: 3 });
  assert.deepEqual(partial.windows.recent.coverage, { sessionCount: 1, completedSets: 5, modeledSets: 2, unmappedSets: 3 });
});

// ── 7-day and 28-day windows ────────────────────────────────────────────

test("7-day window: exactly seven calendar days, inclusive of D-6 and D, exclusive of D-7 and tomorrow", () => {
  const entries = [E(day(-7), { chest: 1 }), E(day(-6), { chest: 10 }), E(D, { chest: 100 }), E(day(1), { chest: 1000 }), E(day(-40), { chest: 5 })];
  const h = build(entries);
  assert.equal(chest(h).recent7, 110);
  assert.equal(h.windows.recent.observedDays, 7);
  assert.equal(h.windows.recent.state, "complete");
  assert.equal(chest(h).today, 100);
});

test("28-day window: exactly 28 calendar days, boundary-inclusive, and sparse training is valid", () => {
  const entries = [E(day(-28), { chest: 1 }), E(day(-27), { chest: 10 }), E(day(-13), { chest: 100 }), E(D, { chest: 1000 })];
  const h = build(entries);
  assert.equal(chest(h).recent28, 1110);
  assert.equal(h.windows.long.state, "complete");
  assert.equal(h.windows.long.coverage.sessionCount, 3);
  // trains twice in 28 days: still complete, zero days are real zeros
  const sparse = build([E(day(-60), { chest: 5 }), E(day(-20), { chest: 300 }), E(day(-3), { chest: 300 })]);
  assert.equal(sparse.windows.long.state, "complete");
  assert.equal(chest(sparse).recent28, 600);
  assert.equal(sparse.windows.long.unobservedDays, 0);
});

test("first-observation rule: days before the first entry are unobserved, never padded as zero", () => {
  const h = build([E(day(-2), { chest: 100 }), E(D, { chest: 50 })]);
  assert.equal(h.firstObservedDate, day(-2));
  assert.equal(h.windows.recent.state, "partial");
  assert.equal(h.windows.recent.observedDays, 3);
  assert.equal(h.windows.recent.unobservedDays, 4);
  assert.equal(h.windows.long.observedDays, 3);
  assert.equal(h.windows.baseline.state, "none");
  assert.equal(h.windows.baseline.observedDays, 0);
  assert.equal(chest(h).recent7, 150, "the sum over observed days is still reported");
  assert.equal(chest(h).baseline.state, "insufficient_history");
});

// ── baseline ────────────────────────────────────────────────────────────

const BASE = () => [E(day(-34), { chest: 400 }), E(day(-20), { chest: 400 }), E(day(-8), { chest: 400 }), E(day(-7), { chest: 400 })];   // Σ 1600 → 400 per 7 days

test("baseline = Σ(D-34..D-7) ÷ 4, dimensionally comparable with the 7-day sum; above / below / equal", () => {
  const above = build(BASE().concat(E(D, { chest: 480 })));
  assert.equal(above.windows.baseline.state, "complete");
  assert.deepEqual(chest(above).baseline, { state: "available", value: 400, delta: 80, ratio: 1.2, percent: 20, direction: "above" });
  const below = build(BASE().concat(E(D, { chest: 300 })));
  assert.equal(chest(below).baseline.direction, "below");
  assert.equal(chest(below).baseline.delta, -100);
  assert.equal(chest(below).baseline.percent, -25);
  const equal = build(BASE().concat(E(day(-3), { chest: 400 })));
  assert.equal(chest(equal).baseline.direction, "equal");
  assert.equal(chest(equal).baseline.percent, 0);
  assert.equal(chest(equal).baseline.delta, 0);
  // a 7-day sum is never compared with the raw 28-day sum
  assert.notEqual(chest(above).baseline.value, 1600);
});

test("first eligible date: the baseline needs the whole D-34..D-7 period observed — D-34 qualifies, D-33 does not", () => {
  const eligible = build([E(day(-34), { chest: 100 }), E(D, { chest: 100 })]);
  assert.equal(eligible.windows.baseline.state, "complete");
  assert.equal(chest(eligible).baseline.state, "available");
  assert.equal(chest(eligible).baseline.value, 25);
  const notYet = build([E(day(-33), { chest: 100 }), E(D, { chest: 100 })]);
  assert.equal(notYet.windows.baseline.state, "partial");
  assert.equal(notYet.windows.baseline.observedDays, 27);
  assert.equal(chest(notYet).baseline.state, "insufficient_history");
  assert.equal(chest(notYet).baseline.value, null);
});

test("a zero baseline yields a safe zero_baseline state — never Infinity, NaN or an invented percentage", () => {
  const h = build([E(day(-40), { chest: 5 }), E(D, { chest: 100 })]);
  assert.equal(h.windows.baseline.state, "complete");
  assert.deepEqual(chest(h).baseline, { state: "zero_baseline", value: 0, delta: null, ratio: null, percent: null, direction: null });
  assert.equal(h.windows.baseline.coverage.completedSets, 0);
  noNaN(h);
  // baseline period trained, but every set unmapped
  const unmappedBase = build([E(day(-40), { chest: 5 }), E(day(-20), {}, { completed: 4, modeled: 0 }), E(D, { chest: 100 })]);
  assert.equal(chest(unmappedBase).baseline.state, "zero_baseline");
  assert.deepEqual(unmappedBase.windows.baseline.coverage, { sessionCount: 1, completedSets: 4, modeledSets: 0, unmappedSets: 4 });
  // baseline period modeled for other tissues but zero for this one
  const otherTissue = build([E(day(-40), { chest: 5 }), E(day(-20), { calves: 90 }), E(D, { chest: 100 })]);
  assert.equal(chest(otherTissue).baseline.state, "zero_baseline");
  assert.equal(otherTissue.tissues.calves.baseline.state, "available");
  assert.equal(otherTissue.tissues.calves.baseline.value, 22.5);
  assert.equal(compareToBaseline(10, { state: "complete", workload: {} }, "chest").state, "zero_baseline");
  assert.equal(compareToBaseline(10, null, "chest").state, "insufficient_history");
});

test("extreme and unbounded comparisons stay finite and unclamped; sums use six-decimal canonical rounding", () => {
  const huge = build(BASE().concat(E(D, { chest: 4000000 })));
  assert.equal(chest(huge).baseline.percent, 999900);
  assert.equal(chest(huge).baseline.direction, "above");
  const tiny = build(BASE().concat(E(D, { chest: 0.000001 })));
  assert.equal(chest(tiny).baseline.direction, "below");
  assert.ok(chest(tiny).baseline.percent < -99.99);
  const frac = build([E(day(-34), { chest: 0.1 }), E(day(-30), { chest: 0.2 }), E(day(-20), { chest: 0.3 }), E(D, { chest: 0.6 })]);
  assert.equal(chest(frac).recent7, 0.6);
  assert.equal(chest(frac).baseline.value, 0.15);
  noNaN(huge); noNaN(tiny); noNaN(frac);
});

test("output is deterministic and independent of entry order", () => {
  const entries = BASE().concat(E(D, { chest: 480, calves: 1 }), E(day(-3), { back: 7 }));
  const a = build(entries);
  const b = build(entries.slice().reverse());
  assert.deepEqual(a, b);
  assert.equal(JSON.stringify(a), JSON.stringify(build(entries)));
});

// ── coverage across compared periods ────────────────────────────────────

test("recent and baseline coverage are exposed separately; changed mapping coverage is visible, never rescaled", () => {
  const entries = BASE().map(e => ({ ...e, coverage: { completedSets: 10, modeledSets: 2, unmappedExercises: ["Rowing"] } }))
    .concat(E(D, { chest: 480 }, { completed: 10, modeled: 10 }));
  const h = build(entries);
  assert.deepEqual(h.windows.recent.coverage, { sessionCount: 1, completedSets: 10, modeledSets: 10, unmappedSets: 0 });
  assert.deepEqual(h.windows.baseline.coverage, { sessionCount: 4, completedSets: 40, modeledSets: 8, unmappedSets: 32 });
  assert.equal(chest(h).baseline.value, 400, "computed from modeled data only; unmapped work is not inferred");
  const allUnmappedRecent = build(BASE().concat(E(D, {}, { completed: 6, modeled: 0 })));
  assert.equal(chest(allUnmappedRecent).recent7, 0);
  assert.equal(chest(allUnmappedRecent).baseline.direction, "below");
  assert.equal(allUnmappedRecent.windows.recent.coverage.modeledSets, 0);
});

test("approximate historical context is counted per window and surfaced as a warning, without touching the numbers", () => {
  const entries = BASE().map((e, i) => (i === 0 ? { ...e, inputs: { ...e.inputs, bodyMassProvenance: { ...e.inputs.bodyMassProvenance, source: "profile_weight", approximate: true } } } : e))
    .concat(E(D, { chest: 480 }, { approx: true }));
  const h = build(entries);
  assert.deepEqual(h.warnings, ["approximate_historical_context"]);
  assert.equal(h.windows.recent.approximateSessions, 1);
  assert.equal(h.windows.baseline.approximateSessions, 1);
  assert.equal(h.windows.span.approximateSessions, 2, "the D-34..D union counts each session once");
  assert.deepEqual([h.windows.span.start, h.windows.span.end, h.windows.span.days], [day(-34), D, 35]);
  assert.equal(chest(h).baseline.value, 400);
  assert.deepEqual(build(BASE()).warnings, []);
});

// ── model / map version compatibility ───────────────────────────────────

test("a synthetic future model version is never aggregated with v0.1, in either direction", () => {
  const foreign = [E(day(-20), { chest: 99999 }, { model: "tissue-load-v0.2" }), E(day(-1), { chest: 99999 }, { map: "exercise-tissue-map-v0.2" }), E(D, { chest: 99999 }, { unit: "kg*rep" })];
  const h = build(BASE().concat(E(D, { chest: 480 }), foreign));
  assert.equal(h.otherSeriesEntries, 3);
  assert.deepEqual(h.warnings, ["other_model_series"]);
  assert.equal(chest(h).recent7, 480);
  assert.equal(chest(h).baseline.value, 400);
  assert.equal(h.modelVersion, "tissue-load-v0.1");
  // an explicit series selection sees only its own entries
  const v2 = buildTissueLoadHistory(BASE().concat(foreign), { today: D, series: { modelVersion: "tissue-load-v0.2", mapVersion: "exercise-tissue-map-v0.1", workloadUnit: "lb*rep" } });
  assert.equal(v2.entryCount, 1);
  assert.equal(v2.firstObservedDate, day(-20));
  assert.equal(chest(v2).recent28, 99999);
  assert.equal(chest(v2).baseline.state, "insufficient_history", "v0.1 history cannot serve as a v0.2 baseline");
  assert.equal(v2.otherSeriesEntries, 6);
  const sel = selectSeries(BASE().concat(foreign, ["junk", null]));
  assert.equal(sel.entries.length, 4); assert.equal(sel.otherSeriesEntries, 3); assert.equal(sel.invalidEntries, 2);
});

test("duplicate and invalid entries are counted and excluded, never doubled", () => {
  const dup = E(D, { chest: 100 }, { key: "same" });
  const h = build([dup, structuredClone(dup), { schemaVersion: "tissue-history-v1" }, E(D, { chest: 1 }, { key: "other" })]);
  assert.equal(chest(h).today, 101);
  assert.equal(h.duplicateEntries, 1);
  assert.equal(h.invalidEntries, 1);
  assert.equal(h.entryCount, 2);
  assert.ok(h.warnings.includes("invalid_entries"));
});

test("a Date `today` is read as its local calendar day", () => {
  const h = build([E("2026-03-31", { chest: 3 })], new Date(2026, 2, 31, 23, 59));
  assert.equal(h.today, "2026-03-31");
  assert.equal(chest(h).today, 3);
});

// ── time zones / DST (run with TZ=America/Phoenix, America/New_York, UTC) ─

test("end-to-end: frozen local days survive DST transitions and windows count exactly seven calendar days across them", () => {
  const local = (y, m, d, h, min = 0) => new Date(y, m - 1, d, h, min).getTime();
  const mk = (id, ms) => ({ id, finishedAt: ms, exercises: [{ name: "Barbell Bench Press", sets: [{ reps: 10, weight: 100, done: true }] }] });
  const ctx = { ordinal: 0, weightLog: [], currentWeight: 180, materializedAt: local(2026, 3, 12, 12) };
  const springEntries = [
    mk(1, local(2026, 3, 7, 23, 30)),   // Saturday night before US DST start
    mk(2, local(2026, 3, 8, 1, 30)),    // DST start day, before the jump
    mk(3, local(2026, 3, 8, 23, 59)),   // still Mar 8
    mk(4, local(2026, 3, 9, 0, 0)),     // first instant of Mar 9
    mk(5, local(2026, 3, 14, 12))
  ].map((s, i) => materializeTissueHistoryEntry(s, { ...ctx, ordinal: 0 }));
  assert.deepEqual(springEntries.map(e => e.localDate), ["2026-03-07", "2026-03-08", "2026-03-08", "2026-03-09", "2026-03-14"]);
  const h = buildTissueLoadHistory(springEntries, { today: new Date(2026, 2, 14, 12) });
  assert.deepEqual([h.windows.recent.start, h.windows.recent.end], ["2026-03-08", "2026-03-14"]);
  assert.equal(h.windows.recent.observedDays, 7);
  assert.equal(chest(h).recent7, 4000, "Mar 8 (×2), Mar 9 and Mar 14; Mar 7 is outside");
  assert.equal(chest(h).recent28, 5000);
  const fall = [mk(6, local(2026, 11, 1, 1, 30)), mk(7, local(2026, 10, 31, 23, 59)), mk(8, local(2026, 11, 1, 0, 0))].map(s => materializeTissueHistoryEntry(s, ctx));
  assert.deepEqual(fall.map(e => e.localDate), ["2026-11-01", "2026-10-31", "2026-11-01"]);
  const hf = buildTissueLoadHistory(fall, { today: new Date(2026, 10, 1, 20) });
  assert.equal(chest(hf).today, 2000);
  assert.equal(chest(hf).recent7, 3000);
  assert.equal(localDateKey(local(2026, 3, 8, 12)), dayKeyOf(new Date(2026, 2, 8, 12)));
});
