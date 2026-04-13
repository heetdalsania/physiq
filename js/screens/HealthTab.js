/* ─── PHYSIQ ENGINE — Health Tab ──────────────────────────────────────────── */

window.PhysIQ = window.PhysIQ || {};
window.PhysIQ.Screens = window.PhysIQ.Screens || {};

(function(Screens, Data) {

  var useState = React.useState;

  var GOALS = Data.GOALS;
  var ACTIVITY_LEVELS = Data.ACTIVITY_LEVELS;
  var MUSCLE_GROUPS = Data.MUSCLE_GROUPS;
  var NUTRIENT_INFO = Data.NUTRIENT_INFO;
  var EXERCISES = Data.EXERCISES;

  var DAYS_FULL = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

  function HealthTab({ profile, targets, up, toggleMuscle, addExercise, editingDay, stopEditWorkout }) {
    var _expanded = useState(null);
    var expandedMuscle = _expanded[0], setExpandedMuscle = _expanded[1];

    var _addedEx = useState(null);
    var addedEx = _addedEx[0], setAddedEx = _addedEx[1];

    var handleAddExercise = function(name, muscleLabel) {
      addExercise(name, muscleLabel);
      setAddedEx(name);
      setTimeout(function() { setAddedEx(null); }, 600);
    };

    var handleMuscleClick = function(id) {
      toggleMuscle(id);
      // If the muscle is being activated (not currently in today's list), expand it
      if (!profile.todayMuscles.includes(id)) {
        setExpandedMuscle(id);
      } else {
        // If deactivating and it was expanded, collapse it
        if (expandedMuscle === id) setExpandedMuscle(null);
      }
    };

    var toggleExpand = function(id) {
      if (expandedMuscle === id) {
        // Collapsing — also deselect the muscle group
        setExpandedMuscle(null);
        toggleMuscle(id);
      } else {
        setExpandedMuscle(id);
      }
    };

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

        {/* Editing banner */}
        {editingDay !== null && (
          <div className="edit-workout-banner fade-in">
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: "var(--text-white)" }}>
                Editing {DAYS_FULL[editingDay]}'s Workout
              </div>
              <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 2 }}>
                Select a muscle group and tap exercises to add them
              </div>
            </div>
            <button className="edit-done-btn" onClick={stopEditWorkout}>Done</button>
          </div>
        )}

        {/* Today's Workout — Muscle Groups */}
        <div className="label">{editingDay !== null ? DAYS_FULL[editingDay] + "'s Workout" : "Today's Workout"}</div>
        <div className="grid-2-10" style={{ marginBottom: 20 }}>
          {MUSCLE_GROUPS.map(function(mg) {
            var active = profile.todayMuscles.includes(mg.id);
            var isExpanded = expandedMuscle === mg.id && active;
            var exercises = EXERCISES[mg.id] || [];
            return (
              <div key={mg.id} className={"muscle-card" + (active ? " active" : "") + (isExpanded ? " expanded" : "")}>
                <button className={"muscle-btn" + (active ? " active" : "")} onClick={function() { handleMuscleClick(mg.id); }} style={{ width: "100%" }}>
                  <div style={{ fontSize: 18, marginBottom: 4 }}>{mg.icon}</div>
                  <div style={{ fontSize: 14, fontWeight: 600 }}>{mg.label}</div>
                  <div style={{ fontSize: 10, color: "var(--text-faint)", marginTop: 2 }}>{mg.recovery}h recovery</div>
                </button>
                {active && exercises.length > 0 && (
                  <div className="exercise-toggle-wrapper">
                    <button className="exercise-toggle-btn" onClick={function() { toggleExpand(mg.id); }}>
                      <span>{isExpanded ? "Hide" : "View"} Exercises</span>
                      <span className={"exercise-chevron" + (isExpanded ? " open" : "")}>{"\u25BE"}</span>
                    </button>
                  </div>
                )}
                {isExpanded && exercises.length > 0 && (
                  <div className="exercise-list fade-in">
                    {exercises.map(function(ex, i) {
                      return (
                        <div key={ex} className={"exercise-item exercise-item-add" + (addedEx === ex ? " exercise-item-added" : "")} onClick={function() { handleAddExercise(ex, mg.label); }}>
                          <span className="exercise-num">{i + 1}</span>
                          <span className="exercise-name">{ex}</span>
                          <span className={"exercise-add-icon" + (addedEx === ex ? " added" : "")}>
                            {addedEx === ex ? "\u2713" : "+"}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
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
