/* ─── TissueOS — exercise → tissue mapping (exercise-tissue-map-v0.1) ─────
 *
 * The coefficient table the load engine multiplies by. This file is DATA:
 * it holds every anatomical assumption the model makes, so changing the
 * science means editing here and bumping EXERCISE_TISSUE_MAP_VERSION —
 * never editing the engine.
 *
 * ── Why this set is small ────────────────────────────────────────────────
 * 25 exercises, not the whole 106-name catalog. Every coefficient here is
 * an author-chosen heuristic with NO literature review behind it, so each
 * one is a liability that a later evidence pass must re-examine. The set is
 * sized to prove the software contract across the six movement patterns
 * Milestone 1 cares about — upper push, upper pull, knee-dominant,
 * hip-dominant, plantar-flexor, isolation (plus core) — and no larger.
 * Breadth of catalog coverage is explicitly NOT a goal; unmapped exercises
 * are handled safely by the engine and are the honest default.
 *
 * ── What a coefficient IS ────────────────────────────────────────────────
 * `coefficient` is a dimensionless relative weighting in (0, 1]:
 *   1.0  a primary target of this exercise
 *   ~0.5 a substantial secondary contributor
 *   ~0.2 a minor contributor worth recording
 * It scales the set's workload for that tissue. Coefficients are NOT
 * normalised to sum to 1 across an exercise; each is an independent
 * "how strongly is this tissue involved" weighting, and two tissues can
 * both be 1.0.
 *
 * ── What a coefficient is NOT ─────────────────────────────────────────────
 * Not a measured force, not a fraction of force or stress experienced by
 * the tissue, not an activation percentage, not Newtons, not injury risk.
 * They are engineering heuristics drawn from general strength-training
 * convention. Confidence records how much to trust each one; no entry is
 * rated "high" because none has been checked against measurement.
 *
 * ── Tendon entries: read this before using them ──────────────────────────
 * A patellar_tendon or achilles_tendon coefficient means ONLY:
 *
 *     this exercise is provisionally considered mechanically relevant to
 *     this tissue, and more relevant than an exercise with a lower number
 *
 * It does NOT approximate the fraction of force or stress the tendon
 * experiences. Tendons are mapped only where knee-extension or
 * plantar-flexion demand is uncontroversial (squat pattern, leg extension,
 * calf raises) — not sprinkled across every leg exercise. Every tendon
 * entry is "low" confidence, and a test enforces that a tendon coefficient
 * never exceeds the exercise's top muscle coefficient, so a tendon can
 * never be presented as the dominant loaded structure.
 *
 * ── Body-mass bands ──────────────────────────────────────────────────────
 * EVERY entry declares a `bodyMass` band — including `none`. There is no
 * "bodyweight exercise" special case: the engine applies one rule to all
 * exercises, so a squat logged at weight 0 and a push-up logged at weight 0
 * are treated consistently. Bands are a coarse five-value scale, referenced
 * by name rather than by decimal, precisely so they cannot be mistaken for
 * measured anthropometry. See BODY_MASS_BANDS.
 * ───────────────────────────────────────────────────────────────────────── */

import { EXERCISE_TISSUE_MAP_VERSION } from "./modelVersion.js";
import { CONFIDENCE_LOW as LOW, CONFIDENCE_MEDIUM as MED } from "./uncertainty.js";

/* How much of the lifter's own body mass this movement pattern lifts or
   supports, as a deliberately coarse band. These are provisional
   engineering assumptions, not anthropometric measurements — the whole
   point of naming the bands is that no entry can imply two-decimal
   precision it does not have. */
export const BODY_MASS_BANDS = Object.freeze({
  none:  0,     // body supported externally: benches, seated machines, cables
  light: 0.25,  // a small share of the body is moved
  half:  0.5,   // roughly half the body is moved or held
  most:  0.75,  // most of the body is moved
  full:  1.0    // essentially the whole body is moved
});

export const BODY_MASS_BAND_NAMES = Object.freeze(Object.keys(BODY_MASS_BANDS));

export function bodyMassBandValue(band) {
  if (!Object.prototype.hasOwnProperty.call(BODY_MASS_BANDS, band)) {
    throw new Error("Unknown body-mass band: " + String(band));
  }
  return BODY_MASS_BANDS[band];
}

function c(coefficient, confidence) {
  return Object.freeze({ coefficient: coefficient, confidence: confidence });
}

