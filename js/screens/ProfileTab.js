/* ─── PHYSIQ ENGINE — Profile Tab ─────────────────────────────────────────── */

import React, { useRef, useState } from "react";
import { ProjectionChart } from "../components/Charts.js";
import { WeightTrackingChart } from "../components/WeightCharts.js";
import { shareText, triggerHaptic } from "../utils/native.js";
import { exportAll, importAll, getUsageBytes } from "../utils/storage.js";
import { emitToast } from "../utils/toast.js";
import { GOALS } from "../data/constants.js";

export function ProfileTab(props) {
  const profile = props.profile, targets = props.targets, email = props.email, history = props.history;
  const up = props.up;
  const logWeight = props.logWeight;
  const editingBMR = props.editingBMR, setEditingBMR = props.setEditingBMR;
  const bmrInput = props.bmrInput, setBmrInput = props.setBmrInput;
  const editing = props.editing, setEditing = props.setEditing;
  const theme = props.theme, setTheme = props.setTheme;
  const setScreen = props.setScreen, setEmail = props.setEmail, setLoginEmail = props.setLoginEmail;

  const [weightInput, setWeightInput] = useState("");

  const weightLog = Array.isArray(profile.weightLog) ? profile.weightLog : [];

  const submitWeight = function() {
    const v = parseFloat(weightInput);
    if (!v || v <= 0 || v > 1000) return;
    if (typeof logWeight === "function") logWeight(v);
    setWeightInput("");
  };

  const shareProgress = function() {
    const goalLabel = (GOALS.find(function(g) { return g.id === profile.goal; }) || {}).label || "";
    const latest = weightLog.length > 0 ? weightLog[weightLog.length - 1].weight : null;
    const lines = [
      "PhysiQ Engine — " + (profile.name || "My progress"),
      "Mode: " + goalLabel,
      "TDEE: " + targets.tdee + " kcal · Target: " + targets.calories + " kcal",
      "Lean mass: " + targets.leanMass + " lb · Protein: " + targets.protein + "g/day"
    ];
    if (latest !== null) lines.push("Latest weight: " + latest + " lb");
    triggerHaptic("light");
    shareText("PhysiQ Engine Progress", lines.join("\n"));
  };

  const importInputRef = useRef(null);

  const handleExport = function() {
    const snapshot = exportAll();
    let blobUrl = null;
    try {
      const blob = new Blob([JSON.stringify(snapshot, null, 2)], { type: "application/json" });
      blobUrl = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = blobUrl;
      const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
      a.download = "physiq-backup-" + stamp + ".json";
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      triggerHaptic("light");
      emitToast("Exported " + Object.keys(snapshot.data).length + " entries", { type: "info" });
    } catch (e) {
      emitToast("Export failed", { type: "error" });
    } finally {
      if (blobUrl) {
        try { URL.revokeObjectURL(blobUrl); } catch (e) {}
      }
    }
  };

  const handleImport = function() {
    if (importInputRef.current) importInputRef.current.click();
  };

  const onImportFile = function(event) {
    const file = event.target.files && event.target.files[0];
    if (!file) return;
    if (!window.confirm("Import will overwrite existing data. Continue?")) {
      event.target.value = "";
      return;
    }
    const reader = new FileReader();
    reader.onload = function() {
      let json;
      try { json = JSON.parse(reader.result); }
      catch (e) {
        emitToast("Import failed — file is not valid JSON", { type: "error" });
        return;
      }
      const ok = importAll(json);
      if (ok) {
        // Reload so all components rehydrate from the new storage state.
        setTimeout(function() { window.location.reload(); }, 600);
      }
    };
    reader.onerror = function() {
      emitToast("Could not read file", { type: "error" });
    };
    reader.readAsText(file);
    event.target.value = "";
  };

  return (
    <div className="fade-in" style={{ paddingTop: 16 }}>
      <div className="account-bar">
        <div className="account-avatar">{(profile.name || email || "U")[0].toUpperCase()}</div>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 15, fontWeight: 700, color: "var(--text-bright)" }}>{profile.name || "User"}</div>
          <div style={{ fontSize: 12, color: "var(--text-muted)" }}>{email}</div>
        </div>
        <button className="logout-btn" onClick={shareProgress} title="Share your progress" style={{ marginRight: 6 }}>Share</button>
        <button className="logout-btn" onClick={function() { setScreen("login"); setEmail(""); setLoginEmail(""); }}>Log out</button>
      </div>

      <div className="label">Projections</div>
      <ProjectionChart profile={profile} targets={targets} />

      <div className="label">Weight Tracking</div>

      <WeightTrackingChart
        history={history}
        maintenance={targets ? targets.tdee : null}
        weightLog={weightLog}
        profileWeight={profile.weight}
      />

      <div className="weight-log-row">
        <input
          className="input mono"
          type="number"
          inputMode="decimal"
          placeholder="Enter today's weight (lb)"
          value={weightInput}
          onChange={function(e) { setWeightInput(e.target.value); }}
          onKeyDown={function(e) { if (e.key === "Enter") submitWeight(); }}
          style={{ flex: 1, padding: "10px 12px", fontSize: 14 }}
        />
        <button className="weight-log-btn" onClick={submitWeight}>Log Weight</button>
      </div>
      {weightLog.length > 0 && (
        <div className="weight-log-recent">
          Latest: {weightLog[weightLog.length - 1].weight} lb on {(function() {
            const d = new Date(weightLog[weightLog.length - 1].date);
            return d.toLocaleDateString([], { month: "short", day: "numeric", year: "numeric" });
          })()}
        </div>
      )}

      <div className="label">Computed Stats</div>
      <div className="card" style={{ padding: 14, marginBottom: 16 }}>
        <div className="stat-row" style={{ flexWrap: "wrap" }}>
          <span style={{ fontSize: 12, color: "var(--text-muted)", display: "flex", alignItems: "center", gap: 4 }}>
            BMR{targets.isOverridden && <span className="bmr-override-badge">(custom)</span>}
          </span>
          {editingBMR ? (
            <div className="flex-row gap-6" style={{ flexWrap: "wrap" }}>
              <input
                className="input mono" type="number"
                value={bmrInput}
                onChange={function(e) { setBmrInput(e.target.value); }}
                style={{ width: 90, padding: "4px 8px", fontSize: 13, textAlign: "right" }}
                autoFocus
                onKeyDown={function(e) {
                  if (e.key === "Enter") {
                    const v = parseInt(bmrInput);
                    if (v && v > 0 && v < 10000) up("bmrOverride", v);
                    setEditingBMR(false);
                  }
                  if (e.key === "Escape") setEditingBMR(false);
                }}
              />
              <button className="bmr-edit-btn" onClick={function() { const v = parseInt(bmrInput); if (v && v > 0 && v < 10000) up("bmrOverride", v); setEditingBMR(false); }} style={{ color: "var(--green)", borderColor: "var(--green)" }}>Save</button>
              {targets.isOverridden && <button className="bmr-edit-btn" onClick={function() { up("bmrOverride", null); setEditingBMR(false); }} style={{ color: "var(--red)", borderColor: "var(--red)" }}>Reset</button>}
              <button className="bmr-edit-btn" onClick={function() { setEditingBMR(false); }}>Cancel</button>
            </div>
          ) : (
            <div className="flex-row gap-6">
              <span className="mono" style={{ fontSize: 13, fontWeight: 600, color: "var(--text)" }}>{targets.bmr} kcal</span>
              <button className="bmr-edit-btn" onClick={function() { setBmrInput(String(targets.bmr)); setEditingBMR(true); }}>Edit</button>
            </div>
          )}
        </div>

        {targets.isOverridden && (
          <div style={{ fontSize: 11, color: "var(--text-muted)", padding: "4px 0", borderBottom: "1px solid var(--stat-border)" }}>
            Calculated: {targets.calculatedBMR} kcal (Mifflin-St Jeor)
          </div>
        )}

        {[
          { l: "TDEE",            v: targets.tdee + " kcal" },
          { l: "Target Calories", v: targets.calories + " kcal (" + (targets.surplus >= 0 ? "+" : "") + targets.surplus + ")" },
          { l: "Lean Body Mass",  v: targets.leanMass + " lbs" },
          { l: "Protein Target",  v: targets.protein + "g" },
          { l: "Water Target",    v: targets.water + " oz" }
        ].map(function(s) {
          return (
            <div key={s.l} className="stat-row">
              <span style={{ fontSize: 13, color: "var(--text-muted)", fontWeight: 500 }}>{s.l}</span>
              <span className="mono" style={{ fontSize: 14, fontWeight: 600, color: "var(--text)" }}>{s.v}</span>
            </div>
          );
        })}
      </div>

      <div className="label" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", cursor: "pointer" }} onClick={function() { setEditing(!editing); }}>
        <span>Edit Build</span>
        <span style={{ fontSize: 13, color: "var(--blue)" }}>{editing ? "▲" : "▼"}</span>
      </div>
      {editing && (
        <div className="fade-in card" style={{ padding: 16, marginBottom: 20 }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 14, marginBottom: 16 }}>
            {[
              { k: "name", l: "Name", u: "", t: "text" },
              { k: "age", l: "Age", u: "yrs" },
              { k: "weight", l: "Weight", u: "lbs" },
              { k: "height", l: "Height", u: "in" },
              { k: "bodyfat", l: "Body Fat", u: "%" },
              { k: "steps", l: "Steps", u: "/day" },
              { k: "gymDays", l: "Gym Days", u: "/wk" }
            ].map(function(f) {
              return (
                <div key={f.k} style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  <label style={{ fontSize: 11, color: "var(--text-muted)", fontWeight: 600, textTransform: "uppercase", letterSpacing: 0.6 }}>
                    {f.l}{f.u && <span style={{ color: "var(--text-faint)" }}> ({f.u})</span>}
                  </label>
                  <input
                    className="input"
                    type={f.t || "number"}
                    inputMode={f.t ? "text" : "decimal"}
                    value={profile[f.k]}
                    style={{ padding: "10px 12px", fontSize: 14 }}
                    onChange={function(e) { up(f.k, f.t ? e.target.value : parseFloat(e.target.value) || 0); }}
                  />
                </div>
              );
            })}
          </div>
          <div>
            <div style={{ fontSize: 11, color: "var(--text-muted)", fontWeight: 600, textTransform: "uppercase", letterSpacing: 0.6, marginBottom: 8 }}>Sex</div>
            <div style={{ display: "flex", gap: 10 }}>
              {[{ id: "male", label: "Male" }, { id: "female", label: "Female" }].map(function(s) {
                return <button key={s.id} className={"sex-btn" + (profile.sex === s.id ? " active" : "")} style={{ flex: 1, padding: "10px 12px" }} onClick={function() { up("sex", s.id); }}>{s.label}</button>;
              })}
            </div>
          </div>
        </div>
      )}

      <div className="label">Data</div>
      <div className="flex-row" style={{ gap: 8, marginBottom: 8 }}>
        <button className="logout-btn" onClick={handleExport} style={{ flex: 1, padding: "10px 14px", fontSize: 12 }}>Export Data</button>
        <button className="logout-btn" onClick={handleImport} style={{ flex: 1, padding: "10px 14px", fontSize: 12 }}>Import Data</button>
        <input
          ref={importInputRef}
          type="file"
          accept="application/json,.json"
          onChange={onImportFile}
          style={{ display: "none" }}
        />
      </div>
      <div style={{ fontSize: 11, color: "var(--text-faint)", marginBottom: 30 }}>
        Local storage: {Math.round(getUsageBytes() / 1024)} KB used
      </div>
    </div>
  );
}
