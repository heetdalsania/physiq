/* ─── PHYSIQ ENGINE — Profile Tab ─────────────────────────────────────────── */

window.PhysIQ = window.PhysIQ || {};
window.PhysIQ.Screens = window.PhysIQ.Screens || {};

(function(Screens, Components) {

  var ProjectionChart = Components.ProjectionChart;
  var WeightTrackingChart = Components.WeightTrackingChart;
  var useState = React.useState;

  function ProfileTab(props) {
    var profile = props.profile, targets = props.targets, email = props.email, history = props.history;
    var up = props.up;
    var logWeight = props.logWeight;
    var editingBMR = props.editingBMR, setEditingBMR = props.setEditingBMR;
    var bmrInput = props.bmrInput, setBmrInput = props.setBmrInput;
    var editing = props.editing, setEditing = props.setEditing;
    var theme = props.theme, setTheme = props.setTheme;
    var setScreen = props.setScreen, setEmail = props.setEmail, setLoginEmail = props.setLoginEmail;

    // Local input state for the inline weight logger
    var _wIn = useState("");
    var weightInput = _wIn[0], setWeightInput = _wIn[1];

    var weightLog = Array.isArray(profile.weightLog) ? profile.weightLog : [];

    var submitWeight = function() {
      var v = parseFloat(weightInput);
      if (!v || v <= 0 || v > 1000) return;
      if (typeof logWeight === "function") logWeight(v);
      setWeightInput("");
    };

    return (
      <div className="fade-in" style={{ paddingTop: 16 }}>
        {/* Account bar */}
        <div className="account-bar">
          <div className="account-avatar">{(profile.name || email || "U")[0].toUpperCase()}</div>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: "var(--text-bright)" }}>{profile.name || "User"}</div>
            <div style={{ fontSize: 11, color: "var(--text-muted)" }}>{email}</div>
          </div>
          <button className="logout-btn" onClick={function() { setScreen("login"); setEmail(""); setLoginEmail(""); }}>Log out</button>
        </div>

        {/* Projections */}
        <div className="label">Projections</div>
        <ProjectionChart profile={profile} targets={targets} />

        {/* Weight Tracking — single chart, two independently-computed lines */}
        <div className="label">Weight Tracking</div>

        <WeightTrackingChart
          history={history}
          maintenance={targets ? targets.tdee : null}
          weightLog={weightLog}
          profileWeight={profile.weight}
        />

        {/* Inline weight logger — never overwrites past entries */}
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
              var d = new Date(weightLog[weightLog.length - 1].date);
              return d.toLocaleDateString([], { month: "short", day: "numeric", year: "numeric" });
            })()}
          </div>
        )}

        {/* Computed Stats */}
        <div className="label">Computed Stats</div>
        <div className="card" style={{ padding: 14, marginBottom: 16 }}>
          {/* BMR row with inline edit */}
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
                      var v = parseInt(bmrInput);
                      if (v && v > 0 && v < 10000) up("bmrOverride", v);
                      setEditingBMR(false);
                    }
                    if (e.key === "Escape") setEditingBMR(false);
                  }}
                />
                <button className="bmr-edit-btn" onClick={function() { var v = parseInt(bmrInput); if (v && v > 0 && v < 10000) up("bmrOverride", v); setEditingBMR(false); }} style={{ color: "var(--green)", borderColor: "var(--green)" }}>Save</button>
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
            <div style={{ fontSize: 10, color: "var(--text-faint)", padding: "4px 0", borderBottom: "1px solid var(--stat-border)" }}>
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
                <span style={{ fontSize: 12, color: "var(--text-muted)" }}>{s.l}</span>
                <span className="mono" style={{ fontSize: 13, fontWeight: 600, color: "var(--text)" }}>{s.v}</span>
              </div>
            );
          })}
        </div>

        {/* Edit Build (collapsible) */}
        <div className="label" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", cursor: "pointer" }} onClick={function() { setEditing(!editing); }}>
          <span>Edit Build</span>
          <span style={{ fontSize: 13, color: "var(--blue)" }}>{editing ? "\u25B2" : "\u25BC"}</span>
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

        {/* Appearance */}
        <div className="label">Appearance</div>
        <div className="flex-row" style={{ gap: 12, marginBottom: 30 }}>
          <span style={{ fontSize: 13, color: "var(--text-dim)", flex: 1 }}>{theme === "dark" ? "Dark Mode" : "Light Mode"}</span>
          <button className="theme-toggle" onClick={function() { setTheme(function(t) { return t === "dark" ? "light" : "dark"; }); }} />
        </div>
      </div>
    );
  }

  Screens.ProfileTab = ProfileTab;

})(window.PhysIQ.Screens, window.PhysIQ.Components);
