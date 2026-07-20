/* ─── Tests — weekly report aggregation ──────────────────────────────────── */

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  dayKey,
  getWeekStart,
  getReportWeekStart,
  getWeekDays,
  getPhase,
  aggregateNutrition,
  aggregateTraining,
  weeklySetTotals,
  selectWinOfWeek,
  buildNutritionNudge,
  buildTrainingNudge,
  getTone,
  buildWeeklyReport
} from "../js/utils/weeklyReport.js";

// Report week used throughout: Mon Jul 6 – Sun Jul 12, 2026.
const WEEK_START = new Date(2026, 6, 6);

// Targets shaped like calcTargets output (only fields the report reads).
const TARGETS = { calories: 2800, protein: 160, carbs: 300, fats: 80 };

// history entries use Date.toDateString() keys, like App.js writes them.
function histDay(dayOffset, values) {
  const d = new Date(WEEK_START);
  d.setDate(d.getDate() + dayOffset);
  return Object.assign({ date: d.toDateString(), protein: 160, carbs: 300, fats: 80 }, values);
}

let nextId = 1;
function sessionOn(dayOffset, exercises) {
  const d = new Date(WEEK_START);
  d.setDate(d.getDate() + dayOffset);
  d.setHours(18, 0, 0, 0);
  return { id: nextId++, finishedAt: d.getTime(), exercises: exercises };
}
function ex(name, doneSets, weight, reps) {
  const sets = [];
  for (let i = 0; i < doneSets; i++) sets.push({ weight: weight || 100, reps: reps || 8, done: true });
  return { name: name, sets: sets };
}

// ── Week boundaries ─────────────────────────────────────────────────────

test("getWeekStart returns Monday 00:00 for every weekday", function() {
  // Jul 6 2026 is a Monday.
  for (let i = 0; i < 7; i++) {
    const d = new Date(2026, 6, 6 + i, 15, 30);
    const ws = getWeekStart(d);
    assert.equal(dayKey(ws), "2026-07-06", "offset " + i);
    assert.equal(ws.getHours(), 0);
  }
});

test("getReportWeekStart: Sunday shows the closing week, other days the last closed week", function() {
  // Sunday Jul 12 → current week (Mon Jul 6).
  assert.equal(dayKey(getReportWeekStart(new Date(2026, 6, 12))), "2026-07-06");
  // Wednesday Jul 15 → previous week (Mon Jul 6).
  assert.equal(dayKey(getReportWeekStart(new Date(2026, 6, 15))), "2026-07-06");
  // Monday Jul 13 → the week that ended yesterday (Mon Jul 6).
  assert.equal(dayKey(getReportWeekStart(new Date(2026, 6, 13))), "2026-07-06");
});

test("getWeekDays returns Mon..Sun", function() {
  const days = getWeekDays(WEEK_START);
  assert.equal(days.length, 7);
  assert.equal(dayKey(days[0]), "2026-07-06");
  assert.equal(dayKey(days[6]), "2026-07-12");
});

test("getPhase maps goals", function() {
  assert.equal(getPhase("build"), "bulk");
  assert.equal(getPhase("lean"), "bulk");
  assert.equal(getPhase("cut"), "cut");
  assert.equal(getPhase("debloat"), "cut");
  assert.equal(getPhase("maintain"), "maintain");
});

// ── Phase-aware calorie logic ───────────────────────────────────────────

test("bulk: at/above target hits, deficit misses", function() {
  const history = [
    histDay(0, { calories: 2800 }),  // at target → hit
    histDay(1, { calories: 3000 }),  // surplus → hit
    histDay(2, { calories: 2600 })   // deficit → miss
  ];
  const n = aggregateNutrition(history, TARGETS, "build", WEEK_START);
  assert.equal(n.days[0].hit, true);
  assert.equal(n.days[1].hit, true);
  assert.equal(n.days[2].hit, false);
  assert.equal(n.caloriesHit, 2);
});

test("cut: same days invert — deficit hits, surplus misses", function() {
  const history = [
    histDay(0, { calories: 2800 }),
    histDay(1, { calories: 3000 }),
    histDay(2, { calories: 2600 })
  ];
  const n = aggregateNutrition(history, TARGETS, "cut", WEEK_START);
  assert.equal(n.days[0].hit, true, "at target counts on a cut");
  assert.equal(n.days[1].hit, false);
  assert.equal(n.days[2].hit, true);
  assert.equal(n.caloriesHit, 2);
});

