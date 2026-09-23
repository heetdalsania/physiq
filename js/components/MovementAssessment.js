/* ─── TissueOS Milestone 6 — Movement Assessment (prototype) ──────────────
 *
 * Presentation only. The camera, pose runtime, frame loop and all timing
 * live in js/movement/assessmentSession.js; the measurements come from the
 * pure functions in js/movement/. This component renders the session's
 * state, forwards user actions, and disposes the session on unmount — which
 * stops the camera whenever the user leaves this screen, closes the Exercise
 * popup, switches tab or profile, or the app re-renders without it.
 *
 * Results exist only in memory for as long as this screen is mounted. There
 * is no persistence, no upload and no link to workouts or TissueOS load.
 * ───────────────────────────────────────────────────────────────────────── */

import React, { useCallback, useEffect, useRef, useState } from "react";
import { createAssessmentSession } from "../movement/assessmentSession.js";
import {
  ASSESSMENT_LABEL,
  MOVEMENT_ASSESSMENT_VERSION,
  SQUAT_KINEMATICS_VERSION,
  POSE_MODEL,
  POSE_PROVIDER
} from "../movement/modelVersion.js";

export const LIMITATION_TEXT = "This prototype estimates 2D movement mechanics from a single camera view. It does not measure force, tissue load, injury risk, or recovery.";
export const SEPARATION_TEXT = "It is separate from Tissue Load and Recovery Guidance and does not change your workouts.";
export const SYMMETRY_TEXT = "Left/right symmetry is not estimated from a single sagittal capture in this prototype.";
export const PRIVACY_TEXT = [
  "Camera video is processed on this device for this assessment.",
  "Raw video is not saved or uploaded by this prototype."
];

const IDLE_STATE = { phase: "idle", guidance: null, progress: 0, errorCode: null, positioningReason: null, analysisSide: null, result: null, hasStream: false };

const GUIDANCE = {
  no_frames: "Step into view, side-on to the camera.",
  no_person: "No person detected yet. Step into view, side-on to the camera.",
  multiple_people: "More than one person is in view. Make sure only you are visible.",
  no_side_visible: "Your hip, knee and ankle are not clearly visible. Adjust lighting, clothing or position.",
  low_visibility: "Your hip, knee and ankle are not clearly visible. Adjust lighting, clothing or position.",
  body_not_in_frame: "Your whole body is not in view. Move the camera back until your head and feet are visible.",
  not_side_on: "Turn so that your side faces the camera.",
  not_still: "Hold still, standing upright.",
  collecting: "Calibrating. Stand still, side-on.",
  squat_now: "Squat now: one slow squat, then stand still."
};

const ERRORS = {
  permission_denied: "Camera access is required for this assessment. You can enable it in your device or browser settings and try again.",
  no_camera: "No compatible camera was found on this device.",
  camera_in_use: "The camera could not be started. It may be in use by another app; close that app and try again.",
  unsupported_browser: "This browser does not give this page camera access. Camera access needs a secure (https) page in a current browser.",
  camera_error: "The camera could not be started.",
  runtime_unavailable: "The on-device pose model could not be loaded.",
  model_unavailable: "The on-device pose model could not be loaded.",
  model_integrity: "The on-device pose model failed its integrity check, so it was not used.",
  model_init_failed: "The on-device pose model could not be started on this device.",
  unsupported_runtime: "This browser engine lacks the WebAssembly SIMD support the pose model needs (iOS 16.4 or later, or a current desktop browser).",
  interrupted_background: "The assessment stopped because the app left the foreground. The camera was turned off and nothing was saved.",
  camera_interrupted: "The camera stopped unexpectedly. The assessment ended and nothing was saved.",
  orientation_changed: "The camera orientation changed during the assessment. Keep the phone in one orientation and try again.",
  analysis_failed: "The capture could not be analysed."
};

