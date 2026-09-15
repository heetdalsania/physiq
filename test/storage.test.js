/* ─── Tests — storage contract, migrations & profile isolation ────────────
 *
 * Milestone 0 regression net around the persistence layer. These lock in
 * the behaviour STORAGE_CONTRACT.md documents, so TissueOS work later can
 * be shown not to have moved it.
 * ───────────────────────────────────────────────────────────────────────── */

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  installLocalStorageStub,
  uninstallLocalStorageStub,
  quotaError
} from "./helpers/localStorageStub.js";

import {
  SCHEMA_VERSION,
  SCHEMA_KEY,
  MIGRATIONS,
  get,
  set,
  uKey,
  loadUser,
  loadHistory,
  saveHistory,
  sv,
  runMigrations,
  readSchemaVersion,
  exportAll,
  importAll,
  quarantineCorrupt,
  quarantineProfile,
  isWriteProtected,
  removeIfReadable,
  loadDaily,
  CORRUPT_SUFFIX,
  PROFILE_KEY_SUFFIXES,
  _resetCorruptWarnings,
  _resetProtections
} from "../js/utils/storage.js";

import { EXERCISE_MUSCLE, EMPTY_INTAKE } from "../js/data/constants.js";
import {
  DEMO_EMAIL_A,
  DEMO_EMAIL_B,
  DEMO_PROFILE_A,
  DEMO_PROFILE_B,
  DEMO_WORKOUT_LOG_A,
  DEMO_WORKOUT_LOG_B,
  DEMO_SESSION_COMPLETE,
  DEMO_SESSION_PARTIAL,
  DEMO_ACTIVE_SESSION,
  DEMO_HISTORY_A,
  DEMO_INTAKE_A,
  DEMO_MEALS_A,
  DEMO_WEEKLY_MUSCLES_A,
  DEMO_SET_TARGETS_A,
  DEMO_BUNDLES
} from "../js/dev/demoFixtures.js";

// ── harness ─────────────────────────────────────────────────────────────

/* Fresh stub + clean module registries for every test. */
function fresh(initial) {
  _resetCorruptWarnings();
  _resetProtections();
  return installLocalStorageStub(initial);
}

/* ── App.js mount simulation ──────────────────────────────────────────────
 *
 * Mirrors what App.js does when a profile is loaded, in order:
 *
 *   1. quarantineProfile(email, passiveFallbacks())   [App.js:331 / :800]
 *   2. each key is read, falling back in memory on a parse failure
 *      (the useState initialisers, loadDaily(), loadHistory())
 *   3. the eager useEffect persistence writers fire once `screen === "app"`
 *      and write that in-memory value straight back  [App.js:335-375]
 *
 * Step 3 is the one that used to destroy malformed data. The
 * "App.js declares a fallback for every eager writer" test below guards
 * this mirror against drifting from the real source. */
function mondayKey(d) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  const day = x.getDay();
  x.setDate(x.getDate() - (day === 0 ? 6 : day - 1));
  const p = function (n) { return n < 10 ? "0" + n : "" + n; };
  return x.getFullYear() + "-" + p(x.getMonth() + 1) + "-" + p(x.getDate());
}

function passiveFallbacks() {
  return {
    intake: Object.assign({}, EMPTY_INTAKE),
    meals: [],
    history: [],
    routines: [],
    workoutLog: [],
    weeklyMuscles: { weekStart: mondayKey(new Date()), dates: {}, sessions: {}, sets: {} },
    setTargets: {},
    recentFoods: [],
    planDrafts: { training: [], rest: [] }
  };
}

/* The seven keys App.js writes back eagerly on mount (`profile` included —
   it is exempt from protection but still swept; see quarantineProfile). */
const EAGER_WRITERS = [
  "profile", "intake", "meals", "routines",
  "workoutLog", "weeklyMuscles", "setTargets"
];

function simulateAppLoad(email) {
  const fallbacks = passiveFallbacks();
  quarantineProfile(email, fallbacks);

  const inMemory = {};
  Object.keys(fallbacks).forEach(function (suffix) {
    inMemory[suffix] = get(uKey(email, suffix), fallbacks[suffix]);
  });

  // The eager write-back. `profile` is skipped exactly as App.js skips it:
  // a malformed profile makes loadUser() null and the app never reaches the
  // screen where that effect runs.
  EAGER_WRITERS.forEach(function (suffix) {
    if (suffix === "profile") return;
    sv(email, suffix, inMemory[suffix]);
  });
  return inMemory;
}

/* Writes a bundle the way the app would: plain JSON under uKey names. */
function seedBundle(bundle) {
  Object.keys(bundle.keys).forEach(function (suffix) {
    localStorage.setItem(uKey(bundle.email, suffix), JSON.stringify(bundle.keys[suffix]));
  });
}

test.afterEach(function () { uninstallLocalStorageStub(); });

// ── baseline versioning ─────────────────────────────────────────────────

