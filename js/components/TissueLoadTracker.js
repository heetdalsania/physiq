/* A read-only view of existing workout history. Domain outputs stay unmodified.
   Milestone 4: also a read-only view of the profile's reconciled TissueOS
   history (`tissueHistory` prop). Nothing here writes; reconciliation lives
   in App.js / js/utils/tissueHistoryStore.js. */
import React, { useEffect, useId, useMemo, useState } from "react";
import { SILHOUETTE, FRONT_REGIONS, BACK_REGIONS } from "./MuscleTracker.js";
import { buildTissueLoadView } from "../utils/tissueLoadView.js";
import { buildTissueLoadHistory } from "../utils/tissueLoadHistory.js";
import { indexSourceKeys, isCurrentSeriesEntry } from "../utils/tissueHistorySnapshot.js";
import { AppTime } from "../utils/appTime.js";

const format = value => Number.isFinite(value) ? value.toLocaleString(undefined, { maximumFractionDigits: 6 }) : "Not available";
const confidenceLabel = value => value ? value[0].toUpperCase() + value.slice(1) : "Not available";
const dateLabel = key => {
  const p = String(key).split("-").map(Number);
  return new Date(p[0], p[1] - 1, p[2]).toLocaleDateString(undefined, { month: "short", day: "numeric" });
};
const plural = (n, word) => n + " " + word + (n === 1 ? "" : "s");
const coverageText = w => w.coverage.modeledSets + " of " + w.coverage.completedSets + " completed sets modeled";

export function TissueBodyDiagram({ side, tissues, selected, onSelect, detailId = "tissue-load-detail" }) {
  const regions = side === "front" ? FRONT_REGIONS : BACK_REGIONS;
  return (
    <svg viewBox="0 0 200 440" className="md-svg tl-svg" role="group" aria-label={side === "front" ? "Front tissue map" : "Back tissue map"}>
      <g aria-hidden="true">{SILHOUETTE.map((d, i) => <path key={i} d={d} fill="var(--surface-hover)" stroke="var(--border)" />)}</g>
      {regions.map(region => {
        const tissue = tissues.find(t => t.physiqMuscle === region.id);
        if (!tissue) return null;
        const isSelected = selected === tissue.id;
        const fill = tissue.hasModeledContribution ? `hsl(258, 65%, ${84 - tissue.displayIntensity * 40}%)` : "#3A4254";
        return (
          <g key={region.id} className="tl-region" role="button" tabIndex={0}
            aria-label={tissue.name + (tissue.hasModeledContribution ? ", estimated workload " + format(tissue.totalWorkload) + " lb*rep" : ", no modeled workload in this period")}
            aria-pressed={isSelected} aria-controls={detailId} data-tissue={tissue.id}
            onClick={() => onSelect(tissue.id)} onKeyDown={e => {
              if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onSelect(tissue.id); }
            }}>
            {region.paths.map((d, i) => <path key={i} d={d} fill={fill}
              stroke={isSelected ? "var(--text-white)" : "#8A91A2"}
              strokeWidth={isSelected ? 2.5 : 0.7} strokeDasharray={tissue.hasModeledContribution ? undefined : "3 2"} />)}
          </g>
        );
      })}
    </svg>
  );
}

/* Milestone 4 — longitudinal detail for one tissue. Descriptive sums of the
   frozen v0.1 workload only; no thresholds, no colors, no advice. */
