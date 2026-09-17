/* ─── Tests — active-session lifecycle with optional set metadata ─────────
 *
 * Exercises the PRODUCTION transitions ExerciseTab applies to an in-flight
 * workout (js/utils/workoutSession.js), then pushes the finished record
 * through the real storage layer the way App.js does, and reads it back the
 * way App.js does. Synthetic fixtures only; an in-memory localStorage stub.
 * ───────────────────────────────────────────────────────────────────────── */

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { installLocalStorageStub, uninstallLocalStorageStub } from "./helpers/localStorageStub.js";
import { uKey, get, sv, quarantineProfile, runMigrations, readSchemaVersion, SCHEMA_VERSION, exportAll, importAll, _resetCorruptWarnings, _resetProtections } from "../js/utils/storage.js";
import { EXERCISE_MUSCLE } from "../js/data/constants.js";
import {
  startSessionFromRoutine, updateSessionSet, updateSetNumberField, toggleSetDone,
  updateSetMetadataInput, clearSessionSetMetadata, clearSessionSetDetails, countSessionSets, buildCompletedWorkoutRecord
} from "../js/utils/workoutSession.js";
import { readSetMetadata, hasSetMetadata, formatSetMetadataSummary } from "../js/utils/setMetadata.js";
import { bestDoneSet, buildLiftHistory } from "../js/utils/progression.js";
import {
  DEMO_EMAIL_A, DEMO_EMAIL_B, DEMO_ROUTINE_LEGS, DEMO_ROUTINES_A,
  DEMO_WORKOUT_LOG_A, DEMO_WORKOUT_LOG_B, DEMO_SESSION_METADATA_B, DEMO_SESSION_PARTIAL,
  DEMO_BUNDLES
} from "../js/dev/demoFixtures.js";

const T0 = 1772634600000;   // fixed epoch ms — no clock in these tests
const T1 = 1772637000000;

function clone(x) { return JSON.parse(JSON.stringify(x)); }
function frozenDeep(x) {
  if (x && typeof x === "object") { Object.keys(x).forEach(function(k) { frozenDeep(x[k]); }); Object.freeze(x); }
  return x;
}
function fresh() { _resetCorruptWarnings(); _resetProtections(); return installLocalStorageStub(); }
function seedBundle(bundle) {
  Object.keys(bundle.keys).forEach(function(suffix) {
    localStorage.setItem(uKey(bundle.email, suffix), JSON.stringify(bundle.keys[suffix]));
  });
}
/* The direct reader App.js uses for workoutLog on boot and on login. */
function appReadWorkoutLog(email) {
  try { return JSON.parse(localStorage.getItem(uKey(email, "workoutLog"))) || []; } catch (e) { return []; }
}
/* App.logCompletedWorkout appends; the persistence effect then writes via sv(). */
function appLogAndPersist(email, record) {
  const next = appReadWorkoutLog(email).concat([record]);
  sv(email, "workoutLog", next);
  return next;
}

test.afterEach(function() { uninstallLocalStorageStub(); });

// ── starting a session ──────────────────────────────────────────────────

test("starting a routine copies only reps/weight and done:false — no metadata is imported", function() {
  const routine = clone(DEMO_ROUTINE_LEGS);
  // Even if a routine set somehow carried metadata keys, a fresh session must not inherit them.
  routine.exercises[0].sets[0].rir = 2;
  routine.exercises[0].sets[0].tempo = { eccentricSeconds: 3 };
  routine.exercises[0].sets[0].side = "left";
  routine.exercises[0].sets[0].rom = "full";
  frozenDeep(routine);

  const s = startSessionFromRoutine(routine, T0);
  assert.deepEqual(s, {
    routineId: 9002, title: "Demo Legs", startedAt: T0,
    exercises: [
      { id: 92001, name: "Squat", muscle: "Quads",
        sets: [ { reps: 5, weight: 225, done: false }, { reps: 5, weight: 225, done: false }, { reps: 5, weight: 225, done: false } ] },
      { id: 92002, name: "Romanian Deadlift", muscle: "Hamstrings",
        sets: [ { reps: 8, weight: 155, done: false }, { reps: 8, weight: 155, done: false } ] }
    ]
  });
  s.exercises.forEach(function(ex) { ex.sets.forEach(function(set) { assert.equal(hasSetMetadata(set), false); }); });
});

