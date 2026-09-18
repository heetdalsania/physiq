/* Milestone 3 presentation only: no storage, clock, React, or model changes. */
import { estimateSessionTissueLoad, WORKLOAD_UNIT } from "../tissue/loadEngine.js";
import { TISSUE_LOAD_MODEL_VERSION, EXERCISE_TISSUE_MAP_VERSION } from "../tissue/modelVersion.js";
import { TISSUES } from "../tissue/tissueDefinitions.js";
import { combineConfidence } from "../tissue/uncertainty.js";
import { getWeekStart } from "./weeklyReport.js";

const compareText = (a, b) => a < b ? -1 : a > b ? 1 : 0;
// Same canonical summation precision as domain totals, only across events.
function sum(values) {
  return Math.round(values.slice().sort((a, b) => a - b).reduce((a, b) => a + b, 0) * 1e6) / 1e6;
}

export function tissuePeriodBounds(now, period = "today") {
  if (!(now instanceof Date) || !Number.isFinite(now.getTime())) throw new Error("A valid current date is required");
  if (period !== "today" && period !== "week") throw new Error("Unknown tissue period");
  const start = period === "week" ? getWeekStart(now) : new Date(now);
  start.setHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setDate(end.getDate() + (period === "week" ? 7 : 1));
  return { start: start.getTime(), end: end.getTime() };
}

export function buildTissueLoadView(workoutLog, { now, period = "today", bodyMass } = {}) {
  const bounds = tissuePeriodBounds(now, period);
  let excludedRecords = 0;
  const sessions = (Array.isArray(workoutLog) ? workoutLog : []).filter(session => {
    // workoutLog stores finished sessions. Never date an unfinished/malformed
    // record by its start time or silently coerce null/string dates to an epoch.
    const timestamp = session && session.finishedAt;
    if (!Number.isFinite(timestamp) || !Number.isFinite(new Date(timestamp).getTime())) {
      excludedRecords++;
      return false;
    }
    return timestamp >= bounds.start && timestamp < bounds.end;
  });
  const eventsByTissue = new Map();
  const unmapped = new Set();
  const warnings = new Set();
  let completedSets = 0;
  let modeledSets = 0;
  sessions.forEach(session => {
    const result = estimateSessionTissueLoad(session, { bodyMass });
    result.exercises.forEach(ex => {
      completedSets += ex.completedSets;
      if (ex.status === "mapped") modeledSets += ex.completedSets;
      else if (ex.completedSets > 0) unmapped.add(ex.exerciseName || "Unnamed exercise");
    });
    result.warnings.forEach(w => warnings.add(w));
    result.events.forEach(event => {
      const entries = eventsByTissue.get(event.tissueId) || [];
      // Canonical exercise name comes from the engine's mapping resolution;
      // numeric contributions come exclusively from its event provenance.
      entries.push({ event, exerciseName: result.exercises[event.provenance.exerciseIndex].mappedName || event.provenance.exerciseName });
      eventsByTissue.set(event.tissueId, entries);
    });
  });
  const tissues = TISSUES.map(definition => {
    const entries = eventsByTissue.get(definition.id) || [];
    const byExercise = new Map();
    entries.forEach(({ event, exerciseName }) => {
      const values = byExercise.get(exerciseName) || [];
      values.push(event.workload);
      byExercise.set(exerciseName, values);
    });
    return {
      ...definition,
      hasModeledContribution: entries.length > 0,
      totalWorkload: sum(entries.map(x => x.event.workload)),
      confidence: combineConfidence(entries.map(x => x.event.confidence)),
      contributors: Array.from(byExercise, ([exerciseName, values]) => ({ exerciseName, workload: sum(values), setCount: values.length }))
        .sort((a, b) => b.workload - a.workload || compareText(a.exerciseName, b.exerciseName))
    };
  });
  const maximum = Math.max(0, ...tissues.map(t => t.totalWorkload));
  return {
    period, ...bounds, sessionCount: sessions.length, excludedRecords,
    completedSets, modeledSets, unmappedExercises: Array.from(unmapped).sort(compareText),
    warnings: Array.from(warnings).sort(compareText),
    state: sessions.length === 0 ? "empty" : completedSets === 0 ? "no-completed-sets" : modeledSets === 0 ? "unmapped" : "modeled",
    modelVersion: TISSUE_LOAD_MODEL_VERSION, mapVersion: EXERCISE_TISSUE_MAP_VERSION,
    workloadUnit: WORKLOAD_UNIT,
    tissues: tissues.map(t => ({ ...t, displayIntensity: maximum > 0 ? t.totalWorkload / maximum : 0 }))
  };
}
