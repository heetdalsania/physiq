/* ─── Movement Assessment — standing calibration ──────────────────────────
 *
 * Before the squat, the person stands side-on and still. The most recent
 * CALIBRATION.windowMs of pose frames is evaluated as one block; the
 * calibration completes the first time every check below passes.
 *
 * Calibration establishes ONLY:
 *   - the analysis side (sideSelection.js), frozen from here on;
 *   - the standing reference knee angle  = median raw knee angle in the window;
 *   - the standing reference trunk–thigh angle (when enough valid samples);
 *   - image-space framing references (apparent standing height in pixels,
 *     ankle position) used by the capture-quality checks.
 *
 * It does NOT establish limb lengths, camera distance or any physical scale.
 *
 * Every threshold here is an ALGORITHMIC DETECTION PARAMETER that decides
 * whether the capture is usable. None is a health, mobility or form standard.
 *
 *   windowMs 2000            evaluation window ("stand still for 2 seconds")
 *   minSpanMs 1700           the window must actually span ~2 s of frames
 *   minFrames 8              and contain at least 8 usable frames
 *   minUsableFraction 0.9    ≥ 90% of frames in the window usable
 *   maxKneeRangeDeg 10       smoothed knee angle varies ≤ 10° (stillness);
 *                            well above landmark jitter, far below walking
 *   maxHipSeparationRatio    distance between the two hip landmarks divided
 *     0.25                   by apparent torso length (shoulder midpoint to
 *                            hip midpoint). Side-on, the hips project onto
 *                            nearly the same point; facing the camera they
 *                            are far apart. A geometric heuristic for "the
 *                            camera is roughly side-on", not validated
 *                            against a reference system.
 * ───────────────────────────────────────────────────────────────────────── */

import { chooseAnalysisSide } from "./sideSelection.js";
import { ANGLE_DEFINITIONS, angleSample, buildAngleTrace, validValues } from "./kinematics.js";
import { smoothTrace } from "./smoothing.js";
import { distance, midpoint, median } from "./geometry.js";
import { sideLandmarkName } from "./poseContract.js";

export const CALIBRATION = Object.freeze({
  windowMs: 2000,
  minSpanMs: 1700,
  minFrames: 8,
  minUsableFraction: 0.9,
  maxKneeRangeDeg: 10,
  maxHipSeparationRatio: 0.25
});

/* Head (nose) and the analysis side's hip, knee, ankle and at least one foot
   point are inside the image. */
export function fullBodyInFrame(frame, side) {
  if (!frame || frame.status !== "pose" || !frame.landmarks) return false;
  const lm = frame.landmarks;
  const inside = function (name) { return !!lm[name] && lm[name].inFrame; };
  return inside("nose") &&
    inside(sideLandmarkName(side, "hip")) &&
    inside(sideLandmarkName(side, "knee")) &&
    inside(sideLandmarkName(side, "ankle")) &&
    (inside(sideLandmarkName(side, "heel")) || inside(sideLandmarkName(side, "foot_index")));
}

/* Hip separation ÷ torso length for one frame, or null. Uses coordinates
   regardless of visibility: the far hip is expected to be occluded. */
export function hipSeparationRatio(frame) {
  if (!frame || frame.status !== "pose" || !frame.landmarks) return null;
  const lm = frame.landmarks;
  const hipMid = midpoint(lm.left_hip, lm.right_hip);
  const shoulderMid = midpoint(lm.left_shoulder, lm.right_shoulder);
  const torso = distance(hipMid, shoulderMid);
  const hips = distance(lm.left_hip, lm.right_hip);
  if (torso === null || hips === null || torso < 1) return null;
  return hips / torso;
}

function incomplete(reason, progress, extra) {
  return Object.assign({ state: "incomplete", reason: reason, progress: progress }, extra || {});
}

/* frames: the pose frames of the last CALIBRATION.windowMs, in time order. */
export function evaluateCalibration(frames, options) {
  const opt = Object.assign({}, CALIBRATION, options || {});
  const list = (frames || []).filter(function (f) { return f && typeof f.timestampMs === "number" && Number.isFinite(f.timestampMs); });
  if (list.length === 0) return incomplete("no_frames", 0);

  const span = list[list.length - 1].timestampMs - list[0].timestampMs;
  const progress = Math.max(0, Math.min(1, span / opt.windowMs));
  const poseFrames = list.filter(function (f) { return f.status === "pose"; });

  if (list.some(function (f) { return f.status === "multiple_poses"; })) return incomplete("multiple_people", 0);
  if (poseFrames.length === 0) return incomplete("no_person", 0);

  const sideSelection = chooseAnalysisSide(poseFrames);
  if (!sideSelection.side) return incomplete("no_side_visible", 0, { sideSelection: sideSelection });
  const side = sideSelection.side;

  const inFrameCount = poseFrames.filter(function (f) { return fullBodyInFrame(f, side); }).length;
  if (inFrameCount < opt.minUsableFraction * list.length) return incomplete("body_not_in_frame", 0, { sideSelection: sideSelection });

  const ratio = median(poseFrames.map(hipSeparationRatio));
  if (ratio === null || ratio > opt.maxHipSeparationRatio) {
    return incomplete("not_side_on", 0, { sideSelection: sideSelection, hipSeparationRatio: ratio });
  }

  const kneeTrace = buildAngleTrace(list, side, ANGLE_DEFINITIONS.knee);
  const usable = list.filter(function (f) {
    return fullBodyInFrame(f, side) && angleSample(f, side, ANGLE_DEFINITIONS.knee).state === "valid";
  });
  if (usable.length < opt.minUsableFraction * list.length) {
    return incomplete("low_visibility", 0, { sideSelection: sideSelection });
  }

  const smoothedKnee = validValues(smoothTrace(kneeTrace));
  const kneeRange = smoothedKnee.length ? Math.max.apply(null, smoothedKnee) - Math.min.apply(null, smoothedKnee) : null;
  if (kneeRange === null || kneeRange > opt.maxKneeRangeDeg) {
    return incomplete("not_still", 0, { sideSelection: sideSelection, kneeRangeDeg: kneeRange });
  }

  if (span < opt.minSpanMs || usable.length < opt.minFrames) {
    return incomplete("collecting", progress, { sideSelection: sideSelection });
  }

  const trunkValues = validValues(buildAngleTrace(list, side, ANGLE_DEFINITIONS.trunkThigh));
  const ankleName = sideLandmarkName(side, "ankle");
  const heights = usable.map(function (f) { return distance(f.landmarks.nose, f.landmarks[ankleName]); });

  return {
    state: "complete",
    side: side,
    sideSelection: sideSelection,
    referenceKneeDeg: median(validValues(kneeTrace)),
    referenceTrunkThighDeg: trunkValues.length >= opt.minFrames ? median(trunkValues) : null,
    kneeRangeDeg: kneeRange,
    hipSeparationRatio: ratio,
    frameCount: list.length,
    usableFrames: usable.length,
    spanMs: span,
    frameWidth: list[list.length - 1].frameWidth,
    frameHeight: list[list.length - 1].frameHeight,
    standingHeightPx: median(heights),
    ankleReference: {
      x: median(usable.map(function (f) { return f.landmarks[ankleName].x; })),
      y: median(usable.map(function (f) { return f.landmarks[ankleName].y; }))
    }
  };
}
