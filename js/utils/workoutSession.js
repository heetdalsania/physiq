/* ─── PHYSIQ ENGINE — Active workout session lifecycle (pure) ─────────────
 *
 * The state transitions ExerciseTab applies to an in-progress workout,
 * lifted out of the component so the exact production code that shapes a
 * `workoutLog` record can be exercised by the test suite. Every function
 * returns a new session; inputs are never mutated.
 *
 * Shapes are the ones STORAGE_CONTRACT.md documents. The in-memory active
 * session is { routineId, title, startedAt, exercises } and is NOT
 * persisted (see "Not persisted at all"); only the record built by
 * buildCompletedWorkoutRecord() reaches storage, via
 * App.logCompletedWorkout().
 *
 * Milestone 2: per-set metadata (rir / side / tempo / rom) travels on the
 * set objects of the active session and is carried verbatim into the
 * completed record. Starting a routine never imports metadata — routines
 * carry none, and even if a routine set carried such keys they are
 * dropped, so a fresh workout never begins with somebody's earlier
 * observations attached. See js/utils/setMetadata.js.
 * ───────────────────────────────────────────────────────────────────────── */

import { applyMetadataInput, clearSetMetadata, clearSetDetails } from "./setMetadata.js";

/* startRoutine(): copies a routine into a fresh active session. Only reps,
   weight and done:false are copied per set — exactly what the app did
   before Milestone 2. */
export function startSessionFromRoutine(routine, startedAt) {
  const logs = (routine.exercises || []).map(function(ex) {
    return {
      id: ex.id,
      name: ex.name,
      muscle: ex.muscle,
      sets: (ex.sets || []).map(function(s) {
        return { reps: s.reps, weight: s.weight, done: false };
      })
    };
  });
  return { routineId: routine.id, title: routine.title, startedAt: startedAt, exercises: logs };
}

/* Replace one set with updater(set), copying only the path to it. Returns
   the same session object when the indices do not resolve, so callers can
   rely on identity to detect "nothing changed". */
export function updateSessionSet(session, exIdx, setIdx, updater) {
  if (!session || !Array.isArray(session.exercises)) return session;
  const exs = session.exercises.slice();
  const src = exs[exIdx];
  if (!src || !Array.isArray(src.sets) || setIdx < 0 || setIdx >= src.sets.length) return session;
  const ex = Object.assign({}, src);
  ex.sets = ex.sets.slice();
  ex.sets[setIdx] = updater(ex.sets[setIdx]);
  exs[exIdx] = ex;
  return Object.assign({}, session, { exercises: exs });
}

/* Reps / weight edit. Mirrors the pre-existing updateActiveSet(): negative
   values are floored at 0. Every other key on the set — including any
   metadata — is preserved. */
export function updateSetNumberField(session, exIdx, setIdx, field, value) {
  const v = value < 0 ? 0 : value;
  return updateSessionSet(session, exIdx, setIdx, function(set) {
    const next = Object.assign({}, set);
    next[field] = v;
    return next;
  });
}

/* Completion toggle. Only `done` changes. */
export function toggleSetDone(session, exIdx, setIdx) {
  return updateSessionSet(session, exIdx, setIdx, function(set) {
    return Object.assign({}, set, { done: !set.done });
  });
}

/* Metadata edit from raw interactive input. Returns
   { ok: true, session } or { ok: false, error, session } where `session`
   is the untouched original on failure — an invalid entry never replaces
   a prior valid value. */
export function updateSetMetadataInput(session, exIdx, setIdx, field, raw) {
  let result = { ok: true, error: null };
  const next = updateSessionSet(session, exIdx, setIdx, function(set) {
    const r = applyMetadataInput(set, field, raw);
    result = r;
    return r.set;
  });
  if (!result.ok) return { ok: false, error: result.error, session: session };
  return { ok: true, session: next };
}

/* Remove every metadata field from one set. reps/weight/done untouched. */
export function clearSessionSetMetadata(session, exIdx, setIdx) {
  return updateSessionSet(session, exIdx, setIdx, clearSetMetadata);
}

/* The "Clear details" button: removes side / tempo / rom only. RIR has
   its own visible control in the row and is cleared from there. */
export function clearSessionSetDetails(session, exIdx, setIdx) {
  return updateSessionSet(session, exIdx, setIdx, clearSetDetails);
}

/* completedSets / totalSets, counting exactly as finishWorkout() did. */
export function countSessionSets(session) {
  let completedSets = 0, totalSets = 0;
  ((session && session.exercises) || []).forEach(function(ex) {
    (ex.sets || []).forEach(function(s) { totalSets++; if (s.done) completedSets++; });
  });
  return { completedSets: completedSets, totalSets: totalSets };
}

/* The workoutLog record. Field order and content match what
   ExerciseTab.finishWorkout() wrote before Milestone 2; `exercises` is
   passed through by reference exactly as before, so whatever the active
   session's sets carry (done:false sets, metadata, unknown keys) lands in
   storage untouched. */
export function buildCompletedWorkoutRecord(session, stamps) {
  const counts = countSessionSets(session);
  return {
    id: stamps.id,
    routineId: session.routineId,
    title: session.title,
    startedAt: session.startedAt,
    finishedAt: stamps.finishedAt,
    completedSets: counts.completedSets,
    totalSets: counts.totalSets,
    exercises: session.exercises
  };
}
