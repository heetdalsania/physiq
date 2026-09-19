/* ─── Tests — Milestone 4 per-session history snapshot (tissue-history-v1) ─
 *
 * Pure module: fingerprint, local-date freezing, historical body-mass
 * resolution with provenance, and materialization. Every expected number
 * is either computed by hand from the documented v0.1 formula or read from
 * the engine directly (the engine itself is pinned by the golden test).
 * ───────────────────────────────────────────────────────────────────────── */

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  TISSUE_HISTORY_SCHEMA_VERSION,
  SOURCE_FINGERPRINT_VERSION,
  BODY_MASS_SOURCE_WEIGHT_LOG, BODY_MASS_SOURCE_PROFILE_WEIGHT, BODY_MASS_SOURCE_MODEL_DEFAULT,
  localDateKey, localUtcOffsetMinutes, isDateKey, diffDayKeys,
  isDatableSession, sourceKeyFor, indexSourceKeys, canonicalSourceInputs, sourceFingerprint,
  validWeightLogEntries, resolveHistoricalBodyMass,
  materializeTissueHistoryEntry, isValidHistoryEntry, isCurrentSeriesEntry, CURRENT_SERIES
} from "../js/utils/tissueHistorySnapshot.js";
import { estimateSessionTissueLoad, DEFAULT_BODY_MASS_REFERENCE } from "../js/tissue/loadEngine.js";
import { buildTissueLoadView } from "../js/utils/tissueLoadView.js";
import { DEMO_SESSION_PARTIAL, DEMO_SESSION_METADATA_B, DEMO_WORKOUT_LOG_A, DEMO_PROFILE_A } from "../js/dev/demoFixtures.js";

const at = (y, m, d, h = 12, min = 0) => new Date(y, m - 1, d, h, min).getTime();
const done = (weight = 225, reps = 5) => ({ reps, weight, done: true });
const squat = (sets = [done()]) => ({ id: 1, name: "Squat", sets });
const session = (finishedAt = at(2026, 3, 4), exercises = [squat()], id = 8002) => ({ id, title: "Legs", startedAt: finishedAt - 3600000, finishedAt, exercises });
const CTX = { ordinal: 0, weightLog: [], currentWeight: 180, materializedAt: at(2026, 3, 4, 13) };

function freezeDeep(v) { if (v && typeof v === "object") { Object.values(v).forEach(freezeDeep); Object.freeze(v); } return v; }

// ── local date freezing ─────────────────────────────────────────────────

test("localDateKey freezes the local calendar day of an instant, including midnight edges and DST days", () => {
  assert.equal(localDateKey(at(2026, 3, 4, 0, 0)), "2026-03-04");
  assert.equal(localDateKey(at(2026, 3, 5, 0, 0) - 1), "2026-03-04");
  assert.equal(localDateKey(at(2026, 3, 8, 23, 59)), "2026-03-08");   // US DST start day
  assert.equal(localDateKey(at(2026, 11, 1, 1, 30)), "2026-11-01");   // US DST end day
  assert.equal(localDateKey(at(2028, 2, 29, 9)), "2028-02-29");       // leap day
  for (const bad of [NaN, Infinity, "1772637000000", null, undefined, 9e20]) assert.equal(localDateKey(bad), null);
  assert.equal(typeof localUtcOffsetMinutes(at(2026, 3, 4)), "number");
  assert.equal(localUtcOffsetMinutes(NaN), null);
  // Never -0: it serialises as 0, so an in-memory entry would stop being
  // deep-equal to the same entry read back from disk (fails under TZ=UTC).
  assert.equal(Object.is(localUtcOffsetMinutes(at(2026, 3, 4)), -0), false);
  assert.equal(isDateKey("2026-03-04"), true);
  assert.equal(isDateKey("2026-3-4"), false);
  assert.equal(diffDayKeys("2026-02-28", "2026-03-01"), 1);
  assert.equal(diffDayKeys("2026-03-10", "2026-03-03"), -7);
  assert.equal(diffDayKeys("x", "2026-03-03"), null);
});

// ── source identity and fingerprint ─────────────────────────────────────

