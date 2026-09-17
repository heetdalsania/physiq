/* Captures tissue-load-v0.1 outputs from the CURRENT (pre-Milestone-2) engine
   for fixed synthetic sessions. Written once, before any source edit. */
import { writeFileSync } from "node:fs";
import { execSync } from "node:child_process";
import { estimateSessionTissueLoad, estimateSetTissueLoad } from "../../js/tissue/loadEngine.js";
import {
  DEMO_SESSION_COMPLETE, DEMO_SESSION_PARTIAL, DEMO_SESSION_LATER, DEMO_SESSION_B, DEMO_ACTIVE_SESSION
} from "../../js/dev/demoFixtures.js";

/* Extra synthetic session: mapped + unmapped + zero weight + incomplete, fixed ids/timestamps. */
const SYNTHETIC_MIXED = {
  id: 8500, routineId: 9500, title: "Synthetic Mixed",
  startedAt: 1772634600000, finishedAt: 1772637000000,
  completedSets: 5, totalSets: 7,
  exercises: [
    { id: 95001, name: "Squat", muscle: "Quads", sets: [
      { reps: 5, weight: 225, done: true }, { reps: 5, weight: 225, done: true }, { reps: 5, weight: 225, done: false } ] },
    { id: 95002, name: "Push-Up", muscle: "Chest", sets: [
      { reps: 15, weight: 0, done: true } ] },
    { id: 95003, name: "Lunge", muscle: "Quads", sets: [
      { reps: 12, weight: 30, done: true }, { reps: 12, weight: 30, done: false } ] },
    { id: 95004, name: "Treadmill Run", muscle: "Cardio", sets: [
      { reps: 1, weight: 0, done: true } ] }
  ]
};

const sessions = {
  DEMO_SESSION_COMPLETE, DEMO_SESSION_PARTIAL, DEMO_SESSION_LATER, DEMO_SESSION_B, DEMO_ACTIVE_SESSION, SYNTHETIC_MIXED
};
const contexts = { explicit180: { bodyMass: 180 }, none: undefined };
/* Demo fixtures build timestamps from LOCAL calendar dates, so pin them to fixed
   epoch literals here (and in the test) so the golden file is timezone-independent. */
const FIXED = { startedAt: 1772634600000, finishedAt: 1772637000000 };
function pinned(s) { return Object.assign({}, s, FIXED); }

const out = {
  generatedFrom: execSync("git rev-parse HEAD").toString().trim(),
  note: "Golden outputs of js/tissue/loadEngine.js captured BEFORE Milestone 2 edits. Regenerate only on a deliberate model-version bump.",
  sessions: {}, sets: {}
};
Object.keys(sessions).forEach(function(sn) {
  out.sessions[sn] = {};
  Object.keys(contexts).forEach(function(cn) {
    out.sessions[sn][cn] = estimateSessionTissueLoad(pinned(sessions[sn]), contexts[cn]);
  });
});
const setCases = {
  squat_done: [{ name: "Squat" }, { reps: 5, weight: 225, done: true }, { bodyMass: 180 }],
  squat_incomplete: [{ name: "Squat" }, { reps: 5, weight: 225, done: false }, { bodyMass: 180 }],
  pushup_zero_weight: [{ name: "Push-Up" }, { reps: 15, weight: 0, done: true }, { bodyMass: 180 }],
  bench_default_mass: [{ name: "Barbell Bench Press" }, { reps: 8, weight: 135, done: true }, undefined],
  unmapped: [{ name: "Treadmill Run" }, { reps: 1, weight: 0, done: true }, { bodyMass: 180 }],
  invalid_reps: [{ name: "Squat" }, { reps: "abc", weight: 225, done: true }, { bodyMass: 180 }]
};
Object.keys(setCases).forEach(function(k) {
  const c = setCases[k];
  out.sets[k] = { input: { exercise: c[0], set: c[1], context: c[2] === undefined ? null : c[2] }, output: estimateSetTissueLoad(c[0], c[1], c[2]) };
});
out.pinnedTimestamps = FIXED;
out.syntheticMixedInput = SYNTHETIC_MIXED;
writeFileSync(process.argv[2], JSON.stringify(out, null, 2) + "\n");
console.log("wrote", process.argv[2], "from", out.generatedFrom, "sessions:", Object.keys(out.sessions).length, "sets:", Object.keys(out.sets).length);
