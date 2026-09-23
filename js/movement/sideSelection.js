/* ─── Movement Assessment — analysis-side selection ───────────────────────
 *
 * A side-on camera sees one leg clearly and the other through or behind it.
 * The side analysed is chosen ONCE, from the calibration frames, and then
 * frozen for the whole assessment: switching sides frame by frame would
 * splice two different projected limbs into one trace.
 *
 * Rule (deterministic):
 *   1. Only frames with exactly one pose ("pose" status) take part.
 *   2. Per frame and side, the side's score is the LOWEST visibility among
 *      that side's hip, knee and ankle (the knee angle needs all three, so
 *      the weakest point limits it). A missing or out-of-frame landmark
 *      scores 0.
 *   3. Each side's score is the median over those frames.
 *   4. The higher median wins. If the medians are equal, the higher mean
 *      wins. If the means are also equal, "left" is chosen — an arbitrary,
 *      documented convention so that the outcome never depends on
 *      iteration order.
 *   5. If the winning median is below LANDMARK_MIN_VISIBILITY no side is
 *      chosen: neither leg is reliably visible.
 * ───────────────────────────────────────────────────────────────────────── */

import { median, mean } from "./geometry.js";
import { LANDMARK_MIN_VISIBILITY, sideLandmarkName } from "./poseContract.js";

export const SIDES = Object.freeze(["left", "right"]);
export const SIDE_REQUIRED_PARTS = Object.freeze(["hip", "knee", "ankle"]);
const TIE_EPSILON = 1e-12;

export function sideScore(frame, side) {
  if (!frame || frame.status !== "pose" || !frame.landmarks) return null;
  let score = 1;
  SIDE_REQUIRED_PARTS.forEach(function (part) {
    const lm = frame.landmarks[sideLandmarkName(side, part)];
    const v = lm && lm.inFrame ? lm.visibility : 0;
    if (v < score) score = v;
  });
  return score;
}

export function chooseAnalysisSide(frames) {
  const scores = { left: [], right: [] };
  (frames || []).forEach(function (f) {
    SIDES.forEach(function (side) {
      const s = sideScore(f, side);
      if (s !== null) scores[side].push(s);
    });
  });
  const summary = {
    rule: "median_min_visibility_hip_knee_ankle",
    frameCount: scores.left.length,
    leftMedian: median(scores.left),
    rightMedian: median(scores.right),
    leftMean: mean(scores.left),
    rightMean: mean(scores.right),
    tieBreak: null,
    side: null,
    reason: null
  };
  if (summary.frameCount === 0) {
    summary.reason = "no_pose_frames";
    return summary;
  }
  let side;
  const dMedian = summary.leftMedian - summary.rightMedian;
  if (Math.abs(dMedian) > TIE_EPSILON) {
    side = dMedian > 0 ? "left" : "right";
  } else {
    const dMean = summary.leftMean - summary.rightMean;
    if (Math.abs(dMean) > TIE_EPSILON) {
      side = dMean > 0 ? "left" : "right";
      summary.tieBreak = "mean";
    } else {
      side = "left";
      summary.tieBreak = "left_by_convention";
    }
  }
  const winning = side === "left" ? summary.leftMedian : summary.rightMedian;
  if (winning < LANDMARK_MIN_VISIBILITY) {
    summary.reason = "insufficient_visibility";
    return summary;
  }
  summary.side = side;
  return summary;
}
