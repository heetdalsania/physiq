/* ─── TissueOS — canonical tissue definitions ─────────────────────────────
 *
 * The vocabulary every other TissueOS module speaks. Deliberately coarse:
 * these are product-level regions, not anatomical structures. Splitting
 * "hamstrings" into biceps femoris / semitendinosus / semimembranosus, or
 * adding left/right instances, is future work and would bump
 * TISSUE_DEFINITIONS_VERSION.
 *
 * Fields
 *   id           stable machine identifier — never shown to users, never
 *                renamed once results have been generated against it.
 *   name         display label; free to change.
 *   type         "muscle" | "tendon" | "ligament" | "joint" | "other".
 *   physiqMuscle the existing Physiq muscle-tracker region this tissue sits
 *                under (an id from TRACKED_MUSCLES in js/data/constants.js),
 *                or null for tissues the current body map has no region for.
 *                Recorded so a later UI can colour the existing map; the
 *                engine does not use it.
 *
 * Relationship to the handoff's suggested list: identical set of twelve.
 * The only deliberate divergence from Physiq's own vocabulary is
 * "quadriceps" (handoff) vs Physiq's "quads"; the link is kept in
 * `physiqMuscle` rather than by sharing the id, so the two vocabularies can
 * evolve separately.
 *
 * Coarseness notes (what each bucket is standing in for, for now):
 *   back   — lats, upper back AND the spinal erectors. Physiq's own catalog
 *            files Deadlift under "back", so hinge-pattern trunk loading is
 *            attributed here rather than to a separate lower-back tissue.
 *   core   — anterior/lateral trunk (abdominals, obliques).
 *   shoulders — deltoids as one unit; rotator cuff is not modelled.
 * ───────────────────────────────────────────────────────────────────────── */

export const TISSUE_TYPES = Object.freeze(["muscle", "tendon", "ligament", "joint", "other"]);

export const TISSUES = Object.freeze([
  Object.freeze({ id: "chest",           name: "Chest",           type: "muscle", physiqMuscle: "chest" }),
  Object.freeze({ id: "shoulders",       name: "Shoulders",       type: "muscle", physiqMuscle: "shoulders" }),
  Object.freeze({ id: "biceps",          name: "Biceps",          type: "muscle", physiqMuscle: "biceps" }),
  Object.freeze({ id: "triceps",         name: "Triceps",         type: "muscle", physiqMuscle: "triceps" }),
  Object.freeze({ id: "back",            name: "Back",            type: "muscle", physiqMuscle: "back" }),
  Object.freeze({ id: "core",            name: "Core",            type: "muscle", physiqMuscle: "core" }),
  Object.freeze({ id: "glutes",          name: "Glutes",          type: "muscle", physiqMuscle: "glutes" }),
  Object.freeze({ id: "quadriceps",      name: "Quadriceps",      type: "muscle", physiqMuscle: "quads" }),
  Object.freeze({ id: "hamstrings",      name: "Hamstrings",      type: "muscle", physiqMuscle: "hamstrings" }),
  Object.freeze({ id: "calves",          name: "Calves",          type: "muscle", physiqMuscle: "calves" }),
  Object.freeze({ id: "patellar_tendon", name: "Patellar tendon", type: "tendon", physiqMuscle: null }),
  Object.freeze({ id: "achilles_tendon", name: "Achilles tendon", type: "tendon", physiqMuscle: null })
]);

export const TISSUE_BY_ID = Object.freeze(TISSUES.reduce(function(acc, t) {
  acc[t.id] = t;
  return acc;
}, {}));

export const TISSUE_IDS = Object.freeze(TISSUES.map(function(t) { return t.id; }));

export function isTissueId(id) {
  return typeof id === "string" && Object.prototype.hasOwnProperty.call(TISSUE_BY_ID, id);
}

export function getTissue(id) {
  return isTissueId(id) ? TISSUE_BY_ID[id] : null;
}
