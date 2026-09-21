/* TissueOS Milestone 5 - Recovery Guidance.
 *
 * Read-only presentation of versioned modeled-load history. The component
 * deliberately avoids recovery countdowns and readiness claims; scientific
 * and time-series derivation lives in tissueRecoveryGuidance.js.
 */

import React, { useEffect, useMemo, useState } from "react";
import { AppTime } from "../utils/appTime.js";
import { buildRecoveryGuidance } from "../utils/tissueRecoveryGuidance.js";

const formatWorkload = function(value) {
  return Number.isFinite(value)
    ? value.toLocaleString(undefined, { maximumFractionDigits: 0 })
    : "Not available";
};

const plural = function(value, word) {
  return value + " " + word + (value === 1 ? "" : "s");
};

function elapsedLabel(hours) {
  if (!Number.isFinite(hours)) return "Completion time unavailable";
  if (hours < 1) return "Last modeled load within 1h";
  if (hours < 24) return "Last modeled load " + Math.floor(hours) + "h ago";
  const days = Math.floor(hours / 24);
  return "Last modeled load " + days + "d ago";
}
function baselineLabel(baseline) {
  if (!baseline || baseline.state !== "available") return null;
  const magnitude = Math.abs(baseline.percent).toLocaleString(undefined, { maximumFractionDigits: 0 });
  if (baseline.direction === "equal") return "Equal to recent baseline";
  return magnitude + "% " + baseline.direction + " recent baseline";
}

function storageMessage(state) {
  if (state === "malformed" || state === "unreadable") return "Saved modeled history could not be read; this view is using the in-memory reconstruction.";
  if (state === "unsupported") return "Saved modeled history came from a newer app version; this view is using the current in-memory model.";
  if (state === "write_failed") return "The latest modeled history could not be saved and will be rebuilt automatically.";
  if (state === "source_not_saved") return "The latest workout could not be saved; this modeled history is only available in memory.";
  if (state === "source_unreadable") return "Workout history could not be read; previously saved modeled history is shown.";
  return null;
}

export function RecoveryTracker({ tissueHistory }) {
  const [, refreshClock] = useState(0);
  useEffect(function() {
    const refresh = function() { refreshClock(function(value) { return value + 1; }); };
    const timer = setInterval(refresh, 60 * 1000);
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refresh);
    return function() {
      clearInterval(timer);
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, []);

  const entries = tissueHistory && Array.isArray(tissueHistory.entries)
    ? tissueHistory.entries
    : null;
  const now = AppTime.now();
  const timeKey = Math.floor(now.getTime() / (60 * 1000));
  const localDay = now.toDateString();
  const guidance = useMemo(function() {
    return entries ? buildRecoveryGuidance(entries, { now: now }) : null;
  }, [entries, timeKey, localDay]);

  const recent = guidance
    ? guidance.muscles.filter(function(muscle) { return muscle.state === "recent_modeled_load"; })
    : [];
  const noRecent = guidance
    ? guidance.muscles.filter(function(muscle) { return muscle.state !== "recent_modeled_load"; })
    : [];
  const note = storageMessage(tissueHistory && tissueHistory.storageState);

  return (
    <section className="rec-card fade-in" aria-label="Recovery guidance">
      <div className="rec-header">
        <div>
          <div className="rec-title">Recovery Guidance</div>
          <div className="rec-sub">Recent modeled training context</div>
        </div>
        {guidance && (
          <div className="rec-counts" aria-label="Seven-day modeled-load summary">
            <span className="rec-count"><span className="rec-count-dot rec-dot-recent" />{recent.length} loaded</span>
            <span className="rec-count"><span className="rec-count-dot rec-dot-quiet" />{noRecent.length} no recent load</span>
          </div>
        )}
      </div>

      {!guidance ? (
        <div className="rec-empty" role="status">Modeled history is loading.</div>
      ) : guidance.state === "no_history" ? (
        <div className="rec-empty" role="status">No modeled tissue history yet.</div>
      ) : (
        <>
          <div className="rec-zone">
            <div className="rec-zone-label">
              <span className="rec-zone-dot rec-dot-recent" />
              Modeled load in the last 7 days
            </div>
            {recent.length === 0 ? (
              <div className="rec-empty">No modeled load appears in this seven-day window.</div>
            ) : (
              <div className="rec-load-list">
                {recent.map(function(muscle) {
                  const comparison = baselineLabel(muscle.baseline);
                  return (
                    <div key={muscle.tissueId} className="rec-load-row fade-in">
                      <div className="rec-load-main">
                        <span className="rec-pill-name">{muscle.name}</span>
                        <span className="rec-load-time">{elapsedLabel(muscle.hoursSinceLastLoad)}</span>
                      </div>
                      <div className="rec-load-meta">
                        <span>{plural(muscle.recentSessionCount, "modeled session")}</span>
                        <span className="mono">{formatWorkload(muscle.recent7)} {guidance.workloadUnit}</span>
                        {comparison && <span>{comparison}</span>}
                        <span>{muscle.modelConfidence ? muscle.modelConfidence + " model confidence" : "Model confidence unavailable"}</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          <div className="rec-zone">
            <div className="rec-zone-label">
              <span className="rec-zone-dot rec-dot-quiet" />
              No modeled load in the last 7 days
            </div>
            <div className="rec-pill-row">
              {noRecent.map(function(muscle) {
                return <span key={muscle.tissueId} className="rec-pill rec-pill-quiet">{muscle.name}</span>;
              })}
            </div>
          </div>
        </>
      )}

      {guidance && guidance.warnings.indexOf("partial_mapping") >= 0 && (
        <p className="rec-note">Some completed sets are not covered by the model and are excluded from these totals. Coverage: last 7 days {guidance.recentCoverage.modeledSets} of {guidance.recentCoverage.completedSets} sets; baseline period {guidance.baselineCoverage.modeledSets} of {guidance.baselineCoverage.completedSets} sets.</p>
      )}
      {guidance && guidance.warnings.includes("approximate_historical_context") && <p className="rec-note">Some estimates use approximate historical body mass.</p>}
      {guidance && guidance.warnings.includes("other_model_series") && <p className="rec-note">History from other model versions is excluded.</p>}
      {guidance && guidance.warnings.includes("future_entries") && <p className="rec-note">Future-dated workouts are excluded until their recorded day and completion time.</p>}
      {guidance && guidance.warnings.includes("invalid_entries") && <p className="rec-note">Invalid history entries are excluded.</p>}
      <p className="rec-note">Missing logs can mean unlogged training. No modeled load does not establish no biological load. Coefficients are provisional; sleep, soreness, illness and external activity are not assessed.</p>
      {note && <p className="rec-note">{note}</p>}
      <div className="rec-foot">
        Logged modeled workload only, not a measure of recovery, readiness, capacity or safety. {guidance ? guidance.guidanceVersion : "recovery-guidance-v0.1"}
      </div>
    </section>
  );
}
