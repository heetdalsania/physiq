/* ─── PHYSIQ ENGINE — Deterministic Demo Fixtures ─────────────────────────
 *
 * Synthetic workout/profile data shaped EXACTLY like what the app writes
 * today (see STORAGE_CONTRACT.md). Used by the test suite and by the
 * dev-only seeder in ./seed.js.
 *
 * Nothing here is real user data. The e-mail addresses are reserved
 * example.com demo addresses and every number is invented.
 *
 * ── Determinism ──────────────────────────────────────────────────────────
 * IDs are fixed integers. Timestamps are built from fixed LOCAL calendar
 * dates rather than hard-coded epoch integers, because everything the app
 * buckets by — `weeklyMuscles.weekStart`, `history[].date`, the Mon–Sun
 * report week — is derived from the local calendar. A hard-coded epoch ms
 * would land on a different local day (and therefore a different week) in
 * a different timezone, which is the opposite of deterministic for this
 * app. Same approach the existing weeklyReport/routineGenerator tests use.
 *
 * Anchor week: Mon 2 Mar 2026 → Sun 8 Mar 2026.
 * ───────────────────────────────────────────────────────────────────────── */

// ── Anchor dates ────────────────────────────────────────────────────────
export const ANCHOR_YEAR = 2026;
export const ANCHOR_MONTH = 2;   // 0-indexed → March
export const ANCHOR_DAY = 2;     // Monday

/* Local Date on the anchor week. dayOffset 0 = Mon 2 Mar 2026. */
export function anchorDate(dayOffset, hour, minute) {
  return new Date(
    ANCHOR_YEAR, ANCHOR_MONTH, ANCHOR_DAY + (dayOffset || 0),
    hour == null ? 18 : hour, minute == null ? 0 : minute, 0, 0
  );
}
function at(dayOffset, hour, minute) { return anchorDate(dayOffset, hour, minute).getTime(); }

/* "YYYY-MM-DD" — matches the dayKey App.js builds for weeklyMuscles.dates. */
function pad(n) { return n < 10 ? "0" + n : "" + n; }
export function fixtureDayKey(dayOffset) {
  const d = anchorDate(dayOffset, 0, 0);
  return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate());
}
/* Date.toDateString() — matches the key format history[] entries use. */
export function fixtureHistoryKey(dayOffset) {
  return anchorDate(dayOffset, 0, 0).toDateString();
}

// ── Demo profiles (isolation fixtures) ──────────────────────────────────
// Two separate accounts. Every persisted key is namespaced by e-mail, so
// these two must never see each other's records.
export const DEMO_EMAIL_A = "demo-a@example.com";
export const DEMO_EMAIL_B = "demo-b@example.com";

export const DEMO_PROFILE_A = {
  age: 27, weight: 178, height: 71,
  sex: "male", bodyfat: 17,
  goal: "build", activity: "moderate",
  gymDays: 4, steps: 9000,
  todayMuscles: [], bmrOverride: null, name: "Demo A",
  calorieAdjustment: 0, calorieAdjustmentUpdatedAt: null,
  weightLog: [
    { date: fixtureDayKey(-7), weight: 176 },
    { date: fixtureDayKey(0),  weight: 178 }
  ]
};

export const DEMO_PROFILE_B = {
  age: 31, weight: 142, height: 65,
  sex: "female", bodyfat: 24,
  goal: "cut", activity: "light",
  gymDays: 3, steps: 7000,
  todayMuscles: [], bmrOverride: null, name: "Demo B",
  calorieAdjustment: -100, calorieAdjustmentUpdatedAt: fixtureDayKey(0),
  weightLog: [
    { date: fixtureDayKey(-7), weight: 145 },
    { date: fixtureDayKey(0),  weight: 142 }
  ]
};

// ── Routines ────────────────────────────────────────────────────────────
// Routine sets carry only { reps, weight } — `done` appears once a session
// starts. Fixed ids so re-seeding is byte-identical.
//
// `ex.muscle` holds the DISPLAY LABEL ("Chest"), matching what
// ExerciseTab writes via categoryLabel(). It is presentational only —
// muscle attribution for the tracker goes through EXERCISE_MUSCLE[ex.name],
// which is keyed by exercise NAME and returns a lowercase id.
export const DEMO_ROUTINE_PUSH = {
  id: 9001,
  title: "Demo Push",
  exercises: [
    {
      id: 91001, name: "Barbell Bench Press", muscle: "Chest",
      sets: [{ reps: 8, weight: 135 }, { reps: 8, weight: 135 }, { reps: 6, weight: 145 }]
    },
    {
      id: 91002, name: "Overhead Press", muscle: "Shoulders",
      sets: [{ reps: 10, weight: 75 }, { reps: 10, weight: 75 }]
    },
    {
      id: 91003, name: "Tricep Pushdown", muscle: "Triceps",
      sets: [{ reps: 12, weight: 50 }, { reps: 12, weight: 50 }]
    }
  ]
};

