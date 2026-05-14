/* ─── PHYSIQ ENGINE — Eats Tab (MyFitnessPal-Inspired) ───────────────────── */

import React, { useState, useEffect, useMemo, useCallback } from "react";
import { FF_RESTAURANTS, FF_MENU } from "../data/fastFoodMenu.js";
import {
  searchOpenFoodFacts,
  lookupBarcode,
  NUTRI_SCORE_COLORS,
  getMealPeriod,
  MEAL_PERIODS
} from "../utils/foodSearch.js";
import {
  getUserLocation,
  fetchNearbyRestaurants,
  matchChainRestaurant
} from "../utils/nearbyRestaurants.js";
import { MealPeriodHeader } from "../components/MealPeriodHeader.js";
import { isNative, triggerHaptic } from "../utils/native.js";
import { CapacitorBarcodeScanner, CapacitorBarcodeScannerTypeHint } from "@capacitor/barcode-scanner";

// ─── Calorie Ring SVG Component ──────────────────────────────────────────
function CalorieRing(props) {
  const consumed = props.consumed;
  const target = props.target;
  const remaining = Math.max(0, target - consumed);
  const pct = target > 0 ? Math.min(consumed / target, 1) : 0;
  const r = 58;
  const circ = 2 * Math.PI * r;
  const offset = circ * (1 - pct);

  return (
    <div className="calorie-ring-container">
      <svg viewBox="0 0 140 140" className="calorie-ring-svg">
        <circle cx="70" cy="70" r={r} className="calorie-ring-bg" />
        <circle cx="70" cy="70" r={r}
          className={"calorie-ring-fill" + (consumed > target ? " over" : "")}
          style={{
            strokeDasharray: circ,
            strokeDashoffset: offset,
            stroke: consumed > target ? "var(--red)" : "url(#calRingGrad)"
          }}
        />
        <defs>
          <linearGradient id="calRingGrad" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="var(--green)" />
            <stop offset="100%" stopColor="var(--teal)" />
          </linearGradient>
        </defs>
      </svg>
      <div className="calorie-ring-center">
        <div className="calorie-ring-number mono">{remaining}</div>
        <div className="calorie-ring-label">Remaining</div>
      </div>
    </div>
  );
}

// ─── Macro Mini Bar ──────────────────────────────────────────────────────
function MacroBar(props) {
  const label = props.label;
  const current = props.current;
  const target = props.target;
  const color = props.color;
  const pct = target > 0 ? Math.min(100, (current / target) * 100) : 0;

  return (
    <div className="macro-mini-bar">
      <div className="macro-mini-header">
        <span className="macro-mini-label">{label}</span>
        <span className="macro-mini-value mono">{current}<span className="macro-mini-sep">/</span>{target}g</span>
      </div>
      <div className="macro-mini-track">
        <div className="macro-mini-fill" style={{ width: pct + "%", background: color }} />
      </div>
    </div>
  );
}

// ─── Nutri-Score Badge ───────────────────────────────────────────────────
function NutriScoreBadge(props) {
  const grade = props.grade;
  if (!grade || !NUTRI_SCORE_COLORS[grade]) return null;
  return (
    <span className="nutri-score-badge" style={{ background: NUTRI_SCORE_COLORS[grade] }}>
      {grade}
    </span>
  );
}

// ─── Food Result Card ───────────────────────────────────────────────────
function FoodResultCard(props) {
  const item = props.item;
  const onSelect = props.onSelect;
  const index = props.index;

  return (
    <div className="food-result-card fade-in" style={{ animationDelay: (index * 40) + "ms" }} onClick={function() { onSelect(item); }}>
      {item.image && (
        <div className="food-result-img">
          <img src={item.image} alt="" onError={function(e) { e.target.style.display = "none"; }} />
        </div>
      )}
      <div className="food-result-info">
        <div className="food-result-top">
          <div className="food-result-name">{item.name}</div>
          {item.nutriScore && <NutriScoreBadge grade={item.nutriScore} />}
        </div>
        {item.brand && <div className="food-result-brand">{item.brand}</div>}
        <div className="food-result-macros">
          <span className="mono" style={{ color: "var(--orange)" }}>{item.cal} cal</span>
          <span className="food-result-dot">·</span>
          <span className="mono" style={{ color: "var(--blue)" }}>{item.protein}P</span>
          <span className="mono" style={{ color: "var(--yellow)" }}>{item.carbs}C</span>
          <span className="mono" style={{ color: "var(--purple)" }}>{item.fats}F</span>
        </div>
        <div className="food-result-serving">per {item.serving}</div>
      </div>
      <div className="food-result-add">+</div>
    </div>
  );
}

