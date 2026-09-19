/* A read-only view of existing workout history. Domain outputs stay unmodified. */
import React, { useEffect, useId, useMemo, useState } from "react";
import { SILHOUETTE, FRONT_REGIONS, BACK_REGIONS } from "./MuscleTracker.js";
import { buildTissueLoadView } from "../utils/tissueLoadView.js";
import { AppTime } from "../utils/appTime.js";

const format = value => value.toLocaleString(undefined, { maximumFractionDigits: 6 });
const confidenceLabel = value => value ? value[0].toUpperCase() + value.slice(1) : "Not available";

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

export function TissueLoadDetail({ tissue, workloadUnit, modelVersion, detailId = "tissue-load-detail" }) {
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
        <p className="tl-muted">Derived from completed logged sets using {modelVersion}; not measured tissue force.</p>
      </>}
    </section>
  );
}

export function TissueLoadContent({ view, side, setSide, selected, setSelected, detailId = "tissue-load-detail" }) {
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
    <TissueLoadDetail tissue={tissue} workloadUnit={view.workloadUnit} modelVersion={view.modelVersion} detailId={detailId} />
    <details className="tl-tissue-list"><summary>All modeled muscle regions</summary><div className="tl-tissues">{view.tissues.filter(t => t.physiqMuscle).map(renderTissue)}</div></details>
    <h3>Other modeled tissues</h3>
    <p className="tl-muted">Tendons have no body-map geometry. Select one to inspect its provisional workload.</p>
    <div className="tl-tissues">{view.tissues.filter(t => !t.physiqMuscle).map(renderTissue)}</div>
    <details className="tl-about"><summary>About this estimate · {view.modelVersion}</summary>
      <p>Unbounded heuristic training workload in {view.workloadUnit}, estimated from completed sets with provisional, unvalidated coefficients. It does not measure force, stress, damage, injury probability, recovery, capacity, or safety.</p>
      <p>Body-mass bands are coarse assumptions using your current profile weight, not a historical weight measurement. RIR, side, tempo and ROM do not affect this model. No personal baseline or longitudinal comparison is calculated.</p>
      <p>Confidence: Low = placeholder assumption; Medium = coarse relationship; High = reserved and unused in this version. These are categories, not accuracy probabilities.</p>
      <p>Mapping version: {view.mapVersion}. Results are computed from this profile's existing workout history and are not saved separately.</p>
    </details>
  </>;
}

export function TissueLoadTracker({ workoutLog, bodyMass }) {
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
  // A selection or an unrelated render does not rerun the history/model scan.
  const view = useMemo(() => buildTissueLoadView(workoutLog, { now: today, period, bodyMass }), [workoutLog, bodyMass, period, day]);
  return <section className="md-card tl-card" aria-label="Tissue Load">
    <h2>Tissue Load</h2>
    <p>Estimated from logged training using a provisional model. Relative display intensity is not injury risk.</p>
    <div className="tl-segment" role="group" aria-label="Tissue workload period">
      <button type="button" aria-pressed={period === "today"} onClick={() => setPeriod("today")}>Today</button>
      <button type="button" aria-pressed={period === "week"} onClick={() => setPeriod("week")}>This week</button>
    </div>
    <p className="tl-muted">{period === "today" ? today.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }) : "Monday–Sunday"} · Local calendar time</p>
    <TissueLoadContent view={view} side={side} setSide={setSide} selected={selected} setSelected={setSelected} detailId={detailId} />
  </section>;
}
