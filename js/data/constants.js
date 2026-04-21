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

  // ─── Exercise Categories (for routine builder picker) ───────────────────
  Data.EXERCISE_CATEGORIES = [
    { id: "chest",     label: "Chest",     icon: "\uD83D\uDCAA" },
    { id: "back",      label: "Back",      icon: "\uD83E\uDDCD" },
    { id: "shoulders", label: "Shoulders", icon: "\uD83D\uDD3A" },
    { id: "biceps",    label: "Biceps",    icon: "\uD83D\uDCAA" },
    { id: "triceps",   label: "Triceps",   icon: "\uD83E\uDD1C" },
    { id: "legs",      label: "Legs",      icon: "\uD83E\uDDB5" },
    { id: "core",      label: "Core",      icon: "\uD83D\uDD25" },
    { id: "cardio",    label: "Cardio",    icon: "\uD83C\uDFC3" }
  ];

  Data.EXERCISES_BY_CATEGORY = {
    biceps: [
      "Barbell Curl", "Dumbbell Curl", "Hammer Curl", "Incline Dumbbell Curl",
      "Preacher Curl", "Concentration Curl", "Cable Curl", "EZ Bar Curl",
      "Reverse Curl", "Spider Curl"
    ],
    back: [
      "Pull-Up", "Lat Pulldown", "Barbell Row", "Dumbbell Row",
      "Seated Cable Row", "Chest-Supported Row", "T-Bar Row",
      "Straight-Arm Pulldown", "Deadlift", "Machine Row"
    ],
    chest: [
      "Barbell Bench Press", "Incline Bench Press", "Dumbbell Bench Press",
      "Incline Dumbbell Press", "Chest Fly", "Pec Deck", "Push-Up",
      "Cable Fly", "Decline Bench Press", "Machine Chest Press"
    ],
    shoulders: [
      "Overhead Press", "Dumbbell Shoulder Press", "Lateral Raise",
      "Front Raise", "Rear Delt Fly", "Arnold Press", "Upright Row",
      "Face Pull", "Machine Shoulder Press", "Cable Lateral Raise"
    ],
    triceps: [
      "Tricep Pushdown", "Overhead Tricep Extension", "Skullcrusher",
      "Close-Grip Bench Press", "Dips", "Rope Pushdown",
      "Single-Arm Cable Extension", "Bench Dip", "EZ Bar Skullcrusher", "Kickback"
    ],
    core: [
      "Crunch", "Cable Crunch", "Leg Raise", "Hanging Leg Raise",
      "Plank", "Russian Twist", "Mountain Climber", "Bicycle Crunch",
      "Ab Wheel Rollout", "Toe Touch"
    ],
    cardio: [
      "Treadmill Walk", "Treadmill Run", "Stair Climber",
      "Cycling", "Rowing", "Elliptical"
    ],
    legs: [
      // Quads (4)
      "Squat", "Leg Press", "Leg Extension", "Hack Squat",
      // Hamstrings (3)
      "Romanian Deadlift", "Seated Leg Curl", "Lying Leg Curl",
      // Calves (3)
      "Standing Calf Raise", "Seated Calf Raise", "Calf Press"
    ]
  };

  // Legacy alias (kept for any lingering reference; superseded by EXERCISES_BY_CATEGORY)
  Data.EXERCISES = Data.EXERCISES_BY_CATEGORY;

  // ─── Tracked Muscle Groups (for weekly muscle tracker) ──────────────────
  // Legs split into quads/hamstrings/calves for more granular tracking.
  Data.TRACKED_MUSCLES = [
    { id: "chest",      label: "Chest",      side: "front" },
    { id: "shoulders",  label: "Shoulders",  side: "both"  },
    { id: "biceps",     label: "Biceps",     side: "front" },
    { id: "core",       label: "Core",       side: "front" },
    { id: "quads",      label: "Quads",      side: "front" },
    { id: "back",       label: "Back",       side: "back"  },
    { id: "triceps",    label: "Triceps",    side: "back"  },
    { id: "hamstrings", label: "Hamstrings", side: "back"  },
    { id: "calves",     label: "Calves",     side: "back"  },
    { id: "cardio",     label: "Cardio",     side: "badge" }
  ];

  // ─── Exercise → Primary Muscle mapping ──────────────────────────────────
  // Each exercise maps to exactly one primary tracked muscle id.
  Data.EXERCISE_MUSCLE = (function() {
    var map = {};
    Data.EXERCISES_BY_CATEGORY.chest.forEach(function(n)     { map[n] = "chest"; });
    Data.EXERCISES_BY_CATEGORY.back.forEach(function(n)      { map[n] = "back"; });
    Data.EXERCISES_BY_CATEGORY.shoulders.forEach(function(n) { map[n] = "shoulders"; });
    Data.EXERCISES_BY_CATEGORY.biceps.forEach(function(n)    { map[n] = "biceps"; });
    Data.EXERCISES_BY_CATEGORY.triceps.forEach(function(n)   { map[n] = "triceps"; });
    Data.EXERCISES_BY_CATEGORY.core.forEach(function(n)      { map[n] = "core"; });
    Data.EXERCISES_BY_CATEGORY.cardio.forEach(function(n)    { map[n] = "cardio"; });
    // Legs — explicit per-exercise assignment to sub-groups
    map["Squat"]               = "quads";
    map["Leg Press"]           = "quads";
    map["Leg Extension"]       = "quads";
    map["Hack Squat"]          = "quads";
    map["Romanian Deadlift"]   = "hamstrings";
    map["Seated Leg Curl"]     = "hamstrings";
    map["Lying Leg Curl"]      = "hamstrings";
    map["Standing Calf Raise"] = "calves";
    map["Seated Calf Raise"]   = "calves";
    map["Calf Press"]          = "calves";
    return map;
  })();

})(window.PhysIQ.Data);
