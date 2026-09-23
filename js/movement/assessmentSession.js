/* ─── Movement Assessment — session lifecycle controller ──────────────────
 *
 * Owns every sensitive resource of one Movement Assessment screen: the
 * camera stream, the pose runtime, the frame loop and the in-memory pose
 * frames. React (MovementAssessment.js) only renders its state and forwards
 * user actions. Keeping this out of React makes the lifecycle testable with
 * fake cameras, providers and clocks (test/movementSession.test.js).
 *
 * Phases
 *   idle → loading_model → starting_camera → positioning ⇄ calibrating
 *        → capturing → analyzing → results | insufficient
 *   any active phase → error        (camera/model failure, backgrounding,
 *                                     camera interruption, orientation change)
 *   cancel() from anywhere → idle
 *
 * Invariants
 *   1. The camera is requested only from start()/retake(), i.e. only after
 *      an explicit user action, and only after the pose model loaded.
 *   2. Every acquired MediaStreamTrack is stopped when the session leaves an
 *      active phase for ANY reason: completion, cancel, error, backgrounding,
 *      dispose (unmount), or a stream that arrives after the session moved on.
 *   3. At most one inference is in flight; frames that arrive meanwhile, or
 *      sooner than CAPTURE.minInferenceIntervalMs, are skipped (the newest
 *      frame wins; nothing is queued).
 *   4. Every async continuation carries the generation it started in. A
 *      result from an older generation (after cancel, retake, error or
 *      dispose) is discarded and can never modify the current session.
 *   5. Pose frames live only in this closure and are dropped when capture
 *      ends; only the derived result (angles/timing) survives, in memory,
 *      until retake, cancel or unmount. Nothing is persisted or transmitted.
 * ───────────────────────────────────────────────────────────────────────── */

import { requestCameraStream, stopMediaStream } from "./mediaCapture.js";
import { evaluateCalibration, CALIBRATION } from "./calibration.js";
import { analyzeSquatCapture, repetitionFinished, CAPTURE } from "./squatAssessment.js";
import { createMediaPipePoseProvider } from "./poseProvider.js";

export const ACTIVE_PHASES = Object.freeze(["loading_model", "starting_camera", "positioning", "calibrating", "capturing", "analyzing"]);
const LOOP_PHASES = ["positioning", "calibrating", "capturing"];

function initialState() {
  return {
    phase: "idle",
    guidance: null,
    progress: 0,
    errorCode: null,
    positioningReason: null,
    analysisSide: null,
    result: null,
    hasStream: false
  };
}

function defaultScheduleFrame(cb) {
  return typeof requestAnimationFrame === "function" ? requestAnimationFrame(cb) : setTimeout(cb, 16);
}
function defaultCancelFrame(handle) {
  if (typeof cancelAnimationFrame === "function") cancelAnimationFrame(handle);
  else clearTimeout(handle);
}
function defaultNow() {
  return typeof performance !== "undefined" && performance.now ? performance.now() : Date.now();
}

function safeClose(provider) {
  try { if (provider && typeof provider.close === "function") provider.close(); } catch (e) { /* ignore */ }
}

function detachVideo(el) {
  if (!el) return;
  try { if (typeof el.pause === "function") el.pause(); } catch (e) { /* ignore */ }
  try { el.srcObject = null; } catch (e) { /* ignore */ }
}

