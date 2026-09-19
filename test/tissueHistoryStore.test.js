/* ─── Tests — Milestone 4 TissueOS history store / reconciliation ─────────
 *
 * Persistence contract for pq_<email>_tissueHistory: idempotent backfill,
 * no duplicates, profile isolation, frozen body mass, source fingerprint
 * reconciliation, malformed / future / failed-write / unreadable-source
 * safety, model-series coexistence and export/import. Runs against the
 * in-memory localStorage stub only.
 * ───────────────────────────────────────────────────────────────────────── */

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { installLocalStorageStub, uninstallLocalStorageStub, quotaError } from "./helpers/localStorageStub.js";
import {
  uKey, exportAll, importAll, quarantineProfile, isWriteProtected, PROFILE_KEY_SUFFIXES, CORRUPT_SUFFIX, sv,
  _resetCorruptWarnings, _resetProtections
} from "../js/utils/storage.js";
import {
  TISSUE_HISTORY_SUFFIX, tissueHistoryKey, readTissueHistory, planReconciliation, reconcileTissueHistory, loadStoredTissueHistoryEntries
} from "../js/utils/tissueHistoryStore.js";
import { TISSUE_HISTORY_SCHEMA_VERSION, sourceFingerprint } from "../js/utils/tissueHistorySnapshot.js";
import { buildTissueLoadHistory } from "../js/utils/tissueLoadHistory.js";
import { DEMO_EMAIL_A, DEMO_EMAIL_B, DEMO_PROFILE_A, DEMO_PROFILE_B, DEMO_WORKOUT_LOG_A, DEMO_WORKOUT_LOG_B, DEMO_BUNDLES } from "../js/dev/demoFixtures.js";

const A = DEMO_EMAIL_A, B = DEMO_EMAIL_B;
const KEY_A = tissueHistoryKey(A), KEY_B = tissueHistoryKey(B);
const at = (y, m, d, h = 12) => new Date(y, m - 1, d, h).getTime();
const NOW = at(2026, 3, 9, 9);
const done = (weight = 225, reps = 5) => ({ reps, weight, done: true });
const squat = (sets = [done()]) => ({ id: 1, name: "Squat", muscle: "Quads", sets });
const session = (id, finishedAt, exercises = [squat()]) => ({ id, routineId: 9, title: "Legs", startedAt: finishedAt - 3600000, finishedAt, completedSets: 1, totalSets: 1, exercises });

function fresh(initial) { _resetCorruptWarnings(); _resetProtections(); return installLocalStorageStub(initial); }
function seedBundle(bundle) { Object.keys(bundle.keys).forEach(s => localStorage.setItem(uKey(bundle.email, s), JSON.stringify(bundle.keys[s]))); }
function reconcileA(workoutLog, profile, extra) { return reconcileTissueHistory({ email: A, workoutLog, profile, now: NOW, persist: true, ...extra }); }
function stored(key = KEY_A) { const raw = localStorage.getItem(key); return raw == null ? null : JSON.parse(raw); }
function freezeDeep(v) { if (v && typeof v === "object") { Object.values(v).forEach(freezeDeep); Object.freeze(v); } return v; }

test.afterEach(() => uninstallLocalStorageStub());

// ── materialization / backfill ──────────────────────────────────────────

test("a completed workout creates exactly one persisted entry; the key is profile-scoped and versioned", () => {
  fresh();
  seedBundle(DEMO_BUNDLES[0]);
  const r = reconcileA([session(1, at(2026, 3, 4))], DEMO_PROFILE_A);
  assert.equal(r.persisted, true);
  assert.equal(r.storageState, "persisted");
  assert.deepEqual(r.report, { created: 1, kept: 0, rebuilt: 0, removed: 0, undatable: 0, foreign: 0, malformed: 0, deduplicated: 0 });
  assert.equal(KEY_A, "pq_demo-a@example.com_tissueHistory");
  assert.equal(TISSUE_HISTORY_SUFFIX, "tissueHistory");
  assert.ok(PROFILE_KEY_SUFFIXES.includes(TISSUE_HISTORY_SUFFIX), "quarantineProfile must sweep the new key");
  const disk = stored();
  assert.equal(disk.schemaVersion, TISSUE_HISTORY_SCHEMA_VERSION);
  assert.equal(disk.entries.length, 1);
  assert.deepEqual(disk.entries, r.entries);
  assert.equal(localStorage.getItem(KEY_B), null);
});