test("a previous session's performed metadata never seeds the next workout", function() {
  // History holds metadata; the routine it came from does not. Starting again is clean.
  const s = startSessionFromRoutine(DEMO_ROUTINES_A[1], T0);
  const flat = [];
  s.exercises.forEach(function(ex) { ex.sets.forEach(function(set) { flat.push(Object.keys(set).sort()); }); });
  flat.forEach(function(keys) { assert.deepEqual(keys, ["done", "reps", "weight"]); });
});

// ── editing ─────────────────────────────────────────────────────────────

test("reps/weight edits and completion toggles preserve entered metadata", function() {
  let s = startSessionFromRoutine(DEMO_ROUTINE_LEGS, T0);
  s = updateSetMetadataInput(s, 0, 1, "rir", "2").session;
  s = updateSetMetadataInput(s, 0, 1, "side", "left").session;
  s = updateSetMetadataInput(s, 0, 1, "tempo.eccentricSeconds", "3").session;
  s = updateSetMetadataInput(s, 0, 1, "rom", "full").session;
  const before = clone(s.exercises[0].sets[1]);

  s = updateSetNumberField(s, 0, 1, "weight", 235);
  s = updateSetNumberField(s, 0, 1, "reps", 6);
  s = toggleSetDone(s, 0, 1);
  s = toggleSetDone(s, 0, 1);
  s = toggleSetDone(s, 0, 1);

  const set = s.exercises[0].sets[1];
  assert.equal(set.weight, 235); assert.equal(set.reps, 6); assert.equal(set.done, true);
  assert.deepEqual(readSetMetadata(set), readSetMetadata(before));
  assert.deepEqual(set.tempo, { eccentricSeconds: 3 });
  // Unrelated sets stayed pristine (no metadata bleed).
  assert.deepEqual(s.exercises[0].sets[0], { reps: 5, weight: 225, done: false });
  assert.deepEqual(s.exercises[1].sets[0], { reps: 8, weight: 155, done: false });
});

test("negative reps/weight still floor at 0 exactly as before", function() {
  let s = startSessionFromRoutine(DEMO_ROUTINE_LEGS, T0);
  s = updateSetNumberField(s, 0, 0, "weight", -5);
  s = updateSetNumberField(s, 0, 0, "reps", -1);
  assert.deepEqual(s.exercises[0].sets[0], { reps: 0, weight: 0, done: false });
});

test("edits are immutable: the previous session object is untouched and unrelated branches are shared", function() {
  const s0 = frozenDeep(startSessionFromRoutine(DEMO_ROUTINE_LEGS, T0));
  const r = updateSetMetadataInput(s0, 1, 0, "rir", "1");
  assert.equal(r.ok, true);
  assert.notEqual(r.session, s0);
  assert.equal(r.session.exercises[0], s0.exercises[0], "untouched exercise is the same object");
  assert.notEqual(r.session.exercises[1], s0.exercises[1]);
  assert.equal(r.session.exercises[1].sets[1], s0.exercises[1].sets[1], "untouched set is the same object");
  assert.deepEqual(s0.exercises[1].sets[0], { reps: 8, weight: 155, done: false });
  assert.deepEqual(r.session.exercises[1].sets[0], { reps: 8, weight: 155, done: false, rir: 1 });
});

test("an invalid entry is rejected with a message and the session is returned unchanged", function() {
  let s = startSessionFromRoutine(DEMO_ROUTINE_LEGS, T0);
  s = updateSetMetadataInput(s, 0, 0, "rir", "3").session;
  const frozen = frozenDeep(s);
  [["rir", "2abc"], ["rir", "7"], ["rir", "2.5"], ["side", "Left"], ["rom", "max"],
   ["tempo.eccentricSeconds", "45"], ["tempo.pauseSeconds", "1.5"], ["tempo.concentricSeconds", "X"]]
    .forEach(function(pair) {
      const r = updateSetMetadataInput(frozen, 0, 0, pair[0], pair[1]);
      assert.equal(r.ok, false, pair.join("="));
      assert.equal(r.session, frozen, "session identity preserved on failure");
      assert.equal(typeof r.error, "string");
    });
  assert.equal(frozen.exercises[0].sets[0].rir, 3, "prior valid value survives");
});