test("only finite, in-range finishedAt makes a record datable; startedAt is never a substitute", () => {
  assert.equal(isDatableSession(session()), true);
  for (const bad of [null, {}, { startedAt: at(2026, 3, 4) }, { finishedAt: "1772637000000" }, { finishedAt: NaN }, { finishedAt: 9e20 }]) {
    assert.equal(isDatableSession(bad), false);
  }
});

test("source keys are id@finishedAt#ordinal and duplicates get distinct ordinals in log order", () => {
  const a = session(at(2026, 3, 4), [squat()], 8002);
  const keys = indexSourceKeys([a, { ...a }, session(at(2026, 3, 5), [squat()], 8002), { finishedAt: NaN }, { ...a, id: undefined }]);
  assert.deepEqual(keys, ["8002@" + a.finishedAt + "#0", "8002@" + a.finishedAt + "#1", "8002@" + at(2026, 3, 5) + "#0", null, "null@" + a.finishedAt + "#0"]);
  assert.equal(sourceKeyFor(a, 3), "8002@" + a.finishedAt + "#3");
  assert.deepEqual(indexSourceKeys(undefined), []);
});

test("fingerprint covers exactly the v0.1 inputs: names, reps, weight, strict done, finishedAt", () => {
  const base = session();
  const fp = sourceFingerprint(base);
  assert.match(fp, new RegExp("^" + SOURCE_FINGERPRINT_VERSION + ":[0-9a-f]{16}:\\d+$"));
  assert.equal(sourceFingerprint(structuredClone(base)), fp, "deterministic");
  // relevant edits change it
  const edits = [
    s => { s.exercises[0].sets[0].reps = 6; },
    s => { s.exercises[0].sets[0].weight = 230; },
    s => { s.exercises[0].sets[0].done = false; },
    s => { s.exercises[0].name = "Front Squat"; },
    s => { s.exercises.push({ name: "Push-Up", sets: [done(0, 10)] }); },
    s => { s.finishedAt += 1; }
  ];
  edits.forEach((edit, i) => { const s = structuredClone(base); edit(s); assert.notEqual(sourceFingerprint(s), fp, "edit " + i); });
  // engine-ignored fields do not
  const decorated = structuredClone(base);
  decorated.title = "Renamed"; decorated.routineId = 77; decorated.completedSets = 99; decorated.totalSets = 99; decorated.startedAt = 1;
  decorated.exercises[0].muscle = "Legs"; decorated.exercises[0].id = 999; decorated.unknown = { deep: true };
  decorated.exercises[0].sets[0] = { ...decorated.exercises[0].sets[0], rir: 2, side: "left", tempo: { eccentricSeconds: 3 }, rom: "partial" };
  assert.equal(sourceFingerprint(decorated), fp);
  // `done` is strict, as in the engine: "true" and 1 are NOT completed
  const loose = structuredClone(base); loose.exercises[0].sets[0].done = "true";
  const off = structuredClone(base); off.exercises[0].sets[0].done = false;
  assert.equal(sourceFingerprint(loose), sourceFingerprint(off));
  assert.deepEqual(canonicalSourceInputs({ finishedAt: 5, exercises: [null, { sets: [null] }] }),
    { id: null, finishedAt: 5, exercises: [{ name: null, sets: [] }, { name: null, sets: [{ reps: null, weight: null, done: false }] }] });
  assert.equal(typeof sourceFingerprint(null), "string");
});

// ── historical body mass ────────────────────────────────────────────────

test("valid weight-log entries need a YYYY-MM-DD date and a finite positive number; malformed records are ignored", () => {
  const log = [
    { date: "2026-03-02", weight: 178 }, null, { date: "bad", weight: 170 }, { date: "2026-03-01", weight: "170" },
    { date: "2026-03-01", weight: 0 }, { date: "2026-03-01", weight: -5 }, { date: "2026-03-01", weight: NaN }, { weight: 160 },
    { date: "2026-02-23", weight: 176 }
  ];
  assert.deepEqual(validWeightLogEntries(log).map(e => [e.date, e.weight]), [["2026-02-23", 176], ["2026-03-02", 178]]);
  assert.deepEqual(validWeightLogEntries("nope"), []);
});