test("legacy backfill of an existing log is idempotent across repeated initialization: no duplicates, no rewrite", () => {
  const stub = fresh();
  seedBundle(DEMO_BUNDLES[0]);
  const first = reconcileA(DEMO_WORKOUT_LOG_A, DEMO_PROFILE_A);
  assert.equal(first.report.created, 3);
  const rawAfterFirst = localStorage.getItem(KEY_A);
  const snapshot = stub.snapshot();
  for (let i = 0; i < 5; i++) {
    const again = reconcileA(DEMO_WORKOUT_LOG_A, DEMO_PROFILE_A, { now: NOW + i * 86400000 });
    assert.equal(again.storageState, "unchanged");
    assert.equal(again.persisted, true);
    assert.deepEqual(again.report, { created: 0, kept: 3, rebuilt: 0, removed: 0, undatable: 0, foreign: 0, malformed: 0, deduplicated: 0 });
  }
  assert.equal(localStorage.getItem(KEY_A), rawAfterFirst, "byte-identical on disk");
  assert.deepEqual(stub.snapshot(), snapshot, "nothing else touched");
  const keys = stored().entries.map(e => e.sourceKey);
  assert.equal(new Set(keys).size, keys.length);
});

test("entries are sorted by frozen local date then completion instant, and the log's own order does not matter", () => {
  fresh();
  const log = [session(3, at(2026, 3, 6)), session(1, at(2026, 3, 2)), session(2, at(2026, 3, 4, 8)), session(4, at(2026, 3, 4, 18))];
  const r = reconcileA(log, DEMO_PROFILE_A);
  assert.deepEqual(r.entries.map(e => e.sourceId), [1, 2, 4, 3]);
  fresh();
  assert.deepEqual(reconcileA(log.slice().reverse(), DEMO_PROFILE_A).entries.map(e => e.sourceId), [1, 2, 4, 3]);
});

test("undatable records are skipped and counted; malformed session shapes do not crash reconciliation", () => {
  fresh();
  const log = [session(1, at(2026, 3, 4)), null, {}, { id: 2, startedAt: at(2026, 3, 4), exercises: [squat()] }, { id: 3, finishedAt: "x" }, { id: 4, finishedAt: at(2026, 3, 5), exercises: "nope" }];
  const r = reconcileA(log, DEMO_PROFILE_A);
  assert.equal(r.report.created, 2);
  assert.equal(r.report.undatable, 4);
  assert.equal(r.entries[1].coverage.completedSets, 0);
});

test("profile A's reconciliation never reads or writes profile B, and vice versa", () => {
  const stub = fresh();
  DEMO_BUNDLES.forEach(seedBundle);
  const before = stub.snapshot();
  reconcileA(DEMO_WORKOUT_LOG_A, DEMO_PROFILE_A);
  const after = stub.snapshot();
  Object.keys(before).forEach(k => assert.equal(after[k], before[k], k + " must be untouched"));
  assert.deepEqual(Object.keys(after).filter(k => !(k in before)), [KEY_A]);
  const rb = reconcileTissueHistory({ email: B, workoutLog: DEMO_WORKOUT_LOG_B, profile: DEMO_PROFILE_B, now: NOW, persist: true });
  assert.equal(rb.report.created, 2);
  assert.equal(localStorage.getItem(KEY_A), after[KEY_A]);
  assert.notEqual(stored(KEY_B).entries[0].inputs.bodyMass, stored(KEY_A).entries[0].inputs.bodyMass, "B froze its own weight (142), A its own (178)");
  assert.equal(stored(KEY_B).entries[0].inputs.bodyMass, 142);
  assert.equal(reconcileTissueHistory({ email: "", workoutLog: [], profile: {}, now: NOW, persist: true }).storageState, "no_profile");
});

