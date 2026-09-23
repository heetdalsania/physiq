/* Milestone 6 — calibration, capture quality, ROM/timing and the
   movement-assessment-v0.1 result contract, end to end from synthetic
   provider output. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizePoseResult, BLAZEPOSE_INDEX } from "../js/movement/poseContract.js";
import { evaluateCalibration, CALIBRATION } from "../js/movement/calibration.js";
import { assessCaptureQuality, QUALITY } from "../js/movement/captureQuality.js";
import { analyzeSquatCapture, repetitionFinished, CAPTURE, SYMMETRY_UNAVAILABLE } from "../js/movement/squatAssessment.js";
import { MOVEMENT_ASSESSMENT_VERSION, SQUAT_KINEMATICS_VERSION, POSE_MODEL } from "../js/movement/modelVersion.js";
import { providerResultAt, providerPose, squatKneeAt, leanForKnee } from "./fixtures/syntheticPose.js";

const W = 640, H = 480;
const frame = (raw, t) => normalizePoseResult(raw, { timestampMs: t, frameWidth: W, frameHeight: H });
const calFrames = (scenario = "squat", opts) => {
  const out = [];
  for (let t = 0; t <= 2000; t += 100) out.push(frame(providerResultAt(t, scenario, opts), t));
  return out;
};
const capFrames = (fn, from = 2100, to = 8000, step = 100) => {
  const out = [];
  for (let t = from; t <= to; t += step) out.push(fn(t));
  return out;
};
const squatFrame = (t, opts) => frame(providerResultAt(t, "squat", opts), t);
const calibrated = () => evaluateCalibration(calFrames());

function deepKeys(obj, acc = []) {
  if (obj && typeof obj === "object") Object.keys(obj).forEach((k) => { acc.push(k); deepKeys(obj[k], acc); });
  return acc;
}
function assertAllFinite(obj, path = "result") {
  if (typeof obj === "number") assert.ok(Number.isFinite(obj), path + " = " + obj);
  else if (obj && typeof obj === "object") Object.keys(obj).forEach((k) => assertAllFinite(obj[k], path + "." + k));
}

/* ─── Calibration ─────────────────────────────────────────────────────── */

test("calibration: 2 s of still, side-on standing establishes side and references", () => {
  const c = calibrated();
  assert.equal(c.state, "complete");
  assert.equal(c.side, "left");
  assert.ok(Math.abs(c.referenceKneeDeg - 175) < 1e-9);
  assert.ok(Math.abs(c.referenceTrunkThighDeg - 177.5) < 1e-9);   // 180 − (2.5 + 0)
  assert.equal(c.usableFrames, 21);
  assert.equal(c.spanMs, 2000);
  assert.ok(c.hipSeparationRatio < CALIBRATION.maxHipSeparationRatio);
  assert.ok(c.standingHeightPx > 0);
  assert.equal("limbLengthCm" in c || "cameraDistance" in c, false);
});

test("calibration waits (collecting) until the window spans ~2 s", () => {
  const r = evaluateCalibration(calFrames().slice(0, 10));
  assert.equal(r.state, "incomplete");
  assert.equal(r.reason, "collecting");
  assert.ok(r.progress > 0 && r.progress < 1);
});

test("calibration refuses: no person, two people, frontal view, low visibility, moving, body out of frame", () => {
  assert.equal(evaluateCalibration(calFrames("none")).reason, "no_person");
  assert.equal(evaluateCalibration(calFrames("two")).reason, "multiple_people");
  assert.equal(evaluateCalibration(calFrames("front")).reason, "not_side_on");
  assert.equal(evaluateCalibration(calFrames("low")).reason, "no_side_visible");
  const moving = [];
  for (let t = 0; t <= 2000; t += 100) moving.push(frame({ landmarks: [providerPose(175 - (t % 400) / 10, 0)] }, t));
  assert.equal(evaluateCalibration(moving).reason, "not_still");
  const cropped = calFrames().map((f) => {
    const g = JSON.parse(JSON.stringify(f));
    g.landmarks.nose.inFrame = false;
    return g;
  });
  assert.equal(evaluateCalibration(cropped).reason, "body_not_in_frame");
  assert.equal(evaluateCalibration([]).reason, "no_frames");
});

/* ─── ROM ─────────────────────────────────────────────────────────────── */

