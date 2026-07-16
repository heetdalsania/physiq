/* ─── PHYSIQ ENGINE — Weekly Report Aggregation ───────────────────────────
 *
 * Pure data layer for the Weekly Report screen. No React, no storage —
 * callers pass the loaded state in and get a serializable report back.
 *
 * Conventions:
 *   - Week = Monday 00:00 local → Sunday, matching the weekly muscle
 *     tracker (getMondayKey in App.js).
 *   - Phase: build/lean → "bulk", cut/debloat → "cut", else "maintain".
 *     A day is "on target" relative to the phase via evaluateCalorieGoal
 *     (bulk: ≥ target, cut: 0 < actual ≤ target, maintain: ±300).
 *   - A day with no history entry (or 0 logged calories) is "no data":
 *     it is neither a hit nor a miss and is excluded from averages.
 *   - Past weeks are judged against the CURRENT targets (targets are not
 *     snapshotted historically — accepted v1 limitation).
 * ───────────────────────────────────────────────────────────────────────── */

import { evaluateCalorieGoal } from "./calculations.js";
import {
  MUSCLE_GROUPS,
  WEEKLY_SET_TARGETS,
  DEFAULT_WEEKLY_SET_TARGET,
  EXERCISE_MUSCLE,
  EXERCISES_BY_CATEGORY
} from "../data/constants.js";
import { getWeeklyProgression, countMoved } from "./progression.js";
import { buildActualSeries, CALORIES_PER_LB } from "./weightProjection.js";

const DAY_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const WEEKDAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const MACROS = [
  { id: "protein", label: "Protein" },
  { id: "carbs",   label: "Carbs" },
  { id: "fats",    label: "Fats" }
];

// ── Week boundaries ─────────────────────────────────────────────────────

export function dayKey(d) {
  return d.getFullYear() + "-" +
    String(d.getMonth() + 1).padStart(2, "0") + "-" +
    String(d.getDate()).padStart(2, "0");
}

// Monday 00:00 local time of the week containing `date`.
export function getWeekStart(date) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  const day = d.getDay();
  d.setDate(d.getDate() - (day === 0 ? 6 : day - 1));
  return d;
}

// The week the report opens to: on Sunday the current (closing) week,
// any other day the most recent completed Mon–Sun week.
export function getReportWeekStart(now) {
  const cur = getWeekStart(now);
  if (now.getDay() === 0) return cur;
  cur.setDate(cur.getDate() - 7);
  return cur;
}

export function getWeekDays(weekStart) {
  const days = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(weekStart);
    d.setDate(d.getDate() + i);
    days.push(d);
  }
  return days;
}

export function getPhase(goal) {
  if (goal === "build" || goal === "lean") return "bulk";
  if (goal === "cut" || goal === "debloat") return "cut";
  return "maintain";
}

// ── Nutrition ───────────────────────────────────────────────────────────

function macroLevel(hits) {
  if (hits >= 6) return "success";
  if (hits >= 4) return "warning";
  return "miss";
}

export function aggregateNutrition(history, targets, goal, weekStart) {
  const byDateString = {};
  (history || []).forEach(function(h) {
    if (h && h.date) byDateString[h.date] = h;
  });

  const days = getWeekDays(weekStart).map(function(d, i) {
    const entry = byDateString[d.toDateString()];
    const logged = !!entry && (entry.calories || 0) > 0;
    const calories = logged ? entry.calories : null;
    const delta = logged ? calories - targets.calories : null;
    const macrosMissed = [];
    if (logged) {
      MACROS.forEach(function(m) {
        const tgt = targets[m.id];
        if (typeof tgt === "number" && tgt > 0 && (entry[m.id] || 0) < tgt) {
          macrosMissed.push(m.id);
        }
      });
    }
    return {
      key: dayKey(d),
      label: DAY_LABELS[i],
      logged: logged,
      calories: calories,
      delta: delta,
      hit: logged ? evaluateCalorieGoal(goal, calories, targets.calories) : false,
      macrosMissed: macrosMissed
    };
  });

  const loggedDays = days.filter(function(d) { return d.logged; });
  const caloriesHit = days.filter(function(d) { return d.hit; }).length;
  const avgDelta = loggedDays.length
    ? Math.round(loggedDays.reduce(function(a, d) { return a + d.delta; }, 0) / loggedDays.length)
    : null;

  const macros = MACROS.map(function(m) {
    const hits = loggedDays.filter(function(d) { return d.macrosMissed.indexOf(m.id) < 0; }).length;
    return { id: m.id, label: m.label, target: targets[m.id], hits: hits, level: macroLevel(hits) };
  });

  return {
    days: days,
    loggedCount: loggedDays.length,
    caloriesHit: caloriesHit,
    calorieTarget: targets.calories,
    avgDelta: avgDelta,
    macros: macros
  };
}

