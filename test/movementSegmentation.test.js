/* Milestone 6 — one-repetition squat segmentation. Every expected time is
   derived by hand from the piecewise-linear synthetic trace:

   standing 175° until 3000 ms; linear to 95° at 4200 ms; held to 4600 ms;
   linear back to 175° at 5800 ms. Reference R = 175, so E = 80° and the
   phase threshold T = 175 − 0.1·80 = 167°.
     descent start: 175 − 80·(t−3000)/1200 = 167 → t = 3120 ms
     deepest (earliest minimum): 4200 ms
     ascent end:     95 + 80·(t−4600)/1200 = 167 → t = 5680 ms
   → descent 1080 ms, ascent 1480 ms, total 2560 ms, ROM 80°. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { segmentSingleSquat, SEGMENTATION } from "../js/movement/squatSegmentation.js";
import { smoothTrace } from "../js/movement/smoothing.js";
import { squatKneeAt } from "./fixtures/syntheticPose.js";

function trace(fn, from = 0, to = 8000, step = 100) {
  const out = [];
  for (let t = from; t <= to; t += step) {
    const v = fn(t);
    out.push(v === null ? { tMs: t, value: null, state: "missing" } : { tMs: t, value: v, state: "valid" });
  }
  return smoothTrace(out);
}
const close = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg || ""} ${a} ≉ ${b}`);

test("parameters are the documented detection parameters", () => {
  assert.deepEqual(SEGMENTATION, {
    minCaptureValidSamples: 10, minExcursionDeg: 20, phaseThresholdFraction: 0.1,
    secondRepFraction: 0.5, maxGapMs: 300, minRepSamples: 8
  });
});

test("clean squat: every phase timestamp and duration matches the hand calculation", () => {
  const r = segmentSingleSquat(trace((t) => squatKneeAt(t)), 175);
  assert.equal(r.state, "segmented");
  close(r.excursionDeg, 80, 1e-9, "ROM");
  close(r.thresholdDeg, 167, 1e-9);
  close(r.events.descentStartMs, 3120, 1e-6, "descent start");
  assert.equal(r.events.deepestMs, 4200);
  close(r.events.ascentEndMs, 5680, 1e-6, "ascent end");
  close(r.durations.descentMs, 1080, 1e-6);
  close(r.durations.ascentMs, 1480, 1e-6);
  close(r.durations.totalMs, 2560, 1e-6);
});

test("crossings between samples are linearly interpolated (off-grid threshold)", () => {
  // Samples at 200 ms: 175 @2800, 175 @3000, 161.67 @3200 … T=167 is crossed
  // between 3000 (175) and 3200 (161.67): 3000 + (175−167)/(175−161.667)·200 = 3120.
  const r = segmentSingleSquat(trace((t) => squatKneeAt(t), 0, 9000, 200), 175);
  assert.equal(r.state, "segmented");
  close(r.events.descentStartMs, 3120, 1e-6);
});

test("the earliest minimum is the deepest point (a pause at the bottom counts as ascent)", () => {
  const r = segmentSingleSquat(trace((t) => squatKneeAt(t, { riseAt: 5200, standAt: 6400 })), 175);
  assert.equal(r.events.deepestMs, 4200);
  close(r.durations.ascentMs, 5200 + 1080 - 4200, 1e-6);
});

test("no movement fails cleanly", () => {
  const r = segmentSingleSquat(trace(() => 175), 175);
  assert.deepEqual([r.state, r.reason], ["insufficient", "no_clear_repetition"]);
  assert.equal("events" in r, false);
});

test("jitter (±4° with spikes) does not invent a repetition", () => {
  let seed = 99;
  const rnd = () => { seed = (seed * 48271) % 2147483647; return seed / 2147483647; };
  const r = segmentSingleSquat(trace((t) => 175 + (rnd() - 0.5) * 8 + (t % 1700 === 0 ? -9 : 0)), 175);
  assert.equal(r.reason, "no_clear_repetition");
});

test("movement below the 20° detection floor is not segmented", () => {
  const r = segmentSingleSquat(trace((t) => squatKneeAt(t, { bottomDeg: 157 })), 175);
  assert.equal(r.reason, "no_clear_repetition");
  close(r.excursionDeg, 18, 1e-9);
  // and just above it is
  assert.equal(segmentSingleSquat(trace((t) => squatKneeAt(t, { bottomDeg: 154 })), 175).state, "segmented");
});

test("partial movement: never returns to standing, or starts before capture", () => {
  const down = segmentSingleSquat(trace((t) => (t <= 3000 ? 175 : Math.max(95, 175 - (t - 3000) / 15))), 175);
  assert.equal(down.reason, "did_not_return_to_standing");
  const started = segmentSingleSquat(trace((t) => squatKneeAt(t + 4000)), 175);
  assert.equal(started.reason, "repetition_started_before_capture");
});

test("two movements are rejected as a protocol violation, never averaged", () => {
  const second = { descentAt: 6600, bottomAt: 7400, riseAt: 7600, standAt: 8400 };
  const two = trace((t) => Math.min(squatKneeAt(t), squatKneeAt(t, second)), 0, 9500);
  assert.equal(segmentSingleSquat(two, 175).reason, "multiple_repetitions");
  // a deeper SECOND squat: the earlier, shallower one is outside the window
  const deeperSecond = trace((t) => Math.min(squatKneeAt(t, { bottomDeg: 120 }), squatKneeAt(t, Object.assign({ bottomDeg: 90 }, second))), 0, 9500);
  assert.equal(segmentSingleSquat(deeperSecond, 175).reason, "multiple_repetitions");
  // a small second dip (< half the excursion) is not a repetition
  const small = trace((t) => Math.min(squatKneeAt(t), squatKneeAt(t, Object.assign({ bottomDeg: 150 }, second))), 0, 9500);
  assert.equal(segmentSingleSquat(small, 175).state, "segmented");
});

test("realistic missing frames (every 5th dropped) still segment with bounded timing error", () => {
  const r = segmentSingleSquat(trace((t) => (t % 500 === 200 ? null : squatKneeAt(t))), 175);
  assert.equal(r.state, "segmented");
  close(r.excursionDeg, 80, 1e-9);
  close(r.events.descentStartMs, 3120, 1e-6);
  close(r.events.ascentEndMs, 5680, 1e-6);
});

test("a tracking gap inside the repetition fails instead of guessing the bottom", () => {
  const r = segmentSingleSquat(trace((t) => (t > 3800 && t < 4400 ? null : squatKneeAt(t))), 175);
  assert.equal(r.reason, "data_gap_during_repetition");
  assert.ok(r.maxGapMs > SEGMENTATION.maxGapMs);
});

test("too few valid samples, too few inside the repetition, or no reference", () => {
  assert.equal(segmentSingleSquat(trace((t) => (t < 900 ? squatKneeAt(t) : null)), 175).reason, "insufficient_valid_frames");
  // a 400 ms squat sampled at 100 ms has only 3 samples inside it
  const quick = trace((t) => squatKneeAt(t, { descentAt: 3000, bottomAt: 3200, riseAt: 3200, standAt: 3400 }));
  assert.equal(segmentSingleSquat(quick, 175).reason, "too_few_samples_in_repetition");
  [undefined, null, NaN, Infinity, "175"].forEach((ref) => {
    assert.equal(segmentSingleSquat(trace((t) => squatKneeAt(t)), ref).reason, "no_reference");
  });
});

test("durations are never negative, NaN or Infinity (sweep of shapes)", () => {
  for (let bottom = 60; bottom <= 150; bottom += 15) {
    for (let pause = 0; pause <= 800; pause += 400) {
      const spec = { bottomDeg: bottom, riseAt: 4200 + pause, standAt: 5400 + pause };
      const r = segmentSingleSquat(trace((t) => squatKneeAt(t, spec), 0, 9000), 175);
      if (r.state !== "segmented") continue;
      Object.values(r.durations).forEach((d) => assert.ok(Number.isFinite(d) && d >= 0));
    }
  }
});