export function TissueLongitudinalDetail({ history, tissueId, workloadUnit, storageState }) {
  const storageNote =
    storageState === "malformed" || storageState === "unreadable" ? "Saved modeled history could not be read. The original was kept, and this view is recomputed from your workouts." :
    storageState === "unsupported" ? "Saved modeled history was written by a newer version of the app and has been left unchanged. This view is recomputed from your workouts." :
    storageState === "write_failed" ? "Modeled history could not be saved this time. It will be rebuilt automatically." :
    storageState === "source_unreadable" ? "Workout history could not be read, so previously saved modeled history is shown." : null;
  if (!history) return <><h4>Recent exposure</h4><p className="tl-muted">Modeled history is not loaded yet.</p></>;
  const t = history.tissues[tissueId];
  const w = history.windows;
  const historyNotes = <>
    {history.futureEntries > 0 && <p className="tl-muted">Future-dated workouts are kept but excluded from current exposure and logging coverage.</p>}
    {history.invalidEntries > 0 && <p className="tl-muted">Some saved history entries have invalid values and are excluded.</p>}
    {history.otherSeriesEntries > 0 && <p className="tl-muted">{plural(history.otherSeriesEntries, "history entry").replace("entrys", "entries")} from a different model version {history.otherSeriesEntries === 1 ? "is" : "are"} kept separately and not included.</p>}
  </>;
  if (history.historyState === "no_history" || !t) {
    return <>
      <h4>Recent exposure</h4>
      <p>No modeled history yet. Recent exposure begins with the first saved workout that the model covers.</p>
      {historyNotes}
      {storageNote && <p className="tl-muted">{storageNote}</p>}
    </>;
  }
  const b = t.baseline;
  const baselineRange = dateLabel(w.baseline.start) + " – " + dateLabel(w.baseline.end);
  const percentText = b.state === "available"
    ? (b.percent >= 0 ? "+" : "−") + Math.abs(b.percent).toLocaleString(undefined, { maximumFractionDigits: 0 }) + "%"
    : null;
  const directionText = b.direction === "above" ? "above recent modeled baseline"
    : b.direction === "below" ? "below recent modeled baseline"
    : b.direction === "equal" ? "equal to recent modeled baseline" : null;
  const zeroReason = b.state !== "zero_baseline" ? null
    : w.baseline.coverage.completedSets === 0 ? "No completed workouts in the baseline period (" + baselineRange + "), so no percentage is shown."
    : w.baseline.coverage.modeledSets === 0 ? "Completed sets in the baseline period (" + baselineRange + ") were not covered by the model, so no percentage is shown."
    : "No prior modeled workload for this tissue in the baseline period (" + baselineRange + "), so no percentage is shown.";
  const unmappedAnywhere = w.span.coverage.unmappedSets > 0;
  const approximate = w.span.approximateSessions;
  return <>
    <h4>Recent exposure</h4>
    <dl className="tl-stats">
      <div><dt>Last 7 days</dt><dd className="mono">{format(t.recent7)} {workloadUnit}{w.recent.state === "partial" && <small>{w.recent.observedDays} of 7 days since first log</small>}</dd></div>
      <div><dt>Last 28 days</dt><dd className="mono">{format(t.recent28)} {workloadUnit}{w.long.state === "partial" && <small>{w.long.observedDays} of 28 days since first log</small>}</dd></div>
      <div><dt>Recent baseline</dt><dd className="mono">{b.state === "insufficient_history" ? "Not yet available" : <>{format(b.value)} {workloadUnit}<small>per 7 days, {baselineRange}</small></>}</dd></div>
      <div><dt>Change vs recent baseline</dt><dd className="mono">{b.state === "available" ? <>{percentText}<small>{directionText}</small></> : "Not comparable"}</dd></div>
    </dl>
    {b.state === "available" && <p className="tl-muted">{percentText} means the last 7 days' modeled workload is {Math.abs(b.percent).toLocaleString(undefined, { maximumFractionDigits: 0 })}% {b.direction === "below" ? "below" : "above"} the mean of the four 7-day periods before them ({format(b.value)} {workloadUnit}). It is a descriptive comparison with your own logged history, not injury risk, recovery or capacity.</p>}
    {b.state === "insufficient_history" && <p className="tl-muted">Baseline needs modeled history covering the 28 days before the last 7 days ({baselineRange}). History begins {dateLabel(history.firstObservedDate)}.</p>}
    {zeroReason && <p className="tl-muted">{zeroReason}</p>}
    {(b.state === "numeric_unavailable" || t.recent7 === null || t.recent28 === null) && <p className="tl-muted">These saved values exceed the supported numeric range; the affected total or comparison is not available.</p>}
    <p className="tl-muted">Coverage: last 7 days {coverageText(w.recent)}; last 28 days {coverageText(w.long)}{w.baseline.state === "complete" && <>; baseline period {coverageText(w.baseline)}</>}.{unmappedAnywhere && <> Unmapped sets are excluded from every total above, so the comparison covers modeled exercises only.</>}</p>
    {approximate > 0 && <p className="tl-muted">Some older estimates use limited historical profile data: no dated weight measurement was available for {plural(approximate, "workout")} in these windows.</p>}
    {historyNotes}
    {storageNote && <p className="tl-muted">{storageNote}</p>}
    <p className="tl-muted">Windows are local calendar days ending today; history begins {dateLabel(history.firstObservedDate)}. Baseline is this profile's own recent modeled exposure ({history.analyticsVersion}), not tissue capacity, and it makes no training recommendation.</p>
    <p className="tl-muted">Days without entries after the first log count as zero logged workload. The app cannot distinguish unlogged training from no training; elapsed logging history does not establish complete training coverage.</p>
  </>;
}

export function TissueLoadDetail({ tissue, workloadUnit, modelVersion, detailId = "tissue-load-detail", history, storageState }) {
  return (
    <section id={detailId} className="tl-detail" aria-live="polite" aria-atomic="true" aria-label="Selected tissue detail">
      {!tissue ? <p>Select a region or tissue below for details.</p> : <>
        <h3>{tissue.name}</h3>
        {tissue.hasModeledContribution ? <>
          <p>Estimated training workload<br /><strong className="tl-value mono">{format(tissue.totalWorkload)} {workloadUnit}</strong></p>
          {tissue.totalWorkload === 0 && <p>Mapped completed sets produced zero modeled workload. This does not establish zero biological load.</p>}
          <h4>Contributing exercises</h4>
          <ul className="tl-contributors">{tissue.contributors.map(c => <li key={c.exerciseName}>
            <span>{c.exerciseName}</span><span className="mono">{format(c.workload)} {workloadUnit}</span>
          </li>)}</ul>
          <p>Model confidence: <strong>{confidenceLabel(tissue.confidence)}</strong></p>
          <p className="tl-muted">Confidence describes the model assumptions and mapping. The weakest contributing confidence is used; more sets do not increase it.</p>
        </> : <p>No modeled workload in this period. This does not establish zero biological load.</p>}
        {tissue.type === "tendon" && <p>Provisional mechanical relevance only, not an estimated tendon force or stress fraction. No suitable tendon geometry exists on this body map.</p>}
        <TissueLongitudinalDetail history={history} tissueId={tissue.id} workloadUnit={workloadUnit} storageState={storageState} />
        <p className="tl-muted">Derived from completed logged sets using {modelVersion}; not measured tissue force.</p>
      </>}
    </section>
  );
}

export function TissueLoadContent({ view, side, setSide, selected, setSelected, detailId = "tissue-load-detail", history = null, storageState = null }) {
  const tissue = view.tissues.find(t => t.id === selected);
  const periodText = view.period === "today" ? "today" : "this week";
  const renderTissue = t => <button type="button" key={t.id} aria-pressed={selected === t.id}
    aria-controls={detailId} onClick={() => setSelected(t.id)}>
    <span>{t.name}{selected === t.id ? " · Selected" : ""}</span>
    <span className="tl-muted">{t.hasModeledContribution ? format(t.totalWorkload) + " " + view.workloadUnit : "No modeled contribution"}</span>
  </button>;
  return <>
    <p className="tl-coverage"><strong>{view.modeledSets} of {view.completedSets} completed sets modeled</strong> · {view.sessionCount} saved workout{view.sessionCount === 1 ? "" : "s"}</p>
    <p className="tl-muted">Only mapped exercises are represented. Unmapped activity and gray regions do not mean zero biological load.</p>
    {view.unmappedExercises.length > 0 && <details className="tl-coverage-details"><summary>Unmapped exercises ({view.unmappedExercises.length})</summary>
      <ul>{view.unmappedExercises.map(name => <li key={name}>{name}</li>)}</ul>
    </details>}
    {view.excludedRecords > 0 && <p className="tl-muted">{view.excludedRecords} history record{view.excludedRecords === 1 ? "" : "s"} excluded: missing or invalid completion date; period unknown.</p>}
    {(view.warnings.includes("invalid_reps") || view.warnings.includes("invalid_weight")) && <p className="tl-muted">Some completed sets contain invalid reps or weight. The model substitutes zero for those fields; estimates may be incomplete.</p>}
    {view.warnings.includes("default_body_mass") && <p className="tl-muted">The model assumed its 180 lb reference body mass for affected sets; their confidence is Low.</p>}
    {view.state !== "modeled" && <div className="tl-empty" role="status">
      {view.state === "empty" ? <>No completed workouts {periodText}. Complete a workout to see estimated tissue workload.</>
        : view.state === "unmapped" ? <>Completed activity {periodText} is not yet covered by the TissueOS model. Its workload is unknown.</>
        : <>No completed sets in saved workouts {periodText}. Only sets marked complete contribute.</>}
    </div>}
    <div className="tl-segment" role="group" aria-label="Tissue map side">
      {["front", "back"].map(s => <button type="button" key={s} aria-pressed={side === s} onClick={() => setSide(s)}>{s === "front" ? "Front" : "Back"}</button>)}
    </div>
    <div className="md-stage"><TissueBodyDiagram side={side} tissues={view.tissues} selected={selected} onSelect={setSelected} detailId={detailId} /></div>
    <div className="tl-legend"><span className="tl-gradient" aria-hidden="true" /><span>Less → more relative modeled workload</span></div>
    <p className="tl-muted">Color shows relative workload distribution within the selected period, across all modeled tissues. The darkest region can come from a tiny workout. Gray/dashed: no modeled contribution.</p>
    <TissueLoadDetail tissue={tissue} workloadUnit={view.workloadUnit} modelVersion={view.modelVersion} detailId={detailId} history={history} storageState={storageState} />
    <details className="tl-tissue-list"><summary>All modeled muscle regions</summary><div className="tl-tissues">{view.tissues.filter(t => t.physiqMuscle).map(renderTissue)}</div></details>
    <h3>Other modeled tissues</h3>
    <p className="tl-muted">Tendons have no body-map geometry. Select one to inspect its provisional workload.</p>
    <div className="tl-tissues">{view.tissues.filter(t => !t.physiqMuscle).map(renderTissue)}</div>
    <details className="tl-about"><summary>About this estimate · {view.modelVersion}</summary>
      <p>Unbounded heuristic training workload in {view.workloadUnit}, estimated from completed sets with provisional, unvalidated coefficients. It does not measure force, stress, damage, injury probability, recovery, capacity, or safety.</p>
      <p>Body-mass bands are coarse assumptions. Each saved workout's body mass is frozen with its history record: the latest logged weight on or before that day, otherwise the profile weight at the time the record was made. RIR, side, tempo and ROM do not affect this model.</p>
      <p>Recent 7-day and 28-day exposure and the recent baseline are descriptive sums of the same modeled workload over local calendar days ({history ? history.analyticsVersion : "load-baseline-v0.1"}). They describe logged exposure history only, not tissue capacity, recovery, readiness or injury risk.</p>
      <p>Confidence: Low = placeholder assumption; Medium = coarse relationship; High = reserved and unused in this version. These are categories, not accuracy probabilities.</p>
      <p>Mapping version: {view.mapVersion}. Per-workout results are saved with this profile as {history ? history.historySchemaVersion : "tissue-history-v1"} and rebuilt whenever a saved workout changes.</p>
    </details>
  </>;
}

/* Map each workoutLog record (by object identity) to the body mass frozen
   in its current-series history entry. Records without an entry resolve to
   `undefined`, which the adapter treats as "use the current profile weight"
   — the pre-Milestone-4 behaviour, and only ever a transient state. */
function frozenBodyMassResolver(workoutLog, entries) {
  const byKey = Object.create(null);
  entries.forEach(e => { if (isCurrentSeriesEntry(e) && !(e.sourceKey in byKey)) byKey[e.sourceKey] = e; });
  const bySession = new Map();
  const keys = indexSourceKeys(workoutLog);
  (Array.isArray(workoutLog) ? workoutLog : []).forEach((session, i) => {
    const entry = keys[i] === null ? undefined : byKey[keys[i]];
    if (entry && entry.inputs) bySession.set(session, entry.inputs.bodyMass);
  });
  return session => bySession.has(session) ? bySession.get(session) : undefined;
}

export function TissueLoadTracker({ workoutLog, bodyMass, tissueHistory }) {
  const detailId = useId();
  const [period, setPeriod] = useState("today");
  const [side, setSide] = useState("front");
  const [selected, setSelected] = useState(null);
  const [, refreshClock] = useState(0);
  useEffect(() => {
    // Recheck the local day after midnight or returning from background.
    const refresh = () => refreshClock(n => n + 1);
    const timer = setInterval(refresh, 60000);
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refresh);
    return () => { clearInterval(timer); window.removeEventListener("focus", refresh); document.removeEventListener("visibilitychange", refresh); };
  }, []);
  const today = AppTime.now();
  const day = today.toDateString();
  const entries = tissueHistory && Array.isArray(tissueHistory.entries) ? tissueHistory.entries : null;
  const resolveBodyMass = useMemo(() => entries ? frozenBodyMassResolver(workoutLog, entries) : undefined, [workoutLog, entries]);
  // A selection or an unrelated render does not rerun the history/model scan.
  const view = useMemo(() => buildTissueLoadView(workoutLog, { now: today, period, bodyMass, resolveBodyMass }), [workoutLog, bodyMass, period, day, resolveBodyMass]);
  const history = useMemo(() => entries ? buildTissueLoadHistory(entries, { today }) : null, [entries, day]);
  return <section className="md-card tl-card" aria-label="Tissue Load">
    <h2>Tissue Load</h2>
    <p>Estimated from logged training using a provisional model. Relative display intensity is not injury risk.</p>
    <div className="tl-segment" role="group" aria-label="Tissue workload period">
      <button type="button" aria-pressed={period === "today"} onClick={() => setPeriod("today")}>Today</button>
      <button type="button" aria-pressed={period === "week"} onClick={() => setPeriod("week")}>This week</button>
    </div>
    <p className="tl-muted">{period === "today" ? today.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }) : "Monday–Sunday"} · Local calendar time</p>
    <TissueLoadContent view={view} side={side} setSide={setSide} selected={selected} setSelected={setSelected} detailId={detailId}
      history={history} storageState={tissueHistory ? tissueHistory.storageState : null} />
  </section>;
}