test("each field clears independently, and clearing all restores the legacy shape", function() {
  let s = startSessionFromRoutine(DEMO_ROUTINE_LEGS, T0);
  const set = function() { return s.exercises[0].sets[0]; };
  s = updateSetMetadataInput(s, 0, 0, "rir", "0").session;
  s = updateSetMetadataInput(s, 0, 0, "side", "right").session;
  s = updateSetMetadataInput(s, 0, 0, "tempo.eccentricSeconds", "3").session;
  s = updateSetMetadataInput(s, 0, 0, "tempo.pauseSeconds", "0").session;
  s = updateSetMetadataInput(s, 0, 0, "tempo.concentricSeconds", "1").session;
  s = updateSetMetadataInput(s, 0, 0, "rom", "standard").session;
  assert.deepEqual(set(), { reps: 5, weight: 225, done: false, rir: 0, side: "right",
                            tempo: { eccentricSeconds: 3, pauseSeconds: 0, concentricSeconds: 1 }, rom: "standard" });

  s = updateSetMetadataInput(s, 0, 0, "tempo.pauseSeconds", "").session;
  assert.deepEqual(set().tempo, { eccentricSeconds: 3, concentricSeconds: 1 }, "blank clears just that phase");
  s = updateSetMetadataInput(s, 0, 0, "side", "").session;
  assert.equal("side" in set(), false);
  assert.equal(set().rir, 0, "RIR 0 is still recorded after clearing another field");
  s = updateSetMetadataInput(s, 0, 0, "tempo.eccentricSeconds", "").session;
  s = updateSetMetadataInput(s, 0, 0, "tempo.concentricSeconds", "").session;
  assert.equal("tempo" in set(), false, "tempo object removed with its last phase");

  s = clearSessionSetMetadata(s, 0, 0);
  assert.deepEqual(set(), { reps: 5, weight: 225, done: false });
});

test("'Clear details' removes side / tempo / rom but leaves RIR and the base fields", function() {
  let s = startSessionFromRoutine(DEMO_ROUTINE_LEGS, T0);
  s = toggleSetDone(s, 0, 0);
  s = updateSetMetadataInput(s, 0, 0, "rir", "4").session;
  s = updateSetMetadataInput(s, 0, 0, "side", "left").session;
  s = updateSetMetadataInput(s, 0, 0, "tempo.pauseSeconds", "2").session;
  s = updateSetMetadataInput(s, 0, 0, "rom", "partial").session;
  const before = s;
  s = clearSessionSetDetails(s, 0, 0);
  assert.notEqual(s, before);
  assert.deepEqual(s.exercises[0].sets[0], { reps: 5, weight: 225, done: true, rir: 4 });
  assert.deepEqual(before.exercises[0].sets[0].tempo, { pauseSeconds: 2 }, "source untouched");
});

test("out-of-range indices are a no-op that returns the same session", function() {
  const s = startSessionFromRoutine(DEMO_ROUTINE_LEGS, T0);
  assert.equal(updateSessionSet(s, 5, 0, function(x) { return x; }), s);
  assert.equal(updateSessionSet(s, 0, 9, function(x) { return x; }), s);
  assert.equal(toggleSetDone(s, -1, 0), s);
  assert.equal(updateSetMetadataInput(s, 0, 9, "rir", "1").session, s);
});

// ── finishing ───────────────────────────────────────────────────────────

function buildMetadataSession() {
  let s = startSessionFromRoutine(DEMO_ROUTINE_LEGS, T0);
  s = toggleSetDone(s, 0, 0);                                            // legacy done set
  s = toggleSetDone(s, 0, 1);
  s = updateSetMetadataInput(s, 0, 1, "rir", "0").session;               // RIR 0
  s = toggleSetDone(s, 0, 2);
  s = updateSetMetadataInput(s, 0, 2, "rir", "5").session;               // everything
  s = updateSetMetadataInput(s, 0, 2, "side", "bilateral").session;
  s = updateSetMetadataInput(s, 0, 2, "tempo.eccentricSeconds", "3").session;
  s = updateSetMetadataInput(s, 0, 2, "tempo.pauseSeconds", "1").session;
  s = updateSetMetadataInput(s, 0, 2, "tempo.concentricSeconds", "1").session;
  s = updateSetMetadataInput(s, 0, 2, "rom", "full").session;
  s = toggleSetDone(s, 1, 0);
  s = updateSetMetadataInput(s, 1, 0, "tempo.eccentricSeconds", "4").session;   // partial tempo
  s = updateSetMetadataInput(s, 1, 1, "side", "left").session;                   // incomplete + metadata
  s = updateSetMetadataInput(s, 1, 1, "rir", "2").session;
  return s;
}