test("the latest measurement ON OR BEFORE the workout day wins; a later measurement is never back-applied", () => {
  const weightLog = [{ date: "2026-02-23", weight: 176 }, { date: "2026-03-02", weight: 178 }, { date: "2026-03-10", weight: 170 }];
  const r = resolveHistoricalBodyMass({ weightLog, currentWeight: 170, localDate: "2026-03-04", materializedOnDate: "2026-03-20" });
  assert.equal(r.bodyMass, 178);
  assert.deepEqual(r.provenance, { source: BODY_MASS_SOURCE_WEIGHT_LOG, measurementDate: "2026-03-02", daysBefore: 2, contemporaneous: false, approximate: false });
  // same-day measurement is contemporaneous
  assert.equal(resolveHistoricalBodyMass({ weightLog, currentWeight: 170, localDate: "2026-03-02" }).provenance.contemporaneous, true);
  // the closer-but-later 170 is not used for a workout before it
  const early = resolveHistoricalBodyMass({ weightLog, currentWeight: 170, localDate: "2026-03-09", materializedOnDate: "2026-03-20" });
  assert.equal(early.bodyMass, 178);
  // unordered logs and same-date duplicates: last-written wins for a date
  const dup = resolveHistoricalBodyMass({ weightLog: [{ date: "2026-03-02", weight: 178 }, { date: "2026-02-01", weight: 190 }, { date: "2026-03-02", weight: 177 }], localDate: "2026-03-05" });
  assert.equal(dup.bodyMass, 177);
});

test("without an earlier measurement the current profile weight is used and labelled as such", () => {
  const weightLog = [{ date: "2026-03-10", weight: 170 }];
  const legacy = resolveHistoricalBodyMass({ weightLog, currentWeight: 180, localDate: "2026-03-04", materializedOnDate: "2026-09-18" });
  assert.equal(legacy.bodyMass, 180);
  assert.deepEqual(legacy.provenance, { source: BODY_MASS_SOURCE_PROFILE_WEIGHT, measurementDate: null, daysBefore: null, contemporaneous: false, approximate: true });
  const fresh = resolveHistoricalBodyMass({ weightLog: [], currentWeight: 180, localDate: "2026-03-04", materializedOnDate: "2026-03-04" });
  assert.deepEqual(fresh.provenance, { source: BODY_MASS_SOURCE_PROFILE_WEIGHT, measurementDate: null, daysBefore: null, contemporaneous: true, approximate: false });
});

test("no usable body mass at all resolves to the engine default with explicit provenance", () => {
  for (const bad of [0, -1, NaN, "180", null, undefined, Infinity]) {
    const r = resolveHistoricalBodyMass({ weightLog: [], currentWeight: bad, localDate: "2026-03-04" });
    assert.equal(r.bodyMass, null, String(bad));
    assert.equal(r.provenance.source, BODY_MASS_SOURCE_MODEL_DEFAULT);
    assert.equal(r.provenance.approximate, true);
  }
});

// ── materialization ─────────────────────────────────────────────────────

