/* ─── PHYSIQ ENGINE — Calendar Tab ────────────────────────────────────────── */

window.PhysIQ = window.PhysIQ || {};
window.PhysIQ.Screens = window.PhysIQ.Screens || {};

(function(Screens, Data, Utils) {

  var evaluateCalorieGoal = Utils.evaluateCalorieGoal;
  var evaluateNutritionDay = Utils.evaluateNutritionDay;
  var AppTime = Utils.AppTime;

  var useState = React.useState;
  var useMemo = React.useMemo;

  var MONTH_NAMES = [
    "January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December"
  ];
  var DAY_HEADERS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

  // ── Helpers ────────────────────────────────────────────────────────────
  function dateKey(d) {
    return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
  }

  function toDateString(d) {
    return d.toDateString(); // e.g. "Sun Apr 20 2026"
  }

  function isSameDay(a, b) {
    return a.getFullYear() === b.getFullYear() &&
           a.getMonth() === b.getMonth() &&
           a.getDate() === b.getDate();
  }

  function getMonthGrid(year, month) {
    var firstDay = new Date(year, month, 1).getDay();
    var daysInMonth = new Date(year, month + 1, 0).getDate();
    var grid = [];
    // Leading blanks
    for (var i = 0; i < firstDay; i++) grid.push(null);
    // Days
    for (var d = 1; d <= daysInMonth; d++) grid.push(d);
    return grid;
  }

  // ── Get ISO week key for grouping days into weeks ───────────────────
  function getWeekKey(d) {
    // Use Sunday-based weeks: week starts on Sunday
    var start = new Date(d);
    start.setDate(start.getDate() - start.getDay()); // Go to Sunday
    return dateKey(start);
  }

  // ── Determine day status ────────────────────────────────────────────
  // Returns: "green" | "yellow" | "red" | "future" | "none"
  // weekWorkoutCounts: Map of weekKey -> number of workouts that week
  // gymDays: user's target workout days per week
  function getDayStatus(dateObj, today, nutritionMap, workoutDaySet, weekWorkoutCounts, targets, gymDays, goal) {
    if (dateObj > today) return "future";

    var dStr = toDateString(dateObj);
    var dKey = dateKey(dateObj);

    // Nutrition check: full day = goal-aware calorie rule AND macro floor.
    //   Calories:
    //     cut/debloat → ≤ target (and > 0)
    //     build/lean  → ≥ target
    //     maintain    → within ±300 of target
    //   Macros (always required): protein, carbs, fats each ≥ target.
    //   Fails the whole check if any macro is below target, regardless of calories.
    var histEntry = nutritionMap[dStr];
    var nutritionMet = false;
    if (histEntry) {
      nutritionMet = evaluateNutritionDay(goal, histEntry, targets);
    }

    // Exercise check: did the user work out this day?
    var workedOutToday = workoutDaySet.has(dKey);

    // Weekly quota check: if the user's gym target for this week is already met,
    // remaining days count as "exercise met" automatically
    var wk = getWeekKey(dateObj);
    var weekCount = weekWorkoutCounts[wk] || 0;
    var exerciseMet = workedOutToday || (weekCount >= gymDays);

    if (nutritionMet && exerciseMet) return "green";
    if (nutritionMet || exerciseMet) return "yellow";

    // For today — if nothing logged yet, show "none" (neutral)
    if (isSameDay(dateObj, today)) return "none";

    // Past day with nothing
    return "red";
  }

  // ══════════════════════════════════════════════════════════════════════
  // CalendarTab Component
  // ══════════════════════════════════════════════════════════════════════
  function CalendarTab({ history, workoutLog, intake, targets, profile, devTick }) {
    // devTick is an unused prop intentionally bumped by App when Dev Mode
    // date changes, so this component re-renders and `today` re-resolves.
    var today = AppTime ? AppTime.now() : new Date();
    var _viewDate = useState(new Date(today.getFullYear(), today.getMonth(), 1));
    var viewDate = _viewDate[0], setViewDate = _viewDate[1];

    var _selectedDay = useState(null);
    var selectedDay = _selectedDay[0], setSelectedDay = _selectedDay[1];

    // Which workout cards are expanded to show exercise recap
    var _expandedWorkouts = useState({});
    var expandedWorkouts = _expandedWorkouts[0], setExpandedWorkouts = _expandedWorkouts[1];
    var toggleWorkout = function(id) {
      setExpandedWorkouts(function(prev) {
        var next = Object.assign({}, prev);
        if (next[id]) delete next[id]; else next[id] = true;
        return next;
      });
    };

    var viewYear = viewDate.getFullYear();
    var viewMonth = viewDate.getMonth();

    // Build nutrition lookup: { dateString: { calories, protein, ... } }
    var nutritionMap = useMemo(function() {
      var map = {};
      (history || []).forEach(function(h) {
        map[h.date] = h;
      });
      // Also add today's live intake
      map[today.toDateString()] = {
        date: today.toDateString(),
        calories: intake.calories,
        protein: intake.protein,
        carbs: intake.carbs,
        fats: intake.fats
      };
      return map;
    }, [history, intake]);

    // Build workout day set: Set of "YYYY-MM-DD" strings
    var workoutDaySet = useMemo(function() {
      var set = new Set();
      (workoutLog || []).forEach(function(s) {
        if (s.finishedAt) {
          var d = new Date(s.finishedAt);
          set.add(dateKey(d));
        }
      });
      return set;
    }, [workoutLog]);

    // Build week workout counts: { weekKey: numberOfUniqueWorkoutDays }
    var weekWorkoutCounts = useMemo(function() {
      var counts = {};
      // Group unique workout days by week
      workoutDaySet.forEach(function(dKey) {
        var parts = dKey.split("-");
        var d = new Date(parseInt(parts[0]), parseInt(parts[1]) - 1, parseInt(parts[2]));
        var wk = getWeekKey(d);
        counts[wk] = (counts[wk] || 0) + 1;
      });
      return counts;
    }, [workoutDaySet]);

    var gymDays = profile.gymDays || 5;
    var goal = profile.goal;

    // Month grid
    var grid = useMemo(function() {
      return getMonthGrid(viewYear, viewMonth);
    }, [viewYear, viewMonth]);

    // Navigation
    var prevMonth = function() {
      setViewDate(new Date(viewYear, viewMonth - 1, 1));
      setSelectedDay(null);
    };
    var nextMonth = function() {
      setViewDate(new Date(viewYear, viewMonth + 1, 1));
      setSelectedDay(null);
    };
    var goToday = function() {
      setViewDate(new Date(today.getFullYear(), today.getMonth(), 1));
      setSelectedDay(today.getDate());
    };

    // Selected day details
    var selectedDetails = useMemo(function() {
      if (!selectedDay) return null;
      var d = new Date(viewYear, viewMonth, selectedDay);
      var dStr = toDateString(d);
      var dKey = dateKey(d);
      var status = getDayStatus(d, today, nutritionMap, workoutDaySet, weekWorkoutCounts, targets, gymDays, goal);
      var hist = nutritionMap[dStr] || null;

      // Find workouts for that day
      var dayWorkouts = (workoutLog || []).filter(function(s) {
        if (!s.finishedAt) return false;
        return dateKey(new Date(s.finishedAt)) === dKey;
      });

      return {
        date: d,
        status: status,
        nutrition: hist,
        workouts: dayWorkouts,
        isToday: isSameDay(d, today)
      };
    }, [selectedDay, viewYear, viewMonth, nutritionMap, workoutDaySet, workoutLog, targets]);

    // Month stats
    var monthStats = useMemo(function() {
      var green = 0, yellow = 0, red = 0, total = 0;
      var daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate();
      for (var d = 1; d <= daysInMonth; d++) {
        var dateObj = new Date(viewYear, viewMonth, d);
        if (dateObj > today) break;
        total++;
        var st = getDayStatus(dateObj, today, nutritionMap, workoutDaySet, weekWorkoutCounts, targets, gymDays, goal);
        if (st === "green") green++;
        else if (st === "yellow") yellow++;
        else if (st === "red") red++;
      }
      return { green: green, yellow: yellow, red: red, total: total };
    }, [viewYear, viewMonth, nutritionMap, workoutDaySet, targets]);

    // Year range for the year picker
    var yearStart = today.getFullYear() - 5;
    var yearEnd = today.getFullYear() + 1;
    var yearOptions = [];
    for (var y = yearStart; y <= yearEnd; y++) yearOptions.push(y);

    var isCurrentMonth = viewYear === today.getFullYear() && viewMonth === today.getMonth();

    return (
      <div className="fade-in" style={{ paddingTop: 16 }}>
        {/* Month Navigation */}
        <div className="cal-nav">
          <button className="cal-nav-btn" onClick={prevMonth} aria-label="Previous month">{"\u2039"}</button>
          <div className="cal-nav-title">
            <div className="cal-nav-selectors">
              <select
                className="cal-select"
                value={viewMonth}
                onChange={function(e) { setViewDate(new Date(viewYear, parseInt(e.target.value), 1)); setSelectedDay(null); }}
              >
                {MONTH_NAMES.map(function(m, i) {
                  return <option key={i} value={i}>{m}</option>;
                })}
              </select>
              <select
                className="cal-select cal-select-year"
                value={viewYear}
                onChange={function(e) { setViewDate(new Date(parseInt(e.target.value), viewMonth, 1)); setSelectedDay(null); }}
              >
                {yearOptions.map(function(yr) {
                  return <option key={yr} value={yr}>{yr}</option>;
                })}
              </select>
            </div>
          </div>
          <button className="cal-nav-btn" onClick={nextMonth} aria-label="Next month">{"\u203A"}</button>
        </div>

        {/* Today button */}
        {!isCurrentMonth && (
          <button className="cal-today-btn" onClick={goToday}>
            {"\u2022"} Go to Today
          </button>
        )}

        {/* Day-of-week headers */}
        <div className="cal-grid">
          {DAY_HEADERS.map(function(d) {
            return <div key={d} className="cal-header">{d}</div>;
          })}

          {/* Day cells */}
          {grid.map(function(day, i) {
            if (day === null) {
              return <div key={"blank-" + i} className="cal-cell cal-blank" />;
            }

            var dateObj = new Date(viewYear, viewMonth, day);
            var isToday = isSameDay(dateObj, today);
            var isSelected = selectedDay === day;
            var status = getDayStatus(dateObj, today, nutritionMap, workoutDaySet, weekWorkoutCounts, targets, gymDays, goal);

            return (
              <button
                key={day}
                className={
                  "cal-cell" +
                  " cal-status-" + status +
                  (isToday ? " cal-today" : "") +
                  (isSelected ? " cal-selected" : "")
                }
                onClick={function() { setSelectedDay(day === selectedDay ? null : day); }}
              >
                <span className="cal-day-num">{day}</span>
                {status !== "future" && status !== "none" && (
                  <span className="cal-dot" />
                )}
              </button>
            );
          })}
        </div>

        {/* Legend */}
        <div className="cal-legend">
          <div className="cal-legend-item">
            <span className="cal-legend-dot cal-legend-green" />
            <span>Both Goals</span>
          </div>
          <div className="cal-legend-item">
            <span className="cal-legend-dot cal-legend-yellow" />
            <span>One Goal</span>
          </div>
          <div className="cal-legend-item">
            <span className="cal-legend-dot cal-legend-red" />
            <span>Neither</span>
          </div>
        </div>

        {/* Month Summary */}
        <div className="cal-summary">
          <div className="cal-summary-stat">
            <div className="cal-summary-val cal-val-green">{monthStats.green}</div>
            <div className="cal-summary-label">Perfect</div>
          </div>
          <div className="cal-summary-stat">
            <div className="cal-summary-val cal-val-yellow">{monthStats.yellow}</div>
            <div className="cal-summary-label">Partial</div>
          </div>
          <div className="cal-summary-stat">
            <div className="cal-summary-val cal-val-red">{monthStats.red}</div>
            <div className="cal-summary-label">Missed</div>
          </div>
          <div className="cal-summary-stat">
            <div className="cal-summary-val">{monthStats.total > 0 ? Math.round((monthStats.green / monthStats.total) * 100) : 0}%</div>
            <div className="cal-summary-label">Success</div>
          </div>
        </div>

        {/* Selected Day Detail Panel */}
        {selectedDetails && (
          <div className="cal-detail fade-in">
            <div className="cal-detail-header">
              <div className="cal-detail-date">
                {selectedDetails.date.toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" })}
                {selectedDetails.isToday && <span className="cal-detail-today-badge">Today</span>}
              </div>
              <span className={"cal-detail-status cal-detail-" + selectedDetails.status}>
                {selectedDetails.status === "green" ? "\u2713 Both Goals" :
                 selectedDetails.status === "yellow" ? "\u223C One Goal" :
                 selectedDetails.status === "red" ? "\u2717 Missed" :
                 selectedDetails.status === "future" ? "Upcoming" : "—"}
              </span>
            </div>

            {/* Nutrition */}
            <div className="cal-detail-section">
              <div className="cal-detail-section-title">
                <span>{"\uD83C\uDF4E"}</span>
                <span>Nutrition</span>
                {selectedDetails.nutrition && evaluateNutritionDay(goal, selectedDetails.nutrition, targets) && (
                  <span className="cal-detail-check">{"\u2713"}</span>
                )}
              </div>
              {selectedDetails.nutrition ? (
                <div className="cal-detail-macros">
                  {[
                    { key: "calories", label: "Calories", color: "#F97316",
                      cur: selectedDetails.nutrition.calories || 0,
                      tgt: targets.calories || 0,
                      hit: evaluateCalorieGoal(goal, selectedDetails.nutrition.calories, targets.calories),
                      unit: "" },
                    { key: "protein", label: "Protein", color: "#3B82F6",
                      cur: selectedDetails.nutrition.protein || 0,
                      tgt: targets.protein || 0,
                      hit: (selectedDetails.nutrition.protein || 0) >= (targets.protein || Infinity),
                      unit: "g" },
                    { key: "carbs", label: "Carbs", color: "#EAB308",
                      cur: selectedDetails.nutrition.carbs || 0,
                      tgt: targets.carbs || 0,
                      hit: (selectedDetails.nutrition.carbs || 0) >= (targets.carbs || Infinity),
                      unit: "g" },
                    { key: "fats", label: "Fats", color: "#A855F7",
                      cur: selectedDetails.nutrition.fats || 0,
                      tgt: targets.fats || 0,
                      hit: (selectedDetails.nutrition.fats || 0) >= (targets.fats || Infinity),
                      unit: "g" }
                  ].map(function(m) {
                    var pct = m.tgt > 0 ? Math.min(100, Math.round((m.cur / m.tgt) * 100)) : 0;
                    var R = 18, C = 2 * Math.PI * R;
                    var dash = (pct / 100) * C;
                    return (
                      <div key={m.key} className={"cal-macro-ring" + (m.hit ? " cal-macro-hit" : "")}>
                        <div className="cal-macro-ring-svg-wrap">
                          <svg viewBox="0 0 44 44" className="cal-macro-ring-svg">
                            <circle cx="22" cy="22" r={R} fill="none" stroke="var(--stat-border)" strokeWidth="4" />
                            <circle cx="22" cy="22" r={R} fill="none"
                              stroke={m.hit ? "var(--green)" : m.color}
                              strokeWidth="4" strokeLinecap="round"
                              strokeDasharray={C}
                              strokeDashoffset={C - dash}
                              transform="rotate(-90 22 22)"
                              style={{ transition: "stroke-dashoffset 280ms ease" }}
                            />
                          </svg>
                          {m.hit && <span className="cal-macro-ring-check">{"\u2713"}</span>}
                        </div>
                        <div className="cal-macro-ring-val mono">
                          {m.cur}<span className="cal-macro-ring-tgt">/{m.tgt}{m.unit}</span>
                        </div>
                        <div className="cal-macro-ring-label">{m.label}</div>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div className="cal-detail-empty">No nutrition data</div>
              )}
            </div>

            {/* Workouts */}
            <div className="cal-detail-section">
              <div className="cal-detail-section-title">
                <span>{"\uD83C\uDFCB\uFE0F"}</span>
                <span>Exercise</span>
                {selectedDetails.workouts.length > 0 && (
                  <span className="cal-detail-check">{"\u2713"}</span>
                )}
              </div>
              {selectedDetails.workouts.length > 0 ? (
                <div className="cal-detail-workouts">
                  {selectedDetails.workouts.map(function(w) {
                    var dur = w.finishedAt && w.startedAt ? Math.round((w.finishedAt - w.startedAt) / 60000) : 0;
                    var completePct = w.totalSets > 0 ? Math.round((w.completedSets / w.totalSets) * 100) : 0;
                    var isOpen = !!expandedWorkouts[w.id];
                    var exs = w.exercises || [];
                    // Unique muscles hit
                    var muscles = Array.from(new Set(exs.map(function(e) { return e.muscle; }).filter(Boolean)));
                    return (
                      <div key={w.id} className={"cal-detail-workout-card" + (isOpen ? " expanded" : "")}>
                        <button
                          className="cal-workout-card-btn"
                          onClick={function() { toggleWorkout(w.id); }}
                        >
                          <div className="cal-detail-workout-top">
                            <span className="cal-detail-workout-title">{w.title || "Workout"}</span>
                            <span className={"cal-detail-workout-pct" + (completePct >= 100 ? " complete" : "")}>{completePct}%</span>
                          </div>
                          <div className="cal-detail-workout-meta">
                            {w.completedSets}/{w.totalSets} sets {"\u00B7"} {dur > 0 ? dur + " min" : "—"} {"\u00B7"} {exs.length} exercise{exs.length !== 1 ? "s" : ""}
                            <span className={"cal-workout-chevron" + (isOpen ? " open" : "")}>{"\u25BE"}</span>
                          </div>
                          {muscles.length > 0 && (
                            <div className="cal-workout-muscles">
                              {muscles.map(function(m) {
                                return <span key={m} className="cal-workout-muscle-pill">{m}</span>;
                              })}
                            </div>
                          )}
                        </button>

                        {isOpen && exs.length > 0 && (
                          <div className="cal-workout-recap fade-in">
                            {exs.map(function(ex) {
                              var doneSets = (ex.sets || []).filter(function(s) { return s.done; });
                              return (
                                <div key={ex.id} className="cal-recap-ex">
                                  <div className="cal-recap-ex-header">
                                    <span className="cal-recap-ex-name">{ex.name}</span>
                                    <span className="cal-recap-ex-count mono">
                                      {doneSets.length}/{(ex.sets || []).length}
                                    </span>
                                  </div>
                                  {doneSets.length > 0 ? (
                                    <div className="cal-recap-sets">
                                      {doneSets.map(function(s, i) {
                                        return (
                                          <span key={i} className="cal-recap-set mono">
                                            {s.reps}{s.weight > 0 ? "\u00D7" + s.weight + "lb" : " reps"}
                                          </span>
                                        );
                                      })}
                                    </div>
                                  ) : (
                                    <div className="cal-recap-sets-empty">No completed sets</div>
                                  )}
                                </div>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div className="cal-detail-empty">No workout logged</div>
              )}
            </div>
          </div>
        )}

        {/* Spacer for nav */}
        <div style={{ height: 20 }} />
      </div>
    );
  }

  Screens.CalendarTab = CalendarTab;

})(window.PhysIQ.Screens, window.PhysIQ.Data, window.PhysIQ.Utils);
