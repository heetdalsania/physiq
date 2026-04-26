/* ─── PHYSIQ ENGINE — Calculation Utilities ──────────────────────────────── */

window.PhysIQ = window.PhysIQ || {};
window.PhysIQ.Utils = window.PhysIQ.Utils || {};

(function(Utils, Data) {

  var ACTIVITY_LEVELS = Data.ACTIVITY_LEVELS;
  var GOALS = Data.GOALS;

  /** Calculate Basal Metabolic Rate using Mifflin-St Jeor equation */
  function calcBMR(p) {
    var w = p.weight * 0.453592;
    var h = p.height * 2.54;
    return p.sex === "male"
      ? 10 * w + 6.25 * h - 5 * p.age + 5
      : 10 * w + 6.25 * h - 5 * p.age - 161;
  }

  /** Calculate all daily nutrient targets based on profile */
  function calcTargets(p, intake) {
    var c = calcBMR(p);
    var bmr = p.bmrOverride != null ? p.bmrOverride : c;
    var isMale = p.sex === "male";
    var aM = (ACTIVITY_LEVELS.find(function(l) { return l.id === p.activity; }) || {}).mult || 1.55;
    var gd = GOALS.find(function(g) { return g.id === p.goal; }) || GOALS[0];
    var tdee = bmr * aM;
    var surplus = Math.round(tdee * gd.pct);
    var tCal = Math.round(tdee + surplus);
    var wKg = p.weight * 0.453592;
    var pr = Math.round(wKg * gd.proteinGKg);
    var fP = (p.goal === "cut" || p.goal === "debloat") ? 0.25 : 0.28;
    var fa = Math.round((tCal * fP) / 9);
    var ca = Math.max(Math.round((tCal - pr * 4 - fa * 9) / 4), 80);
    var isD = p.goal === "debloat";
    var wB = Math.round(p.weight / 2);
    var wE = p.todayMuscles.length > 0 ? 24 : 0;
    var wS = p.steps > 10000 ? 16 : p.steps > 7000 ? 8 : 0;
    var wC = (intake && intake.creatine > 0) ? Math.round(intake.creatine * 3.2) : 0; // ~16oz per 5g
    var hB = p.todayMuscles.some(function(m) { return ["quads", "hamstrings", "back", "glutes"].includes(m); });
    var lm = p.weight * (1 - p.bodyfat / 100);

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
      surplus: surplus
    };
  }

  /** Generate contextual nutrition suggestions based on intake vs targets */
  function getSuggestions(p, t, i) {
    var s = [];
    var g = GOALS.find(function(x) { return x.id === p.goal; });
    var m = p.todayMuscles;

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
   * Returns true only if `actual` satisfies the calorie rule for the user's goal.
   *
   *   cut / debloat → must be > 0 and ≤ target          (under-target wins)
   *   build / lean  → must be ≥ target                  (over-target wins)
   *   maintain      → must be within ±300 of target     (cushion both ways)
   *
   * Any missing input (no goal, no/0 target, null actual) returns false so a
   * day never gets credit without real data.
   */
  function evaluateCalorieGoal(goal, actual, target) {
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

  /**
   * Macro floor: protein, carbs, and fats must each meet or exceed target.
   * Any one below target → fail. Missing values are treated as 0 (fail).
   */
  function evaluateMacros(intake, targets) {
    if (!intake || !targets) return false;
    var keys = ["protein", "carbs", "fats"];
    for (var i = 0; i < keys.length; i++) {
      var k = keys[i];
      var tgt = targets[k];
      if (typeof tgt !== "number" || tgt <= 0) return false;
      var got = typeof intake[k] === "number" ? intake[k] : 0;
      if (got < tgt) return false;
    }
    return true;
  }

  /**
   * Full nutrition-day completion check.
   * A day passes only if BOTH:
   *   - Goal-aware calorie rule (evaluateCalorieGoal) passes
   *   - All three macros (protein, carbs, fats) are at or above target
   */
  function evaluateNutritionDay(goal, intake, targets) {
    if (!intake || !targets) return false;
    if (!evaluateCalorieGoal(goal, intake.calories, targets.calories)) return false;
    if (!evaluateMacros(intake, targets)) return false;
    return true;
  }

  // ─── Exports ────────────────────────────────────────────────────────────
  Utils.calcBMR = calcBMR;
  Utils.calcTargets = calcTargets;
  Utils.getSuggestions = getSuggestions;
  Utils.evaluateCalorieGoal = evaluateCalorieGoal;
  Utils.evaluateMacros = evaluateMacros;
  Utils.evaluateNutritionDay = evaluateNutritionDay;

})(window.PhysIQ.Utils, window.PhysIQ.Data);
