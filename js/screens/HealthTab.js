/* ─── PHYSIQ ENGINE — Health Tab ──────────────────────────────────────────── */

window.PhysIQ = window.PhysIQ || {};
window.PhysIQ.Screens = window.PhysIQ.Screens || {};

(function(Screens, Data) {

  var GOALS = Data.GOALS;
  var ACTIVITY_LEVELS = Data.ACTIVITY_LEVELS;
  var MUSCLE_GROUPS = Data.MUSCLE_GROUPS;
  var NUTRIENT_INFO = Data.NUTRIENT_INFO;

  function HealthTab({ profile, targets, up, toggleMuscle }) {
    return (
      <div className="fade-in" style={{ paddingTop: 16 }}>
        {/* Goal selection */}
        <div className="label">Goal</div>
        <div className="flex-col gap-6" style={{ marginBottom: 20 }}>
          {GOALS.map(function(g) {
            return (
              <button key={g.id} className={"option-btn" + (profile.goal === g.id ? " active" : "")} onClick={function() { up("goal", g.id); }} style={{ padding: 12 }}>
                <span style={{ fontSize: 16, flexShrink: 0 }}>{g.icon}</span>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 13, fontWeight: 600 }}>{g.label}</div>
                  <div style={{ fontSize: 10, color: "var(--text-faint)" }}>
                    {g.pct > 0 ? "+" : ""}{Math.round(g.pct * 100)}% cal {"\u00B7"} {g.proteinGKg}g/kg protein
                  </div>
                </div>
              </button>
            );
          })}
        </div>

        {/* Activity Level */}
        <div className="label">Activity Level</div>
        <div className="flex-col gap-6" style={{ marginBottom: 20 }}>
          {ACTIVITY_LEVELS.map(function(a) {
            return (
              <button key={a.id} className={"option-btn" + (profile.activity === a.id ? " active" : "")} onClick={function() { up("activity", a.id); }}>
                <span style={{ fontSize: 12, flex: 1 }}>{a.label}</span>
                <span className="mono" style={{ fontSize: 10, color: "var(--text-faint)" }}>{a.steps} steps</span>
              </button>
            );
          })}
        </div>

        {/* Today's Workout — Muscle Groups */}
        <div className="label">Today's Workout</div>
        <div className="grid-2-10" style={{ marginBottom: 20 }}>
          {MUSCLE_GROUPS.map(function(mg) {
            var active = profile.todayMuscles.includes(mg.id);
            return (
              <button key={mg.id} className={"muscle-btn" + (active ? " active" : "")} onClick={function() { toggleMuscle(mg.id); }}>
                <div style={{ fontSize: 18, marginBottom: 4 }}>{mg.icon}</div>
                <div style={{ fontSize: 14, fontWeight: 600 }}>{mg.label}</div>
                <div style={{ fontSize: 10, color: "var(--text-faint)", marginTop: 2 }}>{mg.recovery}h recovery</div>
              </button>
            );
          })}
        </div>

        {/* Nutrient Focus (shown when muscles are selected) */}
        {profile.todayMuscles.length > 0 && (
          <React.Fragment>
            <div className="label">Nutrient Focus</div>
            <div className="flex-col gap-8" style={{ marginBottom: 20 }}>
              {/* Deduplicate nutrients across selected muscles */}
              {Array.from(new Set(
                profile.todayMuscles.flatMap(function(id) {
                  var mg = MUSCLE_GROUPS.find(function(m) { return m.id === id; });
                  return mg ? mg.nutrients : [];
                })
              )).map(function(n) {
                var info = NUTRIENT_INFO[n];
                if (!info) return null;
                return (
                  <div key={n} className="nutrient-focus" style={{ background: info.color + "08", border: "1px solid " + info.color + "22" }}>
                    <div style={{ width: 8, height: 8, borderRadius: "50%", background: info.color }} />
                    <span style={{ fontSize: 13, fontWeight: 600, color: info.color }}>{info.label}</span>
                    <span style={{ flex: 1 }} />
                    <span className="mono" style={{ fontSize: 12, color: "var(--text-dim)" }}>Target: {targets[n]}{info.unit}</span>
                  </div>
                );
              })}
            </div>
          </React.Fragment>
        )}
      </div>
    );
  }

  Screens.HealthTab = HealthTab;

})(window.PhysIQ.Screens, window.PhysIQ.Data);
