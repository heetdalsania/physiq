/* ─── Milestone 7 — cross-language parity fixtures from the REAL M6 code ─
 *
 * Each scenario drives the actual Milestone 6 session controller
 * (js/movement/assessmentSession.js) with a fake camera, a fake clock and a
 * fake pose provider that returns the M6 synthetic fixture
 * (test/fixtures/syntheticPose.js). Everything the session decides —
 * which frames it analyses, when calibration completes, when the capture
 * ends and the final movement-assessment-v0.1 result — comes from the
 * production JavaScript, unmodified.
 *
 * The fixture records the exact provider output of every analysed frame
 * (so the Python implementation consumes byte-identical input) plus the
 * expected outputs: the session's result and the UNROUNDED internal values
 * (calibration references, segmentation events and durations) recomputed
 * with the M6 functions on exactly the frames the session used.
 *
 * Used by research_backend/tools/m6_parity/generate.mjs (writes the JSON
 * fixtures) and test/researchParityFixtures.test.js (fails if M6 behaviour
 * drifts from the committed fixtures).
 * ───────────────────────────────────────────────────────────────────────── */

import { createAssessmentSession } from "../../../js/movement/assessmentSession.js";
import { normalizePoseResult, BLAZEPOSE_INDEX } from "../../../js/movement/poseContract.js";
import { evaluateCalibration, CALIBRATION } from "../../../js/movement/calibration.js";
import { ANGLE_DEFINITIONS, buildAngleTrace } from "../../../js/movement/kinematics.js";
import { smoothTrace } from "../../../js/movement/smoothing.js";
import { segmentSingleSquat } from "../../../js/movement/squatSegmentation.js";
import { analyzeSquatCapture, TRUNK_THIGH_MIN_COVERAGE } from "../../../js/movement/squatAssessment.js";
import { SEGMENTATION } from "../../../js/movement/squatSegmentation.js";
import {
  MOVEMENT_ASSESSMENT_VERSION, SQUAT_KINEMATICS_VERSION, POSE_FRAME_CONTRACT_VERSION
} from "../../../js/movement/modelVersion.js";
import { providerResultAt, providerPose, squatKneeAt, leanForKnee } from "../../../test/fixtures/syntheticPose.js";

export const FIXTURE_FORMAT = "m6-parity-fixture-v1";
const W = 640, H = 480;
const USED_INDICES = Object.values(BLAZEPOSE_INDEX).sort((a, b) => a - b);
const FILLER = { x: 0.5, y: 0.5, z: 0, visibility: 0.1 };

function seeded(seed) {
  let s = seed;
  return () => { s = (s * 48271) % 2147483647; return s / 2147483647; };
}
const range = (from, to, step) => { const out = []; for (let t = from; t <= to + 1e-9; t += step) out.push(t); return out; };

