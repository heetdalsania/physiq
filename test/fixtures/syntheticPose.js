/* ─── Test fixture — synthetic, hand-checkable pose sequences ─────────────
 *
 * Produces MediaPipe-SHAPED provider output ({ landmarks: [[33 points]] },
 * normalised x/y, visibility) from an explicit 2D stick figure, so the whole
 * pipeline (adapter → geometry → smoothing → segmentation) can be checked
 * against values derived by hand. Used by the Node tests and, bundled, by the
 * browser acceptance stub runtime. No person, photo or video is involved.
 *
 * Geometry (image pixels, y down), subject facing +x:
 *   ankle fixed; shank tilts forward by φ = (180 − θ)/2 from vertical, the
 *   thigh tilts back by the same φ, so the included knee angle is exactly θ:
 *     knee = ankle + Ls·( sin φ, −cos φ)
 *     hip  = knee  + Lt·(−sin φ, −cos φ)
 *   trunk leans forward by ψ:  shoulder = hip + Ltr·(sin ψ, −cos ψ)
 *   → included trunk–thigh angle at the hip = 180 − (φ + ψ).
 * ───────────────────────────────────────────────────────────────────────── */

export const IDX = {
  nose: 0, left_shoulder: 11, right_shoulder: 12, left_hip: 23, right_hip: 24,
  left_knee: 25, right_knee: 26, left_ankle: 27, right_ankle: 28,
  left_heel: 29, right_heel: 30, left_foot_index: 31, right_foot_index: 32
};

const rad = function (deg) { return deg * Math.PI / 180; };

/* Stick figure in pixels for one side. */
export function stickFigure(kneeDeg, leanDeg, opts) {
  const o = Object.assign({ ankleX: 320, ankleY: 440, shank: 100, thigh: 100, trunk: 130, head: 50 }, opts || {});
  const phi = rad((180 - kneeDeg) / 2);
  const psi = rad(leanDeg);
  const ankle = { x: o.ankleX, y: o.ankleY };
  const knee = { x: ankle.x + o.shank * Math.sin(phi), y: ankle.y - o.shank * Math.cos(phi) };
  const hip = { x: knee.x - o.thigh * Math.sin(phi), y: knee.y - o.thigh * Math.cos(phi) };
  const shoulder = { x: hip.x + o.trunk * Math.sin(psi), y: hip.y - o.trunk * Math.cos(psi) };
  const nose = { x: shoulder.x + 12, y: shoulder.y - o.head };
  const heel = { x: ankle.x - 14, y: ankle.y + 6 };
  const footIndex = { x: ankle.x + 34, y: ankle.y + 8 };
  return { ankle: ankle, knee: knee, hip: hip, shoulder: shoulder, nose: nose, heel: heel, footIndex: footIndex };
}

/* 33 provider points (normalised) for a side-on (or frontal) figure. */
export function providerPose(kneeDeg, leanDeg, options) {
  const o = Object.assign({
    width: 640, height: 480,
    visibleSide: "left",
    nearVisibility: 0.95,
    farVisibility: 0.3,
    farOffsetX: 6,           // side-on: far limb projects almost on top of the near one
    frontalHipSeparation: 0, // > 0 separates left/right hips horizontally (pixels)
    shiftX: 0,
    figure: {}
  }, options || {});
  const near = stickFigure(kneeDeg, leanDeg, Object.assign({ ankleX: 320 + o.shiftX }, o.figure));
  const farFigure = stickFigure(kneeDeg, leanDeg, Object.assign({ ankleX: 320 + o.shiftX + o.farOffsetX }, o.figure));
  const sep = o.frontalHipSeparation;
  const shift = function (p, dx) { return { x: p.x + dx, y: p.y }; };
  const farSide = o.visibleSide === "left" ? "right" : "left";
  const pts = new Array(33);
  for (let i = 0; i < 33; i++) pts[i] = { x: 0.5, y: 0.5, z: 0, visibility: 0.1 };
  const put = function (name, p, vis) {
    pts[IDX[name]] = { x: p.x / o.width, y: p.y / o.height, z: 0, visibility: vis };
  };
  const nearDx = sep ? -sep / 2 : 0, farDx = sep ? sep / 2 : 0;
  put("nose", near.nose, o.nearVisibility);
  [[o.visibleSide, near, o.nearVisibility, nearDx], [farSide, farFigure, o.farVisibility, farDx]].forEach(function (row) {
    const side = row[0], fig = row[1], vis = row[2], dx = row[3];
    put(side + "_shoulder", shift(fig.shoulder, dx), vis);
    put(side + "_hip", shift(fig.hip, dx), vis);
    put(side + "_knee", shift(fig.knee, dx), vis);
    put(side + "_ankle", shift(fig.ankle, dx), vis);
    put(side + "_heel", shift(fig.heel, dx), vis);
    put(side + "_foot_index", shift(fig.footIndex, dx), vis);
  });
  return pts;
}