test("ROM exact: reference 175°, minimum 95° → apparent ROM 80°", () => {
  const r = analyzeSquatCapture({ calibration: calibrated(), captureFrames: capFrames(squatFrame), modelVerified: true });
  assert.equal(r.status, "complete");
  assert.deepEqual(r.metrics.kneeRom, { state: "available", valueDeg: 80, referenceDeg: 175, minimumDeg: 95 });
  assert.deepEqual(r.metrics.trunkThighChange, { state: "available", valueDeg: 75, referenceDeg: 177.5, minimumDeg: 102.5 });
});

test("ROM noisy: ±2° landmark-angle noise keeps ROM within 3° of 80°", () => {
  let seed = 3;
  const rnd = () => { seed = (seed * 48271) % 2147483647; return seed / 2147483647; };
  const noisy = (t) => {
    const knee = squatKneeAt(t) + (rnd() - 0.5) * 4;
    return frame({ landmarks: [providerPose(knee, leanForKnee(knee))] }, t);
  };
  const cal = [];
  for (let t = 0; t <= 2000; t += 100) cal.push(noisy(t));
  const r = analyzeSquatCapture({ calibration: evaluateCalibration(cal), captureFrames: capFrames(noisy), modelVerified: true });
  assert.equal(r.status, "complete");
  assert.ok(Math.abs(r.metrics.kneeRom.valueDeg - 80) <= 3, String(r.metrics.kneeRom.valueDeg));
});

test("ROM unavailable: no calibration reference → no numbers anywhere", () => {
  const r = analyzeSquatCapture({ calibration: evaluateCalibration(calFrames("front")), captureFrames: capFrames(squatFrame), modelVerified: true });
  assert.equal(r.status, "insufficient_data");
  assert.equal(r.insufficientReason, "calibration_incomplete");
  assert.equal(r.metrics.kneeRom.state, "unavailable");
  assert.equal("valueDeg" in r.metrics.kneeRom, false);
  assert.equal(r.traces, null);
  assert.equal(r.events, null);
});

test("ROM unavailable: insufficient valid frames", () => {
  const cap = capFrames((t) => frame({ landmarks: [] }, t));
  const r = analyzeSquatCapture({ calibration: calibrated(), captureFrames: cap, modelVerified: true });
  assert.equal(r.status, "insufficient_data");
  assert.equal(r.insufficientReason, "insufficient_valid_frames");
  assert.equal(r.metrics.timing.state, "unavailable");
});

/* ─── Timing ──────────────────────────────────────────────────────────── */

test("timing: hand-calculated descent/ascent/total, rebased to the capture start", () => {
  const r = analyzeSquatCapture({ calibration: calibrated(), captureFrames: capFrames(squatFrame), modelVerified: true });
  // absolute: start 3120, deepest 4200, end 5680; capture origin 2100 ms
  assert.deepEqual(r.metrics.timing, { state: "available", descentMs: 1080, ascentMs: 1480, totalMs: 2560 });
  assert.deepEqual(r.events, { descentStartMs: 1020, deepestMs: 2100, ascentEndMs: 3580 });
  assert.equal(r.traces.knee[0].tMs, 0);
});

test("repetitionFinished: only after one repetition plus the 1 s standing hold", () => {
  const c = calibrated();
  const upTo = (end) => capFrames(squatFrame, 2100, end);
  assert.equal(repetitionFinished(upTo(5600), c), false);   // still ascending
  assert.equal(repetitionFinished(upTo(6600), c), false);   // 920 ms after 5680
  assert.equal(repetitionFinished(upTo(6700), c), true);    // 1020 ms after 5680
  assert.equal(repetitionFinished(upTo(6700), null), false);
  assert.equal(CAPTURE.postRepetitionHoldMs, 1000);
});

/* ─── Capture quality ─────────────────────────────────────────────────── */

test("quality: clean capture is sufficient", () => {
  const r = analyzeSquatCapture({ calibration: calibrated(), captureFrames: capFrames(squatFrame), modelVerified: true });
  assert.equal(r.quality.state, "sufficient");
  assert.equal(r.quality.usableFraction, 1);
  assert.equal(r.quality.totalFrames, 60);
  assert.equal(r.quality.captureDurationMs, 5900);
  r.quality.factors.forEach((f) => assert.equal(f.state, "pass", f.id));
});

