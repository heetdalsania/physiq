/* Milestone 6 — deterministic analysis-side selection, frozen per assessment. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { chooseAnalysisSide, sideScore } from "../js/movement/sideSelection.js";
import { normalizePoseResult, BLAZEPOSE_INDEX } from "../js/movement/poseContract.js";
import { evaluateCalibration } from "../js/movement/calibration.js";
import { analyzeSquatCapture } from "../js/movement/squatAssessment.js";
import { providerPose, providerResultAt, squatKneeAt, leanForKnee } from "./fixtures/syntheticPose.js";

const frameOf = (pose, t = 0) => normalizePoseResult({ landmarks: [pose] }, { timestampMs: t, frameWidth: 640, frameHeight: 480 });
const standing = (opts, t) => frameOf(providerPose(175, 0, opts), t);

test("left strongly visible → left", () => {
  const frames = [0, 100, 200].map((t) => standing({ visibleSide: "left", nearVisibility: 0.95, farVisibility: 0.2 }, t));
  const r = chooseAnalysisSide(frames);
  assert.equal(r.side, "left");
  assert.equal(r.leftMedian, 0.95);
  assert.equal(r.rightMedian, 0.2);
  assert.equal(r.tieBreak, null);
});

test("right strongly visible → right", () => {
  const frames = [0, 100, 200].map((t) => standing({ visibleSide: "right", nearVisibility: 0.9, farVisibility: 0.4 }, t));
  assert.equal(chooseAnalysisSide(frames).side, "right");
});

test("the weakest of hip/knee/ankle is the side's score", () => {
  const pose = providerPose(175, 0, { visibleSide: "left" });
  pose[BLAZEPOSE_INDEX.left_ankle] = Object.assign({}, pose[BLAZEPOSE_INDEX.left_ankle], { visibility: 0.61 });
  assert.equal(sideScore(frameOf(pose), "left"), 0.61);
});

test("exact tie → mean decides; still tied → left by documented convention", () => {
  const tied = [0, 100, 200].map((t) => standing({ nearVisibility: 0.8, farVisibility: 0.8 }, t));
  const r = chooseAnalysisSide(tied);
  assert.equal(r.side, "left");
  assert.equal(r.tieBreak, "left_by_convention");

  // Medians equal (0.8 both), means differ: left [0.8,0.8,0.8], right [0.6,0.8,0.99]
  const mk = (l, rr, t) => {
    const p = providerPose(175, 0, { nearVisibility: l, farVisibility: rr });
    return frameOf(p, t);
  };
  const m = chooseAnalysisSide([mk(0.8, 0.6, 0), mk(0.8, 0.8, 100), mk(0.8, 0.99, 200)]);
  assert.equal(m.leftMedian, m.rightMedian);
  assert.equal(m.side, "left");         // mean 0.8 > 0.797
  assert.equal(m.tieBreak, "mean");
});

test("one side disappearing (null landmarks) scores 0 for that side", () => {
  const frames = [0, 100, 200].map((t) => {
    const p = providerPose(175, 0, { visibleSide: "right", nearVisibility: 0.9 });
    ["left_hip", "left_knee", "left_ankle"].forEach((n) => { p[BLAZEPOSE_INDEX[n]] = null; });
    return frameOf(p, t);
  });
  const r = chooseAnalysisSide(frames);
  assert.equal(r.leftMedian, 0);
  assert.equal(r.side, "right");
});

test("no usable side or no pose frames → no side, with a reason", () => {
  const dim = [0, 100].map((t) => standing({ nearVisibility: 0.4, farVisibility: 0.3 }, t));
  assert.equal(chooseAnalysisSide(dim).side, null);
  assert.equal(chooseAnalysisSide(dim).reason, "insufficient_visibility");
  const none = [normalizePoseResult({ landmarks: [] }, { timestampMs: 0, frameWidth: 640, frameHeight: 480 })];
  assert.equal(chooseAnalysisSide(none).reason, "no_pose_frames");
  assert.equal(chooseAnalysisSide([]).reason, "no_pose_frames");
});

test("selection is independent of frame order", () => {
  const frames = [0.9, 0.7, 0.8, 0.6, 0.95].map((v, i) => standing({ nearVisibility: v, farVisibility: 0.72 }, i * 100));
  assert.deepEqual(chooseAnalysisSide(frames), chooseAnalysisSide(frames.slice().reverse()));
});

test("the side is frozen at calibration: later visibility changes never switch it", () => {
  const cal = [];
  for (let t = 0; t <= 2000; t += 100) cal.push(frameOf(providerResultAt(t, "squat").landmarks[0], t));
  const calibration = evaluateCalibration(cal);
  assert.equal(calibration.state, "complete");
  assert.equal(calibration.side, "left");

  // During capture the RIGHT side becomes far more visible and the left
  // collapses below the gate. A per-frame chooser would switch to right.
  const capture = [];
  for (let t = 2100; t <= 8000; t += 100) {
    const knee = squatKneeAt(t);
    capture.push(frameOf(providerPose(knee, leanForKnee(knee), { visibleSide: "right", nearVisibility: 0.95, farVisibility: 0.3 }), t));
  }
  assert.equal(chooseAnalysisSide(capture).side, "right", "sanity: the capture alone would pick right");
  const result = analyzeSquatCapture({ calibration, captureFrames: capture, modelVerified: true });
  assert.equal(result.analysisSide, "left");
  assert.equal(result.status, "insufficient_data");   // left is now low-confidence: no fabricated numbers
  assert.equal(result.quality.frameStatusCounts.pose, capture.length);
});