export const EXERCISE_TISSUE_MAP = Object.freeze({

  // ── Upper-body push ───────────────────────────────────────────────────
  "Barbell Bench Press": { bodyMass: "none", tissues: {
    chest: c(1.0, MED), triceps: c(0.6, MED), shoulders: c(0.4, MED)
  } },
  "Overhead Press": { bodyMass: "none", tissues: {
    shoulders: c(1.0, MED), triceps: c(0.6, MED), core: c(0.3, LOW)
  } },
  "Push-Up": { bodyMass: "most", tissues: {
    chest: c(1.0, MED), triceps: c(0.6, MED), shoulders: c(0.4, LOW), core: c(0.3, LOW)
  } },
  "Dips": { bodyMass: "full", tissues: {
    triceps: c(0.9, MED), chest: c(0.8, MED), shoulders: c(0.4, LOW)
  } },

  // ── Upper-body pull ───────────────────────────────────────────────────
  "Pull-Up": { bodyMass: "full", tissues: {
    back: c(1.0, MED), biceps: c(0.6, MED), core: c(0.2, LOW)
  } },
  "Lat Pulldown": { bodyMass: "none", tissues: {
    back: c(1.0, MED), biceps: c(0.5, MED)
  } },
  "Barbell Row": { bodyMass: "none", tissues: {
    back: c(1.0, MED), biceps: c(0.5, MED), core: c(0.3, LOW)
  } },
  "Seated Cable Row": { bodyMass: "none", tissues: {
    back: c(1.0, MED), biceps: c(0.5, MED)
  } },

  // ── Knee-dominant lower body ──────────────────────────────────────────
  "Squat": { bodyMass: "most", tissues: {
    quadriceps: c(1.0, MED), glutes: c(0.8, MED), hamstrings: c(0.3, LOW),
    core: c(0.4, LOW), back: c(0.3, LOW), patellar_tendon: c(0.8, LOW)
  } },
  "Front Squat": { bodyMass: "most", tissues: {
    quadriceps: c(1.0, MED), glutes: c(0.6, MED), core: c(0.6, LOW),
    patellar_tendon: c(0.9, LOW)
  } },
  "Leg Press": { bodyMass: "none", tissues: {
    quadriceps: c(1.0, MED), glutes: c(0.6, MED), patellar_tendon: c(0.7, LOW)
  } },
  "Lunge": { bodyMass: "most", tissues: {
    quadriceps: c(0.9, MED), glutes: c(0.8, MED), hamstrings: c(0.3, LOW),
    patellar_tendon: c(0.7, LOW)
  } },

  // ── Hip-dominant lower body ───────────────────────────────────────────
  "Deadlift": { bodyMass: "half", tissues: {
    glutes: c(0.9, MED), back: c(0.9, MED), hamstrings: c(0.8, MED),
    quadriceps: c(0.5, LOW), core: c(0.5, LOW)
  } },
  "Romanian Deadlift": { bodyMass: "half", tissues: {
    hamstrings: c(1.0, MED), glutes: c(0.8, MED), back: c(0.6, MED), core: c(0.3, LOW)
  } },
  "Good Morning": { bodyMass: "half", tissues: {
    hamstrings: c(0.9, MED), back: c(0.8, MED), glutes: c(0.7, MED)
  } },
  "Hip Thrust": { bodyMass: "light", tissues: {
    glutes: c(1.0, MED), hamstrings: c(0.4, LOW), quadriceps: c(0.2, LOW)
  } },

  // ── Calf / plantar-flexor ─────────────────────────────────────────────
  "Standing Calf Raise": { bodyMass: "most", tissues: {
    calves: c(1.0, MED), achilles_tendon: c(0.9, LOW)
  } },
  "Seated Calf Raise": { bodyMass: "none", tissues: {
    calves: c(1.0, MED), achilles_tendon: c(0.7, LOW)
  } },

  // ── Isolation ─────────────────────────────────────────────────────────
  "Dumbbell Curl": { bodyMass: "none", tissues: {
    biceps: c(1.0, MED)
  } },
  "Tricep Pushdown": { bodyMass: "none", tissues: {
    triceps: c(1.0, MED)
  } },
  "Lateral Raise": { bodyMass: "none", tissues: {
    shoulders: c(1.0, MED)
  } },
  "Leg Extension": { bodyMass: "none", tissues: {
    quadriceps: c(1.0, MED), patellar_tendon: c(0.9, LOW)
  } },
  "Lying Leg Curl": { bodyMass: "none", tissues: {
    hamstrings: c(1.0, MED)
  } },

  // ── Core ──────────────────────────────────────────────────────────────
  "Plank": { bodyMass: "half", tissues: {
    core: c(1.0, LOW), shoulders: c(0.2, LOW)
  } },
  "Hanging Leg Raise": { bodyMass: "half", tissues: {
    core: c(1.0, MED)
  } }
});

/* The exact string a workout entry must carry to hit an entry above. All
   name handling for TissueOS lives here so the display-name coupling has
   one owner: trim and case-fold, nothing cleverer. */
export function normalizeExerciseName(name) {
  return typeof name === "string" ? name.trim().toLowerCase() : "";
}

/* Map, not a plain object, so keys like "__proto__" or "constructor" can
   never resolve to something inherited. */
function buildIndex(map) {
  const index = new Map();
  Object.keys(map).forEach(function(key) { index.set(normalizeExerciseName(key), key); });
  return index;
}
const DEFAULT_INDEX = buildIndex(EXERCISE_TISSUE_MAP);

/* Resolve a workout exercise name to a mapping entry.
   Returns { name, entry } for a hit (name = the canonical map key) or null.
   A custom `map` may be supplied (tests, future experiments); it is indexed
   on every call, which is fine for the sizes involved. */
export function resolveExerciseMapping(name, map) {
  const table = map || EXERCISE_TISSUE_MAP;
  const index = map ? buildIndex(map) : DEFAULT_INDEX;
  if (Object.prototype.hasOwnProperty.call(table, name)) return { name: name, entry: table[name] };
  const key = index.get(normalizeExerciseName(name));
  return key === undefined ? null : { name: key, entry: table[key] };
}

export function listMappedExerciseNames(map) {
  return Object.keys(map || EXERCISE_TISSUE_MAP).slice().sort();
}

export { EXERCISE_TISSUE_MAP_VERSION };