/* deps: { mediaDevices, createProvider, now, scheduleFrame, cancelFrame, doc } */
export function createAssessmentSession(deps) {
  const d = Object.assign({
    mediaDevices: typeof navigator !== "undefined" ? navigator.mediaDevices : null,
    createProvider: createMediaPipePoseProvider,
    now: defaultNow,
    scheduleFrame: defaultScheduleFrame,
    cancelFrame: defaultCancelFrame,
    doc: typeof document !== "undefined" ? document : null
  }, deps || {});

  let state = initialState();
  const listeners = new Set();
  let generation = 0;
  let disposed = false;

  let stream = null;
  let trackCleanup = [];
  let provider = null;
  let video = null;
  let modelBytesCache = null;
  let loopHandle = null;
  let inFlight = null;          // generation of the pending inference, or null
  let lastInferenceAt = -Infinity;
  let t0 = 0;
  let positioningStartedAt = 0;
  let captureStartedAt = 0;
  let frames = [];
  let captureFrames = [];
  let calibration = null;
  let frameDims = null;

  const stats = {
    tracksAcquired: 0,
    tracksStopped: 0,
    inferences: 0,
    skippedBusy: 0,
    skippedInterval: 0,
    staleDiscarded: 0,
    inferenceMsTotal: 0,
    inferenceMsMax: 0,
    modelLoadMs: null,
    providersCreated: 0,
    providersClosed: 0
  };

  function emit() {
    const snapshot = state;
    listeners.forEach(function (l) { try { l(snapshot); } catch (e) { /* listener errors never break capture */ } });
  }

  function set(patch) {
    let changed = false;
    Object.keys(patch).forEach(function (k) { if (state[k] !== patch[k]) changed = true; });
    if (!changed) return;
    state = Object.assign({}, state, patch);
    emit();
  }

  function releaseResources() {
    if (loopHandle !== null) { try { d.cancelFrame(loopHandle); } catch (e) { /* ignore */ } loopHandle = null; }
    inFlight = null;
    if (stream) {
      stats.tracksStopped += stopMediaStream(stream);
      trackCleanup.forEach(function (fn) { fn(); });
      trackCleanup = [];
      stream = null;
    }
    detachVideo(video);
    if (provider) { safeClose(provider); stats.providersClosed += 1; provider = null; }
    frames = [];
    captureFrames = [];
    calibration = null;
    frameDims = null;
  }

  function fail(code) {
    generation += 1;
    releaseResources();
    set({ phase: "error", errorCode: code, hasStream: false, progress: 0 });
  }

  function interrupt(code) {
    if (disposed || ACTIVE_PHASES.indexOf(state.phase) < 0) return;
    fail(code);
  }

  function attachStreamToVideo() {
    if (!video || !stream) return;
    try {
      if (video.srcObject !== stream) video.srcObject = stream;
      video.muted = true;
      video.playsInline = true;
      if (typeof video.setAttribute === "function") video.setAttribute("playsinline", "");
      const p = typeof video.play === "function" ? video.play() : null;
      if (p && typeof p.catch === "function") p.catch(function () { /* autoplay is muted+inline; ignore */ });
    } catch (e) { /* the next frame tick simply finds no video */ }
  }

  function watchTracks(s, gen) {
    let tracks = [];
    try { tracks = s.getTracks() || []; } catch (e) { tracks = []; }
    stats.tracksAcquired += tracks.length;
    tracks.forEach(function (track) {
      if (!track || typeof track.addEventListener !== "function") return;
      const onEnded = function () { if (gen === generation) interrupt("camera_interrupted"); };
      track.addEventListener("ended", onEnded);
      trackCleanup.push(function () { try { track.removeEventListener("ended", onEnded); } catch (e) { /* ignore */ } });
    });
  }

  async function start() {
    if (disposed) return;
    generation += 1;
    const gen = generation;
    releaseResources();
    set(Object.assign(initialState(), { phase: "loading_model" }));

    let p;
    const loadStartedAt = d.now();
    try {
      p = await d.createProvider({ modelBytes: modelBytesCache });
    } catch (err) {
      if (gen !== generation || disposed) return;
      fail(err && err.code ? err.code : "model_init_failed");
      return;
    }
    stats.providersCreated += 1;
    if (gen !== generation || disposed) { safeClose(p); stats.providersClosed += 1; return; }
    provider = p;
    if (p && p.modelBytes) modelBytesCache = p.modelBytes;
    stats.modelLoadMs = d.now() - loadStartedAt;
    set({ phase: "starting_camera" });

    let s;
    try {
      s = await requestCameraStream(d.mediaDevices);
    } catch (err) {
      if (gen !== generation || disposed) return;
      fail(err && err.code ? err.code : "camera_error");
      return;
    }
    if (gen !== generation || disposed) {
      // The user moved on while the permission prompt was open.
      let n = 0;
      try { n = (s.getTracks() || []).length; } catch (e) { n = 0; }
      stats.tracksAcquired += n;
      stats.tracksStopped += stopMediaStream(s);
      return;
    }
    stream = s;
    watchTracks(s, gen);
    attachStreamToVideo();
    t0 = d.now();
    positioningStartedAt = t0;
    set({ phase: "positioning", guidance: "no_person", hasStream: true });
    scheduleLoop(gen);
  }

  function scheduleLoop(gen) {
    loopHandle = d.scheduleFrame(function tick() {
      loopHandle = null;
      if (gen !== generation || disposed || LOOP_PHASES.indexOf(state.phase) < 0) return;
      onTick(gen);
      if (gen === generation && !disposed && LOOP_PHASES.indexOf(state.phase) >= 0 && loopHandle === null) {
        loopHandle = d.scheduleFrame(tick);
      }
    });
  }

  function onTick(gen) {
    const now = d.now();
    if ((state.phase === "positioning" || state.phase === "calibrating") && now - positioningStartedAt > CAPTURE.positioningTimeoutMs) {
      const reason = state.guidance;
      generation += 1;
      releaseResources();
      set({ phase: "insufficient", positioningReason: reason, hasStream: false, progress: 0, result: null });
      return;
    }
    if (state.phase === "capturing" && now - captureStartedAt >= CAPTURE.maxDurationMs) {
      finishCapture();
      return;
    }
    if (!video || !provider || !(video.readyState >= 2) || !video.videoWidth || !video.videoHeight) return;
    if (inFlight !== null) { stats.skippedBusy += 1; return; }
    if (now - lastInferenceAt < CAPTURE.minInferenceIntervalMs) { stats.skippedInterval += 1; return; }

    inFlight = gen;
    lastInferenceAt = now;
    let pending;
    try { pending = provider.detect(video, now - t0); } catch (e) { pending = null; }
    Promise.resolve(pending).then(function (frame) {
      if (gen !== generation || disposed) { stats.staleDiscarded += 1; return; }
      inFlight = null;
      const took = d.now() - now;
      stats.inferences += 1;
      stats.inferenceMsTotal += took;
      stats.inferenceMsMax = Math.max(stats.inferenceMsMax, took);
      if (frame) handleFrame(frame);
    }, function () {
      if (gen === generation && inFlight === gen) inFlight = null;
    });
  }

  function handleFrame(frame) {
    if (frame.frameWidth && frame.frameHeight) {
      if (!frameDims) frameDims = { w: frame.frameWidth, h: frame.frameHeight };
      else if (frameDims.w !== frame.frameWidth || frameDims.h !== frame.frameHeight) { fail("orientation_changed"); return; }
    }
    if (typeof frame.timestampMs !== "number") return;

    if (state.phase === "positioning" || state.phase === "calibrating") {
      frames.push(frame);
      const latest = frame.timestampMs;
      frames = frames.filter(function (f) { return latest - f.timestampMs <= CALIBRATION.windowMs; });
      const evaluation = evaluateCalibration(frames);
      if (evaluation.state === "complete") {
        calibration = evaluation;
        frames = [];
        captureStartedAt = d.now();
        set({ phase: "capturing", guidance: "squat_now", progress: 0, analysisSide: evaluation.side });
        return;
      }
      set({
        phase: evaluation.reason === "collecting" ? "calibrating" : "positioning",
        guidance: evaluation.reason,
        progress: Math.round(evaluation.progress * 10) / 10
      });
      return;
    }

    if (state.phase === "capturing") {
      captureFrames.push(frame);
      if (repetitionFinished(captureFrames, calibration)) { finishCapture(); return; }
      const elapsed = d.now() - captureStartedAt;
      set({ progress: Math.round(Math.min(1, elapsed / CAPTURE.maxDurationMs) * 10) / 10 });
    }
  }

  function finishCapture() {
    if (state.phase !== "capturing") return;
    const cal = calibration;
    const captured = captureFrames;
    const verified = !!(provider && provider.identity && provider.identity.modelVerifiedOnDevice);
    generation += 1;
    const gen = generation;
    releaseResources();                 // camera off before any analysis
    set({ phase: "analyzing", hasStream: false });
    let result = null;
    try {
      result = analyzeSquatCapture({ calibration: cal, captureFrames: captured, modelVerified: verified });
    } catch (e) { result = null; }
    if (gen !== generation || disposed) return;
    if (!result) { fail("analysis_failed"); return; }
    set({ phase: result.status === "complete" ? "results" : "insufficient", result: result, guidance: null, progress: 1 });
  }

  function cancel() {
    generation += 1;
    releaseResources();
    set(initialState());
  }

  function retake() {
    cancel();
    return start();
  }

  const onVisibility = function () {
    if (d.doc && d.doc.visibilityState === "hidden") interrupt("interrupted_background");
  };
  const onPageHide = function () { interrupt("interrupted_background"); };
  if (d.doc && typeof d.doc.addEventListener === "function") {
    d.doc.addEventListener("visibilitychange", onVisibility);
  }
  const win = d.doc && d.doc.defaultView;
  if (win && typeof win.addEventListener === "function") win.addEventListener("pagehide", onPageHide);

  function dispose() {
    if (disposed) return;
    disposed = true;
    generation += 1;
    releaseResources();
    modelBytesCache = null;
    video = null;
    if (d.doc && typeof d.doc.removeEventListener === "function") d.doc.removeEventListener("visibilitychange", onVisibility);
    if (win && typeof win.removeEventListener === "function") win.removeEventListener("pagehide", onPageHide);
    listeners.clear();
  }

  return {
    getState: function () { return state; },
    getStats: function () { return Object.assign({}, stats); },
    subscribe: function (fn) {
      listeners.add(fn);
      return function () { listeners.delete(fn); };
    },
    setVideoElement: function (el) {
      if (video && video !== el) detachVideo(video);
      video = el || null;
      if (video) attachStreamToVideo();
    },
    start: start,
    retake: retake,
    cancel: cancel,
    finishCapture: finishCapture,
    dispose: dispose,
    isDisposed: function () { return disposed; }
  };
}