const INSUFFICIENT = {
  insufficient_valid_frames: "Too few frames had a clearly visible hip, knee and ankle.",
  no_clear_repetition: "No squat could be told apart from small movements. The assessment needs one full squat after the “Squat now” prompt.",
  repetition_started_before_capture: "The squat appeared to start before the capture began. Stand upright and still until “Squat now” appears.",
  did_not_return_to_standing: "The capture ended before you returned to standing.",
  multiple_repetitions: "More than one squat was detected. This prototype measures exactly one repetition.",
  multiple_people_during_capture: "More than one person entered the camera view during capture, so the pose could not be attributed reliably. Make sure only you are visible and retake.",
  data_gap_during_repetition: "Tracking was lost during the squat.",
  too_few_samples_in_repetition: "Too few frames were analysed during the squat. A slower squat or brighter lighting may help.",
  insufficient_capture_quality: "Too much of the capture was unusable.",
  calibration_incomplete: "The standing calibration did not complete.",
  invalid_timing: "The repetition timing could not be determined."
};

const QUALITY_LABEL = { sufficient: "Sufficient", limited: "Limited", insufficient: "Insufficient" };

function stepLabel(phase) {
  if (phase === "idle") return "Step 1 of 4: Setup";
  if (phase === "loading_model" || phase === "starting_camera" || phase === "positioning") return "Step 2 of 4: Camera and positioning";
  if (phase === "calibrating") return "Step 3 of 4: Calibration";
  if (phase === "capturing" || phase === "analyzing") return "Step 4 of 4: One squat";
  if (phase === "error") return "Not completed";
  return "Capture finished";
}

export function formatDegrees(v) {
  return typeof v === "number" && Number.isFinite(v) ? Math.round(v) + "°" : "Not available";
}

export function formatSeconds(ms) {
  return typeof ms === "number" && Number.isFinite(ms) && ms >= 0 ? (ms / 1000).toFixed(1) + " s" : "Not available";
}

function percent(fraction) {
  return typeof fraction === "number" && Number.isFinite(fraction) ? Math.round(fraction * 100) + "%" : "not available";
}

function statusMessage(state) {
  if (state.phase === "loading_model") return "Preparing the on-device pose model…";
  if (state.phase === "starting_camera") return "Waiting for camera access…";
  if (state.phase === "analyzing") return "Analysing the capture…";
  return GUIDANCE[state.guidance] || GUIDANCE.no_person;
}

/* ─── Trace chart (lightweight SVG, neutral colours) ──────────────────── */

const CHART = { w: 320, h: 180, left: 38, right: 10, top: 12, bottom: 30 };

function finite(v) { return typeof v === "number" && Number.isFinite(v); }

/* Samples → SVG path "M…L…", starting a new sub-path after every gap.
   Non-finite values can never reach the path string. */
export function tracePath(samples, sx, sy) {
  let d = "";
  let pen = false;
  (samples || []).forEach(function (s) {
    if (!s || !finite(s.tMs) || !finite(s.value)) { pen = false; return; }
    const x = sx(s.tMs), y = sy(s.value);
    if (!finite(x) || !finite(y)) { pen = false; return; }
    d += (pen ? "L" : "M") + x.toFixed(1) + " " + y.toFixed(1);
    pen = true;
  });
  return d;
}

