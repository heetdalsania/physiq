/* ─── Movement Assessment — pure 2D geometry ───────────────────────────────
 *
 * Image-space geometry only. Nothing here knows about squats, sides or
 * providers, and nothing here is a 3D or anatomical joint angle: these are
 * angles between PROJECTED landmark positions in one camera image.
 * ───────────────────────────────────────────────────────────────────────── */

/* Segments shorter than this (in the same units as the points — image pixels
   in practice) have no direction, so an angle at them is undefined. */
export const MIN_SEGMENT_LENGTH = 1e-9;

function isPoint(p) {
  return !!p && typeof p.x === "number" && typeof p.y === "number" &&
    Number.isFinite(p.x) && Number.isFinite(p.y);
}

/* Included angle at B formed by A–B–C, in DEGREES, range [0, 180].
 *
 *   u = A − B,  v = C − B
 *   angle = atan2(|u × v|, u · v)
 *
 * atan2 of the cross and dot products is used instead of acos(u·v / |u||v|)
 * because it is exact at 0° and 180° (acos loses precision there and can
 * return NaN when rounding pushes its argument past ±1).
 *
 * 180° means A, B and C are collinear with B between them (a straight limb);
 * smaller values mean more flexion at B. The result is unsigned: the 2D
 * projection cannot say which way the joint bends.
 *
 * Returns null — never NaN or Infinity — when any point is missing or
 * non-finite, or when A or C coincides with B. */
export function includedAngleDeg(a, b, c) {
  if (!isPoint(a) || !isPoint(b) || !isPoint(c)) return null;
  const ux = a.x - b.x, uy = a.y - b.y;
  const vx = c.x - b.x, vy = c.y - b.y;
  const lenU = Math.hypot(ux, uy);
  const lenV = Math.hypot(vx, vy);
  if (!Number.isFinite(lenU) || !Number.isFinite(lenV)) return null;
  if (lenU < MIN_SEGMENT_LENGTH || lenV < MIN_SEGMENT_LENGTH) return null;
  const cross = ux * vy - uy * vx;
  const dot = ux * vx + uy * vy;
  const deg = Math.atan2(Math.abs(cross), dot) * 180 / Math.PI;
  return Number.isFinite(deg) ? deg : null;
}

export function distance(a, b) {
  if (!isPoint(a) || !isPoint(b)) return null;
  const d = Math.hypot(a.x - b.x, a.y - b.y);
  return Number.isFinite(d) ? d : null;
}

export function midpoint(a, b) {
  if (!isPoint(a) || !isPoint(b)) return null;
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

/* Median of finite numbers (mean of the two middle values for an even
   count). Non-finite entries are ignored; an empty input gives null. */
export function median(values) {
  const v = (values || []).filter(function (x) { return typeof x === "number" && Number.isFinite(x); })
    .sort(function (p, q) { return p - q; });
  if (v.length === 0) return null;
  const mid = Math.floor(v.length / 2);
  return v.length % 2 === 1 ? v[mid] : (v[mid - 1] + v[mid]) / 2;
}

/* Mean of finite numbers, or null. Values are summed in sorted order so the
   result does not depend on input order (floating-point addition is not
   associative). */
export function mean(values) {
  const v = (values || []).filter(function (x) { return typeof x === "number" && Number.isFinite(x); })
    .sort(function (p, q) { return p - q; });
  if (v.length === 0) return null;
  return v.reduce(function (s, x) { return s + x; }, 0) / v.length;
}

/* Nearest-rank percentile (p in [0, 100]) of finite numbers, or null. */
export function percentile(values, p) {
  const v = (values || []).filter(function (x) { return typeof x === "number" && Number.isFinite(x); })
    .sort(function (a, b) { return a - b; });
  if (v.length === 0) return null;
  const rank = Math.ceil((p / 100) * v.length);
  return v[Math.min(v.length - 1, Math.max(0, rank - 1))];
}
