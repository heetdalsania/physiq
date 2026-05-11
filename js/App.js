/* ─── PHYSIQ ENGINE — Main App Component (entry point) ───────────────────── */

import React, { useState, useEffect, useMemo, useRef } from "react";
import { createRoot } from "react-dom/client";

import {
  GOALS,
  EMPTY_INTAKE,
  DEFAULT_PROFILE,
  EXERCISE_MUSCLE
} from "./data/constants.js";
import { FF_RESTAURANTS } from "./data/fastFoodMenu.js";

import { AppTime } from "./utils/appTime.js";
import {
  loadUser,
  loadDaily,
  loadHistory,
  saveHistory,
  sv,
  loadTheme,
  getLastEmail,
  uKey
} from "./utils/storage.js";
import { calcTargets, getSuggestions } from "./utils/calculations.js";
import { getMealPeriod, MEAL_PERIODS } from "./utils/foodSearch.js";

import { PortionModal } from "./components/PortionModal.js";

import { LoginScreen } from "./screens/LoginScreen.js";
import { OnboardScreen } from "./screens/OnboardScreen.js";
import { DashboardTab } from "./screens/DashboardTab.js";
import { EatsTab } from "./screens/EatsTab.js";
import { HealthTab } from "./screens/HealthTab.js";
import { CalendarTab } from "./screens/CalendarTab.js";
import { ExerciseTab } from "./screens/ExerciseTab.js";
import { ProfileTab } from "./screens/ProfileTab.js";

// ─── Weekly muscle-tracker helpers ──────────────────────────────────────
// Week boundary: Monday 00:00 local time.
function getMondayKey(date) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  const day = d.getDay();
  const offset = day === 0 ? 6 : day - 1;
  d.setDate(d.getDate() - offset);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return y + "-" + m + "-" + dd;
}
function getEmptyWeeklyMuscles() {
  return { weekStart: getMondayKey(AppTime.now()), dates: {}, sessions: {}, sets: {} };
}
function rolloverWeeklyMuscles(raw) {
  const cur = getMondayKey(AppTime.now());
  if (!raw || !raw.weekStart || raw.weekStart !== cur) {
    return { weekStart: cur, dates: {}, sessions: {}, sets: {} };
  }
  return {
    weekStart: raw.weekStart,
    dates: raw.dates || {},
    sessions: raw.sessions || {},
    sets: raw.sets || {}
  };
}
function musclesHitBySession(session) {
  const hit = {};
  if (!session || !session.exercises) return [];
  session.exercises.forEach(function(ex) {
    const anyDone = (ex.sets || []).some(function(s) { return s.done; });
    if (!anyDone) return;
    const m = EXERCISE_MUSCLE[ex.name];
    if (m) hit[m] = true;
  });
  return Object.keys(hit);
}