export function AngleTraceChart({ result }) {
  const knee = (result && result.traces && result.traces.knee) || [];
  const trunkAvailable = result && result.metrics && result.metrics.trunkThighChange.state === "available";
  const trunk = trunkAvailable ? (result.traces.trunkThigh || []) : [];
  const values = knee.concat(trunk).map(function (s) { return s && s.value; }).filter(finite);
  const times = knee.map(function (s) { return s && s.tMs; }).filter(finite);
  if (values.length === 0 || times.length === 0) return null;

  const yMin = Math.max(0, Math.floor((Math.min.apply(null, values) - 5) / 10) * 10);
  const yMax = Math.min(180, Math.ceil((Math.max.apply(null, values) + 5) / 10) * 10);
  const tMax = Math.max(1, Math.max.apply(null, times));
  const plotW = CHART.w - CHART.left - CHART.right;
  const plotH = CHART.h - CHART.top - CHART.bottom;
  const sx = function (t) { return CHART.left + (t / tMax) * plotW; };
  const sy = function (v) { return CHART.top + (1 - (v - yMin) / Math.max(1, yMax - yMin)) * plotH; };

  const yTicks = [];
  const yStep = yMax - yMin > 80 ? 30 : 20;
  for (let v = Math.ceil(yMin / yStep) * yStep; v <= yMax; v += yStep) yTicks.push(v);
  const xTicks = [];
  for (let t = 0; t <= tMax; t += 1000) xTicks.push(t);

  const ev = result.events || {};
  const markers = [
    { t: ev.descentStartMs, label: "start" },
    { t: ev.deepestMs, label: "deepest" },
    { t: ev.ascentEndMs, label: "end" }
  ].filter(function (m) { return finite(m.t); });

  const rom = result.metrics.kneeRom;
  const summary = "Apparent 2D knee angle over time. Standing reference " + formatDegrees(rom.referenceDeg) +
    ", minimum " + formatDegrees(rom.minimumDeg) + " at " + formatSeconds(ev.deepestMs) +
    ". Descent from " + formatSeconds(ev.descentStartMs) + " to " + formatSeconds(ev.deepestMs) +
    "; ascent until " + formatSeconds(ev.ascentEndMs) + "." +
    (trunkAvailable ? " The dashed line shows the apparent 2D trunk–thigh angle." : "");

  return (
    <figure className="ma-chart">
      <svg viewBox={"0 0 " + CHART.w + " " + CHART.h} role="img" aria-labelledby="ma-chart-title ma-chart-desc" preserveAspectRatio="xMidYMid meet">
        <title id="ma-chart-title">Joint-angle trace</title>
        <desc id="ma-chart-desc">{summary}</desc>
        {yTicks.map(function (v) {
          return (
            <g key={"y" + v}>
              <line className="ma-grid" x1={CHART.left} x2={CHART.w - CHART.right} y1={sy(v)} y2={sy(v)} />
              <text className="ma-axis-text" x={CHART.left - 6} y={sy(v) + 3} textAnchor="end">{v}°</text>
            </g>
          );
        })}
        {xTicks.map(function (t) {
          return <text key={"x" + t} className="ma-axis-text" x={sx(t)} y={CHART.h - 14} textAnchor="middle">{t / 1000}</text>;
        })}
        <text className="ma-axis-text" x={CHART.left + plotW / 2} y={CHART.h - 2} textAnchor="middle">seconds</text>
        {markers.map(function (m) {
          return (
            <g key={m.label}>
              <line className="ma-marker" x1={sx(m.t)} x2={sx(m.t)} y1={CHART.top} y2={CHART.top + plotH} />
              <text className="ma-axis-text" x={sx(m.t)} y={CHART.top + 8} textAnchor="middle">{m.label}</text>
            </g>
          );
        })}
        {trunk.length > 0 && <path className="ma-line ma-line-trunk" d={tracePath(trunk, sx, sy)} />}
        <path className="ma-line ma-line-knee" d={tracePath(knee, sx, sy)} />
      </svg>
      <figcaption className="ma-legend">
        <span><span className="ma-key ma-key-knee" aria-hidden="true" /> Knee (solid)</span>
        {trunkAvailable && <span><span className="ma-key ma-key-trunk" aria-hidden="true" /> Trunk–thigh (dashed)</span>}
        <span>Video-estimated 2D angles in degrees</span>
      </figcaption>
      <p className="ma-note">{summary}</p>
    </figure>
  );
}

/* ─── Quality ──────────────────────────────────────────────────────────── */

function qualityFactorText(f, quality) {
  if (f.id === "usable_frames") return "Usable frames: " + quality.usableFrames + " of " + quality.totalFrames + " (" + percent(f.value) + ")";
  if (f.id === "landmark_confidence") return "Median landmark visibility reported by the pose model: " + (finite(f.value) ? f.value.toFixed(2) : "not available");
  if (f.id === "single_person") return f.value > 0 ? "A second person was detected in " + f.value + " frame" + (f.value === 1 ? "" : "s") : "One person in view";
  if (f.id === "body_in_frame") return "Head and analysed leg in view: " + percent(f.value) + " of frames with a pose";
  if (f.id === "foot_stability") return finite(f.value)
    ? "Foot position shift: " + percent(f.value) + " of standing height" + (f.state === "limited" ? " (camera or feet moved)" : "")
    : "Foot position shift: not available";
  if (f.id === "repetition") return f.value === "one_repetition" ? "One repetition detected" : "No complete single repetition detected";
  return f.id;
}