test("maintain: ±300 band", function() {
  const history = [
    histDay(0, { calories: 3100 }),
    histDay(1, { calories: 3101 }),
    histDay(2, { calories: 2500 })
  ];
  const n = aggregateNutrition(history, TARGETS, "maintain", WEEK_START);
  assert.equal(n.days[0].hit, true);
  assert.equal(n.days[1].hit, false);
  assert.equal(n.days[2].hit, true);
});

// ── No-log-day handling ─────────────────────────────────────────────────

test("a day with no history entry is no-data: not a miss, excluded from avg", function() {
  const history = [
    histDay(0, { calories: 3000 }), // +200
    histDay(2, { calories: 2900 })  // +100; days 1,3-6 unlogged
  ];
  const n = aggregateNutrition(history, TARGETS, "build", WEEK_START);
  assert.equal(n.loggedCount, 2);
  assert.equal(n.days[1].logged, false);
  assert.equal(n.days[1].hit, false);
  assert.equal(n.days[1].calories, null);
  assert.equal(n.days[1].delta, null);
  assert.equal(n.avgDelta, 150, "average over logged days only");
  assert.equal(n.caloriesHit, 2);
});

test("a zero-calorie entry counts as no-log, not a deficit", function() {
  const n = aggregateNutrition([histDay(0, { calories: 0 })], TARGETS, "cut", WEEK_START);
  assert.equal(n.loggedCount, 0);
  assert.equal(n.days[0].logged, false);
  assert.equal(n.avgDelta, null);
});

test("entries outside the week are ignored", function() {
  const outside = histDay(-1, { calories: 2800 });
  const n = aggregateNutrition([outside], TARGETS, "build", WEEK_START);
  assert.equal(n.loggedCount, 0);
});

// ── Macro hit counts ────────────────────────────────────────────────────

test("macro hits count logged days at/above target; levels map 6+/4-5/<4", function() {
  const history = [];
  for (let i = 0; i < 7; i++) {
    history.push(histDay(i, {
      calories: 2800,
      protein: i < 6 ? 160 : 100, // 6 hits → success
      carbs: i < 4 ? 300 : 200,   // 4 hits → warning
      fats: i < 2 ? 80 : 40       // 2 hits → miss
    }));
  }
  const n = aggregateNutrition(history, TARGETS, "build", WEEK_START);
  const byId = {};
  n.macros.forEach(function(m) { byId[m.id] = m; });
  assert.equal(byId.protein.hits, 6);
  assert.equal(byId.protein.level, "success");
  assert.equal(byId.carbs.hits, 4);
  assert.equal(byId.carbs.level, "warning");
  assert.equal(byId.fats.hits, 2);
  assert.equal(byId.fats.level, "miss");
});

// ── Volume rollups ──────────────────────────────────────────────────────

test("volume: counts done sets per muscle, respects overrides, flags overshoot as hit", function() {
  const log = [
    sessionOn(1, [ex("Barbell Bench Press", 6, 185, 8)]),
    sessionOn(3, [ex("Incline Bench Press", 6, 135, 10), ex("Barbell Row", 4, 155, 8)])
  ];
  const t = aggregateTraining(log, [], { back: 12 }, WEEK_START);
  const byId = {};
  t.rows.forEach(function(r) { byId[r.id] = r; });
  assert.equal(byId.chest.done, 12);
  assert.equal(byId.chest.target, 10);
  assert.equal(byId.chest.hit, true, "overshoot counts as hit");
  assert.equal(byId.back.done, 4);
  assert.equal(byId.back.target, 12, "custom set target respected");
  assert.equal(byId.back.hit, false);
  assert.equal(t.hitCount, 1);
  assert.equal(t.totalSets, 16);
});

test("volume rows carry a per-exercise breakdown, most sets first", function() {
  const log = [
    sessionOn(1, [ex("Barbell Bench Press", 3, 185, 8), ex("Incline Bench Press", 6, 135, 10)]),
    sessionOn(3, [ex("Barbell Bench Press", 3, 185, 8)])
  ];
  const t = aggregateTraining(log, [], {}, WEEK_START);
  assert.deepEqual(t.rows[0].exercises, [
    { name: "Barbell Bench Press", sets: 6 },
    { name: "Incline Bench Press", sets: 6 }
  ]);
});

test("notProgrammed lists the groups outside routines/targets/training", function() {
  const routines = [{ id: 1, exercises: [{ name: "Squat" }] }];
  const t = aggregateTraining([], routines, { back: 12 }, WEEK_START);
  assert.deepEqual(t.rows.map(function(r) { return r.id; }), ["back", "quads"]);
  assert.deepEqual(t.notProgrammed, ["Chest", "Shoulders", "Biceps", "Triceps", "Hamstrings", "Calves", "Core", "Glutes"]);
});

