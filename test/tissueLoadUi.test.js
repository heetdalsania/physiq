import { test } from "node:test";
import assert from "node:assert/strict";
import { build } from "esbuild";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { buildTissueLoadView } from "../js/utils/tissueLoadView.js";

// Compile JSX in memory with the existing build tool; no new framework or files.
const bundle = await build({ stdin: { contents: `
  import React from 'react';
  import {renderToStaticMarkup} from 'react-dom/server';
  import {TissueLoadContent, TissueLoadDetail, TissueBodyDiagram, TissueLoadTracker} from './js/components/TissueLoadTracker.js';
  import {ExerciseTab} from './js/screens/ExerciseTab.js';
  export const render = (kind, props) => renderToStaticMarkup(React.createElement({content:TissueLoadContent,detail:TissueLoadDetail,body:TissueBodyDiagram,exercise:ExerciseTab,tracker:TissueLoadTracker}[kind], props));
`, resolveDir: process.cwd(), loader: "jsx" }, bundle: true, platform: "node", format: "cjs", write: false, loader: { ".js": "jsx" } });
const mod = { exports: {} };
new Function("require", "module", "exports", bundle.outputFiles[0].text)(createRequire(import.meta.url), mod, mod.exports);
const { render } = mod.exports;
const now = new Date(2026, 2, 4, 12);
const input = [{ finishedAt: now.getTime(), exercises: [
  { name: "Squat", sets: [{ done: true, weight: 225, reps: 5 }, { done: false, weight: 999, reps: 99, rir: 0 }] },
  { name: "Romanian Deadlift", sets: [{ done: true, weight: 155, reps: 8 }] },
  { name: "Unmapped exercise with a very long descriptive name", sets: [{ done: true, reps: 1, weight: 0 }] }
] }];
const getView = log => buildTissueLoadView(log, { now, bodyMass: 180 });
const content = (v, selected = "hamstrings", side = "back") => render("content", { view: v, side, selected, setSide() {}, setSelected() {} });

test("Tissue content shows exact workload, engine confidence, contributors and partial coverage", () => {
  const html = content(getView(input));
  assert.match(html, /2 of 3 completed sets modeled/);
  assert.match(html, /2,500 lb\*rep/);
  assert.match(html, /Model confidence: <strong>Low/);
  assert.match(html, /Romanian Deadlift/);
  assert.match(html, /1,960/);
  assert.match(html, /540/);
  assert.match(html, /Unmapped exercises \(1\)/);
  assert.match(html, /relative workload distribution within the selected period/);
  assert.match(html, /tissue-load-v0.1/);
  assert.doesNotMatch(html, /loadScore|out of 100/);
});

test("rendered values ignore incomplete sets and all Milestone 2 metadata", () => {
  const altered = structuredClone(input);
  altered[0].exercises[0].sets[1].weight = 999999;
  altered[0].exercises.forEach(ex => ex.sets.forEach(s => Object.assign(s, { rir: 5, side: "left", tempo: { eccentricSeconds: 8 }, rom: "full" })));
  assert.equal(content(getView(input)), content(getView(altered)));
});

test("front and back reuse actual region geometry, expose keyboard buttons and selected state", () => {
  const view = getView(input);
  const front = render("body", { side: "front", tissues: view.tissues, selected: "quadriceps", onSelect() {} });
  const back = render("body", { side: "back", tissues: view.tissues, selected: "hamstrings", onSelect() {} });
  assert.match(front, /Front tissue map/);
  assert.match(front, /Quadriceps, estimated workload 1,800 lb\*rep/);
  assert.match(front, /role="button" tabindex="0"/);
  assert.match(front, /aria-pressed="true" aria-controls="tissue-load-detail" data-tissue="quadriceps"/);
  assert.match(back, /Back tissue map/);
  assert.match(back, /data-tissue="hamstrings"/);
  assert.doesNotMatch(front + back, /data-tissue="(?:patellar_tendon|achilles_tendon)"/);
});

test("tendons stay available in list and detail with provisional mechanical-relevance qualification", () => {
  const html = content(getView(input), "patellar_tendon");
  assert.match(html, /Other modeled tissues/);
  assert.match(html, /Patellar tendon · Selected/);
  assert.match(html, /Achilles tendon/);
  assert.match(html, /1,440 lb\*rep/);
  assert.match(html, /Provisional mechanical relevance only, not an estimated tendon force or stress fraction/);
});