export function CaptureQuality({ quality }) {
  if (!quality) return null;
  const rate = finite(quality.captureDurationMs) && quality.captureDurationMs > 0
    ? (quality.totalFrames / (quality.captureDurationMs / 1000)) : null;
  return (
    <section className="ma-section" aria-labelledby="ma-quality-title">
      <h3 id="ma-quality-title">Capture quality: {QUALITY_LABEL[quality.state] || quality.state}</h3>
      <p className="ma-note">Describes how reliable this measurement is, not how you moved.</p>
      <ul className="ma-list">
        {quality.factors.map(function (f) {
          return <li key={f.id} data-factor={f.id} data-state={f.state}>{qualityFactorText(f, quality)}{f.state !== "pass" ? " — " + f.state : ""}</li>;
        })}
      </ul>
      {rate !== null && <p className="ma-note">Analysed about {Math.round(rate)} frames per second over {formatSeconds(quality.captureDurationMs)}.</p>}
    </section>
  );
}

function ModelDetails({ result }) {
  const p = result && result.provenance;
  return (
    <details className="ma-details">
      <summary>Model and method</summary>
      <p className="ma-note">
        Pose model: MediaPipe Pose Landmarker ({POSE_MODEL.id}, {POSE_MODEL.version}) run locally with {POSE_PROVIDER.packageName} {POSE_PROVIDER.packageVersion} ({POSE_PROVIDER.delegate}).
        Model SHA-256 {POSE_MODEL.sha256.slice(0, 12)}…{p && p.modelVerifiedOnDevice ? ", verified on this device" : ""}.
      </p>
      <p className="ma-note">
        Knee angle: hip–knee–ankle. Trunk–thigh angle: shoulder–hip–knee (combines hip and trunk motion; not hip flexion).
        Apparent knee ROM = standing reference angle − minimum smoothed angle during the detected repetition.
        Smoothing: 5-sample centred moving median. Landmarks are used only when the model rates them at least 0.5 visible.
      </p>
      <p className="ma-note">{MOVEMENT_ASSESSMENT_VERSION} · {SQUAT_KINEMATICS_VERSION}</p>
    </details>
  );
}

function Limitations() {
  return (
    <section className="ma-section ma-limit" aria-label="Limitations">
      <p>{LIMITATION_TEXT}</p>
      <p className="ma-note">Angles are projections onto one camera image. Camera placement, clothing, lighting and pose-model error all change them; they are not laboratory 3D joint angles.</p>
    </section>
  );
}

/* ─── Screens ──────────────────────────────────────────────────────────── */

function Intro({ onStart }) {
  return (
    <>
      <section className="ma-section" aria-labelledby="ma-what">
        <h3 id="ma-what">What this does</h3>
        <p>Uses your camera to estimate 2D joint angles and timing during one bodyweight squat: an apparent knee range of motion, angle traces, descent and ascent time, and the capture quality.</p>
        <p className="ma-note">{SEPARATION_TEXT}</p>
      </section>
      <section className="ma-section" aria-labelledby="ma-privacy">
        <h3 id="ma-privacy">Privacy</h3>
        <p>{PRIVACY_TEXT[0]} {PRIVACY_TEXT[1]}</p>
        <p className="ma-note">The camera starts only when you tap Start Camera and turns off when the capture ends. Results stay on this screen and are discarded when you leave it or retake.</p>
      </section>
      <section className="ma-section" aria-labelledby="ma-setup">
        <h3 id="ma-setup">Setup</h3>
        <ul className="ma-list">
          <li>Place the phone on a stable surface so it stays still, in portrait orientation.</li>
          <li>Stand side-on, with one side of your body facing the camera.</li>
          <li>Move the camera back until your whole body, head to feet, stays visible throughout the squat.</li>
          <li>Keep your feet visible and leave room to squat.</li>
          <li>Keep the camera level rather than tilted up or down.</li>
          <li>Use bright, even lighting.</li>
          <li>Make sure you are the only person in view.</li>
          <li>Wear clothing that does not completely cover your hips, knees and ankles.</li>
          <li>Stay within about 4 m of the camera. This is setup guidance; the app does not measure distance.</li>
        </ul>
      </section>
      <section className="ma-section" aria-labelledby="ma-protocol">
        <h3 id="ma-protocol">Protocol</h3>
        <ol className="ma-list">
          <li>Tap Start Camera, then walk into position.</li>
          <li>Stand still, side-on, until the screen shows “Squat now” (about 2 seconds of calibration).</li>
          <li>Do one slow, controlled bodyweight squat.</li>
          <li>Return to standing and hold still. The capture ends automatically.</li>
        </ol>
      </section>
      <button type="button" className="btn btn-primary ma-primary" onClick={onStart}>Start Camera</button>
    </>
  );
}

