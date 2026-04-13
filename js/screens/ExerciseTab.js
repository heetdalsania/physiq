/* ─── PHYSIQ ENGINE — Exercise Tab ────────────────────────────────────────── */

window.PhysIQ = window.PhysIQ || {};
window.PhysIQ.Screens = window.PhysIQ.Screens || {};

(function(Screens, Data) {

  var useState = React.useState;

  var DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  var DAY_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

  function ExerciseTab({ weeklyExercises, updateExercise, removeExercise, startEditWorkout }) {
    var today = new Date().getDay(); // 0 = Sunday
    var _selectedDay = useState(today);
    var selectedDay = _selectedDay[0], setSelectedDay = _selectedDay[1];

    var dayExercises = weeklyExercises[selectedDay] || [];

    return (
      <div className="fade-in" style={{ paddingTop: 16 }}>
        {/* Day selector */}
        <div className="label">Weekly Plan</div>
        <div className="day-selector" style={{ marginBottom: 20 }}>
          {DAY_SHORT.map(function(d, i) {
            var hasExercises = (weeklyExercises[i] || []).length > 0;
            return (
              <button
                key={i}
                className={"day-pill" + (selectedDay === i ? " active" : "") + (i === today ? " today" : "")}
                onClick={function() { setSelectedDay(i); }}
              >
                <span className="day-pill-label">{d}</span>
                {hasExercises && <span className="day-pill-dot" />}
              </button>
            );
          })}
        </div>

        {/* Day header */}
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 14 }}>
          <div style={{ fontSize: 16, fontWeight: 700, color: "var(--text-white)" }}>{DAYS[selectedDay]}</div>
          {selectedDay === today && (
            <span style={{ fontSize: 10, fontWeight: 700, color: "var(--green)", textTransform: "uppercase", letterSpacing: 1 }}>Today</span>
          )}
          <span style={{ flex: 1 }} />
          <span className="mono" style={{ fontSize: 12, color: "var(--text-muted)" }}>
            {dayExercises.length} exercise{dayExercises.length !== 1 ? "s" : ""}
          </span>
          <button className="edit-workout-btn" onClick={function() { startEditWorkout(selectedDay); }}>
            Edit Workout
          </button>
        </div>

        {/* Exercises list */}
        {dayExercises.length === 0 ? (
          <div className="ex-empty">
            <div style={{ fontSize: 24, marginBottom: 8, opacity: 0.4 }}>{"\uD83C\uDFCB"}</div>
            <div style={{ fontSize: 13, color: "var(--text-muted)", marginBottom: 8 }}>No exercises planned</div>
            <button className="add-workouts-btn" onClick={function() { startEditWorkout(selectedDay); }}>
              + Add Workouts
            </button>
          </div>
        ) : (
          <div className="flex-col gap-10">
            {dayExercises.map(function(ex, idx) {
              return (
                <div key={ex.id} className="ex-card fade-in">
                  {/* Exercise header */}
                  <div className="ex-card-header">
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: 14, fontWeight: 600, color: "var(--text-white)" }}>{ex.name}</div>
                      <div style={{ fontSize: 11, color: "var(--purple-light)", marginTop: 2 }}>{ex.muscle}</div>
                    </div>
                    <button className="ex-remove-btn" onClick={function() { removeExercise(selectedDay, ex.id); }} title="Remove">
                      {"\u2715"}
                    </button>
                  </div>

                  {/* Controls */}
                  <div className="ex-controls">
                    {/* Sets */}
                    <div className="ex-control-group">
                      <label className="ex-control-label">Sets</label>
                      <div className="ex-stepper">
                        <button className="ex-stepper-btn" onClick={function() { if (ex.sets > 1) updateExercise(selectedDay, ex.id, "sets", ex.sets - 1); }}>{"\u2212"}</button>
                        <span className="ex-stepper-value mono">{ex.sets}</span>
                        <button className="ex-stepper-btn" onClick={function() { updateExercise(selectedDay, ex.id, "sets", ex.sets + 1); }}>+</button>
                      </div>
                    </div>

                    {/* Reps */}
                    <div className="ex-control-group">
                      <label className="ex-control-label">Reps</label>
                      <div className="ex-stepper">
                        <button className="ex-stepper-btn" onClick={function() { if (ex.reps > 1) updateExercise(selectedDay, ex.id, "reps", ex.reps - 1); }}>{"\u2212"}</button>
                        <span className="ex-stepper-value mono">{ex.reps}</span>
                        <button className="ex-stepper-btn" onClick={function() { updateExercise(selectedDay, ex.id, "reps", ex.reps + 1); }}>+</button>
                      </div>
                    </div>

                    {/* Max Weight */}
                    <div className="ex-control-group">
                      <label className="ex-control-label">Max (lbs)</label>
                      <input
                        type="number"
                        className="ex-weight-input mono"
                        value={ex.maxWeight || ""}
                        placeholder="—"
                        onChange={function(e) { updateExercise(selectedDay, ex.id, "maxWeight", parseInt(e.target.value) || 0); }}
                      />
                    </div>
                  </div>

                  {/* Summary line */}
                  {ex.maxWeight > 0 && (
                    <div style={{ fontSize: 11, color: "var(--text-faint)", marginTop: 8, paddingTop: 8, borderTop: "1px solid var(--border)" }}>
                      Volume: {ex.sets * ex.reps} total reps {"\u00B7"} {ex.sets * ex.reps * ex.maxWeight} lbs total
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    );
  }

  Screens.ExerciseTab = ExerciseTab;

})(window.PhysIQ.Screens, window.PhysIQ.Data);
