/* ─── Movement Assessment — pose runtime bundle entry ──────────────────────
 *
 * build.mjs compiles this file on its own into dist/movement/pose-runtime.js
 * (an IIFE exposing window.PhysiqPoseRuntime). It is NOT imported by the app
 * bundle: poseProvider.js injects it only after the user starts an
 * assessment, so users who never open Movement Assessment never download or
 * evaluate the pose runtime.
 * ───────────────────────────────────────────────────────────────────────── */

export { PoseLandmarker, FilesetResolver } from "@mediapipe/tasks-vision";