// ── Training ────────────────────────────────────────────────────────────

function targetFor(muscleId, setTargets) {
  if (setTargets && typeof setTargets[muscleId] === "number") return setTargets[muscleId];
  return WEEKLY_SET_TARGETS[muscleId] || DEFAULT_WEEKLY_SET_TARGET;
}

export function aggregateTraining(workoutLog, routines, setTargets, weekStart) {
  const weekKeys = {};
  getWeekDays(weekStart).forEach(function(d) { weekKeys[dayKey(d)] = true; });

  const sessions = (workoutLog || []).filter(function(s) {
    return s && s.finishedAt && weekKeys[dayKey(new Date(s.finishedAt))];
  }).sort(function(a, b) { return a.finishedAt - b.finishedAt; });

  const setsByMuscle = {};
  const exercisesByMuscle = {};
  const lastDayByMuscle = {};
  const workoutDayKeys = {};
  sessions.forEach(function(session) {
    const dk = dayKey(new Date(session.finishedAt));
    workoutDayKeys[dk] = true;
    (session.exercises || []).forEach(function(ex) {
      const muscle = EXERCISE_MUSCLE[ex.name];
      if (!muscle || muscle === "cardio") return;
      const done = (ex.sets || []).filter(function(s) { return s && s.done; }).length;
      if (done > 0) {
        setsByMuscle[muscle] = (setsByMuscle[muscle] || 0) + done;
        if (!exercisesByMuscle[muscle]) exercisesByMuscle[muscle] = {};
        exercisesByMuscle[muscle][ex.name] = (exercisesByMuscle[muscle][ex.name] || 0) + done;
        lastDayByMuscle[muscle] = WEEKDAY_NAMES[new Date(session.finishedAt).getDay()];
      }
    });
  });

  // Rows cover the muscles the user's plan cares about: anything in their
  // saved routines, anything with a custom set target, and anything
  // actually trained this week. (All 10 groups would punish muscles the
  // user never programs.)
  const include = {};
  (routines || []).forEach(function(r) {
    (r.exercises || []).forEach(function(ex) {
      const m = EXERCISE_MUSCLE[ex.name];
      if (m && m !== "cardio") include[m] = true;
    });
  });
  Object.keys(setTargets || {}).forEach(function(m) { if (m !== "cardio") include[m] = true; });
  Object.keys(setsByMuscle).forEach(function(m) { include[m] = true; });

  const rows = MUSCLE_GROUPS.filter(function(g) { return include[g.id]; }).map(function(g) {
    const done = setsByMuscle[g.id] || 0;
    const target = targetFor(g.id, setTargets);
    const breakdown = exercisesByMuscle[g.id] || {};
    const exercises = Object.keys(breakdown).map(function(name) {
      return { name: name, sets: breakdown[name] };
    }).sort(function(a, b) {
      if (a.sets !== b.sets) return b.sets - a.sets;
      return a.name < b.name ? -1 : 1;
    });
    return { id: g.id, label: g.label, done: done, target: target, hit: done >= target, exercises: exercises };
  });

  // Groups outside the user's plan — shown as a muted footer, not counted.
  const notProgrammed = MUSCLE_GROUPS.filter(function(g) { return !include[g.id]; })
    .map(function(g) { return g.label; });

  return {
    sessions: sessions,
    workoutDayKeys: workoutDayKeys,
    rows: rows,
    notProgrammed: notProgrammed,
    hitCount: rows.filter(function(r) { return r.hit; }).length,
    totalSets: Object.keys(setsByMuscle).reduce(function(a, m) { return a + setsByMuscle[m]; }, 0),
    lastDayByMuscle: lastDayByMuscle
  };
}