test("fresh storage migrates to the current version", function () {
  fresh();
  const r = runMigrations();
  assert.equal(r.ok, true);
  assert.equal(r.from, 0);
  assert.equal(r.to, SCHEMA_VERSION);
  assert.deepEqual(r.applied, [1]);
  assert.equal(readSchemaVersion(), SCHEMA_VERSION);
});

test("runMigrations is idempotent — repeated init applies nothing new", function () {
  fresh();
  runMigrations();
  const second = runMigrations();
  const third = runMigrations();
  assert.deepEqual(second.applied, []);
  assert.deepEqual(third.applied, []);
  assert.equal(second.ok, true);
  assert.equal(readSchemaVersion(), SCHEMA_VERSION);
});

test("repeated initialization preserves existing records byte-for-byte", function () {
  const ls = fresh();
  seedBundle(DEMO_BUNDLES[0]);
  const before = ls.snapshot();

  runMigrations();
  runMigrations();
  runMigrations();

  const after = ls.snapshot();
  // Only the version sentinel may appear; every seeded key is untouched.
  Object.keys(before).forEach(function (k) {
    assert.equal(after[k], before[k], "key mutated by migration: " + k);
  });
  assert.deepEqual(
    get(uKey(DEMO_EMAIL_A, "workoutLog"), null),
    DEMO_WORKOUT_LOG_A
  );
});

test("unversioned (pre-v1) data stays readable and is not rewritten", function () {
  const ls = fresh();
  seedBundle(DEMO_BUNDLES[0]);
  assert.equal(ls.getItem(SCHEMA_KEY), null, "precondition: no version sentinel");

  // Readable BEFORE any migration runs.
  assert.deepEqual(loadUser(DEMO_EMAIL_A), DEMO_PROFILE_A);
  assert.deepEqual(loadHistory(DEMO_EMAIL_A), DEMO_HISTORY_A);

  const payloadBefore = ls.getItem(uKey(DEMO_EMAIL_A, "workoutLog"));
  const r = runMigrations();

  assert.equal(r.from, 0);
  assert.equal(r.ok, true);
  // Same on-disk bytes: v1 is a pure stamp, no envelope, no reshaping.
  assert.equal(ls.getItem(uKey(DEMO_EMAIL_A, "workoutLog")), payloadBefore);
  assert.deepEqual(loadUser(DEMO_EMAIL_A), DEMO_PROFILE_A);
});

test("a newer on-disk version is never silently downgraded", function () {
  const ls = fresh();
  seedBundle(DEMO_BUNDLES[0]);
  ls.rawSet(SCHEMA_KEY, "99");

  const r = runMigrations();

  assert.equal(readSchemaVersion(), 99, "version must not roll backwards");
  assert.deepEqual(r.applied, []);
  assert.match(r.error, /newer/);
  // And the data itself is left alone.
  assert.deepEqual(get(uKey(DEMO_EMAIL_A, "workoutLog"), null), DEMO_WORKOUT_LOG_A);
});

// ── failure paths ───────────────────────────────────────────────────────

test("a failed sentinel write does not leave a falsely advanced version", function () {
  const ls = fresh();
  seedBundle(DEMO_BUNDLES[0]);
  ls.failWritesFor(function (k) { return k === SCHEMA_KEY; }, quotaError());

  const r = runMigrations();

  assert.equal(r.ok, false);
  assert.equal(readSchemaVersion(), 0, "version must stay put when the write fails");
  assert.deepEqual(r.applied, []);

  // Recovery: once writes work again, the same run completes cleanly.
  ls.allowWrites();
  const retry = runMigrations();
  assert.equal(retry.ok, true);
  assert.equal(readSchemaVersion(), SCHEMA_VERSION);
});

test("a throwing migration step aborts without advancing the version", function () {
  const ls = fresh();
  seedBundle(DEMO_BUNDLES[0]);
  const original = MIGRATIONS.slice();
  MIGRATIONS.splice(0, MIGRATIONS.length, {
    to: 1,
    describe: "test-only failing step",
    run: function () { throw new Error("boom"); }
  });

  try {
    const r = runMigrations();
    assert.equal(r.ok, false);
    assert.match(r.error, /boom/);
    assert.equal(readSchemaVersion(), 0);
    // User data survived the failed upgrade untouched.
    assert.deepEqual(get(uKey(DEMO_EMAIL_A, "workoutLog"), null), DEMO_WORKOUT_LOG_A);
    assert.deepEqual(get(uKey(DEMO_EMAIL_A, "history"), null), DEMO_HISTORY_A);
  } finally {
    MIGRATIONS.splice(0, MIGRATIONS.length);
    original.forEach(function (m) { MIGRATIONS.push(m); });
  }
  assert.equal(MIGRATIONS.length, 1, "MIGRATIONS restored for other tests");
});

// ── malformed data ──────────────────────────────────────────────────────

test("malformed JSON falls back to the default and is NOT deleted", function () {
  const ls = fresh();
  ls.rawSet(uKey(DEMO_EMAIL_A, "workoutLog"), "{not valid json");

  const value = get(uKey(DEMO_EMAIL_A, "workoutLog"), []);

  assert.deepEqual(value, [], "caller gets its default");
  assert.equal(
    ls.getItem(uKey(DEMO_EMAIL_A, "workoutLog")),
    "{not valid json",
    "raw value must survive for manual recovery / export"
  );
});

