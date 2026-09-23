/* Milestone 6 — symmetric centred moving-median smoothing. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { smoothTrace, SMOOTHING } from "../js/movement/smoothing.js";

const S = (tMs, value) => ({ tMs, value, state: "valid" });
const MISSING = (tMs, state = "low_confidence") => ({ tMs, value: null, state });

function noisyTrace() {
  // truth: 170 − 60·sin(πt/4000) over 0..4000 ms at 100 ms; deterministic
  // noise ±2° plus three single-frame spikes of ±25°.
  let seed = 7;
  const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  const out = [];
  for (let t = 0; t <= 4000; t += 100) {
    const truth = 170 - 60 * Math.sin(Math.PI * t / 4000);
    let v = truth + (rnd() - 0.5) * 4;
    if (t === 800) v += 25;
    if (t === 2000) v -= 25;
    if (t === 3300) v += 25;
    out.push({ truth, s: S(t, v) });
  }
  return out;
}

test("parameters are the documented ones", () => {
  assert.deepEqual(SMOOTHING, { method: "symmetric_centered_moving_median", halfWindowSamples: 2, maxNeighborOffsetMs: 300 });
});

test("deterministic and does not mutate its input", () => {
  const input = noisyTrace().map((x) => x.s);
  const copy = JSON.parse(JSON.stringify(input));
  const a = smoothTrace(input), b = smoothTrace(input);
  assert.deepEqual(a, b);
  assert.deepEqual(input, copy);
});

test("reduces noise and removes single-frame spikes", () => {
  const rows = noisyTrace();
  const out = smoothTrace(rows.map((r) => r.s));
  const rmse = (vals) => Math.sqrt(vals.reduce((s, v, i) => s + (v - rows[i].truth) ** 2, 0) / vals.length);
  const rawErr = rmse(rows.map((r) => r.s.value));
  const smErr = rmse(out.map((o) => o.value));
  assert.ok(smErr < rawErr / 2, `smoothed RMSE ${smErr} vs raw ${rawErr}`);
  // A removed spike is replaced by a value from within its neighbours' range
  // (on a steep slope that is a neighbour's value, not the truth itself).
  [800, 2000, 3300].forEach((t) => {
    const i = t / 100;
    const nb = [i - 2, i - 1, i + 1, i + 2].map((j) => rows[j].s.value);
    assert.ok(out[i].value >= Math.min(...nb) && out[i].value <= Math.max(...nb), "spike at " + t + " survived: " + out[i].value);
    assert.ok(Math.abs(out[i].value - rows[i].truth) < Math.abs(rows[i].s.value - rows[i].truth) / 4);
  });
});

test("timestamps stay aligned and raw values are preserved alongside", () => {
  const input = noisyTrace().map((x) => x.s);
  const out = smoothTrace(input);
  assert.equal(out.length, input.length);
  out.forEach((o, i) => {
    assert.equal(o.tMs, input[i].tMs);
    assert.equal(o.raw, input[i].value);
  });
});

test("linear ramps pass through unchanged, including the ends (no phase shift)", () => {
  const ramp = [];
  for (let t = 0; t <= 1000; t += 100) ramp.push(S(t, 175 - t * 0.05));
  smoothTrace(ramp).forEach((o, i) => assert.equal(o.value, ramp[i].value));
});

test("…and across gaps, because neighbours only enter in symmetric pairs", () => {
  const ramp = [];
  for (let t = 0; t <= 1500; t += 100) ramp.push(t % 400 === 200 ? MISSING(t) : S(t, 175 - t * 0.05));
  smoothTrace(ramp).forEach((o, i) => assert.equal(o.value, ramp[i].value));
});

test("boundary windows shrink symmetrically: hand-computed values", () => {
  const out = smoothTrace([S(0, 10), S(100, 50), S(200, 20), S(300, 30), S(400, 40)]);
  assert.equal(out[0].value, 10);   // window: itself only
  assert.equal(out[1].value, 20);   // median(10, 50, 20)
  assert.equal(out[2].value, 30);   // median(10, 50, 20, 30, 40)
  assert.equal(out[3].value, 30);   // median(20, 30, 40)
  assert.equal(out[4].value, 40);   // itself only
});

test("missing samples stay missing and are never used as neighbours", () => {
  const out = smoothTrace([S(0, 100), MISSING(100), S(200, 110), MISSING(300, "no_pose"), S(400, 120)]);
  assert.equal(out[1].value, null);
  assert.equal(out[1].state, "low_confidence");
  assert.equal(out[3].value, null);
  assert.equal(out[3].state, "no_pose");
  assert.equal(out[2].value, 110);   // pair (±1) missing, pair (±2) valid: median(100, 110, 120)
  out.forEach((o) => assert.ok(o.value === null || Number.isFinite(o.value)));
});

test("pairs beyond 300 ms are excluded, so a gap is never bridged", () => {
  const out = smoothTrace([S(0, 100), S(100, 100), S(700, 160), S(800, 160), S(900, 160)]);
  assert.equal(out[1].value, 100);   // the +1 partner is 600 ms away → itself only
  assert.equal(out[2].value, 160);
  assert.equal(out[3].value, 160);   // median(160, 160, 160)
});

test("never produces NaN, even from hostile input", () => {
  const out = smoothTrace([S(0, NaN), { tMs: NaN, value: 5, state: "valid" }, null, S(200, Infinity), S(300, 90)]);
  out.forEach((o) => assert.ok(o.value === null || Number.isFinite(o.value)));
  assert.equal(out[4].value, 90);
});
