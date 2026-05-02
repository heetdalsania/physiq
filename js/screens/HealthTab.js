/* ─── PHYSIQ ENGINE — Health Tab ──────────────────────────────────────────── */

window.PhysIQ = window.PhysIQ || {};
window.PhysIQ.Screens = window.PhysIQ.Screens || {};

(function(Screens, Data) {

  var useState = React.useState;

  var GOALS = Data.GOALS;
  var ACTIVITY_LEVELS = Data.ACTIVITY_LEVELS;
  var NUTRIENT_INFO = Data.NUTRIENT_INFO;

  function HealthTab({ profile, targets, up, workoutLog }) {

    return (
      <div className="fade-in" style={{ paddingTop: 16 }}>
        {/* Goal selection */}
        <div className="label">Goal</div>
        <div className="flex-col gap-6" style={{ marginBottom: 20 }}>
          {GOALS.map(function(g) {
            return (
              <button key={g.id} className={"option-btn" + (profile.goal === g.id ? " active" : "")} onClick={function() { up("goal", g.id); }} style={{ padding: 12 }}>
                <span className={"option-icon pq-icon " + g.iconClass} aria-hidden="true"></span>
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
        
        {/* Lifetime Exercise Stats */}
        {workoutLog && workoutLog.length > 0 && (
          <React.Fragment>
            <div className="label" style={{ marginTop: 24 }}>Lifetime Stats</div>
            <div className="flex-col gap-6" style={{ marginBottom: 20 }}>
              {function() {
                var totalW = workoutLog.length;
                var totalS = 0;
                var totalMin = 0;
                workoutLog.forEach(function(w) {
                  totalS += (w.completedSets || 0);
                  if (w.startedAt && w.finishedAt) {
                    totalMin += Math.round((w.finishedAt - w.startedAt) / 60000);
                  }
                });
                // Rough estimation: weightlifting burns ~4-6 cals/min. Use 5.
                var calsBurned = totalMin * 5;

                return (
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                    <div className="option-btn" style={{ padding: 12, display: "flex", flexDirection: "column", gap: 4 }}>
                      <span style={{ fontSize: 10, color: "var(--text-faint)", textTransform: "uppercase", letterSpacing: 0.5 }}>Workouts</span>
                      <span className="mono" style={{ fontSize: 18, fontWeight: 700, color: "var(--blue)" }}>{totalW}</span>
                    </div>
                    <div className="option-btn" style={{ padding: 12, display: "flex", flexDirection: "column", gap: 4 }}>
                      <span style={{ fontSize: 10, color: "var(--text-faint)", textTransform: "uppercase", letterSpacing: 0.5 }}>Sets Completed</span>
                      <span className="mono" style={{ fontSize: 18, fontWeight: 700, color: "var(--orange)" }}>{totalS}</span>
                    </div>
                    <div className="option-btn" style={{ padding: 12, display: "flex", flexDirection: "column", gap: 4 }}>
                      <span style={{ fontSize: 10, color: "var(--text-faint)", textTransform: "uppercase", letterSpacing: 0.5 }}>Total Minutes</span>
                      <span className="mono" style={{ fontSize: 18, fontWeight: 700, color: "var(--purple)" }}>{totalMin}</span>
                    </div>
                    <div className="option-btn" style={{ padding: 12, display: "flex", flexDirection: "column", gap: 4 }}>
                      <span style={{ fontSize: 10, color: "var(--text-faint)", textTransform: "uppercase", letterSpacing: 0.5 }}>Cals Burned (Est.)</span>
                      <span className="mono" style={{ fontSize: 18, fontWeight: 700, color: "var(--green)" }}>{calsBurned.toLocaleString()}</span>
                    </div>
                  </div>
                );
              }()}
            </div>
          </React.Fragment>
        )}
      </div>
    );
  }

  Screens.HealthTab = HealthTab;

})(window.PhysIQ.Screens, window.PhysIQ.Data);