test("a datable workout becomes one frozen entry whose numbers equal the engine's output for the frozen inputs", () => {
  const s = session();
  const entry = materializeTissueHistoryEntry(s, { ...CTX, weightLog: [{ date: "2026-03-02", weight: 178 }] });
  const engine = estimateSessionTissueLoad(s, { bodyMass: 178 });
  assert.equal(entry.schemaVersion, TISSUE_HISTORY_SCHEMA_VERSION);
  assert.equal(entry.sourceKey, "8002@" + s.finishedAt + "#0");
  assert.equal(entry.sourceId, 8002);
  assert.equal(entry.sourceFinishedAt, s.finishedAt);
  assert.equal(entry.sourceFingerprint, sourceFingerprint(s));
  assert.equal(entry.localDate, "2026-03-04");
  assert.equal(entry.modelVersion, "tissue-load-v0.1");
  assert.equal(entry.mapVersion, "exercise-tissue-map-v0.1");
  assert.equal(entry.workloadUnit, "lb*rep");
  assert.equal(entry.inputs.bodyMass, 178);
  assert.equal(entry.inputs.weightUnit, "lb");
  assert.equal(entry.inputs.bodyMassProvenance.source, BODY_MASS_SOURCE_WEIGHT_LOG);
  // 5 reps × (225 + 0.75 × 178) = 5 × 358.5 = 1792.5 lb*rep × quadriceps 1.0
  assert.equal(entry.tissues.quadriceps.workload, 1792.5);
  Object.keys(engine.tissues).forEach(id => {
    assert.deepEqual(entry.tissues[id], { workload: engine.tissues[id].totalWorkload, eventCount: engine.tissues[id].eventCount, confidence: engine.tissues[id].confidence });
  });
  assert.deepEqual(Object.keys(entry.tissues), Object.keys(engine.tissues));
  assert.deepEqual(entry.coverage, { completedSets: 1, modeledSets: 1, unmappedExercises: [] });
  assert.deepEqual(entry.warnings, []);
  assert.equal(entry.materializedAt, CTX.materializedAt);
  assert.equal(isValidHistoryEntry(entry), true);
  assert.equal(isCurrentSeriesEntry(entry), true);
  assert.deepEqual(CURRENT_SERIES, { modelVersion: "tissue-load-v0.1", mapVersion: "exercise-tissue-map-v0.1", workloadUnit: "lb*rep" });
});

test("undatable, incomplete-only, unmapped and mixed sessions materialize according to existing engine semantics", () => {
  assert.equal(materializeTissueHistoryEntry({ startedAt: at(2026, 3, 4), exercises: [squat()] }, CTX), null);
  assert.equal(materializeTissueHistoryEntry(null, CTX), null);
  const incomplete = materializeTissueHistoryEntry(session(at(2026, 3, 4), [squat([{ ...done(), done: false }])]), CTX);
  assert.deepEqual(incomplete.tissues, {});
  assert.deepEqual(incomplete.coverage, { completedSets: 0, modeledSets: 0, unmappedExercises: [] });
  const mixed = materializeTissueHistoryEntry(session(at(2026, 3, 4), [
    squat(), { name: "Treadmill Run", sets: [done(0, 1)] }, { name: "", sets: [done(0, 1)] }, { name: "Zumba", sets: [{ done: false }] }, { name: "Barbell Bench Press", sets: [done(0, 10)] }
  ]), CTX);
  assert.deepEqual(mixed.coverage, { completedSets: 4, modeledSets: 2, unmappedExercises: ["Treadmill Run", "Unnamed exercise"] });
  assert.equal(mixed.tissues.chest.workload, 0, "modeled zero is stored as a zero, with provenance");
  assert.equal(mixed.tissues.chest.eventCount, 1);
  assert.ok(mixed.warnings.includes("zero_load"));
  const defaults = materializeTissueHistoryEntry(session(), { ...CTX, currentWeight: null });
  assert.equal(defaults.inputs.bodyMass, null);
  assert.equal(defaults.inputs.bodyMassProvenance.source, BODY_MASS_SOURCE_MODEL_DEFAULT);
  assert.ok(defaults.warnings.includes("default_body_mass"));
  assert.equal(defaults.tissues.quadriceps.workload, 5 * (225 + 0.75 * DEFAULT_BODY_MASS_REFERENCE));
  assert.equal(defaults.tissues.quadriceps.confidence, "low", "engine confidence capping is untouched");
});

test("materialization is deterministic, order-independent in totals, never mutates its inputs, and needs no clock", () => {
  const s = freezeDeep(session(at(2026, 3, 4), [squat(), { name: "Romanian Deadlift", sets: [done(155, 8)] }]));
  const ctx = freezeDeep({ ordinal: 0, weightLog: [{ date: "2026-03-02", weight: 178 }], currentWeight: 180, materializedAt: at(2026, 3, 4, 13) });
  const before = JSON.stringify([s, ctx]);
  const a = materializeTissueHistoryEntry(s, ctx);
  const b = materializeTissueHistoryEntry(s, ctx);
  assert.deepEqual(a, b);
  assert.equal(JSON.stringify(a), JSON.stringify(b), "byte-identical serialisation");
  assert.deepEqual(JSON.parse(JSON.stringify(a)), a, "a stored entry round-trips deep-equal to the in-memory one");
  assert.equal(JSON.stringify([s, ctx]), before);
  const reversed = { ...s, exercises: s.exercises.slice().reverse() };
  assert.deepEqual(materializeTissueHistoryEntry(reversed, ctx).tissues, a.tissues);
  const noClock = materializeTissueHistoryEntry(s, { ...ctx, materializedAt: undefined });
  assert.equal(noClock.materializedAt, null);
  assert.equal(noClock.inputs.bodyMassProvenance.source, BODY_MASS_SOURCE_WEIGHT_LOG);
});

