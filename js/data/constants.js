/* ─── PHYSIQ ENGINE — Constants & Configuration ──────────────────────────── */

window.PhysIQ = window.PhysIQ || {};
window.PhysIQ.Data = window.PhysIQ.Data || {};

(function(Data) {

  // ─── Muscle Groups ──────────────────────────────────────────────────────
  Data.MUSCLE_GROUPS = [
    { id: "chest",     label: "Chest",     iconClass: "pq-icon-muscle", nutrients: ["protein", "creatine", "leucine"],  recovery: 48 },
    { id: "back",      label: "Back",      iconClass: "pq-icon-muscle", nutrients: ["protein", "magnesium", "zinc"],    recovery: 48 },
    { id: "shoulders", label: "Shoulders", iconClass: "pq-icon-muscle", nutrients: ["protein", "vitaminD", "calcium"],  recovery: 48 },
    { id: "biceps",    label: "Biceps",    iconClass: "pq-icon-muscle", nutrients: ["protein", "potassium", "b12"],     recovery: 36 },
    { id: "triceps",   label: "Triceps",   iconClass: "pq-icon-muscle", nutrients: ["protein", "potassium", "b12"],     recovery: 36 },
    { id: "quads",      label: "Quads",      iconClass: "pq-icon-muscle", nutrients: ["protein", "iron", "glycogen"],     recovery: 72 },
    { id: "hamstrings", label: "Hamstrings", iconClass: "pq-icon-muscle", nutrients: ["protein", "iron", "glycogen"],     recovery: 72 },
    { id: "calves",     label: "Calves",     iconClass: "pq-icon-muscle", nutrients: ["protein", "magnesium", "potassium"], recovery: 48 },
    { id: "core",       label: "Core",       iconClass: "pq-icon-muscle", nutrients: ["protein", "fiber", "omega3"],      recovery: 24 },
    { id: "glutes",     label: "Glutes",     iconClass: "pq-icon-muscle", nutrients: ["protein", "iron", "glycogen"],     recovery: 72 }
  ];

  // ─── Goals (ordered: build → lean → maintain → debloat+cut → cut) ─────
  Data.GOALS = [
    { id: "build",    label: "Build Muscle",  pct:  0.10, proteinGKg: 1.8, iconClass: "pq-icon-goal-up" },
    { id: "lean",     label: "Lean Bulk",     pct:  0.05, proteinGKg: 1.8, iconClass: "pq-icon-goal-up" },
    { id: "maintain", label: "Maintain",      pct:  0,    proteinGKg: 1.6, iconClass: "pq-icon-goal-flat" },
    { id: "debloat",  label: "Debloat + Cut", pct: -0.15, proteinGKg: 2.0, iconClass: "pq-icon-goal-down" },
    { id: "cut",      label: "Cut Fat",       pct: -0.20, proteinGKg: 2.2, iconClass: "pq-icon-goal-down" }
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
    { id: "chest",     label: "Chest",     iconClass: "pq-icon-muscle" },
    { id: "back",      label: "Back",      iconClass: "pq-icon-muscle" },
    { id: "shoulders", label: "Shoulders", iconClass: "pq-icon-muscle" },
    { id: "biceps",    label: "Biceps",    iconClass: "pq-icon-muscle" },
    { id: "triceps",   label: "Triceps",   iconClass: "pq-icon-muscle" },
    { id: "quads",      label: "Quads",      iconClass: "pq-icon-muscle" },
    { id: "hamstrings", label: "Hamstrings", iconClass: "pq-icon-muscle" },
    { id: "calves",     label: "Calves",     iconClass: "pq-icon-muscle" },
    { id: "glutes",     label: "Glutes",     iconClass: "pq-icon-muscle" },
    { id: "core",       label: "Core",       iconClass: "pq-icon-muscle" },
    { id: "cardio",     label: "Cardio",     iconClass: "pq-icon-cardio" }
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
    quads: [
      "Squat", "Leg Press", "Leg Extension", "Hack Squat",
      "Front Squat", "Goblet Squat", "Bulgarian Split Squat (Quad)",
      "Sissy Squat", "Lunge", "Box Squat"
    ],
    hamstrings: [
      "Romanian Deadlift", "Seated Leg Curl", "Lying Leg Curl",
      "Stiff-Leg Deadlift", "Nordic Curl", "Good Morning",
      "Single-Leg Romanian Deadlift", "Cable Pull-Through (Hams)"
    ],
    calves: [
      "Standing Calf Raise", "Seated Calf Raise", "Calf Press",
      "Single-Leg Calf Raise", "Donkey Calf Raise", "Smith Machine Calf Raise"
    ],
    glutes: [
      "Hip Thrust", "Glute Bridge", "Bulgarian Split Squat",
      "Cable Kickback", "Sumo Deadlift", "Glute Ham Raise",
      "Step-Up", "Cable Pull-Through", "Reverse Lunge", "Frog Pump"
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
    { id: "glutes",     label: "Glutes",     side: "back"  },
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
    Data.EXERCISES_BY_CATEGORY.glutes.forEach(function(n)    { map[n] = "glutes"; });
    Data.EXERCISES_BY_CATEGORY.quads.forEach(function(n)     { map[n] = "quads"; });
    Data.EXERCISES_BY_CATEGORY.hamstrings.forEach(function(n){ map[n] = "hamstrings"; });
    Data.EXERCISES_BY_CATEGORY.calves.forEach(function(n)    { map[n] = "calves"; });
    return map;
  })();

})(window.PhysIQ.Data);