test("volume rows include routine muscles even with zero sets; cardio excluded", function() {
  const routines = [{ id: 1, exercises: [{ name: "Squat" }, { name: "Cycling" }] }];
  const log = [sessionOn(1, [ex("Cycling", 3)])];
  const t = aggregateTraining(log, routines, {}, WEEK_START);
  assert.deepEqual(t.rows.map(function(r) { return r.id; }), ["quads"]);
  assert.equal(t.rows[0].done, 0);
  assert.equal(t.totalSets, 0, "cardio sets don't count toward volume");
});

test("volume: sessions outside the week are excluded", function() {
  const log = [sessionOn(-1, [ex("Squat", 5, 225, 5)])];
  const t = aggregateTraining(log, [], {}, WEEK_START);
  assert.equal(t.rows.length, 0);
  assert.equal(t.sessions.length, 0);
});

test("weeklySetTotals groups by Monday week start", function() {
  const log = [
    sessionOn(-3, [ex("Squat", 10, 225, 5)]), // previous week
    sessionOn(1, [ex("Squat", 12, 225, 5)])
  ];
  const totals = weeklySetTotals(log);
  assert.equal(totals["2026-06-29"], 10);
  assert.equal(totals["2026-07-06"], 12);
});

// ── Weight trend ────────────────────────────────────────────────────────

import { buildWeightTrend } from "../js/utils/weeklyReport.js";

// weightLog uses YYYY-MM-DD keys like logWeight writes.
function wl(dayOffset, weight) {
  const d = new Date(WEEK_START);
  d.setDate(d.getDate() + dayOffset);
  return { date: dayKey(d), weight: weight };
}

test("weight trend: unavailable with <2 entries or none in the report week", function() {
  const t = { calories: 2800, surplus: -500 };
  assert.equal(buildWeightTrend([wl(2, 180)], t, "cut", WEEK_START).available, false);
  // both entries before the week → stale
  const stale = buildWeightTrend([wl(-20, 184), wl(-10, 182)], t, "cut", WEEK_START);
  assert.equal(stale.available, false);
  assert.equal(stale.reason, "no-entry-this-week");
});

test("weight trend: cut on pace", function() {
  // -500/day surplus → expected -1.0 lb/wk. 183 → 182 over 7 days = -1.0.
  const trend = buildWeightTrend([wl(-4, 183), wl(3, 182)], { surplus: -500 }, "cut", WEEK_START);
  assert.equal(trend.available, true);
  assert.equal(trend.weeklyRate, -1);
  assert.equal(trend.expectedRate, -1);
  assert.equal(trend.status, "on-pace");
  assert.equal(trend.lead, "Down 1.0 lb/week");
  assert.match(trend.paceText, /Right on your cut pace \(-1\.0 lb\/wk\)/);
});

test("weight trend: moving against a cut calls it out", function() {
  const trend = buildWeightTrend([wl(-4, 180), wl(3, 181.5)], { surplus: -500 }, "cut", WEEK_START);
  assert.equal(trend.status, "behind");
  assert.match(trend.paceText, /against your cut/);
});

test("weight trend: bulk gaining faster than pace is 'ahead'", function() {
  // +300/day → expected +0.6. +1.5 lb over 7 days → ahead.
  const trend = buildWeightTrend([wl(-4, 180), wl(3, 181.5)], { surplus: 300 }, "build", WEEK_START);
  assert.equal(trend.status, "ahead");
  assert.match(trend.paceText, /Ahead of your bulk pace \(\+0\.6 lb\/wk\)/);
});

test("weight trend: prefers a 2-3 week baseline when history allows", function() {
  const log = [wl(-17, 190), wl(-7, 188), wl(2, 187)];
  const trend = buildWeightTrend(log, { surplus: -500 }, "cut", WEEK_START);
  assert.equal(trend.baseline.weight, 190, "14+ day baseline wins over the recent one");
  assert.equal(trend.spanDays, 19);
});

test("weight trend: maintain holding flat", function() {
  const trend = buildWeightTrend([wl(-4, 180), wl(3, 180.1)], { surplus: 0 }, "maintain", WEEK_START);
  assert.equal(trend.status, "on-pace");
  assert.match(trend.paceText, /Holding steady/);
});

// ── Win of the Week ─────────────────────────────────────────────────────

const NO_NUTRITION = { days: [] };

