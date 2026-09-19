import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { buildTissueLoadView, tissuePeriodBounds } from "../js/utils/tissueLoadView.js";
import { estimateSessionTissueLoad, estimateSetTissueLoad } from "../js/tissue/loadEngine.js";
import { getWeekStart } from "../js/utils/weeklyReport.js";

const now = new Date(2026, 2, 4, 12);
const done = (weight = 100, reps = 10) => ({ weight, reps, done: true });
const ex = (name = "Barbell Bench Press", sets = [done()]) => ({ name, sets });
const session = (exercises = [ex()], finishedAt = now.getTime()) => ({ finishedAt, exercises });
const view = (log = [], extra = {}) => buildTissueLoadView(log, { now, bodyMass: 180, ...extra });
const tissue = (v, id = "chest") => v.tissues.find(t => t.id === id);

function freezeDeep(value) {
  if (value && typeof value === "object") { Object.values(value).forEach(freezeDeep); Object.freeze(value); }
  return value;
}

test("empty period and unsupported historical shapes are safe", () => {
  for (const history of [[], undefined, null, {}, "bad"]) {
    const result = view(history);
    assert.equal(result.state, "empty");
    assert.equal(result.completedSets, 0);
    assert.ok(result.tissues.every(t => t.displayIntensity === 0 && t.confidence === null && !t.hasModeledContribution));
  }
});

test("today is local midnight inclusive to next midnight exclusive", () => {
  const start = new Date(2026, 2, 4).getTime();
  const end = new Date(2026, 2, 5).getTime();
  assert.deepEqual(tissuePeriodBounds(now), { start, end });
  const result = view([start - 1, start, start + 3600000, end - 1, end].map(t => session([ex()], t)));
  assert.equal(result.sessionCount, 3);
  assert.equal(tissue(result).totalWorkload, 3000);
});

test("current week matches existing Monday–Sunday semantics, including Sunday and next Monday", () => {
  const monday = getWeekStart(now).getTime();
  const end = new Date(2026, 2, 9).getTime();
  assert.deepEqual(tissuePeriodBounds(now, "week"), { start: monday, end });
  const log = [monday - 1, monday, now.getTime(), end - 1, end].map(t => session([ex()], t));
  assert.equal(view(log, { period: "week" }).sessionCount, 3);
  assert.equal(view(log, { period: "week", now: new Date(2026, 2, 8, 23) }).sessionCount, 3);
  assert.equal(view(log, { period: "week", now: new Date(end) }).sessionCount, 1);
});

test("calendar bounds use local dates across DST, not fixed 24-hour or 7-day milliseconds", () => {
  const date = new Date(2026, 2, 8, 12);
  const bounds = tissuePeriodBounds(date);
  assert.equal(bounds.start, new Date(2026, 2, 8).getTime());
  assert.equal(bounds.end, new Date(2026, 2, 9).getTime());
  assert.equal(view([session([ex()], new Date(2026, 2, 8, 23, 59).getTime())], { now: date }).sessionCount, 1);
});

test("bad timestamps and unfinished records are excluded, never reinterpreted as today", () => {
  const log = [null, {}, { startedAt: now.getTime(), exercises: [ex()] }, ...[null, "1772637000000", "bad", Infinity, NaN, 9e20].map(finishedAt => session([ex()], finishedAt))];
  const result = view(log);
  assert.equal(result.state, "empty");
  assert.equal(result.excludedRecords, log.length);
  assert.throws(() => tissuePeriodBounds(new Date(NaN)));
  assert.throws(() => tissuePeriodBounds(now, "rolling"));
});

test("finished sessions with absent/malformed exercise arrays and sets do not crash", () => {
  const result = view([{ finishedAt: now.getTime() }, session([null, {}, { sets: {} }, ex("Squat", [null])])]);
  assert.equal(result.sessionCount, 2);
  assert.equal(result.state, "no-completed-sets");
});

test("only strict done:true contributes at set, session and period levels", () => {
  const sets = [done(), ...[false, undefined, 1, "true"].map(flag => ({ ...done(9999), done: flag }))];
  sets.slice(1).forEach(s => assert.equal(estimateSetTissueLoad(ex(), s).tissueWorkloads.length, 0));
  const input = session([ex("Barbell Bench Press", sets)]);
  assert.equal(estimateSessionTissueLoad(input).tissues.chest.totalWorkload, 1000);
  const result = view([input]);
  assert.equal(result.completedSets, 1);
  assert.equal(result.modeledSets, 1);
  assert.equal(tissue(result).totalWorkload, 1000);
});

test("period totals consume unchanged domain events and reconcile with contributors", () => {
  const log = [session([ex("Squat"), ex("Romanian Deadlift")]), session([ex("Squat"), ex("Lying Leg Curl")])];
  const events = log.flatMap(s => estimateSessionTissueLoad(s, { bodyMass: 180 }).events);
  const result = view(log);
  result.tissues.forEach(t => {
    const expected = events.filter(e => e.tissueId === t.id).reduce((n, e) => n + e.workload, 0);
    assert.equal(t.totalWorkload, expected);
    assert.equal(t.contributors.reduce((n, c) => n + c.workload, 0), t.totalWorkload);
  });
  assert.equal(tissue(result, "hamstrings").contributors.find(c => c.exerciseName === "Squat").setCount, 2);
});

