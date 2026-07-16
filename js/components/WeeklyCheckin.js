/* ─── PHYSIQ ENGINE — Weekly Check-in ─────────────────────────────────────
 *
 * Once-a-week prompt shown when a new week starts: confirm current weight
 * and goal so calorie/macro targets (and everything built on them — the
 * weekly report, the day planner, projections) stay accurate. Skippable;
 * either way it won't re-appear until the next week rolls over.
 * ───────────────────────────────────────────────────────────────────────── */

import React, { useState } from "react";
import { GOALS } from "../data/constants.js";

export function WeeklyCheckin({ profile, onSave, onSkip, suggestion, onApplyAdjustment, onDismissAdjustment }) {
  const [weight, setWeight] = useState(String(profile.weight || ""));
  const [goal, setGoal] = useState(profile.goal);

  const save = function() {
    const w = parseFloat(weight);
    onSave(w > 0 ? w : null, goal);
  };

  // Step 2 — coaching. Shown after save when the weight trend earned an
  // adjustment offer; the check-in is the moment the app coaches, not
  // just collects.
  if (suggestion) {
    return (
      <div className="checkin-backdrop">
        <div className="checkin-card fade-in">
          <div className="label" style={{ marginBottom: 4 }}>Coaching</div>
          <div style={{ fontSize: 18, fontWeight: 700, color: "var(--text-white)", marginBottom: 6 }}>
            {suggestion.reason}
          </div>
          <div style={{ fontSize: 13, color: "var(--text-suggestion)", lineHeight: 1.5, marginBottom: 18 }}>
            {suggestion.text}
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <button className="checkin-skip-btn" onClick={onDismissAdjustment}>Not now</button>
            {suggestion.type === "adjust" ? (
              <button className="checkin-save-btn" onClick={function() { onApplyAdjustment(suggestion); }}>
                {(suggestion.delta > 0 ? "Add +" : "Cut ") + Math.abs(suggestion.delta) + " kcal/day"}
              </button>
            ) : (
              <button className="checkin-save-btn" onClick={onDismissAdjustment}>Got it</button>
            )}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="checkin-backdrop">
      <div className="checkin-card fade-in">
        <div className="label" style={{ marginBottom: 4 }}>Weekly check-in</div>
        <div style={{ fontSize: 18, fontWeight: 700, color: "var(--text-white)", marginBottom: 4 }}>
          New week — quick update?
        </div>
        <div style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 14, lineHeight: 1.5 }}>
          Your targets are calculated from these. 10 seconds keeps everything accurate.
        </div>

        <div className="label" style={{ marginBottom: 6 }}>Current weight (lb)</div>
        <input
          type="number"
          className="input mono"
          style={{ width: "100%", marginBottom: 14 }}
          min="0"
          value={weight}
          onChange={function(e) { setWeight(e.target.value); }}
        />

        <div className="label" style={{ marginBottom: 6 }}>Goal</div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 18 }}>
          {GOALS.map(function(g) {
            return (
              <button
                key={g.id}
                className={"checkin-goal-pill" + (goal === g.id ? " active" : "")}
                onClick={function() { setGoal(g.id); }}
              >
                {g.label}
              </button>
            );
          })}
        </div>

        <div style={{ display: "flex", gap: 8 }}>
          <button className="checkin-skip-btn" onClick={onSkip}>Skip</button>
          <button className="checkin-save-btn" onClick={save}>Save</button>
        </div>
      </div>
    </div>
  );
}
