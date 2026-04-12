/* ─── PHYSIQ ENGINE — Profile Tab ─────────────────────────────────────────── */

window.PhysIQ = window.PhysIQ || {};
window.PhysIQ.Screens = window.PhysIQ.Screens || {};

(function(Screens, Components) {

  var ProjectionChart = Components.ProjectionChart;
  var MiniChart = Components.MiniChart;
  var HistoryChart = Components.HistoryChart;

  function ProfileTab(props) {
    var profile = props.profile, targets = props.targets, email = props.email, history = props.history;
    var up = props.up;
    var editingBMR = props.editingBMR, setEditingBMR = props.setEditingBMR;
    var bmrInput = props.bmrInput, setBmrInput = props.setBmrInput;
    var editing = props.editing, setEditing = props.setEditing;
    var theme = props.theme, setTheme = props.setTheme;
    var setScreen = props.setScreen, setEmail = props.setEmail, setLoginEmail = props.setLoginEmail;

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
        <MiniChart
          data={[targets.protein, targets.carbs, targets.fats]}
          labels={["Protein", "Carbs", "Fats"]}
          colors={["var(--blue)", "var(--yellow)", "var(--purple)"]}
          title="Daily Macro Targets (g)"
          height={90}
        />
        <HistoryChart history={history} />

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
          <div className="fade-in" style={{ marginBottom: 20 }}>
            <div className="grid-2-10" style={{ marginBottom: 14 }}>
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
                  <div key={f.k}>
                    <label style={{ fontSize: 10, color: "var(--text-muted)", fontWeight: 600, textTransform: "uppercase", letterSpacing: 0.5 }}>
                      {f.l}{f.u && <span style={{ color: "var(--text-faint)" }}> ({f.u})</span>}
                    </label>
                    <input
                      className="input"
                      type={f.t || "number"}
                      inputMode={f.t ? "text" : "decimal"}
                      value={profile[f.k]}
                      style={{ marginTop: 4 }}
                      onChange={function(e) { up(f.k, f.t ? e.target.value : parseFloat(e.target.value) || 0); }}
                    />
                  </div>
                );
              })}
            </div>
            <div style={{ display: "flex", gap: 8, marginBottom: 10 }}>
              {[{ id: "male", label: "Male" }, { id: "female", label: "Female" }].map(function(s) {
                return <button key={s.id} className={"sex-btn" + (profile.sex === s.id ? " active" : "")} onClick={function() { up("sex", s.id); }}>{s.label}</button>;
              })}
            </div>
          </div>
        )}

        {/* BMR Formula info */}
        <div className="card" style={{ padding: 14, marginBottom: 16, background: "var(--surface-alt)" }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: "var(--text-muted)", marginBottom: 8, textTransform: "uppercase", letterSpacing: 1 }}>BMR Formula</div>
          <div style={{ fontSize: 11, lineHeight: 1.7, color: "var(--text-dim)" }}>
            <strong>Mifflin-St Jeor</strong><br />
            Male: (10{"\u00D7"}kg)+(6.25{"\u00D7"}cm)-(5{"\u00D7"}age)+5<br />
            Female: same -161<br />
            <span style={{ fontSize: 10, color: "var(--text-faint)" }}>
              {(profile.weight * 0.453592).toFixed(1)}kg {"\u00B7"} {(profile.height * 2.54).toFixed(1)}cm {"\u00B7"} {profile.age}yrs = <strong>{targets.calculatedBMR} kcal</strong>
            </span>
          </div>
        </div>

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