test("the finished record has the documented shape and keeps incomplete sets with their metadata", function() {
  const s = buildMetadataSession();
  const rec = buildCompletedWorkoutRecord(s, { id: 8600, finishedAt: T1 });
  assert.deepEqual(Object.keys(rec), ["id", "routineId", "title", "startedAt", "finishedAt", "completedSets", "totalSets", "exercises"]);
  assert.equal(rec.id, 8600); assert.equal(rec.routineId, 9002); assert.equal(rec.title, "Demo Legs");
  assert.equal(rec.startedAt, T0); assert.equal(rec.finishedAt, T1);
  assert.equal(rec.completedSets, 4); assert.equal(rec.totalSets, 5);
  assert.deepEqual(countSessionSets(s), { completedSets: 4, totalSets: 5 });
  assert.equal(rec.exercises, s.exercises, "exercises pass through by reference, as before");

  assert.deepEqual(rec.exercises[0].sets[0], { reps: 5, weight: 225, done: true });
  assert.deepEqual(rec.exercises[0].sets[1], { reps: 5, weight: 225, done: true, rir: 0 });
  assert.deepEqual(rec.exercises[0].sets[2], { reps: 5, weight: 225, done: true, rir: 5, side: "bilateral",
    tempo: { eccentricSeconds: 3, pauseSeconds: 1, concentricSeconds: 1 }, rom: "full" });
  assert.deepEqual(rec.exercises[1].sets[0], { reps: 8, weight: 155, done: true, tempo: { eccentricSeconds: 4 } });
  assert.deepEqual(rec.exercises[1].sets[1], { reps: 8, weight: 155, done: false, side: "left", rir: 2 },
    "an unfinished set persists as done:false and keeps what was entered");
});

test("a workout logged without touching metadata is byte-identical to the pre-Milestone-2 record", function() {
  let s = startSessionFromRoutine(DEMO_ROUTINE_LEGS, T0);
  s = toggleSetDone(s, 0, 0); s = toggleSetDone(s, 0, 1); s = toggleSetDone(s, 1, 0);
  s = updateSetNumberField(s, 0, 0, "weight", 230);
  const rec = buildCompletedWorkoutRecord(s, { id: 8601, finishedAt: T1 });
  assert.equal(JSON.stringify(rec), JSON.stringify({
    id: 8601, routineId: 9002, title: "Demo Legs", startedAt: T0, finishedAt: T1, completedSets: 3, totalSets: 5,
    exercises: [
      { id: 92001, name: "Squat", muscle: "Quads", sets: [
        { reps: 5, weight: 230, done: true }, { reps: 5, weight: 225, done: true }, { reps: 5, weight: 225, done: false } ] },
      { id: 92002, name: "Romanian Deadlift", muscle: "Hamstrings", sets: [
        { reps: 8, weight: 155, done: true }, { reps: 8, weight: 155, done: false } ] }
    ]
  }));
});

// ── persistence through the real storage path ───────────────────────────

