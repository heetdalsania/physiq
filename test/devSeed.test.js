/* ─── Tests — dev-only demo seeder ────────────────────────────────────────
 *
 * The seeder exists so workout history / profile switching / nutrition
 * persistence can be exercised by hand against synthetic data. These tests
 * pin the safety properties: it never auto-runs, never overwrites, and can
 * only reach the reserved demo namespaces.
 * ───────────────────────────────────────────────────────────────────────── */

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  installLocalStorageStub,
  uninstallLocalStorageStub
} from "./helpers/localStorageStub.js";

import { uKey, get, loadUser, _resetCorruptWarnings } from "../js/utils/storage.js";
import {
  seedDemoData,
  clearDemoData,
  demoStatus,
  registerDevSeed
} from "../js/dev/seed.js";
import {
  DEMO_EMAIL_A,
  DEMO_EMAIL_B,
  DEMO_PROFILE_A,
  DEMO_WORKOUT_LOG_A,
  DEMO_WORKOUT_LOG_B,
  DEMO_HISTORY_A
} from "../js/dev/demoFixtures.js";

const REAL_EMAIL = "real-user@example.com";

function fresh() {
  _resetCorruptWarnings();
  return installLocalStorageStub();
}

/* A pre-existing "real" account the seeder must never touch. */
function seedRealAccount() {
  const profile = { name: "Real", weight: 200, goal: "cut" };
  const log = [{ id: 1, title: "Real Session", finishedAt: 1, completedSets: 1, totalSets: 1, exercises: [] }];
  localStorage.setItem(uKey(REAL_EMAIL, "profile"), JSON.stringify(profile));
  localStorage.setItem(uKey(REAL_EMAIL, "workoutLog"), JSON.stringify(log));
  localStorage.setItem(uKey(REAL_EMAIL, "history"), JSON.stringify([{ date: "x", calories: 2000 }]));
  localStorage.setItem("pq_last_email", REAL_EMAIL);
  return { profile: profile, log: log };
}

function withWindow(search, fn) {
  const had = Object.prototype.hasOwnProperty.call(globalThis, "window");
  const prev = globalThis.window;
  globalThis.window = { location: { search: search } };
  try { return fn(); } finally {
    if (had) globalThis.window = prev; else delete globalThis.window;
  }
}

test.afterEach(function () {
  uninstallLocalStorageStub();
  delete globalThis.__physiqSeed;
});

// ── registration gating ─────────────────────────────────────────────────

test("registerDevSeed does nothing without dev mode", function () {
  fresh();
  assert.equal(registerDevSeed(), false, "no window → not registered");

  withWindow("", function () {
    assert.equal(registerDevSeed(), false);
    assert.equal(globalThis.window.__physiqSeed, undefined);
  });
});

test("registerDevSeed installs handles only under ?dev=1", function () {
  fresh();
  withWindow("?dev=1", function () {
    assert.equal(registerDevSeed(), true);
    const handle = globalThis.window.__physiqSeed;
    assert.equal(typeof handle.seed, "function");
    assert.equal(typeof handle.clear, "function");
    assert.equal(typeof handle.status, "function");
    assert.deepEqual(handle.emails, [DEMO_EMAIL_A, DEMO_EMAIL_B]);
  });
});

test("registering the seeder does not seed anything by itself", function () {
  const ls = fresh();
  const before = ls.snapshot();
  withWindow("?dev=1", function () { registerDevSeed(); });
  assert.deepEqual(ls.snapshot(), before, "registration must write nothing");
  assert.deepEqual(demoStatus().map(function (s) { return s.present; }), [false, false]);
});

// ── seeding ─────────────────────────────────────────────────────────────

test("seed() writes both demo profiles with the fixture data", function () {
  fresh();
  const r = seedDemoData();

  assert.deepEqual(r.seeded, [DEMO_EMAIL_A, DEMO_EMAIL_B]);
  assert.deepEqual(r.skipped, []);
  assert.deepEqual(r.failed, []);

  assert.deepEqual(loadUser(DEMO_EMAIL_A), DEMO_PROFILE_A);
  assert.deepEqual(get(uKey(DEMO_EMAIL_A, "workoutLog"), null), DEMO_WORKOUT_LOG_A);
  assert.deepEqual(get(uKey(DEMO_EMAIL_B, "workoutLog"), null), DEMO_WORKOUT_LOG_B);
  assert.deepEqual(get(uKey(DEMO_EMAIL_A, "history"), null), DEMO_HISTORY_A);
  assert.deepEqual(demoStatus().map(function (s) { return s.present; }), [true, true]);
});