test("one corrupted key does not affect its neighbours or migration", function () {
  const ls = fresh();
  seedBundle(DEMO_BUNDLES[0]);
  ls.rawSet(uKey(DEMO_EMAIL_A, "setTargets"), "]]corrupt[[");

  runMigrations();

  assert.deepEqual(get(uKey(DEMO_EMAIL_A, "setTargets"), {}), {});
  assert.equal(ls.getItem(uKey(DEMO_EMAIL_A, "setTargets")), "]]corrupt[[");
  // Everything else still loads.
  assert.deepEqual(loadUser(DEMO_EMAIL_A), DEMO_PROFILE_A);
  assert.deepEqual(get(uKey(DEMO_EMAIL_A, "workoutLog"), null), DEMO_WORKOUT_LOG_A);
  assert.deepEqual(get(uKey(DEMO_EMAIL_A, "meals"), null), DEMO_MEALS_A);
});

test("quarantine preserves an unreadable value before it can be overwritten", function () {
  const ls = fresh();
  const key = uKey(DEMO_EMAIL_A, "setTargets");
  ls.rawSet(key, "}}CORRUPT{{");

  assert.equal(quarantineCorrupt(key), true);
  assert.equal(ls.getItem(key + CORRUPT_SUFFIX), "}}CORRUPT{{");

  // Now simulate what App.js does on mount: read (fails → default) and
  // persist the default back. The original bytes still survive.
  const value = get(key, {});
  sv(DEMO_EMAIL_A, "setTargets", value);
  assert.equal(ls.getItem(key), "{}");
  assert.equal(ls.getItem(key + CORRUPT_SUFFIX), "}}CORRUPT{{", "rescued copy lost");
});

test("quarantine is idempotent and keeps the first copy", function () {
  const ls = fresh();
  const key = uKey(DEMO_EMAIL_A, "routines");
  ls.rawSet(key, "original-bad-bytes");

  assert.equal(quarantineCorrupt(key), true);
  ls.rawSet(key, "different-bad-bytes");
  assert.equal(quarantineCorrupt(key), false, "second call must not re-copy");
  assert.equal(ls.getItem(key + CORRUPT_SUFFIX), "original-bad-bytes");
});

test("quarantine ignores values that parse fine", function () {
  const ls = fresh();
  seedBundle(DEMO_BUNDLES[0]);
  const before = ls.snapshot();

  DEMO_BUNDLES[0].keys && Object.keys(DEMO_BUNDLES[0].keys).forEach(function (suffix) {
    assert.equal(quarantineCorrupt(uKey(DEMO_EMAIL_A, suffix)), false);
  });

  assert.deepEqual(ls.snapshot(), before, "healthy data must not be touched");
});

test("quarantineProfile sweeps only the profile it is given", function () {
  const ls = fresh();
  DEMO_BUNDLES.forEach(seedBundle);
  ls.rawSet(uKey(DEMO_EMAIL_A, "workoutLog"), "bad-A");
  ls.rawSet(uKey(DEMO_EMAIL_B, "workoutLog"), "bad-B");

  const rescued = quarantineProfile(DEMO_EMAIL_A);

  assert.deepEqual(rescued, [uKey(DEMO_EMAIL_A, "workoutLog")]);
  assert.equal(ls.getItem(uKey(DEMO_EMAIL_A, "workoutLog") + CORRUPT_SUFFIX), "bad-A");
  assert.equal(
    ls.getItem(uKey(DEMO_EMAIL_B, "workoutLog") + CORRUPT_SUFFIX),
    null,
    "the other profile must not be swept"
  );
  assert.equal(ls.getItem(uKey(DEMO_EMAIL_B, "workoutLog")), "bad-B", "and not modified");
});

test("quarantineProfile is a no-op on healthy data and on no email", function () {
  const ls = fresh();
  seedBundle(DEMO_BUNDLES[0]);
  const before = ls.snapshot();

  assert.deepEqual(quarantineProfile(DEMO_EMAIL_A), []);
  assert.deepEqual(quarantineProfile(""), []);
  assert.deepEqual(ls.snapshot(), before);
});

test("a rescued copy travels with Export Data", function () {
  const ls = fresh();
  const key = uKey(DEMO_EMAIL_A, "history");
  ls.rawSet(key, "}}half-written-history{{");
  quarantineProfile(DEMO_EMAIL_A);

  const snapshot = exportAll();
  assert.equal(snapshot.data[key + CORRUPT_SUFFIX], "}}half-written-history{{");
});

// ── malformed data survives initialization ──────────────────────────────

