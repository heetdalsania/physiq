/* ─── PHYSIQ ENGINE — Calculation Utilities ──────────────────────────────── */

import { ACTIVITY_LEVELS, GOALS } from "../data/constants.js";

export function calcBMR(p) {
  const w = p.weight * 0.453592;
  const h = p.height * 2.54;
  return p.sex === "male"
    ? 10 * w + 6.25 * h - 5 * p.age + 5
    : 10 * w + 6.25 * h - 5 * p.age - 161;
}

export function calcTargets(p, intake) {
  const c = calcBMR(p);
  const bmr = p.bmrOverride != null ? p.bmrOverride : c;
  const isMale = p.sex === "male";
  const aM = (ACTIVITY_LEVELS.find(function(l) { return l.id === p.activity; }) || {}).mult || 1.55;
  const gd = GOALS.find(function(g) { return g.id === p.goal; }) || GOALS[0];
  const tdee = bmr * aM;
  const surplus = Math.round(tdee * gd.pct);
  // Adaptive coaching adjustment (weekly check-in can nudge targets when
  // the weight trend is off pace). Applied to calories only — protein
  // stays g/kg-based, so carbs/fats absorb the change below.
  const adj = typeof p.calorieAdjustment === "number" && isFinite(p.calorieAdjustment)
    ? Math.round(p.calorieAdjustment) : 0;
  const tCal = Math.round(tdee + surplus) + adj;
  const wKg = p.weight * 0.453592;
  const pr = Math.round(wKg * gd.proteinGKg);
  const fP = (p.goal === "cut" || p.goal === "debloat") ? 0.25 : 0.28;
  const fa = Math.round((tCal * fP) / 9);
  const ca = Math.max(Math.round((tCal - pr * 4 - fa * 9) / 4), 80);
  const isD = p.goal === "debloat";
  const wB = Math.round(p.weight / 2);
  const wE = p.todayMuscles.length > 0 ? 24 : 0;
  const wS = p.steps > 10000 ? 16 : p.steps > 7000 ? 8 : 0;
  // ~16oz per 5g
  const wC = (intake && intake.creatine > 0) ? Math.round(intake.creatine * 3.2) : 0;
  const lm = p.weight * (1 - p.bodyfat / 100);

  return {
    calories: tCal,
    protein: pr,
    carbs: ca,
    fats: fa,
    fiber: isMale ? 38 : 25,
    sugar: Math.round(tCal * 0.05 / 4),
    sodium: isD ? 1500 : 2300,
    potassium: isD ? 4700 : 3500,
    calcium: p.age > 50 ? 1200 : 1000,
    magnesium: isMale ? 420 : 320,
    iron: isMale ? 8 : 18,
    zinc: isMale ? 11 : 8,
    vitaminD: 2000,
    b12: 2.4,
    omega3: 1.6,
    creatine: 5,
    water: wB + wE + wS + wC,
    tdee: Math.round(tdee),
    bmr: Math.round(bmr),
    calculatedBMR: Math.round(c),
    leanMass: Math.round(lm),
    isOverridden: p.bmrOverride != null,
    surplus: surplus,
    adjustment: adj
  };
}

export function getSuggestions(p, t, i) {
  const s = [];
  const g = GOALS.find(function(x) { return x.id === p.goal; });
  const m = p.todayMuscles;

  if (i.protein < t.protein * 0.8)
    s.push({ type: "critical", text: "Protein " + Math.round(t.protein - i.protein) + "g below target. Add chicken, fish, yogurt, or whey." });
  if (i.sodium > t.sodium * 1.1)
    s.push({ type: "warning", text: "Sodium high (" + i.sodium + "mg). Cut processed foods to reduce bloating." });
  if (i.potassium < t.potassium * 0.7)
    s.push({ type: "warning", text: "Low potassium. Add bananas, sweet potatoes, spinach." });
  if (i.sugar > t.sugar * 1.2)
    s.push({ type: "warning", text: "Sugar " + Math.round(i.sugar - t.sugar) + "g over. Swap sugary snacks for berries." });
  if (i.water < t.water * 0.6)
    s.push({ type: "critical", text: "Dehydrated. Target " + t.water + "oz today." });
  if (i.fiber < t.fiber * 0.7)
    s.push({ type: "info", text: "Add fiber (oats, lentils, broccoli) for digestion." });
  if (m.includes("quads") || m.includes("hamstrings") || m.includes("calves") || m.includes("glutes"))
    s.push({ type: "muscle", text: "Leg day: 40g+ protein post-workout + fast carbs." });
  if (m.includes("chest") || m.includes("shoulders") || m.includes("triceps"))
    s.push({ type: "muscle", text: "Push day: 5g creatine + carbs pre-workout." });
  if (m.includes("back") || m.includes("biceps"))
    s.push({ type: "muscle", text: "Pull day: magnesium & zinc for grip. ZMA before bed." });
  if (i.calories > 0 && i.calories < t.calories * 0.6 && (p.goal === "build" || p.goal === "lean"))
    s.push({ type: "critical", text: "Too few calories for muscle gain. Add nuts, avocado, olive oil." });
  if (p.goal === "debloat")
    s.push({ type: "info", text: "Debloat: sodium <" + t.sodium + "mg, potassium >" + t.potassium + "mg, water " + t.water + "oz." });
  if (i.omega3 < t.omega3 * 0.5)
    s.push({ type: "info", text: "Add omega-3s: salmon, walnuts, or fish oil." });
  if (i.calories === 0)
    s.push({ type: "info", text: "Log meals for personalized " + (g ? g.label.toLowerCase() : "") + " suggestions." });

  return s;
}

/**
 * Goal-aware calorie completion check.
 *   cut / debloat → > 0 and ≤ target
 *   build / lean  → ≥ target
 *   maintain      → within ±300 of target
 */
export function evaluateCalorieGoal(goal, actual, target) {
  if (!goal) return false;
  if (typeof target !== "number" || target <= 0) return false;
  if (typeof actual !== "number" || isNaN(actual)) return false;

  switch (goal) {
    case "cut":
    case "debloat":
      return actual > 0 && actual <= target;
    case "build":
    case "lean":
      return actual >= target;
    case "maintain":
      return Math.abs(actual - target) <= 300;
    default:
      return false;
  }
}

export function evaluateMacros(intake, targets) {
  if (!intake || !targets) return false;
  const keys = ["protein", "carbs", "fats"];
  for (let i = 0; i < keys.length; i++) {
    const k = keys[i];
    const tgt = targets[k];
    if (typeof tgt !== "number" || tgt <= 0) return false;
    const got = typeof intake[k] === "number" ? intake[k] : 0;
    if (got < tgt) return false;
  }
  return true;
}

export function evaluateNutritionDay(goal, intake, targets) {
  if (!intake || !targets) return false;
  if (!evaluateCalorieGoal(goal, intake.calories, targets.calories)) return false;
  if (!evaluateMacros(intake, targets)) return false;
  return true;
}