test("win priority 1: stall-break beats a bigger plain progression", function() {
  const events = [
    { lift: "Squat", type: "weight", from: 225, to: 245, wasStalled: false },
    { lift: "Overhead Press", type: "weight", from: 115, to: 120, wasStalled: true }
  ];
  const win = selectWinOfWeek(events, {}, NO_NUTRITION, [], WEEK_START);
  assert.equal(win.type, "stall-break");
  assert.equal(win.event.lift, "Overhead Press");
});

test("win priority 2: best progression prefers weight over reps, then size", function() {
  const events = [
    { lift: "Curl", type: "reps", weight: 60, from: 8, to: 12, wasStalled: false },
    { lift: "Squat", type: "weight", from: 225, to: 230, wasStalled: false },
    { lift: "Bench", type: "weight", from: 185, to: 195, wasStalled: false }
  ];
  const win = selectWinOfWeek(events, {}, NO_NUTRITION, [], WEEK_START);
  assert.equal(win.type, "progression");
  assert.equal(win.event.lift, "Bench");
});

test("win priority 3: best volume week needs a previous week to beat", function() {
  const thisWeekOnly = [sessionOn(1, [ex("Squat", 12, 225, 5)])];
  assert.equal(selectWinOfWeek([], {}, NO_NUTRITION, thisWeekOnly, WEEK_START), null,
    "first-ever week can't be a volume record");

  const log = [
    sessionOn(-3, [ex("Squat", 10, 225, 5)]),
    sessionOn(1, [ex("Squat", 12, 225, 5)])
  ];
  const win = selectWinOfWeek([], {}, NO_NUTRITION, log, WEEK_START);
  assert.equal(win.type, "volume");
  assert.equal(win.sets, 12);
  assert.equal(win.prevBest, 10);
});

test("win priority 4: adherence streak needs 3+ consecutive hit days", function() {
  const two = { days: [{ hit: true }, { hit: true }, { hit: false }] };
  assert.equal(selectWinOfWeek([], {}, two, [], WEEK_START), null);
  const three = { days: [{ hit: false }, { hit: true }, { hit: true }, { hit: true }] };
  const win = selectWinOfWeek([], {}, three, [], WEEK_START);
  assert.equal(win.type, "streak");
  assert.equal(win.days, 3);
});

test("held events never produce a progression win", function() {
  const events = [{ lift: "Squat", type: "held", weight: 225, reps: 5, wasStalled: true }];
  assert.equal(selectWinOfWeek(events, {}, NO_NUTRITION, [], WEEK_START), null);
});

// ── Nudges ──────────────────────────────────────────────────────────────

function fullWeek(overrides) {
  const history = [];
  for (let i = 0; i < 7; i++) {
    history.push(histDay(i, Object.assign({ calories: 2900 }, overrides ? overrides(i) : null)));
  }
  return history;
}

test("nutrition nudge: no data", function() {
  const n = aggregateNutrition([], TARGETS, "build", WEEK_START);
  assert.equal(buildNutritionNudge(n, {}, "bulk").type, "no-data");
});

test("nutrition nudge: fully on target says repeat", function() {
  const n = aggregateNutrition(fullWeek(), TARGETS, "build", WEEK_START);
  const nudge = buildNutritionNudge(n, {}, "bulk");
  assert.equal(nudge.type, "repeat");
  assert.match(nudge.text, /same week|Change nothing/);
});

test("nutrition nudge: macro missed on training days wins over generic macro advice", function() {
  // Carbs missed Mon & Wed; both are workout days.
  const history = fullWeek(function(i) {
    return (i === 0 || i === 2) ? { carbs: 200 } : null;
  });
  const n = aggregateNutrition(history, TARGETS, "build", WEEK_START);
  const workoutDayKeys = {};
  workoutDayKeys[n.days[0].key] = true;
  workoutDayKeys[n.days[2].key] = true;
  const nudge = buildNutritionNudge(n, workoutDayKeys, "bulk");
  assert.equal(nudge.type, "macro-training");
  assert.equal(nudge.macroId, "carbs", "deep-link macro for the day planner");
  assert.match(nudge.text, /Carbs missed on 2 days — both were training days/);
});

test("nutrition nudge: weekend calorie drift", function() {
  const history = fullWeek(function(i) {
    return i >= 5 ? { calories: 2500 } : null; // Sat & Sun under on a bulk
  });
  const n = aggregateNutrition(history, TARGETS, "build", WEEK_START);
  assert.equal(buildNutritionNudge(n, {}, "bulk").type, "weekend");
});

test("nutrition nudge: worst macro fallback", function() {
  const history = fullWeek(function(i) {
    return i < 4 ? { protein: 120 } : null; // protein 3/7, spread across week
  });
  const n = aggregateNutrition(history, TARGETS, "build", WEEK_START);
  const nudge = buildNutritionNudge(n, {}, "bulk");
  assert.equal(nudge.type, "macro");
  assert.equal(nudge.macroId, "protein");
  assert.match(nudge.text, /Protein landed 3\/7/);
});