/* scenario: { name, description, ticks: number[], raw(t) } */
export function scenarios() {
  const noisyRnd = seeded(3);
  const noisyCache = new Map();
  const jitterRnd = seeded(17);
  const irregularTicks = [];
  for (let t = 0; t < 8200;) { t += 50 + Math.floor(jitterRnd() * 61); irregularTicks.push(t); }
  const fifteenHz = []; for (let k = 1; k <= 120; k++) fifteenHz.push(k * 1000 / 15);
  return [
    { name: "clean_squat_100ms", description: "clean squat, analysed every 100 ms", ticks: range(100, 8000, 100), raw: (t) => providerResultAt(t, "squat") },
    { name: "clean_squat_15hz", description: "clean squat at the M6 ~15 Hz cadence (1000/15 ms)", ticks: fifteenHz, raw: (t) => providerResultAt(t, "squat") },
    { name: "no_motion", description: "standing still throughout", ticks: range(100, 8000, 100), raw: (t) => providerResultAt(t, "stand") },
    { name: "partial_motion", description: "descends and never returns to standing", ticks: range(100, 8000, 100), raw: (t) => providerResultAt(t, "partial") },
    { name: "shallow_motion", description: "movement below the 20° detection floor", ticks: range(100, 8000, 100), raw: (t) => providerResultAt(t, "shallow") },
    { name: "multiple_reps", description: "two squats (second starts 920 ms after the first ends)", ticks: range(100, 9500, 100), raw: (t) => providerResultAt(t, "twoSquats") },
    { name: "back_to_back_reps", description: "second squat begins immediately after the first", ticks: range(100, 9000, 100),
      raw: (t) => { const k = Math.min(squatKneeAt(t), squatKneeAt(t, { descentAt: 5900, bottomAt: 6700, riseAt: 6800, standAt: 7600 })); return { landmarks: [providerPose(k, leanForKnee(k))] }; } },
    { name: "missing_frames_throughout", description: "every 5th analysed frame has no pose — calibration cannot reach 90% usable", ticks: range(100, 8000, 100),
      raw: (t) => (Math.round(t) % 500 === 200 ? { landmarks: [] } : providerResultAt(t, "squat")) },
    { name: "missing_frames_during_capture", description: "every 5th analysed frame after 2.6 s has no pose", ticks: range(100, 8000, 100),
      raw: (t) => (t >= 2600 && Math.round(t) % 500 === 200 ? { landmarks: [] } : providerResultAt(t, "squat")) },
    { name: "tracking_gap", description: "no pose for 500 ms at the bottom of the squat", ticks: range(100, 8000, 100),
      raw: (t) => (t > 3800 && t < 4400 ? { landmarks: [] } : providerResultAt(t, "squat")) },
    { name: "bottom_pause", description: "one-second pause at the bottom", ticks: range(100, 8000, 100),
      raw: (t) => { const k = squatKneeAt(t, { riseAt: 5200, standAt: 6400 }); return { landmarks: [providerPose(k, leanForKnee(k))] }; } },
    { name: "low_frame_rate_5hz", description: "analysed every 200 ms", ticks: range(200, 8000, 200), raw: (t) => providerResultAt(t, "squat") },
    { name: "very_low_frame_rate_3hz", description: "analysed every 333 ms — calibration cannot collect 8 frames", ticks: range(333, 8000, 333), raw: (t) => providerResultAt(t, "squat") },
    { name: "irregular_timing", description: "tick spacing 50–110 ms (seeded); the session's 66 ms gate decides", ticks: irregularTicks, raw: (t) => providerResultAt(t, "squat") },
    { name: "noisy_squat", description: "±2° seeded landmark-angle noise", ticks: range(100, 8000, 100),
      raw: (t) => { if (!noisyCache.has(t)) { const k = squatKneeAt(t) + (noisyRnd() - 0.5) * 4; noisyCache.set(t, { landmarks: [providerPose(k, leanForKnee(k))] }); } return noisyCache.get(t); } },
    { name: "right_side_visible", description: "the camera sees the right leg", ticks: range(100, 8000, 100),
      raw: (t) => providerResultAt(t, "squat", { pose: { visibleSide: "right" } }) },
    { name: "two_people_during_capture", description: "a second person appears at 4.0 s", ticks: range(100, 8000, 100),
      raw: (t) => (t >= 4000 ? providerResultAt(t, "two") : providerResultAt(t, "squat")) },
    { name: "frontal_view", description: "facing the camera — never side-on", ticks: range(100, 6000, 100), raw: (t) => providerResultAt(t, "front") },
    { name: "low_visibility", description: "hip/knee/ankle visibility 0.3", ticks: range(100, 6000, 100), raw: (t) => providerResultAt(t, "low") }
  ];
}

/* Compact, exact encoding of one provider result: the 13 used landmarks as
   [x, y, z, visibility]; every other point must equal the fixture filler. */
function encodeRaw(raw) {
  return {
    poses: raw.landmarks.map((pose) => {
      const used = {};
      pose.forEach((p, i) => {
        if (USED_INDICES.includes(i)) used[i] = [p.x, p.y, p.z, p.visibility];
        else if (p.x !== FILLER.x || p.y !== FILLER.y || p.z !== FILLER.z || p.visibility !== FILLER.visibility) {
          throw new Error("unexpected non-filler landmark " + i);
        }
      });
      return used;
    })
  };
}

function fakeEnvironment() {
  const track = { readyState: "live", stop() { this.readyState = "ended"; }, addEventListener() {}, removeEventListener() {} };
  const stream = { getTracks: () => [track], getVideoTracks: () => [track] };
  return {
    mediaDevices: { getUserMedia: () => Promise.resolve(stream) },
    doc: { visibilityState: "visible", addEventListener() {}, removeEventListener() {}, defaultView: { addEventListener() {}, removeEventListener() {} } },
    video: { readyState: 4, videoWidth: W, videoHeight: H, srcObject: null, play() { return Promise.resolve(); }, pause() {}, setAttribute() {} }
  };
}

const flush = () => new Promise((r) => setImmediate(r));