test("quality: 50% of frames missing a critical joint → limited, numbers kept", () => {
  const cap = capFrames((t) => {
    const raw = providerResultAt(t, "squat");
    if ((t / 100) % 2 === 1) raw.landmarks[0][BLAZEPOSE_INDEX.left_knee] = null;
    return frame(raw, t);
  });
  const r = analyzeSquatCapture({ calibration: calibrated(), captureFrames: cap, modelVerified: true });
  assert.equal(r.quality.usableFraction, 0.5);
  assert.equal(r.quality.state, "limited");
  assert.equal(r.status, "complete");
  // 51% missing → insufficient
  const worse = capFrames((t) => {
    const raw = providerResultAt(t, "squat");
    if ((t / 100) % 2 === 1 || t === 2200) raw.landmarks[0][BLAZEPOSE_INDEX.left_knee] = null;
    return frame(raw, t);
  });
  const w = analyzeSquatCapture({ calibration: calibrated(), captureFrames: worse, modelVerified: true });
  assert.equal(w.quality.state, "insufficient");
  assert.equal(w.status, "insufficient_data");
});

test("quality: subject leaves the frame mid-squat → insufficient, no fabricated bottom", () => {
  const cap = capFrames((t) => (t > 3600 && t < 4800 ? frame({ landmarks: [] }, t) : squatFrame(t)));
  const r = analyzeSquatCapture({ calibration: calibrated(), captureFrames: cap, modelVerified: true });
  assert.equal(r.status, "insufficient_data");
  assert.equal(r.insufficientReason, "data_gap_during_repetition");
  assert.ok(r.quality.frameStatusCounts.no_pose > 0);
});

test("quality: insufficient frames", () => {
  const r = analyzeSquatCapture({ calibration: calibrated(), captureFrames: capFrames(squatFrame, 2100, 2500), modelVerified: true });
  assert.equal(r.quality.state, "insufficient");
  assert.equal(r.status, "insufficient_data");
});

test("quality: low model confidence (visibility 0.6, above the 0.5 gate) → limited", () => {
  const r = analyzeSquatCapture({ calibration: calibrated(), captureFrames: capFrames((t) => squatFrame(t, { pose: { nearVisibility: 0.6 } })), modelVerified: true });
  assert.equal(r.status, "complete");
  assert.equal(r.quality.state, "limited");
  assert.equal(r.quality.factors.find((f) => f.id === "landmark_confidence").state, "limited");
  assert.ok(r.quality.medianLandmarkVisibility < QUALITY.minMedianVisibility);
});

test("quality: a second person or moved feet/camera → limited; measurement values are unchanged", () => {
  const clean = analyzeSquatCapture({ calibration: calibrated(), captureFrames: capFrames(squatFrame), modelVerified: true });
  const withSecond = capFrames((t) => (t === 7900 ? frame(providerResultAt(t, "two"), t) : squatFrame(t)));
  const r = analyzeSquatCapture({ calibration: calibrated(), captureFrames: withSecond, modelVerified: true });
  assert.equal(r.quality.state, "limited");
  assert.equal(r.quality.factors.find((f) => f.id === "single_person").value, 1);
  assert.deepEqual(r.metrics, clean.metrics, "quality must not alter the measurement");

  const drift = analyzeSquatCapture({ calibration: calibrated(), captureFrames: capFrames((t) => squatFrame(t, { pose: { shiftX: 60 } })), modelVerified: true });
  assert.equal(drift.quality.factors.find((f) => f.id === "foot_stability").state, "limited");
  assert.equal(drift.metrics.kneeRom.valueDeg, 80);
});

test("quality labels describe measurement only", () => {
  const q = assessCaptureQuality({ captureFrames: [], side: null, calibration: {}, segmentation: { state: "insufficient", reason: "x" } });
  assert.ok(["sufficient", "limited", "insufficient"].includes(q.state));
  const words = JSON.stringify(q);
  assert.doesNotMatch(words, /good|bad|healthy|unsafe|safe|poor|optimal/i);
});

/* ─── Result contract ─────────────────────────────────────────────────── */

