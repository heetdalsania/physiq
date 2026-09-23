/* Milestone 6 — pure 2D geometry. Expected values are derived by hand from
   the vector definitions, never by calling the implementation. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { includedAngleDeg, distance, midpoint, median, mean, percentile } from "../js/movement/geometry.js";

const P = (x, y) => ({ x, y });
const close = (actual, expected, tol = 1e-9) => assert.ok(Math.abs(actual - expected) <= tol, `${actual} ≉ ${expected}`);

test("straight line through the vertex is 180°", () => {
  close(includedAngleDeg(P(0, 0), P(1, 0), P(2, 0)), 180);
  close(includedAngleDeg(P(5, -3), P(5, 1), P(5, 9)), 180);
});

test("right angle is 90°", () => {
  close(includedAngleDeg(P(0, 1), P(0, 0), P(1, 0)), 90);
  close(includedAngleDeg(P(10, 20), P(10, 10), P(-5, 10)), 90);
});

test("acute angles: 45° and 60° from hand-derived vectors", () => {
  // u = (1,0), v = (1,1): cos = 1/√2 → 45°
  close(includedAngleDeg(P(1, 0), P(0, 0), P(1, 1)), 45);
  // u = (2,0), v = (1,√3): cos = 2 / (2·2) = 0.5 → 60°
  close(includedAngleDeg(P(2, 0), P(0, 0), P(1, Math.sqrt(3))), 60);
});

test("obtuse angle: u = (1,0), v = (−1,1) → cos = −1/√2 → 135°", () => {
  close(includedAngleDeg(P(1, 0), P(0, 0), P(-1, 1)), 135);
});

test("fully folded segments give 0°", () => {
  close(includedAngleDeg(P(1, 0), P(0, 0), P(3, 0)), 0);
});

test("unsigned, symmetric in A/C, and invariant to translation, rotation and uniform scale", () => {
  const a = P(3, 7), b = P(1, 2), c = P(8, -1);
  const base = includedAngleDeg(a, b, c);
  close(includedAngleDeg(c, b, a), base);
  const tf = (p) => { // rotate 37°, scale 2.5, translate (100, -40)
    const r = 37 * Math.PI / 180;
    return P(2.5 * (p.x * Math.cos(r) - p.y * Math.sin(r)) + 100, 2.5 * (p.x * Math.sin(r) + p.y * Math.cos(r)) - 40);
  };
  close(includedAngleDeg(tf(a), tf(b), tf(c)), base, 1e-9);
  // mirror image (a front-camera preview is mirrored) gives the same angle
  const m = (p) => P(-p.x, p.y);
  close(includedAngleDeg(m(a), m(b), m(c)), base);
});

test("coincident points return null instead of NaN", () => {
  assert.equal(includedAngleDeg(P(0, 0), P(0, 0), P(1, 0)), null);
  assert.equal(includedAngleDeg(P(1, 0), P(0, 0), P(0, 0)), null);
  assert.equal(includedAngleDeg(P(2, 2), P(2, 2), P(2, 2)), null);
});

test("non-finite or missing points return null", () => {
  const bad = [null, undefined, {}, P(NaN, 0), P(0, Infinity), P(-Infinity, 1), { x: "1", y: 2 }, { x: 1 }];
  bad.forEach((p) => {
    assert.equal(includedAngleDeg(p, P(0, 0), P(1, 0)), null);
    assert.equal(includedAngleDeg(P(1, 1), p, P(1, 0)), null);
    assert.equal(includedAngleDeg(P(1, 1), P(0, 0), p), null);
  });
  // magnitudes that overflow hypot() are rejected, not turned into NaN
  assert.equal(includedAngleDeg(P(1e308, 1e308), P(-1e308, -1e308), P(0, 0)), null);
});

test("output is always a finite number in [0, 180] or null (seeded sweep)", () => {
  let seed = 12345;
  const rnd = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
  for (let i = 0; i < 5000; i++) {
    const pt = () => P((rnd() - 0.5) * 2000, (rnd() - 0.5) * 2000);
    const v = includedAngleDeg(pt(), pt(), pt());
    assert.ok(v === null || (Number.isFinite(v) && v >= 0 && v <= 180), String(v));
  }
});

test("degrees, not radians", () => {
  const v = includedAngleDeg(P(0, 1), P(0, 0), P(1, 0));
  assert.ok(v > 3.2, "90° must not be reported as π/2");
});

test("helpers: distance, midpoint, median, mean, percentile", () => {
  assert.equal(distance(P(0, 0), P(3, 4)), 5);
  assert.equal(distance(P(0, 0), null), null);
  assert.deepEqual(midpoint(P(0, 0), P(4, 2)), { x: 2, y: 1 });
  assert.equal(median([3, 1, 2]), 2);
  assert.equal(median([4, 1, 3, 2]), 2.5);
  assert.equal(median([NaN, null, 5, Infinity]), 5);
  assert.equal(median([]), null);
  assert.equal(mean([1, 2, 3, NaN]), 2);
  assert.equal(mean([]), null);
  assert.equal(percentile([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 90), 9);
  assert.equal(percentile([], 90), null);
});
