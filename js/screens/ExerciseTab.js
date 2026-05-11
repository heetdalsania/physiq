/* ─── PHYSIQ ENGINE — Exercise Tab (Routine Builder + Workout Tracker) ──── */

import React, { useState } from "react";
import { EXERCISE_CATEGORIES, EXERCISES_BY_CATEGORY } from "../data/constants.js";
import { AppTime } from "../utils/appTime.js";
import { MuscleTracker } from "../components/MuscleTracker.js";
import { RecoveryTracker } from "../components/RecoveryTracker.js";

const CATEGORIES = EXERCISE_CATEGORIES;
const EXERCISES = EXERCISES_BY_CATEGORY;

// Build reverse map: exercise name → category id
const NAME_TO_CAT = {};
Object.keys(EXERCISES).forEach(function(cat) {
  EXERCISES[cat].forEach(function(n) { NAME_TO_CAT[n] = cat; });
});

function categoryLabel(catId) {
  const c = CATEGORIES.find(function(x) { return x.id === catId; });
  return c ? c.label : catId;
}

export function ExerciseTab({ routines, saveRoutine, deleteRoutine, logCompletedWorkout, weeklyMuscles, setTargets, updateSetTarget }) {
  const [view, setView] = useState("main");
  const [draft, setDraft] = useState(null);
  const [picker, setPicker] = useState({ selected: [], category: "chest" });
  const [active, setActive] = useState(null);

  const startNewRoutine = function() {
    setDraft({ id: Date.now(), title: "", exercises: [] });
    setView("create");
  };

  const editRoutine = function(r) {
    setDraft({
      id: r.id,
      title: r.title,
      exercises: r.exercises.map(function(ex) {
        return {
          id: ex.id,
          name: ex.name,
          muscle: ex.muscle,
          sets: ex.sets.map(function(s) { return { reps: s.reps, weight: s.weight }; })
        };
      })
    });
    setView("create");
  };

  const cancelCreate = function() {
    setDraft(null);
    setView("main");
  };

  const openPicker = function() {
    const existing = draft.exercises.map(function(e) { return e.name; });
    setPicker({ selected: existing.slice(), category: "chest" });
    setView("pick");
  };

  const togglePickerItem = function(name) {
    setPicker(function(p) {
      const idx = p.selected.indexOf(name);
      if (idx >= 0) {
        const next = p.selected.slice();
        next.splice(idx, 1);
        return Object.assign({}, p, { selected: next });
      }
      return Object.assign({}, p, { selected: p.selected.concat([name]) });
    });
  };

  const confirmPicker = function() {
    const selected = picker.selected;
    setDraft(function(d) {
      if (!d) return d;
      const existingByName = {};
      d.exercises.forEach(function(e) { existingByName[e.name] = e; });
      const next = selected.map(function(name) {
        if (existingByName[name]) return existingByName[name];
        return {
          id: Date.now() + Math.floor(Math.random() * 1000) + name.length,
          name: name,
          muscle: categoryLabel(NAME_TO_CAT[name] || "other"),
          sets: [{ reps: 10, weight: 0 }, { reps: 10, weight: 0 }, { reps: 10, weight: 0 }]
        };
      });
      return Object.assign({}, d, { exercises: next });
    });
    setView("create");
  };

  const cancelPicker = function() {
    setView("create");
  };

  const setDraftTitle = function(v) {
    setDraft(function(d) { return d ? Object.assign({}, d, { title: v }) : d; });
  };

  const updateSet = function(exIdx, setIdx, field, value) {
    const v = value < 0 ? 0 : value;
    setDraft(function(d) {
      if (!d) return d;
      const exs = d.exercises.slice();
      const ex = Object.assign({}, exs[exIdx]);
      ex.sets = ex.sets.slice();
      ex.sets[setIdx] = Object.assign({}, ex.sets[setIdx]);
      ex.sets[setIdx][field] = v;
      exs[exIdx] = ex;
      return Object.assign({}, d, { exercises: exs });
    });
  };

  const addSetToDraft = function(exIdx) {
    setDraft(function(d) {
      if (!d) return d;
      const exs = d.exercises.slice();
      const ex = Object.assign({}, exs[exIdx]);
      ex.sets = ex.sets.slice();
      const last = ex.sets[ex.sets.length - 1] || { reps: 10, weight: 0 };
      ex.sets.push({ reps: last.reps, weight: last.weight });
      exs[exIdx] = ex;
      return Object.assign({}, d, { exercises: exs });
    });
  };

  const removeSetFromDraft = function(exIdx, setIdx) {
    setDraft(function(d) {
      if (!d) return d;
      const exs = d.exercises.slice();
      const ex = Object.assign({}, exs[exIdx]);
      if (ex.sets.length <= 1) return d;
      ex.sets = ex.sets.slice();
      ex.sets.splice(setIdx, 1);
      exs[exIdx] = ex;
      return Object.assign({}, d, { exercises: exs });
    });
  };

  const removeExerciseFromDraft = function(exIdx) {
    setDraft(function(d) {
      if (!d) return d;
      const exs = d.exercises.slice();
      exs.splice(exIdx, 1);
      return Object.assign({}, d, { exercises: exs });
    });
  };

  const saveDraft = function() {
    if (!draft) return;
    const title = (draft.title || "").trim();
    if (!title) return;
    if (draft.exercises.length === 0) return;
    saveRoutine(Object.assign({}, draft, { title: title }));
    setDraft(null);
    setView("main");
  };

  const startRoutine = function(r) {
    const logs = r.exercises.map(function(ex) {
      return {
        id: ex.id,
        name: ex.name,
        muscle: ex.muscle,
        sets: ex.sets.map(function(s) {
          return { reps: s.reps, weight: s.weight, done: false };
        })
      };
    });
    setActive({ routineId: r.id, title: r.title, startedAt: AppTime.nowMs(), exercises: logs });
    setView("active");
  };

  const updateActiveSet = function(exIdx, setIdx, field, value) {
    const v = value < 0 ? 0 : value;
    setActive(function(a) {
      if (!a) return a;
      const exs = a.exercises.slice();
      const ex = Object.assign({}, exs[exIdx]);
      ex.sets = ex.sets.slice();
      ex.sets[setIdx] = Object.assign({}, ex.sets[setIdx]);
      ex.sets[setIdx][field] = v;
      exs[exIdx] = ex;
      return Object.assign({}, a, { exercises: exs });
    });
  };

  const toggleActiveSetDone = function(exIdx, setIdx) {
    setActive(function(a) {
      if (!a) return a;
      const exs = a.exercises.slice();
      const ex = Object.assign({}, exs[exIdx]);
      ex.sets = ex.sets.slice();
      ex.sets[setIdx] = Object.assign({}, ex.sets[setIdx]);
      ex.sets[setIdx].done = !ex.sets[setIdx].done;
      exs[exIdx] = ex;
      return Object.assign({}, a, { exercises: exs });
    });
  };

  const finishWorkout = function() {
    if (!active) return;
    let completedSets = 0, totalSets = 0;
    active.exercises.forEach(function(ex) {
      ex.sets.forEach(function(s) { totalSets++; if (s.done) completedSets++; });
    });
    if (logCompletedWorkout) {
      logCompletedWorkout({
        id: Date.now(),
        routineId: active.routineId,
        title: active.title,
        startedAt: active.startedAt,
        finishedAt: AppTime.nowMs(),
        completedSets: completedSets,
        totalSets: totalSets,
        exercises: active.exercises
      });
    }
    setActive(null);
    setView("main");
  };

  const cancelWorkout = function() {
    setActive(null);
    setView("main");
  };

  if (view === "main") {
    return (
      <div className="fade-in" style={{ paddingTop: 16 }}>
        <div style={{ fontSize: 24, fontWeight: 700, color: "var(--text-white)", marginBottom: 4, letterSpacing: -0.3 }}>Workouts</div>
        <div style={{ fontSize: 13, color: "var(--text-muted)", marginBottom: 18 }}>
          Build routines and track sessions
        </div>

        <button className="new-routine-btn" onClick={startNewRoutine}>
          <span className="new-routine-plus"><span className="pq-icon pq-icon-plus" aria-hidden="true"></span></span>
          <div style={{ flex: 1, textAlign: "left" }}>
            <div style={{ fontSize: 15, fontWeight: 700, color: "var(--text-white)" }}>New Routine</div>
            <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 2 }}>Build a custom workout</div>
          </div>
          <span className="new-routine-arrow">{"›"}</span>
        </button>

        <div className="label" style={{ marginTop: 24 }}>My Routines</div>
        {routines.length === 0 ? (
          <div className="routines-empty">
            <div className="routines-empty-icon"><span className="pq-icon pq-icon-list" aria-hidden="true"></span></div>
            <div style={{ fontSize: 14, color: "var(--text-muted)" }}>No routines yet</div>
            <div style={{ fontSize: 12, color: "var(--text-faint)", marginTop: 4 }}>Tap "New Routine" to create your first one</div>
          </div>
        ) : (
          <div className="flex-col gap-10">
            {routines.map(function(r) {
              const setCount = r.exercises.reduce(function(a, e) { return a + e.sets.length; }, 0);
              return (
                <div key={r.id} className="routine-card fade-in">
                  <div className="routine-card-header">
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 16, fontWeight: 700, color: "var(--text-white)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {r.title}
                      </div>
                      <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 3, fontWeight: 500 }}>
                        {r.exercises.length} exercise{r.exercises.length !== 1 ? "s" : ""} {"·"} {setCount} set{setCount !== 1 ? "s" : ""}
                      </div>
                    </div>
                    <button className="routine-edit-btn" onClick={function() { editRoutine(r); }} title="Edit">
                      <span className="pq-icon pq-icon-pencil" aria-hidden="true"></span>
                    </button>
                    <button className="routine-delete-btn" onClick={function() { deleteRoutine(r.id); }} title="Delete">
                      <span className="pq-icon pq-icon-plus" aria-hidden="true"></span>
                    </button>
                  </div>
                  <div className="routine-muscles">
                    {Array.from(new Set(r.exercises.map(function(e) { return e.muscle; }))).map(function(m) {
                      return <span key={m} className="routine-muscle-pill">{m}</span>;
                    })}
                  </div>
                  <button className="start-routine-btn" onClick={function() { startRoutine(r); }}>
                    <span style={{ marginRight: 6 }}>{"▶"}</span>
                    Start Routine
                  </button>
                </div>
              );
            })}
          </div>
        )}

        <div style={{ marginTop: 28 }}>
          <MuscleTracker
            weeklyMuscles={weeklyMuscles}
            setTargets={setTargets}
            updateSetTarget={updateSetTarget}
          />
        </div>

        <div style={{ marginTop: 18 }}>
          <RecoveryTracker weeklyMuscles={weeklyMuscles} />
        </div>
      </div>
    );
  }

  if (view === "create" && draft) {
    const titleValid = (draft.title || "").trim().length > 0;
    const canSave = titleValid && draft.exercises.length > 0;
    return (
      <div className="fade-in" style={{ paddingTop: 16 }}>
        <div className="screen-header">
          <button className="screen-back-btn" onClick={cancelCreate}>{"‹"} Back</button>
          <div style={{ flex: 1 }} />
          <button
            className={"screen-primary-btn" + (canSave ? "" : " disabled")}
            disabled={!canSave}
            onClick={saveDraft}
          >
            Save
          </button>
        </div>

        <div style={{ fontSize: 24, fontWeight: 700, color: "var(--text-white)", marginBottom: 14, letterSpacing: -0.3 }}>
          Create Routine
        </div>

        <div className="label">Title</div>
        <input
          type="text"
          className="routine-title-input"
          placeholder="e.g. Push Day, Leg Day"
          value={draft.title}
          maxLength={50}
          onChange={function(e) { setDraftTitle(e.target.value); }}
        />
        {!titleValid && (
          <div style={{ fontSize: 11, color: "var(--text-faint)", marginTop: 6, marginBottom: 12 }}>
            A title is required to save this routine.
          </div>
        )}

        <div className="label" style={{ marginTop: 18 }}>Exercises</div>
        {draft.exercises.length === 0 ? (
          <div className="routines-empty">
            <div style={{ fontSize: 14, color: "var(--text-muted)" }}>No exercises yet</div>
            <div style={{ fontSize: 12, color: "var(--text-faint)", marginTop: 4 }}>Tap "Add Exercise" below</div>
          </div>
        ) : (
          <div className="flex-col gap-10">
            {draft.exercises.map(function(ex, exIdx) {
              return (
                <div key={ex.id} className="draft-ex-card">
                  <div className="draft-ex-header">
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 15, fontWeight: 600, color: "var(--text-white)" }}>{ex.name}</div>
                      <div style={{ fontSize: 12, color: "var(--purple-light)", marginTop: 2, fontWeight: 500 }}>{ex.muscle}</div>
                    </div>
                    <button className="draft-ex-remove" onClick={function() { removeExerciseFromDraft(exIdx); }} title="Remove exercise">
                      {"✕"}
                    </button>
                  </div>

                  <div className="draft-set-header">
                    <span className="draft-set-col-num">Set</span>
                    <span className="draft-set-col-reps">Reps</span>
                    <span className="draft-set-col-weight">Weight</span>
                    <span className="draft-set-col-del" />
                  </div>
                  {ex.sets.map(function(s, si) {
                    return (
                      <div key={si} className="draft-set-row">
                        <span className="draft-set-col-num mono">{si + 1}</span>
                        <div className="draft-set-col-reps">
                          <input
                            type="number"
                            className="draft-set-input mono"
                            min="0"
                            value={s.reps || ""}
                            onChange={function(e) { updateSet(exIdx, si, "reps", parseInt(e.target.value) || 0); }}
                          />
                        </div>
                        <div className="draft-set-col-weight">
                          <input
                            type="number"
                            className="draft-set-input mono"
                            min="0"
                            placeholder="0"
                            value={s.weight || ""}
                            onChange={function(e) { updateSet(exIdx, si, "weight", parseInt(e.target.value) || 0); }}
                          />
                        </div>
                        <div className="draft-set-col-del">
                          {ex.sets.length > 1 && (
                            <button
                              className="draft-set-del"
                              onClick={function() { removeSetFromDraft(exIdx, si); }}
                              title="Remove set"
                            >
                              {"−"}
                            </button>
                          )}
                        </div>
                      </div>
                    );
                  })}
                  <button className="draft-add-set" onClick={function() { addSetToDraft(exIdx); }}>
                    + Add Set
                  </button>
                </div>
              );
            })}
          </div>
        )}

        <button className="add-exercise-btn" onClick={openPicker}>
          + Add Exercise
        </button>
      </div>
    );
  }

  if (view === "pick") {
    const cat = picker.category;
    const list = EXERCISES[cat] || [];
    const count = picker.selected.length;
    return (
      <div className="fade-in" style={{ paddingTop: 16, paddingBottom: 90 }}>
        <div className="screen-header">
          <button className="screen-back-btn" onClick={cancelPicker}>{"‹"} Back</button>
          <div style={{ flex: 1 }} />
          <span className="mono" style={{ fontSize: 12, color: "var(--text-muted)" }}>
            {count} selected
          </span>
        </div>

        <div style={{ fontSize: 24, fontWeight: 700, color: "var(--text-white)", marginBottom: 14, letterSpacing: -0.3 }}>
          Add Exercises
        </div>

        <div className="picker-cat-row">
          {CATEGORIES.map(function(c) {
            return (
              <button
                key={c.id}
                className={"picker-cat-pill" + (cat === c.id ? " active" : "")}
                onClick={function() { setPicker(function(p) { return Object.assign({}, p, { category: c.id }); }); }}
              >
                <span className={"picker-cat-icon pq-icon " + c.iconClass} aria-hidden="true"></span>
                {c.label}
              </button>
            );
          })}
        </div>

        <div className="flex-col gap-6" style={{ marginTop: 14 }}>
          {list.map(function(name) {
            const selected = picker.selected.indexOf(name) >= 0;
            return (
              <button
                key={name}
                className={"picker-item" + (selected ? " selected" : "")}
                onClick={function() { togglePickerItem(name); }}
              >
                <span className="picker-item-name">{name}</span>
                <span className={"picker-item-check" + (selected ? " checked" : "")}>
                  {selected ? "✓" : ""}
                </span>
              </button>
            );
          })}
        </div>

        {count > 0 && (
          <div className="picker-action-bar">
            <button className="picker-confirm-btn" onClick={confirmPicker}>
              Add {count} exercise{count !== 1 ? "s" : ""}
            </button>
          </div>
        )}
      </div>
    );
  }

  if (view === "active" && active) {
    let compSets = 0, totSets = 0;
    active.exercises.forEach(function(ex) {
      ex.sets.forEach(function(s) { totSets++; if (s.done) compSets++; });
    });
    const pct = totSets > 0 ? Math.round(compSets / totSets * 100) : 0;
    return (
      <div className="fade-in" style={{ paddingTop: 16 }}>
        <div className="screen-header">
          <button className="screen-back-btn" onClick={cancelWorkout}>{"‹"} Exit</button>
          <div style={{ flex: 1 }} />
          <button className="screen-primary-btn" onClick={finishWorkout}>
            Finish Workout
          </button>
        </div>

        <div style={{ fontSize: 24, fontWeight: 700, color: "var(--text-white)", marginBottom: 4, letterSpacing: -0.3 }}>
          {active.title}
        </div>
        <div style={{ fontSize: 13, color: "var(--text-muted)", marginBottom: 14, fontWeight: 500 }}>
          {compSets}/{totSets} sets {"·"} {pct}% complete
        </div>

        <div className="workout-active-banner fade-in" style={{ marginBottom: 14 }}>
          <span className="pq-icon pq-icon-dumbbell" aria-hidden="true"></span>
          <span style={{ fontSize: 14, fontWeight: 600, color: "var(--text-white)" }}>Workout in progress</span>
          <span style={{ flex: 1 }} />
          <span className="mono" style={{ fontSize: 12, color: "var(--green)" }}>
            {compSets === totSets && totSets > 0 ? "All sets done!" : pct + "% complete"}
          </span>
        </div>

        <div className="flex-col gap-10">
          {active.exercises.map(function(ex, exIdx) {
            const exDone = ex.sets.length > 0 && ex.sets.every(function(s) { return s.done; });
            return (
              <div key={ex.id} className={"active-ex-card" + (exDone ? " active-ex-done" : "")}>
                <div className="draft-ex-header">
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 15, fontWeight: 600, color: "var(--text-white)" }}>
                      {exDone && <span className="ex-done-icon pq-icon pq-icon-check" aria-hidden="true"></span>}
                      {ex.name}
                    </div>
                    <div style={{ fontSize: 12, color: "var(--purple-light)", marginTop: 2, fontWeight: 500 }}>{ex.muscle}</div>
                  </div>
                </div>

                <div className="draft-set-header">
                  <span className="draft-set-col-num">Set</span>
                  <span className="draft-set-col-reps">Reps</span>
                  <span className="draft-set-col-weight">Weight</span>
                  <span className="draft-set-col-done">Done</span>
                </div>
                {ex.sets.map(function(s, si) {
                  return (
                    <div key={si} className={"draft-set-row" + (s.done ? " set-done" : "")}>
                      <span className="draft-set-col-num mono">{si + 1}</span>
                      <div className="draft-set-col-reps">
                        <input
                          type="number"
                          className="draft-set-input mono"
                          min="0"
                          value={s.reps || ""}
                          onChange={function(e) { updateActiveSet(exIdx, si, "reps", parseInt(e.target.value) || 0); }}
                        />
                      </div>
                      <div className="draft-set-col-weight">
                        <input
                          type="number"
                          className="draft-set-input mono"
                          min="0"
                          placeholder="0"
                          value={s.weight || ""}
                          onChange={function(e) { updateActiveSet(exIdx, si, "weight", parseInt(e.target.value) || 0); }}
                        />
                      </div>
                      <div className="draft-set-col-done">
                        <button
                          className={"set-done-checkbox" + (s.done ? " checked" : "")}
                          onClick={function() { toggleActiveSetDone(exIdx, si); }}
                        >
                          {s.done ? "✓" : ""}
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            );
          })}
        </div>
      </div>
    );
  }

  return null;
}
