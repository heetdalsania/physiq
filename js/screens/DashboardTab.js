/* ─── PHYSIQ ENGINE — Dashboard Tab ──────────────────────────────────────── */

import React from "react";
import { ProgressRing } from "../components/ProgressRing.js";
import { NutrientCard } from "../components/NutrientCard.js";
import { MUSCLE_GROUPS } from "../data/constants.js";

const SUGGESTION_COLORS = { critical: "#EF4444", warning: "#FBBF24", info: "#14B8A6", muscle: "#D946EF" };
const SUGGESTION_ICONS = { critical: "pq-icon-alert", warning: "pq-icon-alert", info: "pq-icon-health", muscle: "pq-icon-muscle" };

export function DashboardTab({ intake, targets, profile, suggestions, mealLog, addWater, addCreatine, removeMeal, resetDay, onQuickNav, devMode, devDate, toggleDevMode, changeDevDate, shiftDevDate }) {
  let devDateLabel = "";
  try {
    const p = (devDate || "").split("-");
    if (p.length === 3) {
      const dd = new Date(parseInt(p[0]), parseInt(p[1]) - 1, parseInt(p[2]));
      devDateLabel = dd.toLocaleDateString([], { weekday: "long", month: "short", day: "numeric", year: "numeric" });
    }
  } catch (e) {}

  const macroData = [
    { label: "Protein", val: intake.protein, target: targets.protein, cal: intake.protein * 4, color: "var(--blue)" },
    { label: "Carbs",   val: intake.carbs,   target: targets.carbs,   cal: intake.carbs * 4,   color: "var(--yellow)" },
    { label: "Fats",    val: intake.fats,    target: targets.fats,    cal: intake.fats * 9,    color: "var(--purple)" }
  ];
  const totalMC = macroData.reduce(function(s, m) { return s + m.cal; }, 0) || 1;

  return (
    <div className="fade-in">
      <div className="flex-row" style={{ gap: 20, padding: "16px 0 20px" }}>
        <ProgressRing value={intake.calories} max={targets.calories} color="var(--orange)">
          <span className="mono" style={{ fontSize: 22, fontWeight: 700, color: "var(--text-white)" }}>{intake.calories}</span>
          <span style={{ fontSize: 10, color: "var(--text-muted)" }}>/ {targets.calories}</span>
        </ProgressRing>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 8, letterSpacing: 1.2, fontWeight: 600 }}>MACRO SPLIT</div>
          <div style={{ display: "flex", gap: 2, height: 8, borderRadius: 4, overflow: "hidden", marginBottom: 10 }}>
            {macroData.map(function(m) { return <div key={m.label} style={{ flex: m.cal / totalMC, background: m.color, transition: "flex .4s" }} />; })}
          </div>
          {macroData.map(function(m) {
            return (
              <div key={m.label} className="flex-row" style={{ gap: 6, marginBottom: 4 }}>
                <div style={{ width: 6, height: 6, borderRadius: "50%", background: m.color }} />
                <span style={{ fontSize: 12, color: "var(--text-dim)", flex: 1 }}>{m.label}</span>
                <span className="mono" style={{ fontSize: 13, fontWeight: 600, color: m.val >= m.target ? "var(--green)" : "var(--text)" }}>{m.val}g</span>
                <span style={{ fontSize: 11, color: "var(--text-faint)" }}>/{m.target}g</span>
              </div>
            );
          })}
        </div>
      </div>

      <div style={{ background: "var(--water-bg)", borderRadius: 12, padding: 14, border: "1px solid var(--water-border)", marginBottom: 16 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
          <span style={{ fontSize: 13, fontWeight: 600, color: "var(--sky)" }}>Water</span>
          <span className="mono" style={{ fontSize: 13, fontWeight: 700, color: "var(--text-bright)" }}>
            {intake.water}oz <span style={{ color: "var(--text-faint)", fontWeight: 400 }}>/ {targets.water}oz</span>
          </span>
        </div>
        <div style={{ height: 6, borderRadius: 3, background: "var(--track)", overflow: "hidden", marginBottom: 10 }}>
          <div style={{ height: "100%", borderRadius: 3, width: Math.min(intake.water / (targets.water || 1) * 100, 100) + "%", background: "linear-gradient(90deg,#0EA5E9,#38BDF8)", transition: "width .4s" }} />
        </div>
        <div style={{ display: "flex", gap: 6 }}>
          <button className="water-btn subtract" onClick={function() { addWater(-8); }}>-8oz</button>
          {[1, 8, 16].map(function(oz) {
            return <button key={oz} className="water-btn" onClick={function() { addWater(oz); }}>+{oz}oz</button>;
          })}
        </div>
      </div>

      <div style={{ background: "var(--muscle-tag-bg)", borderRadius: 12, padding: 14, border: "1px solid var(--muscle-tag-border)", marginBottom: 16 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
          <span style={{ fontSize: 13, fontWeight: 600, color: "var(--purple-light)" }}>Creatine</span>
          <span className="mono" style={{ fontSize: 13, fontWeight: 700, color: "var(--text-bright)" }}>
            {intake.creatine || 0}g <span style={{ color: "var(--text-faint)", fontWeight: 400 }}>/ {targets.creatine || 5}g</span>
          </span>
        </div>
        <div style={{ height: 6, borderRadius: 3, background: "var(--track)", overflow: "hidden", marginBottom: 10 }}>
          <div style={{ height: "100%", borderRadius: 3, width: Math.min((intake.creatine || 0) / (targets.creatine || 5) * 100, 100) + "%", background: "linear-gradient(90deg, #A855F7, #C084FC)", transition: "width .4s" }} />
        </div>
        <div style={{ display: "flex", gap: 6 }}>
          <button className="creatine-btn subtract" onClick={function() { addCreatine(-5); }}>-5g</button>
          {[2.5, 5].map(function(g) {
            return <button key={g} className="creatine-btn" onClick={function() { addCreatine(g); }}>+{g}g</button>;
          })}
        </div>
      </div>

      <div className="label">Key Nutrients</div>
      <div className="grid-2" style={{ marginBottom: 20 }}>
        {["protein", "sodium", "potassium", "sugar", "fiber", "creatine"].map(function(id) {
          return <NutrientCard key={id} id={id} value={intake[id] || 0} target={targets[id]} />;
        })}
      </div>

      <div className="label">Micronutrients</div>
      <div className="card" style={{ padding: "8px 14px", marginBottom: 20 }}>
        {["calcium", "magnesium", "iron", "zinc", "vitaminD", "b12", "omega3"].map(function(id) {
          return <NutrientCard key={id} id={id} value={intake[id] || 0} target={targets[id]} compact />;
        })}
      </div>

      {suggestions.length > 0 && (
        <React.Fragment>
          <div className="label">Smart Suggestions</div>
          <div className="flex-col gap-8" style={{ marginBottom: 20 }}>
            {suggestions.map(function(s, i) {
              return (
                <div key={i} className="suggestion" style={{ background: SUGGESTION_COLORS[s.type] + "08", border: "1px solid " + SUGGESTION_COLORS[s.type] + "22" }}>
                  <span className={"suggestion-icon pq-icon " + SUGGESTION_ICONS[s.type]} aria-hidden="true"></span>{s.text}
                </div>
              );
            })}
          </div>
        </React.Fragment>
      )}

      {profile.todayMuscles.length > 0 && (
        <React.Fragment>
          <div className="label">Today's Muscles</div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 20 }}>
            {profile.todayMuscles.map(function(id) {
              const mg = MUSCLE_GROUPS.find(function(m) { return m.id === id; });
              return (
                <div key={id} className="muscle-tag">
                  <span className={"pq-icon " + (mg && mg.iconClass ? mg.iconClass : "pq-icon-muscle")} aria-hidden="true"></span>
                  {mg ? mg.label : ""}
                </div>
              );
            })}
          </div>
        </React.Fragment>
      )}

      {mealLog.length > 0 && (
        <React.Fragment>
          <div className="label">Today's Meals</div>
          <div className="flex-col gap-6" style={{ marginBottom: 20 }}>
            {mealLog.map(function(m) {
              return (
                <div key={m.id} className="meal-row">
                  <span className="mono" style={{ fontSize: 11, color: "var(--text-muted)" }}>{m.time}</span>
                  <span style={{ flex: 1, fontSize: 13, fontWeight: 500 }}>{m.name}</span>
                  <span className="mono" style={{ fontSize: 11, color: "var(--orange)" }}>{m.calories}</span>
                  <span className="mono" style={{ fontSize: 11, color: "var(--blue)" }}>{m.protein}P</span>
                  <button className="meal-remove" onClick={function() { removeMeal(m.id); }}>{"×"}</button>
                </div>
              );
            })}
          </div>
        </React.Fragment>
      )}

      <div style={{ display: "flex", justifyContent: "center", paddingBottom: 20 }}>
        <button className="reset-btn" onClick={resetDay}>Reset Today</button>
      </div>

      <div className="label">Developer</div>
      <div className="dev-panel">
        <div className="dev-panel-row">
          <div style={{ flex: 1 }}>
            <div className="dev-panel-title">Dev Mode</div>
            <div className="dev-panel-sub">
              Override the app's "today" for testing time-based features.
            </div>
          </div>
          <button
            className={"dev-toggle-btn" + (devMode ? " on" : "")}
            onClick={toggleDevMode}
          >
            {devMode ? "ON" : "OFF"}
          </button>
        </div>

        {devMode && (
          <div className="dev-panel-controls fade-in">
            <div className="dev-current">
              <span className="dev-current-label">Current App Date</span>
              <span className="dev-current-date mono">{devDateLabel || devDate}</span>
            </div>
            <div className="dev-shift-row">
              <button className="dev-shift-btn" onClick={function() { shiftDevDate(-7); }}>-7d</button>
              <button className="dev-shift-btn" onClick={function() { shiftDevDate(-1); }}>-1d</button>
              <button className="dev-shift-btn" onClick={function() { shiftDevDate(1); }}>+1d</button>
              <button className="dev-shift-btn" onClick={function() { shiftDevDate(7); }}>+7d</button>
            </div>
            <div className="dev-pick-row">
              <label className="dev-pick-label">Pick date</label>
              <input
                type="date"
                className="dev-pick-input mono"
                value={devDate || ""}
                onChange={function(e) { if (e.target.value) changeDevDate(e.target.value); }}
              />
            </div>
            <div className="dev-panel-note">
              Logged workouts and meals will use this date until Dev Mode is turned off.
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
