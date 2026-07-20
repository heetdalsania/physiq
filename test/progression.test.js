/* ─── Tests — progression engine ─────────────────────────────────────────── */

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  bestDoneSet,
  compareBests,
  buildLiftHistory,
  isStalled,
  getWeeklyProgression,
  countMoved
} from "../js/utils/progression.js";

// Week window used throughout: Mon Jul 6 2026 → Mon Jul 13 2026 (exclusive).
const WEEK_START = new Date(2026, 6, 6).getTime();
const WEEK_END = new Date(2026, 6, 13).getTime();

let nextId = 1;
function session(y, m, d, exercises) {
  return {
    id: nextId++,
    finishedAt: new Date(y, m, d, 18, 0).getTime(),
    exercises: exercises
  };
}
function ex(name, sets) {
  return { name: name, sets: sets };
}
function set(weight, reps, done) {
  return { weight: weight, reps: reps, done: done !== false };
}

// ── bestDoneSet ─────────────────────────────────────────────────────────

test("bestDoneSet picks heaviest done set, ties by reps", function() {
  const e = ex("Barbell Bench Press", [set(185, 8), set(195, 5), set(195, 6), set(135, 12)]);
  assert.deepEqual(bestDoneSet(e), { weight: 195, reps: 6 });
});

test("bestDoneSet ignores undone sets", function() {
  const e = ex("Barbell Bench Press", [set(185, 8), set(225, 5, false)]);
  assert.deepEqual(bestDoneSet(e), { weight: 185, reps: 8 });
});

test("bestDoneSet returns null when nothing was completed", function() {
  assert.equal(bestDoneSet(ex("Squat", [set(225, 5, false)])), null);
  assert.equal(bestDoneSet(ex("Squat", [])), null);
});

test("compareBests: weight wins, then reps", function() {
  assert.ok(compareBests({ weight: 190, reps: 5 }, { weight: 185, reps: 12 }) > 0);
  assert.ok(compareBests({ weight: 185, reps: 9 }, { weight: 185, reps: 8 }) > 0);
  assert.equal(compareBests({ weight: 185, reps: 8 }, { weight: 185, reps: 8 }), 0);
});

// ── buildLiftHistory ────────────────────────────────────────────────────

test("buildLiftHistory sorts chronologically and skips unfinished sessions", function() {
  const log = [
    session(2026, 6, 8, [ex("Squat", [set(235, 5)])]),
    session(2026, 6, 1, [ex("Squat", [set(225, 5)])]),
    { id: 99, exercises: [ex("Squat", [set(315, 1)])] } // no finishedAt
  ];
  const hist = buildLiftHistory(log);
  assert.equal(hist["Squat"].length, 2);
  assert.equal(hist["Squat"][0].weight, 225);
  assert.equal(hist["Squat"][1].weight, 235);
});

// ── isStalled ───────────────────────────────────────────────────────────

test("isStalled needs 3+ flat pre-week sessions", function() {
  const flat = { weight: 185, reps: 8 };
  assert.equal(isStalled([flat, flat]), false, "two sessions is not enough");
  assert.equal(isStalled([flat, flat, flat]), true);
  assert.equal(isStalled([{ weight: 180, reps: 8 }, flat, flat, flat]), true, "only last 3 matter");
  assert.equal(isStalled([flat, flat, { weight: 185, reps: 9 }]), false, "rep improvement breaks the stall");
  assert.equal(isStalled([flat, { weight: 180, reps: 8 }, { weight: 175, reps: 8 }]), true, "regression still counts as stalled");
});

// ── getWeeklyProgression ────────────────────────────────────────────────

test("weight progression: week best vs last pre-week session", function() {
  const log = [
    session(2026, 5, 29, [ex("Squat", [set(225, 5)])]),
    session(2026, 6, 7, [ex("Squat", [set(235, 5)])])
  ];
  const events = getWeeklyProgression(log, WEEK_START, WEEK_END);
  assert.deepEqual(events, [{ lift: "Squat", type: "weight", from: 225, to: 235, reps: 5, wasStalled: false }]);
});