test("malformed bytes stay at the ORIGINAL key after a full app load", function () {
  const ls = fresh();
  seedBundle(DEMO_BUNDLES[0]);
  const corrupt = "}}NOT JSON — user data in here{{";
  ls.rawSet(uKey(DEMO_EMAIL_A, "workoutLog"), corrupt);
  ls.rawSet(uKey(DEMO_EMAIL_A, "setTargets"), corrupt);

  const inMemory = simulateAppLoad(DEMO_EMAIL_A);

  // The app still renders: it got safe fallbacks in memory.
  assert.deepEqual(inMemory.workoutLog, []);
  assert.deepEqual(inMemory.setTargets, {});

  // …and the original bytes are untouched, byte for byte.
  assert.equal(ls.getItem(uKey(DEMO_EMAIL_A, "workoutLog")), corrupt);
  assert.equal(ls.getItem(uKey(DEMO_EMAIL_A, "setTargets")), corrupt);
  assert.equal(isWriteProtected(uKey(DEMO_EMAIL_A, "workoutLog")), true);
});

test("repeated initialization never alters malformed bytes", function () {
  const ls = fresh();
  seedBundle(DEMO_BUNDLES[0]);
  const corrupt = "}}STILL NOT JSON{{";
  ls.rawSet(uKey(DEMO_EMAIL_A, "routines"), corrupt);

  simulateAppLoad(DEMO_EMAIL_A);
  const afterFirst = ls.snapshot();
  simulateAppLoad(DEMO_EMAIL_A);
  simulateAppLoad(DEMO_EMAIL_A);

  assert.equal(ls.getItem(uKey(DEMO_EMAIL_A, "routines")), corrupt);
  assert.deepEqual(ls.snapshot(), afterFirst, "a later load changed storage");
});

test("loading with malformed data leaves unrelated keys unchanged", function () {
  const ls = fresh();
  seedBundle(DEMO_BUNDLES[0]);
  seedBundle(DEMO_BUNDLES[1]);
  ls.rawSet("pq_theme", "light");
  ls.rawSet("pq_last_email", DEMO_EMAIL_A);
  ls.rawSet("some_other_app_key", "keep-me");
  ls.rawSet(uKey(DEMO_EMAIL_A, "futureThing"), JSON.stringify({ a: 1 }));
  ls.rawSet(uKey(DEMO_EMAIL_A, "weeklyMuscles"), "}}CORRUPT{{");

  const untouched = {
    theme: ls.getItem("pq_theme"),
    lastEmail: ls.getItem("pq_last_email"),
    other: ls.getItem("some_other_app_key"),
    future: ls.getItem(uKey(DEMO_EMAIL_A, "futureThing")),
    bProfile: ls.getItem(uKey(DEMO_EMAIL_B, "profile")),
    bWorkouts: ls.getItem(uKey(DEMO_EMAIL_B, "workoutLog"))
  };

  simulateAppLoad(DEMO_EMAIL_A);

  assert.equal(ls.getItem("pq_theme"), untouched.theme);
  assert.equal(ls.getItem("pq_last_email"), untouched.lastEmail);
  assert.equal(ls.getItem("some_other_app_key"), untouched.other);
  assert.equal(ls.getItem(uKey(DEMO_EMAIL_A, "futureThing")), untouched.future);
  assert.equal(ls.getItem(uKey(DEMO_EMAIL_B, "profile")), untouched.bProfile);
  assert.equal(ls.getItem(uKey(DEMO_EMAIL_B, "workoutLog")), untouched.bWorkouts);
});

test("valid records behave exactly as before — load is a faithful round-trip", function () {
  const ls = fresh();
  seedBundle(DEMO_BUNDLES[0]);
  const before = ls.snapshot();

  const inMemory = simulateAppLoad(DEMO_EMAIL_A);

  // Nothing is write-protected, values load intact…
  PROFILE_KEY_SUFFIXES.forEach(function (suffix) {
    assert.equal(isWriteProtected(uKey(DEMO_EMAIL_A, suffix)), false, suffix);
  });
  assert.deepEqual(inMemory.workoutLog, DEMO_WORKOUT_LOG_A);
  assert.deepEqual(inMemory.history, DEMO_HISTORY_A);
  assert.deepEqual(inMemory.setTargets, DEMO_SET_TARGETS_A);

  // …and the write-back reproduces exactly what was there.
  Object.keys(before).forEach(function (k) {
    assert.equal(ls.snapshot()[k], before[k], "healthy key changed on load: " + k);
  });
});

test("an explicit user edit DOES replace a malformed value", function () {
  const ls = fresh();
  seedBundle(DEMO_BUNDLES[0]);
  ls.rawSet(uKey(DEMO_EMAIL_A, "setTargets"), "}}CORRUPT{{");

  simulateAppLoad(DEMO_EMAIL_A);
  assert.equal(ls.getItem(uKey(DEMO_EMAIL_A, "setTargets")), "}}CORRUPT{{");

  // User sets a target — a value that differs from the fallback.
  sv(DEMO_EMAIL_A, "setTargets", { chest: 14 });

  assert.deepEqual(get(uKey(DEMO_EMAIL_A, "setTargets"), null), { chest: 14 });
  assert.equal(isWriteProtected(uKey(DEMO_EMAIL_A, "setTargets")), false, "protection released");

  // Once released it behaves normally — including writing the empty value.
  sv(DEMO_EMAIL_A, "setTargets", {});
  assert.deepEqual(get(uKey(DEMO_EMAIL_A, "setTargets"), null), {});
});

