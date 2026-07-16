/* ─── Tests — adaptive target adjustment ─────────────────────────────────── */

import { test } from "node:test";
import assert from "node:assert/strict";
import { calcTargets } from "../js/utils/calculations.js";
import { DEFAULT_PROFILE } from "../js/data/constants.js";
import {
  buildAdjustmentSuggestion,
  ADJUSTMENT_STEP,
  ADJUSTMENT_CAP
} from "../js/utils/weeklyReport.js";

const INTAKE = { creatine: 0 };

// ── calcTargets knob ────────────────────────────────────────────────────

test("calorieAdjustment shifts calories; protein stays g/kg-based, carbs absorb", function() {
  const base = calcTargets(Object.assign({}, DEFAULT_PROFILE), INTAKE);
  const bumped = calcTargets(Object.assign({}, DEFAULT_PROFILE, { calorieAdjustment: 150 }), INTAKE);
  assert.equal(bumped.calories, base.calories + 150);
  assert.equal(bumped.protein, base.protein, "protein target untouched");
  assert.ok(bumped.carbs > base.carbs, "carbs absorb part of the bump");
  assert.equal(bumped.adjustment, 150);
  assert.equal(base.adjustment, 0);
});

test("negative and missing adjustments behave", function() {
  const cut = calcTargets(Object.assign({}, DEFAULT_PROFILE, { goal: "cut", calorieAdjustment: -150 }), INTAKE);
  const cutBase = calcTargets(Object.assign({}, DEFAULT_PROFILE, { goal: "cut" }), INTAKE);
  assert.equal(cut.calories, cutBase.calories - 150);
  // Legacy stored profiles have no calorieAdjustment field at all.
  const legacy = Object.assign({}, DEFAULT_PROFILE);
  delete legacy.calorieAdjustment;
  assert.equal(calcTargets(legacy, INTAKE).adjustment, 0);
});

// ── suggestion rules ────────────────────────────────────────────────────

function trend(overrides) {
  return Object.assign({
    available: true,
    spanDays: 14,
    status: "behind",
    weeklyRate: 0,
    paceText: "Behind your bulk pace (+0.6 lb/wk)."
  }, overrides);
}

test("stalled bulk suggests +150, stalled cut suggests -150", function() {
  const bulk = buildAdjustmentSuggestion(trend(), "bulk", 0, null, "2026-07-16");
  assert.equal(bulk.type, "adjust");
  assert.equal(bulk.delta, ADJUSTMENT_STEP);
  assert.equal(bulk.next, 150);
  assert.match(bulk.text, /Add 150 kcal\/day/);

  const cut = buildAdjustmentSuggestion(trend(), "cut", 0, null, "2026-07-16");
  assert.equal(cut.delta, -ADJUSTMENT_STEP);
  assert.match(cut.text, /Cut 150 kcal\/day/);
});

test("maintain drift adjusts against the drift direction", function() {
  const up = buildAdjustmentSuggestion(trend({ weeklyRate: 0.8 }), "maintain", 0, null, "2026-07-16");
  assert.equal(up.delta, -ADJUSTMENT_STEP);
  const down = buildAdjustmentSuggestion(trend({ weeklyRate: -0.8 }), "maintain", 0, null, "2026-07-16");
  assert.equal(down.delta, ADJUSTMENT_STEP);
});

test("no suggestion when on pace, ahead, unavailable, or trend too short", function() {
  assert.equal(buildAdjustmentSuggestion(trend({ status: "on-pace" }), "bulk", 0, null, "2026-07-16"), null);
  assert.equal(buildAdjustmentSuggestion(trend({ status: "ahead" }), "bulk", 0, null, "2026-07-16"), null);
  assert.equal(buildAdjustmentSuggestion({ available: false }, "bulk", 0, null, "2026-07-16"), null);
  assert.equal(buildAdjustmentSuggestion(trend({ spanDays: 7 }), "bulk", 0, null, "2026-07-16"),
    null, "a single noisy week never triggers an adjustment");
});

test("cooldown: a recent adjustment blocks a new one; an old one doesn't", function() {
  assert.equal(buildAdjustmentSuggestion(trend(), "bulk", 150, "2026-07-10", "2026-07-16"), null);
  const ok = buildAdjustmentSuggestion(trend(), "bulk", 150, "2026-07-01", "2026-07-16");
  assert.equal(ok.type, "adjust");
  assert.equal(ok.next, 300);
  assert.match(ok.text, /Total adjustment would be \+300/);
});

test("cap: past ±" + ADJUSTMENT_CAP + " the suggestion becomes a review, not another bump", function() {
  const capped = buildAdjustmentSuggestion(trend(), "bulk", 300, "2026-06-01", "2026-07-16");
  assert.equal(capped.type, "review");
  assert.match(capped.text, /activity level or BMR/);

  const cutCapped = buildAdjustmentSuggestion(trend(), "cut", -300, "2026-06-01", "2026-07-16");
  assert.equal(cutCapped.type, "review");
});
