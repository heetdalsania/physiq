/* ─── PHYSIQ ENGINE — Routine Generator ───────────────────────────────────
 *
 * Deterministically builds a suggested routine from the weekly report's
 * volume gaps — the inverse of the volume rollup. Pure functions; the
 * result is a normal routine object, so "copy" is just saveRoutine().
 *
 * Two modes:
 *   - Gap filler: one entry per short muscle group. Prefers an exercise
 *     from the user's own routines; falls back to the catalog. Set count
 *     equals the deficit (capped; a second exercise takes the overflow).
 *   - Starter: when there's nothing to diff against (no rows at all),
 *     a full-body template of one catalog exercise per major group.
 *
 * Working weights/reps are seeded from the lift history (last session's
 * best) so the suggestion opens ready to run, not full of zeros.
 * ───────────────────────────────────────────────────────────────────────── */

import { EXERCISES_BY_CATEGORY, MUSCLE_GROUPS } from "../data/constants.js";
import { buildLiftHistory } from "./progression.js";

const MAX_SETS_PER_EXERCISE = 5;
const MAX_SETS_PER_MUSCLE = 10;
const STARTER_MUSCLES = ["chest", "back", "shoulders", "quads", "hamstrings", "core"];
const STARTER_SETS = 3;

function muscleLabel(id) {
  const g = MUSCLE_GROUPS.find(function(m) { return m.id === id; });
  return g ? g.label : id;
}

// The user's own exercises for a muscle (routine order), then catalog
// entries — deduped. Ensures the suggestion reaches for familiar lifts
// before generic ones.
export function exercisePreference(muscleId, routines) {
  const catalog = EXERCISES_BY_CATEGORY[muscleId] || [];
  const inCatalog = {};
  catalog.forEach(function(n) { inCatalog[n] = true; });

  const preferred = [];
  const seen = {};
  (routines || []).forEach(function(r) {
    (r.exercises || []).forEach(function(ex) {
      if (inCatalog[ex.name] && !seen[ex.name]) {
        seen[ex.name] = true;
        preferred.push(ex.name);
      }
    });
  });
  catalog.forEach(function(n) {
    if (!seen[n]) { seen[n] = true; preferred.push(n); }
  });
  return preferred;
}

// Last-session best for a lift, or a sensible default for a new one.
function seedSet(liftHistory, name) {
  const entries = liftHistory[name];
  if (entries && entries.length) {
    const last = entries[entries.length - 1];
    return { reps: last.reps || 10, weight: last.weight || 0 };
  }
  return { reps: 10, weight: 0 };
}

function makeSets(count, seed) {
  const sets = [];
  for (let i = 0; i < count; i++) sets.push({ reps: seed.reps, weight: seed.weight });
  return sets;
}

// rows: the weekly report's volume rows [{ id, label, done, target, hit }].
// Returns a routine object (without id — caller assigns) or null when
// there is nothing to suggest (every target already hit).
export function generateGapRoutine(rows, routines, workoutLog) {
  const liftHistory = buildLiftHistory(workoutLog);
  const shorts = (rows || []).filter(function(r) { return !r.hit && r.target - r.done > 0; });
  if (shorts.length === 0) return null;

  const exercises = [];
  let exId = 1;
  shorts.forEach(function(row) {
    const deficit = Math.min(row.target - row.done, MAX_SETS_PER_MUSCLE);
    const options = exercisePreference(row.id, routines);
    if (!options.length) return;

    const first = Math.min(deficit, MAX_SETS_PER_EXERCISE);
    exercises.push({
      id: exId++,
      name: options[0],
      muscle: muscleLabel(row.id),
      sets: makeSets(first, seedSet(liftHistory, options[0]))
    });
    const overflow = deficit - first;
    if (overflow > 0 && options.length > 1) {
      exercises.push({
        id: exId++,
        name: options[1],
        muscle: muscleLabel(row.id),
        sets: makeSets(Math.min(overflow, MAX_SETS_PER_EXERCISE), seedSet(liftHistory, options[1]))
      });
    }
  });
  if (!exercises.length) return null;

  return { title: "Suggested · Fill the Gaps", exercises: exercises };
}

export function generateStarterRoutine(workoutLog) {
  const liftHistory = buildLiftHistory(workoutLog);
  const exercises = STARTER_MUSCLES.map(function(muscleId, i) {
    const name = (EXERCISES_BY_CATEGORY[muscleId] || [])[0];
    return {
      id: i + 1,
      name: name,
      muscle: muscleLabel(muscleId),
      sets: makeSets(STARTER_SETS, seedSet(liftHistory, name))
    };
  }).filter(function(ex) { return !!ex.name; });

  return { title: "Suggested · Starter Full Body", exercises: exercises };
}

// What the weekly report's training nudge offers: fill the gaps when
// there are rows to diff, a starter plan when there's nothing at all.
// Null when every target was hit (no upsell on a good week).
export function suggestRoutineForWeek(trainingRows, routines, workoutLog) {
  if (!trainingRows || trainingRows.length === 0) {
    return generateStarterRoutine(workoutLog);
  }
  return generateGapRoutine(trainingRows, routines, workoutLog);
}
