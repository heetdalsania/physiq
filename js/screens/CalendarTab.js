/* ─── PHYSIQ ENGINE — Calendar Tab ────────────────────────────────────────── */

import React, { useState, useMemo } from "react";
import { evaluateCalorieGoal, evaluateNutritionDay } from "../utils/calculations.js";
import { AppTime } from "../utils/appTime.js";

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December"
];
const DAY_HEADERS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function dateKey(d) {
  return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
}

function toDateString(d) {
  return d.toDateString();
}

function isSameDay(a, b) {
  return a.getFullYear() === b.getFullYear() &&
         a.getMonth() === b.getMonth() &&
         a.getDate() === b.getDate();
}

function getMonthGrid(year, month) {
  const firstDay = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const grid = [];
  for (let i = 0; i < firstDay; i++) grid.push(null);
  for (let d = 1; d <= daysInMonth; d++) grid.push(d);
  return grid;
}

function getWeekKey(d) {
  const start = new Date(d);
  start.setDate(start.getDate() - start.getDay());
  return dateKey(start);
}

function getDayStatus(dateObj, today, nutritionMap, workoutDaySet, weekWorkoutCounts, targets, gymDays, goal) {
  if (dateObj > today) return "future";

  const dStr = toDateString(dateObj);
  const dKey = dateKey(dateObj);

  const histEntry = nutritionMap[dStr];
  let nutritionMet = false;
  if (histEntry) {
    nutritionMet = evaluateNutritionDay(goal, histEntry, targets);
  }

  const workedOutToday = workoutDaySet.has(dKey);

  const wk = getWeekKey(dateObj);
  const weekCount = weekWorkoutCounts[wk] || 0;
  const exerciseMet = workedOutToday || (weekCount >= gymDays);

  if (nutritionMet && exerciseMet) return "green";
  if (nutritionMet || exerciseMet) return "yellow";

  if (isSameDay(dateObj, today)) return "none";

  return "red";
}

