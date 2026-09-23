/* ─── Movement Assessment — capture (measurement) quality ─────────────────
 *
 * Describes how trustworthy the MEASUREMENT is. It says nothing about the
 * movement itself: "sufficient" does not mean good movement and
 * "insufficient" does not mean bad movement.
 *
 *   sufficient    a repetition was segmented and every factor passed
 *   limited       a repetition was segmented but at least one factor is
 *                 degraded; the numbers are shown with that caveat
 *   insufficient  no repetition could be segmented, or too little of the
 *                 capture was usable; no metrics are shown
 *
 * Factors (measurement parameters, documented in MOVEMENT_ASSESSMENT.md):
 *   usable_frames      share of capture frames with a valid knee angle
 *                      (limited < 0.8, insufficient < 0.5)
 *   landmark_confidence median, over valid samples, of the lowest provider
 *                      visibility among hip/knee/ankle (limited < 0.75)
 *   single_person      frames where the provider returned two poses
 *                      (insufficient if any: subject identity is ambiguous)
 *   body_in_frame      share of pose frames with head and the analysed
 *                      leg/foot in the image (limited < 0.9)
 *   foot_stability     90th-percentile displacement of the analysed ankle
 *                      from its calibration position, divided by apparent
 *                      standing height in pixels (limited > 0.08). Feet stay
 *                      planted in a bodyweight squat, so movement here means
 *                      the camera or the feet moved; the two cannot be told
 *                      apart from one camera.
 *   repetition         whether one repetition was segmented
 * ───────────────────────────────────────────────────────────────────────── */

import { ANGLE_DEFINITIONS, angleSample } from "./kinematics.js";
import { fullBodyInFrame } from "./calibration.js";
import { distance, median, percentile } from "./geometry.js";
import { sideLandmarkName } from "./poseContract.js";

export const QUALITY = Object.freeze({
  minUsableFraction: 0.8,
  insufficientUsableFraction: 0.5,
  minMedianVisibility: 0.75,
  minBodyInFrameFraction: 0.9,
  maxFootDriftFraction: 0.08,
  footDriftPercentile: 90
});

function round(value, digits) {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  const f = Math.pow(10, digits);
  return Math.round(value * f) / f;
}

export function assessCaptureQuality(input, options) {
  const opt = Object.assign({}, QUALITY, options || {});
  const frames = (input && input.captureFrames) || [];
  const side = input && input.side;
  const calibration = (input && input.calibration) || {};
  const segmentation = (input && input.segmentation) || { state: "insufficient" };

  const totalFrames = frames.length;
  const stamps = frames.map(function (f) { return f && f.timestampMs; })
    .filter(function (t) { return typeof t === "number" && Number.isFinite(t); });
  const captureDurationMs = stamps.length > 1 ? stamps[stamps.length - 1] - stamps[0] : 0;
  const counts = { pose: 0, no_pose: 0, multiple_poses: 0, malformed: 0 };
  frames.forEach(function (f) {
    const s = f && f.status;
    counts[s in counts ? s : "malformed"] += 1;
  });

  const knee = side ? frames.map(function (f) { return angleSample(f, side, ANGLE_DEFINITIONS.knee); }) : [];
  const validKnee = knee.filter(function (s) { return s.state === "valid"; });
  const usableFraction = totalFrames > 0 ? validKnee.length / totalFrames : 0;

  const visibilities = [];
  const ankleName = side ? sideLandmarkName(side, "ankle") : null;
  frames.forEach(function (f, i) {
    if (!knee[i] || knee[i].state !== "valid") return;
    const lm = f.landmarks;
    visibilities.push(Math.min(
      lm[sideLandmarkName(side, "hip")].visibility,
      lm[sideLandmarkName(side, "knee")].visibility,
      lm[ankleName].visibility
    ));
  });
  const medianVisibility = median(visibilities);

  const poseFrames = frames.filter(function (f) { return f && f.status === "pose"; });
  const inFrame = side ? poseFrames.filter(function (f) { return fullBodyInFrame(f, side); }).length : 0;
  const bodyInFrameFraction = poseFrames.length > 0 ? inFrame / poseFrames.length : 0;

  let footDrift = null;
  const ref = calibration.ankleReference;
  if (side && ref && typeof calibration.standingHeightPx === "number" && calibration.standingHeightPx > 0) {
    const drifts = poseFrames
      .map(function (f) { return f.landmarks[ankleName]; })
      .filter(function (lm) { return lm && lm.inFrame; })
      .map(function (lm) { return distance(lm, ref); });
    const p = percentile(drifts, opt.footDriftPercentile);
    footDrift = p === null ? null : p / calibration.standingHeightPx;
  }

  const segmented = segmentation.state === "segmented";
  const factors = [
    {
      id: "usable_frames",
      state: usableFraction < opt.insufficientUsableFraction ? "insufficient" : usableFraction < opt.minUsableFraction ? "limited" : "pass",
      value: round(usableFraction, 3)
    },
    {
      id: "landmark_confidence",
      state: medianVisibility === null ? "insufficient" : medianVisibility < opt.minMedianVisibility ? "limited" : "pass",
      value: round(medianVisibility, 3)
    },
    {
      id: "single_person",
      state: counts.multiple_poses > 0 ? "insufficient" : "pass",
      value: counts.multiple_poses
    },
    {
      id: "body_in_frame",
      state: bodyInFrameFraction < opt.minBodyInFrameFraction ? "limited" : "pass",
      value: round(bodyInFrameFraction, 3)
    },
    {
      id: "foot_stability",
      state: footDrift === null ? "limited" : footDrift > opt.maxFootDriftFraction ? "limited" : "pass",
      value: round(footDrift, 3)
    },
    {
      id: "repetition",
      state: segmented ? "pass" : "insufficient",
      value: segmented ? "one_repetition" : (segmentation.reason || "not_segmented")
    }
  ];

  let state = "sufficient";
  if (factors.some(function (f) { return f.state === "insufficient"; })) state = "insufficient";
  else if (factors.some(function (f) { return f.state === "limited"; })) state = "limited";

  return {
    state: state,
    factors: factors,
    totalFrames: totalFrames,
    captureDurationMs: round(captureDurationMs, 0),
    usableFrames: validKnee.length,
    usableFraction: round(usableFraction, 3),
    medianLandmarkVisibility: round(medianVisibility, 3),
    frameStatusCounts: counts,
    bodyInFrameFraction: round(bodyInFrameFraction, 3),
    footDriftFraction: round(footDrift, 3)
  };
}
