/* ─── Movement Assessment — bodyweight squat (sagittal) result ────────────
 *
 * Pure: calibration + capture pose frames → movement-assessment-v0.1 result.
 * No clock, no camera, no storage, no React. The same input always gives the
 * same output.
 *
 * Output boundary (Milestone 6, claim-ladder stage 3 — video-estimated
 * movement mechanics): apparent 2D angles, their traces, their change over
 * one repetition, and phase timing. There is deliberately no score, grade,
 * normative range, force, load, tissue, injury, readiness or recovery field,
 * and nothing here is read by, or writes to, the TissueOS workload system.
 *
 * Definitions:
 *   apparent 2D knee ROM (°) = R_knee − min(smoothed knee angle during the
 *       detected repetition), where R_knee is the standing reference knee
 *       angle from calibration. Positive = the knee angle closed by that much.
 *   apparent 2D trunk–thigh change (°) = R_trunk − min(smoothed trunk–thigh
 *       angle between descent start and ascent end). Reported only when that
 *       trace is available (see TRUNK_THIGH_MIN_COVERAGE).
 *   descent = deepest − descent start;  ascent = ascent end − deepest;
 *   total = ascent end − descent start  (ms; squatSegmentation.js).
 *   symmetry: never estimated from one sagittal view.
 * ───────────────────────────────────────────────────────────────────────── */

import {
  MOVEMENT_ASSESSMENT_VERSION,
  SQUAT_KINEMATICS_VERSION,
  POSE_FRAME_CONTRACT_VERSION,
  ASSESSMENT_ID,
  ASSESSMENT_LABEL,
  CAPTURE_MODE,
  poseProvenance
} from "./modelVersion.js";
import { LANDMARK_MIN_VISIBILITY } from "./poseContract.js";
import { ANGLE_DEFINITIONS, buildAngleTrace } from "./kinematics.js";
import { SMOOTHING, smoothTrace } from "./smoothing.js";
import { SEGMENTATION, segmentSingleSquat } from "./squatSegmentation.js";
import { CALIBRATION } from "./calibration.js";
import { QUALITY, assessCaptureQuality } from "./captureQuality.js";

/* Capture protocol. Algorithmic parameters, part of squat-kinematics-v0.2. */
export const CAPTURE = Object.freeze({
  maxDurationMs: 10000,          // capture ends after 10 s regardless
  postRepetitionHoldMs: 1000,    // …or 1 s after a complete repetition
  positioningTimeoutMs: 45000,   // give up finding a usable standing pose
  minInferenceIntervalMs: 66     // analyse at most ~15 frames per second
});

/* The trunk–thigh trace is reported only if ≥ 80% of its samples inside the
   repetition are valid and it has a calibration reference. */
export const TRUNK_THIGH_MIN_COVERAGE = 0.8;

export const SYMMETRY_UNAVAILABLE = Object.freeze({
  state: "unavailable_for_capture_mode",
  captureMode: CAPTURE_MODE,
  reason: "single_sagittal_view"
});

function round(value, digits) {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  const f = Math.pow(10, digits);
  const r = Math.round(value * f) / f;
  return r === 0 ? 0 : r;   // never -0
}

function rebaseTrace(samples, originMs) {
  return samples.map(function (s) {
    return {
      tMs: round(s.tMs - originMs, 0),
      value: round(s.value, 1),
      raw: round(s.raw, 1),
      state: s.state
    };
  });
}

function trunkThighMetric(trace, calibration, segmentation) {
  if (typeof calibration.referenceTrunkThighDeg !== "number") {
    return { state: "unavailable", reason: "no_standing_reference" };
  }
  const e = segmentation.events;
  const inRep = trace.filter(function (s) { return s.tMs >= e.descentStartMs && s.tMs <= e.ascentEndMs; });
  const valid = inRep.filter(function (s) { return typeof s.value === "number"; });
  if (inRep.length === 0 || valid.length / inRep.length < TRUNK_THIGH_MIN_COVERAGE || valid.length < SEGMENTATION.minRepSamples) {
    return { state: "unavailable", reason: "insufficient_landmark_quality" };
  }
  const minimum = Math.min.apply(null, valid.map(function (s) { return s.value; }));
  return {
    state: "available",
    valueDeg: round(calibration.referenceTrunkThighDeg - minimum, 1),
    referenceDeg: round(calibration.referenceTrunkThighDeg, 1),
    minimumDeg: round(minimum, 1)
  };
}

function parameters() {
  return {
    landmarkMinVisibility: LANDMARK_MIN_VISIBILITY,
    smoothing: SMOOTHING,
    calibration: CALIBRATION,
    segmentation: SEGMENTATION,
    quality: QUALITY,
    capture: CAPTURE,
    trunkThighMinCoverage: TRUNK_THIGH_MIN_COVERAGE
  };
}