test("contributors combine repeated canonical exercise names across sessions and sort by workload then name", () => {
  const result = view([session([ex("Barbell Row"), ex("Lat Pulldown"), ex("Seated Cable Row")]), session([ex(" barbell row ")])]);
  assert.deepEqual(tissue(result, "back").contributors.map(c => [c.exerciseName, c.workload]), [["Barbell Row", 2000], ["Lat Pulldown", 1000], ["Seated Cable Row", 1000]]);
});

test("aggregation and tie order are independent of input exercise/session order", () => {
  const log = [session([ex("Squat"), ex("Romanian Deadlift")]), session([ex("Squat"), ex("Lying Leg Curl")])];
  assert.deepEqual(view(log), view(log.slice().reverse().map(s => ({ ...s, exercises: s.exercises.slice().reverse() }))));
});

test("coverage counts completed sets, including completely unmapped activity", () => {
  assert.equal(view([session()]).modeledSets, 1);
  const mixed = view([session([ex(), ex("Unknown long exercise", [done(), { ...done(), done: false }]), ex("Unused", [{ done: false }])])]);
  assert.equal(mixed.completedSets, 2);
  assert.equal(mixed.modeledSets, 1);
  assert.deepEqual(mixed.unmappedExercises, ["Unknown long exercise"]);
  assert.equal(mixed.state, "modeled");
  const unknown = view([session([ex("__proto__"), ex("constructor")])]);
  assert.equal(unknown.state, "unmapped");
  assert.equal(unknown.completedSets, 2);
  assert.equal(unknown.modeledSets, 0);
  assert.ok(unknown.tissues.every(t => !t.hasModeledContribution));
});

test("modeled zero is distinct from no mapped contribution and retains provenance", () => {
  const result = view([session([ex("Barbell Bench Press", [done(0)])])]);
  assert.equal(result.state, "modeled");
  assert.equal(result.modeledSets, 1);
  assert.equal(tissue(result).totalWorkload, 0);
  assert.equal(tissue(result).hasModeledContribution, true);
  assert.equal(tissue(result).contributors[0].workload, 0);
  assert.equal(tissue(result, "calves").hasModeledContribution, false);
  assert.ok(result.tissues.every(t => t.displayIntensity === 0));
});

test("display-only intensity is bounded, max-relative, and does not clamp raw workload over 100", () => {
  const result = view([session()]);
  assert.equal(tissue(result).totalWorkload, 1000);
  assert.equal(tissue(result).displayIntensity, 1);
  assert.equal(tissue(result, "triceps").displayIntensity, 0.6);
  assert.ok(result.tissues.every(t => t.displayIntensity >= 0 && t.displayIntensity <= 1));
  assert.equal(tissue(view([session([ex("Barbell Bench Press", [done(1, 1)])])])).displayIntensity, 1);
  assert.equal(result.workloadUnit, "lb*rep");
  assert.equal(result.modelVersion, "tissue-load-v0.1");
  assert.doesNotMatch(JSON.stringify(estimateSessionTissueLoad(session())), /displayIntensity|loadScore/);
});

test("confidence follows committed weakest-link rule across sessions, including default mass", () => {
  const result = view([session([ex("Romanian Deadlift")]), session([ex("Squat")])]);
  assert.equal(tissue(result, "hamstrings").confidence, "low");
  assert.equal(tissue(result, "quadriceps").confidence, "medium");
  assert.equal(tissue(result, "patellar_tendon").confidence, "low");
  assert.equal(tissue(result).confidence, null);
  assert.ok(result.tissues.every(t => [null, "low", "medium", "high"].includes(t.confidence)));
  const assumed = view([session([ex("Squat")])], { bodyMass: undefined });
  assert.equal(tissue(assumed, "quadriceps").confidence, "low");
  assert.ok(assumed.warnings.includes("default_body_mass"));
});

test("optional metadata on completed and incomplete sets leaves the full view unchanged", () => {
  const log = [session([ex("Squat", [done(), { ...done(), done: false }])])];
  const decorated = structuredClone(log);
  decorated[0].exercises[0].sets.forEach(s => Object.assign(s, { rir: 0, side: "left", tempo: { eccentricSeconds: 9 }, rom: "partial" }));
  assert.deepEqual(view(decorated), view(log));
});

test("profiles derive independent results and coverage with no shared cache", () => {
  const a = [session([ex("Squat"), ex("Unmapped A")])];
  const b = [session([ex("Dumbbell Curl")])];
  const first = view(a);
  const second = view(b, { bodyMass: 142 });
  assert.equal(tissue(second, "quadriceps").hasModeledContribution, false);
  assert.deepEqual(second.unmappedExercises, []);
  assert.equal(tissue(first, "biceps").hasModeledContribution, false);
  assert.deepEqual(view(a), first);
});

test("calculation cannot access storage and leaves deeply frozen history unchanged", () => {
  const log = freezeDeep([session()]);
  const before = JSON.stringify(log);
  const original = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
  Object.defineProperty(globalThis, "localStorage", { configurable: true, get() { throw new Error("Storage access forbidden"); } });
  try { assert.equal(view(log).modeledSets, 1); }
  finally { delete globalThis.localStorage; if (original) Object.defineProperty(globalThis, "localStorage", original); }
  assert.equal(JSON.stringify(log), before);
});

test("UI and adapter add no persistence APIs, score or model writes", () => {
  for (const file of ["js/utils/tissueLoadView.js", "js/components/TissueLoadTracker.js"]) {
    const code = readFileSync(new URL("../" + file, import.meta.url), "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
    assert.doesNotMatch(code, /localStorage|sessionStorage|indexedDB|utils\/storage|loadScore|setItem/);
  }
});