test("rep progression at the same weight", function() {
  const log = [
    session(2026, 5, 29, [ex("Barbell Bench Press", [set(185, 8)])]),
    session(2026, 6, 7, [ex("Barbell Bench Press", [set(185, 10)])])
  ];
  const events = getWeeklyProgression(log, WEEK_START, WEEK_END);
  assert.equal(events[0].type, "reps");
  assert.equal(events[0].from, 8);
  assert.equal(events[0].to, 10);
  assert.equal(events[0].weight, 185);
});

test("bodyweight lifts progress on reps", function() {
  const log = [
    session(2026, 5, 29, [ex("Pull-Up", [set(0, 8)])]),
    session(2026, 6, 7, [ex("Pull-Up", [set(0, 10)])])
  ];
  const events = getWeeklyProgression(log, WEEK_START, WEEK_END);
  assert.equal(events[0].type, "reps");
});

test("no improvement (or regression) → held at the week's best value", function() {
  const log = [
    session(2026, 5, 29, [ex("Squat", [set(235, 5)])]),
    session(2026, 6, 7, [ex("Squat", [set(225, 5)])])
  ];
  const events = getWeeklyProgression(log, WEEK_START, WEEK_END);
  assert.deepEqual(events, [{ lift: "Squat", type: "held", weight: 225, reps: 5, wasStalled: false }]);
});

test("first-ever performance of a lift is 'new', not a progression", function() {
  const log = [session(2026, 6, 7, [ex("Deadlift", [set(315, 5)])])];
  const events = getWeeklyProgression(log, WEEK_START, WEEK_END);
  assert.deepEqual(events, [{ lift: "Deadlift", type: "new", weight: 315, reps: 5 }]);
  assert.equal(countMoved(events), 0);
});

test("multiple in-week sessions collapse to one event using the week's best", function() {
  const log = [
    session(2026, 5, 29, [ex("Squat", [set(225, 5)])]),
    session(2026, 6, 7, [ex("Squat", [set(230, 5)])]),
    session(2026, 6, 10, [ex("Squat", [set(240, 3)])])
  ];
  const events = getWeeklyProgression(log, WEEK_START, WEEK_END);
  assert.equal(events.length, 1);
  assert.equal(events[0].to, 240);
});

test("lifts not performed in the week produce no event", function() {
  const log = [session(2026, 5, 29, [ex("Squat", [set(225, 5)])])];
  assert.deepEqual(getWeeklyProgression(log, WEEK_START, WEEK_END), []);
});

test("stall-break: progression after 3 flat sessions carries wasStalled", function() {
  const log = [
    session(2026, 5, 15, [ex("Overhead Press", [set(115, 5)])]),
    session(2026, 5, 22, [ex("Overhead Press", [set(115, 5)])]),
    session(2026, 5, 29, [ex("Overhead Press", [set(115, 5)])]),
    session(2026, 6, 7, [ex("Overhead Press", [set(120, 5)])])
  ];
  const events = getWeeklyProgression(log, WEEK_START, WEEK_END);
  assert.equal(events[0].type, "weight");
  assert.equal(events[0].wasStalled, true);
});

test("events come back alphabetically for stable display", function() {
  const log = [
    session(2026, 6, 7, [ex("Squat", [set(225, 5)]), ex("Barbell Curl", [set(60, 10)])])
  ];
  const events = getWeeklyProgression(log, WEEK_START, WEEK_END);
  assert.deepEqual(events.map(function(e) { return e.lift; }), ["Barbell Curl", "Squat"]);
});

test("countMoved counts only weight/rep progressions", function() {
  assert.equal(countMoved([
    { type: "weight" }, { type: "reps" }, { type: "held" }, { type: "new" }
  ]), 2);
});
