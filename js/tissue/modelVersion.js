/* ─── TissueOS — model version ────────────────────────────────────────────
 *
 * Identifies WHICH set of scientific/engineering assumptions produced a
 * TissueOS result. Every output of the load engine carries these strings,
 * so a later model revision can never make two incomparable scores look
 * comparable.
 *
 * This is deliberately NOT the persistence schema version:
 *
 *   SCHEMA_VERSION  (js/utils/storage.js)  — how bytes are laid out on disk.
 *                                             Bumped when stored shapes change.
 *   TISSUE_LOAD_MODEL_VERSION (here)        — which formula and which
 *                                             coefficients produced a number.
 *                                             Bumped when the science changes.
 *
 * The two move independently. A model bump changes numbers, not storage; a
 * schema bump changes storage, not numbers. Nothing here is persisted in
 * Milestone 1 — results are ephemeral.
 *
 * v0.1 is DEFINED by this first commit. It has never been released, and
 * Milestone 1 persists nothing, so no stored result predates this
 * definition and no historical comparison can be broken by it. The first
 * bump away from v0.1 will be the first one that matters.
 *
 * Bump rules:
 *   - Any change to the formula in loadEngine.js         → bump MODEL version.
 *   - Any change to a coefficient, confidence or the set
 *     of mapped exercises in exerciseTissueMap.js         → bump MAP version.
 *   - Adding, removing or renaming a tissue id             → bump BOTH.
 * ───────────────────────────────────────────────────────────────────────── */

/* Formula version. v0.1 computes a dimensional workload quantity in
   pound-reps, scaled by a dimensionless relative coefficient. It is NOT a
   normalized score. See loadEngine.js. */
export const TISSUE_LOAD_MODEL_VERSION = "tissue-load-v0.1";

/* Coefficient-table version. See exerciseTissueMap.js. */
export const EXERCISE_TISSUE_MAP_VERSION = "exercise-tissue-map-v0.1";

/* Tissue vocabulary version. See tissueDefinitions.js. */
export const TISSUE_DEFINITIONS_VERSION = "tissue-definitions-v0.1";

/* Tag stamped on every event so later sources (video, wearables, manual
   entry) can be told apart from this heuristic workout-log model. */
export const SOURCE_TYPE_WORKOUT_MODEL = "workout_model";