test("source workout records and the profile are never mutated", () => {
  fresh();
  const log = freezeDeep(structuredClone(DEMO_WORKOUT_LOG_A));
  const profile = freezeDeep(structuredClone(DEMO_PROFILE_A));
  const before = JSON.stringify([log, profile]);
  reconcileA(log, profile);
  reconcileA(log, profile);
  assert.equal(JSON.stringify([log, profile]), before);
  assert.equal(localStorage.getItem(uKey(A, "workoutLog")), null, "the reconciler does not write the source key");
});

// ── body mass freezing ──────────────────────────────────────────────────

test("changing the current profile weight after materialization leaves the frozen workload unchanged", () => {
  fresh();
  const log = [session(1, at(2026, 3, 4))];
  const r1 = reconcileA(log, { weight: 180, weightLog: [] });
  assert.equal(r1.entries[0].inputs.bodyMass, 180);
  assert.equal(r1.entries[0].tissues.quadriceps.workload, 5 * (225 + 0.75 * 180));
  const raw = localStorage.getItem(KEY_A);
  const r2 = reconcileA(log, { weight: 150, weightLog: [{ date: "2026-03-09", weight: 150 }] }, { now: NOW + 5 * 86400000 });
  assert.equal(r2.storageState, "unchanged");
  assert.equal(localStorage.getItem(KEY_A), raw);
  assert.equal(r2.entries[0].inputs.bodyMass, 180);
  assert.equal(r2.entries[0].tissues.quadriceps.workload, 5 * (225 + 0.75 * 180));
});

test("a new workout after a weight change uses the new historical context while the old entry stays frozen", () => {
  fresh();
  const old = session(1, at(2026, 3, 4));
  reconcileA([old], { weight: 180, weightLog: [] });
  const profile = { weight: 150, weightLog: [{ date: "2026-03-09", weight: 150 }] };
  const r = reconcileA([old, session(2, at(2026, 3, 9, 10))], profile);
  assert.deepEqual(r.report, { created: 1, kept: 1, rebuilt: 0, removed: 0, undatable: 0, foreign: 0, malformed: 0, deduplicated: 0 });
  assert.equal(r.entries[0].inputs.bodyMass, 180);
  assert.equal(r.entries[0].inputs.bodyMassProvenance.source, "profile_weight");
  assert.equal(r.entries[1].inputs.bodyMass, 150);
  assert.equal(r.entries[1].inputs.bodyMassProvenance.source, "weight_log");
  assert.equal(r.entries[1].tissues.quadriceps.workload, 5 * (225 + 0.75 * 150));
});

test("legacy backfill: the measurement at/before each workout day is used; a later measurement is never back-applied; provenance is explicit", () => {
  fresh();
  const profile = { weight: 160, weightLog: [{ date: "2026-03-03", weight: 178 }, { date: "2026-03-08", weight: 160 }] };
  const r = reconcileA([session(1, at(2026, 3, 1)), session(2, at(2026, 3, 5)), session(3, at(2026, 3, 9))], profile);
  assert.deepEqual(r.entries.map(e => [e.inputs.bodyMass, e.inputs.bodyMassProvenance.source, e.inputs.bodyMassProvenance.approximate]),
    [[160, "profile_weight", true], [178, "weight_log", false], [160, "weight_log", false]]);
  assert.equal(r.entries[0].inputs.bodyMassProvenance.contemporaneous, false);
  assert.equal(r.entries[1].inputs.bodyMassProvenance.measurementDate, "2026-03-03");
});

test("invalid body mass and malformed weight records fall through to the documented defaults without NaN", () => {
  fresh();
  const r = reconcileA([session(1, at(2026, 3, 4))], { weight: "abc", weightLog: [{ date: "2026-03-01", weight: "170" }, { date: 5, weight: 170 }, "x"] });
  assert.equal(r.entries[0].inputs.bodyMass, null);
  assert.equal(r.entries[0].inputs.bodyMassProvenance.source, "model_default");
  assert.ok(r.entries[0].warnings.includes("default_body_mass"));
  assert.doesNotMatch(JSON.stringify(r.entries), /NaN|Infinity/);
  assert.equal(Number.isFinite(r.entries[0].tissues.quadriceps.workload), true);
});

// ── fingerprint / reconciliation ────────────────────────────────────────