// Total completed sets per week (non-cardio) across the whole log, keyed
// by the week's Monday dayKey. Used for "best volume week".
export function weeklySetTotals(workoutLog) {
  const totals = {};
  (workoutLog || []).forEach(function(session) {
    if (!session || !session.finishedAt) return;
    let sets = 0;
    (session.exercises || []).forEach(function(ex) {
      const muscle = EXERCISE_MUSCLE[ex.name];
      if (!muscle || muscle === "cardio") return;
      sets += (ex.sets || []).filter(function(s) { return s && s.done; }).length;
    });
    if (sets === 0) return;
    const wk = dayKey(getWeekStart(new Date(session.finishedAt)));
    totals[wk] = (totals[wk] || 0) + sets;
  });
  return totals;
}

// ── Weight trend ────────────────────────────────────────────────────────

function parseDayKey(k) {
  const p = String(k).split("-");
  return new Date(parseInt(p[0], 10), parseInt(p[1], 10) - 1, parseInt(p[2], 10));
}

// Actual weekly weight change vs the phase's expected rate (from the
// calorie surplus/deficit). Needs a weight entry in the report week plus
// an older baseline; prefers a 2–3-week window when one exists, because
// single-week deltas are mostly water. Never blocks the report — callers
// get { available: false } and show an unlock hint instead.
export function buildWeightTrend(weightLog, targets, goal, weekStart) {
  const weekEndKey = dayKey(getWeekDays(weekStart)[6]);
  const weekStartKey = dayKey(weekStart);
  const series = buildActualSeries(weightLog).filter(function(e) {
    return String(e.date) <= weekEndKey;
  });
  if (series.length < 2) return { available: false, reason: "not-enough-entries" };

  const current = series[series.length - 1];
  if (String(current.date) < weekStartKey) {
    return { available: false, reason: "no-entry-this-week" };
  }

  const currentTime = parseDayKey(current.date).getTime();
  const olderThan = function(days) {
    const cut = currentTime - days * 86400000;
    let found = null;
    series.forEach(function(e) {
      if (parseDayKey(e.date).getTime() <= cut) found = e; // last qualifying wins
    });
    return found;
  };
  // 2–3-week trend when history allows, else roughly a week, else give up.
  const baseline = olderThan(14) || olderThan(5);
  if (!baseline) return { available: false, reason: "no-baseline" };

  const spanDays = Math.round((currentTime - parseDayKey(baseline.date).getTime()) / 86400000);
  const deltaLbs = Math.round((current.weight - baseline.weight) * 10) / 10;
  const weeklyRate = Math.round(deltaLbs / spanDays * 7 * 10) / 10;
  const expectedRate = Math.round((targets.surplus || 0) * 7 / CALORIES_PER_LB * 10) / 10;

  const tol = Math.max(0.35, Math.abs(expectedRate) * 0.35);
  let status;
  if (Math.abs(weeklyRate - expectedRate) <= tol) status = "on-pace";
  else if (expectedRate < 0) status = weeklyRate < expectedRate ? "ahead" : "behind";
  else if (expectedRate > 0) status = weeklyRate > expectedRate ? "ahead" : "behind";
  else status = "behind"; // maintain, drifting either way

  const phase = getPhase(goal);
  const fmtRate = function(r) { return (r > 0 ? "+" : "") + r.toFixed(1); };
  const lead = Math.abs(weeklyRate) < 0.05
    ? "Weight holding flat"
    : (weeklyRate < 0 ? "Down " : "Up ") + Math.abs(weeklyRate).toFixed(1) + " lb/week";

  let paceText;
  if (phase === "maintain") {
    paceText = status === "on-pace"
      ? "Holding steady — exactly what maintenance wants."
      : "Drifting " + (weeklyRate > 0 ? "up" : "down") + " — maintenance targets no change.";
  } else if (status === "on-pace") {
    paceText = "Right on your " + phase + " pace (" + fmtRate(expectedRate) + " lb/wk).";
  } else if (status === "ahead") {
    paceText = "Ahead of your " + phase + " pace (" + fmtRate(expectedRate) + " lb/wk).";
  } else if ((expectedRate < 0 && weeklyRate > 0) || (expectedRate > 0 && weeklyRate < 0)) {
    paceText = "Moving against your " + phase + " — check the calorie card.";
  } else {
    paceText = "Behind your " + phase + " pace (" + fmtRate(expectedRate) + " lb/wk).";
  }

  return {
    available: true,
    current: current,
    baseline: baseline,
    deltaLbs: deltaLbs,
    weeklyRate: weeklyRate,
    expectedRate: expectedRate,
    spanDays: spanDays,
    status: status,
    lead: lead,
    paceText: paceText
  };
}