test("finish → sv() → reload keeps every metadata field, and old sessions in the same log are untouched", function() {
  const ls = fresh();
  seedBundle(DEMO_BUNDLES[0]);
  runMigrations();
  const rawBefore = ls.getItem(uKey(DEMO_EMAIL_A, "workoutLog"));

  const rec = buildCompletedWorkoutRecord(buildMetadataSession(), { id: 8600, finishedAt: T1 });
  appLogAndPersist(DEMO_EMAIL_A, rec);

  // "Reload": the direct JSON.parse reader App.js uses, and the hardened get().
  const viaApp = appReadWorkoutLog(DEMO_EMAIL_A);
  const viaGet = get(uKey(DEMO_EMAIL_A, "workoutLog"), null);
  assert.deepEqual(viaApp, viaGet);
  assert.equal(viaApp.length, DEMO_WORKOUT_LOG_A.length + 1);
  assert.deepEqual(viaApp.slice(0, DEMO_WORKOUT_LOG_A.length), DEMO_WORKOUT_LOG_A, "legacy sessions unchanged");
  assert.equal(JSON.stringify(viaApp.slice(0, DEMO_WORKOUT_LOG_A.length)), rawBefore, "same bytes for the old entries");
  const saved = viaApp[viaApp.length - 1];
  assert.deepEqual(saved, clone(rec));
  assert.deepEqual(saved.exercises[0].sets[2].tempo, { eccentricSeconds: 3, pauseSeconds: 1, concentricSeconds: 1 });
  assert.equal(saved.exercises[1].sets[1].done, false);
  assert.equal(saved.exercises[1].sets[1].rir, 2);
  assert.equal(readSchemaVersion(), SCHEMA_VERSION, "no schema bump for optional fields");
  assert.equal(SCHEMA_VERSION, 1);

  // Second "reload" through the quarantine sweep App.js runs before reading: nothing is rewritten.
  const snap = ls.snapshot();
  quarantineProfile(DEMO_EMAIL_A, { workoutLog: [] });
  assert.deepEqual(ls.snapshot(), snap);
});

test("missing metadata is absent after a round-trip — no nulls, zeros or empty objects appear", function() {
  fresh();
  const rec = buildCompletedWorkoutRecord(buildMetadataSession(), { id: 8600, finishedAt: T1 });
  appLogAndPersist(DEMO_EMAIL_A, rec);
  const saved = appReadWorkoutLog(DEMO_EMAIL_A)[0];
  assert.deepEqual(Object.keys(saved.exercises[0].sets[0]).sort(), ["done", "reps", "weight"]);
  assert.deepEqual(Object.keys(saved.exercises[0].sets[1]).sort(), ["done", "reps", "rir", "weight"]);
  assert.deepEqual(Object.keys(saved.exercises[1].sets[0].tempo), ["eccentricSeconds"]);
  const raw = localStorage.getItem(uKey(DEMO_EMAIL_A, "workoutLog"));
  assert.equal(raw.indexOf("null"), -1, "no null anywhere in the record");
  assert.equal(raw.indexOf("{}"), -1, "no empty object anywhere in the record");
});

test("export → import carries metadata across unchanged", function() {
  fresh();
  const rec = buildCompletedWorkoutRecord(buildMetadataSession(), { id: 8600, finishedAt: T1 });
  appLogAndPersist(DEMO_EMAIL_A, rec);
  runMigrations();
  const payload = exportAll();
  const ls2 = fresh();
  assert.equal(importAll(payload), true);
  assert.deepEqual(appReadWorkoutLog(DEMO_EMAIL_A)[0], clone(rec));
  assert.ok(ls2.getItem(uKey(DEMO_EMAIL_A, "workoutLog")));
});

// ── profile isolation ───────────────────────────────────────────────────

test("metadata logged on one profile never appears on the other", function() {
  const ls = fresh();
  DEMO_BUNDLES.forEach(seedBundle);
  const bBefore = ls.getItem(uKey(DEMO_EMAIL_B, "workoutLog"));

  const rec = buildCompletedWorkoutRecord(buildMetadataSession(), { id: 8600, finishedAt: T1 });
  appLogAndPersist(DEMO_EMAIL_A, rec);

  assert.equal(ls.getItem(uKey(DEMO_EMAIL_B, "workoutLog")), bBefore, "profile B bytes unchanged");
  assert.deepEqual(appReadWorkoutLog(DEMO_EMAIL_B), DEMO_WORKOUT_LOG_B);
  const aLog = appReadWorkoutLog(DEMO_EMAIL_A);
  assert.equal(aLog.some(function(w) { return w.id === 8600; }), true);
  assert.equal(appReadWorkoutLog(DEMO_EMAIL_B).some(function(w) { return w.id === 8600; }), false);

  // Switching "to" B and finishing a plain workout there leaves A's metadata intact.
  let sb = startSessionFromRoutine(DEMO_ROUTINE_LEGS, T0);
  sb = toggleSetDone(sb, 0, 0);
  appLogAndPersist(DEMO_EMAIL_B, buildCompletedWorkoutRecord(sb, { id: 8700, finishedAt: T1 }));
  assert.deepEqual(appReadWorkoutLog(DEMO_EMAIL_A), aLog);
});

