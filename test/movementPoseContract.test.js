/* Milestone 6 — provider adapter → pose-frame-v1. Provider output is treated
   as untrusted input; the internal contract must stay stable. */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  normalizePoseResult, normalizeLandmark, landmarkState, LANDMARK_NAMES, BLAZEPOSE_INDEX, LANDMARK_MIN_VISIBILITY
} from "../js/movement/poseContract.js";
import { POSE_FRAME_CONTRACT_VERSION } from "../js/movement/modelVersion.js";
import { providerPose, stickFigure } from "./fixtures/syntheticPose.js";
import { includedAngleDeg } from "../js/movement/geometry.js";

const META = { timestampMs: 1234.5, frameWidth: 640, frameHeight: 480 };

function assertNoNonFinite(value, path = "frame") {
  if (typeof value === "number") assert.ok(Number.isFinite(value), path + " is " + value);
  else if (value && typeof value === "object") Object.keys(value).forEach((k) => assertNoNonFinite(value[k], path + "." + k));
}

test("frame shape is the documented pose-frame-v1 contract", () => {
  const f = normalizePoseResult({ landmarks: [providerPose(175, 0)] }, META);
  assert.deepEqual(Object.keys(f).sort(), ["contract", "frameHeight", "frameWidth", "landmarks", "modelId", "poseCount", "provider", "status", "timestampMs"]);
  assert.equal(f.contract, POSE_FRAME_CONTRACT_VERSION);
  assert.equal(f.status, "pose");
  assert.equal(f.poseCount, 1);
  assert.equal(f.provider, "mediapipe-tasks-vision");
  assert.equal(f.modelId, "pose_landmarker_full");
  assert.deepEqual(Object.keys(f.landmarks).sort(), LANDMARK_NAMES.slice().sort());
  Object.values(f.landmarks).forEach((lm) => assert.deepEqual(Object.keys(lm).sort(), ["inFrame", "visibility", "x", "y"]));
});

test("left-side capture: near-side landmarks keep provider visibility; coordinates are image pixels", () => {
  const raw = { landmarks: [providerPose(120, 20, { visibleSide: "left" })] };
  const f = normalizePoseResult(raw, META);
  const src = raw.landmarks[0][BLAZEPOSE_INDEX.left_knee];
  assert.equal(f.landmarks.left_knee.visibility, 0.95);
  assert.equal(f.landmarks.right_knee.visibility, 0.3);
  assert.ok(Math.abs(f.landmarks.left_knee.x - src.x * 640) < 1e-9);
  assert.ok(Math.abs(f.landmarks.left_knee.y - src.y * 480) < 1e-9);
  assert.equal(landmarkState(f.landmarks.left_knee), "valid");
  assert.equal(landmarkState(f.landmarks.right_knee), "low_confidence");
});

test("right-side capture maps the subject's right side", () => {
  const f = normalizePoseResult({ landmarks: [providerPose(120, 20, { visibleSide: "right" })] }, META);
  assert.equal(f.landmarks.right_hip.visibility, 0.95);
  assert.equal(f.landmarks.left_hip.visibility, 0.3);
});

test("angles are measured in pixel space, so a non-square frame does not distort them", () => {
  // In pixels: knee→hip = (0, −200), knee→ankle = (200, 200) → 135°.
  // In separately-normalised units on 640×480 the same points would give
  // 180° − atan(0.3125 / 0.4167) ≈ 143.1°.
  const W = 640, H = 480;
  const pts = new Array(33).fill(null).map(() => ({ x: 0.5, y: 0.5, visibility: 0.9 }));
  pts[BLAZEPOSE_INDEX.left_hip] = { x: 300 / W, y: 100 / H, visibility: 0.9 };
  pts[BLAZEPOSE_INDEX.left_knee] = { x: 300 / W, y: 300 / H, visibility: 0.9 };
  pts[BLAZEPOSE_INDEX.left_ankle] = { x: 500 / W, y: 500 / H, visibility: 0.9 };
  const f = normalizePoseResult({ landmarks: [pts] }, { timestampMs: 0, frameWidth: W, frameHeight: H });
  const lm = f.landmarks;
  assert.ok(Math.abs(includedAngleDeg(lm.left_hip, lm.left_knee, lm.left_ankle) - 135) < 1e-9);
  const naive = includedAngleDeg(pts[23], pts[25], pts[27]);
  assert.ok(Math.abs(naive - 143.13) < 0.01, "normalised coordinates give " + naive);
});

