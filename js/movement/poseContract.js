/* ─── Movement Assessment — internal pose-frame contract (pose-frame-v1) ──
 *
 * The rest of the application consumes THIS shape, never a third-party pose
 * object, so the pose runtime can be replaced without touching geometry,
 * segmentation or the UI.
 *
 *   {
 *     contract:    "pose-frame-v1",
 *     timestampMs: finite number ≥ 0 (ms since the session started) | null,
 *     frameWidth:  positive integer, pixels of the analysed video frame,
 *     frameHeight: positive integer,
 *     provider:    "mediapipe-tasks-vision",
 *     modelId:     "pose_landmarker_full",
 *     status:      "pose" | "no_pose" | "multiple_poses" | "malformed",
 *     poseCount:   integer ≥ 0 (poses the provider returned),
 *     landmarks:   { <name>: Landmark | null }   (all null unless status "pose")
 *   }
 *
 *   Landmark = { x, y, visibility, inFrame }
 *     x, y        IMAGE PIXELS (origin top-left, y down). Converting here,
 *                 once, keeps every angle aspect-correct: provider x and y
 *                 are normalised by width and height separately, so angles
 *                 measured in normalised units would be distorted on any
 *                 non-square frame.
 *     visibility  provider probability in [0, 1] that the point is inside
 *                 the frame and not occluded (model card definition).
 *     inFrame     provider-normalised x and y both within [0, 1].
 *
 * z is deliberately dropped. The model card states it is obtained from
 * synthetic data, relative to the hips and "not metric but up to scale";
 * v0.1 makes no depth measurement.
 *
 * Provider output is untrusted input. Anything non-finite, out of range or
 * of the wrong shape becomes an explicit null / "malformed" — never a
 * silently substituted (0, 0) and never NaN.
 * ───────────────────────────────────────────────────────────────────────── */

import { POSE_FRAME_CONTRACT_VERSION, POSE_PROVIDER, POSE_MODEL } from "./modelVersion.js";

/* The only landmarks v0.1 uses, with their BlazePose (33-point) indices.
   "left"/"right" are the SUBJECT'S anatomical sides as labelled by the
   model, not image sides. */
export const BLAZEPOSE_INDEX = Object.freeze({
  nose: 0,
  left_shoulder: 11,
  right_shoulder: 12,
  left_hip: 23,
  right_hip: 24,
  left_knee: 25,
  right_knee: 26,
  left_ankle: 27,
  right_ankle: 28,
  left_heel: 29,
  right_heel: 30,
  left_foot_index: 31,
  right_foot_index: 32
});

export const LANDMARK_NAMES = Object.freeze(Object.keys(BLAZEPOSE_INDEX));
export const BLAZEPOSE_LANDMARK_COUNT = 33;

/* MEASUREMENT-QUALITY threshold, not an athlete threshold: a landmark takes
   part in an angle only when the model rates it more likely visible than not
   (the natural decision point of a probability; also MediaPipe's own default
   confidence cut-off). */
export const LANDMARK_MIN_VISIBILITY = 0.5;

/* Normalised coordinates beyond this magnitude are not "slightly outside the
   frame" predictions but garbage; they are rejected rather than propagated
   into SVG paths or arithmetic. */
const MAX_ABS_NORMALISED = 10;

function isFiniteNumber(v) {
  return typeof v === "number" && Number.isFinite(v);
}

function isPositiveDimension(v) {
  return isFiniteNumber(v) && v > 0 && v <= 100000;
}

function emptyLandmarks() {
  const out = {};
  LANDMARK_NAMES.forEach(function (name) { out[name] = null; });
  return out;
}

/* One provider point → Landmark | null. */
export function normalizeLandmark(point, frameWidth, frameHeight) {
  if (!point || typeof point !== "object") return null;
  const x = point.x, y = point.y, visibility = point.visibility;
  if (!isFiniteNumber(x) || !isFiniteNumber(y)) return null;
  if (Math.abs(x) > MAX_ABS_NORMALISED || Math.abs(y) > MAX_ABS_NORMALISED) return null;
  if (!isFiniteNumber(visibility) || visibility < 0 || visibility > 1) return null;
  return {
    x: x * frameWidth,
    y: y * frameHeight,
    visibility: visibility,
    inFrame: x >= 0 && x <= 1 && y >= 0 && y <= 1
  };
}

function frameShell(timestampMs, frameWidth, frameHeight) {
  return {
    contract: POSE_FRAME_CONTRACT_VERSION,
    timestampMs: isFiniteNumber(timestampMs) && timestampMs >= 0 ? timestampMs : null,
    frameWidth: isPositiveDimension(frameWidth) ? Math.round(frameWidth) : null,
    frameHeight: isPositiveDimension(frameHeight) ? Math.round(frameHeight) : null,
    provider: POSE_PROVIDER.id,
    modelId: POSE_MODEL.id,
    status: "malformed",
    poseCount: 0,
    landmarks: emptyLandmarks()
  };
}

/* Provider result (MediaPipe PoseLandmarkerResult-like: `{ landmarks:
   NormalizedLandmark[][] }`) → pose-frame-v1. Never throws. */
export function normalizePoseResult(raw, meta) {
  const m = meta || {};
  const frame = frameShell(m.timestampMs, m.frameWidth, m.frameHeight);
  if (frame.timestampMs === null || frame.frameWidth === null || frame.frameHeight === null) return frame;
  if (!raw || typeof raw !== "object" || !Array.isArray(raw.landmarks)) return frame;

  const poses = raw.landmarks;
  frame.poseCount = poses.length;
  if (poses.length === 0) { frame.status = "no_pose"; return frame; }
  if (poses.length > 1) { frame.status = "multiple_poses"; return frame; }

  const pose = poses[0];
  if (!Array.isArray(pose) || pose.length < BLAZEPOSE_LANDMARK_COUNT) return frame;

  LANDMARK_NAMES.forEach(function (name) {
    frame.landmarks[name] = normalizeLandmark(pose[BLAZEPOSE_INDEX[name]], frame.frameWidth, frame.frameHeight);
  });
  frame.status = "pose";
  return frame;
}

/* Why a landmark can or cannot be used, as an explicit state. */
export function landmarkState(landmark) {
  if (!landmark) return "missing";
  if (!landmark.inFrame) return "out_of_frame";
  if (landmark.visibility < LANDMARK_MIN_VISIBILITY) return "low_confidence";
  return "valid";
}

export function sideLandmarkName(side, part) {
  return side + "_" + part;
}
