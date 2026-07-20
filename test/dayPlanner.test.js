/* ─── Tests — day planner (nutrition simulation engine) ──────────────────── */

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  toPlanItem,
  planTotals,
  planRemaining,
  evaluatePlan,
  planWarning,
  dominantGap,
  buildCandidatePool,
  rankRecommendations,
  autoFillDay
} from "../js/utils/dayPlanner.js";
import { COMMON_FOODS } from "../js/data/commonFoods.js";

const TARGETS = { calories: 2800, protein: 160, carbs: 300, fats: 80, fiber: 38, sugar: 35, sodium: 2300 };

function item(name, cal, p, c, f, extra) {
  return Object.assign({
    name: name, calories: cal, protein: p, carbs: c, fats: f,
    fiber: 0, sugar: 0, sodium: 0, potassium: 0
  }, extra);
}

// ── shapes & sums ───────────────────────────────────────────────────────

test("toPlanItem normalizes search-result shape (cal) into meal-item shape (calories)", function() {
  const it = toPlanItem({ name: "Rice", brand: "Uncle Ben's", cal: 205, protein: 4.4, carbs: 45, fats: 0.5 });
  assert.equal(it.calories, 205);
  assert.equal(it.protein, 4);
  assert.equal(it.name, "Rice (Uncle Ben's)");
});

test("planTotals sums all logged-item keys; planRemaining diffs against targets", function() {
  const items = [item("A", 500, 40, 50, 10), item("B", 300, 20, 30, 12)];
  const totals = planTotals(items);
  assert.equal(totals.calories, 800);
  assert.equal(totals.protein, 60);
  const rem = planRemaining(items, TARGETS);
  assert.equal(rem.calories, 2000);
  assert.equal(rem.fats, 58);
});

// ── phase-aware evaluation ──────────────────────────────────────────────

test("evaluatePlan uses the same phase rules as the report: bulk needs >= target", function() {
  const under = [item("Day", 2700, 165, 305, 82)];
  const over = [item("Day", 2900, 165, 305, 82)];
  assert.equal(evaluatePlan("build", under, TARGETS).dayOk, false);
  assert.equal(evaluatePlan("build", over, TARGETS).dayOk, true);
  assert.equal(evaluatePlan("cut", under, TARGETS).dayOk, true, "same day passes on a cut");
  assert.equal(evaluatePlan("cut", over, TARGETS).dayOk, false);
});

// ── warnings ────────────────────────────────────────────────────────────

test("planWarning stays silent on a mostly-empty plan", function() {
  const items = [item("Snack", 300, 10, 30, 10, { sodium: 4000 })];
  assert.equal(planWarning("cut", items, TARGETS), null);
});

test("planWarning: sodium first, then sugar, then low fiber — one warning max", function() {
  const salty = [item("Day", 2800, 160, 300, 80, { sodium: 4000, sugar: 100, fiber: 2 })];
  assert.equal(planWarning("cut", salty, TARGETS).type, "sodium");

  const sugary = [item("Day", 2800, 160, 300, 80, { sodium: 1500, sugar: 100, fiber: 40 })];
  assert.equal(planWarning("build", sugary, TARGETS).type, "sugar");

  const lowFiber = [item("Day", 2800, 160, 300, 80, { sodium: 1500, sugar: 10, fiber: 5 })];
  assert.equal(planWarning("build", lowFiber, TARGETS).type, "fiber");

  const clean = [item("Day", 2800, 160, 300, 80, { sodium: 1500, sugar: 10, fiber: 40 })];
  assert.equal(planWarning("build", clean, TARGETS), null);
});

// ── gap detection ───────────────────────────────────────────────────────

test("dominantGap picks the proportionally furthest macro; null when all met", function() {
  // protein 50% missing, carbs 10%, fats 0%
  const rem = { calories: 900, protein: 80, carbs: 30, fats: 0 };
  assert.equal(dominantGap(rem, TARGETS), "protein");
  assert.equal(dominantGap({ calories: 100, protein: 0, carbs: -5, fats: -2 }, TARGETS), null);
});

// ── candidate pool ──────────────────────────────────────────────────────

test("buildCandidatePool puts recents first and dedupes by name", function() {
  const recents = [{ name: "Chicken Breast", cal: 250, protein: 45, carbs: 0, fats: 5 }];
  const pool = buildCandidatePool(recents, COMMON_FOODS);
  const chicken = pool.filter(function(f) { return f.name === "Chicken Breast"; });
  assert.equal(chicken.length, 1);
  assert.equal(chicken[0].calories, 250, "the user's own version wins the dedup");
  assert.equal(pool[0].name, "Chicken Breast", "recents lead the pool");
});

// ── recommendations ─────────────────────────────────────────────────────

