/* ─── PHYSIQ ENGINE — Day Planner (nutrition simulation engine) ───────────
 *
 * Pure data layer for the Plan-a-Day screen. No React, no storage.
 *
 * A "plan" is an array of items in the exact shape of logged meal entries
 * ({ name, calories, protein, carbs, fats, fiber, sugar, sodium,
 * potassium }), so a planned item can be logged for real without any
 * translation. Targets are always the caller's CURRENT calcTargets output
 * — plans store food items only, never verdicts, so a plan re-scores
 * itself automatically when weight or goal changes.
 *
 * The recommender is a deterministic gap-filler: find the macro that is
 * proportionally furthest from target, rank candidate foods by how
 * densely they close that gap while fitting the remaining calories,
 * re-rank after every add. No LLM, no randomness.
 * ───────────────────────────────────────────────────────────────────────── */

import {
  evaluateCalorieGoal,
  evaluateMacros,
  evaluateNutritionDay
} from "./calculations.js";

const MACRO_IDS = ["protein", "carbs", "fats"];
const SUM_KEYS = ["calories", "protein", "carbs", "fats", "fiber", "sugar", "sodium", "potassium"];

// Search results / common foods use `cal`; logged meal items use
// `calories`. Normalize any food-ish object into the meal-item shape.
export function toPlanItem(food) {
  return {
    name: food.name + (food.brand ? " (" + food.brand + ")" : ""),
    serving: food.serving || "",
    calories: Math.round(food.calories != null ? food.calories : (food.cal || 0)),
    protein: Math.round(food.protein || 0),
    carbs: Math.round(food.carbs || 0),
    fats: Math.round(food.fats || 0),
    fiber: Math.round(food.fiber || 0),
    sugar: Math.round(food.sugar || 0),
    sodium: Math.round(food.sodium || 0),
    potassium: Math.round(food.potassium || 0)
  };
}

export function planTotals(items) {
  const t = {};
  SUM_KEYS.forEach(function(k) { t[k] = 0; });
  (items || []).forEach(function(it) {
    SUM_KEYS.forEach(function(k) { t[k] += it[k] || 0; });
  });
  return t;
}

// Remaining to target for calories + macros. Negative = over target.
export function planRemaining(items, targets) {
  const totals = planTotals(items);
  return {
    calories: (targets.calories || 0) - totals.calories,
    protein: (targets.protein || 0) - totals.protein,
    carbs: (targets.carbs || 0) - totals.carbs,
    fats: (targets.fats || 0) - totals.fats
  };
}

// Phase-aware scoring of the planned day, reusing the same evaluation the
// weekly report and calendar use — so "this day counts" means the same
// thing everywhere.
export function evaluatePlan(goal, items, targets) {
  const totals = planTotals(items);
  return {
    totals: totals,
    remaining: planRemaining(items, targets),
    caloriesOk: evaluateCalorieGoal(goal, totals.calories, targets.calories),
    macrosOk: evaluateMacros(totals, targets),
    dayOk: evaluateNutritionDay(goal, totals, targets)
  };
}

// At most ONE muted sanity warning, and only once the day is mostly
// planned (≥75% of calorie target) so an empty plan never warns.
export function planWarning(goal, items, targets) {
  const totals = planTotals(items);
  if (!targets.calories || totals.calories < targets.calories * 0.75) return null;

  if (targets.sodium && totals.sodium > targets.sodium * 1.1) {
    const strict = goal === "debloat" || goal === "cut";
    return {
      type: "sodium",
      text: "Heads up: " + totals.sodium + "mg sodium planned vs your " + targets.sodium + "mg " +
        (strict ? "limit — that matters on a " + (goal === "debloat" ? "debloat" : "cut") + "." : "target.")
    };
  }
  if (targets.sugar && totals.sugar > targets.sugar * 1.2) {
    return { type: "sugar", text: "Heads up: " + totals.sugar + "g sugar planned vs your " + targets.sugar + "g target." };
  }
  if (targets.fiber && totals.fiber < targets.fiber * 0.5) {
    return { type: "fiber", text: "Heads up: only " + totals.fiber + "g fiber planned — target is " + targets.fiber + "g." };
  }
  return null;
}