test("an unchanged source does nothing; a relevant edit rebuilds exactly that entry; metadata-only edits keep it", () => {
  fresh();
  const log = [session(1, at(2026, 3, 4)), session(2, at(2026, 3, 6))];
  const first = reconcileA(log, DEMO_PROFILE_A);
  const metadata = structuredClone(log);
  metadata[0].exercises[0].sets[0].rir = 1; metadata[0].exercises[0].sets[0].side = "left"; metadata[0].title = "Renamed"; metadata[1].completedSets = 42;
  const same = reconcileA(metadata, DEMO_PROFILE_A);
  assert.equal(same.storageState, "unchanged");
  assert.deepEqual(same.entries, first.entries);
  const edited = structuredClone(log);
  edited[0].exercises[0].sets[0].reps = 8;
  const rebuilt = reconcileA(edited, { weight: 199, weightLog: [] }, { now: NOW + 86400000 });
  assert.deepEqual(rebuilt.report, { created: 0, kept: 1, rebuilt: 1, removed: 0, undatable: 0, foreign: 0, malformed: 0, deduplicated: 0 });
  assert.equal(rebuilt.entries.length, 2);
  assert.equal(rebuilt.entries[0].sourceFingerprint, sourceFingerprint(edited[0]));
  assert.equal(rebuilt.entries[0].tissues.quadriceps.workload, 8 * (225 + 0.75 * 199), "rebuilt with the context current at rebuild time");
  assert.deepEqual(rebuilt.entries[1], first.entries[1], "the untouched sibling is byte-identical");
  assert.equal(stored().entries.length, 2);
});

test("a deleted or replaced (imported) workout does not linger in derived history", () => {
  fresh();
  const log = [session(1, at(2026, 3, 4)), session(2, at(2026, 3, 6))];
  reconcileA(log, DEMO_PROFILE_A);
  const deleted = reconcileA([log[1]], DEMO_PROFILE_A);
  assert.equal(deleted.report.removed, 1);
  assert.deepEqual(stored().entries.map(e => e.sourceId), [2]);
  const replaced = reconcileA([session(7, at(2026, 3, 4)), session(8, at(2026, 3, 5))], DEMO_PROFILE_A);
  assert.deepEqual(replaced.report, { created: 2, kept: 0, rebuilt: 0, removed: 1, undatable: 0, foreign: 0, malformed: 0, deduplicated: 0 });
  assert.deepEqual(stored().entries.map(e => e.sourceId), [7, 8]);
});

test("duplicate workout ids (possible after import) stay as two entries, matching the source's own count", () => {
  fresh();
  const dup = session(1, at(2026, 3, 4));
  const r = reconcileA([dup, structuredClone(dup)], DEMO_PROFILE_A);
  assert.equal(r.entries.length, 2);
  assert.deepEqual(r.entries.map(e => e.sourceKey.split("#")[1]), ["0", "1"]);
  const h = buildTissueLoadHistory(r.entries, { today: "2026-03-04" });
  assert.equal(h.tissues.quadriceps.today, 2 * 5 * (225 + 0.75 * 178));
  assert.equal(reconcileA([dup, structuredClone(dup)], DEMO_PROFILE_A).storageState, "unchanged");
});

test("stored duplicates of one source key are collapsed, never double-counted", () => {
  fresh();
  const r = reconcileA([session(1, at(2026, 3, 4))], DEMO_PROFILE_A);
  const env = stored();
  env.entries.push(structuredClone(env.entries[0]));
  localStorage.setItem(KEY_A, JSON.stringify(env));
  const again = reconcileA([session(1, at(2026, 3, 4))], DEMO_PROFILE_A);
  assert.equal(again.report.deduplicated, 1);
  assert.equal(again.entries.length, 1);
  assert.deepEqual(again.entries, r.entries);
  assert.equal(stored().entries.length, 1);
});

// ── history version / malformed / failed write ──────────────────────────