test("a suppressed passive write reports success, not failure", function () {
  const ls = fresh();
  ls.rawSet(uKey(DEMO_EMAIL_A, "routines"), "}}CORRUPT{{");
  quarantineProfile(DEMO_EMAIL_A, passiveFallbacks());

  // sv() callers treat false as "could not store"; a deliberate no-op must
  // not look like a storage failure.
  assert.equal(set(uKey(DEMO_EMAIL_A, "routines"), []), true);
  assert.equal(ls.getItem(uKey(DEMO_EMAIL_A, "routines")), "}}CORRUPT{{");
});

test("write protection is per-profile", function () {
  const ls = fresh();
  DEMO_BUNDLES.forEach(seedBundle);
  ls.rawSet(uKey(DEMO_EMAIL_A, "workoutLog"), "}}CORRUPT-A{{");
  ls.rawSet(uKey(DEMO_EMAIL_B, "workoutLog"), "}}CORRUPT-B{{");

  quarantineProfile(DEMO_EMAIL_A, passiveFallbacks());

  assert.equal(isWriteProtected(uKey(DEMO_EMAIL_A, "workoutLog")), true);
  assert.equal(isWriteProtected(uKey(DEMO_EMAIL_B, "workoutLog")), false,
    "sweeping one profile must not protect another");

  // B is untouched by A's load, and A's bytes survive A's write-back.
  simulateAppLoad(DEMO_EMAIL_A);
  assert.equal(ls.getItem(uKey(DEMO_EMAIL_A, "workoutLog")), "}}CORRUPT-A{{");
  assert.equal(ls.getItem(uKey(DEMO_EMAIL_B, "workoutLog")), "}}CORRUPT-B{{");
});

test("profile is exempt from protection so onboarding can still save", function () {
  const ls = fresh();
  ls.rawSet(uKey(DEMO_EMAIL_A, "profile"), "}}CORRUPT{{");

  quarantineProfile(DEMO_EMAIL_A, passiveFallbacks());

  // Malformed profile → loadUser() is null → the app routes to onboarding.
  assert.equal(loadUser(DEMO_EMAIL_A), null);
  assert.equal(isWriteProtected(uKey(DEMO_EMAIL_A, "profile")), false);
  // The original is still recoverable from the sidecar.
  assert.equal(ls.getItem(uKey(DEMO_EMAIL_A, "profile") + CORRUPT_SUFFIX), "}}CORRUPT{{");

  // Finishing onboarding must land.
  sv(DEMO_EMAIL_A, "profile", DEMO_PROFILE_A);
  assert.deepEqual(loadUser(DEMO_EMAIL_A), DEMO_PROFILE_A);
});

test("the day rollover clears readable intake/meals but not malformed ones", function () {
  const ls = fresh();
  ls.rawSet(uKey(DEMO_EMAIL_A, "date"), "Mon Jan 01 2001");   // stale → rollover
  ls.rawSet(uKey(DEMO_EMAIL_A, "intake"), "}}CORRUPT{{");
  ls.rawSet(uKey(DEMO_EMAIL_A, "meals"), JSON.stringify(DEMO_MEALS_A));

  const daily = loadDaily(DEMO_EMAIL_A);

  assert.deepEqual(daily.meals, [], "a new day starts empty in memory");
  assert.equal(ls.getItem(uKey(DEMO_EMAIL_A, "meals")), null, "readable value cleared as before");
  assert.equal(ls.getItem(uKey(DEMO_EMAIL_A, "intake")), "}}CORRUPT{{",
    "malformed value must not be discarded by routine housekeeping");
});

test("removeIfReadable refuses to discard unparseable values", function () {
  const ls = fresh();
  ls.rawSet("pq_good", JSON.stringify({ a: 1 }));
  ls.rawSet("pq_bad", "}}CORRUPT{{");

  assert.equal(removeIfReadable("pq_good"), true);
  assert.equal(removeIfReadable("pq_bad"), false);
  assert.equal(removeIfReadable("pq_absent"), true);

  assert.equal(ls.getItem("pq_good"), null);
  assert.equal(ls.getItem("pq_bad"), "}}CORRUPT{{");
});