function Active({ state, videoRef, onCancel, onDone }) {
  const message = statusMessage(state);
  const showProgress = state.phase === "calibrating" || state.phase === "capturing";
  return (
    <>
      <div className="ma-preview">
        <video ref={videoRef} className="ma-video" autoPlay muted playsInline aria-label="Live camera preview, not recorded" />
        {(state.phase === "loading_model" || state.phase === "starting_camera") && <div className="ma-preview-overlay" aria-hidden="true">{message}</div>}
      </div>
      <div className={"ma-status" + (state.phase === "capturing" ? " ma-status-squat" : "")} role="status" aria-live="polite">
        {message}
      </div>
      {showProgress && (
        <div className="progress-track ma-progress" role="progressbar" aria-label={state.phase === "capturing" ? "Capture time used" : "Calibration progress"}
          aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round((state.progress || 0) * 100)}>
          <div className="progress-fill" style={{ width: Math.round((state.progress || 0) * 100) + "%", background: "var(--blue)" }} />
        </div>
      )}
      <div className="ma-actions">
        {state.phase === "capturing" && <button type="button" className="btn btn-primary ma-primary" onClick={onDone}>Done</button>}
        <button type="button" className="ma-secondary" onClick={onCancel}>Cancel</button>
      </div>
      <p className="ma-note">Nothing is recorded. The camera turns off when you cancel, leave this screen or the capture ends.</p>
    </>
  );
}

function Results({ result, onRetake, onExit, headingRef }) {
  const m = result.metrics;
  return (
    <>
      <h3 className="ma-result-heading" tabIndex={-1} ref={headingRef}>Results</h3>
      <dl className="tl-stats ma-metrics">
        <div><dt>Apparent 2D knee ROM</dt><dd className="mono">{formatDegrees(m.kneeRom.valueDeg)}<small>standing {formatDegrees(m.kneeRom.referenceDeg)} → minimum {formatDegrees(m.kneeRom.minimumDeg)}</small></dd></div>
        <div><dt>Descent time</dt><dd className="mono">{formatSeconds(m.timing.descentMs)}</dd></div>
        <div><dt>Ascent time</dt><dd className="mono">{formatSeconds(m.timing.ascentMs)}</dd></div>
        <div><dt>Detected repetition time</dt><dd className="mono">{formatSeconds(m.timing.totalMs)}</dd></div>
        <div>
          <dt>Apparent 2D trunk–thigh angle change</dt>
          <dd className="mono">{m.trunkThighChange.state === "available"
            ? <>{formatDegrees(m.trunkThighChange.valueDeg)}<small>standing {formatDegrees(m.trunkThighChange.referenceDeg)} → minimum {formatDegrees(m.trunkThighChange.minimumDeg)}</small></>
            : <>Not available<small>landmark quality too low for this angle</small></>}</dd>
        </div>
        <div><dt>Symmetry</dt><dd>Not estimated for this capture mode<small>{SYMMETRY_TEXT}</small></dd></div>
        <div><dt>Analysed side</dt><dd>{result.analysisSide === "left" ? "Left" : "Right"} side<small>the side most visible to the camera</small></dd></div>
      </dl>
      <p className="ma-note">Video-estimated 2D angles. Times run between the detected 10% knee-angle crossings, so they exclude the start and end of the full movement.</p>
      <AngleTraceChart result={result} />
      <CaptureQuality quality={result.quality} />
      <ModelDetails result={result} />
      <Limitations />
      <div className="ma-actions">
        <button type="button" className="btn btn-primary ma-primary" onClick={onRetake}>Retake</button>
        <button type="button" className="ma-secondary" onClick={onExit}>Done</button>
      </div>
    </>
  );
}

