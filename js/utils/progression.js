/* ─── PHYSIQ ENGINE — Progression Engine ──────────────────────────────────
 *
 * Deterministic progressive-overload event detection built on the workout
 * log. Pure functions, no storage or React dependencies, so the weekly
 * report (and future consumers) can call it with any week window.
 *
 * Definitions:
 *   - A session's "best" for a lift is its top completed (done) set:
 *     highest weight, ties broken by most reps at that weight.
 *   - Performance A beats B when A.weight > B.weight, or weights are
 *     equal and A.reps > B.reps. Bodyweight lifts (weight 0) therefore
 *     progress on reps.
 *   - A lift is "stalled" going into a week when its last three sessions
 *     before the week show no improvement between any consecutive pair.
 *
 * Weekly events (one per lift performed in the window):
 *   { lift, type: "weight", from, to, reps, wasStalled }   weight went up
 *   { lift, type: "reps", weight, from, to, wasStalled }   reps up at same weight
 *   { lift, type: "held", weight, reps, wasStalled }       no improvement
 *   { lift, type: "new",  weight, reps }                   first time performed
 * ───────────────────────────────────────────────────────────────────────── */

// Top completed set of one exercise entry, or null if no sets were done.
export function bestDoneSet(exercise) {
  let best = null;
  ((exercise && exercise.sets) || []).forEach(function(s) {
    if (!s || !s.done) return;
    const w = s.weight || 0;
    const r = s.reps || 0;
    if (!best || w > best.weight || (w === best.weight && r > best.reps)) {
      best = { weight: w, reps: r };
    }
  });
  return best;
}

// > 0 when a beats b, < 0 when b beats a, 0 when equal.
export function compareBests(a, b) {
  if (a.weight !== b.weight) return a.weight - b.weight;
  return a.reps - b.reps;
}

// { [liftName]: [{ t, weight, reps }] } sorted chronologically by session
// finish time. Sessions without a finish time and exercises without any
// completed set are skipped.
export function buildLiftHistory(workoutLog) {
  const hist = {};
  const sorted = (workoutLog || []).slice().sort(function(x, y) {
    return (x && x.finishedAt || 0) - (y && y.finishedAt || 0);
  });
  sorted.forEach(function(session) {
    if (!session || !session.finishedAt) return;
    (session.exercises || []).forEach(function(ex) {
      const best = bestDoneSet(ex);
      if (!best || !ex.name) return;
      if (!hist[ex.name]) hist[ex.name] = [];
      hist[ex.name].push({ t: session.finishedAt, weight: best.weight, reps: best.reps });
    });
  });
  return hist;
}

// Stalled going into the week: at least 3 pre-week sessions and no
// improvement between any consecutive pair of the last 3.
export function isStalled(preEntries) {
  if (!preEntries || preEntries.length < 3) return false;
  const last3 = preEntries.slice(-3);
  for (let i = 1; i < last3.length; i++) {
    if (compareBests(last3[i], last3[i - 1]) > 0) return false;
  }
  return true;
}

// Progression events for every lift performed inside [weekStartMs, weekEndMs).
// The week's best is compared against the last session before the window,
// so multiple in-week sessions collapse into one event. Lifts are returned
// in alphabetical order for a stable display.
export function getWeeklyProgression(workoutLog, weekStartMs, weekEndMs) {
  const hist = buildLiftHistory(workoutLog);
  const events = [];
  Object.keys(hist).sort().forEach(function(lift) {
    const entries = hist[lift];
    const pre = entries.filter(function(e) { return e.t < weekStartMs; });
    const inWeek = entries.filter(function(e) { return e.t >= weekStartMs && e.t < weekEndMs; });
    if (inWeek.length === 0) return;

    let weekBest = inWeek[0];
    inWeek.forEach(function(e) { if (compareBests(e, weekBest) > 0) weekBest = e; });

    if (pre.length === 0) {
      events.push({ lift: lift, type: "new", weight: weekBest.weight, reps: weekBest.reps });
      return;
    }

    const prev = pre[pre.length - 1];
    const wasStalled = isStalled(pre);
    if (weekBest.weight > prev.weight) {
      events.push({ lift: lift, type: "weight", from: prev.weight, to: weekBest.weight, reps: weekBest.reps, wasStalled: wasStalled });
    } else if (weekBest.weight === prev.weight && weekBest.reps > prev.reps) {
      events.push({ lift: lift, type: "reps", weight: weekBest.weight, from: prev.reps, to: weekBest.reps, wasStalled: wasStalled });
    } else {
      events.push({ lift: lift, type: "held", weight: weekBest.weight, reps: weekBest.reps, wasStalled: wasStalled });
    }
  });
  return events;
}

// "Moved" = an actual progression (weight or reps), not held/new.
export function countMoved(events) {
  return (events || []).filter(function(e) {
    return e.type === "weight" || e.type === "reps";
  }).length;
}