test("empty, no completed sets, entirely unmapped and modeled-zero render distinct messages", () => {
  assert.match(content(getView([])), /No completed workouts today/);
  assert.match(content(getView([{ finishedAt: now.getTime(), exercises: [] }])), /No completed sets/);
  const unknown = structuredClone(input);
  unknown[0].exercises = [unknown[0].exercises[2]];
  assert.match(content(getView(unknown)), /not yet covered by the TissueOS model/);
  const zero = [{ finishedAt: now.getTime(), exercises: [{ name: "Lying Leg Curl", sets: [{ done: true, reps: 10, weight: 0 }] }] }];
  assert.match(content(getView(zero)), /Mapped completed sets produced zero modeled workload/);
  assert.match(content(getView(zero), "chest"), /No modeled workload in this period/);
});

test("Training Volume stays default with original targets, colors and separate Recovery Tracker", () => {
  const html = render("exercise", { routines: [], weeklyMuscles: { dates: {}, sessions: {}, sets: { chest: 3 } }, setTargets: { chest: 8 } });
  assert.match(html, /aria-pressed="true">Training Volume/);
  assert.match(html, /aria-pressed="false">Tissue Load/);
  assert.match(html, /Weekly Muscle Tracker/);
  assert.match(html, /md-state-partial/);
  assert.match(html, /Recovery/);
  assert.doesNotMatch(html, /aria-label="Tissue Load"/);
});

test("both Exercise entry points consume the active profile history and body mass", () => {
  const app = readFileSync(new URL("../js/App.js", import.meta.url), "utf8");
  const entries = app.match(/<ExerciseTab[\s\S]*?\/>/g);
  assert.equal(entries.length, 2);
  entries.forEach(entry => {
    assert.match(entry, /key=\{email\}/);
    assert.match(entry, /workoutLog=\{workoutLog\}/);
    assert.match(entry, /bodyMass=\{profile.weight\}/);
  });
});

// ── Milestone 4: longitudinal detail ────────────────────────────────────
// Rendered through the same in-memory bundle; `history` comes from the pure
// analytics module over synthetic tissue-history-v1 entries.

import { buildTissueLoadHistory, addDays } from "../js/utils/tissueLoadHistory.js";
import { reconcileTissueHistory } from "../js/utils/tissueHistoryStore.js";
import { installLocalStorageStub, uninstallLocalStorageStub } from "./helpers/localStorageStub.js";

const D = "2026-03-31";
const dayN = n => addDays(D, n);
let seqUi = 0;
const H = (localDate, workload, opts = {}) => ({
  schemaVersion: "tissue-history-v1", sourceKey: localDate + "#ui" + (seqUi++), sourceId: 1, sourceFinishedAt: 0, sourceFingerprint: "fp1:0000000000000000:1",
  localDate, utcOffsetMinutes: 0, modelVersion: opts.model || "tissue-load-v0.1", mapVersion: "exercise-tissue-map-v0.1", workloadUnit: "lb*rep",
  inputs: { bodyMass: 180, weightUnit: "lb", bodyMassProvenance: { source: opts.approx ? "profile_weight" : "weight_log", measurementDate: null, daysBefore: null, contemporaneous: !opts.approx, approximate: !!opts.approx } },
  tissues: { hamstrings: { workload, eventCount: 1, confidence: "low" } },
  coverage: { completedSets: opts.completed == null ? 1 : opts.completed, modeledSets: opts.modeled == null ? 1 : opts.modeled, unmappedExercises: [] }, warnings: [], materializedAt: 0
});
const BASE_UI = () => [H(dayN(-34), 400), H(dayN(-20), 400), H(dayN(-8), 400), H(dayN(-7), 400)];
const detail = (entries, extra = {}) => render("detail", { tissue: getView(input).tissues.find(t => t.id === "hamstrings"), workloadUnit: "lb*rep", modelVersion: "tissue-load-v0.1", history: buildTissueLoadHistory(entries, { today: D }), ...extra });
const FORBIDDEN = /\b(capacity|recover(?:y|ed)?|ready|readiness|risk|injur\w*|safe|danger\w*|overload\w*|damage|stress|force|strain|optimal|should|rest)\b/i;
/* No threshold vocabulary and no traffic-light semantics anywhere in the new block. */
const STATUS_WORDS = /\b(normal|elevated|high|moderate|low load|red|amber|yellow|green|caution|warning)\b/i;
const longitudinalBlock = html => html.slice(html.indexOf("Recent exposure"), html.indexOf("Derived from completed logged sets"));
/* Only explicit negations are allowed in the longitudinal copy. Strip them, then nothing biological may remain. */
const audit = html => {
  const block = longitudinalBlock(html);
  assert.equal(block.match(STATUS_WORDS), null, "threshold/status vocabulary in longitudinal UI: " + block);
  const stripped = block
    .replace(/It is a descriptive comparison with your own logged history, not injury risk, recovery or capacity\./g, "")
    .replace(/not tissue capacity, and it makes no training recommendation\./g, "");
  const hit = stripped.match(FORBIDDEN);
  assert.equal(hit, null, "forbidden term in longitudinal UI: " + (hit && hit[0]) + "\n" + stripped);
};