function Insufficient({ state, onRetake, onExit, headingRef }) {
  const result = state.result;
  const reason = result ? (INSUFFICIENT[result.insufficientReason] || "The capture could not be analysed.")
    : "A usable standing, side-on pose was not established within 45 seconds." + (GUIDANCE[state.positioningReason] ? " Last message: " + GUIDANCE[state.positioningReason] : "");
  return (
    <>
      <h3 className="ma-result-heading" tabIndex={-1} ref={headingRef}>Insufficient movement data</h3>
      <p role="status">{reason}</p>
      <p className="ma-note">No measurements are shown because they would not be reliable. Check the setup steps and retake.</p>
      {result && <CaptureQuality quality={result.quality} />}
      <Limitations />
      <div className="ma-actions">
        <button type="button" className="btn btn-primary ma-primary" onClick={onRetake}>Retake</button>
        <button type="button" className="ma-secondary" onClick={onExit}>Done</button>
      </div>
    </>
  );
}

function ErrorState({ code, onRetry, onExit, headingRef }) {
  return (
    <>
      <h3 className="ma-result-heading" tabIndex={-1} ref={headingRef}>Assessment stopped</h3>
      <p role="alert">{ERRORS[code] || ERRORS.camera_error}</p>
      <div className="ma-actions">
        <button type="button" className="btn btn-primary ma-primary" onClick={onRetry}>Try again</button>
        <button type="button" className="ma-secondary" onClick={onExit}>Back</button>
      </div>
    </>
  );
}

/* Pure view of one session state; exported for tests. */
export function MovementAssessmentView({ state, videoRef, headingRef, actions }) {
  const phase = state.phase;
  const active = ["loading_model", "starting_camera", "positioning", "calibrating", "capturing", "analyzing"].indexOf(phase) >= 0;
  return (
    <div className="ma-screen fade-in" data-phase={phase}>
      <div className="screen-header">
        <button type="button" className="screen-back-btn" onClick={actions.exit}>{"‹"} Back</button>
      </div>
      <div className="ma-title-row">
        <h2 className="ma-title">Movement Assessment</h2>
        <span className="ma-badge">Prototype</span>
      </div>
      <div className="ma-subtitle">{ASSESSMENT_LABEL}</div>
      <p className="ma-step" aria-current="step">{stepLabel(phase)}</p>

      {phase === "idle" && <Intro onStart={actions.start} />}
      {active && <Active state={state} videoRef={videoRef} onCancel={actions.cancel} onDone={actions.finish} />}
      {phase === "results" && state.result && <Results result={state.result} onRetake={actions.retake} onExit={actions.exit} headingRef={headingRef} />}
      {phase === "insufficient" && <Insufficient state={state} onRetake={actions.retake} onExit={actions.exit} headingRef={headingRef} />}
      {phase === "error" && <ErrorState code={state.errorCode} onRetry={actions.retake} onExit={actions.exit} headingRef={headingRef} />}
    </div>
  );
}

export function MovementAssessment({ onExit, sessionFactory }) {
  const sessionRef = useRef(null);
  const headingRef = useRef(null);
  const [state, setState] = useState(IDLE_STATE);

  useEffect(function () {
    const session = (sessionFactory || createAssessmentSession)();
    sessionRef.current = session;
    setState(session.getState());
    const unsubscribe = session.subscribe(setState);
    return function () {
      unsubscribe();
      session.dispose();
      sessionRef.current = null;
    };
  }, []);

  const phase = state.phase;
  useEffect(function () {
    if ((phase === "results" || phase === "insufficient" || phase === "error") && headingRef.current) {
      try { headingRef.current.focus(); } catch (e) { /* focus is best-effort */ }
    }
  }, [phase]);

  const videoRef = useCallback(function (el) {
    if (sessionRef.current) sessionRef.current.setVideoElement(el);
  }, []);

  const actions = {
    start: function () { if (sessionRef.current) sessionRef.current.start(); },
    retake: function () { if (sessionRef.current) sessionRef.current.retake(); },
    cancel: function () { if (sessionRef.current) sessionRef.current.cancel(); },
    finish: function () { if (sessionRef.current) sessionRef.current.finishCapture(); },
    exit: function () {
      if (sessionRef.current) sessionRef.current.cancel();
      if (onExit) onExit();
    }
  };

  return <MovementAssessmentView state={state} videoRef={videoRef} headingRef={headingRef} actions={actions} />;
}
