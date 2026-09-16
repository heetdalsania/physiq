/* ─── TissueOS — uncertainty representation ───────────────────────────────
 *
 * A confidence level says how much the MODEL AUTHORS trust the assumption
 * behind a number. It is categorical metadata, not a probability, not a
 * confidence interval, and not the output of any calibration. Nothing in
 * Milestone 1 has been validated against measurement, so no assumption is
 * currently rated "high" — that level is reserved for future entries that
 * have been checked against external data.
 *
 *   "low"    — a placeholder-quality heuristic; expect it to change.
 *   "medium" — a coarse but widely-agreed relationship (e.g. bench press
 *              loads the chest more than the calves).
 *   "high"   — reserved; unused in v0.1.
 *
 * Combination rule: when several assumptions feed one number, the result is
 * only as trustworthy as its weakest input, so combined confidence is the
 * MINIMUM of the inputs. This is a policy, not statistics, and it is tested.
 * ───────────────────────────────────────────────────────────────────────── */

export const CONFIDENCE_LOW = "low";
export const CONFIDENCE_MEDIUM = "medium";
export const CONFIDENCE_HIGH = "high";

/* Ordered weakest → strongest. Index doubles as the ordinal rank. */
export const CONFIDENCE_LEVELS = Object.freeze([
  CONFIDENCE_LOW, CONFIDENCE_MEDIUM, CONFIDENCE_HIGH
]);

export function isValidConfidence(value) {
  return typeof value === "string" && CONFIDENCE_LEVELS.indexOf(value) >= 0;
}

/* Ordinal rank (0 = low). Throws on an unknown level so a typo in the map
   fails a test rather than silently sorting somewhere. */
export function confidenceRank(level) {
  const i = CONFIDENCE_LEVELS.indexOf(level);
  if (i < 0) throw new Error("Unknown confidence level: " + String(level));
  return i;
}

/* Weakest-link combination. Empty input → null (no assumption was used). */
export function combineConfidence(levels) {
  let worst = null;
  (levels || []).forEach(function(level) {
    if (worst === null || confidenceRank(level) < confidenceRank(worst)) worst = level;
  });
  return worst;
}
