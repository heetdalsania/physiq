/* Independent adversarial cases from the M4 review. Expected calendar totals
   below are literal hand calculations, without production date helpers. */
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { materializeTissueHistoryEntry, resolveHistoricalBodyMass, isDateKey, isValidHistoryEntry } from '../js/utils/tissueHistorySnapshot.js';
import { planReconciliation, reconcileTissueHistory } from '../js/utils/tissueHistoryStore.js';
import { buildTissueLoadHistory, compareToBaseline } from '../js/utils/tissueLoadHistory.js';
import { parseDayKey } from '../js/utils/appTime.js';
import { exportAll, importAll, _resetProtections } from '../js/utils/storage.js';
import { installLocalStorageStub, uninstallLocalStorageStub, quotaError } from './helpers/localStorageStub.js';
const email = 'review@example.com', key = `pq_${email}_tissueHistory`, sourceKey = `pq_${email}_workoutLog`;
const now = new Date(2026, 2, 31, 12).getTime();
const workout = (weight = 225, id = 1) => ({ id, finishedAt: new Date(2026, 2, 1, 12).getTime(), exercises: [{ name: 'Squat', sets: [{ done: true, reps: 5, weight }] }] });
const initial = log => planReconciliation(null, log, { weight: 180 }, now);
const reconcile = (log, extra = {}) => reconcileTissueHistory({ email, workoutLog: log, profile: { weight: 180 }, now, persist: true, ...extra });
let sequence = 0;
function entry(date, amount, changes = {}) {
  const e = materializeTissueHistoryEntry(workout(225, ++sequence), { currentWeight: 180, materializedAt: now });
  return { ...e, localDate: date, tissues: { chest: { workload: amount, eventCount: 1, confidence: 'low' } }, ...changes };
}
function deepFreeze(value) { if (value && typeof value === 'object') { Object.values(value).forEach(deepFreeze); Object.freeze(value); } return value; }
afterEach(() => { uninstallLocalStorageStub(); _resetProtections(); });

test('review: failed derived quota write never prunes this or another profile nutrition history', () => {
  const nutrition = JSON.stringify([{ day: 1 }, { day: 2 }, { day: 3 }]);
  const s = installLocalStorageStub({ [`pq_${email}_history`]: nutrition, 'pq_other@example.com_history': nutrition, [sourceKey]: JSON.stringify([workout()]) });
  const before = s.snapshot();
  s.failWritesFor(k => k === key, quotaError());
  const result = reconcile([workout()]);
  assert.equal(result.storageState, 'write_failed');
  assert.equal(result.persisted, false);
  assert.deepEqual(s.snapshot(), before);
});

for (const suffix of ['tissueHistory', 'workoutLog']) test(`review: thrown ${suffix} read cannot authorize a destructive write`, () => {
  const envelope = initial([workout()]).envelope;
  const s = installLocalStorageStub({ [key]: JSON.stringify(envelope), [sourceKey]: JSON.stringify([workout()]) });
  const before = s.snapshot(), get = s.getItem;
  s.getItem = k => { if (k === `pq_${email}_${suffix}`) throw Error('read denied'); return get(k); };
  const r = reconcile([]);
  assert.equal(r.persisted, false);
  assert.deepEqual(s.snapshot(), before);
});

for (const source of ['{}', 'null', '"wrong"', '{bad']) test(`review: malformed source ${source} preserves valid derived history`, () => {
  const s = installLocalStorageStub({ [key]: JSON.stringify(initial([workout()]).envelope), [sourceKey]: source });
  const before = s.snapshot();
  assert.equal(reconcile([]).storageState, 'source_unreadable');
  assert.deepEqual(s.snapshot(), before);
});

test('review: duplicate identities preserve frozen context when reordered, inserted or removed', () => {
  const a = workout(), b = workout(100), c = workout(50);
  const first = initial([a, b]);
  for (const log of [[b, a], [c, b, a], [b]]) {
    const result = planReconciliation(deepFreeze(first.envelope), deepFreeze(log), { weight: 120 }, now + 86400000);
    for (const old of first.entries) {
      const preserved = result.entries.find(e => e.sourceFingerprint === old.sourceFingerprint);
      if (!preserved) continue;
      assert.deepEqual({ ...preserved, sourceKey: old.sourceKey }, old);
    }
    assert.equal(new Set(result.entries.map(e => e.sourceKey)).size, result.entries.length);
  }
});

test('review: historical weight edits freeze deliberately; relevant workout edits rebuild', () => {
  const log = [workout()];
  const first = initial(log);
  const profile = { weight: 120, weightLog: [{ date: '2026-02-28', weight: 90 }] };
  const retained = planReconciliation(first.envelope, log, profile, now + 86400000);
  assert.deepEqual(retained.entries, first.entries);
  assert.equal(retained.entries[0].inputs.bodyMassProvenance.approximate, true);
  const changed = planReconciliation(first.envelope, [workout(226)], profile, now);
  assert.equal(changed.entries[0].inputs.bodyMass, 90);
  assert.equal(changed.report.rebuilt, 1);
});