export async function runScenario(scenario) {
  const env = fakeEnvironment();
  let now = 0;
  const queue = [];
  const frames = [];
  let session;
  const provider = {
    identity: { modelVerifiedOnDevice: true },
    modelBytes: new Uint8Array([1]),
    detect(video, t) {
      const raw = scenario.raw(t);
      frames.push({ t, raw, phaseAtDetect: session.getState().phase, frame: normalizePoseResult(raw, { timestampMs: t, frameWidth: W, frameHeight: H }) });
      return frames[frames.length - 1].frame;
    },
    close() {}
  };
  session = createAssessmentSession({
    mediaDevices: env.mediaDevices,
    createProvider: () => Promise.resolve(provider),
    now: () => now,
    scheduleFrame: (cb) => { queue.push(cb); return cb; },
    cancelFrame: (h) => { const i = queue.indexOf(h); if (i >= 0) queue.splice(i, 1); },
    doc: env.doc
  });
  session.setVideoElement(env.video);
  await session.start();
  let calibrationCompleteMs = null;
  for (const tick of scenario.ticks) {
    now = tick;
    const before = frames.length;
    const cbs = queue.splice(0, queue.length);
    cbs.forEach((cb) => cb(now));
    await flush();
    if (calibrationCompleteMs === null && session.getState().phase === "capturing" && frames.length > before) {
      calibrationCompleteMs = frames[frames.length - 1].t;
    }
    if (["positioning", "calibrating", "capturing"].indexOf(session.getState().phase) < 0) break;
  }
  let endedBy = "session";
  if (session.getState().phase === "capturing") { session.finishCapture(); endedBy = "done_at_end_of_input"; }
  const state = session.getState();

  // Frames the session actually used, reconstructed from what it decided.
  const positioning = frames.filter((f) => f.phaseAtDetect === "positioning" || f.phaseAtDetect === "calibrating");
  const window = calibrationCompleteMs === null ? [] :
    positioning.filter((f) => f.t <= calibrationCompleteMs && calibrationCompleteMs - f.t <= CALIBRATION.windowMs).map((f) => f.frame);
  const capture = frames.filter((f) => f.phaseAtDetect === "capturing").map((f) => f.frame);

  let internals = null;
  if (calibrationCompleteMs !== null) {
    const cal = evaluateCalibration(window);
    if (cal.state !== "complete") throw new Error(scenario.name + ": reconstructed calibration is not complete");
    const recomputed = analyzeSquatCapture({ calibration: cal, captureFrames: capture, modelVerified: true });
    if (JSON.stringify(recomputed) !== JSON.stringify(state.result)) throw new Error(scenario.name + ": reconstruction differs from the session result");
    const knee = smoothTrace(buildAngleTrace(capture, cal.side, ANGLE_DEFINITIONS.knee));
    const trunk = smoothTrace(buildAngleTrace(capture, cal.side, ANGLE_DEFINITIONS.trunkThigh));
    const seg = segmentSingleSquat(knee, cal.referenceKneeDeg);
    let trunkMinimumDeg = null;
    if (seg.state === "segmented" && typeof cal.referenceTrunkThighDeg === "number") {
      const inRep = trunk.filter((s) => s.tMs >= seg.events.descentStartMs && s.tMs <= seg.events.ascentEndMs);
      const valid = inRep.filter((s) => typeof s.value === "number");
      if (inRep.length && valid.length / inRep.length >= TRUNK_THIGH_MIN_COVERAGE && valid.length >= SEGMENTATION.minRepSamples) {
        trunkMinimumDeg = Math.min.apply(null, valid.map((s) => s.value));
      }
    }
    internals = {
      calibration: {
        side: cal.side,
        referenceKneeDeg: cal.referenceKneeDeg,
        referenceTrunkThighDeg: cal.referenceTrunkThighDeg,
        kneeRangeDeg: cal.kneeRangeDeg,
        hipSeparationRatio: cal.hipSeparationRatio,
        standingHeightPx: cal.standingHeightPx,
        spanMs: cal.spanMs,
        usableFrames: cal.usableFrames,
        frameCount: cal.frameCount,
        ankleReference: cal.ankleReference
      },
      segmentation: seg,
      trunkMinimumDeg,
      kneeTraceSmoothed: knee.map((s) => [s.tMs, s.value, s.raw, s.state]),
      trunkTraceSmoothed: trunk.map((s) => [s.tMs, s.value, s.raw, s.state])
    };
  }
  const result = state.result ? Object.assign({}, state.result) : null;
  if (result) { delete result.provenance; delete result.parameters; }
  return {
    format: FIXTURE_FORMAT,
    generator: "research_backend/tools/m6_parity/scenarios.mjs",
    m6: { result: MOVEMENT_ASSESSMENT_VERSION, kinematics: SQUAT_KINEMATICS_VERSION, poseFrame: POSE_FRAME_CONTRACT_VERSION },
    scenario: scenario.name,
    description: scenario.description,
    frameWidth: W,
    frameHeight: H,
    filler: [FILLER.x, FILLER.y, FILLER.z, FILLER.visibility],
    frames: frames.map((f) => ({ t: f.t, raw: encodeRaw(f.raw) })),
    expected: {
      sessionPhase: state.phase,
      endedBy,
      positioningReason: state.positioningReason || null,
      calibrationCompleteMs,
      calibrationWindowTimestamps: window.map((f) => f.timestampMs),
      captureTimestamps: capture.map((f) => f.timestampMs),
      internals,
      result
    }
  };
}

export async function buildAll() {
  const out = [];
  for (const s of scenarios()) out.push(await runScenario(s));
  return out;
}