// ── Adaptive target adjustment ──────────────────────────────────────────

export const ADJUSTMENT_STEP = 150;      // kcal per suggestion
export const ADJUSTMENT_CAP = 300;       // max cumulative |adjustment|
export const ADJUSTMENT_COOLDOWN_DAYS = 14;

// Offer a one-tap calorie tweak when the weight trend is off pace.
// Guardrails, in order: trend must exist, must span ≥12 days (never react
// to a single noisy week), status must be "behind" (ahead of pace is not
// a problem), and the last applied adjustment must be ≥14 days old so
// repeated bumps can't compound week over week. Hitting the ±300 cap
// returns a "review" suggestion (check activity level / BMR) instead of
// another bump.
export function buildAdjustmentSuggestion(trend, phase, currentAdjustment, lastAdjustedAt, todayKey) {
  if (!trend || !trend.available) return null;
  if (trend.spanDays < 12) return null;
  if (trend.status !== "behind") return null;

  if (lastAdjustedAt) {
    const elapsed = Math.round(
      (parseDayKey(todayKey).getTime() - parseDayKey(lastAdjustedAt).getTime()) / 86400000
    );
    if (elapsed < ADJUSTMENT_COOLDOWN_DAYS) return null;
  }

  let delta;
  if (phase === "bulk") delta = ADJUSTMENT_STEP;
  else if (phase === "cut") delta = -ADJUSTMENT_STEP;
  else delta = trend.weeklyRate > 0 ? -ADJUSTMENT_STEP : ADJUSTMENT_STEP; // maintain drift

  const current = currentAdjustment || 0;
  const next = current + delta;
  if (Math.abs(next) > ADJUSTMENT_CAP) {
    return {
      type: "review",
      reason: trend.paceText,
      text: "You're already at the " + (current > 0 ? "+" : "") + current +
        " kcal adjustment cap. If the trend still isn't moving, your activity level or BMR is probably off — review those in Health/Profile."
    };
  }

  const verb = delta > 0 ? "Add" : "Cut";
  return {
    type: "adjust",
    delta: delta,
    next: next,
    reason: trend.paceText,
    text: verb + " " + Math.abs(delta) + " kcal/day to get back on pace?" +
      (current !== 0 ? " (Total adjustment would be " + (next > 0 ? "+" : "") + next + " kcal.)" : "")
  };
}

// ── Win of the Week ─────────────────────────────────────────────────────

// Best progression: weight events beat rep events, then largest jump,
// then lift name for a stable tie-break.
function pickBestEvent(moved) {
  return moved.slice().sort(function(a, b) {
    if (a.type !== b.type) return a.type === "weight" ? -1 : 1;
    const da = a.to - a.from, db = b.to - b.from;
    if (da !== db) return db - da;
    return a.lift < b.lift ? -1 : 1;
  })[0] || null;
}