// ─── Nearby Restaurant Card ──────────────────────────────────────────────
function NearbyRestaurantCard(props) {
  const rest = props.restaurant;
  const onSelect = props.onSelect;
  const index = props.index;
  const chain = rest.chainMatch;
  const chainData = chain ? FF_RESTAURANTS.find(function(r) { return r.id === chain; }) : null;

  return (
    <div className={"nearby-restaurant-card fade-in" + (chain ? " is-chain" : "")} style={{ animationDelay: (index * 50) + "ms" }} onClick={function() { if (chain) onSelect(chain); }}>
      <div className="nearby-restaurant-icon" style={chainData ? { background: chainData.color + "22", borderColor: chainData.color + "44" } : {}}>
        <span className="pq-icon pq-icon-store" aria-hidden="true"></span>
      </div>
      <div className="nearby-restaurant-info">
        <div className="nearby-restaurant-name">{rest.name}</div>
        <div className="nearby-restaurant-meta">
          <span className="nearby-restaurant-distance"><span className="pq-icon pq-icon-pin" aria-hidden="true"></span>{rest.distanceLabel}</span>
          {rest.cuisine && <span className="nearby-restaurant-cuisine">{rest.cuisine.split(";")[0]}</span>}
        </div>
      </div>
      {chain ? (
        <div className="nearby-restaurant-action chain">View Menu →</div>
      ) : (
        <div className="nearby-restaurant-action local">Local</div>
      )}
    </div>
  );
}