export const DEMO_ROUTINE_LEGS = {
  id: 9002,
  title: "Demo Legs",
  exercises: [
    {
      id: 92001, name: "Squat", muscle: "Quads",
      sets: [{ reps: 5, weight: 225 }, { reps: 5, weight: 225 }, { reps: 5, weight: 225 }]
    },
    {
      id: 92002, name: "Romanian Deadlift", muscle: "Hamstrings",
      sets: [{ reps: 8, weight: 155 }, { reps: 8, weight: 155 }]
    }
  ]
};

export const DEMO_ROUTINES_A = [DEMO_ROUTINE_PUSH, DEMO_ROUTINE_LEGS];

// ── Completed sessions ──────────────────────────────────────────────────
// Shape written by ExerciseTab.finishWorkout() → App.logCompletedWorkout().

/* Mon 2 Mar — fully completed, 3 exercises / 7 sets, all done. */
export const DEMO_SESSION_COMPLETE = {
  id: 8001,
  routineId: DEMO_ROUTINE_PUSH.id,
  title: "Demo Push",
  startedAt: at(0, 18, 0),
  finishedAt: at(0, 19, 5),
  completedSets: 7,
  totalSets: 7,
  exercises: [
    {
      id: 91001, name: "Barbell Bench Press", muscle: "Chest",
      sets: [
        { reps: 8, weight: 135, done: true },
        { reps: 8, weight: 135, done: true },
        { reps: 6, weight: 145, done: true }
      ]
    },
    {
      id: 91002, name: "Overhead Press", muscle: "Shoulders",
      sets: [
        { reps: 10, weight: 75, done: true },
        { reps: 10, weight: 75, done: true }
      ]
    },
    {
      id: 91003, name: "Tricep Pushdown", muscle: "Triceps",
      sets: [
        { reps: 12, weight: 50, done: true },
        { reps: 12, weight: 50, done: true }
      ]
    }
  ]
};

/* Wed 4 Mar — finished early: 3 of 5 sets done, 2 left incomplete.
   This is how a partial workout PERSISTS (the app saves the session with
   completedSets < totalSets and keeps the unfinished sets' done:false). */
export const DEMO_SESSION_PARTIAL = {
  id: 8002,
  routineId: DEMO_ROUTINE_LEGS.id,
  title: "Demo Legs",
  startedAt: at(2, 7, 30),
  finishedAt: at(2, 8, 10),
  completedSets: 3,
  totalSets: 5,
  exercises: [
    {
      id: 92001, name: "Squat", muscle: "Quads",
      sets: [
        { reps: 5, weight: 225, done: true },
        { reps: 5, weight: 225, done: true },
        { reps: 5, weight: 225, done: false }
      ]
    },
    {
      id: 92002, name: "Romanian Deadlift", muscle: "Hamstrings",
      sets: [
        { reps: 8, weight: 155, done: true },
        { reps: 8, weight: 155, done: false }
      ]
    }
  ]
};

/* Fri 6 Mar — a second complete push session, heavier, for trend checks. */
export const DEMO_SESSION_LATER = {
  id: 8003,
  routineId: DEMO_ROUTINE_PUSH.id,
  title: "Demo Push",
  startedAt: at(4, 18, 0),
  finishedAt: at(4, 19, 0),
  completedSets: 5,
  totalSets: 5,
  exercises: [
    {
      id: 91001, name: "Barbell Bench Press", muscle: "Chest",
      sets: [
        { reps: 8, weight: 145, done: true },
        { reps: 8, weight: 145, done: true },
        { reps: 6, weight: 155, done: true }
      ]
    },
    {
      id: 91002, name: "Overhead Press", muscle: "Shoulders",
      sets: [
        { reps: 10, weight: 80, done: true },
        { reps: 10, weight: 80, done: true }
      ]
    }
  ]
};

/* Three sessions across three distinct calendar days, oldest first —
   the order App.js appends them in. */
export const DEMO_WORKOUT_LOG_A = [
  DEMO_SESSION_COMPLETE,
  DEMO_SESSION_PARTIAL,
  DEMO_SESSION_LATER
];

/* Profile B trains separately — one session, different day and exercises,
   so cross-profile bleed is obvious if isolation ever breaks. */
