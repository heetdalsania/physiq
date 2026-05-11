/* ─── PHYSIQ ENGINE — Weight Projection Utilities ────────────────────────── */
/* Pure calculation helpers for the Estimated Weight Change feature.
   No UI here, no React. All inputs are taken from the caller — this module
   never reads from localStorage, never mutates anything, and never invents
   data. If required inputs are missing, helpers return null/[] so the UI
   can fall back to an empty state. */

export const CALORIES_PER_LB = 3500;

function pad(n) { return n < 10 ? "0" + n : "" + n; }
function dateKey(d) {
  return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate());
}

export function getMondayKey(date) {
  const d = new Date(date);
  if (isNaN(d.getTime())) return null;
  d.setHours(0, 0, 0, 0);
  const day = d.getDay();
  const offset = day === 0 ? 6 : day - 1;
  d.setDate(d.getDate() - offset);
  return dateKey(d);
}

export function getWeeklyCalories(history) {
  if (!Array.isArray(history)) return [];
  const weeks = {};
  history.forEach(function(h) {
    if (!h || typeof h.calories !== "number") return;
    const d = new Date(h.date);
    const wk = getMondayKey(d);
    if (!wk) return;
    if (!weeks[wk]) weeks[wk] = { weekStart: wk, days: [] };
    weeks[wk].days.push(h);
  });
  return Object.keys(weeks).sort().map(function(k) {
    const w = weeks[k];
    let total = 0;
    w.days.forEach(function(e) { total += (e.calories || 0); });
    return {
      weekStart: w.weekStart,
      days: w.days,
      dayCount: w.days.length,
      totalCalories: total,
      complete: w.days.length === 7
    };
  });
}

export function calculateWeeklyBalance(weeklyCaloriesConsumed, maintenanceCalories) {
  if (typeof weeklyCaloriesConsumed !== "number") return null;
  if (typeof maintenanceCalories !== "number" || maintenanceCalories <= 0) return null;
  return weeklyCaloriesConsumed - (maintenanceCalories * 7);
}

export function calculateEstimatedWeightChange(weeklyBalance) {
  if (typeof weeklyBalance !== "number") return null;
  return weeklyBalance / CALORIES_PER_LB;
}

export function buildEstimatedSeries(history, maintenanceCalories) {
  const weeks = getWeeklyCalories(history);
  let cum = 0;
  const hasAny = typeof maintenanceCalories === "number" && maintenanceCalories > 0;
  return weeks.map(function(w) {
    const out = {
      weekStart: w.weekStart,
      complete: w.complete,
      dayCount: w.dayCount,
      totalCalories: w.totalCalories,
      weeklyBalance: null,
      weeklyChange: null,
      cumulativeChange: null
    };
    if (hasAny && w.complete) {
      const bal = calculateWeeklyBalance(w.totalCalories, maintenanceCalories);
      const chg = calculateEstimatedWeightChange(bal);
      cum += chg;
      out.weeklyBalance = bal;
      out.weeklyChange = chg;
      out.cumulativeChange = cum;
    }
    return out;
  });
}

export function buildActualSeries(weightLog) {
  if (!Array.isArray(weightLog)) return [];
  return weightLog.filter(function(e) {
    return e && typeof e.weight === "number" && !isNaN(new Date(e.date).getTime());
  }).slice().sort(function(a, b) {
    return new Date(a.date).getTime() - new Date(b.date).getTime();
  });
}

export function compareWeek(actualChange, estimatedChange, tolerance) {
  if (typeof actualChange !== "number" || typeof estimatedChange !== "number") return "unknown";
  const tol = typeof tolerance === "number" ? tolerance : 0.5;
  const diff = actualChange - estimatedChange;
  if (Math.abs(diff) <= tol) return "on-track";
  return diff > 0 ? "above" : "below";
}

export const WeightProjection = {
  CALORIES_PER_LB,
  getMondayKey,
  getWeeklyCalories,
  calculateWeeklyBalance,
  calculateEstimatedWeightChange,
  buildEstimatedSeries,
  buildActualSeries,
  compareWeek
};