export function selectWinOfWeek(progressionEvents, training, nutrition, workoutLog, weekStart) {
  const moved = (progressionEvents || []).filter(function(e) {
    return e.type === "weight" || e.type === "reps";
  });

  // 1. First progression on a previously stalled lift.
  const stallBreaks = moved.filter(function(e) { return e.wasStalled; });
  if (stallBreaks.length > 0) {
    return { type: "stall-break", event: pickBestEvent(stallBreaks) };
  }

  // 2. Any weight/rep progression.
  if (moved.length > 0) {
    return { type: "progression", event: pickBestEvent(moved) };
  }

  // 3. Best volume week ever (needs at least one prior week to beat).
  const totals = weeklySetTotals(workoutLog);
  const thisKey = dayKey(weekStart);
  const thisTotal = totals[thisKey] || 0;
  const prevTotals = Object.keys(totals).filter(function(k) { return k < thisKey; })
    .map(function(k) { return totals[k]; });
  if (thisTotal > 0 && prevTotals.length > 0 && thisTotal > Math.max.apply(null, prevTotals)) {
    return { type: "volume", sets: thisTotal, prevBest: Math.max.apply(null, prevTotals) };
  }

  // 4. Best calorie-adherence streak in the week (3+ consecutive days).
  let streak = 0, best = 0;
  (nutrition.days || []).forEach(function(d) {
    streak = d.hit ? streak + 1 : 0;
    if (streak > best) best = streak;
  });
  if (best >= 3) return { type: "streak", days: best };

  return null;
}

// ── Nudges ──────────────────────────────────────────────────────────────

const MACRO_TRAINING_ADVICE = {
  protein: "Add a post-workout protein shake on lifting days.",
  carbs: "Add a carb source to your pre-workout meal.",
  fats: "Add nuts or olive oil to meals on training days."
};
const MACRO_GENERIC_ADVICE = {
  protein: "Front-load protein at breakfast.",
  carbs: "Plan a carb source into lunch and dinner.",
  fats: "Add an easy fat source like eggs, nuts, or olive oil."
};

export function buildNutritionNudge(nutrition, workoutDayKeys, phase) {
  if (nutrition.loggedCount === 0) {
    return { type: "no-data", text: "No meals logged this week. Log your meals — even rough estimates — and next week's report gets real insights." };
  }

  const allMacrosGood = nutrition.macros.every(function(m) { return m.hits >= 6; });
  if (nutrition.caloriesHit === 7 && allMacrosGood) {
    return { type: "repeat", text: "On target across the board. Change nothing — run the same week back." };
  }

  // Pattern: a macro repeatedly missed on training days.
  for (let i = 0; i < nutrition.macros.length; i++) {
    const m = nutrition.macros[i];
    const missedDays = nutrition.days.filter(function(d) {
      return d.logged && d.macrosMissed.indexOf(m.id) >= 0;
    });
    const onTraining = missedDays.filter(function(d) { return workoutDayKeys[d.key]; });
    if (missedDays.length >= 2 && onTraining.length >= 2) {
      const which = onTraining.length === missedDays.length
        ? (missedDays.length === 2 ? "both" : "all") : String(onTraining.length);
      return {
        type: "macro-training",
        macroId: m.id,
        text: m.label + " missed on " + missedDays.length + " days — " + which + " were training days. " + MACRO_TRAINING_ADVICE[m.id]
      };
    }
  }

  // Pattern: calories drift on the weekend.
  const weekend = nutrition.days.filter(function(d) {
    return (d.label === "Sat" || d.label === "Sun") && d.logged && !d.hit;
  });
  if (weekend.length === 2) {
    return { type: "weekend", text: "Calories slipped on both weekend days. Plan Saturday and Sunday meals in advance." };
  }

  // Worst macro, if any macro is off.
  const worst = nutrition.macros.slice().sort(function(a, b) { return a.hits - b.hits; })[0];
  if (worst && worst.level !== "success") {
    return {
      type: "macro",
      macroId: worst.id,
      text: worst.label + " landed " + worst.hits + "/7 against " + worst.target + "g. " + MACRO_GENERIC_ADVICE[worst.id]
    };
  }

  // Macros fine — calories are the gap.
  if (nutrition.caloriesHit < 7) {
    const text = phase === "bulk"
      ? "Calories on target " + nutrition.caloriesHit + "/7 days. Add a calorie-dense snack on the days you land short."
      : phase === "cut"
        ? "Calories on target " + nutrition.caloriesHit + "/7 days. Pre-log dinner to stay inside the line."
        : "Calories on target " + nutrition.caloriesHit + "/7 days. Aim for one more on-target day next week.";
    return { type: "calories", macroId: null, text: text };
  }

  return { type: "repeat", text: "Solid week. Keep the same plan and log all 7 days for the full picture." };
}