/* Piecewise-linear knee angle (degrees) for one squat with a flat bottom:
   standing until descentAt, linear to bottomDeg by bottomAt, held until
   riseAt, linear back to standDeg by standAt. */
export const DEFAULT_SQUAT = Object.freeze({
  standDeg: 175, bottomDeg: 95,
  descentAt: 3000, bottomAt: 4200, riseAt: 4600, standAt: 5800
});

export function squatKneeAt(tMs, spec) {
  const s = Object.assign({}, DEFAULT_SQUAT, spec || {});
  if (tMs <= s.descentAt) return s.standDeg;
  if (tMs < s.bottomAt) return s.standDeg - (s.standDeg - s.bottomDeg) * (tMs - s.descentAt) / (s.bottomAt - s.descentAt);
  if (tMs <= s.riseAt) return s.bottomDeg;
  if (tMs < s.standAt) return s.bottomDeg + (s.standDeg - s.bottomDeg) * (tMs - s.riseAt) / (s.standAt - s.riseAt);
  return s.standDeg;
}

/* Trunk lean grows linearly with knee flexion: 0° standing → 35° at 95°. */
export function leanForKnee(kneeDeg, spec) {
  const s = Object.assign({}, DEFAULT_SQUAT, spec || {});
  return 35 * (s.standDeg - kneeDeg) / (s.standDeg - s.bottomDeg);
}

/* Provider result for a scenario at time t (ms since session start).
   scenario: "squat" | "stand" | "none" | "two" | "front" | "low" | "garbage"
             | "twoSquats" | "shallow" | "partial" */
export function providerResultAt(tMs, scenario, options) {
  const o = options || {};
  const kind = scenario || "squat";
  if (kind === "none") return { landmarks: [], worldLandmarks: [] };
  if (kind === "garbage") return { landmarks: [[{ x: NaN, y: Infinity, visibility: 2 }]] };
  let knee = 175;
  if (kind === "squat" || kind === "front" || kind === "two" || kind === "low") knee = squatKneeAt(tMs, o.spec);
  if (kind === "twoSquats") knee = Math.min(squatKneeAt(tMs, o.spec), squatKneeAt(tMs, Object.assign({}, DEFAULT_SQUAT, { descentAt: 6600, bottomAt: 7400, riseAt: 7600, standAt: 8400 })));
  if (kind === "shallow") knee = squatKneeAt(tMs, Object.assign({}, o.spec, { bottomDeg: 165 }));
  if (kind === "partial") knee = tMs <= 3000 ? 175 : Math.max(95, 175 - (tMs - 3000) / 1200 * 80);
  const lean = leanForKnee(knee);
  const pose = providerPose(knee, lean, Object.assign({}, o.pose,
    kind === "front" ? { frontalHipSeparation: 60, farOffsetX: 0, farVisibility: 0.95 } : {},
    kind === "low" ? { nearVisibility: 0.3 } : {}));
  if (kind === "two") return { landmarks: [pose, providerPose(175, 0, { shiftX: 200 })] };
  return { landmarks: [pose] };
}
