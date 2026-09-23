/* ─── Movement Assessment — versions and pose-model provenance ────────────
 *
 * Milestone 6 is the first TissueOS component that depends on a LEARNED
 * model, so the identity of that model is part of every result, exactly as
 * the workload formula's identity is part of every TissueOS load result.
 *
 * This version family is independent of tissue-load-v0.1,
 * exercise-tissue-map-v0.1, tissue-history-v1, load-baseline-v0.1 and
 * recovery-guidance-v0.1. Nothing here is derived from, or feeds, any of
 * those. Movement results are never persisted (see MOVEMENT_ASSESSMENT.md).
 *
 * Bump rules:
 *   - Result shape or user-facing metric definitions change
 *       → MOVEMENT_ASSESSMENT_VERSION
 *   - Any algorithm parameter or rule in geometry, side selection,
 *     smoothing, calibration, segmentation or capture quality changes
 *       → SQUAT_KINEMATICS_VERSION
 *   - The internal normalized pose-frame shape changes
 *       → POSE_FRAME_CONTRACT_VERSION
 *   - The pose runtime, the weights or the inference settings change
 *       → update POSE_PROVIDER / POSE_MODEL / RUNTIME_ASSETS together, and
 *         bump SQUAT_KINEMATICS_VERSION (different landmarks are different
 *         measurements).
 *
 * build.mjs refuses to build when an installed or vendored runtime file does
 * not match the SHA-256 recorded here, and poseProvider.js re-verifies the
 * model bytes on device before handing them to the runtime, so replacing the
 * weights can never happen silently.
 * ───────────────────────────────────────────────────────────────────────── */

export const MOVEMENT_ASSESSMENT_VERSION = "movement-assessment-v0.1";
export const SQUAT_KINEMATICS_VERSION = "squat-kinematics-v0.1";
export const POSE_FRAME_CONTRACT_VERSION = "pose-frame-v1";

export const ASSESSMENT_ID = "bodyweight_squat_sagittal";
export const ASSESSMENT_LABEL = "Bodyweight Squat — Side View";
export const CAPTURE_MODE = "single_camera_sagittal";

/* The runtime that executes the model. 0.10.35 is pinned EXACTLY (no range
   in package.json): @mediapipe/tasks-vision 1.0.0 and later add a usage
   logger that POSTs task, platform and latency statistics to
   odml.pa.googleapis.com, which this milestone does not allow. build.mjs
   also scans the shipped runtime for that endpoint. */
export const POSE_PROVIDER = Object.freeze({
  id: "mediapipe-tasks-vision",
  packageName: "@mediapipe/tasks-vision",
  packageVersion: "0.10.35",
  license: "Apache-2.0",
  task: "PoseLandmarker",
  runningMode: "VIDEO",
  delegate: "CPU",
  /* Two poses are requested only so that a second person in frame can be
     DETECTED and the frame rejected; the analysis never uses more than one. */
  numPoses: 2,
  minPoseDetectionConfidence: 0.5,
  minPosePresenceConfidence: 0.5,
  minTrackingConfidence: 0.5
});

/* The weights. Source, licence and hash are recorded in
   vendor/mediapipe/NOTICE.md; the file itself is vendored so that builds
   never download anything. */
export const POSE_MODEL = Object.freeze({
  id: "pose_landmarker_full",
  version: "float16/1",
  embeddedNetworks: [
    "blazepose_detector_eff_retina_4kp_sparse_2021_10_18",
    "blazepose_ghum_39kp_full_oss_2021_07_02"
  ],
  file: "pose_landmarker_full.task",
  bytes: 9398198,
  sha256: "5134a3aad27a58b93da0088d431f366da362b44e3ccfbe3462b3827a839011b1",
  source: "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_full/float16/1/pose_landmarker_full.task",
  modelCard: "https://storage.googleapis.com/mediapipe-assets/Model%20Card%20BlazePose%20GHUM%203D.pdf",
  license: "Apache-2.0",
  retrieved: "2026-09-23"
});

/* Everything the app loads at run time for pose estimation, relative to the
   directory that holds app.min.js. `from` is where build.mjs copies it from.
   Each entry is hash-checked at build time. */
export const RUNTIME_ASSETS = Object.freeze({
  runtimeBundle: "movement/pose-runtime.js",
  wasmLoader: Object.freeze({
    path: "movement/mediapipe/vision_wasm_internal.js",
    from: "node_modules/@mediapipe/tasks-vision/wasm/vision_wasm_internal.js",
    sha256: "e7fd9858e8e8f221d9b96eddc11f8e077f263e0b7bbd79d3cbe882b134274f8c"
  }),
  wasmBinary: Object.freeze({
    path: "movement/mediapipe/vision_wasm_internal.wasm",
    from: "node_modules/@mediapipe/tasks-vision/wasm/vision_wasm_internal.wasm",
    sha256: "6a5c64584c2ab61c763b6e204afbdbc7ce1caf7f5216187322bca8df94f646bc"
  }),
  model: Object.freeze({
    path: "movement/models/pose_landmarker_full.task",
    from: "vendor/mediapipe/pose_landmarker_full.task",
    sha256: POSE_MODEL.sha256
  })
});

/* Strings that must never appear in shipped pose-runtime code. They identify
   the telemetry path added in @mediapipe/tasks-vision 1.0.0. */
export const FORBIDDEN_RUNTIME_MARKERS = Object.freeze([
  "odml.pa.googleapis.com",
  "mediapipeLoggerGetEncodedApiKey",
  "x-goog-api-key",
  "sendBeacon"
]);

/* One object that every result carries. */
export function poseProvenance(modelVerified) {
  return {
    provider: POSE_PROVIDER.id,
    providerVersion: POSE_PROVIDER.packageVersion,
    task: POSE_PROVIDER.task,
    delegate: POSE_PROVIDER.delegate,
    modelId: POSE_MODEL.id,
    modelVersion: POSE_MODEL.version,
    modelSha256: POSE_MODEL.sha256,
    modelVerifiedOnDevice: modelVerified === true
  };
}
