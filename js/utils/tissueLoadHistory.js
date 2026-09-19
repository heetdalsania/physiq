/* ─── TissueOS longitudinal analytics (load-baseline-v0.1) ────────────────
 *
 * Milestone 4. Pure: no React, no DOM, no storage, no clock. Consumes
 * tissue-history-v1 entries (see tissueHistorySnapshot.js) and an explicit
 * `today` key, and answers one question per tissue:
 *
 *   how has modeled workload accumulated over recent calendar days, and how
 *   does the last 7 days compare with THIS athlete's own recent history?
 *
 * Every quantity below is a plain sum or mean of the frozen v0.1 workload
 * (lb*rep). Nothing here is a capacity, a tolerance, a recovery state, a
 * readiness score or an injury probability, and no threshold turns a
 * number into a category. See TISSUE_LOAD_HISTORY.md for the contract.
 *
 * ── Calendar semantics ───────────────────────────────────────────────────
 * Days are "YYYY-MM-DD" local-calendar keys frozen into each entry at
 * materialization. Day arithmetic is done on those keys (via Date.UTC), so
 * it is timezone- and DST-free: a 7-day window is always exactly seven
 * calendar keys, never 7×24 hours.
 *
 *   D            = today (the caller's local calendar day)
 *   recent       = [D-6 .. D]     7 days, today included
 *   long         = [D-27 .. D]    28 days, today included
 *   baseline     = [D-34 .. D-7]  the 28 days immediately BEFORE `recent`
 *
 * ── Observed history vs. unknown pre-history ─────────────────────────────
 * `firstObservedDate` is the earliest frozen day in the selected series.
 * Days after the first log without entries contribute zero LOGGED workload.
 * This is a logging assumption, not evidence of app usage or no training.
 * `complete` means the window lies within the elapsed logging span only.
 *
 * ── Baseline ─────────────────────────────────────────────────────────────
 *   baseline(t) = Σ workload[t] over the baseline period ÷ 4
 *
 * i.e. the mean workload per 7-day block over the four non-overlapping
 * blocks that precede the current 7-day window. It has the same dimension
 * as the current 7-day sum, so `recent7 / baseline` is meaningful.
 * A baseline of exactly 0 yields the `zero_baseline` state, never a ratio.
 * ───────────────────────────────────────────────────────────────────────── */

import { TISSUES } from "../tissue/tissueDefinitions.js";
import { TISSUE_HISTORY_SCHEMA_VERSION, CURRENT_SERIES, isValidHistoryEntry, isDateKey, diffDayKeys } from "./tissueHistorySnapshot.js";

export const LOAD_BASELINE_VERSION = "load-baseline-v0.1";
export const RECENT_WINDOW_DAYS = 7;
export const LONG_WINDOW_DAYS = 28;
export const BASELINE_PERIOD_DAYS = 28;
export const BASELINE_BLOCKS = BASELINE_PERIOD_DAYS / RECENT_WINDOW_DAYS;   // 4

/* Below this absolute difference two 6-decimal-rounded sums are "equal". */
const EQUAL_EPSILON = 1e-6;

function pad(n) { return n < 10 ? "0" + n : "" + n; }

/* "YYYY-MM-DD" ± n days, timezone-free. */
export function addDays(key, n) {
  if (!isDateKey(key)) return null;
  const p = key.split("-").map(Number);
  const d = new Date(0);
  d.setUTCFullYear(p[0], p[1] - 1, p[2] + n);
  return d.getUTCFullYear() + "-" + pad(d.getUTCMonth() + 1) + "-" + pad(d.getUTCDate());
}

/* Local calendar key of a Date, in the zone this code runs in. The caller
   (React) passes AppTime.now(); tests pass fixed dates. */
export function dayKeyOf(date) {
  if (!(date instanceof Date) || !Number.isFinite(date.getTime())) throw new Error("A valid current date is required");
  return date.getFullYear() + "-" + pad(date.getMonth() + 1) + "-" + pad(date.getDate());
}

/* Canonical (sorted) summation, the same precision rule the engine and the
   Milestone 3 adapter use, so a total never depends on entry order. */
function sum(values) {
  if (values.some(v => v === null)) return null;
  const sorted = values.slice().sort(function (a, b) { return a - b; });
  let t = 0;
  for (let i = 0; i < sorted.length; i++) t += sorted[i];
  return round(t);
}

// Preserve large finite quantities without overflowing the rounding step.
// Actual overflow is unavailable, never silently converted to zero.
function round(n) {
  if (!Number.isFinite(n)) return null;
  return Math.abs(n) <= Number.MAX_VALUE / 1e6 ? Math.round(n * 1e6) / 1e6 : n;
}
const workloadValue = n => n === undefined ? 0 : n;

function finite(n) { return typeof n === "number" && Number.isFinite(n) ? n : 0; }

