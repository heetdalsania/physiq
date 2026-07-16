/* ─── PHYSIQ ENGINE — Plan a Day (nutrition simulation) ───────────────────
 *
 * Sandbox day-planner: build a hypothetical day of eating and watch the
 * remaining-to-target numbers close in real time. Nothing here touches the
 * real log unless the user explicitly taps "Log" on an item.
 *
 * Reuses the food-search stack (foodSearch.js, PortionModal) and the
 * gap-filling recommender in utils/dayPlanner.js. Deliberately does NOT
 * touch EatsTab.js — any glue shared with it is duplicated, not extracted.
 *
 * Two persisted drafts (Training day / Rest day). Drafts store food items
 * only; targets are recomputed from the live profile every render, so a
 * plan re-scores itself when weight or goal changes.
 * ───────────────────────────────────────────────────────────────────────── */

import React, { useState, useMemo, useEffect, useRef } from "react";
import { COMMON_FOODS } from "../data/commonFoods.js";
import { AppTime } from "../utils/appTime.js";
import { get, sv, uKey } from "../utils/storage.js";
import { searchOpenFoodFacts } from "../utils/foodSearch.js";
import {
  toPlanItem,
  planTotals,
  buildCandidatePool,
  rankRecommendations,
  autoFillDay,
  evaluatePlan,
  planWarning
} from "../utils/dayPlanner.js";
import { PortionModal } from "../components/PortionModal.js";

const MACRO_LABELS = { protein: "Protein", carbs: "Carbs", fats: "Fats" };
const PHASE_LABEL = { build: "BULK", lean: "BULK", cut: "CUT", debloat: "CUT", maintain: "MAINTAIN" };
const DRAFTS = [
  { id: "training", label: "Training day" },
  { id: "rest", label: "Rest day" }
];

function emptyDrafts() {
  return { training: [], rest: [] };
}