test("App.js declares a passive fallback for every eager writer it has", function () {
  // Static guard against drift: if someone adds a new eager sv(email, "x")
  // persistence effect without adding "x" to App.js's passiveFallbacks(),
  // that key loses its malformed-data protection silently. Fail loudly.
  const src = readFileSync(new URL("../js/App.js", import.meta.url), "utf8");

  const marker = "function passiveFallbacks() {";
  const from = src.indexOf(marker);
  assert.ok(from >= 0, "passiveFallbacks() not found in App.js");
  const block = src.slice(from, src.indexOf("\n}", from));

  const declared = new Set();
  block.split("\n").forEach(function (line) {
    const m = /^\s{4}([A-Za-z]\w*):/.exec(line);
    if (m) declared.add(m[1]);
  });
  assert.ok(declared.size > 0, "parsed no fallback keys — the mirror drifted");

  // Every suffix persisted through sv(email, "...") anywhere in App.js.
  const written = new Set();
  const wre = /sv\(\s*email\s*,\s*"(\w+)"/g;
  let m;
  while ((m = wre.exec(src)) !== null) written.add(m[1]);
  assert.ok(written.size > 0, "no sv(email, ...) writers found — regex drifted");

  written.forEach(function (suffix) {
    if (suffix === "profile") return;   // documented exemption, tested above
    assert.ok(
      declared.has(suffix),
      'App.js writes "' + suffix + '" but declares no passive fallback for it'
    );
  });

  // Every declared fallback must be a key the storage layer actually sweeps.
  declared.forEach(function (suffix) {
    assert.ok(
      PROFILE_KEY_SUFFIXES.indexOf(suffix) >= 0,
      'passiveFallbacks() declares "' + suffix + '" which quarantineProfile does not sweep'
    );
  });

  // And the test harness above must mirror App.js exactly.
  assert.deepEqual(
    Object.keys(passiveFallbacks()).sort(),
    Array.from(declared).sort(),
    "this suite's passiveFallbacks() mirror no longer matches App.js"
  );
});

// ── read-only guarantees ────────────────────────────────────────────────

test("reads and inspection never mutate storage", function () {
  const ls = fresh();
  seedBundle(DEMO_BUNDLES[0]);
  ls.rawSet(uKey(DEMO_EMAIL_A, "routines"), "corrupt-too");
  const before = ls.snapshot();

  loadUser(DEMO_EMAIL_A);
  loadHistory(DEMO_EMAIL_A);
  get(uKey(DEMO_EMAIL_A, "routines"), []);
  get(uKey(DEMO_EMAIL_A, "workoutLog"), []);
  readSchemaVersion();
  exportAll();

  assert.deepEqual(ls.snapshot(), before, "a read path wrote to storage");
});

// ── profile isolation ───────────────────────────────────────────────────

test("profiles are isolated — each reads only its own records", function () {
  fresh();
  DEMO_BUNDLES.forEach(seedBundle);
  runMigrations();

  assert.deepEqual(loadUser(DEMO_EMAIL_A), DEMO_PROFILE_A);
  assert.deepEqual(loadUser(DEMO_EMAIL_B), DEMO_PROFILE_B);
  assert.deepEqual(get(uKey(DEMO_EMAIL_A, "workoutLog"), null), DEMO_WORKOUT_LOG_A);
  assert.deepEqual(get(uKey(DEMO_EMAIL_B, "workoutLog"), null), DEMO_WORKOUT_LOG_B);

  // Distinct data, not an accidental alias.
  assert.notDeepEqual(
    get(uKey(DEMO_EMAIL_A, "workoutLog"), null),
    get(uKey(DEMO_EMAIL_B, "workoutLog"), null)
  );
});

test("writing to one profile leaves the other untouched", function () {
  fresh();
  DEMO_BUNDLES.forEach(seedBundle);

  const bBefore = {
    profile: get(uKey(DEMO_EMAIL_B, "profile"), null),
    workoutLog: get(uKey(DEMO_EMAIL_B, "workoutLog"), null),
    history: get(uKey(DEMO_EMAIL_B, "history"), null),
    meals: get(uKey(DEMO_EMAIL_B, "meals"), null)
  };

  sv(DEMO_EMAIL_A, "profile", Object.assign({}, DEMO_PROFILE_A, { weight: 999 }));
  sv(DEMO_EMAIL_A, "workoutLog", []);
  saveHistory(DEMO_EMAIL_A, []);

  assert.deepEqual(get(uKey(DEMO_EMAIL_B, "profile"), null), bBefore.profile);
  assert.deepEqual(get(uKey(DEMO_EMAIL_B, "workoutLog"), null), bBefore.workoutLog);
  assert.deepEqual(get(uKey(DEMO_EMAIL_B, "history"), null), bBefore.history);
  assert.deepEqual(get(uKey(DEMO_EMAIL_B, "meals"), null), bBefore.meals);
  // …and profile A really did change.
  assert.equal(loadUser(DEMO_EMAIL_A).weight, 999);
});

// ── unrelated keys & unknown fields ─────────────────────────────────────

test("unrelated keys and unknown fields survive migration", function () {
  const ls = fresh();
  seedBundle(DEMO_BUNDLES[0]);
  ls.rawSet("pq_theme", "light");
  ls.rawSet("pq_last_email", DEMO_EMAIL_A);
  ls.rawSet("pq_food_search_cache", JSON.stringify({ oats: { n: 1 } }));
  ls.rawSet("some_other_app_key", "keep-me");
  // A key this build has never heard of, e.g. written by a newer version.
  ls.rawSet(uKey(DEMO_EMAIL_A, "futureThing"), JSON.stringify({ a: 1 }));
  // An unknown FIELD inside a key this build does own.
  ls.rawSet(
    uKey(DEMO_EMAIL_A, "profile"),
    JSON.stringify(Object.assign({}, DEMO_PROFILE_A, { unknownField: "preserve me" }))
  );

  runMigrations();

  assert.equal(ls.getItem("pq_theme"), "light");
  assert.equal(ls.getItem("pq_last_email"), DEMO_EMAIL_A);
  assert.equal(ls.getItem("some_other_app_key"), "keep-me");
  assert.deepEqual(get("pq_food_search_cache", null), { oats: { n: 1 } });
  assert.deepEqual(get(uKey(DEMO_EMAIL_A, "futureThing"), null), { a: 1 });
  assert.equal(loadUser(DEMO_EMAIL_A).unknownField, "preserve me");
});

test("unknown profile fields survive a load → save round-trip", function () {
  fresh();
  const withExtra = Object.assign({}, DEMO_PROFILE_A, { tissueOsPlaceholder: { v: 2 } });
  sv(DEMO_EMAIL_A, "profile", withExtra);

  const loaded = loadUser(DEMO_EMAIL_A);
  sv(DEMO_EMAIL_A, "profile", loaded);

  assert.deepEqual(loadUser(DEMO_EMAIL_A).tissueOsPlaceholder, { v: 2 });
});

// ── workout history semantics ───────────────────────────────────────────

test("completed vs incomplete sets keep their meaning across a reload", function () {
  fresh();
  seedBundle(DEMO_BUNDLES[0]);
  runMigrations();

  const log = get(uKey(DEMO_EMAIL_A, "workoutLog"), []);
  assert.equal(log.length, 3, "three sessions on three different days");

  const complete = log.find(function (s) { return s.id === DEMO_SESSION_COMPLETE.id; });
  const partial = log.find(function (s) { return s.id === DEMO_SESSION_PARTIAL.id; });

  // Fully-completed session: every set done, counters agree.
  assert.equal(complete.completedSets, complete.totalSets);
  const completeDone = complete.exercises.reduce(function (n, ex) {
    return n + ex.sets.filter(function (s) { return s.done; }).length;
  }, 0);
  assert.equal(completeDone, complete.completedSets);

  // Partial session: the unfinished sets are still there, still false.
  assert.equal(partial.completedSets, 3);
  assert.equal(partial.totalSets, 5);
  const partialDone = partial.exercises.reduce(function (n, ex) {
    return n + ex.sets.filter(function (s) { return s.done; }).length;
  }, 0);
  const partialTotal = partial.exercises.reduce(function (n, ex) {
    return n + ex.sets.length;
  }, 0);
  assert.equal(partialDone, 3, "done:false sets must not be dropped or coerced");
  assert.equal(partialTotal, 5);
  assert.equal(partial.exercises[0].sets[2].done, false);
});

test("sessions land on three distinct calendar days", function () {
  fresh();
  seedBundle(DEMO_BUNDLES[0]);

  const log = get(uKey(DEMO_EMAIL_A, "workoutLog"), []);
  const days = log.map(function (s) { return new Date(s.finishedAt).toDateString(); });
  assert.equal(new Set(days).size, 3);
  // Chronological, oldest first — the order App.js appends in.
  const stamps = log.map(function (s) { return s.finishedAt; });
  assert.deepEqual(stamps.slice().sort(function (a, b) { return a - b; }), stamps);
});

test("an in-progress session is in-memory only and has no finish marker", function () {
  // Guards the documented contract: nothing persists a live workout.
  assert.equal(DEMO_ACTIVE_SESSION.finishedAt, undefined);
  assert.equal(DEMO_ACTIVE_SESSION.id, undefined);
  assert.ok(DEMO_ACTIVE_SESSION.startedAt > 0);
  const done = DEMO_ACTIVE_SESSION.exercises.reduce(function (n, ex) {
    return n + ex.sets.filter(function (s) { return s.done; }).length;
  }, 0);
  assert.equal(done, 1, "one set done, the rest still open");
});

test("fixtures stay faithful to the real exercise catalogue", function () {
  // If an exercise is renamed in constants.js this fails loudly, rather
  // than the fixtures quietly drifting away from the app's schema.
  const sessions = DEMO_WORKOUT_LOG_A.concat(DEMO_WORKOUT_LOG_B, [DEMO_ACTIVE_SESSION]);
  sessions.forEach(function (s) {
    s.exercises.forEach(function (ex) {
      assert.ok(
        EXERCISE_MUSCLE[ex.name],
        "fixture uses an exercise the app does not know: " + ex.name
      );
      ex.sets.forEach(function (set) {
        assert.equal(typeof set.reps, "number");
        assert.equal(typeof set.weight, "number");
        assert.equal(typeof set.done, "boolean");
      });
    });
  });
});

test("the weeklyMuscles fixture agrees with the sessions it summarises", function () {
  // App.logCompletedWorkout counts only sets with done:true, attributed via
  // EXERCISE_MUSCLE[ex.name]. Recompute that from the sessions in the same
  // week and check the stored summary matches.
  const weekStart = DEMO_WEEKLY_MUSCLES_A.weekStart;
  const expected = {};
  DEMO_WORKOUT_LOG_A.forEach(function (s) {
    s.exercises.forEach(function (ex) {
      const m = EXERCISE_MUSCLE[ex.name];
      const done = ex.sets.filter(function (x) { return x.done; }).length;
      if (m && done > 0) expected[m] = (expected[m] || 0) + done;
    });
  });
  assert.deepEqual(DEMO_WEEKLY_MUSCLES_A.sets, expected);
  assert.match(weekStart, /^\d{4}-\d{2}-\d{2}$/);
});

// ── nutrition survives everything ───────────────────────────────────────

test("nutrition data is untouched by migration", function () {
  fresh();
  DEMO_BUNDLES.forEach(seedBundle);
  runMigrations();
  runMigrations();

  assert.deepEqual(get(uKey(DEMO_EMAIL_A, "history"), null), DEMO_HISTORY_A);
  assert.deepEqual(get(uKey(DEMO_EMAIL_A, "intake"), null), DEMO_INTAKE_A);
  assert.deepEqual(get(uKey(DEMO_EMAIL_A, "meals"), null), DEMO_MEALS_A);
  assert.deepEqual(get(uKey(DEMO_EMAIL_A, "weeklyMuscles"), null), DEMO_WEEKLY_MUSCLES_A);
  assert.deepEqual(loadHistory(DEMO_EMAIL_B), DEMO_BUNDLES[1].keys.history);
});

test("saveHistory keeps the most recent 90 days", function () {
  fresh();
  const long = [];
  for (let i = 0; i < 120; i++) long.push({ date: "d" + i, calories: 2000 + i });
  saveHistory(DEMO_EMAIL_A, long);

  const back = loadHistory(DEMO_EMAIL_A);
  assert.equal(back.length, 90);
  assert.equal(back[0].date, "d30", "oldest trimmed, newest kept");
  assert.equal(back[89].date, "d119");
});

// ── export / import ─────────────────────────────────────────────────────

test("export → import round-trips every pq_ key", function () {
  fresh();
  DEMO_BUNDLES.forEach(seedBundle);
  runMigrations();
  const snapshot = exportAll();

  fresh(); // simulate a different device
  assert.equal(loadUser(DEMO_EMAIL_A), null);

  assert.equal(importAll(snapshot), true);
  assert.deepEqual(loadUser(DEMO_EMAIL_A), DEMO_PROFILE_A);
  assert.deepEqual(loadUser(DEMO_EMAIL_B), DEMO_PROFILE_B);
  assert.deepEqual(get(uKey(DEMO_EMAIL_A, "workoutLog"), null), DEMO_WORKOUT_LOG_A);
  assert.equal(readSchemaVersion(), SCHEMA_VERSION);
});

test("import rejects a payload from a newer schema", function () {
  const ls = fresh();
  seedBundle(DEMO_BUNDLES[0]);
  const before = ls.snapshot();

  const ok = importAll({ schemaVersion: SCHEMA_VERSION + 1, data: { "pq_x": "1" } });

  assert.equal(ok, false);
  assert.deepEqual(ls.snapshot(), before, "a rejected import must write nothing");
});

test("import of older data re-runs migrations rather than over-stamping", function () {
  fresh();
  // A v0 (unversioned) export: schemaVersion 0, data in pre-v1 shape.
  const payload = {
    schemaVersion: 0,
    data: {}
  };
  payload.data[uKey(DEMO_EMAIL_A, "profile")] = JSON.stringify(DEMO_PROFILE_A);
  payload.data[uKey(DEMO_EMAIL_A, "workoutLog")] = JSON.stringify(DEMO_WORKOUT_LOG_A);

  assert.equal(importAll(payload), true);
  assert.equal(readSchemaVersion(), SCHEMA_VERSION, "pending steps ran after import");
  assert.deepEqual(loadUser(DEMO_EMAIL_A), DEMO_PROFILE_A);
  assert.deepEqual(get(uKey(DEMO_EMAIL_A, "workoutLog"), null), DEMO_WORKOUT_LOG_A);
});

// ── quota handling ──────────────────────────────────────────────────────

test("set() reports failure instead of throwing when the write is blocked", function () {
  const ls = fresh();
  ls.failWritesFor(function () { return true; }, new Error("nope"));
  assert.equal(set("pq_anything", { a: 1 }), false);
});

test("a quota failure prunes the oldest history entry and retries", function () {
  const ls = fresh();
  const long = [];
  for (let i = 0; i < 10; i++) long.push({ date: "d" + i, calories: 2000 });
  ls.rawSet(uKey(DEMO_EMAIL_A, "history"), JSON.stringify(long));

  let firstAttempt = true;
  ls.failWritesFor(function (k) {
    if (k === "pq_big" && firstAttempt) { firstAttempt = false; return true; }
    return false;
  }, quotaError());

  assert.equal(set("pq_big", { payload: "x" }), true);
  assert.equal(loadHistory(DEMO_EMAIL_A).length, 9, "oldest entry pruned");
  assert.equal(loadHistory(DEMO_EMAIL_A)[0].date, "d1");
});
