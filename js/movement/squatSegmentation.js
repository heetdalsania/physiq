/* ─── Movement Assessment — single-squat segmentation ─────────────────────
 *
 * Input: the SMOOTHED knee-angle trace of the capture window, and the
 * standing reference knee angle from calibration (R).
 *
 * Algorithm (deterministic; all thresholds are relative to what was
 * observed except the single noise floor minExcursionDeg):
 *
 *   1. Need ≥ minCaptureValidSamples valid samples.
 *   2. Deepest point: the valid sample with the smallest angle A_min. If
 *      several share that value, the EARLIEST is used (a pause at the bottom
 *      is therefore counted in the ascent).
 *   3. Observed excursion E = R − A_min. If E < minExcursionDeg (20°) no
 *      movement can be told apart from landmark noise → "no_clear_repetition".
 *      20° is a DETECTION floor, several times the standing jitter of the
 *      smoothed trace; it is not a depth standard. Shallower movements are
 *      simply outside what v0.1 can segment.
 *   4. Phase threshold T = R − phaseThresholdFraction·E (10% of the observed
 *      excursion below the standing reference).
 *   5. Descent start: walking back from the deepest point, the first valid
 *      sample at or above T; the start time is the linear interpolation of
 *      the T-crossing between that sample and the next valid one. None
 *      found → "repetition_started_before_capture".
 *   6. Ascent end: walking forward from the deepest point, the first valid
 *      sample at or above T, interpolated the same way. None found →
 *      "did_not_return_to_standing".
 *   7. One-repetition protocol: any valid sample OUTSIDE [descent start,
 *      ascent end] at or below R − secondRepFraction·E (half the observed
 *      excursion) means a second substantial movement →
 *      "multiple_repetitions". Nothing is averaged or chosen between reps.
 *   8. Data sufficiency inside the repetition: every step between
 *      consecutive valid samples from the sample before descent start to the
 *      sample after ascent end must be ≤ maxGapMs, and at least
 *      minRepSamples valid samples must lie strictly inside the repetition;
 *      otherwise the deepest point or a boundary could be missing →
 *      "data_gap_during_repetition" / "too_few_samples_in_repetition".
 *
 * Because boundaries sit 10% of E inside the movement, the reported
 * durations exclude the first and last slow tenth of the knee excursion.
 * ───────────────────────────────────────────────────────────────────────── */

export const SEGMENTATION = Object.freeze({
  minCaptureValidSamples: 10,
  minExcursionDeg: 20,
  phaseThresholdFraction: 0.1,
  secondRepFraction: 0.5,
  maxGapMs: 300,
  minRepSamples: 8
});

function isValid(s) {
  return !!s && typeof s.value === "number" && Number.isFinite(s.value) &&
    typeof s.tMs === "number" && Number.isFinite(s.tMs);
}

function fail(reason, extra) {
  return Object.assign({ state: "insufficient", reason: reason }, extra || {});
}

/* Time at which the straight line from (t0, v0) to (t1, v1) reaches `level`.
   Callers guarantee v0 and v1 bracket level with v0 ≠ v1. */
function crossingTime(t0, v0, t1, v1, level) {
  if (v0 === v1) return t0;
  const f = (level - v0) / (v1 - v0);
  return t0 + Math.max(0, Math.min(1, f)) * (t1 - t0);
}

export function segmentSingleSquat(smoothedSamples, referenceDeg, options) {
  const opt = Object.assign({}, SEGMENTATION, options || {});
  if (typeof referenceDeg !== "number" || !Number.isFinite(referenceDeg)) return fail("no_reference");

  const valid = (smoothedSamples || []).filter(isValid);
  if (valid.length < opt.minCaptureValidSamples) {
    return fail("insufficient_valid_frames", { validSamples: valid.length });
  }

  let minIdx = 0;
  for (let i = 1; i < valid.length; i++) {
    if (valid[i].value < valid[minIdx].value) minIdx = i;
  }
  const minimumDeg = valid[minIdx].value;
  const excursionDeg = referenceDeg - minimumDeg;
  if (!(excursionDeg >= opt.minExcursionDeg)) {
    return fail("no_clear_repetition", { excursionDeg: excursionDeg });
  }

  const threshold = referenceDeg - opt.phaseThresholdFraction * excursionDeg;

  let before = -1;
  for (let k = minIdx - 1; k >= 0; k--) {
    if (valid[k].value >= threshold) { before = k; break; }
  }
  if (before < 0) return fail("repetition_started_before_capture", { excursionDeg: excursionDeg });

  let after = -1;
  for (let k = minIdx + 1; k < valid.length; k++) {
    if (valid[k].value >= threshold) { after = k; break; }
  }
  if (after < 0) return fail("did_not_return_to_standing", { excursionDeg: excursionDeg });

  const descentStartMs = crossingTime(valid[before].tMs, valid[before].value, valid[before + 1].tMs, valid[before + 1].value, threshold);
  const ascentEndMs = crossingTime(valid[after - 1].tMs, valid[after - 1].value, valid[after].tMs, valid[after].value, threshold);
  const deepestMs = valid[minIdx].tMs;

  const secondRepLevel = referenceDeg - opt.secondRepFraction * excursionDeg;
  const outsideDip = valid.some(function (s) {
    return (s.tMs < descentStartMs || s.tMs > ascentEndMs) && s.value <= secondRepLevel;
  });
  if (outsideDip) return fail("multiple_repetitions", { excursionDeg: excursionDeg });

  let maxGap = 0;
  for (let k = before + 1; k <= after; k++) {
    maxGap = Math.max(maxGap, valid[k].tMs - valid[k - 1].tMs);
  }
  if (maxGap > opt.maxGapMs) return fail("data_gap_during_repetition", { excursionDeg: excursionDeg, maxGapMs: maxGap });

  const inside = valid.filter(function (s) { return s.tMs > descentStartMs && s.tMs < ascentEndMs; }).length;
  if (inside < opt.minRepSamples) return fail("too_few_samples_in_repetition", { excursionDeg: excursionDeg, repSamples: inside });

  const descentMs = deepestMs - descentStartMs;
  const ascentMs = ascentEndMs - deepestMs;
  const totalMs = ascentEndMs - descentStartMs;
  if (![descentMs, ascentMs, totalMs].every(function (d) { return Number.isFinite(d) && d >= 0; })) {
    return fail("invalid_timing");
  }

  return {
    state: "segmented",
    referenceDeg: referenceDeg,
    minimumDeg: minimumDeg,
    excursionDeg: excursionDeg,
    thresholdDeg: threshold,
    events: { descentStartMs: descentStartMs, deepestMs: deepestMs, ascentEndMs: ascentEndMs },
    durations: { descentMs: descentMs, ascentMs: ascentMs, totalMs: totalMs },
    repSamples: inside,
    maxGapMs: maxGap
  };
}
