/* TissueOS Milestone 5: descriptive recovery guidance.
 *
 * This module replaces fixed per-muscle recovery timers with facts derived
 * from the versioned Milestone 4 history. It is deliberately not a recovery,
 * readiness, capacity or safety model. It has no thresholds and gives no
 * training prescription.
 *
 * Pure: no React, storage, network or implicit clock. Callers provide `now`.
 */

import { TISSUES } from "../tissue/tissueDefinitions.js";
import {
  addDays,
  buildTissueLoadHistory,
  dayKeyOf,
  selectSeries
} from "./tissueLoadHistory.js";

export const RECOVERY_GUIDANCE_VERSION = "recovery-guidance-v0.1";

const MUSCLE_TISSUES = Object.freeze(TISSUES.filter(function(tissue) {
  return tissue.type === "muscle" && tissue.physiqMuscle;
}));

const CONFIDENCE_RANK = Object.freeze({ low: 0, medium: 1, high: 2 });

function workloadFor(entry, tissueId) {
  const tissue = entry && entry.tissues && entry.tissues[tissueId];
  return tissue && Number.isFinite(tissue.workload) && tissue.workload >= 0
    ? tissue.workload
    : 0;
}

function eventTime(entry, nowMs) {
  const value = entry && entry.sourceFinishedAt;
  return Number.isFinite(value) && value > 0 && value <= nowMs ? value : null;
}

function weakestConfidence(entries, tissueId) {
  let weakest = null;
  let unknown = false;
  entries.forEach(function(entry) {
    const value = entry && entry.tissues && entry.tissues[tissueId] && entry.tissues[tissueId].confidence;
    if (!Object.prototype.hasOwnProperty.call(CONFIDENCE_RANK, value)) { unknown = true; return; }
    if (weakest === null || CONFIDENCE_RANK[value] < CONFIDENCE_RANK[weakest]) weakest = value;
  });
  return unknown ? null : weakest;
}

function latestLoadedEntry(entries, tissueId, nowMs) {
  // An undated contribution could be newer than any dated one.
  if (entries.some(entry => eventTime(entry, nowMs) === null)) return { entry: null, time: null };
  let latest = null;
  let latestTime = null;
  entries.forEach(function(entry) {
    if (workloadFor(entry, tissueId) <= 0) return;
    const time = eventTime(entry, nowMs);
    if (time !== null && (latestTime === null || time > latestTime ||
        (time === latestTime && entry.sourceKey < latest.sourceKey))) {
      latest = entry;
      latestTime = time;
    }
  });
  return { entry: latest, time: latestTime };
}

/**
 * buildRecoveryGuidance(entries, { now, series? })
 *
 * Returns descriptive, profile-local context for the ten modeled muscle
 * regions. `state` only describes whether modeled load appears in the
 * selected seven-day calendar window; it is not a biological status.
 */
export function buildRecoveryGuidance(entries, options) {
  const opts = options || {};
  const now = opts.now instanceof Date ? new Date(opts.now.getTime()) : null;
  if (!now || !Number.isFinite(now.getTime())) throw new Error("A valid current date is required");

  const nowMs = now.getTime();
  const today = dayKeyOf(now);
  const recentStart = addDays(today, -6);
  const selection = selectSeries(entries, opts.series);
  // M4 groups by calendar day; this view also reports elapsed time, so a
  // known future completion instant must be excluded even within today.
  const futureInstants = new Set(selection.entries.filter(entry => Number.isFinite(entry.sourceFinishedAt) && entry.sourceFinishedAt > nowMs));
  const eligible = (Array.isArray(entries) ? entries : []).filter(entry => !futureInstants.has(entry));
  const analytics = buildTissueLoadHistory(eligible, { today: today, series: opts.series });
  const currentEntries = selection.entries.filter(function(entry) {
    return entry.localDate <= today && !futureInstants.has(entry);
  });

  let missingCompletionTime = false;
  const muscles = MUSCLE_TISSUES.map(function(definition) {
    const loaded = currentEntries.filter(function(entry) {
      return workloadFor(entry, definition.id) > 0;
    });
    const recent = loaded.filter(function(entry) {
      return entry.localDate >= recentStart && entry.localDate <= today;
    });
    const latest = latestLoadedEntry(loaded, definition.id, nowMs);
    if (loaded.length > 0 && latest.time === null) missingCompletionTime = true;
    const tissueAnalytics = analytics.tissues[definition.id];
    const recent7 = tissueAnalytics ? tissueAnalytics.recent7 : 0;
    const recent28 = tissueAnalytics ? tissueAnalytics.recent28 : 0;
    const state = recent.length > 0
      ? "recent_modeled_load"
      : loaded.length > 0 ? "no_recent_modeled_load" : "no_modeled_history";

    return {
      tissueId: definition.id,
      physiqMuscle: definition.physiqMuscle,
      name: definition.name,
      state: state,
      lastLoadedAt: latest.time,
      hoursSinceLastLoad: latest.time === null ? null : Math.max(0, (nowMs - latest.time) / 3600000),
      latestSessionWorkload: latest.entry ? workloadFor(latest.entry, definition.id) : null,
      recentSessionCount: recent.length,
      recent7: recent7,
      recent28: recent28,
      baseline: tissueAnalytics ? tissueAnalytics.baseline : null,
      modelConfidence: weakestConfidence(recent.length ? recent : loaded, definition.id)
    };
  });

  muscles.sort(function(a, b) {
    if (a.state === "recent_modeled_load" && b.state !== "recent_modeled_load") return -1;
    if (a.state !== "recent_modeled_load" && b.state === "recent_modeled_load") return 1;
    if (a.recent7 === null && b.recent7 !== null) return 1;
    if (b.recent7 === null && a.recent7 !== null) return -1;
    if (a.recent7 !== b.recent7) return b.recent7 - a.recent7;
    return a.name.localeCompare(b.name);
  });

  const warnings = analytics.warnings.slice();
  if (futureInstants.size > 0) warnings.push("future_entries");
  if (analytics.windows.span.coverage.unmappedSets > 0) warnings.push("partial_mapping");
  if (missingCompletionTime) warnings.push("missing_completion_time");

  return {
    guidanceVersion: RECOVERY_GUIDANCE_VERSION,
    analyticsVersion: analytics.analyticsVersion,
    historySchemaVersion: analytics.historySchemaVersion,
    modelVersion: analytics.modelVersion,
    mapVersion: analytics.mapVersion,
    workloadUnit: analytics.workloadUnit,
    today: today,
    state: analytics.historyState === "no_history" ? "no_history" : "history",
    recentWindow: { start: recentStart, end: today, days: 7 },
    recentCoverage: analytics.windows.recent.coverage,
    baselineCoverage: analytics.windows.baseline.coverage,
    muscles: muscles,
    warnings: Array.from(new Set(warnings))
  };
}