// ─── Skeleton Loader ────────────────────────────────────────────────────
function SkeletonLoader(props) {
  const count = props.count || 4;
  const items = [];
  for (let i = 0; i < count; i++) items.push(i);
  return (
    <div className="skeleton-container">
      {items.map(function(i) {
        return (
          <div key={i} className="skeleton-card" style={{ animationDelay: (i * 100) + "ms" }}>
            <div className="skeleton-icon pulse" />
            <div className="skeleton-lines">
              <div className="skeleton-line long pulse" />
              <div className="skeleton-line short pulse" />
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════
// ─── MAIN EATS TAB ─────────────────────────────────────────────────────
// ═══════════════════════════════════════════════════════════════════════

export function EatsTab(props) {
  const intake = props.intake, targets = props.targets;
  const mealLog = props.mealLog;
  const addSearchFood = props.addSearchFood;
  const addFF = props.addFF;
  const mealForm = props.mealForm, setMealForm = props.setMealForm, addMeal = props.addMeal;
  const removeMeal = props.removeMeal;
  const moveMealToPeriod = props.moveMealToPeriod;
  const activeMealPeriod = props.activeMealPeriod;
  const setActiveMealPeriod = props.setActiveMealPeriod;
  const reAddFood = props.reAddFood;

  const [eatsMode, setEatsMode] = useState("recent");
  const [expandedPeriod, setExpandedPeriod] = useState(activeMealPeriod || getMealPeriod());

  const handleSetExpandedPeriod = function(p) {
    setExpandedPeriod(p);
    if (p) setActiveMealPeriod(p);
  };

  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchError, setSearchError] = useState("");
  const [searchCount, setSearchCount] = useState(0);

  const [nearbyRestaurants, setNearbyRestaurants] = useState([]);
  const [nearbyLoading, setNearbyLoading] = useState(false);
  const [nearbyError, setNearbyError] = useState("");
  const [nearbyFetched, setNearbyFetched] = useState(false);

  const [chainDetail, setChainDetail] = useState(null);
  const [chainSearch, setChainSearch] = useState("");
  const [chainCat, setChainCat] = useState("All");

  const [scanResult, setScanResult] = useState(null);
  const [scanLoading, setScanLoading] = useState(false);
  const [scanError, setScanError] = useState("");
  const [scanHistory, setScanHistory] = useState([]);
  const [manualBarcode, setManualBarcode] = useState("");

  const recentFoods = props.recentFoods || [];

  const doSearch = useCallback(function(q) {
    if (!q.trim()) return;
    setSearchLoading(true);
    setSearchError("");
    setSearchResults([]);

    searchOpenFoodFacts(q, 15)
      .then(function(result) {
        setSearchResults(result.foods);
        setSearchCount(result.count);
        if (result.foods.length === 0) {
          setSearchError("No results found. Try a different search.");
        }
      })
      .catch(function(err) {
        if (err.message && err.message.includes("Search needs internet")) {
          setSearchError(err.message);
        } else {
          setSearchError("Could not reach Open Food Facts. Please try again.");
        }
      })
      .finally(function() {
        setSearchLoading(false);
      });
  }, []);

  const searchTimeoutRef = React.useRef(null);
  useEffect(function() {
    if (searchTimeoutRef.current) clearTimeout(searchTimeoutRef.current);
    if (!searchQuery.trim()) {
      setSearchResults([]);
      setSearchError("");
      return;
    }
    searchTimeoutRef.current = setTimeout(function() {
      doSearch(searchQuery);
    }, 300);
    return function() {
      if (searchTimeoutRef.current) clearTimeout(searchTimeoutRef.current);
    };
  }, [searchQuery, doSearch]);

  const fetchNearby = useCallback(function() {
    if (nearbyFetched) return;
    setNearbyLoading(true);
    setNearbyError("");

    getUserLocation()
      .then(function(loc) {
        return fetchNearbyRestaurants(loc.lat, loc.lng, 3000);
      })
      .then(function(restaurants) {
        setNearbyRestaurants(restaurants);
        setNearbyFetched(true);
        if (restaurants.length === 0) {
          setNearbyError("No restaurants found nearby. Try expanding your search.");
        }
      })
      .catch(function(err) {
        setNearbyError(err.message || "Could not fetch nearby restaurants.");
      })
      .finally(function() {
        setNearbyLoading(false);
      });
  }, [nearbyFetched]);

  useEffect(function() {
    if (eatsMode === "nearby" && !nearbyFetched && !nearbyLoading) {
      fetchNearby();
    }
  }, [eatsMode]);

  const handleAddSearchFood = function(item) {
    addSearchFood(item);
  };

  const handleAddFF = function(item) {
    addFF(item, chainDetail);
  };

  const handleAddFoodFromPeriod = function(periodId) {
    setActiveMealPeriod(periodId);
    setEatsMode("search");
  };

  const handleBarcodeLookup = useCallback(function(code) {
    setScanLoading(true);
    setScanError("");
    setScanResult(null);

    lookupBarcode(code)
      .then(function(food) {
        if (!food) {
          setScanError("Product not found for barcode: " + code + ". It may not be in the Open Food Facts database.");
          return;
        }
        setScanResult(food);
        triggerHaptic("medium");
        setScanHistory(function(prev) {
          const filtered = prev.filter(function(h) { return h.barcode !== code; });
          return [food].concat(filtered).slice(0, 10);
        });
      })
      .catch(function(err) {
        if (err.message && err.message.includes("Search needs internet")) {
          setScanError(err.message);
        } else {
          setScanError("Failed to lookup barcode. Please check your connection and try again.");
        }
      })
      .finally(function() {
        setScanLoading(false);
      });
  }, []);

  const startNativeScan = useCallback(async function() {
    setScanResult(null);
    setScanError("");

    try {
      // The official plugin handles camera permissions internally
      const result = await CapacitorBarcodeScanner.scanBarcode({
        hint: CapacitorBarcodeScannerTypeHint.ALL
      });

      if (result && result.ScanResult) {
        handleBarcodeLookup(result.ScanResult);
      }
    } catch (err) {
      const msg = (err && err.message) ? err.message : String(err);
      if (msg.indexOf("cancel") !== -1 || msg.indexOf("Cancel") !== -1) {
        // User cancelled — not an error
        return;
      }
      if (msg.indexOf("permission") !== -1 || msg.indexOf("Permission") !== -1 || msg.indexOf("denied") !== -1) {
        setScanError("Camera permission denied. Please allow camera access in Settings, or enter the barcode manually below.");
      } else {
        setScanError("Scanner error: " + msg + ". Try manual entry below.");
      }
    }
  }, [handleBarcodeLookup]);

  const chainItems = useMemo(function() {
    if (!chainDetail || !FF_MENU[chainDetail]) return [];
    let items = FF_MENU[chainDetail].items;
    if (chainCat !== "All") items = items.filter(function(i) { return i.cat === chainCat; });
    if (chainSearch.trim()) items = items.filter(function(i) { return i.name.toLowerCase().includes(chainSearch.toLowerCase()); });
    return items;
  }, [chainDetail, chainCat, chainSearch]);

  const chainData = chainDetail ? FF_RESTAURANTS.find(function(r) { return r.id === chainDetail; }) : null;
  const chainMenu = chainDetail ? FF_MENU[chainDetail] : null;

  const nearbyChains = useMemo(function() {
    return nearbyRestaurants.filter(function(r) { return r.chainMatch; });
  }, [nearbyRestaurants]);

  const nearbyLocal = useMemo(function() {
    return nearbyRestaurants.filter(function(r) { return !r.chainMatch; });
  }, [nearbyRestaurants]);

  // ═════════════════════════════════════════════════════════════════
  // ─── RENDER ──────────────────────────────────────────────────────
  // ═════════════════════════════════════════════════════════════════

  return (
    <div className="eats-tab fade-in">

      <div className="eats-daily-summary">
        <CalorieRing consumed={intake.calories} target={targets.calories} />
        <div className="eats-macros-summary">
          <MacroBar label="Protein" current={intake.protein} target={targets.protein} color="var(--blue)" />
          <MacroBar label="Carbs" current={intake.carbs} target={targets.carbs} color="var(--yellow)" />
          <MacroBar label="Fat" current={intake.fats} target={targets.fats} color="var(--purple)" />
        </div>
      </div>

      <MealPeriodHeader
        mealLog={mealLog}
        expandedPeriod={expandedPeriod}
        setExpandedPeriod={handleSetExpandedPeriod}
        removeMeal={removeMeal}
        moveMealToPeriod={moveMealToPeriod}
        onAddFood={handleAddFoodFromPeriod}
      />

      <div className="eats-segmented-control">
        {[
          { id: "recent",  label: "Recent",  iconClass: "pq-icon-clock" },
          { id: "search",  label: "Search",  iconClass: "pq-icon-search" },
          { id: "scan",    label: "Scan",    iconClass: "pq-icon-barcode" },
          { id: "nearby",  label: "Nearby",  iconClass: "pq-icon-pin" },
          { id: "manual",  label: "Manual",  iconClass: "pq-icon-pencil" }
        ].map(function(t) {
          return (
            <button key={t.id}
              className={"eats-seg-btn" + (eatsMode === t.id ? " active" : "")}
              onClick={function() { setEatsMode(t.id); if (t.id !== "nearby") { setChainDetail(null); } }}
            >
              <span className={"eats-seg-icon pq-icon " + t.iconClass} aria-hidden="true"></span>
              <span className="eats-seg-label">{t.label}</span>
            </button>
          );
        })}
      </div>

      {eatsMode === "recent" && (
        <div className="eats-recent-section fade-in">
          {recentFoods.length === 0 ? (
            <div className="eats-empty-state">
              <div className="eats-empty-icon"><span className="pq-icon pq-icon-clock" aria-hidden="true"></span></div>
              <div className="eats-empty-title">No recent eats yet</div>
              <div className="eats-empty-sub">Foods you log will appear here for quick re-adding. Search for a food to get started!</div>
              <button className="btn btn-primary" style={{ maxWidth: 240, margin: "16px auto 0" }} onClick={function() { setEatsMode("search"); }}>
                + Search Foods
              </button>
            </div>
          ) : (
            <div>
              <div className="eats-section-label">
                <span>Quick Add — Recent Eats</span>
                <span className="eats-section-badge">{recentFoods.length} items</span>
              </div>
              <div className="eats-recent-grid">
                {recentFoods.map(function(meal, i) {
                  return (
                    <div key={meal.name + i} className="eats-recent-food-card fade-in" style={{ animationDelay: (i * 40) + "ms" }} onClick={function() { reAddFood(meal); }}>
                      <div className="eats-recent-food-info">
                        <div className="eats-recent-food-name">{meal.name}</div>
                        <div className="eats-recent-food-macros">
                          <span className="mono" style={{ color: "var(--orange)" }}>{meal.calories || 0} cal</span>
                          <span className="eats-recent-food-dot">·</span>
                          <span style={{ color: "var(--blue)" }}>{meal.protein || 0}P</span>
                          <span style={{ color: "var(--yellow)" }}>{meal.carbs || 0}C</span>
                          <span style={{ color: "var(--purple)" }}>{meal.fats || 0}F</span>
                        </div>
                      </div>
                      <div className="eats-recent-food-add">+ Add</div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      )}

      {eatsMode === "search" && (
        <div className="eats-search-section fade-in">
          <div className="eats-search-bar">
            <div className="eats-search-input-wrap">
              <span className="eats-search-icon pq-icon pq-icon-search" aria-hidden="true"></span>
              <input
                className="eats-search-input"
                placeholder='Search 2.5M+ foods...'
                value={searchQuery}
                onChange={function(e) { setSearchQuery(e.target.value); }}
                onKeyDown={function(e) { if (e.key === "Enter") { if (searchTimeoutRef.current) clearTimeout(searchTimeoutRef.current); doSearch(searchQuery); } }}
              />
              {searchQuery && (
                <button className="eats-search-clear" onClick={function() { setSearchQuery(""); setSearchResults([]); setSearchError(""); }}>×</button>
              )}
            </div>
            <button className="eats-search-btn" onClick={function() { if (searchTimeoutRef.current) clearTimeout(searchTimeoutRef.current); doSearch(searchQuery); }} disabled={searchLoading || !searchQuery.trim()}>
              {searchLoading ? "..." : "Search"}
            </button>
          </div>

          <div className="eats-search-source">
            <span className="eats-source-badge off">Open Food Facts</span>
            <span className="eats-source-count">{searchCount > 0 ? searchCount.toLocaleString() + " matches" : "2.5M+ foods · Free & open-source"}</span>
          </div>

          {searchError && <div className="eats-search-error">{searchError}</div>}

          {searchResults.length > 0 && (
            <div className="eats-search-results">
              {searchResults.map(function(item, i) {
                return <FoodResultCard key={i} item={item} onSelect={handleAddSearchFood} index={i} />;
              })}
            </div>
          )}

          {searchLoading && <SkeletonLoader count={4} />}

          {!searchQuery && !searchLoading && searchResults.length === 0 && (
            <div className="eats-search-empty">
              {recentFoods.length > 0 && (
                <div className="eats-recent-section">
                  <div className="eats-section-label">Recent Foods</div>
                  <div className="eats-recent-list">
                    {recentFoods.map(function(f, i) {
                      return (
                        <button key={i} className="eats-recent-chip" onClick={function() { setSearchQuery(f.name); }}>
                          <span className="eats-recent-name">{f.name}</span>
                          <span className="eats-recent-cal mono">{f.calories}cal</span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

              <div className="eats-popular-section">
                <div className="eats-section-label">Popular Searches</div>
                <div className="eats-popular-list">
                  {["banana", "chicken breast", "rice", "eggs", "oatmeal", "salmon", "greek yogurt", "sweet potato", "avocado", "protein shake", "peanut butter", "milk"].map(function(q) {
                    return (
                      <button key={q} className="eats-popular-chip" onClick={function() { setSearchQuery(q); }}>
                        {q}
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {eatsMode === "scan" && (
        <div className="eats-scan-section fade-in">

          {scanResult && (
            <div className="scan-result-card fade-in">
              <div className="scan-result-header">
                <div className="scan-result-badge">Product Found</div>
                <button className="scan-result-close" onClick={function() { setScanResult(null); }}>×</button>
              </div>
              <div className="scan-result-body">
                {scanResult.image && (
                  <div className="scan-result-img">
                    <img src={scanResult.image} alt="" onError={function(e) { e.target.parentElement.style.display = "none"; }} />
                  </div>
                )}
                <div className="scan-result-info">
                  <div className="scan-result-name">{scanResult.name}</div>
                  {scanResult.brand && <div className="scan-result-brand">{scanResult.brand}</div>}
                  {scanResult.nutriScore && NUTRI_SCORE_COLORS[scanResult.nutriScore] && (
                    <span className="nutri-score-badge" style={{ background: NUTRI_SCORE_COLORS[scanResult.nutriScore], marginTop: 4 }}>{scanResult.nutriScore}</span>
                  )}
                  <div className="scan-result-macros">
                    <span className="mono" style={{ color: "var(--orange)" }}>{scanResult.cal} cal</span>
                    <span className="scan-result-dot">·</span>
                    <span className="mono" style={{ color: "var(--blue)" }}>{scanResult.protein}P</span>
                    <span className="mono" style={{ color: "var(--yellow)" }}>{scanResult.carbs}C</span>
                    <span className="mono" style={{ color: "var(--purple)" }}>{scanResult.fats}F</span>
                  </div>
                  <div className="scan-result-serving">per {scanResult.serving}</div>
                </div>
              </div>
              <button className="btn btn-primary scan-result-add-btn" onClick={function() { addSearchFood(scanResult); }}>
                + Add to Log
              </button>
            </div>
          )}

          {!scanResult && (
            <div className="scan-start-section">
              <div className="scan-start-icon"><span className="pq-icon pq-icon-barcode" aria-hidden="true"></span></div>
              <div className="scan-start-title">Barcode Scanner</div>
              {isNative() ? (
                <div>
                  <div className="scan-start-sub">Tap below to open the camera and scan any food barcode for instant nutrition lookup</div>
                  <button className="btn btn-primary scan-start-btn" onClick={startNativeScan} disabled={scanLoading}>
                    {scanLoading ? "Looking up..." : "Scan Barcode"}
                  </button>
                </div>
              ) : (
                <div className="scan-start-sub">Enter a barcode number below to look up nutrition info from Open Food Facts. Camera scanning is available in the iOS app.</div>
              )}
            </div>
          )}

          {scanLoading && (
            <div className="scan-loading fade-in">
              <div className="scan-loading-spinner" />
              <span>Looking up product...</span>
            </div>
          )}

          {scanError && (
            <div className="scan-error fade-in">
              <div className="scan-error-icon"><span className="pq-icon pq-icon-alert" aria-hidden="true"></span></div>
              <div className="scan-error-msg">{scanError}</div>
              {isNative() && (
                <button className="btn btn-primary" style={{ maxWidth: 200, margin: "12px auto 0" }} onClick={function() { setScanError(""); startNativeScan(); }}>
                  Try Again
                </button>
              )}
            </div>
          )}

          {!scanResult && (
            <div className="scan-manual-section">
              <div className="scan-manual-divider">
                <span className="scan-manual-divider-line" />
                <span className="scan-manual-divider-text">{isNative() ? "or enter barcode manually" : "Enter barcode number"}</span>
                <span className="scan-manual-divider-line" />
              </div>
              <div className="scan-manual-row">
                <input
                  className="input mono scan-manual-input"
                  placeholder="Enter barcode number..."
                  value={manualBarcode}
                  onChange={function(e) { setManualBarcode(e.target.value.replace(/[^0-9]/g, '')); }}
                  onKeyDown={function(e) { if (e.key === "Enter" && manualBarcode.trim()) handleBarcodeLookup(manualBarcode.trim()); }}
                  inputMode="numeric"
                />
                <button className="btn btn-primary scan-manual-btn" onClick={function() { if (manualBarcode.trim()) handleBarcodeLookup(manualBarcode.trim()); }} disabled={scanLoading || !manualBarcode.trim()}>
                  Lookup
                </button>
              </div>
            </div>
          )}

          {scanHistory.length > 0 && !scanResult && (
            <div className="scan-history-section fade-in">
              <div className="eats-section-label">
                <span>Recent Scans</span>
                <span className="eats-section-badge">{scanHistory.length}</span>
              </div>
              <div className="scan-history-list">
                {scanHistory.map(function(item, i) {
                  return (
                    <div key={item.barcode + i} className="scan-history-card fade-in" style={{ animationDelay: (i * 40) + "ms" }} onClick={function() { addSearchFood(item); }}>
                      {item.image && (
                        <div className="scan-history-img">
                          <img src={item.image} alt="" onError={function(e) { e.target.style.display = "none"; }} />
                        </div>
                      )}
                      <div className="scan-history-info">
                        <div className="scan-history-name">{item.name}</div>
                        {item.brand && <div className="scan-history-brand">{item.brand}</div>}
                        <div className="scan-history-macros">
                          <span className="mono" style={{ color: "var(--orange)" }}>{item.cal} cal</span>
                          <span style={{ color: "var(--text-faint)", fontSize: 8 }}>·</span>
                          <span style={{ color: "var(--blue)" }}>{item.protein}P</span>
                          <span style={{ color: "var(--yellow)" }}>{item.carbs}C</span>
                          <span style={{ color: "var(--purple)" }}>{item.fats}F</span>
                        </div>
                      </div>
                      <div className="scan-history-add">+ Add</div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          <div className="scan-powered-by">
            <span className="eats-source-badge off">Open Food Facts</span>
            <span style={{ fontSize: 10, color: "var(--text-faint)" }}>Free barcode database · 3M+ products</span>
          </div>
        </div>
      )}

      {eatsMode === "nearby" && !chainDetail && (
        <div className="eats-nearby-section fade-in">
          {nearbyLoading && (
            <div>
              <div className="eats-nearby-locating">
                <div className="eats-locating-pulse" />
                <span>Finding restaurants near you...</span>
              </div>
              <SkeletonLoader count={5} />
            </div>
          )}

          {nearbyError && !nearbyLoading && (
            <div className="eats-nearby-error">
              <div className="eats-nearby-error-icon"><span className="pq-icon pq-icon-pin" aria-hidden="true"></span></div>
              <div className="eats-nearby-error-msg">{nearbyError}</div>
              <button className="btn btn-primary" style={{ maxWidth: 200, margin: "12px auto 0" }} onClick={function() { setNearbyFetched(false); fetchNearby(); }}>
                Try Again
              </button>
            </div>
          )}

          {!nearbyLoading && !nearbyError && nearbyFetched && (
            <div>
              {nearbyChains.length > 0 && (
                <div className="eats-nearby-group">
                  <div className="eats-section-label">
                    <span>Chain Restaurants</span>
                    <span className="eats-section-badge">{nearbyChains.length} nearby</span>
                  </div>
                  {nearbyChains.map(function(r, i) {
                    return <NearbyRestaurantCard key={i} restaurant={r} onSelect={function(id) { setChainDetail(id); setChainCat("All"); setChainSearch(""); }} index={i} />;
                  })}
                </div>
              )}

              {nearbyLocal.length > 0 && (
                <div className="eats-nearby-group">
                  <div className="eats-section-label">
                    <span>Local Restaurants</span>
                    <span className="eats-section-badge">{nearbyLocal.length} nearby</span>
                  </div>
                  {nearbyLocal.slice(0, 15).map(function(r, i) {
                    return <NearbyRestaurantCard key={i} restaurant={r} onSelect={function() {}} index={i} />;
                  })}
                  <div className="eats-nearby-tip">
                    Tip: Search for dishes from local restaurants in the Search tab for nutrition info.
                  </div>
                </div>
              )}

              <div className="eats-nearby-group">
                <div className="eats-section-label">
                  <span>All Chain Menus</span>
                </div>
                <div className="eats-all-chains">
                  {FF_RESTAURANTS.map(function(r) {
                    const isNearby = nearbyChains.some(function(nc) { return nc.chainMatch === r.id; });
                    return (
                      <button key={r.id} className={"eats-chain-pill" + (isNearby ? " nearby" : "")}
                        onClick={function() { setChainDetail(r.id); setChainCat("All"); setChainSearch(""); }}
                        style={{ borderColor: isNearby ? r.color : undefined }}
                      >
                        <span className="pq-icon pq-icon-store" aria-hidden="true"></span>
                        <span>{r.name}</span>
                        {isNearby && <span className="eats-chain-nearby-dot" style={{ background: r.color }} />}
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>
          )}

          {!nearbyLoading && !nearbyError && !nearbyFetched && (
            <div className="eats-nearby-group">
              <div className="eats-section-label">Browse Chain Menus</div>
              <div className="eats-all-chains">
                {FF_RESTAURANTS.map(function(r) {
                  return (
                    <button key={r.id} className="eats-chain-pill"
                      onClick={function() { setChainDetail(r.id); setChainCat("All"); setChainSearch(""); }}
                    >
                      <span className="pq-icon pq-icon-store" aria-hidden="true"></span>
                      <span>{r.name}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      )}

      {eatsMode === "nearby" && chainDetail && chainData && (
        <div className="eats-chain-detail fade-in">
          <button className="eats-chain-back" onClick={function() { setChainDetail(null); }}>
            ← Back to Nearby
          </button>

          <div className="eats-chain-header" style={{ borderColor: chainData.color + "44" }}>
            <span className="eats-chain-header-icon" style={{ background: chainData.color + "22" }}>
              <span className="pq-icon pq-icon-store" aria-hidden="true"></span>
            </span>
            <div>
              <div className="eats-chain-header-name">{chainData.name}</div>
              <div className="eats-chain-header-count">{chainMenu ? chainMenu.items.length : 0} items</div>
            </div>
          </div>

          <div className="eats-chain-search-wrap">
            <span className="eats-search-icon pq-icon pq-icon-search" aria-hidden="true"></span>
            <input
              className="eats-chain-search"
              placeholder={"Search " + chainData.name + "..."}
              value={chainSearch}
              onChange={function(e) { setChainSearch(e.target.value); }}
            />
          </div>

          <div className="eats-chain-categories">
            <button className={"eats-cat-chip" + (chainCat === "All" ? " active" : "")} onClick={function() { setChainCat("All"); }}>All</button>
            {chainMenu && chainMenu.categories.map(function(c) {
              return <button key={c} className={"eats-cat-chip" + (chainCat === c ? " active" : "")} onClick={function() { setChainCat(c); }} style={chainCat === c ? { borderColor: chainData.color, color: chainData.color, background: chainData.color + "15" } : {}}>{c}</button>;
            })}
          </div>

          <div className="eats-chain-items">
            {chainItems.length === 0 && <div className="eats-chain-empty">No items found</div>}
            {chainItems.map(function(item, i) {
              return (
                <div key={i} className="eats-chain-item fade-in" style={{ animationDelay: (i * 30) + "ms" }} onClick={function() { handleAddFF(item); }}>
                  <div className="eats-chain-item-info">
                    <div className="eats-chain-item-name">{item.name}</div>
                    <div className="eats-chain-item-macros">
                      <span className="mono" style={{ color: "var(--orange)" }}>{item.cal} cal</span>
                      <span className="eats-chain-item-dot">·</span>
                      <span className="mono" style={{ color: "var(--blue)" }}>{item.protein}P</span>
                      <span className="mono" style={{ color: "var(--yellow)" }}>{item.carbs}C</span>
                      <span className="mono" style={{ color: "var(--purple)" }}>{item.fats}F</span>
                    </div>
                    <div className="eats-chain-item-micro">
                      <span>Na: {item.sodium}mg</span>
                      <span>Sugar: {item.sugar}g</span>
                      <span>Fiber: {item.fiber}g</span>
                    </div>
                  </div>
                  <div className="eats-chain-item-add" style={{ borderColor: chainData.color + "44", color: chainData.color }}>+ Add</div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {eatsMode === "manual" && (
        <div className="eats-manual-section fade-in">
          <div className="eats-manual-title">Quick Entry</div>
          <div className="eats-manual-sub">Manually log a meal with custom macros</div>

          <input className="input eats-manual-name" placeholder="Meal name (e.g. Grilled Chicken)" value={mealForm.name} onChange={function(e) { setMealForm(function(f) { return Object.assign({}, f, { name: e.target.value }); }); }} />

          <div className="eats-manual-macros-grid">
            {[{ k: "calories", l: "Calories", c: "var(--orange)", u: "kcal" }, { k: "protein", l: "Protein", c: "var(--blue)", u: "g" }, { k: "carbs", l: "Carbs", c: "var(--yellow)", u: "g" }, { k: "fats", l: "Fat", c: "var(--purple)", u: "g" }].map(function(f) {
              return (
                <div key={f.k} className="eats-manual-field">
                  <label className="eats-manual-label" style={{ color: f.c }}>{f.l}</label>
                  <div className="eats-manual-input-wrap">
                    <input className="input mono eats-manual-input" type="number" inputMode="decimal" placeholder="0" value={mealForm[f.k]} onChange={function(e) { setMealForm(function(fm) { return Object.assign({}, fm, { [f.k]: e.target.value }); }); }} />
                    <span className="eats-manual-unit">{f.u}</span>
                  </div>
                </div>
              );
            })}
          </div>

          <details className="eats-manual-extras">
            <summary className="eats-manual-extras-toggle">More nutrients ▾</summary>
            <div className="eats-manual-macros-grid" style={{ marginTop: 10 }}>
              {[{ k: "fiber", l: "Fiber", u: "g" }, { k: "sugar", l: "Sugar", u: "g" }, { k: "sodium", l: "Sodium", u: "mg" }, { k: "potassium", l: "Potassium", u: "mg" }].map(function(f) {
                return (
                  <div key={f.k} className="eats-manual-field">
                    <label className="eats-manual-label">{f.l}</label>
                    <div className="eats-manual-input-wrap">
                      <input className="input mono eats-manual-input" type="number" inputMode="decimal" placeholder="0" value={mealForm[f.k]} onChange={function(e) { setMealForm(function(fm) { return Object.assign({}, fm, { [f.k]: e.target.value }); }); }} />
                      <span className="eats-manual-unit">{f.u}</span>
                    </div>
                  </div>
                );
              })}
            </div>
          </details>

          <button className="btn btn-primary" onClick={addMeal} style={{ marginTop: 24 }}>+ Log Meal</button>
        </div>
      )}

    </div>
  );
}
