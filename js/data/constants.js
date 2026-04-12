/* ─── PHYSIQ ENGINE — Constants & Configuration ──────────────────────────── */

window.PhysIQ = window.PhysIQ || {};
window.PhysIQ.Data = window.PhysIQ.Data || {};

(function(Data) {

  // ─── Muscle Groups ──────────────────────────────────────────────────────
  Data.MUSCLE_GROUPS = [
    { id: "chest",     label: "Chest",     icon: "\u25FC", nutrients: ["protein", "creatine", "leucine"],  recovery: 48 },
    { id: "back",      label: "Back",      icon: "\u25C6", nutrients: ["protein", "magnesium", "zinc"],    recovery: 48 },
    { id: "shoulders", label: "Shoulders", icon: "\u25B2", nutrients: ["protein", "vitaminD", "calcium"],  recovery: 48 },
    { id: "biceps",    label: "Biceps",    icon: "\u25CF", nutrients: ["protein", "potassium", "b12"],     recovery: 36 },
    { id: "triceps",   label: "Triceps",   icon: "\u25CF", nutrients: ["protein", "potassium", "b12"],     recovery: 36 },
    { id: "legs",      label: "Legs",      icon: "\u25BC", nutrients: ["protein", "iron", "glycogen"],     recovery: 72 },
    { id: "core",      label: "Core",      icon: "\u25C7", nutrients: ["protein", "fiber", "omega3"],      recovery: 24 },
    { id: "glutes",    label: "Glutes",    icon: "\u25A0", nutrients: ["protein", "iron", "glycogen"],     recovery: 72 }
  ];

  // ─── Goals (ordered: build → lean → maintain → debloat+cut → cut) ─────
  Data.GOALS = [
    { id: "build",    label: "Build Muscle",  pct:  0.10, proteinGKg: 1.8, icon: "\u2191" },
    { id: "lean",     label: "Lean Bulk",     pct:  0.05, proteinGKg: 1.8, icon: "\u2B08" },
    { id: "maintain", label: "Maintain",      pct:  0,    proteinGKg: 1.6, icon: "\u2192" },
    { id: "debloat",  label: "Debloat + Cut", pct: -0.15, proteinGKg: 2.0, icon: "\u2B0A" },
    { id: "cut",      label: "Cut Fat",       pct: -0.20, proteinGKg: 2.2, icon: "\u2193" }
  ];

  // ─── Activity Levels ───────────────────────────────────────────────────
  Data.ACTIVITY_LEVELS = [
    { id: "sedentary", label: "Sedentary",     mult: 1.2,   steps: "< 4k" },
    { id: "light",     label: "Light",         mult: 1.375, steps: "4-7k" },
    { id: "moderate",  label: "Moderate",      mult: 1.55,  steps: "7-10k" },
    { id: "active",    label: "Very Active",   mult: 1.725, steps: "10-14k" },
    { id: "extreme",   label: "Extreme",       mult: 1.9,   steps: "14k+" }
  ];

  // ─── Nutrient Metadata ─────────────────────────────────────────────────
  Data.NUTRIENT_INFO = {
    calories:  { unit: "kcal", label: "Calories",   color: "#F97316" },
    protein:   { unit: "g",    label: "Protein",    color: "#3B82F6" },
    carbs:     { unit: "g",    label: "Carbs",      color: "#EAB308" },
    fats:      { unit: "g",    label: "Fats",       color: "#A855F7" },
    fiber:     { unit: "g",    label: "Fiber",      color: "#22C55E" },
    sugar:     { unit: "g",    label: "Sugar",      color: "#F43F5E" },
    sodium:    { unit: "mg",   label: "Sodium",     color: "#EF4444" },
    potassium: { unit: "mg",   label: "Potassium",  color: "#14B8A6" },
    calcium:   { unit: "mg",   label: "Calcium",    color: "#E2E8F0" },
    magnesium: { unit: "mg",   label: "Magnesium",  color: "#8B5CF6" },
    iron:      { unit: "mg",   label: "Iron",       color: "#B45309" },
    zinc:      { unit: "mg",   label: "Zinc",       color: "#6366F1" },
    vitaminD:  { unit: "IU",   label: "Vitamin D",  color: "#FBBF24" },
    b12:       { unit: "mcg",  label: "B12",        color: "#EC4899" },
    omega3:    { unit: "g",    label: "Omega-3",    color: "#06B6D4" },
    creatine:  { unit: "g",    label: "Creatine",   color: "#D946EF" },
    water:     { unit: "oz",   label: "Water",      color: "#38BDF8" }
  };

  // ─── Default Empty States ──────────────────────────────────────────────
  Data.EMPTY_INTAKE = {
    calories: 0, protein: 0, carbs: 0, fats: 0,
    fiber: 0, sugar: 0, sodium: 0, potassium: 0,
    calcium: 0, magnesium: 0, iron: 0, zinc: 0,
    vitaminD: 0, b12: 0, omega3: 0, creatine: 0, water: 0
  };

  Data.DEFAULT_PROFILE = {
    age: 28, weight: 180, height: 70,
    sex: "male", bodyfat: 18,
    goal: "build", activity: "moderate",
    gymDays: 5, steps: 8000,
    todayMuscles: [], bmrOverride: null, name: ""
  };

})(window.PhysIQ.Data);