export const DEMO_SESSION_B = {
  id: 8101,
  routineId: 9101,
  title: "Demo B Pull",
  startedAt: at(1, 12, 0),
  finishedAt: at(1, 12, 45),
  completedSets: 4,
  totalSets: 4,
  exercises: [
    {
      id: 91101, name: "Lat Pulldown", muscle: "Back",
      sets: [
        { reps: 12, weight: 90, done: true },
        { reps: 12, weight: 90, done: true }
      ]
    },
    {
      id: 91102, name: "Dumbbell Curl", muscle: "Biceps",
      sets: [
        { reps: 10, weight: 25, done: true },
        { reps: 10, weight: 25, done: true }
      ]
    }
  ]
};

/* Sat 7 Mar — Profile B, Milestone 2 coverage. The OPTIONAL per-set
   metadata (rir / side / tempo / rom, see js/utils/setMetadata.js) in the
   exact mix the tests need:
     - legacy sets with no metadata at all (never rewritten to add keys)
     - RIR 0 and RIR 5 (both boundaries), and an RIR-only set
     - every field at once
     - explicit left and right entries (recorded, never inferred)
     - partial tempo (one phase only) and an explicit 0-second pause,
       which is a recorded zero — different from a blank phase
     - an INCOMPLETE set that still carries metadata (done:false)
   Absence is the only encoding of "not entered": no nulls, no 0, no {}. */
export const DEMO_SESSION_METADATA_B = {
  id: 8102,
  routineId: 9102,
  title: "Demo B Legs",
  startedAt: at(5, 9, 0),
  finishedAt: at(5, 9, 50),
  completedSets: 8,
  totalSets: 9,
  exercises: [
    {
      id: 91103, name: "Squat", muscle: "Quads",
      sets: [
        { reps: 5, weight: 185, done: true },                                   // legacy shape
        { reps: 5, weight: 185, done: true, rir: 0 },                           // RIR lower bound
        { reps: 5, weight: 185, done: true, rir: 5, side: "bilateral",          // everything
          tempo: { eccentricSeconds: 3, pauseSeconds: 1, concentricSeconds: 1 }, rom: "full" }
      ]
    },
    {
      id: 91104, name: "Lunge", muscle: "Quads",
      sets: [
        { reps: 10, weight: 30, done: true, side: "left" },
        { reps: 10, weight: 30, done: true, side: "right" },
        { reps: 10, weight: 30, done: false, side: "left", rir: 2 }             // incomplete, keeps metadata
      ]
    },
    {
      id: 91105, name: "Leg Extension", muscle: "Quads",
      sets: [
        { reps: 12, weight: 70, done: true, tempo: { eccentricSeconds: 4 } },   // partial tempo
        { reps: 12, weight: 70, done: true, rom: "partial",
          tempo: { eccentricSeconds: 2, pauseSeconds: 0, concentricSeconds: 1 } } // explicit zero pause
      ]
    },
    {
      id: 91106, name: "Standing Calf Raise", muscle: "Calves",
      sets: [
        { reps: 15, weight: 0, done: true, rir: 1 }                              // RIR only
      ]
    }
  ]
};

export const DEMO_WORKOUT_LOG_B = [DEMO_SESSION_B, DEMO_SESSION_METADATA_B];

/* ── In-progress session ─────────────────────────────────────────────────
 * NOTE: the app does NOT persist an in-flight workout — it lives in
 * ExerciseTab's `active` state and is lost on reload (see
 * STORAGE_CONTRACT.md, "Not persisted"). This fixture reproduces that
 * in-memory shape (no id, no finishedAt, no set counters) so tests can
 * assert the completed-vs-incomplete distinction at the point a session
 * is finished. Do not write it to storage. */
export const DEMO_ACTIVE_SESSION = {
  routineId: DEMO_ROUTINE_LEGS.id,
  title: "Demo Legs",
  startedAt: at(6, 17, 0),
  exercises: [
    {
      id: 92001, name: "Squat", muscle: "Quads",
      sets: [
        { reps: 5, weight: 235, done: true },
        { reps: 5, weight: 235, done: false },
        { reps: 5, weight: 235, done: false }
      ]
    },
    {
      id: 92002, name: "Romanian Deadlift", muscle: "Hamstrings",
      sets: [
        { reps: 8, weight: 165, done: false },
        { reps: 8, weight: 165, done: false }
      ]
    }
  ]
};