test("Milestone 2 metadata leaves the entry identical, and the demo fixtures freeze to their weight-log masses", () => {
  const plain = materializeTissueHistoryEntry(DEMO_SESSION_PARTIAL, { ...CTX, weightLog: DEMO_PROFILE_A.weightLog });
  const decorated = structuredClone(DEMO_SESSION_PARTIAL);
  decorated.exercises.forEach(ex => ex.sets.forEach(set => Object.assign(set, { rir: 3, side: "left", tempo: { eccentricSeconds: 4, pauseSeconds: 0 }, rom: "partial" })));
  assert.deepEqual(materializeTissueHistoryEntry(decorated, { ...CTX, weightLog: DEMO_PROFILE_A.weightLog }), plain);
  assert.equal(plain.inputs.bodyMass, 178);
  const metadataB = materializeTissueHistoryEntry(DEMO_SESSION_METADATA_B, { ...CTX, weightLog: [] });
  assert.equal(metadataB.coverage.completedSets, 8);
  assert.equal(metadataB.coverage.modeledSets, 8);
  assert.equal(metadataB.inputs.bodyMassProvenance.source, BODY_MASS_SOURCE_PROFILE_WEIGHT);
});

test("minimal snapshot: an entry is a small fraction of the full engine result it summarises", () => {
  DEMO_WORKOUT_LOG_A.forEach(s => {
    const entry = materializeTissueHistoryEntry(s, { ...CTX, weightLog: DEMO_PROFILE_A.weightLog });
    const full = JSON.stringify(estimateSessionTissueLoad(s, { bodyMass: entry.inputs.bodyMass })).length;
    const small = JSON.stringify(entry).length;
    assert.ok(small < 2000, s.title + " entry bytes " + small);
    assert.ok(small * 3 < full, s.title + ": entry " + small + " vs full " + full);
  });
});

test("the Milestone 3 adapter uses a frozen per-session body mass when given one, and its old behaviour otherwise", () => {
  const now = new Date(2026, 2, 4, 20);
  const s = session(now.getTime());
  const legacy = buildTissueLoadView([s], { now, bodyMass: 180 });
  const frozen = buildTissueLoadView([s], { now, bodyMass: 180, resolveBodyMass: x => (x === s ? 150 : undefined) });
  const unknown = buildTissueLoadView([s], { now, bodyMass: 180, resolveBodyMass: () => undefined });
  const modelDefault = buildTissueLoadView([s], { now, bodyMass: 180, resolveBodyMass: () => null });
  const q = v => v.tissues.find(t => t.id === "quadriceps");
  assert.equal(q(legacy).totalWorkload, 5 * (225 + 0.75 * 180));
  assert.equal(q(frozen).totalWorkload, 5 * (225 + 0.75 * 150));
  assert.deepEqual(unknown, legacy);
  assert.equal(q(modelDefault).totalWorkload, 5 * (225 + 0.75 * DEFAULT_BODY_MASS_REFERENCE));
  assert.ok(modelDefault.warnings.includes("default_body_mass"));
});

test("the snapshot module is pure: no React, DOM, storage, network or clock (source guard)", () => {
  const src = readFileSync(new URL("../js/utils/tissueHistorySnapshot.js", import.meta.url), "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
  assert.doesNotMatch(src, /\b(localStorage|sessionStorage|window|document|navigator|fetch|XMLHttpRequest|Date\.now|Math\.random|setTimeout)\b|from ["']react|utils\/storage|appTime/);
});