test("nutrition nudge: calories-only gap is phase-specific", function() {
  const history = fullWeek(function(i) {
    return i < 3 ? { calories: 2500 } : null; // 3 bulk misses, macros fine
  });
  const n = aggregateNutrition(history, TARGETS, "build", WEEK_START);
  const bulk = buildNutritionNudge(n, {}, "bulk");
  assert.equal(bulk.type, "calories");
  assert.match(bulk.text, /calorie-dense/);

  const nCut = aggregateNutrition(fullWeek(function(i) {
    return i < 3 ? { calories: 3100 } : { calories: 2700 };
  }), TARGETS, "cut", WEEK_START);
  assert.match(buildNutritionNudge(nCut, {}, "cut").text, /Pre-log dinner/);
});

test("training nudge: no workouts", function() {
  const t = aggregateTraining([], [], {}, WEEK_START);
  assert.equal(buildTrainingNudge(t, []).type, "no-data");
});

test("training nudge: all targets hit says repeat", function() {
  const t = aggregateTraining([sessionOn(1, [ex("Squat", 10, 225, 5)])], [], {}, WEEK_START);
  const nudge = buildTrainingNudge(t, []);
  assert.equal(nudge.type, "repeat");
  assert.match(nudge.text, /Repeat this split/);
});

test("training nudge: names the closest miss with a concrete fix", function() {
  const routines = [{ id: 1, exercises: [{ name: "Barbell Row" }, { name: "Squat" }] }];
  const log = [
    // Tuesday: back 9/10 (1 short), quads 4/10 (6 short) → back is the fix.
    sessionOn(1, [ex("Barbell Row", 9, 155, 8), ex("Squat", 4, 225, 5)])
  ];
  const t = aggregateTraining(log, routines, {}, WEEK_START);
  const nudge = buildTrainingNudge(t, routines);
  assert.equal(nudge.type, "volume-fix");
  assert.equal(nudge.text, "Back 1 set short — add 1 set of Barbell Row on Tuesday.");
});

// ── Tone & full assembly ────────────────────────────────────────────────

test("tone: strong / mixed / rough", function() {
  const goodN = { caloriesHit: 6 };
  const goodT = { rows: [{ hit: true }, { hit: true }, { hit: true }, { hit: true }], hitCount: 4 };
  assert.equal(getTone(goodN, goodT, 1), "strong");

  const midN = { caloriesHit: 4 };
  const midT = { rows: [{ hit: true }, { hit: false }], hitCount: 1 };
  assert.equal(getTone(midN, midT, 0), "mixed");

  const badN = { caloriesHit: 1 };
  const badT = { rows: [{ hit: false }, { hit: false }, { hit: false }], hitCount: 0 };
  assert.equal(getTone(badN, badT, 0), "rough");
});

test("buildWeeklyReport assembles everything for an empty brand-new user", function() {
  const report = buildWeeklyReport({
    goal: "build",
    history: [],
    workoutLog: [],
    routines: [],
    setTargets: {},
    targets: TARGETS,
    weekStart: WEEK_START
  });
  assert.equal(report.phase, "bulk");
  assert.equal(report.tone, "rough");
  assert.equal(report.nutrition.loggedCount, 0);
  assert.equal(report.training.rows.length, 0);
  assert.equal(report.progression.events.length, 0);
  assert.equal(report.win, null);
  assert.equal(report.nudges.nutrition.type, "no-data");
  assert.equal(report.nudges.training.type, "no-data");
  assert.equal(dayKey(report.weekEnd), "2026-07-12");
});

test("buildWeeklyReport: a strong bulk week end-to-end", function() {
  const history = fullWeek();
  const log = [
    sessionOn(-6, [ex("Barbell Bench Press", 10, 185, 8)]),
    sessionOn(1, [ex("Barbell Bench Press", 10, 190, 8)]),
    sessionOn(3, [ex("Barbell Row", 10, 155, 8)])
  ];
  const report = buildWeeklyReport({
    goal: "build",
    history: history,
    workoutLog: log,
    routines: [],
    setTargets: {},
    targets: TARGETS,
    weekStart: WEEK_START
  });
  assert.equal(report.tone, "strong");
  assert.equal(report.progression.movedCount, 1);
  assert.equal(report.win.type, "progression");
  assert.equal(report.win.event.lift, "Barbell Bench Press");
  assert.equal(report.nudges.nutrition.type, "repeat");
});