/* Splits entries into the series being analysed and everything else.
   Entries from another model/map version are COUNTED, never summed. */
export function selectSeries(entries, series) {
  const s = series || CURRENT_SERIES;
  const selected = [], other = [], invalid = [];
  const seen = Object.create(null);
  let duplicates = 0;
  (Array.isArray(entries) ? entries : []).forEach(function (e) {
    if (!isValidHistoryEntry(e)) { invalid.push(e); return; }
    if (e.modelVersion === s.modelVersion && e.mapVersion === s.mapVersion && e.workloadUnit === s.workloadUnit) {
      // Defensive: one entry per source record, whatever the store handed us.
      if (Object.prototype.hasOwnProperty.call(seen, e.sourceKey)) { duplicates++; return; }
      seen[e.sourceKey] = true;
      selected.push(e);
    } else other.push(e);
  });
  return { entries: selected, otherSeriesEntries: other.length, invalidEntries: invalid.length, duplicateEntries: duplicates };
}

/* Per-day aggregation of a series. Returns { [date]: day } where
 *   day = { date, sessionCount, completedSets, modeledSets, approximateSessions,
 *           workload: { [tissueId]: number } }
 * Only days with at least one entry appear; absent days are decided by the
 * window logic (zero if observed, unknown if not). */
export function aggregateDaily(entries) {
  const byDay = {};
  entries.forEach(function (e) {
    const day = byDay[e.localDate] || (byDay[e.localDate] = {
      date: e.localDate, sessionCount: 0, completedSets: 0, modeledSets: 0, approximateSessions: 0, _loads: Object.create(null)
    });
    day.sessionCount++;
    day.completedSets += finite(e.coverage.completedSets);
    day.modeledSets += finite(e.coverage.modeledSets);
    const prov = e.inputs && e.inputs.bodyMassProvenance;
    if (prov && prov.approximate === true) day.approximateSessions++;
    Object.keys(e.tissues || {}).forEach(function (id) {
      const t = e.tissues[id];
      const w = t && typeof t === "object" ? finite(t.workload) : 0;
      (day._loads[id] || (day._loads[id] = [])).push(w);
    });
  });
  Object.keys(byDay).forEach(function (date) {
    const day = byDay[date];
    day.workload = {};
    Object.keys(day._loads).sort().forEach(function (id) { day.workload[id] = sum(day._loads[id]); });
    delete day._loads;
  });
  return byDay;
}

/* Every key from start to end inclusive. */
export function dayRange(start, end) {
  const out = [];
  const n = diffDayKeys(start, end);
  if (n === null || n < 0) return out;
  for (let i = 0; i <= n; i++) out.push(addDays(start, i));
  return out;
}

/* Window summary over [start, end]. `firstObserved` null means no history. */
function summarizeWindow(byDay, start, end, firstObserved, expectedDays) {
  const days = dayRange(start, end);
  let observedDays = 0, sessionCount = 0, completedSets = 0, modeledSets = 0, approximateSessions = 0;
  const loads = Object.create(null);
  days.forEach(function (date) {
    if (firstObserved !== null && date >= firstObserved) observedDays++;
    const day = byDay[date];
    if (!day) return;
    sessionCount += day.sessionCount;
    completedSets += day.completedSets;
    modeledSets += day.modeledSets;
    approximateSessions += day.approximateSessions;
    Object.keys(day.workload).forEach(function (id) { (loads[id] || (loads[id] = [])).push(day.workload[id]); });
  });
  const workload = {};
  Object.keys(loads).sort().forEach(function (id) { workload[id] = sum(loads[id]); });
  return {
    start: start, end: end, days: expectedDays,
    observedDays: observedDays,
    unobservedDays: expectedDays - observedDays,
    state: firstObserved === null ? "none" : observedDays === expectedDays ? "complete" : observedDays === 0 ? "none" : "partial",
    coverage: {
      sessionCount: sessionCount,
      completedSets: completedSets,
      modeledSets: modeledSets,
      unmappedSets: completedSets - modeledSets
    },
    approximateSessions: approximateSessions,
    workload: workload
  };
}

/* Baseline comparison for one tissue. Deterministic, NaN/Infinity-free:
 *   insufficient_history  the baseline period is not fully observed
 *   zero_baseline         the period is observed but its modeled workload is 0
 *   available             value/delta/ratio/percent are all finite
 * `direction` is a literal arithmetic descriptor of delta, nothing more. */
