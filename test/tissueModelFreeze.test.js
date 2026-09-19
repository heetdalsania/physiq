/* ─── Tests — Milestone 4 must not modify tissue-load-v0.1 ────────────────
 *
 * The golden test proves the engine's OUTPUT is unchanged. This test pins
 * the SOURCE of the five domain files and the golden fixture by SHA-256,
 * so a change to a coefficient, band, mapping, confidence, tissue id or
 * formula fails here even if it happened to keep the sampled outputs.
 *
 * These hashes were recorded at the Milestone 4 starting commit
 * (917e118bdc568fbcc21cc6b4d3307c4f30a7ffdd). A deliberate, reviewed
 * model revision must update them TOGETHER with a model/map version bump
 * and a regenerated golden file — never in isolation.
 * ───────────────────────────────────────────────────────────────────────── */

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";

const PINNED = {
  "js/tissue/exerciseTissueMap.js": "b9ba8699601ce398eb55c47c761a419674239d53fea1705792fb4d75a04df4de",
  "js/tissue/loadEngine.js":        "d065fcabcfe2f79b484f5281b3780faaf52f2bd32104cfc41516510ca6ffdc2a",
  "js/tissue/modelVersion.js":      "a33b204f8535e422a8d1b312045296f6e0d18bed10edb3ebed8e7dc3abd19d46",
  "js/tissue/tissueDefinitions.js": "ec27e5975b987fd82776ecff7f1b7bd2f3f7c121436ab5393a1ec2b9dad8e68c",
  "js/tissue/uncertainty.js":       "97891194bdfd7b5e15d3bfb071ff1f754943e3993b9f546ffa3d52eaab0f5cce",
  "test/fixtures/tissueLoadBaseline.v0.1.json": "d88a506e887147768a2ca00d35a66d7819cfe839308d0109e22079588f127b35"
};

test("the five TissueOS domain files and the golden fixture are byte-identical to the Milestone 4 baseline", () => {
  Object.keys(PINNED).forEach(function (file) {
    const bytes = readFileSync(new URL("../" + file, import.meta.url));
    const actual = createHash("sha256").update(bytes).digest("hex");
    assert.equal(actual, PINNED[file], file + " changed. A model change needs a version bump, a regenerated golden file and an updated pin — together.");
  });
});

test("Milestone 4 adds no model version, coefficient or band to the domain", () => {
  const src = readFileSync(new URL("../js/tissue/modelVersion.js", import.meta.url), "utf8");
  assert.match(src, /TISSUE_LOAD_MODEL_VERSION = "tissue-load-v0\.1"/);
  assert.match(src, /EXERCISE_TISSUE_MAP_VERSION = "exercise-tissue-map-v0\.1"/);
  assert.doesNotMatch(src, /v0\.2/);
  // The history layer never imports anything that could alter the model,
  // and the model never imports the history layer.
  ["exerciseTissueMap.js", "loadEngine.js", "modelVersion.js", "tissueDefinitions.js", "uncertainty.js"].forEach(function (f) {
    const s = readFileSync(new URL("../js/tissue/" + f, import.meta.url), "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
    assert.doesNotMatch(s, /tissueHistory|tissueLoadHistory|baseline/i, f + " must not know about Milestone 4");
  });
});