test("unknown envelope fields and unknown entry fields survive reconciliation byte-for-byte", () => {
  fresh();
  reconcileA([session(1, at(2026, 3, 4))], DEMO_PROFILE_A);
  const env = stored();
  env.note = "kept by a future build";
  env.entries[0].futureField = { nested: [1, 2] };
  localStorage.setItem(KEY_A, JSON.stringify(env));
  const raw = localStorage.getItem(KEY_A);
  const r = reconcileA([session(1, at(2026, 3, 4))], DEMO_PROFILE_A);
  assert.equal(r.storageState, "unchanged");
  assert.equal(localStorage.getItem(KEY_A), raw);
  const grown = reconcileA([session(1, at(2026, 3, 4)), session(2, at(2026, 3, 5))], DEMO_PROFILE_A);
  assert.equal(grown.storageState, "persisted");
  assert.equal(stored().note, "kept by a future build");
  assert.deepEqual(stored().entries[0].futureField, { nested: [1, 2] });
});

test("malformed stored history is left in place, quarantined by the profile sweep, and served from memory instead", () => {
  const stub = fresh();
  seedBundle(DEMO_BUNDLES[0]);
  stub.rawSet(KEY_A, "{not json");
  quarantineProfile(A, { workoutLog: [] });
  assert.equal(localStorage.getItem(KEY_A + CORRUPT_SUFFIX), "{not json");
  assert.equal(readTissueHistory(A).state, "malformed");
  const before = stub.snapshot();
  const r = reconcileA(DEMO_WORKOUT_LOG_A, DEMO_PROFILE_A);
  assert.equal(r.storageState, "malformed");
  assert.equal(r.persisted, false);
  assert.equal(r.entries.length, 3, "the session still gets a usable in-memory history");
  assert.deepEqual(stub.snapshot(), before, "nothing written");
  for (const bad of ["[]", "null", "42", JSON.stringify({ schemaVersion: TISSUE_HISTORY_SCHEMA_VERSION, entries: "x" })]) {
    stub.rawSet(KEY_A, bad);
    assert.equal(readTissueHistory(A).state, "malformed", bad);
    assert.equal(reconcileA(DEMO_WORKOUT_LOG_A, DEMO_PROFILE_A).persisted, false, bad);
    assert.equal(localStorage.getItem(KEY_A), bad);
  }
});

test("a future/unsupported history schema is never downgraded or rewritten; the app runs from memory", () => {
  const stub = fresh();
  const future = { schemaVersion: "tissue-history-v2", entries: [{ schemaVersion: "tissue-history-v2", sourceKey: "z", newShape: true }], extra: 1 };
  stub.rawSet(KEY_A, JSON.stringify(future));
  const raw = localStorage.getItem(KEY_A);
  const r = reconcileA([session(1, at(2026, 3, 4))], DEMO_PROFILE_A);
  assert.equal(r.storageState, "unsupported");
  assert.equal(r.persisted, false);
  assert.equal(r.entries.length, 1);
  assert.equal(localStorage.getItem(KEY_A), raw);
  assert.deepEqual(loadStoredTissueHistoryEntries(A), []);
});

test("a failed write is reported, never marked successful, and repairs itself on the next successful run", () => {
  const stub = fresh();
  stub.failWritesFor(k => k === KEY_A);
  const r = reconcileA([session(1, at(2026, 3, 4))], DEMO_PROFILE_A);
  assert.equal(r.storageState, "write_failed");
  assert.equal(r.persisted, false);
  assert.equal(r.entries.length, 1, "the in-memory history is still complete");
  assert.equal(localStorage.getItem(KEY_A), null, "no partial or marker write");
  stub.failWritesFor(k => k === KEY_A, quotaError());
  assert.equal(reconcileA([session(1, at(2026, 3, 4))], DEMO_PROFILE_A).storageState, "write_failed");
  assert.equal(localStorage.getItem(KEY_A), null);
  stub.allowWrites();
  const ok = reconcileA([session(1, at(2026, 3, 4))], DEMO_PROFILE_A);
  assert.equal(ok.storageState, "persisted");
  assert.deepEqual(stored().entries, ok.entries);
});

