/* ─── Tests — routine generator ──────────────────────────────────────────── */

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  exercisePreference,
  generateGapRoutine,
  generateStarterRoutine,
  suggestRoutineForWeek
} from "../js/utils/routineGenerator.js";

function row(id, label, done, target) {
  return { id: id, label: label, done: done, target: target, hit: done >= target };
}

function sessionWith(name, weight, reps, when) {
  return {
    id: when,
    finishedAt: when,
    exercises: [{ name: name, sets: [{ weight: weight, reps: reps, done: true }] }]
  };
}

// ── exercise preference ─────────────────────────────────────────────────

test("exercisePreference puts the user's own lifts before catalog defaults", function() {
  const routines = [{ id: 1, exercises: [{ name: "Dumbbell Row" }, { name: "Squat" }] }];
  const prefs = exercisePreference("back", routines);
  assert.equal(prefs[0], "Dumbbell Row");
  assert.ok(prefs.indexOf("Pull-Up") > 0, "catalog entries follow");
  assert.equal(prefs.filter(function(n) { return n === "Dumbbell Row"; }).length, 1, "no duplicates");
});

// ── gap routine ─────────────────────────────────────────────────────────

test("gap routine covers exactly the short muscles with deficit-sized sets", function() {
  const rows = [
    row("chest", "Chest", 10, 10),  // hit — excluded
    row("back", "Back", 7, 10),     // 3 short
    row("quads", "Quads", 6, 10)    // 4 short
  ];
  const r = generateGapRoutine(rows, [], []);
  assert.equal(r.title, "Suggested · Fill the Gaps");
  assert.deepEqual(r.exercises.map(function(e) { return e.muscle; }), ["Back", "Quads"]);
  assert.equal(r.exercises[0].sets.length, 3);
  assert.equal(r.exercises[1].sets.length, 4);
});

test("a deficit past the per-exercise cap spills into a second exercise", function() {
  const rows = [row("back", "Back", 2, 10)]; // 8 short, cap 5 per exercise
  const r = generateGapRoutine(rows, [], []);
  assert.equal(r.exercises.length, 2);
  assert.equal(r.exercises[0].sets.length, 5);
  assert.equal(r.exercises[1].sets.length, 3);
  assert.notEqual(r.exercises[0].name, r.exercises[1].name);
});

test("gap routine prefers the user's own exercise for the muscle", function() {
  const rows = [row("back", "Back", 8, 10)];
  const routines = [{ id: 1, exercises: [{ name: "Seated Cable Row" }] }];
  const r = generateGapRoutine(rows, routines, []);
  assert.equal(r.exercises[0].name, "Seated Cable Row");
});

test("sets are seeded from the last session's best, not zeros", function() {
  const rows = [row("back", "Back", 8, 10)];
  const routines = [{ id: 1, exercises: [{ name: "Barbell Row" }] }];
  const log = [
    sessionWith("Barbell Row", 145, 8, 1000),
    sessionWith("Barbell Row", 155, 8, 2000) // most recent wins
  ];
  const r = generateGapRoutine(rows, routines, log);
  assert.deepEqual(r.exercises[0].sets[0], { reps: 8, weight: 155 });
});

test("every target hit → null (no upsell on a good week)", function() {
  const rows = [row("chest", "Chest", 12, 10), row("back", "Back", 10, 10)];
  assert.equal(generateGapRoutine(rows, [], []), null);
});

// ── starter routine ─────────────────────────────────────────────────────

test("starter routine is a full-body template with 3 sets per exercise", function() {
  const r = generateStarterRoutine([]);
  assert.equal(r.title, "Suggested · Starter Full Body");
  assert.deepEqual(
    r.exercises.map(function(e) { return e.muscle; }),
    ["Chest", "Back", "Shoulders", "Quads", "Hamstrings", "Core"]
  );
  r.exercises.forEach(function(e) {
    assert.equal(e.sets.length, 3);
    assert.equal(e.sets[0].reps, 10);
  });
});

// ── week-level dispatch ─────────────────────────────────────────────────

test("suggestRoutineForWeek: no rows → starter, gaps → filler, all hit → null", function() {
  assert.equal(suggestRoutineForWeek([], [], []).title, "Suggested · Starter Full Body");
  assert.equal(suggestRoutineForWeek([row("back", "Back", 7, 10)], [], []).title, "Suggested · Fill the Gaps");
  assert.equal(suggestRoutineForWeek([row("back", "Back", 10, 10)], [], []), null);
});