export function PlanDayScreen({ profile, targets, intake, recentFoods, email, logFromPlan, onBack, focusMacro }) {
  const [drafts, setDrafts] = useState(function() {
    const raw = get(uKey(email, "planDrafts"), null);
    if (raw && Array.isArray(raw.training) && Array.isArray(raw.rest)) return raw;
    return emptyDrafts();
  });
  const [draftKey, setDraftKey] = useState("training");
  const items = drafts[draftKey] || [];

  const [query, setQuery] = useState("");
  const [results, setResults] = useState(null);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState("");

  // Portion modal state (same shape App.js uses for the Eats flow).
  const [portionItem, setPortionItem] = useState(null);
  const [portionGrams, setPortionGrams] = useState(100);
  const [portionUnit, setPortionUnit] = useState("servings");
  const [portionCount, setPortionCount] = useState(1);

  // Persist drafts, honoring the Dev Mode sandbox like the rest of the app.
  const loadedRef = useRef(false);
  useEffect(function() {
    if (!loadedRef.current) { loadedRef.current = true; return; }
    if (email && !AppTime.getDevMode()) sv(email, "planDrafts", drafts);
  }, [drafts, email]);

  const setItems = function(next) {
    setDrafts(function(prev) {
      const out = Object.assign({}, prev);
      out[draftKey] = next;
      return out;
    });
  };

  const addItem = function(planItem) {
    setItems(items.concat([planItem]));
  };
  const removeItem = function(idx) {
    setItems(items.filter(function(_, i) { return i !== idx; }));
  };

  const pool = useMemo(function() {
    return buildCandidatePool(recentFoods, COMMON_FOODS);
  }, [recentFoods]);

  // "Remaining" means the rest of TODAY: food already logged counts, and
  // a planned item that was logged flips to eaten (excluded here — it's
  // now counted via intake) so nothing is double-counted. The eaten flag
  // is stamped with today's date, so tomorrow the template is whole again.
  const todayKey = (function() {
    const d = AppTime.now();
    return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
  })();
  const isEaten = function(it) { return !!it && it.eatenOn === todayKey; };
  const activeItems = items.filter(function(it) { return !isEaten(it); });
  const loggedCalories = (intake && intake.calories) || 0;
  const engineItems = (loggedCalories > 0
    ? [{
        name: "Logged today",
        calories: intake.calories || 0, protein: intake.protein || 0,
        carbs: intake.carbs || 0, fats: intake.fats || 0,
        fiber: intake.fiber || 0, sugar: intake.sugar || 0,
        sodium: intake.sodium || 0, potassium: intake.potassium || 0
      }]
    : []).concat(activeItems);

  const evalResult = evaluatePlan(profile.goal, engineItems, targets);
  const warning = planWarning(profile.goal, engineItems, targets);
  const plannedTotals = planTotals(activeItems);
  const recs = useMemo(function() {
    return rankRecommendations(pool, engineItems, targets, { focusMacro: focusMacro || null, limit: 4 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pool, items, intake, targets, focusMacro]);

  const doAutoFill = function() {
    const added = autoFillDay(pool, engineItems, targets, profile.goal, 20);
    if (added.length) setItems(items.concat(added));
  };

  const logItem = function(idx) {
    logFromPlan(items[idx]);
    setItems(items.map(function(it, i) {
      return i === idx ? Object.assign({}, it, { eatenOn: todayKey }) : it;
    }));
  };

  const runSearch = function() {
    const q = query.trim();
    if (!q) return;
    setSearching(true);
    setSearchError("");
    searchOpenFoodFacts(q).then(function(res) {
      setResults(res.foods || []);
      setSearching(false);
    }).catch(function(err) {
      setSearching(false);
      setResults([]);
      setSearchError(err && err.message ? err.message : "Search failed — try again.");
    });
  };

  // Same portion flow the Eats popup uses (glue intentionally duplicated
  // rather than extracted from EatsTab/App).
  const openPortion = function(item) {
    setPortionItem(item);
    setPortionUnit("servings");
    setPortionCount(1);
    let servGrams = item._servingGrams || 0;
    if (!servGrams && item.serving) {
      const m = item.serving.match(/(\d+\.?\d*)\s*g/i);
      if (m) servGrams = parseFloat(m[1]);
    }
    setPortionGrams(servGrams || 100);
  };

  const confirmPortion = function() {
    if (!portionItem) return;
    let servingGrams = portionItem._servingGrams || 0;
    if (!servingGrams && portionItem.serving) {
      const match = portionItem.serving.match(/(\d+\.?\d*)\s*g/i);
      if (match) servingGrams = parseFloat(match[1]);
    }
    if (!servingGrams) servingGrams = 100;

    let s;
    if (portionUnit === "custom") {
      s = portionItem._perServing
        ? (servingGrams > 0 ? portionGrams / servingGrams : 1)
        : portionGrams / 100;
    } else {
      s = portionItem._perServing ? portionCount : (portionCount * servingGrams) / 100;
    }

    const suffix = portionUnit === "servings" && portionCount !== 1 ? " ×" + portionCount : "";
    addItem(toPlanItem({
      name: portionItem.name + suffix,
      brand: portionItem.brand,
      serving: portionItem.serving,
      cal: Math.round(portionItem.cal * s),
      protein: Math.round(portionItem.protein * s),
      carbs: Math.round(portionItem.carbs * s),
      fats: Math.round(portionItem.fats * s),
      fiber: Math.round((portionItem.fiber || 0) * s),
      sugar: Math.round((portionItem.sugar || 0) * s),
      sodium: Math.round((portionItem.sodium || 0) * s),
      potassium: Math.round((portionItem.potassium || 0) * s)
    }));
    setPortionItem(null);
  };

  const phase = PHASE_LABEL[profile.goal] || "MAINTAIN";
  const rem = evalResult.remaining;

  let verdictText, verdictColor;
  if (engineItems.length === 0) {
    verdictText = "Add foods to see how the day scores.";
    verdictColor = "var(--text-muted)";
  } else if (evalResult.dayOk) {
    verdictText = "This day counts as on-target for your " + phase + ".";
    verdictColor = "var(--green)";
  } else if (!evalResult.caloriesOk && rem.calories > 0) {
    verdictText = rem.calories + " kcal short of an on-target " + phase + " day.";
    verdictColor = "var(--amber)";
  } else if (!evalResult.caloriesOk) {
    verdictText = Math.abs(rem.calories) + " kcal over for your " + phase + ".";
    verdictColor = "var(--amber)";
  } else {
    const missing = ["protein", "carbs", "fats"].filter(function(m) { return rem[m] > 0; })
      .map(function(m) { return rem[m] + "g " + m; });
    verdictText = "Calories work — still short " + missing.join(", ") + ".";
    verdictColor = "var(--amber)";
  }

  return (
    <div className="fade-in" style={{ paddingTop: 16, paddingBottom: 24 }}>
      <div className="screen-header">
        <button className="screen-back-btn" onClick={onBack}>{"‹"} Back</button>
        <div style={{ flex: 1 }} />
        <span className="pd-mode-badge">Planning {"·"} not logged</span>
      </div>

      <div style={{ fontSize: 24, fontWeight: 700, color: "var(--text-white)", letterSpacing: -0.3, marginBottom: 4 }}>
        Plan a Day
      </div>
      <div style={{ fontSize: 13, color: "var(--text-muted)", marginBottom: 14 }}>
        Sketch a day of eating and see if it hits your targets
      </div>

      {focusMacro && (
        <div className="pd-focus-banner">
          From your weekly report: <strong>{MACRO_LABELS[focusMacro] || focusMacro}</strong> was the gap last week.
          Suggestions below lead with {(MACRO_LABELS[focusMacro] || focusMacro).toLowerCase()}-heavy foods.
        </div>
      )}

      <div className="wr-tabs">
        {DRAFTS.map(function(d) {
          return (
            <button
              key={d.id}
              className={"wr-tab" + (draftKey === d.id ? " active" : "")}
              onClick={function() { setDraftKey(d.id); }}
            >
              {d.label}{(drafts[d.id] || []).length > 0 ? " (" + drafts[d.id].length + ")" : ""}
            </button>
          );
        })}
      </div>

      {/* Remaining-to-target — the planning scoreboard */}
      <div className="card" style={{ padding: 16, marginBottom: 12 }}>
        <div className="label" style={{ marginBottom: 8 }}>Remaining today</div>
        <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginBottom: 10 }}>
          <span className="mono" style={{ fontSize: 26, fontWeight: 700, color: rem.calories > 0 ? "var(--text-white)" : "var(--green)" }}>
            {rem.calories > 0 ? rem.calories : 0}
          </span>
          <span style={{ fontSize: 13, color: "var(--text-muted)" }}>
            kcal left of {targets.calories}
            {rem.calories < 0 ? " · " + Math.abs(rem.calories) + " over" : ""}
          </span>
        </div>
        {loggedCalories > 0 && (
          <div style={{ fontSize: 11, color: "var(--text-faint)", marginTop: -6, marginBottom: 10 }}>
            Includes {loggedCalories} kcal already logged today
          </div>
        )}
        <div style={{ display: "flex", gap: 8, marginBottom: 10 }}>
          {["protein", "carbs", "fats"].map(function(m) {
            const met = rem[m] <= 0;
            return (
              <div key={m} className="pd-macro-chip" style={{ borderColor: met ? "var(--green)" : "var(--border)" }}>
                <div style={{ fontSize: 11, color: "var(--text-muted)" }}>{MACRO_LABELS[m]}</div>
                <div className="mono" style={{ fontSize: 13, fontWeight: 700, color: met ? "var(--green)" : "var(--text)" }}>
                  {met ? "✓ met" : rem[m] + "g to go"}
                </div>
              </div>
            );
          })}
        </div>
        <div style={{ fontSize: 13, fontWeight: 600, color: verdictColor }}>{verdictText}</div>
        {warning && (
          <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 6 }}>{warning.text}</div>
        )}
      </div>

      {/* Gap-filling suggestions */}
      <div className="card" style={{ padding: 16, marginBottom: 12 }}>
        <div className="label" style={{ marginBottom: 8 }}>
          Suggestions{recs.gap ? " · filling " + (MACRO_LABELS[recs.gap] || recs.gap).toLowerCase() : ""}
        </div>
        {recs.foods.length === 0 ? (
          <div className="wr-empty">
            {rem.calories <= 0 ? "Day is fully planned — nothing left to fill." : "No fitting suggestions right now."}
          </div>
        ) : (
          recs.foods.map(function(f) {
            return (
              <div key={f.name} className="wr-row">
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 14, fontWeight: 600, color: "var(--text)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{f.name}</div>
                  <div style={{ fontSize: 11, color: "var(--text-muted)" }}>
                    {f.serving ? f.serving + " · " : ""}{f.calories} kcal
                    {recs.gap ? " · " + f[recs.gap] + "g " + (MACRO_LABELS[recs.gap] || recs.gap).toLowerCase() : ""}
                  </div>
                </div>
                <button className="pd-add-btn" onClick={function() { addItem(f); }}>+ Add</button>
              </div>
            );
          })
        )}
        <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
          <button className="pd-tool-btn" onClick={doAutoFill} disabled={evalResult.dayOk}>
            Auto-fill day
          </button>
          {items.length > 0 && (
            <button className="pd-tool-btn" onClick={function() { setItems([]); }}>Clear day</button>
          )}
        </div>
      </div>

      {/* Search (Open Food Facts, same stack as Eats) */}
      <div className="card" style={{ padding: 16, marginBottom: 12 }}>
        <div className="label" style={{ marginBottom: 8 }}>Search foods</div>
        <div style={{ display: "flex", gap: 8 }}>
          <input
            type="text"
            className="input"
            style={{ flex: 1 }}
            placeholder="e.g. greek yogurt"
            value={query}
            onChange={function(e) { setQuery(e.target.value); }}
            onKeyDown={function(e) { if (e.key === "Enter") runSearch(); }}
          />
          <button className="pd-tool-btn" onClick={runSearch} disabled={searching}>
            {searching ? "…" : "Search"}
          </button>
        </div>
        {searchError && (
          <div style={{ fontSize: 12, color: "var(--red)", marginTop: 8 }}>{searchError}</div>
        )}
        {results && results.length === 0 && !searching && !searchError && (
          <div className="wr-empty" style={{ marginTop: 8 }}>No results.</div>
        )}
        {results && results.length > 0 && (
          <div style={{ marginTop: 6 }}>
            {results.slice(0, 6).map(function(r, i) {
              return (
                <div key={r.name + i} className="wr-row">
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 14, fontWeight: 600, color: "var(--text)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {r.name}{r.brand ? " · " + r.brand : ""}
                    </div>
                    <div style={{ fontSize: 11, color: "var(--text-muted)" }}>
                      {r.serving} {"·"} {r.cal} kcal {"·"} {r.protein}P {r.carbs}C {r.fats}F
                    </div>
                  </div>
                  <button className="pd-add-btn" onClick={function() { openPortion(r); }}>+ Add</button>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* The planned day */}
      <div className="card" style={{ padding: 16, marginBottom: 12 }}>
        <div className="label" style={{ marginBottom: 8 }}>
          Planned {"·"} {items.length} item{items.length !== 1 ? "s" : ""} {"·"} <span className="mono">{plannedTotals.calories}</span> kcal to eat
        </div>
        {items.length === 0 ? (
          <div className="wr-empty">Nothing planned yet. Add suggestions above or search for foods.</div>
        ) : (
          items.map(function(it, idx) {
            const eaten = isEaten(it);
            return (
              <div key={it.name + idx} className="wr-row" style={eaten ? { opacity: 0.45 } : null}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 14, fontWeight: 600, color: "var(--text)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{it.name}</div>
                  <div className="mono" style={{ fontSize: 11, color: "var(--text-muted)" }}>
                    {it.calories} kcal {"·"} {it.protein}P {it.carbs}C {it.fats}F
                  </div>
                </div>
                {eaten ? (
                  <span className="mono" style={{ fontSize: 12, fontWeight: 700, color: "var(--green)", flexShrink: 0 }}>
                    Logged {"✓"}
                  </span>
                ) : (
                  <button className="pd-log-btn" onClick={function() { logItem(idx); }} title="Log this for real, today">
                    Log
                  </button>
                )}
                <button className="pd-remove-btn" onClick={function() { removeItem(idx); }} title="Remove from plan">
                  {"×"}
                </button>
              </div>
            );
          })
        )}
      </div>

      <PortionModal
        portionItem={portionItem} setPortionItem={setPortionItem}
        portionGrams={portionGrams} setPortionGrams={setPortionGrams}
        portionUnit={portionUnit} setPortionUnit={setPortionUnit}
        portionCount={portionCount} setPortionCount={setPortionCount}
        confirmPortion={confirmPortion}
      />
    </div>
  );
}