// ── legacy history and the metadata fixture ─────────────────────────────

test("old history without metadata reads back untouched and formats no summary", function() {
  fresh();
  seedBundle(DEMO_BUNDLES[0]);
  const log = appReadWorkoutLog(DEMO_EMAIL_A);
  assert.deepEqual(log, DEMO_WORKOUT_LOG_A);
  log.forEach(function(w) {
    w.exercises.forEach(function(ex) {
      ex.sets.forEach(function(set) {
        assert.equal(hasSetMetadata(set), false);
        assert.equal(formatSetMetadataSummary(set), null, "the history summary is hidden for legacy sets");
        assert.deepEqual(Object.keys(set).sort(), ["done", "reps", "weight"]);
      });
    });
  });
});

test("the Milestone 2 fixture is well-formed, seeds through the demo bundle, and renders the expected summaries", function() {
  fresh();
  seedBundle(DEMO_BUNDLES[1]);
  const log = appReadWorkoutLog(DEMO_EMAIL_B);
  const fx = log.filter(function(w) { return w.id === DEMO_SESSION_METADATA_B.id; })[0];
  assert.deepEqual(fx, DEMO_SESSION_METADATA_B);

  // Counters agree with the per-set flags (STORAGE_CONTRACT: done is the unit of truth).
  const c = countSessionSets(fx);
  assert.equal(fx.completedSets, c.completedSets);
  assert.equal(fx.totalSets, c.totalSets);
  fx.exercises.forEach(function(ex) { assert.ok(EXERCISE_MUSCLE[ex.name], ex.name); });

  // Every stored metadata value is valid — the fixture never carries malformed data.
  fx.exercises.forEach(function(ex) {
    ex.sets.forEach(function(set) {
      const m = readSetMetadata(set);
      ["rir", "side", "rom", "tempo"].forEach(function(f) {
        if (f in set) assert.notEqual(m[f], undefined, "fixture field " + f + " must be valid");
      });
    });
  });

  const summaries = fx.exercises.map(function(ex) { return ex.sets.map(formatSetMetadataSummary); });
  assert.deepEqual(summaries, [
    [null, "RIR 0", "RIR 5 · Both sides · Tempo 3-1-1s · Full ROM"],
    ["Left", "Right", "RIR 2 · Left"],
    ["Tempo 4-–-–s", "Tempo 2-0-1s · Partial ROM"],
    ["RIR 1"]
  ]);
});

test("existing readers (progression / lift history) ignore metadata and still work on mixed logs", function() {
  const ex = DEMO_SESSION_METADATA_B.exercises[0];
  assert.deepEqual(bestDoneSet(ex), { weight: 185, reps: 5 });
  const hist = buildLiftHistory(DEMO_WORKOUT_LOG_B.concat(DEMO_WORKOUT_LOG_A));
  assert.ok(Array.isArray(hist["Squat"]));
  hist["Squat"].forEach(function(e) { assert.deepEqual(Object.keys(e).sort(), ["reps", "t", "weight"]); });
  assert.equal(bestDoneSet(DEMO_SESSION_PARTIAL.exercises[0]).weight, 225);
});

// ── the component really uses these helpers ─────────────────────────────

test("ExerciseTab and CalendarTab are wired to the shared helpers (source guard)", function() {
  const tab = readFileSync(new URL("../js/screens/ExerciseTab.js", import.meta.url), "utf8");
  ["startSessionFromRoutine(", "updateSetNumberField(", "toggleSetDone(", "updateSetMetadataInput(",
   "clearSessionSetDetails(", "buildCompletedWorkoutRecord("].forEach(function(fn) {
    assert.ok(tab.indexOf(fn) >= 0, "ExerciseTab should call " + fn);
  });
  assert.ok(tab.indexOf("logCompletedWorkout(buildCompletedWorkoutRecord(") >= 0, "finishWorkout logs the helper's record");
  const cal = readFileSync(new URL("../js/screens/CalendarTab.js", import.meta.url), "utf8");
  assert.ok(cal.indexOf("formatSetMetadataSummary(") >= 0, "history recap renders the compact summary");
});