// The macro proportionally furthest from its target (only positive gaps).
// Ties resolve protein > carbs > fats. Null when every macro is met.
export function dominantGap(remaining, targets) {
  let best = null, bestRatio = 0;
  MACRO_IDS.forEach(function(m) {
    const tgt = targets[m];
    if (!tgt || tgt <= 0) return;
    const ratio = remaining[m] / tgt;
    if (remaining[m] > 0 && ratio > bestRatio) {
      best = m;
      bestRatio = ratio;
    }
  });
  return best;
}

// Merge the user's own recent foods with the curated staples; recents
// first so "their" foods win dedup and rank ties feel personal.
export function buildCandidatePool(recentFoods, commonFoods) {
  const seen = {};
  const pool = [];
  (recentFoods || []).concat(commonFoods || []).forEach(function(f) {
    if (!f || !f.name) return;
    const item = toPlanItem(f);
    if (item.calories <= 0) return;
    const key = item.name.toLowerCase();
    if (seen[key]) return;
    seen[key] = true;
    pool.push(item);
  });
  return pool;
}

// Deterministic recommendations for the current plan state.
//   opts.focusMacro — force the gap (report deep-link); otherwise dominant.
//   opts.limit — max results (default 4).
//   opts.overshoot — extra kcal allowed past the target (default 0).
//     Auto-fill uses this on surplus phases, where finishing a trailing
//     macro slightly past the calorie target is a win, not a miss.
// Rules: candidates must fit the remaining calories (small slack),
// contribute to the gap macro, and not already appear twice in the plan
// (diversity). When all macros are met but calories remain, rank by how
// exactly a food fills what's left.
export function rankRecommendations(pool, items, targets, opts) {
  opts = opts || {};
  const limit = opts.limit || 4;
  const overshoot = opts.overshoot || 0;
  const remaining = planRemaining(items, targets);
  if (remaining.calories + overshoot <= 0) return { gap: null, foods: [] };

  const counts = {};
  (items || []).forEach(function(it) {
    const key = it.name.toLowerCase();
    counts[key] = (counts[key] || 0) + 1;
  });

  const gap = opts.focusMacro && remaining[opts.focusMacro] > 0
    ? opts.focusMacro
    : dominantGap(remaining, targets);

  const scored = [];
  (pool || []).forEach(function(f) {
    if (f.calories <= 0) return;
    if (f.calories > remaining.calories + 50 + overshoot) return; // must fit the day
    const used = counts[f.name.toLowerCase()] || 0;
    if (used >= 2) return;                                       // diversity cap

    let score;
    if (gap) {
      if (!f[gap] || f[gap] <= 0) return;
      // Density × absolute contribution: a 52g-protein chicken breast
      // beats a 22g tuna even at slightly worse grams-per-kcal, so each
      // add makes a real dent (and auto-fill converges in few steps).
      score = (f[gap] * f[gap]) / f.calories;
    } else {
      score = -Math.abs(remaining.calories - f.calories);        // fill what's left
    }
    if (used === 1) score = score - Math.abs(score) * 0.4;       // soften repeats

    scored.push({ food: f, score: score });
  });

  scored.sort(function(a, b) {
    if (b.score !== a.score) return b.score - a.score;
    return a.food.name < b.food.name ? -1 : 1;
  });

  return { gap: gap, foods: scored.slice(0, limit).map(function(s) { return s.food; }) };
}

// Accept the top recommendation repeatedly until the day evaluates
// on-target for the phase, nothing fits, or the add cap is reached.
// Returns the items ADDED (not the merged plan).
export function autoFillDay(pool, items, targets, goal, maxAdds) {
  maxAdds = maxAdds || 12;
  // On surplus phases a trailing macro may need to finish slightly past
  // the calorie target — that's still an on-target bulk day. Deficit and
  // maintenance phases get no such room.
  const overshoot = (goal === "build" || goal === "lean") ? 150 : 0;
  const current = (items || []).slice();
  const added = [];
  for (let i = 0; i < maxAdds; i++) {
    const totals = planTotals(current);
    if (evaluateNutritionDay(goal, totals, targets)) break;
    // Strict pass first so mid-fill picks never blow the calorie budget;
    // the overshoot is an endgame rescue for a trailing macro only.
    let recs = rankRecommendations(pool, current, targets, { limit: 1 });
    if (!recs.foods.length && overshoot > 0) {
      recs = rankRecommendations(pool, current, targets, { limit: 1, overshoot: overshoot });
    }
    if (!recs.foods.length) break;
    current.push(recs.foods[0]);
    added.push(recs.foods[0]);
  }
  return added;
}
