/* ─── PHYSIQ ENGINE — Weight Projection Utilities ────────────────────────── */
/* Pure calculation helpers for the Estimated Weight Change feature.
   No UI here, no React. All inputs are taken from the caller — this module
   never reads from localStorage, never mutates anything, and never invents
   data. If required inputs are missing, helpers return null/[] so the UI
   can fall back to an empty state. */

window.PhysIQ = window.PhysIQ || {};
window.PhysIQ.Utils = window.PhysIQ.Utils || {};

(function(Utils) {

  var CALORIES_PER_LB = 3500;

  function pad(n) { return n < 10 ? "0" + n : "" + n; }
  function dateKey(d) {
    return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate());
  }

  /** Monday-anchored week start key for a given Date. Matches the rest
   *  of the app's week boundary (see App.js getMondayKey). */
  function getMondayKey(date) {
    var d = new Date(date);
    if (isNaN(d.getTime())) return null;
    d.setHours(0, 0, 0, 0);
    var day = d.getDay();                   // 0=Sun..6=Sat
    var offset = day === 0 ? 6 : day - 1;
    d.setDate(d.getDate() - offset);
    return dateKey(d);
  }

  /**
   * Group calendar history entries by ISO week (Mon–Sun).
   * `history` is the same array Storage uses: [{ date: "Sun Apr 20 2026",
   * calories, protein, carbs, fats, sodium }, ...]. Entries with an
   * unparseable date or missing calorie field are skipped silently.
   *
   * Returns weeks sorted ascending by weekStart:
   *   [{ weekStart, days: [historyEntry...], dayCount, totalCalories,
   *      complete: bool }]
   */
  function getWeeklyCalories(history) {
    if (!Array.isArray(history)) return [];
    var weeks = {};
    history.forEach(function(h) {
      if (!h || typeof h.calories !== "number") return;
      var d = new Date(h.date);
      var wk = getMondayKey(d);
      if (!wk) return;
      if (!weeks[wk]) weeks[wk] = { weekStart: wk, days: [] };
      weeks[wk].days.push(h);
    });
    return Object.keys(weeks).sort().map(function(k) {
      var w = weeks[k];
      var total = 0;
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

  /**
   * weeklyCalorieBalance = consumed - (maintenance × 7)
   * Returns null if either input is invalid.
   */
  function calculateWeeklyBalance(weeklyCaloriesConsumed, maintenanceCalories) {
    if (typeof weeklyCaloriesConsumed !== "number") return null;
    if (typeof maintenanceCalories !== "number" || maintenanceCalories <= 0) return null;
    return weeklyCaloriesConsumed - (maintenanceCalories * 7);
  }

  /**
   * estimatedWeightChange (lbs) = weeklyCalorieBalance / 3500
   * Returns null if input is invalid.
   */
  function calculateEstimatedWeightChange(weeklyBalance) {
    if (typeof weeklyBalance !== "number") return null;
    return weeklyBalance / CALORIES_PER_LB;
  }

  /**
   * Build the full cumulative-projection series.
   * Only complete weeks (7 days of calorie data) contribute to the
   * cumulative line — incomplete weeks are still returned but flagged
   * so the UI can dim/skip them.
   *
   * Returns: [{ weekStart, complete, dayCount, totalCalories,
   *             weeklyBalance, weeklyChange, cumulativeChange }]
   *   - weeklyBalance / weeklyChange / cumulativeChange are null on
   *     incomplete weeks (or when maintenance is missing).
   */
  function buildEstimatedSeries(history, maintenanceCalories) {
    var weeks = getWeeklyCalories(history);
    var cum = 0;
    var hasAny = typeof maintenanceCalories === "number" && maintenanceCalories > 0;
    return weeks.map(function(w) {
      var out = {
        weekStart: w.weekStart,
        complete: w.complete,
        dayCount: w.dayCount,
        totalCalories: w.totalCalories,
        weeklyBalance: null,
        weeklyChange: null,
        cumulativeChange: null
      };
      if (hasAny && w.complete) {
        var bal = calculateWeeklyBalance(w.totalCalories, maintenanceCalories);
        var chg = calculateEstimatedWeightChange(bal);
        cum += chg;
        out.weeklyBalance = bal;
        out.weeklyChange = chg;
        out.cumulativeChange = cum;
      }
      return out;
    });
  }

  /**
   * Sort a user-entered weight log ascending by date.
   * Each entry shape: { date: "YYYY-MM-DD", weight: number }.
   * Invalid entries are dropped — never invented.
   */
  function buildActualSeries(weightLog) {
    if (!Array.isArray(weightLog)) return [];
    return weightLog.filter(function(e) {
      return e && typeof e.weight === "number" && !isNaN(new Date(e.date).getTime());
    }).slice().sort(function(a, b) {
      return new Date(a.date).getTime() - new Date(b.date).getTime();
    });
  }

  /**
   * Compare a single week's actual vs estimated weight change.
   * Tolerance default 0.5 lb covers normal water/glycogen fluctuation.
   * Returns one of: "on-track" | "above" | "below" | "unknown"
   *   "above" → actual change is HIGHER than estimated
   *             (less loss / more gain than projected — body is above the line)
   *   "below" → actual change is LOWER than estimated
   *             (more loss / less gain than projected — body is below the line)
   */
  function compareWeek(actualChange, estimatedChange, tolerance) {
    if (typeof actualChange !== "number" || typeof estimatedChange !== "number") return "unknown";
    var tol = typeof tolerance === "number" ? tolerance : 0.5;
    var diff = actualChange - estimatedChange;
    if (Math.abs(diff) <= tol) return "on-track";
    return diff > 0 ? "above" : "below";
  }

  Utils.WeightProjection = {
    CALORIES_PER_LB: CALORIES_PER_LB,
    getMondayKey: getMondayKey,
    getWeeklyCalories: getWeeklyCalories,
    calculateWeeklyBalance: calculateWeeklyBalance,
    calculateEstimatedWeightChange: calculateEstimatedWeightChange,
    buildEstimatedSeries: buildEstimatedSeries,
    buildActualSeries: buildActualSeries,
    compareWeek: compareWeek
  };

})(window.PhysIQ.Utils);