test("recommendations target the dominant gap with the biggest-dent foods", function() {
  const pool = buildCandidatePool([], COMMON_FOODS);
  // Empty plan on bulk targets → protein is the dominant gap (equal ratios,
  // protein wins ties). Score = grams²/kcal, so the top pick makes the
  // largest efficient dent, not just the leanest ratio.
  const recs = rankRecommendations(pool, [], TARGETS, {});
  assert.equal(recs.gap, "protein");
  assert.ok(recs.foods.length > 0);
  const top = recs.foods[0];
  const topScore = (top.protein * top.protein) / top.calories;
  pool.forEach(function(f) {
    if (f.protein > 0 && f.calories <= TARGETS.calories + 50) {
      assert.ok(topScore >= (f.protein * f.protein) / f.calories - 1e-9,
        f.name + " should not out-rank the top pick");
    }
  });
  assert.equal(top.name, "Chicken Breast", "the big efficient dent wins");
});

test("recommendations shift as the plan fills (protein done → carbs next)", function() {
  const pool = buildCandidatePool([], COMMON_FOODS);
  const items = [item("Chicken x3", 900, 170, 0, 20)]; // protein met, carbs 0/300
  const recs = rankRecommendations(pool, items, TARGETS, {});
  assert.equal(recs.gap, "carbs");
});

test("focusMacro (report deep-link) overrides the dominant gap while it's still open", function() {
  const pool = buildCandidatePool([], COMMON_FOODS);
  const recs = rankRecommendations(pool, [], TARGETS, { focusMacro: "carbs" });
  assert.equal(recs.gap, "carbs");
  // ...but a met focus macro falls back to the real gap.
  const items = [item("Pasta party", 1400, 20, 310, 10)];
  const recs2 = rankRecommendations(pool, items, TARGETS, { focusMacro: "carbs" });
  assert.equal(recs2.gap, "protein");
});

test("foods that don't fit the remaining calories are excluded", function() {
  const pool = [item("Feast", 800, 60, 60, 30), item("Snack", 150, 15, 10, 5)];
  const items = [item("Most of the day", 2500, 100, 250, 60)]; // 300 kcal left
  const recs = rankRecommendations(pool, items, TARGETS, {});
  assert.deepEqual(recs.foods.map(function(f) { return f.name; }), ["Snack"]);
});

test("diversity: a food already planned twice is never recommended again", function() {
  const pool = [item("Whey", 120, 24, 3, 1), item("Tuna", 100, 22, 0, 1)];
  const items = [item("Whey", 120, 24, 3, 1), item("Whey", 120, 24, 3, 1)];
  const recs = rankRecommendations(pool, items, TARGETS, { focusMacro: "protein" });
  assert.deepEqual(recs.foods.map(function(f) { return f.name; }), ["Tuna"]);
});

test("no recommendations once calories are spent", function() {
  const items = [item("Done", 2850, 165, 305, 82)];
  const recs = rankRecommendations(buildCandidatePool([], COMMON_FOODS), items, TARGETS, {});
  assert.equal(recs.foods.length, 0);
});

test("recommendations are deterministic", function() {
  const pool = buildCandidatePool([], COMMON_FOODS);
  const a = rankRecommendations(pool, [], TARGETS, {}).foods.map(function(f) { return f.name; });
  const b = rankRecommendations(pool, [], TARGETS, {}).foods.map(function(f) { return f.name; });
  assert.deepEqual(a, b);
});

// ── auto-fill ───────────────────────────────────────────────────────────

test("autoFillDay builds a day that evaluates on-target for a bulk", function() {
  const pool = buildCandidatePool([], COMMON_FOODS);
  const added = autoFillDay(pool, [], TARGETS, "build", 25);
  assert.ok(added.length > 0);
  const result = evaluatePlan("build", added, TARGETS);
  assert.equal(result.dayOk, true,
    "day should hit targets, got " + JSON.stringify(result.totals));
});

test("autoFillDay adds nothing to an already-complete day", function() {
  const done = [item("Perfect day", 2850, 165, 305, 82)];
  const added = autoFillDay(buildCandidatePool([], COMMON_FOODS), done, TARGETS, "build", 25);
  assert.equal(added.length, 0);
});

test("autoFillDay finishes a trailing macro on a bulk instead of stranding it 1g short", function() {
  // Regression: real seeded bulk targets where calories filled exactly but
  // fats ended 94/95 — the calorie bail must not block the last macro fix.
  const targets = { calories: 3057, protein: 147, carbs: 404, fats: 95, fiber: 38, sugar: 38, sodium: 2300 };
  const recents = [
    item("Chipotle Chicken Bowl", 750, 55, 80, 22, { fiber: 12, sodium: 1400 }),
    item("Protein Oatmeal", 420, 32, 58, 7, { fiber: 9, sodium: 200 })
  ];
  const pool = buildCandidatePool(recents, COMMON_FOODS);
  const added = autoFillDay(pool, [], targets, "build", 20);
  const result = evaluatePlan("build", added, targets);
  assert.equal(result.dayOk, true, "got " + JSON.stringify(result.totals));
});

test("autoFillDay respects the add cap", function() {
  const added = autoFillDay(buildCandidatePool([], COMMON_FOODS), [], TARGETS, "build", 3);
  assert.ok(added.length <= 3);
});