test("persist:false (Dev Mode, or a source that did not save) computes history in memory and writes nothing", () => {
  const stub = fresh();
  const before = stub.snapshot();
  const dev = reconcileA([session(1, at(2026, 3, 4))], DEMO_PROFILE_A, { persist: false, inMemoryReason: "dev_mode" });
  assert.equal(dev.storageState, "dev_mode");
  assert.equal(dev.entries.length, 1);
  const unsaved = reconcileA([session(1, at(2026, 3, 4))], DEMO_PROFILE_A, { persist: false, inMemoryReason: "source_not_saved" });
  assert.equal(unsaved.storageState, "source_not_saved");
  assert.deepEqual(stub.snapshot(), before);
});

test("an unreadable source workoutLog blocks reconciliation: stored history is served untouched, nothing is deleted", () => {
  const stub = fresh();
  reconcileA(DEMO_WORKOUT_LOG_A, DEMO_PROFILE_A);
  const raw = localStorage.getItem(KEY_A);
  stub.rawSet(uKey(A, "workoutLog"), "{corrupt");
  quarantineProfile(A, { workoutLog: [] });
  assert.equal(isWriteProtected(uKey(A, "workoutLog")), true);
  sv(A, "workoutLog", []);   // the app's passive write-back of its [] fallback
  const r = reconcileA([], DEMO_PROFILE_A);   // App.js is holding the [] fallback
  assert.equal(r.storageState, "source_unreadable");
  assert.equal(r.entries.length, 3);
  assert.equal(localStorage.getItem(KEY_A), raw);
  assert.equal(localStorage.getItem(uKey(A, "workoutLog")), "{corrupt");
});

// ── model series coexistence ────────────────────────────────────────────

test("entries from another model/map version are preserved verbatim and never merged into the v0.1 series", () => {
  fresh();
  reconcileA([session(1, at(2026, 3, 4))], DEMO_PROFILE_A);
  const env = stored();
  const foreign = { ...structuredClone(env.entries[0]), modelVersion: "tissue-load-v0.2", mapVersion: "exercise-tissue-map-v0.2", tissues: { quadriceps: { workload: 999999, eventCount: 1, confidence: "low" } } };
  env.entries.push(foreign);
  localStorage.setItem(KEY_A, JSON.stringify(env));
  const r = reconcileA([session(1, at(2026, 3, 4)), session(2, at(2026, 3, 5))], DEMO_PROFILE_A);
  assert.equal(r.report.foreign, 1);
  assert.equal(r.entries.length, 3);
  assert.deepEqual(r.entries[2], foreign, "foreign entry preserved byte-for-byte, after the owned series");
  const h = buildTissueLoadHistory(r.entries, { today: "2026-03-05" });
  assert.equal(h.otherSeriesEntries, 1);
  assert.equal(h.tissues.quadriceps.recent7, 2 * 5 * (225 + 0.75 * 178), "the 999999 never entered the v0.1 totals");
  // Removing its source preserves the foreign entry outside active history.
  const shrunk = reconcileA([session(2, at(2026, 3, 5))], DEMO_PROFILE_A);
  assert.equal(shrunk.report.foreign, 1);
  assert.equal(shrunk.entries.some(e => e.modelVersion === "tissue-load-v0.2"), false);
  assert.deepEqual(stored().detachedEntries, [foreign]);
  assert.doesNotMatch(readFileSync(new URL("../js/tissue/modelVersion.js", import.meta.url), "utf8"), /v0\.2/, "no production v0.2 exists");
});

test("unrecognisable entries are preserved but ignored", () => {
  fresh();
  reconcileA([session(1, at(2026, 3, 4))], DEMO_PROFILE_A);
  const env = stored();
  env.entries.push("garbage", 42, null, { schemaVersion: TISSUE_HISTORY_SCHEMA_VERSION, sourceKey: "x" });
  localStorage.setItem(KEY_A, JSON.stringify(env));
  const r = reconcileA([session(1, at(2026, 3, 4))], DEMO_PROFILE_A);
  assert.equal(r.report.malformed, 4);
  assert.equal(r.entries.length, 5);
  assert.equal(buildTissueLoadHistory(r.entries, { today: "2026-03-04" }).invalidEntries, 4);
  assert.equal(stored().entries.length, 5);
});

// ── export / import ─────────────────────────────────────────────────────

