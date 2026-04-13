/* ─── PHYSIQ ENGINE — Exercise Tab ────────────────────────────────────────── */

window.PhysIQ = window.PhysIQ || {};
window.PhysIQ.Screens = window.PhysIQ.Screens || {};

(function(Screens, Data) {

  var useState = React.useState;
  var useRef = React.useRef;
  var useEffect = React.useEffect;

  var DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  var DAY_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

  // ─── Exercise categorization ─────────────────────────────────────────
  var EXERCISE_CATEGORY = {
    "Bench Press": "upper_compound",
    "Incline Dumbbell Press": "upper_compound",
    "Chest Fly": "isolation",
    "Push-ups": "upper_compound",
    "Pull-ups": "upper_compound",
    "Lat Pulldown": "upper_compound",
    "Seated Cable Row": "upper_compound",
    "Deadlift": "lower_compound",
    "Overhead Shoulder Press": "upper_compound",
    "Lateral Raises": "isolation",
    "Rear Delt Fly": "isolation",
    "Arnold Press": "upper_compound",
    "Barbell Curls": "isolation",
    "Dumbbell Curls": "isolation",
    "Hammer Curls": "isolation",
    "Preacher Curls": "isolation",
    "Tricep Pushdowns": "isolation",
    "Overhead Tricep Extension": "isolation",
    "Dips": "upper_compound",
    "Close-Grip Bench Press": "upper_compound",
    "Squats": "lower_compound",
    "Leg Press": "lower_compound",
    "Lunges": "lower_compound",
    "Leg Curl": "isolation",
    "Plank": "core",
    "Hanging Leg Raises": "core",
    "Hip Thrusts": "lower_compound",
    "Glute Bridges": "lower_compound"
  };

  var BASE_CALORIES = {
    upper_compound: 4,
    lower_compound: 6,
    isolation: 3,
    core: 2.5
  };

  function calcSetCalories(exerciseName, reps, userWeight, weight) {
    var category = EXERCISE_CATEGORY[exerciseName] || "isolation";
    var base = BASE_CALORIES[category] || 3;
    var bodyweightFactor = userWeight / 180;
    var repFactor = reps / 8;
    if (repFactor < 0.75) repFactor = 0.75;
    if (repFactor > 1.25) repFactor = 1.25;
    var weightFactor = 1 + ((weight || 0) / userWeight) * 0.5;
    return Math.round(base * bodyweightFactor * repFactor * weightFactor);
  }

  // ─── Floating +/- animation component ────────────────────────────────
  function CaloriePop({ value, id }) {
    var _visible = useState(true);
    var visible = _visible[0], setVisible = _visible[1];

    useEffect(function() {
      var t = setTimeout(function() { setVisible(false); }, 900);
      return function() { clearTimeout(t); };
    }, []);

    if (!visible) return null;

    var isPositive = value > 0;
    return (
      <span
        key={id}
        className="cal-pop"
        style={{ color: isPositive ? "var(--green)" : "var(--red)" }}
      >
        {isPositive ? "+" : ""}{value}
      </span>
    );
  }

  // ─── Main component ──────────────────────────────────────────────────
  function ExerciseTab({ weeklyExercises, updateExercise, removeExercise, startEditWorkout, profile }) {
    var today = new Date().getDay();
    var _selectedDay = useState(today);
    var selectedDay = _selectedDay[0], setSelectedDay = _selectedDay[1];

    var _workoutMode = useState(null);
    var workoutMode = _workoutMode[0], setWorkoutMode = _workoutMode[1];

    // Calorie animation pops
    var _calPops = useState([]);
    var calPops = _calPops[0], setCalPops = _calPops[1];
    var popIdRef = useRef(0);

    var dayExercises = weeklyExercises[selectedDay] || [];
    var userWeight = (profile && profile.weight) || 180;

    var startWorkout = function() {
      var logs = {};
      dayExercises.forEach(function(ex) {
        var sets = [];
        for (var i = 0; i < ex.sets; i++) {
          sets.push({ reps: ex.reps, weight: ex.maxWeight || 0, done: false });
        }
        logs[ex.id] = sets;
      });
      setWorkoutMode({ setLogs: logs });
      setCalPops([]);
    };

    var endWorkout = function() {
      setWorkoutMode(null);
      setCalPops([]);
    };

    var updateSetLog = function(exId, setIdx, field, value) {
      var clamped = value < 0 ? 0 : value;
      setWorkoutMode(function(prev) {
        if (!prev) return prev;
        var newLogs = Object.assign({}, prev.setLogs);
        var sets = newLogs[exId].slice();
        sets[setIdx] = Object.assign({}, sets[setIdx]);
        sets[setIdx][field] = clamped;
        newLogs[exId] = sets;
        return { setLogs: newLogs };
      });
    };

    var addSetToExercise = function(exId) {
      setWorkoutMode(function(prev) {
        if (!prev) return prev;
        var newLogs = Object.assign({}, prev.setLogs);
        var sets = newLogs[exId].slice();
        var lastSet = sets.length > 0 ? sets[sets.length - 1] : { reps: 10, weight: 0 };
        sets.push({ reps: lastSet.reps, weight: lastSet.weight, done: false });
        newLogs[exId] = sets;
        return { setLogs: newLogs };
      });
    };

    var removeSetFromExercise = function(exId, setIdx, exerciseName) {
      var setToRemove = workoutMode.setLogs[exId][setIdx];
      // If the set was completed, show calorie subtraction pop
      if (setToRemove && setToRemove.done) {
        var setCal = calcSetCalories(exerciseName, setToRemove.reps, userWeight, setToRemove.weight);
        popIdRef.current += 1;
        var newPop = { id: popIdRef.current, value: -setCal };
        setCalPops(function(prev) { return prev.concat([newPop]); });
        setTimeout(function() {
          setCalPops(function(prev) { return prev.filter(function(p) { return p.id !== newPop.id; }); });
        }, 1000);
      }

      setWorkoutMode(function(prev) {
        if (!prev) return prev;
        var newLogs = Object.assign({}, prev.setLogs);
        var sets = newLogs[exId].slice();
        sets.splice(setIdx, 1);
        newLogs[exId] = sets;
        return { setLogs: newLogs };
      });
    };

    var toggleSetDone = function(exId, setIdx, exerciseName, reps, weight) {
      var wasDone = workoutMode.setLogs[exId][setIdx].done;
      var setCal = calcSetCalories(exerciseName, reps, userWeight, weight);
      var delta = wasDone ? -setCal : setCal;

      // Show pop animation
      popIdRef.current += 1;
      var newPop = { id: popIdRef.current, value: delta };
      setCalPops(function(prev) { return prev.concat([newPop]); });
      setTimeout(function() {
        setCalPops(function(prev) { return prev.filter(function(p) { return p.id !== newPop.id; }); });
      }, 1000);

      setWorkoutMode(function(prev) {
        if (!prev) return prev;
        var newLogs = Object.assign({}, prev.setLogs);
        var sets = newLogs[exId].slice();
        sets[setIdx] = Object.assign({}, sets[setIdx]);
        sets[setIdx].done = !sets[setIdx].done;
        newLogs[exId] = sets;
        return { setLogs: newLogs };
      });
    };

    // Count completed sets and calories
    var completedSets = 0;
    var totalSets = 0;
    var totalCalories = 0;
    if (workoutMode) {
      dayExercises.forEach(function(ex) {
        var sets = workoutMode.setLogs[ex.id] || [];
        sets.forEach(function(s) {
          totalSets++;
          if (s.done) {
            completedSets++;
            totalCalories += calcSetCalories(ex.name, s.reps, userWeight, s.weight);
          }
        });
      });
    }

    var handleDaySwitch = function(i) {
      setSelectedDay(i);
      setWorkoutMode(null);
      setCalPops([]);
    };

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
                onClick={function() { handleDaySwitch(i); }}
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
          {!workoutMode && (
            <React.Fragment>
              <span className="mono" style={{ fontSize: 12, color: "var(--text-muted)" }}>
                {dayExercises.length} exercise{dayExercises.length !== 1 ? "s" : ""}
              </span>
              {dayExercises.length > 0 && (
                <button className="start-workout-btn" onClick={startWorkout}>
                  Start Workout
                </button>
              )}
              <button className="edit-workout-btn" onClick={function() { startEditWorkout(selectedDay); }}>
                Edit Workout
              </button>
            </React.Fragment>
          )}
          {workoutMode && (
            <React.Fragment>
              <span className="mono" style={{ fontSize: 12, color: "var(--green)" }}>
                {completedSets}/{totalSets} sets
              </span>
              <button className="end-workout-btn" onClick={endWorkout}>
                End Workout
              </button>
            </React.Fragment>
          )}
        </div>

        {/* Workout mode banner */}
        {workoutMode && (
          <React.Fragment>
            <div className="workout-active-banner fade-in">
              <span style={{ fontSize: 14 }}>{"\uD83D\uDCAA"}</span>
              <span style={{ fontSize: 13, fontWeight: 600, color: "var(--text-white)" }}>Workout in progress</span>
              <span style={{ flex: 1 }} />
              <span className="mono" style={{ fontSize: 12, color: "var(--green)" }}>
                {completedSets === totalSets && totalSets > 0 ? "All sets done!" : Math.round(completedSets / totalSets * 100) + "% complete"}
              </span>
            </div>
            <div className="cal-burned-banner fade-in">
              <span style={{ fontSize: 14 }}>{"\uD83D\uDD25"}</span>
              <span style={{ fontSize: 13, fontWeight: 600, color: "var(--text-dim)" }}>Estimated Calories Burned</span>
              <span style={{ flex: 1 }} />
              <span className="cal-burned-value" style={{ position: "relative" }}>
                <span className="mono" style={{ fontSize: 14, fontWeight: 700, color: "var(--orange)" }}>{totalCalories}</span>
                {calPops.map(function(p) {
                  return <CaloriePop key={p.id} value={p.value} id={p.id} />;
                })}
              </span>
            </div>
          </React.Fragment>
        )}

        {/* Exercises list */}
        {dayExercises.length === 0 ? (
          <div className="ex-empty">
            <div style={{ fontSize: 24, marginBottom: 8, opacity: 0.4 }}>{"\uD83C\uDFCB"}</div>
            <div style={{ fontSize: 13, color: "var(--text-muted)", marginBottom: 8 }}>No exercises planned</div>
            <button className="add-workouts-btn" onClick={function() { startEditWorkout(selectedDay); }}>
              + Add Workouts
            </button>
          </div>
        ) : !workoutMode ? (
          /* ── Planning Mode ── */
          <div className="flex-col gap-10">
            {dayExercises.map(function(ex) {
              return (
                <div key={ex.id} className="ex-card fade-in">
                  <div className="ex-card-header">
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: 14, fontWeight: 600, color: "var(--text-white)" }}>{ex.name}</div>
                      <div style={{ fontSize: 11, color: "var(--purple-light)", marginTop: 2 }}>{ex.muscle}</div>
                    </div>
                    <button className="ex-remove-btn" onClick={function() { removeExercise(selectedDay, ex.id); }} title="Remove">
                      {"\u2715"}
                    </button>
                  </div>
                  <div className="ex-controls">
                    <div className="ex-control-group">
                      <label className="ex-control-label">Sets</label>
                      <div className="ex-stepper">
                        <button className="ex-stepper-btn" onClick={function() { if (ex.sets > 1) updateExercise(selectedDay, ex.id, "sets", ex.sets - 1); }}>{"\u2212"}</button>
                        <span className="ex-stepper-value mono">{ex.sets}</span>
                        <button className="ex-stepper-btn" onClick={function() { updateExercise(selectedDay, ex.id, "sets", ex.sets + 1); }}>+</button>
                      </div>
                    </div>
                    <div className="ex-control-group">
                      <label className="ex-control-label">Reps</label>
                      <div className="ex-stepper">
                        <button className="ex-stepper-btn" onClick={function() { if (ex.reps > 1) updateExercise(selectedDay, ex.id, "reps", ex.reps - 1); }}>{"\u2212"}</button>
                        <span className="ex-stepper-value mono">{ex.reps}</span>
                        <button className="ex-stepper-btn" onClick={function() { updateExercise(selectedDay, ex.id, "reps", ex.reps + 1); }}>+</button>
                      </div>
                    </div>
                    <div className="ex-control-group">
                      <label className="ex-control-label">Weight (lbs)</label>
                      <input
                        type="number"
                        className="ex-weight-input mono"
                        value={ex.maxWeight || ""}
                        min="0"
                        placeholder="—"
                        onChange={function(e) { var v = parseInt(e.target.value) || 0; updateExercise(selectedDay, ex.id, "maxWeight", v < 0 ? 0 : v); }}
                      />
                    </div>
                  </div>
                  {ex.maxWeight > 0 && (
                    <div style={{ fontSize: 11, color: "var(--text-faint)", marginTop: 8, paddingTop: 8, borderTop: "1px solid var(--border)" }}>
                      Volume: {ex.sets * ex.reps} total reps {"\u00B7"} {ex.sets * ex.reps * ex.maxWeight} lbs total
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        ) : (
          /* ── Workout / Logging Mode ── */
          <div className="flex-col gap-10">
            {dayExercises.map(function(ex) {
              var setLogs = (workoutMode.setLogs[ex.id] || []);
              var exDone = setLogs.length > 0 && setLogs.every(function(s) { return s.done; });
              return (
                <div key={ex.id} className={"ex-card ex-card-workout fade-in" + (exDone ? " ex-card-done" : "")}>
                  <div className="ex-card-header">
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: 14, fontWeight: 600, color: "var(--text-white)" }}>
                        {exDone && <span style={{ marginRight: 6 }}>{"\u2705"}</span>}
                        {ex.name}
                      </div>
                      <div style={{ fontSize: 11, color: "var(--purple-light)", marginTop: 2 }}>{ex.muscle}</div>
                    </div>
                  </div>

                  {/* Column labels */}
                  <div className="set-log-header">
                    <span className="set-log-col-set">Set</span>
                    <span className="set-log-col-reps">Reps</span>
                    <span className="set-log-col-weight">Weight</span>
                    <span className="set-log-col-done">Done</span>
                    <span className="set-log-col-del" />
                  </div>

                  {/* Set rows */}
                  <div className="set-log-rows">
                    {setLogs.map(function(s, si) {
                      return (
                        <div key={si} className={"set-log-row" + (s.done ? " set-log-row-done" : "")}>
                          <span className="set-log-col-set mono">Set {si + 1}</span>
                          <div className="set-log-col-reps">
                            <input
                              type="number"
                              className="set-log-input mono"
                              value={s.reps || ""}
                              min="0"
                              onChange={function(e) { updateSetLog(ex.id, si, "reps", parseInt(e.target.value) || 0); }}
                            />
                          </div>
                          <div className="set-log-col-weight">
                            <input
                              type="number"
                              className="set-log-input mono"
                              value={s.weight || ""}
                              min="0"
                              placeholder="0"
                              onChange={function(e) { updateSetLog(ex.id, si, "weight", parseInt(e.target.value) || 0); }}
                            />
                          </div>
                          <div className="set-log-col-done">
                            <button
                              className={"set-done-checkbox" + (s.done ? " checked" : "")}
                              onClick={function() { toggleSetDone(ex.id, si, ex.name, s.reps, s.weight); }}
                            >
                              {s.done ? "\u2713" : ""}
                            </button>
                          </div>
                          <div className="set-log-col-del">
                            {setLogs.length > 1 && (
                              <button
                                className="set-del-btn"
                                onClick={function() { removeSetFromExercise(ex.id, si, ex.name); }}
                                title="Remove set"
                              >
                                {"\uD83D\uDDD1"}
                              </button>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>

                  {/* Add set button */}
                  <button className="add-set-btn" onClick={function() { addSetToExercise(ex.id); }}>
                    + Add Set
                  </button>
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