test("complete result carries every version, provenance and the explicit symmetry state", () => {
  const r = analyzeSquatCapture({ calibration: calibrated(), captureFrames: capFrames(squatFrame), modelVerified: true });
  assert.equal(r.contract, MOVEMENT_ASSESSMENT_VERSION);
  assert.equal(r.kinematicsVersion, SQUAT_KINEMATICS_VERSION);
  assert.equal(r.poseFrameContract, "pose-frame-v1");
  assert.deepEqual(r.assessment, { id: "bodyweight_squat_sagittal", label: "Bodyweight Squat — Side View", captureMode: "single_camera_sagittal", repetitionsRequested: 1 });
  assert.deepEqual(r.provenance, {
    provider: "mediapipe-tasks-vision", providerVersion: "0.10.35", task: "PoseLandmarker", delegate: "CPU",
    modelId: "pose_landmarker_full", modelVersion: "float16/1", modelSha256: POSE_MODEL.sha256, modelVerifiedOnDevice: true
  });
  assert.deepEqual(r.metrics.symmetry, { state: "unavailable_for_capture_mode", captureMode: "single_camera_sagittal", reason: "single_sagittal_view" });
  assert.deepEqual(Object.keys(r.metrics).sort(), ["kneeRom", "symmetry", "timing", "trunkThighChange"]);
  assert.equal(r.analysisSide, "left");
  assertAllFinite(r);
});

test("every result — complete or not — has symmetry unavailable and no numeric symmetry", () => {
  const results = [
    analyzeSquatCapture({ calibration: calibrated(), captureFrames: capFrames(squatFrame), modelVerified: true }),
    analyzeSquatCapture({ calibration: calibrated(), captureFrames: [], modelVerified: true }),
    analyzeSquatCapture({ calibration: null, captureFrames: [], modelVerified: false })
  ];
  results.forEach((r) => {
    assert.deepEqual(r.metrics.symmetry, SYMMETRY_UNAVAILABLE);
    assert.equal(Object.values(r.metrics.symmetry).some((v) => typeof v === "number"), false);
  });
});

test("no score, grade, norm, force, load, tissue, injury, readiness or recovery field exists", () => {
  const r = analyzeSquatCapture({ calibration: calibrated(), captureFrames: capFrames(squatFrame), modelVerified: true });
  const keys = deepKeys(r).join(" ");
  // ("footDriftPercentile" is an algorithm parameter — the 90th-percentile
  // foot displacement — so population comparisons are matched specifically.)
  assert.doesNotMatch(keys, /score|grade|rating|norm|population|percentileRank|force|load|tissue|injury|risk|ready|readiness|recover|capacity|safe|stress|strain|kinetic|moment|grf/i);
});

test("insufficient results carry no measurement numbers, traces or events", () => {
  const r = analyzeSquatCapture({ calibration: calibrated(), captureFrames: capFrames((t) => frame(providerResultAt(t, "stand"), t)), modelVerified: true });
  assert.equal(r.status, "insufficient_data");
  assert.equal(r.insufficientReason, "no_clear_repetition");
  ["kneeRom", "trunkThighChange", "timing"].forEach((k) => {
    assert.deepEqual(Object.keys(r.metrics[k]).sort(), ["reason", "state"]);
  });
  assert.equal(r.traces, null);
  assert.equal(r.events, null);
});

test("deterministic, JSON-stable, and never -0", () => {
  const input = { calibration: calibrated(), captureFrames: capFrames(squatFrame), modelVerified: true };
  const a = analyzeSquatCapture(input), b = analyzeSquatCapture(input);
  assert.deepEqual(a, b);
  assert.deepEqual(JSON.parse(JSON.stringify(a)), a);
});

test("trunk–thigh trace is withheld (not mislabelled) when its landmarks are unreliable", () => {
  const cap = capFrames((t) => {
    const raw = providerResultAt(t, "squat");
    raw.landmarks[0][BLAZEPOSE_INDEX.left_shoulder] = Object.assign({}, raw.landmarks[0][BLAZEPOSE_INDEX.left_shoulder], { visibility: 0.2 });
    return frame(raw, t);
  });
  const r = analyzeSquatCapture({ calibration: calibrated(), captureFrames: cap, modelVerified: true });
  assert.equal(r.status, "complete");
  assert.deepEqual(r.metrics.trunkThighChange, { state: "unavailable", reason: "insufficient_landmark_quality" });
  assert.equal(r.metrics.kneeRom.valueDeg, 80);
});

test("the pure analysis does not read the clock, storage or network", async () => {
  const { readFileSync } = await import("node:fs");
  ["squatAssessment", "squatSegmentation", "smoothing", "kinematics", "geometry", "calibration", "captureQuality", "sideSelection", "poseContract"].forEach((m) => {
    const src = readFileSync(new URL(`../js/movement/${m}.js`, import.meta.url), "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
    assert.doesNotMatch(src, /Date\.now|new Date|performance\.now|localStorage|indexedDB|fetch\(|XMLHttpRequest|Math\.random/, m);
  });
});