test("seed() is deterministic — two fresh seeds produce identical bytes", function () {
  const a = fresh();
  seedDemoData();
  const first = a.snapshot();

  const b = fresh();
  seedDemoData();
  assert.deepEqual(b.snapshot(), first);
});

test("seed() refuses to overwrite an existing demo profile", function () {
  const ls = fresh();
  seedDemoData();

  // Simulate work done in the demo account.
  localStorage.setItem(uKey(DEMO_EMAIL_A, "workoutLog"), JSON.stringify([{ id: 42 }]));
  const before = ls.snapshot();

  const r = seedDemoData();

  assert.deepEqual(r.seeded, []);
  assert.deepEqual(r.skipped, [DEMO_EMAIL_A, DEMO_EMAIL_B]);
  assert.deepEqual(ls.snapshot(), before, "an existing demo profile must not be rewritten");
  assert.deepEqual(get(uKey(DEMO_EMAIL_A, "workoutLog"), null), [{ id: 42 }]);
});

test("seed() only fills in the demo profile that is missing", function () {
  fresh();
  seedDemoData();
  clearDemoData();
  // Re-create only B, then seed: A is filled, B is left alone.
  localStorage.setItem(uKey(DEMO_EMAIL_B, "profile"), JSON.stringify({ name: "kept" }));

  const r = seedDemoData();

  assert.deepEqual(r.seeded, [DEMO_EMAIL_A]);
  assert.deepEqual(r.skipped, [DEMO_EMAIL_B]);
  assert.deepEqual(loadUser(DEMO_EMAIL_B), { name: "kept" });
});

// ── isolation from real data ────────────────────────────────────────────

test("seed() never touches a real account's keys", function () {
  const ls = fresh();
  const real = seedRealAccount();
  const realKeysBefore = ls.snapshot();

  seedDemoData();

  Object.keys(realKeysBefore).forEach(function (k) {
    assert.equal(ls.getItem(k), realKeysBefore[k], "seeder mutated a pre-existing key: " + k);
  });
  assert.deepEqual(get(uKey(REAL_EMAIL, "profile"), null), real.profile);
  assert.deepEqual(get(uKey(REAL_EMAIL, "workoutLog"), null), real.log);
  assert.equal(ls.getItem("pq_last_email"), REAL_EMAIL, "seeding must not switch the active account");
});

test("clear() removes demo keys and nothing else", function () {
  const ls = fresh();
  const real = seedRealAccount();
  ls.rawSet("pq_theme", "light");
  ls.rawSet("unrelated_key", "keep");
  seedDemoData();

  const r = clearDemoData();

  assert.ok(r.removed.length > 0);
  r.removed.forEach(function (k) {
    assert.ok(
      k.indexOf("pq_" + DEMO_EMAIL_A + "_") === 0 || k.indexOf("pq_" + DEMO_EMAIL_B + "_") === 0,
      "clear() removed a non-demo key: " + k
    );
  });

  assert.deepEqual(demoStatus().map(function (s) { return s.present; }), [false, false]);
  assert.deepEqual(get(uKey(REAL_EMAIL, "profile"), null), real.profile);
  assert.deepEqual(get(uKey(REAL_EMAIL, "workoutLog"), null), real.log);
  assert.equal(ls.getItem("pq_theme"), "light");
  assert.equal(ls.getItem("unrelated_key"), "keep");
});

test("seed → clear → seed returns to the exact seeded state", function () {
  const ls = fresh();
  seedRealAccount();
  seedDemoData();
  const seeded = ls.snapshot();

  clearDemoData();
  seedDemoData();

  assert.deepEqual(ls.snapshot(), seeded);
});

test("demoStatus() is read-only", function () {
  const ls = fresh();
  seedDemoData();
  const before = ls.snapshot();
  demoStatus();
  demoStatus();
  assert.deepEqual(ls.snapshot(), before);
});

// ── the two demo profiles stay distinct ─────────────────────────────────

test("seeded demo profiles are isolated from each other", function () {
  fresh();
  seedDemoData();

  assert.notDeepEqual(loadUser(DEMO_EMAIL_A), loadUser(DEMO_EMAIL_B));
  assert.notDeepEqual(
    get(uKey(DEMO_EMAIL_A, "workoutLog"), null),
    get(uKey(DEMO_EMAIL_B, "workoutLog"), null)
  );
  assert.equal(get(uKey(DEMO_EMAIL_A, "workoutLog"), []).length, 3);
  assert.equal(get(uKey(DEMO_EMAIL_B, "workoutLog"), []).length, DEMO_WORKOUT_LOG_B.length);
});