test("low-confidence, missing and out-of-frame joints are explicit states, never (0,0)", () => {
  const pose = providerPose(175, 0);
  pose[BLAZEPOSE_INDEX.left_knee] = { x: 0.5, y: 0.5, visibility: LANDMARK_MIN_VISIBILITY - 0.01 };
  pose[BLAZEPOSE_INDEX.left_ankle] = undefined;
  pose[BLAZEPOSE_INDEX.left_heel] = { x: 1.2, y: 0.9, visibility: 0.9 };
  const f = normalizePoseResult({ landmarks: [pose] }, META);
  assert.equal(landmarkState(f.landmarks.left_knee), "low_confidence");
  assert.equal(f.landmarks.left_ankle, null);
  assert.equal(landmarkState(f.landmarks.left_ankle), "missing");
  assert.equal(f.landmarks.left_heel.inFrame, false);
  assert.equal(landmarkState(f.landmarks.left_heel), "out_of_frame");
  // visibility exactly at the threshold is usable
  assert.equal(landmarkState({ x: 1, y: 1, visibility: LANDMARK_MIN_VISIBILITY, inFrame: true }), "valid");
});

test("malformed provider responses never throw and never produce NaN/Infinity", () => {
  const cases = [
    null, undefined, 42, "x", [], {}, { landmarks: "no" }, { landmarks: null },
    { landmarks: [null] }, { landmarks: ["pose"] }, { landmarks: [[{ x: 0.5, y: 0.5, visibility: 0.9 }]] },
    { landmarks: [new Array(33).fill({ x: NaN, y: Infinity, visibility: 2 })] },
    { landmarks: [new Array(33).fill({ x: 0.5, y: 0.5, visibility: -0.1 })] },
    { landmarks: [new Array(33).fill({ x: 0.5, y: 0.5 })] },
    { landmarks: [new Array(33).fill({ x: 1e300, y: -1e300, visibility: 0.9 })] },
    { landmarks: [new Array(33).fill({ x: "0.5", y: "0.5", visibility: "0.9" })] }
  ];
  cases.forEach((raw) => {
    const f = normalizePoseResult(raw, META);
    assertNoNonFinite(f);
    assert.ok(["pose", "no_pose", "multiple_poses", "malformed"].includes(f.status));
    if (f.status !== "pose") Object.values(f.landmarks).forEach((lm) => assert.equal(lm, null));
    else Object.values(f.landmarks).forEach((lm) => assert.equal(lm, null));
  });
  assert.equal(normalizePoseResult({ landmarks: [[{ x: 0.5, y: 0.5, visibility: 0.9 }]] }, META).status, "malformed");
});

test("invalid timestamps or frame sizes mark the frame malformed", () => {
  const raw = { landmarks: [providerPose(175, 0)] };
  [{ timestampMs: NaN }, { timestampMs: -1 }, { timestampMs: Infinity }, { frameWidth: 0 }, { frameHeight: -5 }, { frameWidth: NaN }]
    .forEach((bad) => {
      const f = normalizePoseResult(raw, Object.assign({}, META, bad));
      assert.equal(f.status, "malformed");
      assertNoNonFinite(f);
    });
});

test("no person → no_pose; two people → multiple_poses with no landmarks", () => {
  assert.equal(normalizePoseResult({ landmarks: [] }, META).status, "no_pose");
  const two = normalizePoseResult({ landmarks: [providerPose(175, 0), providerPose(175, 0, { shiftX: 200 })] }, META);
  assert.equal(two.status, "multiple_poses");
  assert.equal(two.poseCount, 2);
  Object.values(two.landmarks).forEach((lm) => assert.equal(lm, null));
});

test("provider-only fields (z, presence, unknown keys, world landmarks) do not leak into the contract", () => {
  const pose = providerPose(175, 0).map((p) => Object.assign({}, p, { z: -0.3, presence: 0.99, extra: "x" }));
  const f = normalizePoseResult({ landmarks: [pose], worldLandmarks: [pose], segmentationMasks: [{}], junk: 1 }, META);
  Object.values(f.landmarks).forEach((lm) => {
    assert.equal("z" in lm, false);
    assert.equal("presence" in lm, false);
    assert.equal("extra" in lm, false);
  });
  assert.equal("worldLandmarks" in f, false);
});

test("normalizeLandmark rejects out-of-range visibility instead of clamping it", () => {
  assert.equal(normalizeLandmark({ x: 0.1, y: 0.1, visibility: 1.0001 }, 10, 10), null);
  assert.equal(normalizeLandmark({ x: 0.1, y: 0.1, visibility: -0.0001 }, 10, 10), null);
  assert.deepEqual(normalizeLandmark({ x: 0.1, y: 0.2, visibility: 1 }, 10, 10), { x: 1, y: 2, visibility: 1, inFrame: true });
});

test("the synthetic stick figure really has the requested knee angle (fixture self-check)", () => {
  [175, 140, 95, 60].forEach((deg) => {
    const s = stickFigure(deg, 10);
    assert.ok(Math.abs(includedAngleDeg(s.hip, s.knee, s.ankle) - deg) < 1e-9);
    assert.ok(Math.abs(includedAngleDeg(s.shoulder, s.hip, s.knee) - (180 - ((180 - deg) / 2 + 10))) < 1e-9);
  });
});