test('review: metadata, extra fields, current date and unrelated profile fields do not churn snapshots', () => {
  const log = [workout()];
  const first = initial(log);
  const changed = structuredClone(log);
  Object.assign(changed[0].exercises[0].sets[0], { rir: 0, side: 'left', tempo: { eccentricSeconds: 9 }, rom: 'partial', arbitrary: 12 });
  changed[0].title = 'different';
  const result = planReconciliation(first.envelope, changed, { weight: 90, name: 'Other' }, now + 90 * 86400000);
  assert.equal(JSON.stringify(result.envelope), JSON.stringify(first.envelope));
});

test('review: deleted or edited foreign sources are detached verbatim and can return', () => {
  const first = initial([workout()]);
  const foreign = { ...first.entries[0], modelVersion: 'tissue-load-v0.2', unknown: { keep: true } };
  const env = { ...first.envelope, entries: [...first.entries, foreign] };
  for (const log of [[], [workout(226)]]) {
    const removed = planReconciliation(env, log, { weight: 120 }, now);
    assert.ok(!removed.entries.includes(foreign));
    assert.deepEqual(removed.envelope.detachedEntries, [foreign]);
    const again = planReconciliation(removed.envelope, log, { weight: 120 }, now + 1);
    assert.deepEqual(again.envelope, removed.envelope);
    const restored = planReconciliation(removed.envelope, [workout()], { weight: 120 }, now);
    assert.deepEqual(restored.entries.find(e => e.modelVersion === foreign.modelVersion), foreign);
    assert.deepEqual(restored.envelope.detachedEntries, []);
  }
});

test('review: invalid calendar weights never masquerade as historical measurements', () => {
  for (const date of ['2026-02-29', '2026-02-30', '2026-00-12', '2026-13-01', '2026-03-00', '2026-03-01abc']) {
    assert.equal(isDateKey(date), false, date);
    assert.ok(Number.isNaN(parseDayKey(date).getTime()), date);
    assert.equal(resolveHistoricalBodyMass({ localDate: '2026-03-01', weightLog: [{ date, weight: 90 }], currentWeight: 180 }).bodyMass, 180);
  }
  assert.ok(isDateKey('2028-02-29'));
  assert.ok(isDateKey('0099-01-01'));
});

test('review: weight validation, unsorted same-day ties, future weights and model default', () => {
  const weightLog = [{ date: '2026-03-02', weight: 90 }, { date: '2026-03-01', weight: 170 }, { date: '2026-02-28', weight: 160 }, { date: '2026-03-01', weight: 175 }];
  assert.equal(resolveHistoricalBodyMass({ localDate: '2026-03-01', weightLog }).bodyMass, 175);
  assert.equal(resolveHistoricalBodyMass({ localDate: '2026-02-28', weightLog }).bodyMass, 160);
  for (const weight of ['180', 0, -1, NaN, Infinity]) {
    const r = resolveHistoricalBodyMass({ localDate: '2026-03-01', weightLog: [{ date: '2026-03-01', weight }], currentWeight: weight });
    assert.equal(r.bodyMass, null);
    assert.equal(r.provenance.source, 'model_default');
  }
  assert.equal(resolveHistoricalBodyMass({ localDate: '2026-03-01', weightLog: {}, currentWeight: 80 }).bodyMass, 80, 'bare numeric pounds; no invented kg inference');
});

test('review: literal dates prove all boundaries, repeated sessions, divisor and baseline arithmetic', () => {
  const entries = [entry('2026-02-24', 10000), entry('2026-02-25', 40), entry('2026-03-03', 80), entry('2026-03-04', 120), entry('2026-03-24', 160), entry('2026-03-25', 30), entry('2026-03-31', 20), entry('2026-03-31', 10), entry('2026-04-01', 9999)];
  const result = buildTissueLoadHistory(deepFreeze(entries), { today: '2026-03-31' });
  const t = result.tissues.chest;
  assert.equal(t.today, 30);
  assert.equal(t.recent7, 60);
  assert.equal(t.recent28, 340);
  assert.deepEqual(t.baseline, { state: 'available', value: 100, delta: -40, ratio: 0.6, percent: -40, direction: 'below' });
  assert.deepEqual(buildTissueLoadHistory(entries.slice().reverse(), { today: '2026-03-31' }), result);
  assert.equal(result.windows.baseline.days, 28);
});

test('review: malformed coverage and negative/nonfinite workload never enter analytics', () => {
  for (const [completedSets, modeledSets] of [[1, 9], [-1, 0], [1, -1], [1.5, 1], [1, 0.5], [1, undefined]]) {
    const e = entry('2026-03-31', 10, { coverage: { completedSets, modeledSets } });
    assert.equal(isValidHistoryEntry(e), false);
    const r = buildTissueLoadHistory([e], { today: '2026-03-31' });
    assert.equal(r.invalidEntries, 1);
    assert.equal(r.windows.recent.coverage.unmappedSets, 0);
  }
  for (const w of [-1, NaN, Infinity]) assert.equal(isValidHistoryEntry(entry('2026-03-31', w)), false);
});