test("export carries the history, import restores it, and reconciliation on the new device keeps the frozen provenance", () => {
  fresh();
  seedBundle(DEMO_BUNDLES[0]);
  const profileThen = { weight: 178, weightLog: [{ date: "2026-03-03", weight: 178 }] };
  const before = reconcileA([session(1, at(2026, 3, 1)), session(2, at(2026, 3, 5))], profileThen);
  assert.equal(before.entries[0].inputs.bodyMassProvenance.source, "profile_weight");
  const baselineThen = buildTissueLoadHistory(before.entries, { today: "2026-03-09" });
  const snapshot = exportAll();
  assert.ok(Object.keys(snapshot.data).includes(KEY_A));

  fresh();
  assert.equal(importAll(structuredClone(snapshot)), true);
  assert.equal(localStorage.getItem(KEY_A), snapshot.data[KEY_A]);
  // A different current weight on the importing device must not rewrite the frozen legacy entry.
  const after = reconcileA([session(1, at(2026, 3, 1)), session(2, at(2026, 3, 5))], { weight: 120, weightLog: [] });
  assert.equal(after.storageState, "unchanged");
  assert.deepEqual(after.entries, before.entries);
  assert.deepEqual(buildTissueLoadHistory(after.entries, { today: "2026-03-09" }), baselineThen);
});

test("malformed imported derived history does not destroy source workouts and a future version is not downgraded", () => {
  fresh();
  const payload = exportAll();
  payload.data[uKey(A, "workoutLog")] = JSON.stringify([session(1, at(2026, 3, 4))]);
  payload.data[KEY_A] = "{broken";
  payload.data[KEY_B] = JSON.stringify({ schemaVersion: "tissue-history-v9", entries: [] });
  assert.equal(importAll(payload), true);
  const r = reconcileA([session(1, at(2026, 3, 4))], DEMO_PROFILE_A);
  assert.equal(r.storageState, "malformed");
  assert.equal(localStorage.getItem(KEY_A), "{broken");
  assert.equal(JSON.parse(localStorage.getItem(uKey(A, "workoutLog"))).length, 1);
  const rb = reconcileTissueHistory({ email: B, workoutLog: [], profile: {}, now: NOW, persist: true });
  assert.equal(rb.storageState, "unsupported");
  assert.equal(localStorage.getItem(KEY_B), JSON.stringify({ schemaVersion: "tissue-history-v9", entries: [] }));
});

// ── pure planning core ──────────────────────────────────────────────────

test("planReconciliation is pure and deterministic for the same envelope, log and profile", () => {
  const log = [session(1, at(2026, 3, 4))];
  const a = planReconciliation(null, log, DEMO_PROFILE_A, NOW);
  const b = planReconciliation(null, log, DEMO_PROFILE_A, NOW);
  assert.deepEqual(a, b);
  const c = planReconciliation(a.envelope, log, { weight: 1 }, NOW + 1);
  assert.deepEqual(c.entries, a.entries, "kept entries are not re-materialized");
  assert.equal(c.report.kept, 1);
});

// ── wiring guards ───────────────────────────────────────────────────────

test("App.js reconciles at the workoutLog persistence boundary, gates persistence on the source write, and feeds both Exercise entry points", () => {
  const app = readFileSync(new URL("../js/App.js", import.meta.url), "utf8");
  assert.match(app, /const saved = devMode \? false : sv\(email, "workoutLog", workoutLog\);/);
  assert.match(app, /persist: !devMode && saved === true/);
  assert.match(app, /setTissueHistory\(reconcileTissueHistory\(\{/);
  const entries = app.match(/<ExerciseTab[\s\S]*?\/>/g);
  assert.equal(entries.length, 2);
  entries.forEach(e => assert.match(e, /tissueHistory=\{tissueHistory\}/));
  const strip = src => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
  const tracker = strip(readFileSync(new URL("../js/components/TissueLoadTracker.js", import.meta.url), "utf8"));
  assert.doesNotMatch(tracker, /tissueHistoryStore|reconcileTissueHistory|localStorage|setItem/, "the view never writes");
  const analytics = strip(readFileSync(new URL("../js/utils/tissueLoadHistory.js", import.meta.url), "utf8"));
  assert.doesNotMatch(analytics, /localStorage|utils\/storage|tissueHistoryStore|from ["']react|Date\.now|appTime/);
});