// ── Nutrition fixtures ──────────────────────────────────────────────────
// Present so migration/seed tests can prove nutrition data is untouched.
//
// Caveat when seeding a BROWSER: `intake` and `meals` are today-only keys.
// The bundles below deliberately omit the `date` sentinel, so the first
// login after seeding sees a date mismatch and loadDaily() clears both —
// the normal day-rollover documented in STORAGE_CONTRACT.md §5. That is
// expected. `history`, `workoutLog`, `routines` and `setTargets` are the
// durable keys and survive. The tests call get()/loadHistory() directly,
// never loadDaily(), so they see these values as written.
export const DEMO_HISTORY_A = [
  { date: fixtureHistoryKey(0), calories: 2850, protein: 165, carbs: 310, fats: 82, sodium: 2300 },
  { date: fixtureHistoryKey(1), calories: 2610, protein: 158, carbs: 280, fats: 78, sodium: 2100 },
  { date: fixtureHistoryKey(2), calories: 2940, protein: 172, carbs: 325, fats: 85, sodium: 2450 }
];

export const DEMO_INTAKE_A = {
  calories: 1420, protein: 96, carbs: 150, fats: 44,
  fiber: 18, sugar: 40, sodium: 1150, potassium: 1900,
  calcium: 600, magnesium: 220, iron: 9, zinc: 6,
  vitaminD: 300, b12: 3, omega3: 1, creatine: 5, water: 48
};

export const DEMO_MEALS_A = [
  { id: 7001, name: "Demo Oats & Whey", time: "08:15", period: "breakfast",
    calories: 520, protein: 42, carbs: 70, fats: 10 },
  { id: 7002, name: "Demo Chicken Bowl", time: "13:00", period: "lunch",
    calories: 900, protein: 54, carbs: 80, fats: 34 }
];

export const DEMO_WEEKLY_MUSCLES_A = {
  weekStart: fixtureDayKey(0),
  dates: {
    chest: [fixtureDayKey(0), fixtureDayKey(4)],
    shoulders: [fixtureDayKey(0), fixtureDayKey(4)],
    triceps: [fixtureDayKey(0)],
    quads: [fixtureDayKey(2)],
    hamstrings: [fixtureDayKey(2)]
  },
  sessions: {
    chest: [
      { id: 8001, title: "Demo Push", finishedAt: at(0, 19, 5) },
      { id: 8003, title: "Demo Push", finishedAt: at(4, 19, 0) }
    ]
  },
  sets: { chest: 6, shoulders: 4, triceps: 2, quads: 2, hamstrings: 1 }
};

export const DEMO_SET_TARGETS_A = { chest: 12, back: 12, quads: 10 };

/* Everything one demo profile owns, keyed by the `uKey(email, k)` suffix.
   Consumed by ./seed.js and by the storage tests. */
export const DEMO_PROFILE_A_BUNDLE = {
  email: DEMO_EMAIL_A,
  keys: {
    profile: DEMO_PROFILE_A,
    routines: DEMO_ROUTINES_A,
    workoutLog: DEMO_WORKOUT_LOG_A,
    weeklyMuscles: DEMO_WEEKLY_MUSCLES_A,
    setTargets: DEMO_SET_TARGETS_A,
    history: DEMO_HISTORY_A,
    intake: DEMO_INTAKE_A,
    meals: DEMO_MEALS_A
  }
};

export const DEMO_PROFILE_B_BUNDLE = {
  email: DEMO_EMAIL_B,
  keys: {
    profile: DEMO_PROFILE_B,
    routines: [],
    workoutLog: DEMO_WORKOUT_LOG_B,
    weeklyMuscles: {
      weekStart: fixtureDayKey(0),
      dates: { back: [fixtureDayKey(1)], biceps: [fixtureDayKey(1)], quads: [fixtureDayKey(5)], calves: [fixtureDayKey(5)] },
      sessions: {
        back: [{ id: 8101, title: "Demo B Pull", finishedAt: at(1, 12, 45) }],
        quads: [{ id: 8102, title: "Demo B Legs", finishedAt: at(5, 9, 50) }],
        calves: [{ id: 8102, title: "Demo B Legs", finishedAt: at(5, 9, 50) }]
      },
      sets: { back: 2, biceps: 2, quads: 7, calves: 1 }
    },
    setTargets: { back: 14 },
    history: [
      { date: fixtureHistoryKey(1), calories: 1750, protein: 128, carbs: 160, fats: 58, sodium: 1800 }
    ],
    intake: Object.assign({}, DEMO_INTAKE_A, { calories: 880, protein: 61 }),
    meals: [
      { id: 7101, name: "Demo Greek Yogurt", time: "09:00", period: "breakfast",
        calories: 300, protein: 28, carbs: 30, fats: 8 }
    ]
  }
};

export const DEMO_BUNDLES = [DEMO_PROFILE_A_BUNDLE, DEMO_PROFILE_B_BUNDLE];
