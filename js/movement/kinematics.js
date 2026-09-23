/* ─── Movement Assessment — joint-angle definitions and traces ────────────
 *
 * Two apparent 2D angles are defined for a sagittal (side-on) capture. Both
 * are included angles (geometry.js) measured on ONE side of the body, the
 * side frozen by sideSelection.js.
 *
 *   knee         hip → knee → ankle       vertex: knee
 *                180° = hip, knee and ankle projected on one straight line;
 *                smaller = more knee flexion in the image plane.
 *
 *   trunk_thigh  shoulder → hip → knee    vertex: hip
 *                The angle between the shoulder–hip line and the hip–knee
 *                line. It combines hip flexion with trunk and pelvic motion,
 *                so it is NOT hip flexion and is never labelled as such.
 *
 * Every sample carries an explicit state. An angle is computed only when all
 * three of its landmarks are individually "valid" (poseContract.landmarkState);
 * otherwise the sample records WHY it is unavailable.
 * ───────────────────────────────────────────────────────────────────────── */

import { includedAngleDeg } from "./geometry.js";
import { landmarkState, sideLandmarkName } from "./poseContract.js";

export const ANGLE_DEFINITIONS = Object.freeze({
  knee: Object.freeze({
    id: "knee",
    label: "Apparent 2D knee angle",
    points: Object.freeze(["hip", "knee", "ankle"]),
    formula: "included angle at the knee landmark between the hip and ankle landmarks"
  }),
  trunkThigh: Object.freeze({
    id: "trunk_thigh",
    label: "Apparent 2D trunk–thigh angle",
    points: Object.freeze(["shoulder", "hip", "knee"]),
    formula: "included angle at the hip landmark between the shoulder and knee landmarks"
  })
});

/* Order matters: the first failing reason is reported. Frame-level problems
   outrank landmark-level ones. */
const LANDMARK_FAILURE_ORDER = ["missing", "out_of_frame", "low_confidence"];

/* One frame → { tMs, value, state }.
 *   state: "valid" | "no_pose" | "multiple_poses" | "malformed"
 *        | "missing" | "out_of_frame" | "low_confidence" | "degenerate" */
export function angleSample(frame, side, definition) {
  const tMs = frame && typeof frame.timestampMs === "number" && Number.isFinite(frame.timestampMs)
    ? frame.timestampMs : null;
  if (!frame || frame.status !== "pose") {
    return { tMs: tMs, value: null, state: frame && frame.status ? frame.status : "malformed" };
  }
  const pts = definition.points.map(function (part) {
    return frame.landmarks ? frame.landmarks[sideLandmarkName(side, part)] : null;
  });
  const states = pts.map(landmarkState);
  for (let i = 0; i < LANDMARK_FAILURE_ORDER.length; i++) {
    if (states.indexOf(LANDMARK_FAILURE_ORDER[i]) >= 0) {
      return { tMs: tMs, value: null, state: LANDMARK_FAILURE_ORDER[i] };
    }
  }
  const value = includedAngleDeg(pts[0], pts[1], pts[2]);
  if (value === null) return { tMs: tMs, value: null, state: "degenerate" };
  return { tMs: tMs, value: value, state: "valid" };
}

/* Frames → time-ordered samples. Frames without a finite timestamp, or whose
   timestamp does not strictly increase, cannot be placed on a time axis and
   are dropped (they are counted by the caller as malformed frames). */
export function buildAngleTrace(frames, side, definition) {
  const out = [];
  let lastT = -Infinity;
  (frames || []).forEach(function (frame) {
    const s = angleSample(frame, side, definition);
    if (s.tMs === null || !(s.tMs > lastT)) return;
    lastT = s.tMs;
    out.push(s);
  });
  return out;
}

export function validValues(samples, key) {
  const k = key || "value";
  return (samples || [])
    .map(function (s) { return s[k]; })
    .filter(function (v) { return typeof v === "number" && Number.isFinite(v); });
}