test("above-baseline detail shows exact 7/28-day sums, the per-7-day baseline, a signed percentage and a literal descriptor", () => {
  const html = detail(BASE_UI().concat(H(D, 480)));
  assert.match(html, /Last 7 days<\/dt><dd class="mono">480 lb\*rep/);
  assert.match(html, /Last 28 days<\/dt><dd class="mono">1,680 lb\*rep/);
  assert.match(html, /Recent baseline<\/dt><dd class="mono">400 lb\*rep<small>per 7 days, Feb 25 – Mar 24/);
  assert.match(html, /Change vs recent baseline<\/dt><dd class="mono">\+20%<small>above recent modeled baseline/);
  assert.match(html, /20% above the mean of the four 7-day periods before them \(400 lb\*rep\)/);
  assert.match(html, /Coverage: last 7 days 1 of 1 completed sets modeled; last 28 days 4 of 4 completed sets modeled; baseline period 4 of 4 completed sets modeled\./);
  assert.match(html, /history begins Feb 25/);
  assert.doesNotMatch(longitudinalBlock(html), /class="[^"]*(?:warn|danger|alert|success|status)/, "no status styling hooks");
  audit(html);
});

test("below and equal comparisons are rendered as negative/zero percentages, never as a status", () => {
  const below = detail(BASE_UI().concat(H(D, 300)));
  assert.match(below, /−25%<small>below recent modeled baseline/);
  assert.match(below, /25% below the mean/);
  const equal = detail(BASE_UI().concat(H(dayN(-2), 400)));
  assert.match(equal, /\+0%<small>equal to recent modeled baseline/);
  audit(below); audit(equal);
});

test("insufficient history states are honest: no history, partial 7-day window, baseline not yet available", () => {
  const none = detail([]);
  assert.match(none, /No modeled history yet/);
  assert.doesNotMatch(none, /Last 7 days/);
  const young = detail([H(dayN(-2), 100), H(D, 50)]);
  assert.match(young, /150 lb\*rep<small>3 of 7 days since first log/);
  assert.match(young, /150 lb\*rep<small>3 of 28 days since first log/);
  assert.match(young, /Recent baseline<\/dt><dd class="mono">Not yet available/);
  assert.match(young, /Change vs recent baseline<\/dt><dd class="mono">Not comparable/);
  assert.match(young, /Baseline needs modeled history covering the 28 days before the last 7 days \(Feb 25 – Mar 24\)\. History begins Mar 29\./);
  audit(none); audit(young);
});

test("zero baselines explain themselves and never show Infinity, NaN or a percentage", () => {
  const empty = detail([H(dayN(-40), 5), H(D, 100)]);
  assert.match(empty, /Recent baseline<\/dt><dd class="mono">0 lb\*rep<small>per 7 days/);
  assert.match(empty, /Not comparable/);
  assert.match(empty, /No completed workouts in the baseline period \(Feb 25 – Mar 24\), so no percentage is shown\./);
  const unmapped = detail([H(dayN(-40), 5), H(dayN(-20), 0, { completed: 4, modeled: 0 }), H(D, 100)]);
  assert.match(unmapped, /Completed sets in the baseline period \(Feb 25 – Mar 24\) were not covered by the model, so no percentage is shown\./);
  assert.match(unmapped, /Unmapped sets are excluded from every total above/);
  for (const html of [empty, unmapped]) { assert.doesNotMatch(html, /Infinity|NaN|∞|%<small>(above|below)/); audit(html); }
});

test("partial coverage, approximate legacy context and foreign model series are visible, never merged", () => {
  const entries = BASE_UI().map(e => ({ ...e, coverage: { completedSets: 10, modeledSets: 2, unmappedExercises: ["Rowing"] } })).concat(H(D, 480, { approx: true }), H(dayN(-1), 99999, { model: "tissue-load-v0.2" }));
  const html = detail(entries);
  assert.match(html, /last 7 days 1 of 1 completed sets modeled; last 28 days 7 of 31 completed sets modeled; baseline period 8 of 40 completed sets modeled\. Unmapped sets are excluded/);
  assert.match(html, /Some older estimates use limited historical profile data: no dated weight measurement was available for 1 workout in these windows\./);
  assert.match(html, /1 history entry from a different model version is kept separately and not included\./);
  assert.match(html, /Last 7 days<\/dt><dd class="mono">480 lb\*rep/);
  assert.doesNotMatch(html, /99,999/);
  audit(html);
});

