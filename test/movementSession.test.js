/* Milestone 6 — camera/inference lifecycle. Fake camera, provider, clock and
   frame scheduler; the invariant under test everywhere is that every
   acquired track is stopped and no stale work reaches a later session. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createAssessmentSession, ACTIVE_PHASES } from "../js/movement/assessmentSession.js";
import { normalizePoseResult } from "../js/movement/poseContract.js";
import { CAPTURE } from "../js/movement/squatAssessment.js";
import { providerResultAt } from "./fixtures/syntheticPose.js";

/* ─── Fakes ─────────────────────────────────────────────────────────────── */

class FakeTrack {
  constructor(log) { this.readyState = "live"; this.kind = "video"; this.listeners = {}; this.log = log; }
  stop() { if (this.readyState !== "ended") this.log.stopped += 1; this.readyState = "ended"; }
  addEventListener(type, fn) { (this.listeners[type] = this.listeners[type] || []).push(fn); }
  removeEventListener(type, fn) { this.listeners[type] = (this.listeners[type] || []).filter((f) => f !== fn); }
  fire(type) { (this.listeners[type] || []).slice().forEach((fn) => fn()); }
}

function deferred() {
  let resolve, reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

function fakeMediaDevices(mode = "grant") {
  const log = { calls: 0, constraints: [], tracks: [], stopped: 0, pending: [] };
  const makeStream = () => {
    const t = new FakeTrack(log);
    log.tracks.push(t);
    return { getTracks: () => [t], getVideoTracks: () => [t] };
  };
  const errorFor = { deny: "NotAllowedError", none: "NotFoundError", inuse: "NotReadableError", error: "WeirdError", overconstrained: "OverconstrainedError", security: "SecurityError" };
  return {
    log,
    mode,
    getUserMedia(constraints) {
      log.calls += 1;
      log.constraints.push(JSON.parse(JSON.stringify(constraints)));
      const m = this.mode;
      if (m === "grant") return Promise.resolve(makeStream());
      if (m === "pending") { const d = deferred(); log.pending.push({ d, makeStream }); return d.promise; }
      const e = new Error(m); e.name = errorFor[m];
      return Promise.reject(e);
    }
  };
}

function fakeProvider(opts = {}) {
  const state = { created: 0, closed: 0, detectCalls: 0, pending: [], scenario: opts.scenario || "squat", async: !!opts.async, dims: { w: 640, h: 480 } };
  const factory = (arg) => {
    state.created += 1;
    state.lastArg = arg;
    const p = {
      identity: { modelVerifiedOnDevice: true },
      modelBytes: new Uint8Array([1, 2, 3]),
      detect(video, t) {
        state.detectCalls += 1;
        const frame = normalizePoseResult(providerResultAt(t, state.scenario), { timestampMs: t, frameWidth: state.dims.w, frameHeight: state.dims.h });
        if (!state.async) return frame;
        const d = deferred();
        state.pending.push({ d, frame });
        return d.promise;
      },
      close() { state.closed += 1; }
    };
    if (opts.factoryPending) {
      const d = deferred();
      state.factoryPending = { d, p };
      return d.promise;
    }
    if (opts.fail) { const e = new Error(opts.fail); e.code = opts.fail; return Promise.reject(e); }
    return Promise.resolve(p);
  };
  return { state, factory };
}

function harness(o = {}) {
  let now = 0;
  const queue = [];
  let maxQueue = 0;
  const md = o.mediaDevices || fakeMediaDevices(o.camera || "grant");
  const prov = o.provider || fakeProvider(o.providerOpts);
  const docListeners = {}, winListeners = {};
  const doc = {
    visibilityState: "visible",
    addEventListener: (t, fn) => { (docListeners[t] = docListeners[t] || []).push(fn); },
    removeEventListener: (t, fn) => { docListeners[t] = (docListeners[t] || []).filter((f) => f !== fn); },
    defaultView: {
      addEventListener: (t, fn) => { (winListeners[t] = winListeners[t] || []).push(fn); },
      removeEventListener: (t, fn) => { winListeners[t] = (winListeners[t] || []).filter((f) => f !== fn); }
    }
  };
  const session = createAssessmentSession({
    mediaDevices: "mediaDevices" in o ? o.mediaDevices : md,
    createProvider: prov.factory,
    now: () => now,
    scheduleFrame: (cb) => { queue.push(cb); maxQueue = Math.max(maxQueue, queue.length); return cb; },
    cancelFrame: (h) => { const i = queue.indexOf(h); if (i >= 0) queue.splice(i, 1); },
    doc
  });
  const video = { readyState: 4, videoWidth: 640, videoHeight: 480, srcObject: null, muted: false, playsInline: false, paused: true,
    play() { this.paused = false; return Promise.resolve(); }, pause() { this.paused = true; }, setAttribute() {} };
  const phases = [];
  session.subscribe((s) => phases.push(s.phase));
  session.setVideoElement(video);
  const flush = () => new Promise((r) => setImmediate(r));
  return {
    session, md, prov, video, doc, docListeners, winListeners, phases,
    queue, maxQueue: () => maxQueue,
    advance(ms) { now += ms; },
    now: () => now,
    flush,
    /* Run animation frames every `stepMs` of fake time for `durationMs`. */
    async run(durationMs, stepMs = 33) {
      const end = now + durationMs;
      while (now < end) {
        now += stepMs;
        const cbs = queue.splice(0, queue.length);
        cbs.forEach((cb) => cb(now));
        await flush();
      }
    },
    fireDoc(type) { (docListeners[type] || []).forEach((fn) => fn()); },
    fireWin(type) { (winListeners[type] || []).forEach((fn) => fn()); }
  };
}

const allStopped = (md) => md.log.tracks.every((t) => t.readyState === "ended");

/* ─── Permission & acquisition ──────────────────────────────────────────── */

test("creating the session requests nothing: no camera, no model", async () => {
  const h = harness();
  await h.flush();
  assert.equal(h.md.log.calls, 0);
  assert.equal(h.prov.state.created, 0);
  assert.equal(h.session.getState().phase, "idle");
});

test("granted: model loads first, then the camera (video only, no audio)", async () => {
  const h = harness();
  await h.session.start();
  assert.deepEqual(h.phases.slice(0, 3), ["loading_model", "starting_camera", "positioning"]);
  assert.equal(h.prov.state.created, 1);
  assert.equal(h.md.log.calls, 1);
  assert.equal(h.md.log.constraints[0].audio, false);
  assert.ok(h.md.log.constraints[0].video);
  assert.equal(h.video.srcObject !== null, true);
  assert.equal(h.video.muted, true);
  assert.equal(h.session.getState().hasStream, true);
});

for (const [mode, code] of [["deny", "permission_denied"], ["security", "permission_denied"], ["none", "no_camera"], ["overconstrained", "no_camera"], ["inuse", "camera_in_use"], ["error", "camera_error"]]) {
  test(`camera ${mode} → error "${code}", model released, nothing left running`, async () => {
    const h = harness({ camera: mode });
    await h.session.start();
    const s = h.session.getState();
    assert.equal(s.phase, "error");
    assert.equal(s.errorCode, code);
    assert.equal(h.prov.state.closed, h.prov.state.created);
    assert.equal(h.queue.length, 0, "no frame loop");
    assert.equal(h.md.log.calls, 1, "no automatic re-prompt");
    await h.run(500);
    assert.equal(h.md.log.calls, 1, "still no automatic re-prompt");
  });
}

test("unsupported browser (no mediaDevices) → error, no crash", async () => {
  const h = harness({ mediaDevices: null });
  await h.session.start();
  assert.equal(h.session.getState().errorCode, "unsupported_browser");
});

test("model failure → error; the camera is never requested", async () => {
  for (const code of ["unsupported_runtime", "model_integrity", "model_unavailable", "runtime_unavailable"]) {
    const h = harness({ provider: fakeProvider({ fail: code }) });
    await h.session.start();
    assert.equal(h.session.getState().errorCode, code);
    assert.equal(h.md.log.calls, 0);
  }
});

/* ─── Full run, cancel, retake, unmount ─────────────────────────────────── */

test("complete run: calibration → capture → results; camera off before analysis", async () => {
  const h = harness();
  await h.session.start();
  await h.run(9000);
  const s = h.session.getState();
  assert.equal(s.phase, "results");
  assert.ok(h.phases.includes("calibrating"));
  assert.ok(h.phases.includes("capturing"));
  assert.ok(h.phases.indexOf("analyzing") < h.phases.indexOf("results"));
  assert.equal(s.result.status, "complete");
  assert.ok(Math.abs(s.result.metrics.kneeRom.valueDeg - 80) <= 1.5, String(s.result.metrics.kneeRom.valueDeg));
  assert.ok(allStopped(h.md));
  assert.equal(s.hasStream, false);
  assert.equal(h.video.srcObject, null);
  assert.equal(h.prov.state.closed, 1);
  assert.equal(h.queue.length, 0, "frame loop stopped");
  assert.equal(h.maxQueue(), 1, "never more than one scheduled frame callback");
  assert.equal(s.result.provenance.modelVerifiedOnDevice, true);
});

test("cancel during capture stops the camera, closes the model and returns to idle", async () => {
  const h = harness();
  await h.session.start();
  await h.run(2600);
  assert.equal(h.session.getState().phase, "capturing");
  h.session.cancel();
  assert.equal(h.session.getState().phase, "idle");
  assert.ok(allStopped(h.md));
  assert.equal(h.prov.state.closed, 1);
  assert.equal(h.queue.length, 0);
  assert.equal(h.session.getState().result, null);
});

test("a second person during capture stops immediately and cannot produce metrics", async () => {
  const h = harness();
  await h.session.start();
  await h.run(2600);
  assert.equal(h.session.getState().phase, "capturing");
  h.prov.state.scenario = "two";
  await h.run(100);
  const s = h.session.getState();
  assert.equal(s.phase, "insufficient");
  assert.equal(s.result.insufficientReason, "multiple_people_during_capture");
  assert.equal(s.result.metrics.kneeRom.state, "unavailable");
  assert.ok(allStopped(h.md));
  assert.equal(h.prov.state.closed, 1);
  assert.equal(h.queue.length, 0);
});

test("dispose (unmount) mid-capture releases everything and emits nothing afterwards", async () => {
  const h = harness();
  await h.session.start();
  await h.run(3000);
  const before = h.phases.length;
  h.session.dispose();
  assert.ok(allStopped(h.md));
  assert.equal(h.prov.state.closed, 1);
  assert.equal(h.queue.length, 0);
  await h.run(1000);
  assert.equal(h.phases.length, before);
  assert.equal((h.docListeners.visibilitychange || []).length, 0, "document listener removed");
  assert.equal((h.winListeners.pagehide || []).length, 0, "window listener removed");
  await h.session.start();
  assert.equal(h.md.log.calls, 1, "a disposed session never restarts the camera");
});

test("open → cancel → reopen → complete → retake → leave: no leaked streams or duplicate loops", async () => {
  const h = harness();
  await h.session.start();          // open
  await h.run(500);
  h.session.cancel();               // cancel
  await h.session.start();          // reopen
  await h.run(9000);                // complete
  assert.equal(h.session.getState().phase, "results");
  await h.session.retake();         // retake
  assert.equal(h.session.getState().result, null);
  assert.equal(h.session.getState().phase, "positioning");
  await h.run(1500);
  h.session.dispose();              // leave
  assert.equal(h.md.log.calls, 3);
  assert.equal(h.md.log.tracks.length, 3);
  assert.ok(allStopped(h.md), "every acquired track stopped");
  assert.equal(h.md.log.stopped, 3);
  assert.equal(h.prov.state.created, 3);
  assert.equal(h.prov.state.closed, 3);
  assert.equal(h.maxQueue(), 1);
  const st = h.session.getStats();
  assert.equal(st.tracksAcquired, st.tracksStopped);
  assert.deepEqual(h.prov.state.lastArg.modelBytes, new Uint8Array([1, 2, 3]), "verified model bytes reused on retake");
});

/* ─── Races ─────────────────────────────────────────────────────────────── */

test("permission prompt still open → cancel → grant arrives later: stream is stopped at once", async () => {
  const h = harness({ camera: "pending" });
  const starting = h.session.start();
  await h.flush();
  assert.equal(h.session.getState().phase, "starting_camera");
  h.session.cancel();
  const { d, makeStream } = h.md.log.pending[0];
  d.resolve(makeStream());
  await starting;
  assert.equal(h.session.getState().phase, "idle");
  assert.ok(allStopped(h.md));
  assert.equal(h.video.srcObject, null);
  assert.equal(h.queue.length, 0);
});

test("unmount while the permission prompt is open: late stream is stopped", async () => {
  const h = harness({ camera: "pending" });
  const starting = h.session.start();
  await h.flush();
  h.session.dispose();
  const { d, makeStream } = h.md.log.pending[0];
  d.resolve(makeStream());
  await starting;
  assert.ok(allStopped(h.md));
});

test("model still loading → cancel: the late provider is closed and the camera never requested", async () => {
  const prov = fakeProvider({ factoryPending: true });
  const h = harness({ provider: prov });
  const starting = h.session.start();
  await h.flush();
  h.session.cancel();
  prov.state.factoryPending.d.resolve(prov.state.factoryPending.p);
  await starting;
  assert.equal(prov.state.closed, 1);
  assert.equal(h.md.log.calls, 0);
  assert.equal(h.session.getState().phase, "idle");
});

test("inference concurrency: while one inference is pending, frames are skipped, never queued", async () => {
  const prov = fakeProvider({ async: true });
  const h = harness({ provider: prov });
  await h.session.start();
  await h.run(1000);
  assert.equal(prov.state.detectCalls, 1, "only one inference in flight");
  assert.ok(h.session.getStats().skippedBusy > 20);
  const first = prov.state.pending.shift();
  first.d.resolve(first.frame);
  await h.flush();
  await h.run(100);
  assert.equal(prov.state.detectCalls, 2, "the next inference starts only after the previous one finished");
});

test("frames closer than the inference interval are skipped (bounded rate)", async () => {
  const h = harness();
  await h.session.start();
  await h.run(1000, 16);                  // 60 fps display
  const st = h.session.getStats();
  assert.ok(st.skippedInterval > 0);
  assert.ok(st.inferences <= Math.ceil(1000 / CAPTURE.minInferenceIntervalMs) + 1, String(st.inferences));
});

test("cancel with an inference pending: the late result cannot resurrect the assessment", async () => {
  const prov = fakeProvider({ async: true });
  const h = harness({ provider: prov });
  await h.session.start();
  await h.run(100);
  const pending = prov.state.pending.shift();
  h.session.cancel();
  const phasesBefore = h.phases.length;
  pending.d.resolve(pending.frame);
  await h.flush();
  assert.equal(h.session.getState().phase, "idle");
  assert.equal(h.phases.length, phasesBefore);
  assert.equal(h.session.getStats().staleDiscarded, 1);
});

test("retake with an inference pending: the old result does not contaminate the new session", async () => {
  const prov = fakeProvider({ async: true });
  const h = harness({ provider: prov });
  await h.session.start();
  await h.run(100);
  const old = prov.state.pending.shift();
  await h.session.retake();
  // The stale frame claims to come from far in the future of the old session.
  old.d.resolve(normalizePoseResult(providerResultAt(4200, "squat"), { timestampMs: 99999, frameWidth: 640, frameHeight: 480 }));
  await h.flush();
  assert.equal(h.session.getStats().staleDiscarded, 1);
  assert.equal(h.session.getState().phase, "positioning");
  // The new session keeps running normally from its own frames.
  for (let i = 0; i < 40; i++) {
    await h.run(70);
    while (prov.state.pending.length) { const p = prov.state.pending.shift(); p.d.resolve(p.frame); await h.flush(); }
  }
  assert.ok(["calibrating", "capturing"].includes(h.session.getState().phase), h.session.getState().phase);
});

/* ─── Interruptions ─────────────────────────────────────────────────────── */

test("backgrounding (visibilitychange → hidden) stops capture; nothing continues in the background", async () => {
  const h = harness();
  await h.session.start();
  await h.run(2600);
  h.doc.visibilityState = "hidden";
  h.fireDoc("visibilitychange");
  const s = h.session.getState();
  assert.equal(s.phase, "error");
  assert.equal(s.errorCode, "interrupted_background");
  assert.ok(allStopped(h.md));
  assert.equal(h.queue.length, 0);
});

test("pagehide stops capture; backgrounding while idle or on results is a no-op", async () => {
  const h = harness();
  h.doc.visibilityState = "hidden";
  h.fireDoc("visibilitychange");
  assert.equal(h.session.getState().phase, "idle");
  h.doc.visibilityState = "visible";
  await h.session.start();
  h.fireWin("pagehide");
  assert.equal(h.session.getState().errorCode, "interrupted_background");
  assert.ok(allStopped(h.md));
  const h2 = harness();
  await h2.session.start();
  await h2.run(9000);
  h2.fireWin("pagehide");
  assert.equal(h2.session.getState().phase, "results");
});

test("track ended by the system → camera_interrupted, everything released", async () => {
  const h = harness();
  await h.session.start();
  await h.run(300);
  h.md.log.tracks[0].fire("ended");
  assert.equal(h.session.getState().errorCode, "camera_interrupted");
  assert.ok(allStopped(h.md));
  assert.equal(h.prov.state.closed, 1);
});

test("orientation change mid-assessment → explicit error rather than mixed geometry", async () => {
  const h = harness();
  await h.session.start();
  await h.run(500);
  h.prov.state.dims = { w: 480, h: 640 };
  await h.run(200);
  assert.equal(h.session.getState().errorCode, "orientation_changed");
  assert.ok(allStopped(h.md));
});

test("no person for 45 s → insufficient (positioning), camera off", async () => {
  const h = harness({ providerOpts: { scenario: "none" } });
  await h.session.start();
  await h.run(CAPTURE.positioningTimeoutMs + 500, 100);
  const s = h.session.getState();
  assert.equal(s.phase, "insufficient");
  assert.equal(s.result, null);
  assert.equal(s.positioningReason, "no_person");
  assert.ok(allStopped(h.md));
});

test("standing still through capture → capture ends at 10 s with insufficient data, no numbers", async () => {
  const h = harness({ providerOpts: { scenario: "stand" } });
  await h.session.start();
  await h.run(14000, 50);
  const s = h.session.getState();
  assert.equal(s.phase, "insufficient");
  assert.equal(s.result.insufficientReason, "no_clear_repetition");
  assert.equal(s.result.metrics.kneeRom.state, "unavailable");
  assert.ok(allStopped(h.md));
});

test("user taps Done during capture → analysis of what was captured, camera off", async () => {
  const h = harness();
  await h.session.start();
  await h.run(2600);
  h.session.finishCapture();
  assert.ok(["insufficient", "results"].includes(h.session.getState().phase));
  assert.ok(allStopped(h.md));
});

test("ACTIVE_PHASES documents exactly the phases that hold resources", () => {
  assert.deepEqual(ACTIVE_PHASES, ["loading_model", "starting_camera", "positioning", "calibrating", "capturing", "analyzing"]);
});
