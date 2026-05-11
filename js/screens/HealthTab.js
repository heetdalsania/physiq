/* ─── PHYSIQ ENGINE — Health Tab ──────────────────────────────────────────── */

import React from "react";
import { GOALS, ACTIVITY_LEVELS } from "../data/constants.js";

export function HealthTab({ profile, targets, up, workoutLog }) {
  return (
    <div className="fade-in" style={{ paddingTop: 16 }}>
      <div className="label">Goal</div>
      <div className="flex-col gap-6" style={{ marginBottom: 20 }}>
        {GOALS.map(function(g) {
          return (
            <button key={g.id} className={"option-btn" + (profile.goal === g.id ? " active" : "")} onClick={function() { up("goal", g.id); }} style={{ padding: 12 }}>
              <span className={"option-icon pq-icon " + g.iconClass} aria-hidden="true"></span>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 14, fontWeight: 600, letterSpacing: 0.15 }}>{g.label}</div>
                <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 2, lineHeight: 1.3 }}>
                  <span className="mono" style={{ fontWeight: 600 }}>{g.pct > 0 ? "+" : ""}{Math.round(g.pct * 100)}%</span> calories
                  <span style={{ margin: "0 6px", opacity: 0.35 }}>{"·"}</span>
                  <span className="mono" style={{ fontWeight: 600 }}>{g.proteinGKg}g</span><span style={{ opacity: 0.6 }}>/kg</span> protein
                </div>
              </div>
            </button>
          );
        })}
      </div>

      <div className="label">Activity Level</div>
      <div className="flex-col gap-6" style={{ marginBottom: 20 }}>
        {ACTIVITY_LEVELS.map(function(a) {
          return (
            <button key={a.id} className={"option-btn" + (profile.activity === a.id ? " active" : "")} onClick={function() { up("activity", a.id); }}>
              <span style={{ fontSize: 13, fontWeight: 500, flex: 1 }}>{a.label}</span>
              <span className="mono" style={{ fontSize: 11, fontWeight: 500, color: "var(--text-muted)" }}>{a.steps} steps</span>
            </button>
          );
        })}
      </div>

      {workoutLog && workoutLog.length > 0 && (
        <React.Fragment>
          <div className="label" style={{ marginTop: 24 }}>Lifetime Stats</div>
          <div className="flex-col gap-6" style={{ marginBottom: 20 }}>
            {(function() {
              const totalW = workoutLog.length;
              let totalS = 0;
              let totalMin = 0;
              workoutLog.forEach(function(w) {
                totalS += (w.completedSets || 0);
                if (w.startedAt && w.finishedAt) {
                  totalMin += Math.round((w.finishedAt - w.startedAt) / 60000);
                }
              });
              // Rough estimation: weightlifting burns ~4-6 cals/min. Use 5.
              const calsBurned = totalMin * 5;

              return (
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                  <div className="option-btn" style={{ padding: 12, display: "flex", flexDirection: "column", gap: 4 }}>
                    <span style={{ fontSize: 11, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: 0.8, fontWeight: 600 }}>Workouts</span>
                    <span className="mono" style={{ fontSize: 20, fontWeight: 700, color: "var(--blue)" }}>{totalW}</span>
                  </div>
                  <div className="option-btn" style={{ padding: 12, display: "flex", flexDirection: "column", gap: 4 }}>
                    <span style={{ fontSize: 11, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: 0.8, fontWeight: 600 }}>Sets Completed</span>
                    <span className="mono" style={{ fontSize: 20, fontWeight: 700, color: "var(--orange)" }}>{totalS}</span>
                  </div>
                  <div className="option-btn" style={{ padding: 12, display: "flex", flexDirection: "column", gap: 4 }}>
                    <span style={{ fontSize: 11, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: 0.8, fontWeight: 600 }}>Total Minutes</span>
                    <span className="mono" style={{ fontSize: 20, fontWeight: 700, color: "var(--purple)" }}>{totalMin}</span>
                  </div>
                  <div className="option-btn" style={{ padding: 12, display: "flex", flexDirection: "column", gap: 4 }}>
                    <span style={{ fontSize: 11, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: 0.8, fontWeight: 600 }}>Cals Burned (Est.)</span>
                    <span className="mono" style={{ fontSize: 20, fontWeight: 700, color: "var(--green)" }}>{calsBurned.toLocaleString()}</span>
                  </div>
                </div>
              );
            })()}
          </div>
        </React.Fragment>
      )}
    </div>
  );
}