/* input: { calibration (evaluateCalibration "complete" result),
            captureFrames (pose-frame-v1[], time-ordered),
            modelVerified (boolean) } */
export function analyzeSquatCapture(input) {
  const calibration = input && input.calibration;
  const frames = (input && input.captureFrames) || [];
  const base = {
    contract: MOVEMENT_ASSESSMENT_VERSION,
    kinematicsVersion: SQUAT_KINEMATICS_VERSION,
    poseFrameContract: POSE_FRAME_CONTRACT_VERSION,
    assessment: { id: ASSESSMENT_ID, label: ASSESSMENT_LABEL, captureMode: CAPTURE_MODE, repetitionsRequested: 1 },
    provenance: poseProvenance(input && input.modelVerified),
    parameters: parameters()
  };

  if (!calibration || calibration.state !== "complete" || !calibration.side) {
    return Object.assign(base, {
      status: "insufficient_data",
      insufficientReason: "calibration_incomplete",
      analysisSide: null,
      reference: null,
      metrics: unavailableMetrics("calibration_incomplete"),
      events: null,
      traces: null,
      quality: assessCaptureQuality({ captureFrames: frames, side: null, calibration: {}, segmentation: { state: "insufficient", reason: "calibration_incomplete" } })
    });
  }

  const side = calibration.side;
  const knee = smoothTrace(buildAngleTrace(frames, side, ANGLE_DEFINITIONS.knee));
  const trunk = smoothTrace(buildAngleTrace(frames, side, ANGLE_DEFINITIONS.trunkThigh));
  const segmentation = segmentSingleSquat(knee, calibration.referenceKneeDeg);
  const quality = assessCaptureQuality({ captureFrames: frames, side: side, calibration: calibration, segmentation: segmentation });

  const reference = {
    kneeDeg: round(calibration.referenceKneeDeg, 1),
    trunkThighDeg: round(calibration.referenceTrunkThighDeg, 1),
    calibrationFrames: calibration.usableFrames,
    calibrationSpanMs: round(calibration.spanMs, 0)
  };

  const segmented = segmentation.state === "segmented";
  if (!segmented || quality.state === "insufficient") {
    const reason = quality.frameStatusCounts.multiple_poses > 0
      ? "multiple_people_during_capture"
      : segmented ? "insufficient_capture_quality" : segmentation.reason;
    return Object.assign(base, {
      status: "insufficient_data",
      insufficientReason: reason,
      analysisSide: side,
      reference: reference,
      metrics: unavailableMetrics(reason),
      events: null,
      traces: null,
      quality: quality
    });
  }

  const origin = knee.length ? knee[0].tMs : 0;
  const ev = segmentation.events;
  const d = segmentation.durations;
  return Object.assign(base, {
    status: "complete",
    insufficientReason: null,
    analysisSide: side,
    reference: reference,
    metrics: {
      kneeRom: {
        state: "available",
        valueDeg: round(segmentation.excursionDeg, 1),
        referenceDeg: round(segmentation.referenceDeg, 1),
        minimumDeg: round(segmentation.minimumDeg, 1)
      },
      trunkThighChange: trunkThighMetric(trunk, calibration, segmentation),
      timing: {
        state: "available",
        descentMs: round(d.descentMs, 0),
        ascentMs: round(d.ascentMs, 0),
        totalMs: round(d.totalMs, 0)
      },
      symmetry: Object.assign({}, SYMMETRY_UNAVAILABLE)
    },
    events: {
      descentStartMs: round(ev.descentStartMs - origin, 0),
      deepestMs: round(ev.deepestMs - origin, 0),
      ascentEndMs: round(ev.ascentEndMs - origin, 0)
    },
    traces: {
      knee: rebaseTrace(knee, origin),
      trunkThigh: rebaseTrace(trunk, origin)
    },
    quality: quality
  });
}

function unavailableMetrics(reason) {
  return {
    kneeRom: { state: "unavailable", reason: reason },
    trunkThighChange: { state: "unavailable", reason: reason },
    timing: { state: "unavailable", reason: reason },
    symmetry: Object.assign({}, SYMMETRY_UNAVAILABLE)
  };
}

/* Used DURING capture to decide whether the protocol has finished: one
   repetition segmented and at least postRepetitionHoldMs of frames after it. */
export function repetitionFinished(captureFrames, calibration) {
  if (!calibration || calibration.state !== "complete") return false;
  const frames = captureFrames || [];
  if (frames.length === 0) return false;
  const knee = smoothTrace(buildAngleTrace(frames, calibration.side, ANGLE_DEFINITIONS.knee));
  const seg = segmentSingleSquat(knee, calibration.referenceKneeDeg);
  if (seg.state !== "segmented") return false;
  const lastT = frames[frames.length - 1].timestampMs;
  return typeof lastT === "number" && lastT - seg.events.ascentEndMs >= CAPTURE.postRepetitionHoldMs;
}