export function compareToBaseline(recent7, baselineWindow, tissueId) {
  if (!baselineWindow || baselineWindow.state !== "complete") {
    return { state: "insufficient_history", value: null, delta: null, ratio: null, percent: null, direction: null };
  }
  const unavailable = { state: "numeric_unavailable", value: null, delta: null, ratio: null, percent: null, direction: null };
  const total = workloadValue(baselineWindow.workload[tissueId]);
  if (!Number.isFinite(total) || total < 0 || !Number.isFinite(recent7) || recent7 < 0) return unavailable;
  const value = round(total / BASELINE_BLOCKS);
  if (value <= 0) {
    return { state: "zero_baseline", value: 0, delta: null, ratio: null, percent: null, direction: null };
  }
  const delta = round(recent7 - value);
  const ratio = round(recent7 / value);
  const percent = round((delta / value) * 100);
  if (delta === null || ratio === null || percent === null) return unavailable;
  return {
    state: "available",
    value: value,
    delta: delta,
    ratio: ratio,
    percent: percent,
    direction: Math.abs(delta) < EQUAL_EPSILON ? "equal" : delta > 0 ? "above" : "below"
  };
}

/**
 * buildTissueLoadHistory(entries, { today, series? })
 *
 *   entries  tissue-history-v1 entries for ONE profile (any series mix)
 *   today    a Date (local "now") or a "YYYY-MM-DD" key
 *   series   { modelVersion, mapVersion, workloadUnit }; defaults to this build's engine
 *
 * Returns
 * {
 *   analyticsVersion, historySchemaVersion, modelVersion, mapVersion, workloadUnit,
 *   today, firstObservedDate, historyState: "no_history" | "history",
 *   entryCount, otherSeriesEntries, invalidEntries,
 *   windows: { recent, long, baseline, span },    // see summarizeWindow; span = D-34..D union
 *   tissues: { [tissueId]: {
 *     tissueId, today, recent7, recent28, baseline: compareToBaseline(...)
 *   } },
 *   warnings: [ "approximate_historical_context" | "other_model_series" | "invalid_entries" ]
 * }
 */
export function buildTissueLoadHistory(entries, options) {
  const opts = options || {};
  const today = opts.today instanceof Date ? dayKeyOf(opts.today) : opts.today;
  if (!isDateKey(today)) throw new Error("A valid current date is required");
  const series = opts.series || CURRENT_SERIES;

  const selection = selectSeries(entries, series);
  const currentEntries = selection.entries.filter(e => e.localDate <= today);
  const futureEntries = selection.entries.length - currentEntries.length;
  const byDay = aggregateDaily(currentEntries);
  const dates = Object.keys(byDay).sort();
  const firstObserved = dates.length ? dates[0] : null;

  const recent = summarizeWindow(byDay, addDays(today, -(RECENT_WINDOW_DAYS - 1)), today, firstObserved, RECENT_WINDOW_DAYS);
  const long = summarizeWindow(byDay, addDays(today, -(LONG_WINDOW_DAYS - 1)), today, firstObserved, LONG_WINDOW_DAYS);
  const baseline = summarizeWindow(byDay, addDays(today, -(RECENT_WINDOW_DAYS + BASELINE_PERIOD_DAYS - 1)), addDays(today, -RECENT_WINDOW_DAYS), firstObserved, BASELINE_PERIOD_DAYS);
  /* The union of every window above (D-34..D), summarised once so counts
     that span overlapping windows — approximate-context sessions, unmapped
     sets — are never double-counted by a consumer. */
  const span = summarizeWindow(byDay, baseline.start, today, firstObserved, RECENT_WINDOW_DAYS + BASELINE_PERIOD_DAYS);

  const tissues = {};
  TISSUES.forEach(function (def) {
    const id = def.id;
    const recent7 = workloadValue(recent.workload[id]);
    tissues[id] = {
      tissueId: id,
      today: byDay[today] ? workloadValue(byDay[today].workload[id]) : 0,
      recent7: recent7,
      recent28: workloadValue(long.workload[id]),
      baseline: compareToBaseline(recent7, baseline, id)
    };
  });

  const warnings = [];
  if (span.approximateSessions > 0) warnings.push("approximate_historical_context");
  if (selection.otherSeriesEntries > 0) warnings.push("other_model_series");
  if (selection.invalidEntries > 0) warnings.push("invalid_entries");
  if (futureEntries > 0) warnings.push("future_entries");

  return {
    analyticsVersion: LOAD_BASELINE_VERSION,
    historySchemaVersion: TISSUE_HISTORY_SCHEMA_VERSION,
    modelVersion: series.modelVersion,
    mapVersion: series.mapVersion,
    workloadUnit: series.workloadUnit,
    today: today,
    firstObservedDate: firstObserved,
    historyState: firstObserved === null ? "no_history" : "history",
    entryCount: selection.entries.length,
    futureEntries: futureEntries,
    otherSeriesEntries: selection.otherSeriesEntries,
    invalidEntries: selection.invalidEntries,
    duplicateEntries: selection.duplicateEntries,
    windows: { recent: recent, long: long, baseline: baseline, span: span },
    tissues: tissues,
    warnings: warnings
  };
}