function App() {
  const [theme, setTheme] = useState(loadTheme);
  const [email, setEmail] = useState("");
  const [screen, setScreen] = useState("loading");
  const [onboardStep, setOnboardStep] = useState(0);

  const [profile, setProfile] = useState(Object.assign({}, DEFAULT_PROFILE));
  const [intake, setIntake] = useState(Object.assign({}, EMPTY_INTAKE));
  const [mealLog, setMealLog] = useState([]);
  const [history, setHistory] = useState([]);

  const [tab, setTab] = useState("dashboard");
  const [addMenuOpen, setAddMenuOpen] = useState(false);
  const [popupType, setPopupType] = useState(null);
  const [mealForm, setMealForm] = useState({ name: "", calories: "", protein: "", carbs: "", fats: "", fiber: "", sugar: "", sodium: "", potassium: "" });

  const [editingBMR, setEditingBMR] = useState(false);
  const [bmrInput, setBmrInput] = useState("");

  const [toast, setToast] = useState(null);
  const [loginEmail, setLoginEmail] = useState(getLastEmail());
  const [editing, setEditing] = useState(false);

  // ── Dev Mode (date override for testing time-based features) ──────
  const [devMode, setDevModeState] = useState(function() { return AppTime.getDevMode(); });
  const [devDate, setDevDateState] = useState(function() { return AppTime.getDevDate(); });

  const toggleDevMode = function() {
    const next = !AppTime.getDevMode();
    AppTime.setDevMode(next);
    setDevModeState(next);
    setDevDateState(AppTime.getDevDate());
  };
  const changeDevDate = function(key) {
    AppTime.setDevDate(key);
    setDevDateState(AppTime.getDevDate());
  };
  const shiftDevDate = function(days) {
    AppTime.shiftDevDate(days);
    setDevDateState(AppTime.getDevDate());
  };

  // Portion modal state
  const [portionItem, setPortionItem] = useState(null);
  const [portionGrams, setPortionGrams] = useState(100);
  const [portionUnit, setPortionUnit] = useState("grams");
  const [portionCount, setPortionCount] = useState(1);

  const [routines, setRoutines] = useState(function() {
    if (!email) return [];
    try {
      return JSON.parse(localStorage.getItem(uKey(email, "routines"))) || [];
    } catch (e) { return []; }
  });

  const [weeklyMuscles, setWeeklyMuscles] = useState(function() {
    if (!email) return getEmptyWeeklyMuscles();
    try {
      const raw = JSON.parse(localStorage.getItem(uKey(email, "weeklyMuscles")));
      return rolloverWeeklyMuscles(raw);
    } catch (e) { return getEmptyWeeklyMuscles(); }
  });

  const [setTargets, setSetTargets] = useState(function() {
    if (!email) return {};
    try { return JSON.parse(localStorage.getItem(uKey(email, "setTargets"))) || {}; } catch (e) { return {}; }
  });

  const updateSetTarget = function(muscleId, value) {
    setSetTargets(function(prev) {
      const next = Object.assign({}, prev);
      if (value == null || isNaN(value)) {
        delete next[muscleId];
      } else {
        next[muscleId] = Math.max(1, Math.min(99, Math.round(value)));
      }
      return next;
    });
  };

  const [workoutLog, setWorkoutLog] = useState(function() {
    if (!email) return [];
    try {
      return JSON.parse(localStorage.getItem(uKey(email, "workoutLog"))) || [];
    } catch (e) { return []; }
  });

  const [activeMealPeriod, setActiveMealPeriod] = useState(getMealPeriod());

  const [recentFoods, setRecentFoods] = useState(function() {
    if (!email) return [];
    try { return JSON.parse(localStorage.getItem(uKey(email, "recentFoods"))) || []; } catch (e) { return []; }
  });

  // Onboarding form state
  const [obName, setObName] = useState("");
  const [obAge, setObAge] = useState("28");
  const [obWeight, setObWeight] = useState("180");
  const [obHeight, setObHeight] = useState("70");
  const [obSex, setObSex] = useState("male");
  const [obBodyfat, setObBodyfat] = useState("18");
  const [obGoal, setObGoal] = useState("build");
  const [obActivity, setObActivity] = useState("moderate");
  const [obSteps, setObSteps] = useState("8000");
  const [obGymDays, setObGymDays] = useState("5");

  const targets = useMemo(function() { return calcTargets(profile, intake); }, [profile, intake.creatine]);
  const suggestions = useMemo(function() { return getSuggestions(profile, targets, intake); }, [profile, targets, intake]);

  useEffect(function() {
    const last = getLastEmail();
    if (last) {
      const p = loadUser(last);
      if (p) {
        setEmail(last);
        setProfile(p);
        const d = loadDaily(last);
        setIntake(d.intake);
        setMealLog(d.meals);
        setHistory(loadHistory(last));
        try { setRoutines(JSON.parse(localStorage.getItem(uKey(last, "routines"))) || []); } catch (e) {}
        try { setWorkoutLog(JSON.parse(localStorage.getItem(uKey(last, "workoutLog"))) || []); } catch (e) {}
        try { setWeeklyMuscles(rolloverWeeklyMuscles(JSON.parse(localStorage.getItem(uKey(last, "weeklyMuscles"))))); } catch (e) { setWeeklyMuscles(getEmptyWeeklyMuscles()); }
        try { setSetTargets(JSON.parse(localStorage.getItem(uKey(last, "setTargets"))) || {}); } catch (e) { setSetTargets({}); }
        setScreen("app");
        return;
      }
    }
    setScreen("login");
  }, []);

  useEffect(function() {
    document.body.setAttribute("data-theme", theme);
    try { localStorage.setItem("pq_theme", theme); } catch (err) {}
  }, [theme]);

  // Persistence effects — all skip writing to localStorage while Dev Mode
  // is on, so dev-session changes are sandboxed in memory and discarded
  // when Dev Mode is turned off.
  useEffect(function() {
    if (screen === "app" && email && !AppTime.getDevMode()) sv(email, "profile", profile);
  }, [profile, screen, email]);

  useEffect(function() {
    if (screen === "app" && email && !AppTime.getDevMode()) sv(email, "intake", intake);
  }, [intake, screen, email]);

  useEffect(function() {
    if (screen === "app" && email && !AppTime.getDevMode()) {
      sv(email, "meals", mealLog);
      try { localStorage.setItem(uKey(email, "date"), AppTime.now().toDateString()); } catch (err) {}
    }
  }, [mealLog, screen, email]);

  useEffect(function() {
    if (screen !== "app" || !email || intake.calories === 0) return;
    const t = AppTime.now().toDateString();
    const h = history.slice();
    const ei = h.findIndex(function(d) { return d.date === t; });
    const sn = { date: t, calories: intake.calories, protein: intake.protein, carbs: intake.carbs, fats: intake.fats, sodium: intake.sodium };
    if (ei >= 0) h[ei] = sn; else h.push(sn);
    if (JSON.stringify(h) !== JSON.stringify(history)) {
      setHistory(h);
      if (!AppTime.getDevMode()) saveHistory(email, h);
    }
  }, [intake, screen, email]);

  useEffect(function() {
    if (screen === "app" && email && !AppTime.getDevMode()) sv(email, "routines", routines);
  }, [routines, screen, email]);

  useEffect(function() {
    if (screen === "app" && email && !AppTime.getDevMode()) sv(email, "workoutLog", workoutLog);
  }, [workoutLog, screen, email]);

  useEffect(function() {
    if (screen === "app" && email && !AppTime.getDevMode()) sv(email, "weeklyMuscles", weeklyMuscles);
  }, [weeklyMuscles, screen, email]);

  useEffect(function() {
    if (screen === "app" && email && !AppTime.getDevMode()) sv(email, "setTargets", setTargets);
  }, [setTargets, screen, email]);

  // Rollover check — cheap guard against users returning after a week
  // without reloading.
  useEffect(function() {
    const cur = getMondayKey(AppTime.now());
    if (weeklyMuscles && weeklyMuscles.weekStart !== cur) {
      setWeeklyMuscles({ weekStart: cur, counts: {}, sessions: {} });
    }
  }, [weeklyMuscles && weeklyMuscles.weekStart]);

  // ── Dev Mode session sandbox ─────────────────────────────────────
  // While Dev Mode is on, intake/meals are scoped to the current app date.
  // Skipping to a new day starts fresh. Skipping back to a day already
  // visited in this session restores what was logged then. Toggling Dev
  // Mode OFF discards everything logged during the session and restores
  // the user's real data exactly as it was.
  const realSnapshotRef = useRef(null);
  const devBufferRef = useRef({});
  const prevDevModeRef = useRef(false);
  const prevDevDateRef = useRef(devDate);

  useEffect(function() {
    if (screen !== "app" || !email) return;
    const prevMode = prevDevModeRef.current;
    const prevDate = prevDevDateRef.current;

    if (!prevMode && devMode) {
      // OFF → ON: snapshot the entire real state.
      realSnapshotRef.current = {
        intake: intake,
        mealLog: mealLog,
        workoutLog: workoutLog,
        weeklyMuscles: weeklyMuscles,
        history: history,
        weightLog: profile.weightLog ? profile.weightLog.slice() : null,
        weight: profile.weight
      };
      devBufferRef.current = {};
      devBufferRef.current[devDate] = { intake: intake, mealLog: mealLog };
    } else if (prevMode && !devMode) {
      // ON → OFF: restore real state. Drop the buffer.
      const snap = realSnapshotRef.current;
      if (snap) {
        setIntake(snap.intake);
        setMealLog(snap.mealLog);
        setWorkoutLog(snap.workoutLog);
        setWeeklyMuscles(snap.weeklyMuscles);
        setHistory(snap.history);
        setProfile(function(p) {
          return Object.assign({}, p, { weightLog: snap.weightLog, weight: snap.weight });
        });
      }
      realSnapshotRef.current = null;
      devBufferRef.current = {};
    } else if (prevMode && devMode && prevDate !== devDate) {
      // Day change within an active dev session.
      devBufferRef.current[prevDate] = { intake: intake, mealLog: mealLog };
      const next = devBufferRef.current[devDate];
      if (next) {
        setIntake(next.intake);
        setMealLog(next.mealLog);
      } else {
        setIntake(Object.assign({}, EMPTY_INTAKE));
        setMealLog([]);
      }
    }

    prevDevModeRef.current = devMode;
    prevDevDateRef.current = devDate;
  }, [devMode, devDate, screen, email]);

  const up = function(k, v) { setProfile(function(p) { return Object.assign({}, p, { [k]: v }); }); };

  // Append-or-replace today's actual weight log entry. We replace the
  // entry for the current app date if one already exists (so users can
  // correct a same-day mistake) but never touch past entries.
  const logWeight = function(lbs) {
    if (typeof lbs !== "number" || lbs <= 0) return;
    const now = AppTime.now();
    const pad = function(n) { return n < 10 ? "0" + n : "" + n; };
    const key = now.getFullYear() + "-" + pad(now.getMonth() + 1) + "-" + pad(now.getDate());
    setProfile(function(p) {
      const prev = Array.isArray(p.weightLog) ? p.weightLog.slice() : [];
      let idx = -1;
      for (let i = 0; i < prev.length; i++) { if (prev[i] && prev[i].date === key) { idx = i; break; } }
      const entry = { date: key, weight: lbs };
      if (idx >= 0) prev[idx] = entry; else prev.push(entry);
      return Object.assign({}, p, { weightLog: prev, weight: lbs });
    });
    showToast("Weight logged");
  };

  const saveRoutine = function(routine) {
    setRoutines(function(prev) {
      const exists = prev.some(function(r) { return r.id === routine.id; });
      if (exists) {
        const updated = prev.map(function(r) { return r.id === routine.id ? routine : r; });
        showToast("Routine updated!");
        return updated;
      }
      showToast("Routine saved!");
      return prev.concat([routine]);
    });
  };

  const deleteRoutine = function(routineId) {
    setRoutines(function(prev) {
      return prev.filter(function(r) { return r.id !== routineId; });
    });
    showToast("Routine deleted");
  };

  const logCompletedWorkout = function(session) {
    setWorkoutLog(function(prev) { return prev.concat([session]); });

    const hitMuscles = musclesHitBySession(session);

    const setsAddByMuscle = {};
    (session.exercises || []).forEach(function(ex) {
      const m = EXERCISE_MUSCLE[ex.name];
      if (!m) return;
      const done = (ex.sets || []).filter(function(s) { return s.done; }).length;
      if (done > 0) setsAddByMuscle[m] = (setsAddByMuscle[m] || 0) + done;
    });

    if (hitMuscles.length > 0 || Object.keys(setsAddByMuscle).length > 0) {
      const dayKey = (function() {
        const d = new Date(session.finishedAt || AppTime.nowMs());
        return d.getFullYear() + "-" +
          String(d.getMonth() + 1).padStart(2, "0") + "-" +
          String(d.getDate()).padStart(2, "0");
      })();
      setWeeklyMuscles(function(prev) {
        const base = rolloverWeeklyMuscles(prev);
        const dates = Object.assign({}, base.dates);
        const sessions = Object.assign({}, base.sessions);
        const sets = Object.assign({}, base.sets);
        hitMuscles.forEach(function(m) {
          const days = (dates[m] || []).slice();
          if (days.indexOf(dayKey) < 0) days.push(dayKey);
          dates[m] = days;
          const sArr = (sessions[m] || []).slice();
          sArr.push({ id: session.id, title: session.title, finishedAt: session.finishedAt });
          sessions[m] = sArr;
        });
        Object.keys(setsAddByMuscle).forEach(function(m) {
          sets[m] = (sets[m] || 0) + setsAddByMuscle[m];
        });
        return { weekStart: base.weekStart, dates: dates, sessions: sessions, sets: sets };
      });
    }

    const label = session.totalSets > 0 && session.completedSets === session.totalSets
      ? "Workout complete!"
      : "Workout saved (" + session.completedSets + "/" + session.totalSets + " sets)";
    showToast(label);
  };

  const logNutrients = function(name, nums, period) {
    const mealPeriod = period || activeMealPeriod || getMealPeriod();
    setMealLog(function(prev) {
      return prev.concat([Object.assign({
        id: Date.now(),
        name: name,
        time: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
        period: mealPeriod
      }, nums)]);
    });
    setIntake(function(prev) {
      const n = Object.assign({}, prev);
      Object.keys(nums).forEach(function(k) { if (k in n) n[k] = (n[k] || 0) + nums[k]; });
      return n;
    });
    setRecentFoods(function(prev) {
      const filtered = prev.filter(function(m) { return m.name !== name; });
      const updated = [Object.assign({ name: name }, nums)].concat(filtered).slice(0, 5);
      if (email) sv(email, "recentFoods", updated);
      return updated;
    });
  };

  const addMeal = function() {
    const nums = {};
    Object.keys(mealForm).forEach(function(k) { if (k !== "name") nums[k] = parseFloat(mealForm[k]) || 0; });
    logNutrients(mealForm.name || "Meal", nums);
    setMealForm({ name: "", calories: "", protein: "", carbs: "", fats: "", fiber: "", sugar: "", sodium: "", potassium: "" });
    showToast((mealForm.name || "Meal") + " logged!");
  };

  const addFF = function(item, chainId) {
    const rName = chainId ? ((FF_RESTAURANTS.find(function(r) { return r.id === chainId; }) || {}).name || "") : "";
    const fullName = rName ? rName + " — " + item.name : item.name;
    logNutrients(
      fullName,
      { calories: item.cal, protein: item.protein, carbs: item.carbs, fats: item.fats, fiber: item.fiber, sugar: item.sugar, sodium: item.sodium, potassium: item.potassium || 0 }
    );
    showToast(item.name + " logged!");
  };

  const addSearchFood = function(item) {
    setPortionItem(item);
    setPortionUnit("servings");
    setPortionCount(1);
    let servGrams = item._servingGrams || 0;
    if (!servGrams && item.serving) {
      const m = item.serving.match(/(\d+\.?\d*)\s*g/i);
      if (m) servGrams = parseFloat(m[1]);
    }
    setPortionGrams(servGrams || 100);
  };

  const confirmPortion = function() {
    if (!portionItem) return;

    let servingGrams = portionItem._servingGrams || 0;
    if (!servingGrams && portionItem.serving) {
      const match = portionItem.serving.match(/(\d+\.?\d*)\s*g/i);
      if (match) servingGrams = parseFloat(match[1]);
    }
    if (!servingGrams) servingGrams = 100;

    let s;
    if (portionUnit === "custom") {
      if (portionItem._perServing) {
        s = servingGrams > 0 ? (portionGrams / servingGrams) : 1;
      } else {
        s = portionGrams / 100;
      }
    } else {
      if (portionItem._perServing) {
        s = portionCount;
      } else {
        s = (portionCount * servingGrams) / 100;
      }
    }

    const nums = {
      calories: Math.round(portionItem.cal * s),
      protein: Math.round(portionItem.protein * s),
      carbs: Math.round(portionItem.carbs * s),
      fats: Math.round(portionItem.fats * s),
      fiber: Math.round(portionItem.fiber * s),
      sugar: Math.round(portionItem.sugar * s),
      sodium: Math.round(portionItem.sodium * s),
      potassium: Math.round(portionItem.potassium * s)
    };

    const suffix = portionUnit === "servings" && portionCount !== 1
      ? " ×" + portionCount
      : "";

    logNutrients(portionItem.name + (portionItem.brand ? " (" + portionItem.brand + ")" : "") + suffix, nums);
    showToast(portionItem.name + " logged!");
    setPortionItem(null);
  };

  const reAddFood = function(meal) {
    logNutrients(meal.name, {
      calories: meal.calories || 0,
      protein: meal.protein || 0,
      carbs: meal.carbs || 0,
      fats: meal.fats || 0,
      fiber: meal.fiber || 0,
      sugar: meal.sugar || 0,
      sodium: meal.sodium || 0,
      potassium: meal.potassium || 0
    });
    showToast(meal.name + " added again!");
  };

  const removeMeal = function(id) {
    const meal = mealLog.find(function(m) { return m.id === id; });
    if (!meal) return;
    setMealLog(function(prev) { return prev.filter(function(m) { return m.id !== id; }); });
    setIntake(function(prev) {
      const n = Object.assign({}, prev);
      ["calories", "protein", "carbs", "fats", "fiber", "sugar", "sodium", "potassium"].forEach(function(k) {
        n[k] = Math.max(0, (n[k] || 0) - (meal[k] || 0));
      });
      return n;
    });
  };

  const moveMealToPeriod = function(mealId, newPeriod) {
    setMealLog(function(prev) {
      return prev.map(function(m) {
        if (m.id === mealId) {
          return Object.assign({}, m, { period: newPeriod });
        }
        return m;
      });
    });
    const periodLabel = (MEAL_PERIODS.find(function(p) { return p.id === newPeriod; }) || {}).label || newPeriod;
    showToast("Moved to " + periodLabel);
  };

  const addWater = function(oz) { setIntake(function(prev) { return Object.assign({}, prev, { water: Math.max(0, prev.water + oz) }); }); };
  const addCreatine = function(g) { setIntake(function(prev) { return Object.assign({}, prev, { creatine: Math.max(0, (prev.creatine || 0) + g) }); }); };

  const showToast = function(msg) {
    setToast(msg);
    setTimeout(function() { setToast(null); }, 1800);
  };

  const resetDay = function() {
    if (!confirm("Reset today's data?")) return;
    setIntake(Object.assign({}, EMPTY_INTAKE));
    setMealLog([]);
    setProfile(function(p) { return Object.assign({}, p, { todayMuscles: [] }); });
  };

  const doLogin = function() {
    if (!loginEmail.trim() || !loginEmail.includes("@")) return;
    const e = loginEmail.trim().toLowerCase();
    localStorage.setItem("pq_last_email", e);
    setEmail(e);
    const p = loadUser(e);
    if (p) {
      setProfile(p);
      const d = loadDaily(e);
      setIntake(d.intake);
      setMealLog(d.meals);
      setHistory(loadHistory(e));
      try { setRoutines(JSON.parse(localStorage.getItem(uKey(e, "routines"))) || []); } catch (err) {}
      try { setWorkoutLog(JSON.parse(localStorage.getItem(uKey(e, "workoutLog"))) || []); } catch (err) {}
      try { setWeeklyMuscles(rolloverWeeklyMuscles(JSON.parse(localStorage.getItem(uKey(e, "weeklyMuscles"))))); } catch (err) { setWeeklyMuscles(getEmptyWeeklyMuscles()); }
      try { setSetTargets(JSON.parse(localStorage.getItem(uKey(e, "setTargets"))) || {}); } catch (err) { setSetTargets({}); }
      setScreen("app");
    } else {
      setScreen("onboard");
      setOnboardStep(0);
    }
  };

  const finishOnboard = function() {
    const p = Object.assign({}, DEFAULT_PROFILE, {
      name: obName,
      age: parseInt(obAge) || 28,
      weight: parseInt(obWeight) || 180,
      height: parseInt(obHeight) || 70,
      sex: obSex,
      bodyfat: parseInt(obBodyfat) || 18,
      goal: obGoal,
      activity: obActivity,
      steps: parseInt(obSteps) || 8000,
      gymDays: parseInt(obGymDays) || 5
    });
    setProfile(p);
    sv(email, "profile", p);
    localStorage.setItem("pq_last_email", email);
    setScreen("app");
  };

  if (screen === "loading") return null;

  if (screen === "login") {
    return <LoginScreen loginEmail={loginEmail} setLoginEmail={setLoginEmail} doLogin={doLogin} />;
  }

  if (screen === "onboard") {
    return (
      <OnboardScreen
        onboardStep={onboardStep} setOnboardStep={setOnboardStep}
        obName={obName} setObName={setObName}
        obAge={obAge} setObAge={setObAge}
        obWeight={obWeight} setObWeight={setObWeight}
        obHeight={obHeight} setObHeight={setObHeight}
        obSex={obSex} setObSex={setObSex}
        obBodyfat={obBodyfat} setObBodyfat={setObBodyfat}
        obGoal={obGoal} setObGoal={setObGoal}
        obActivity={obActivity} setObActivity={setObActivity}
        obSteps={obSteps} setObSteps={setObSteps}
        obGymDays={obGymDays} setObGymDays={setObGymDays}
        finishOnboard={finishOnboard}
      />
    );
  }

  let devDateLabel;
  try {
    const p = devDate.split("-");
    const d = new Date(parseInt(p[0]), parseInt(p[1]) - 1, parseInt(p[2]));
    devDateLabel = d.toLocaleDateString([], { weekday: "short", month: "short", day: "numeric", year: "numeric" });
  } catch (e) { devDateLabel = devDate; }

  return (
    <React.Fragment>
      {devMode && (
        <div className="dev-banner" onClick={function() { setTab("dashboard"); }}>
          <span className="dev-banner-dot" />
          <span className="dev-banner-text">DEV MODE ACTIVE — {devDateLabel}</span>
        </div>
      )}

      {toast && <div className="added-toast"><span className="toast-mark pq-icon pq-icon-check" aria-hidden="true"></span> {toast}</div>}

      <PortionModal
        portionItem={portionItem} setPortionItem={setPortionItem}
        portionGrams={portionGrams} setPortionGrams={setPortionGrams}
        portionUnit={portionUnit} setPortionUnit={setPortionUnit}
        portionCount={portionCount} setPortionCount={setPortionCount}
        confirmPortion={confirmPortion}
      />

      <div className="app-header" style={{ padding: "20px 20px 16px", background: "linear-gradient(180deg,var(--bg-header) 0%,transparent 100%)" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
          <div className="mono" style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: 2.5, color: "var(--blue)" }}>PHYSIQ ENGINE</div>
          <div className="flex-row" style={{ gap: 8 }}>
            <span className={"theme-indicator pq-icon " + (theme === "dark" ? "pq-icon-moon" : "pq-icon-sun")} aria-hidden="true"></span>
            <button className="theme-toggle" onClick={function() { setTheme(function(t) { return t === "dark" ? "light" : "dark"; }); }} />
          </div>
        </div>
        <div className="app-mode-title" style={{ fontSize: 24, fontWeight: 700, color: "var(--text-white)", lineHeight: 1.2, letterSpacing: -0.3 }}>
          <span className={"app-mode-icon pq-icon " + ((GOALS.find(function(g) { return g.id === profile.goal; }) || {}).iconClass || "pq-icon-goal-flat")} aria-hidden="true"></span>
          {(GOALS.find(function(g) { return g.id === profile.goal; }) || {}).label} Mode
        </div>
        <div style={{ fontSize: 13, color: "var(--text-muted)", marginTop: 4, fontWeight: 500, letterSpacing: 0.2 }}>
          {targets.tdee} TDEE {"·"} {targets.leanMass}lb lean {"·"} {profile.steps.toLocaleString()} steps
          {targets.isOverridden && <span className="bmr-override-badge">{"·"} BMR Override</span>}
        </div>
      </div>

      <div className="app-content" style={{ padding: "0 16px" }}>
        {tab === "dashboard" && (
          <DashboardTab
            intake={intake} targets={targets} profile={profile}
            suggestions={suggestions} mealLog={mealLog}
            addWater={addWater} addCreatine={addCreatine} removeMeal={removeMeal} resetDay={resetDay}
            onQuickNav={function(tabId) { setTab(tabId); setAddMenuOpen(false); setPopupType(null); }}
            devMode={devMode} devDate={devDate}
            toggleDevMode={toggleDevMode} changeDevDate={changeDevDate} shiftDevDate={shiftDevDate}
          />
        )}

        {tab === "eats" && (
          <EatsTab
            intake={intake} targets={targets}
            mealLog={mealLog}
            addSearchFood={addSearchFood}
            addFF={addFF}
            mealForm={mealForm} setMealForm={setMealForm} addMeal={addMeal}
            removeMeal={removeMeal}
            moveMealToPeriod={moveMealToPeriod}
            activeMealPeriod={activeMealPeriod}
            setActiveMealPeriod={setActiveMealPeriod}
            reAddFood={reAddFood}
            recentFoods={recentFoods}
          />
        )}

        {tab === "health" && (
          <HealthTab
            profile={profile} targets={targets}
            up={up} workoutLog={workoutLog}
          />
        )}

        {tab === "calendar" && (
          <CalendarTab
            history={history}
            workoutLog={workoutLog}
            intake={intake}
            targets={targets}
            profile={profile}
            devTick={devMode + "|" + devDate}
          />
        )}

        {tab === "exercise" && (
          <ExerciseTab
            routines={routines}
            saveRoutine={saveRoutine}
            deleteRoutine={deleteRoutine}
            logCompletedWorkout={logCompletedWorkout}
            weeklyMuscles={weeklyMuscles}
            setTargets={setTargets}
            updateSetTarget={updateSetTarget}
          />
        )}

        {tab === "profile" && (
          <ProfileTab
            profile={profile} targets={targets} email={email} history={history}
            up={up} logWeight={logWeight}
            editingBMR={editingBMR} setEditingBMR={setEditingBMR}
            bmrInput={bmrInput} setBmrInput={setBmrInput}
            editing={editing} setEditing={setEditing}
            theme={theme} setTheme={setTheme}
            setScreen={setScreen} setEmail={setEmail} setLoginEmail={setLoginEmail}
          />
        )}
      </div>

      <div className="nav">
        {[
          { id: "dashboard", label: "Dashboard", iconClass: "pq-icon-home" },
          { id: "health",    label: "Health",    iconClass: "pq-icon-health" },
          { id: "__add",     label: "",          iconClass: "pq-icon-plus" },
          { id: "calendar",  label: "Calendar",  iconClass: "pq-icon-calendar" },
          { id: "profile",   label: "Profile",   iconClass: "pq-icon-user" }
        ].map(function(t) {
          if (t.id === "__add") {
            const addActive = tab === "eats" || tab === "exercise" || addMenuOpen;
            return (
              <button
                key="__add"
                className={"nav-btn nav-add-btn" + (addActive ? " active" : "")}
                onClick={function() {
                  if (addMenuOpen && !popupType) {
                    setAddMenuOpen(false);
                  } else {
                    setPopupType(null);
                    setAddMenuOpen(true);
                  }
                }}
                aria-label="Open quick menu"
              >
                <span className="nav-add-circle"><span className={"pq-icon " + t.iconClass} aria-hidden="true"></span></span>
              </button>
            );
          }
          return (
            <button key={t.id} className={"nav-btn" + (tab === t.id && !addMenuOpen && !popupType ? " active" : "")} onClick={function() { setTab(t.id); setAddMenuOpen(false); setPopupType(null); }}>
              <span className={"nav-icon pq-icon " + t.iconClass} aria-hidden="true"></span>
              <span>{t.label}</span>
            </button>
          );
        })}
      </div>

      {addMenuOpen && !popupType && (
        <div className="add-menu-backdrop" onClick={function() { setAddMenuOpen(false); }}>
          <div className="add-menu-sheet" onClick={function(e) { e.stopPropagation(); }}>
            <div className="add-menu-handle" />
            <div className="add-menu-title">Quick Access</div>
            <div className="add-menu-cards">
              <button
                className="add-menu-card eats-card"
                onClick={function() { setPopupType("eats"); }}
              >
                <div className="add-menu-card-icon"><span className="pq-icon pq-icon-food" aria-hidden="true"></span></div>
                <div className="add-menu-card-label">Eats</div>
                <div className="add-menu-card-sub">Log food & nutrition</div>
              </button>
              <button
                className="add-menu-card exercise-card"
                onClick={function() { setPopupType("exercise"); }}
              >
                <div className="add-menu-card-icon"><span className="pq-icon pq-icon-dumbbell" aria-hidden="true"></span></div>
                <div className="add-menu-card-label">Exercise</div>
                <div className="add-menu-card-sub">Routines & workouts</div>
              </button>
            </div>
          </div>
        </div>
      )}

      {popupType === "eats" && (
        <div className="popup-overlay">
          <div className="popup-header">
            <button className="popup-close-btn" onClick={function() { setPopupType(null); setAddMenuOpen(false); }} aria-label="Close">{"×"}</button>
            <div className="popup-header-title">Log Food</div>
            <span className="popup-header-icon"><span className="pq-icon pq-icon-food" aria-hidden="true"></span></span>
          </div>
          <div className="popup-content">
            <EatsTab
              intake={intake} targets={targets}
              mealLog={mealLog}
              addSearchFood={addSearchFood}
              addFF={addFF}
              mealForm={mealForm} setMealForm={setMealForm} addMeal={addMeal}
              removeMeal={removeMeal}
              moveMealToPeriod={moveMealToPeriod}
              activeMealPeriod={activeMealPeriod}
              setActiveMealPeriod={setActiveMealPeriod}
              reAddFood={reAddFood}
              recentFoods={recentFoods}
            />
          </div>
          <PortionModal
            portionItem={portionItem} setPortionItem={setPortionItem}
            portionGrams={portionGrams} setPortionGrams={setPortionGrams}
            portionUnit={portionUnit} setPortionUnit={setPortionUnit}
            portionCount={portionCount} setPortionCount={setPortionCount}
            confirmPortion={confirmPortion}
          />
        </div>
      )}

      {popupType === "exercise" && (
        <div className="popup-overlay">
          <div className="popup-header">
            <button className="popup-close-btn" onClick={function() { setPopupType(null); setAddMenuOpen(false); }} aria-label="Close">{"×"}</button>
            <div className="popup-header-title">Exercise</div>
            <span className="popup-header-icon"><span className="pq-icon pq-icon-dumbbell" aria-hidden="true"></span></span>
          </div>
          <div className="popup-content">
            <ExerciseTab
              routines={routines}
              saveRoutine={saveRoutine}
              deleteRoutine={deleteRoutine}
              logCompletedWorkout={logCompletedWorkout}
              weeklyMuscles={weeklyMuscles}
              setTargets={setTargets}
              updateSetTarget={updateSetTarget}
            />
          </div>
        </div>
      )}
    </React.Fragment>
  );
}

createRoot(document.getElementById("app")).render(<App />);