function suggestExercise(muscleId, routines) {
  for (let i = 0; i < (routines || []).length; i++) {
    const exs = routines[i].exercises || [];
    for (let j = 0; j < exs.length; j++) {
      if (EXERCISE_MUSCLE[exs[j].name] === muscleId) return exs[j].name;
    }
  }
  return (EXERCISES_BY_CATEGORY[muscleId] || [])[0] || null;
}

export function buildTrainingNudge(training, routines) {
  if (training.sessions.length === 0) {
    return { type: "no-data", text: "No workouts logged this week. Book two sessions early in the week to restart momentum." };
  }
  const short = training.rows.filter(function(r) { return !r.hit; });
  if (short.length === 0 && training.rows.length > 0) {
    return { type: "repeat", text: "All " + training.rows.length + " volume targets hit. Repeat this split next week." };
  }
  // Closest miss first — the cheapest fix.
  const target = short.slice().sort(function(a, b) {
    return (a.target - a.done) - (b.target - b.done);
  })[0];
  if (!target) {
    return { type: "repeat", text: "Sessions logged — set weekly volume targets to get specific fixes here." };
  }
  const deficit = target.target - target.done;
  const setsWord = deficit === 1 ? "set" : "sets";
  const exercise = suggestExercise(target.id, routines);
  const when = training.lastDayByMuscle[target.id] ? " on " + training.lastDayByMuscle[target.id] : " next session";
  return {
    type: "volume-fix",
    text: target.label + " " + deficit + " " + setsWord + " short — add " + deficit + " " + setsWord +
      (exercise ? " of " + exercise : "") + when + "."
  };
}

// ── Tone & assembly ─────────────────────────────────────────────────────

export function getTone(nutrition, training, movedCount) {
  let pts = 0;
  if (nutrition.caloriesHit >= 5) pts += 2;
  else if (nutrition.caloriesHit >= 3) pts += 1;
  const rate = training.rows.length ? training.hitCount / training.rows.length : 0;
  if (training.rows.length && rate >= 0.75) pts += 2;
  else if (rate >= 0.4) pts += 1;
  if (movedCount >= 1) pts += 1;
  if (pts >= 4) return "strong";
  if (pts <= 1) return "rough";
  return "mixed";
}

export function buildWeeklyReport(input) {
  const weekStart = input.weekStart;
  const weekEnd = new Date(weekStart);
  weekEnd.setDate(weekEnd.getDate() + 6);
  const weekEndExclusive = new Date(weekStart);
  weekEndExclusive.setDate(weekEndExclusive.getDate() + 7);

  const phase = getPhase(input.goal);
  const weightTrend = buildWeightTrend(input.weightLog, input.targets, input.goal, weekStart);
  const nutrition = aggregateNutrition(input.history, input.targets, input.goal, weekStart);
  const training = aggregateTraining(input.workoutLog, input.routines, input.setTargets, weekStart);
  const events = getWeeklyProgression(input.workoutLog, weekStart.getTime(), weekEndExclusive.getTime());
  const movedCount = countMoved(events);
  const win = selectWinOfWeek(events, training, nutrition, input.workoutLog, weekStart);

  return {
    weekStart: weekStart,
    weekEnd: weekEnd,
    phase: phase,
    weightTrend: weightTrend,
    tone: getTone(nutrition, training, movedCount),
    nutrition: nutrition,
    training: training,
    progression: { events: events, movedCount: movedCount },
    win: win,
    nudges: {
      nutrition: buildNutritionNudge(nutrition, training.workoutDayKeys, phase),
      training: buildTrainingNudge(training, input.routines)
    }
  };
}
