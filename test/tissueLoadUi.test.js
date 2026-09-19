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
  import {TissueLoadContent, TissueLoadDetail, TissueBodyDiagram} from './js/components/TissueLoadTracker.js';
  import {ExerciseTab} from './js/screens/ExerciseTab.js';
  export const render = (kind, props) => renderToStaticMarkup(React.createElement({content:TissueLoadContent,detail:TissueLoadDetail,body:TissueBodyDiagram,exercise:ExerciseTab}[kind], props));
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