test("storage-state notices are shown for unreadable, unsupported, unsaved and source-unreadable history", () => {
  const entries = BASE_UI().concat(H(D, 480));
  assert.match(detail(entries, { storageState: "malformed" }), /Saved modeled history could not be read\. The original was kept/);
  assert.match(detail(entries, { storageState: "unsupported" }), /written by a newer version of the app and has been left unchanged/);
  assert.match(detail(entries, { storageState: "write_failed" }), /could not be saved this time\. It will be rebuilt automatically/);
  assert.match(detail(entries, { storageState: "source_unreadable" }), /Workout history could not be read/);
  assert.doesNotMatch(detail(entries, { storageState: "unchanged" }), /could not be|newer version/);
  assert.match(render("detail", { tissue: getView(input).tissues[0], workloadUnit: "lb*rep", modelVersion: "tissue-load-v0.1", history: null }), /Modeled history is not loaded yet/);
});

test("the Milestone 3 period value uses each workout's frozen body mass, and a later current-weight change does not move it", () => {
  installLocalStorageStub();
  try {
    const email = "ui-frozen@example.com";
    // The tracker reads AppTime.now() (real clock outside Dev Mode), so date the workout "now".
    const t = Date.now();
    const log = [{ id: 1, finishedAt: t, exercises: [{ name: "Squat", sets: [{ done: true, weight: 225, reps: 5 }] }] }];
    const history = reconcileTissueHistory({ email, workoutLog: log, profile: { weight: 180, weightLog: [] }, now: t, persist: true });
    const html = render("tracker", { workoutLog: log, bodyMass: 150, tissueHistory: history });
    assert.match(html, /Quadriceps, estimated workload 1,800 lb\*rep/, "5 × (225 + 0.75 × 180), not 0.75 × 150");
    const without = render("tracker", { workoutLog: log, bodyMass: 150, tissueHistory: null });
    assert.match(without, /Quadriceps, estimated workload 1,687.5 lb\*rep/, "without history the M3 fallback (current weight) still applies");
    assert.match(html, /Body-mass bands are coarse assumptions\. Each saved workout(?:&#x27;|')s body mass is frozen with its history record/);
    assert.match(html, /saved with this profile as tissue-history-v1/);
  } finally { uninstallLocalStorageStub(); }
});

test("review: missing logging telemetry is disclosed instead of calling absent days observed", () => {
  const html = detail([H('2026-01-01', 100)]);
  assert.match(html, /zero logged workload/);
  assert.match(html, /cannot distinguish unlogged training from no training/);
  assert.doesNotMatch(html, /days observed/);
});

test("review: foreign-only, future-only and invalid histories remain visible in empty state", () => {
  assert.match(detail([H(D, 999, { model: 'tissue-load-v0.2' })]), /different model version/);
  assert.match(detail([H('2027-01-01', 100)]), /Future-dated workouts are kept but excluded/);
  assert.match(detail([H(D, -100)]), /invalid values and are excluded/);
});

test("review: numeric overflow renders unavailable without Infinity or an invented zero", () => {
  const html = detail(BASE_UI().concat(H(D, 1e308), H(D, 1e308)));
  assert.match(html, /Last 7 days<\/dt><dd class="mono">Not available/);
  assert.match(html, /exceed the supported numeric range/);
  assert.doesNotMatch(html, /Infinity|NaN/);
});

test("review: asymmetric mapping coverage remains explicit in both comparison directions", () => {
  for (const reverse of [false, true]) {
    const baseline = H('2026-02-25', 400, { completed: 10, modeled: reverse ? 10 : 1 });
    const recent = H(D, 200, { completed: 10, modeled: reverse ? 1 : 10 });
    const html = detail([baseline, recent]);
    assert.match(html, /\+100%/);
    assert.match(html, new RegExp('last 7 days ' + (reverse ? 1 : 10) + ' of 10 completed sets modeled'));
    assert.match(html, new RegExp('baseline period ' + (reverse ? 10 : 1) + ' of 10 completed sets modeled'));
    assert.match(html, /comparison covers modeled exercises only/);
  }
});
