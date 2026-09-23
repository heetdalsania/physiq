/* Milestone 6 — Movement Assessment presentation: every state renders, the
   required copy is present, accessibility hooks exist, and no user-facing
   text crosses the scientific claim boundary. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { build } from "esbuild";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { normalizePoseResult, BLAZEPOSE_INDEX } from "../js/movement/poseContract.js";
import { evaluateCalibration } from "../js/movement/calibration.js";
import { analyzeSquatCapture } from "../js/movement/squatAssessment.js";
import { providerResultAt } from "./fixtures/syntheticPose.js";

const bundle = await build({ stdin: { contents: `
  import React from 'react';
  import {renderToStaticMarkup} from 'react-dom/server';
  import * as MA from './js/components/MovementAssessment.js';
  import {ExerciseTab} from './js/screens/ExerciseTab.js';
  export const MAmod = MA;
  export const renderView = (state) => renderToStaticMarkup(React.createElement(MA.MovementAssessmentView, { state, videoRef() {}, headingRef: { current: null }, actions: { start() {}, retake() {}, cancel() {}, finish() {}, exit() {} } }));
  export const renderChart = (result) => renderToStaticMarkup(React.createElement(MA.AngleTraceChart, { result }));
  export const renderExercise = (props) => renderToStaticMarkup(React.createElement(ExerciseTab, props));
`, resolveDir: process.cwd(), loader: "jsx" }, bundle: true, platform: "node", format: "cjs", write: false, loader: { ".js": "jsx" } });
const mod = { exports: {} };
new Function("require", "module", "exports", bundle.outputFiles[0].text)(createRequire(import.meta.url), mod, mod.exports);
const { MAmod, renderView, renderChart, renderExercise } = mod.exports;

const frame = (raw, t) => normalizePoseResult(raw, { timestampMs: t, frameWidth: 640, frameHeight: 480 });
const cal = [];
for (let t = 0; t <= 2000; t += 100) cal.push(frame(providerResultAt(t, "squat"), t));
const calibration = evaluateCalibration(cal);
const capture = (fn) => { const out = []; for (let t = 2100; t <= 8000; t += 100) out.push(fn(t)); return out; };
const complete = analyzeSquatCapture({ calibration, captureFrames: capture((t) => frame(providerResultAt(t, "squat"), t)), modelVerified: true });
const noTrunk = analyzeSquatCapture({ calibration, captureFrames: capture((t) => {
  const raw = providerResultAt(t, "squat");
  raw.landmarks[0][BLAZEPOSE_INDEX.left_shoulder] = Object.assign({}, raw.landmarks[0][BLAZEPOSE_INDEX.left_shoulder], { visibility: 0.1 });
  return frame(raw, t);
}), modelVerified: true });
const insufficient = analyzeSquatCapture({ calibration, captureFrames: capture((t) => frame(providerResultAt(t, "stand"), t)), modelVerified: true });

const base = { phase: "idle", guidance: null, progress: 0, errorCode: null, positioningReason: null, analysisSide: null, result: null, hasStream: false };
const S = (patch) => Object.assign({}, base, patch);
const text = (html) => html.replace(/<[^>]+>/g, " ").replace(/&[a-z#0-9]+;/g, " ").replace(/\s+/g, " ");

const ERROR_CODES = ["permission_denied", "no_camera", "camera_in_use", "unsupported_browser", "camera_error", "runtime_unavailable", "model_unavailable", "model_integrity", "model_init_failed", "unsupported_runtime", "interrupted_background", "camera_interrupted", "orientation_changed", "analysis_failed"];
const GUIDANCE = ["no_frames", "no_person", "multiple_people", "no_side_visible", "low_visibility", "body_not_in_frame", "not_side_on", "not_still", "collecting"];

function allRenderedStates() {
  const out = [renderView(S({ phase: "idle" }))];
  ["loading_model", "starting_camera", "analyzing"].forEach((p) => out.push(renderView(S({ phase: p }))));
  GUIDANCE.forEach((g) => out.push(renderView(S({ phase: g === "collecting" ? "calibrating" : "positioning", guidance: g, progress: 0.4 }))));
  out.push(renderView(S({ phase: "capturing", guidance: "squat_now", progress: 0.3 })));
  out.push(renderView(S({ phase: "results", result: complete })));
  out.push(renderView(S({ phase: "results", result: noTrunk })));
  out.push(renderView(S({ phase: "insufficient", result: insufficient })));
  out.push(renderView(S({ phase: "insufficient", result: null, positioningReason: "not_side_on" })));
  ["insufficient_valid_frames", "no_clear_repetition", "repetition_started_before_capture", "did_not_return_to_standing", "multiple_repetitions", "data_gap_during_repetition", "too_few_samples_in_repetition", "insufficient_capture_quality", "calibration_incomplete"]
    .forEach((r) => out.push(renderView(S({ phase: "insufficient", result: Object.assign({}, insufficient, { insufficientReason: r }) }))));
  ERROR_CODES.forEach((c) => out.push(renderView(S({ phase: "error", errorCode: c }))));
  return out;
}

test("intro: purpose, truthful privacy notice, full setup list, protocol and an explicit Start Camera", () => {
  const html = renderView(S({ phase: "idle" }));
  const t = text(html);
  assert.match(t, /Movement Assessment/);
  assert.match(t, /Prototype/);
  assert.match(t, /Bodyweight Squat — Side View/);
  assert.match(t, /Step 1 of 4: Setup/);
  assert.match(t, /Camera video is processed on this device for this assessment\. Raw video is not saved or uploaded by this prototype\./);
  [/stable surface/, /side-on/i, /head to feet/, /feet visible/, /level rather than tilted/, /bright, even lighting/, /only person in view/, /clothing/, /the app does not measure distance/]
    .forEach((re) => assert.match(t, re));
  assert.match(t, /Stand still, side-on, until the screen shows “Squat now”/);
  assert.match(html, /<button type="button" class="btn btn-primary ma-primary">Start Camera<\/button>/);
  assert.doesNotMatch(html, /<video/, "no camera element before the user starts");
  assert.doesNotMatch(t, /training|consent to|research use|improve our model/i, "no training-data consent flow");
});

test("active states: live preview is muted, inline, labelled; status is announced; Cancel always present", () => {
  const html = renderView(S({ phase: "positioning", guidance: "not_side_on" }));
  assert.match(html, /<video[^>]*class="ma-video"[^>]*>/);
  assert.match(html, /muted=""/);
  assert.match(html, /playsInline=""|playsinline=""/i);
  assert.match(html, /aria-label="Live camera preview, not recorded"/);
  assert.match(html, /role="status" aria-live="polite"[^>]*>Turn so that your side faces the camera\./);
  assert.match(html, />Cancel<\/button>/);
  assert.match(text(html), /Step 2 of 4: Camera and positioning/);
  assert.match(text(renderView(S({ phase: "calibrating", guidance: "collecting", progress: 0.5 }))), /Step 3 of 4: Calibration/);
  const cap = renderView(S({ phase: "capturing", guidance: "squat_now", progress: 0.3 }));
  assert.match(text(cap), /Step 4 of 4: One squat/);
  assert.match(cap, />Done<\/button>/);
  assert.match(cap, /role="progressbar"[^>]*aria-valuenow="30"/);
});

test("results: ROM, timing, trace, symmetry-unavailable, capture quality, identity and limitation", () => {
  const html = renderView(S({ phase: "results", result: complete }));
  const t = text(html);
  assert.match(t, /Apparent 2D knee ROM 80°/);
  assert.match(t, /standing 175° → minimum 95°/);
  assert.match(t, /Descent time 1\.1 s/);
  assert.match(t, /Ascent time 1\.5 s/);
  assert.match(t, /Detected repetition time 2\.6 s/);
  assert.match(t, /Times run between the detected 10% knee-angle crossings/);
  assert.match(t, /Apparent 2D trunk–thigh angle change 75°/);
  assert.match(t, /Symmetry Not estimated for this capture mode/);
  assert.match(t, /Left\/right symmetry is not estimated from a single sagittal capture in this prototype\./);
  assert.match(t, /Video-estimated 2D angles/);
  assert.match(t, /Capture quality: Sufficient/);
  assert.match(t, /Describes how reliable this measurement is, not how you moved\./);
  assert.match(t, /Usable frames: 60 of 60 \(100%\)/);
  assert.match(t, /Median landmark visibility reported by the pose model: 0\.95/);
  assert.match(t, /Analysed about 10 frames per second/);
  assert.match(t, /pose_landmarker_full/);
  assert.match(t, /movement-assessment-v0\.1 · squat-kinematics-v0\.2/);
  assert.match(t, /verified on this device/);
  assert.match(t, /This prototype estimates 2D movement mechanics from a single camera view\. It does not measure force, tissue load, injury risk, or recovery\./);
  assert.match(html, />Retake<\/button>/);
  assert.match(html, /<h3 class="ma-result-heading" tabindex="-1">Results<\/h3>/);
  assert.doesNotMatch(t, /Your true knee flexion/);
});

test("results without a reliable trunk–thigh trace say so instead of showing a number", () => {
  const t = text(renderView(S({ phase: "results", result: noTrunk })));
  assert.match(t, /Apparent 2D trunk–thigh angle change Not available landmark quality too low for this angle/);
  assert.doesNotMatch(t, /Trunk–thigh \(dashed\)/);
});

test("insufficient data shows the reason and no measurement values", () => {
  const t = text(renderView(S({ phase: "insufficient", result: insufficient })));
  assert.match(t, /Insufficient movement data/);
  assert.match(t, /No squat could be told apart from small movements/);
  assert.match(t, /No measurements are shown/);
  assert.doesNotMatch(t, /Apparent 2D knee ROM|Descent time|\d+°/);
  const pos = text(renderView(S({ phase: "insufficient", result: null, positioningReason: "not_side_on" })));
  assert.match(pos, /not established within 45 seconds/);
  assert.match(pos, /Turn so that your side faces the camera/);
  const ambiguous = text(renderView(S({ phase: "insufficient", result: { ...insufficient, insufficientReason: "multiple_people_during_capture" } })));
  assert.match(ambiguous, /More than one person entered the camera view during capture/);
  assert.doesNotMatch(ambiguous, /Apparent 2D knee ROM\s+\d+°/);
});

test("errors are announced (role=alert) with concise recovery guidance and an explicit retry", () => {
  const html = renderView(S({ phase: "error", errorCode: "permission_denied" }));
  assert.match(html, /role="alert">Camera access is required for this assessment\. You can enable it in your device or browser settings and try again\.</);
  assert.match(html, />Try again<\/button>/);
  ERROR_CODES.forEach((c) => {
    const t = text(renderView(S({ phase: "error", errorCode: c })));
    assert.doesNotMatch(t, /undefined|null|Error:|stack|\.wasm|at [A-Za-z]+ \(/, c);
  });
});

test("trace chart: time on x, degrees on y, neutral markers, textual equivalent, no NaN in paths", () => {
  const html = renderChart(complete);
  assert.match(html, /role="img" aria-labelledby="ma-chart-title ma-chart-desc"/);
  assert.match(html, /<title id="ma-chart-title">Joint-angle trace<\/title>/);
  assert.match(html, />seconds</);
  assert.match(html, />start<.*>deepest<.*>end</s);
  assert.match(text(html), /Standing reference 175°, minimum 95° at 2\.1 s/);
  assert.doesNotMatch(html, /NaN|Infinity|undefined/);
  const paths = html.match(/ d="([^"]*)"/g) || [];
  assert.equal(paths.length, 2);
  paths.forEach((p) => assert.match(p, /^ d="M[-0-9. ML]+"$/));

  const hostile = JSON.parse(JSON.stringify(complete));
  hostile.traces.knee[3].value = NaN;
  hostile.traces.knee[4].tMs = Infinity;
  hostile.traces.knee[5] = null;
  hostile.traces.knee[6].value = "90";
  const h2 = renderChart(hostile);
  assert.doesNotMatch(h2, /NaN|Infinity/);
  assert.equal(renderChart(insufficient), "", "no chart without data");
  assert.equal(MAmod.tracePath([{ tMs: 0, value: 1 }, { tMs: 1, value: NaN }, { tMs: 2, value: 3 }], (x) => x, (y) => y), "M0.0 1.0M2.0 3.0");
});

test("formatting: seconds to 0.1 s, whole degrees, and 'Not available' for anything non-finite or negative", () => {
  assert.equal(MAmod.formatSeconds(1080), "1.1 s");
  assert.equal(MAmod.formatSeconds(0), "0.0 s");
  assert.equal(MAmod.formatSeconds(-1), "Not available");
  assert.equal(MAmod.formatSeconds(NaN), "Not available");
  assert.equal(MAmod.formatSeconds(Infinity), "Not available");
  assert.equal(MAmod.formatDegrees(79.6), "80°");
  assert.equal(MAmod.formatDegrees(null), "Not available");
});

test("language audit: no claim-boundary words in any rendered state, except the fixed limitation sentences", () => {
  const allowed = [MAmod.LIMITATION_TEXT, MAmod.SEPARATION_TEXT];
  const forbidden = /\b(injur\w*|risk\w*|safe|unsafe|safely|force|stress|strain|tendon load|tissue load|recover\w*|ready|readiness|healed?|diagnos\w*|mobility issue|good form|bad form|optimal|should|recommend\w*|score|grade|poor|average|excellent|normal range)\b/i;
  allRenderedStates().forEach((html) => {
    let t = text(html);
    allowed.forEach((s) => { t = t.split(s).join(" "); });
    assert.doesNotMatch(t, forbidden, t.slice(0, 200));
  });
  // The allowed sentences are themselves negations / separations.
  assert.match(MAmod.LIMITATION_TEXT, /does not measure force, tissue load, injury risk, or recovery/);
  assert.match(MAmod.SEPARATION_TEXT, /separate from Tissue Load and Recovery Guidance/);
});

test("no traffic-light colours or status colours in the component or its CSS", () => {
  const src = readFileSync(new URL("../js/components/MovementAssessment.js", import.meta.url), "utf8");
  assert.doesNotMatch(src, /--red|--green|--amber|--yellow|--orange|#EF4444|#22C55E|#F97316|#EAB308/i);
  const css = readFileSync(new URL("../css/styles.css", import.meta.url), "utf8");
  const maRules = css.split("\n").filter((l) => /^\.ma-/.test(l)).join("\n");
  assert.ok(maRules.length > 0);
  assert.doesNotMatch(maRules, /--red|--green|--amber|--yellow|--orange|--pink/);
});

test("Exercise screen: discoverable entry, labelled as a separate prototype; no camera until opened", () => {
  const html = renderExercise({ routines: [], saveRoutine() {}, deleteRoutine() {}, logCompletedWorkout() {}, weeklyMuscles: { weekStart: "2026-03-30", dates: {}, sessions: {}, sets: {} }, setTargets: {}, updateSetTarget() {}, workoutLog: [], bodyMass: 180, tissueHistory: null });
  const t = text(html);
  assert.match(html, /<button type="button" class="ma-entry">/);
  assert.match(t, /Movement Assessment Prototype/);
  assert.match(t, /Video-estimated 2D squat mechanics from your camera\. Separate from Tissue Load and Recovery Guidance\./);
  assert.doesNotMatch(html, /<video/);
});

test("the Exercise screen hands Movement Assessment nothing but an exit callback", () => {
  const src = readFileSync(new URL("../js/screens/ExerciseTab.js", import.meta.url), "utf8");
  const uses = src.match(/<MovementAssessment\b[^>]*\/>/g) || [];
  assert.equal(uses.length, 1);
  assert.match(uses[0], /^<MovementAssessment onExit=\{function\(\) \{ setView\("main"\); \}\} \/>$/);
});

test("displayed ROM always equals the displayed standing − minimum values", () => {
  assert.equal(MAmod.formatAngleChange({ valueDeg: 79.8, referenceDeg: 175.4, minimumDeg: 95.6 }), "79°");
  assert.equal(MAmod.formatAngleChange({ valueDeg: 80, referenceDeg: 175, minimumDeg: 95 }), "80°");
  assert.equal(MAmod.formatAngleChange({ valueDeg: 42.4, referenceDeg: null, minimumDeg: 95 }), "42°");
  assert.equal(MAmod.formatAngleChange(null), "Not available");
});