test('review: extreme finite arithmetic is unavailable on overflow, never zero or infinity', () => {
  assert.equal(compareToBaseline(1e308, { state: 'complete', workload: { chest: 4 } }, 'chest').state, 'numeric_unavailable');
  const h = buildTissueLoadHistory([entry('2026-02-25', 400), entry('2026-03-31', 1e308), entry('2026-03-31', 1e308)], { today: '2026-03-31' });
  assert.equal(h.tissues.chest.recent7, null);
  assert.equal(h.tissues.chest.baseline.state, 'numeric_unavailable');
  const large = buildTissueLoadHistory([entry('2026-02-25', 4e300), entry('2026-03-31', 1e300)], { today: '2026-03-31' });
  assert.equal(large.tissues.chest.recent7, 1e300);
  assert.equal(large.tissues.chest.baseline.percent, 0);
  for (const [recent, total, expected] of [[0,4,-100], [1,4,0], [1000000,4,99999900]]) assert.equal(compareToBaseline(recent, { state: 'complete', workload: { chest: total } }, 'chest').percent, expected);
  assert.equal(compareToBaseline(0, { state: 'complete', workload: { chest: 0 } }, 'chest').state, 'zero_baseline');
});

test('review: future-only entries cannot establish current logging coverage', () => {
  const h = buildTissueLoadHistory([entry('2027-01-01', 1)], { today: '2026-03-31' });
  assert.equal(h.firstObservedDate, null);
  assert.equal(h.historyState, 'no_history');
  assert.equal(h.futureEntries, 1);
  assert.equal(h.windows.recent.observedDays, 0);
});

test('review: long absence is zero logged work, with eligibility based only on elapsed span', () => {
  const h = buildTissueLoadHistory([entry('2026-01-01', 100)], { today: '2026-04-01' });
  assert.equal(h.windows.baseline.state, 'complete');
  assert.equal(h.tissues.chest.baseline.state, 'zero_baseline');
});

test('review: successful export/import preserves approximate context after profile and timezone change', () => {
  installLocalStorageStub({ [sourceKey]: JSON.stringify([workout()]) });
  const before = reconcile([workout()]);
  const exported = exportAll();
  assert.ok(exported.data[key]);
  installLocalStorageStub();
  assert.equal(importAll(exported), true);
  const zone = process.env.TZ;
  try {
    process.env.TZ = 'Asia/Kolkata';
    const after = reconcile([workout()], { workoutLog: JSON.parse(exported.data[sourceKey]), profile: { weight: 90 }, now: now + 86400000 });
    assert.deepEqual(after.entries, before.entries);
  } finally { if (zone === undefined) delete process.env.TZ; else process.env.TZ = zone; }
});

test('review: corrupt frozen input context is rejected rather than falling back to live body mass', () => {
  for (const inputs of [undefined, {}, { bodyMass: -1 }, { bodyMass: Infinity }]) assert.equal(isValidHistoryEntry(entry('2026-03-31', 10, { inputs })), false);
});

test('review: serialization failure and a malformed sidecar preserve original history and siblings', () => {
  const env = initial([workout()]).envelope;
  const s = installLocalStorageStub({ [key]: JSON.stringify(env), [sourceKey]: JSON.stringify([workout()]), [key + '__corrupt']: '{unreadable sidecar' });
  const before = s.snapshot();
  const stringify = JSON.stringify;
  try {
    JSON.stringify = value => { if (value && value.schemaVersion === 'tissue-history-v1') throw Error('serialization failed'); return stringify(value); };
    const r = reconcile([workout(), workout(100, 2)]);
    assert.equal(r.storageState, 'write_failed');
    assert.equal(r.persisted, false);
    assert.deepEqual(s.snapshot(), before);
  } finally { JSON.stringify = stringify; }
});

test('review: impossible history date, missing entries and unknown entry schema are preserved', () => {
  for (const envelope of [{ schemaVersion: 'tissue-history-v1' }, { schemaVersion: 'tissue-history-v2', entries: [] }, { entries: [] }]) {
    const raw = JSON.stringify(envelope);
    installLocalStorageStub({ [key]: raw });
    assert.equal(reconcile([workout()]).persisted, false);
    assert.equal(localStorage.getItem(key), raw);
  }
  const unknown = { schemaVersion: 'tissue-history-v2', opaque: [1,2,3] };
  const badDate = entry('2026-02-30', 10);
  const out = planReconciliation({ schemaVersion: 'tissue-history-v1', entries: [unknown, badDate] }, [], {}, now);
  assert.deepEqual(out.entries, [unknown, badDate]);
  assert.equal(buildTissueLoadHistory(out.entries, { today: '2026-03-31' }).invalidEntries, 2);
});

test('review: opaque dictionary keys cannot crash analytics or bypass duplicate exclusion', () => {
  const e = entry('2026-03-31', 10, { sourceKey: '__proto__', tissues: JSON.parse('{"constructor":{"workload":1},"__proto__":{"workload":1},"chest":{"workload":10}}') });
  const h = buildTissueLoadHistory(deepFreeze([e, e]), { today: '2026-03-31' });
  assert.equal(h.duplicateEntries, 1);
  assert.equal(h.tissues.chest.recent7, 10);
});