export function CalendarTab({ history, workoutLog, intake, targets, profile, devTick }) {
  // devTick is intentionally unused — bumped by App when Dev Mode date
  // changes so this component re-renders.
  const today = AppTime ? AppTime.now() : new Date();
  const [viewDate, setViewDate] = useState(new Date(today.getFullYear(), today.getMonth(), 1));
  const [selectedDay, setSelectedDay] = useState(null);

  const [expandedWorkouts, setExpandedWorkouts] = useState({});
  const toggleWorkout = function(id) {
    setExpandedWorkouts(function(prev) {
      const next = Object.assign({}, prev);
      if (next[id]) delete next[id]; else next[id] = true;
      return next;
    });
  };

  const viewYear = viewDate.getFullYear();
  const viewMonth = viewDate.getMonth();

  const nutritionMap = useMemo(function() {
    const map = {};
    (history || []).forEach(function(h) {
      map[h.date] = h;
    });
    map[today.toDateString()] = {
      date: today.toDateString(),
      calories: intake.calories,
      protein: intake.protein,
      carbs: intake.carbs,
      fats: intake.fats
    };
    return map;
  }, [history, intake]);

  const workoutDaySet = useMemo(function() {
    const set = new Set();
    (workoutLog || []).forEach(function(s) {
      if (s.finishedAt) {
        const d = new Date(s.finishedAt);
        set.add(dateKey(d));
      }
    });
    return set;
  }, [workoutLog]);

  const weekWorkoutCounts = useMemo(function() {
    const counts = {};
    workoutDaySet.forEach(function(dKey) {
      const parts = dKey.split("-");
      const d = new Date(parseInt(parts[0]), parseInt(parts[1]) - 1, parseInt(parts[2]));
      const wk = getWeekKey(d);
      counts[wk] = (counts[wk] || 0) + 1;
    });
    return counts;
  }, [workoutDaySet]);

  const gymDays = profile.gymDays || 5;
  const goal = profile.goal;

  const grid = useMemo(function() {
    return getMonthGrid(viewYear, viewMonth);
  }, [viewYear, viewMonth]);

  const prevMonth = function() {
    setViewDate(new Date(viewYear, viewMonth - 1, 1));
    setSelectedDay(null);
  };
  const nextMonth = function() {
    setViewDate(new Date(viewYear, viewMonth + 1, 1));
    setSelectedDay(null);
  };
  const goToday = function() {
    setViewDate(new Date(today.getFullYear(), today.getMonth(), 1));
    setSelectedDay(today.getDate());
  };

  const selectedDetails = useMemo(function() {
    if (!selectedDay) return null;
    const d = new Date(viewYear, viewMonth, selectedDay);
    const dStr = toDateString(d);
    const dKey = dateKey(d);
    const status = getDayStatus(d, today, nutritionMap, workoutDaySet, weekWorkoutCounts, targets, gymDays, goal);
    const hist = nutritionMap[dStr] || null;

    const dayWorkouts = (workoutLog || []).filter(function(s) {
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

  const monthStats = useMemo(function() {
    let green = 0, yellow = 0, red = 0, total = 0;
    const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate();
    for (let d = 1; d <= daysInMonth; d++) {
      const dateObj = new Date(viewYear, viewMonth, d);
      if (dateObj > today) break;
      total++;
      const st = getDayStatus(dateObj, today, nutritionMap, workoutDaySet, weekWorkoutCounts, targets, gymDays, goal);
      if (st === "green") green++;
      else if (st === "yellow") yellow++;
      else if (st === "red") red++;
    }
    return { green: green, yellow: yellow, red: red, total: total };
  }, [viewYear, viewMonth, nutritionMap, workoutDaySet, targets]);

  const yearStart = today.getFullYear() - 5;
  const yearEnd = today.getFullYear() + 1;
  const yearOptions = [];
  for (let y = yearStart; y <= yearEnd; y++) yearOptions.push(y);

  const isCurrentMonth = viewYear === today.getFullYear() && viewMonth === today.getMonth();

  return (
    <div className="fade-in" style={{ paddingTop: 16 }}>
      <div className="cal-nav">
        <button className="cal-nav-btn" onClick={prevMonth} aria-label="Previous month">{"‹"}</button>
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
        <button className="cal-nav-btn" onClick={nextMonth} aria-label="Next month">{"›"}</button>
      </div>

      {!isCurrentMonth && (
        <button className="cal-today-btn" onClick={goToday}>
          {"•"} Go to Today
        </button>
      )}

      <div className="cal-grid">
        {DAY_HEADERS.map(function(d) {
          return <div key={d} className="cal-header">{d}</div>;
        })}

        {grid.map(function(day, i) {
          if (day === null) {
            return <div key={"blank-" + i} className="cal-cell cal-blank" />;
          }

          const dateObj = new Date(viewYear, viewMonth, day);
          const isToday = isSameDay(dateObj, today);
          const isSelected = selectedDay === day;
          const status = getDayStatus(dateObj, today, nutritionMap, workoutDaySet, weekWorkoutCounts, targets, gymDays, goal);

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

      {selectedDetails && (
        <div className="cal-detail fade-in">
          <div className="cal-detail-header">
            <div className="cal-detail-date">
              {selectedDetails.date.toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" })}
              {selectedDetails.isToday && <span className="cal-detail-today-badge">Today</span>}
            </div>
            <span className={"cal-detail-status cal-detail-" + selectedDetails.status}>
              {selectedDetails.status === "green" ? "✓ Both Goals" :
               selectedDetails.status === "yellow" ? "∼ One Goal" :
               selectedDetails.status === "red" ? "✗ Missed" :
               selectedDetails.status === "future" ? "Upcoming" : "—"}
            </span>
          </div>

          <div className="cal-detail-section">
            <div className="cal-detail-section-title">
              <span className="cal-detail-title-icon pq-icon pq-icon-food" aria-hidden="true"></span>
              <span>Nutrition</span>
              {selectedDetails.nutrition && evaluateNutritionDay(goal, selectedDetails.nutrition, targets) && (
                <span className="cal-detail-check">{"✓"}</span>
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
                  const pct = m.tgt > 0 ? Math.min(100, Math.round((m.cur / m.tgt) * 100)) : 0;
                  const R = 18, C = 2 * Math.PI * R;
                  const dash = (pct / 100) * C;
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
                        {m.hit && <span className="cal-macro-ring-check">{"✓"}</span>}
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

          <div className="cal-detail-section">
            <div className="cal-detail-section-title">
              <span className="cal-detail-title-icon pq-icon pq-icon-dumbbell" aria-hidden="true"></span>
              <span>Exercise</span>
              {selectedDetails.workouts.length > 0 && (
                <span className="cal-detail-check">{"✓"}</span>
              )}
            </div>
            {selectedDetails.workouts.length > 0 ? (
              <div className="cal-detail-workouts">
                {selectedDetails.workouts.map(function(w) {
                  const dur = w.finishedAt && w.startedAt ? Math.round((w.finishedAt - w.startedAt) / 60000) : 0;
                  const completePct = w.totalSets > 0 ? Math.round((w.completedSets / w.totalSets) * 100) : 0;
                  const isOpen = !!expandedWorkouts[w.id];
                  const exs = w.exercises || [];
                  const muscles = Array.from(new Set(exs.map(function(e) { return e.muscle; }).filter(Boolean)));
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
                          {w.completedSets}/{w.totalSets} sets {"·"} {dur > 0 ? dur + " min" : "—"} {"·"} {exs.length} exercise{exs.length !== 1 ? "s" : ""}
                          <span className={"cal-workout-chevron" + (isOpen ? " open" : "")}>{"▾"}</span>
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
                            const doneSets = (ex.sets || []).filter(function(s) { return s.done; });
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
                                          {s.reps}{s.weight > 0 ? "×" + s.weight + "lb" : " reps"}
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

      <div style={{ height: 20 }} />
    </div>
  );
}
