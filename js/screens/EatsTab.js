/* ─── PHYSIQ ENGINE — Eats Tab (MyFitnessPal-Inspired) ───────────────────── */

window.PhysIQ = window.PhysIQ || {};
window.PhysIQ.Screens = window.PhysIQ.Screens || {};

(function(Screens, Data, Utils, Components) {

  var useState = React.useState;
  var useEffect = React.useEffect;
  var useMemo = React.useMemo;
  var useCallback = React.useCallback;

  var FF_RESTAURANTS = Data.FF_RESTAURANTS;
  var FF_MENU = Data.FF_MENU;
  var searchOpenFoodFacts = Utils.searchOpenFoodFacts;
  var getUserLocation = Utils.getUserLocation;
  var fetchNearbyRestaurants = Utils.fetchNearbyRestaurants;
  var matchChainRestaurant = Utils.matchChainRestaurant;
  var NUTRI_SCORE_COLORS = Utils.NUTRI_SCORE_COLORS;
  var getMealPeriod = Utils.getMealPeriod;
  var MEAL_PERIODS = Utils.MEAL_PERIODS;
  var MealPeriodHeader = Components.MealPeriodHeader;

  // ─── Calorie Ring SVG Component ──────────────────────────────────────────
  function CalorieRing(props) {
    var consumed = props.consumed;
    var target = props.target;
    var remaining = Math.max(0, target - consumed);
    var pct = target > 0 ? Math.min(consumed / target, 1) : 0;
    var overPct = consumed > target ? Math.min((consumed - target) / target, 0.5) : 0;
    var r = 58;
    var circ = 2 * Math.PI * r;
    var offset = circ * (1 - pct);

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
    var label = props.label;
    var current = props.current;
    var target = props.target;
    var color = props.color;
    var pct = target > 0 ? Math.min(100, (current / target) * 100) : 0;

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
    var grade = props.grade;
    if (!grade || !NUTRI_SCORE_COLORS[grade]) return null;
    return (
      <span className="nutri-score-badge" style={{ background: NUTRI_SCORE_COLORS[grade] }}>
        {grade}
      </span>
    );
  }

  // ─── Food Result Card ───────────────────────────────────────────────────
  function FoodResultCard(props) {
    var item = props.item;
    var onSelect = props.onSelect;
    var index = props.index;

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
    var rest = props.restaurant;
    var onSelect = props.onSelect;
    var index = props.index;
    var chain = rest.chainMatch;
    var chainData = chain ? FF_RESTAURANTS.find(function(r) { return r.id === chain; }) : null;

    return (
      <div className={"nearby-restaurant-card fade-in" + (chain ? " is-chain" : "")} style={{ animationDelay: (index * 50) + "ms" }} onClick={function() { if (chain) onSelect(chain); }}>
        <div className="nearby-restaurant-icon" style={chainData ? { background: chainData.color + "22", borderColor: chainData.color + "44" } : {}}>
          {chainData ? chainData.icon : (rest.amenity === "fast_food" ? "🍔" : "🍽️")}
        </div>
        <div className="nearby-restaurant-info">
          <div className="nearby-restaurant-name">{rest.name}</div>
          <div className="nearby-restaurant-meta">
            <span className="nearby-restaurant-distance">📍 {rest.distanceLabel}</span>
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
    var count = props.count || 4;
    var items = [];
    for (var i = 0; i < count; i++) items.push(i);
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

  function EatsTab(props) {
    var intake = props.intake, targets = props.targets;
    var mealLog = props.mealLog;
    var addSearchFood = props.addSearchFood;
    var addFF = props.addFF;
    var mealForm = props.mealForm, setMealForm = props.setMealForm, addMeal = props.addMeal;
    var removeMeal = props.removeMeal;
    var moveMealToPeriod = props.moveMealToPeriod;
    var setActiveMealPeriod = props.setActiveMealPeriod;
    var reAddFood = props.reAddFood;

    // ── Local State ────────────────────────────────────────────────────
    var _em = useState("recent");  var eatsMode = _em[0], setEatsMode = _em[1];
    var _ep = useState(getMealPeriod()); var expandedPeriod = _ep[0], setExpandedPeriod = _ep[1];

    // Search state
    var _sq = useState("");       var searchQuery = _sq[0], setSearchQuery = _sq[1];
    var _sr = useState([]);       var searchResults = _sr[0], setSearchResults = _sr[1];
    var _sl = useState(false);    var searchLoading = _sl[0], setSearchLoading = _sl[1];
    var _se = useState("");       var searchError = _se[0], setSearchError = _se[1];
    var _sc = useState(0);        var searchCount = _sc[0], setSearchCount = _sc[1];

    // Nearby state
    var _nr = useState([]);       var nearbyRestaurants = _nr[0], setNearbyRestaurants = _nr[1];
    var _nl = useState(false);    var nearbyLoading = _nl[0], setNearbyLoading = _nl[1];
    var _ne = useState("");       var nearbyError = _ne[0], setNearbyError = _ne[1];
    var _nf = useState(false);    var nearbyFetched = _nf[0], setNearbyFetched = _nf[1];

    // Chain detail view
    var _cd = useState(null);     var chainDetail = _cd[0], setChainDetail = _cd[1];
    var _cs = useState("");       var chainSearch = _cs[0], setChainSearch = _cs[1];
    var _cc = useState("All");    var chainCat = _cc[0], setChainCat = _cc[1];

    // Recent foods from mealLog — unique foods user has logged, for quick re-add
    var recentFoods = useMemo(function() {
      var seen = {};
      return mealLog.slice().reverse().filter(function(m) {
        if (seen[m.name]) return false;
        seen[m.name] = true;
        return true;
      }).slice(0, 20);
    }, [mealLog]);

    // ── Search handler ─────────────────────────────────────────────────
    var doSearch = useCallback(function() {
      if (!searchQuery.trim()) return;
      setSearchLoading(true);
      setSearchError("");
      setSearchResults([]);

      searchOpenFoodFacts(searchQuery, 15)
        .then(function(result) {
          setSearchResults(result.foods);
          setSearchCount(result.count);
          if (result.foods.length === 0) {
            setSearchError("No results found. Try a different search.");
          }
        })
        .catch(function(err) {
          setSearchError("Could not reach Open Food Facts. Please try again.");
        })
        .finally(function() {
          setSearchLoading(false);
        });
    }, [searchQuery]);

    // ── Nearby fetch ───────────────────────────────────────────────────
    var fetchNearby = useCallback(function() {
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

    // Auto-fetch nearby when tab switches to nearby
    useEffect(function() {
      if (eatsMode === "nearby" && !nearbyFetched && !nearbyLoading) {
        fetchNearby();
      }
    }, [eatsMode]);

    // ── Add food from search → opens portion modal ─────────────────────
    var handleAddSearchFood = function(item) {
      addSearchFood(item);
    };

    var handleAddFF = function(item) {
      addFF(item, chainDetail);
    };

    // ── Add food button from meal period → switch to search ────────────
    var handleAddFoodFromPeriod = function(periodId) {
      setActiveMealPeriod(periodId);
      setEatsMode("search");
    };

    // ── Chain detail items ─────────────────────────────────────────────
    var chainItems = useMemo(function() {
      if (!chainDetail || !FF_MENU[chainDetail]) return [];
      var items = FF_MENU[chainDetail].items;
      if (chainCat !== "All") items = items.filter(function(i) { return i.cat === chainCat; });
      if (chainSearch.trim()) items = items.filter(function(i) { return i.name.toLowerCase().includes(chainSearch.toLowerCase()); });
      return items;
    }, [chainDetail, chainCat, chainSearch]);

    var chainData = chainDetail ? FF_RESTAURANTS.find(function(r) { return r.id === chainDetail; }) : null;
    var chainMenu = chainDetail ? FF_MENU[chainDetail] : null;

    // ── Separate nearby into chains vs local ───────────────────────────
    var nearbyChains = useMemo(function() {
      return nearbyRestaurants.filter(function(r) { return r.chainMatch; });
    }, [nearbyRestaurants]);

    var nearbyLocal = useMemo(function() {
      return nearbyRestaurants.filter(function(r) { return !r.chainMatch; });
    }, [nearbyRestaurants]);

    // ═════════════════════════════════════════════════════════════════
    // ─── RENDER ──────────────────────────────────────────────────────
    // ═════════════════════════════════════════════════════════════════

    return (
      <div className="eats-tab fade-in">

        {/* ─── Daily Summary ─────────────────────────────────────────── */}
        <div className="eats-daily-summary">
          <CalorieRing consumed={intake.calories} target={targets.calories} />
          <div className="eats-macros-summary">
            <MacroBar label="Protein" current={intake.protein} target={targets.protein} color="var(--blue)" />
            <MacroBar label="Carbs" current={intake.carbs} target={targets.carbs} color="var(--yellow)" />
            <MacroBar label="Fat" current={intake.fats} target={targets.fats} color="var(--purple)" />
          </div>
        </div>

        {/* ─── Meal Periods ──────────────────────────────────────────── */}
        <MealPeriodHeader
          mealLog={mealLog}
          expandedPeriod={expandedPeriod}
          setExpandedPeriod={setExpandedPeriod}
          removeMeal={removeMeal}
          moveMealToPeriod={moveMealToPeriod}
          onAddFood={handleAddFoodFromPeriod}
        />

        {/* ─── Segmented Tab Control ─────────────────────────────────── */}
        <div className="eats-segmented-control">
          {[
            { id: "recent",  label: "Recent",  icon: "🕐" },
            { id: "search",  label: "Search",  icon: "🔍" },
            { id: "nearby",  label: "Nearby",  icon: "📍" },
            { id: "manual",  label: "Manual",  icon: "✏️" }
          ].map(function(t) {
            return (
              <button key={t.id}
                className={"eats-seg-btn" + (eatsMode === t.id ? " active" : "")}
                onClick={function() { setEatsMode(t.id); if (t.id !== "nearby") { setChainDetail(null); } }}
              >
                <span className="eats-seg-icon">{t.icon}</span>
                <span className="eats-seg-label">{t.label}</span>
              </button>
            );
          })}
        </div>

        {/* ─── RECENT EATS MODE ─────────────────────────────────────── */}
        {eatsMode === "recent" && (
          <div className="eats-recent-section fade-in">
            {recentFoods.length === 0 ? (
              <div className="eats-empty-state">
                <div className="eats-empty-icon">🕐</div>
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

        {/* ─── SEARCH MODE ───────────────────────────────────────────── */}
        {eatsMode === "search" && (
          <div className="eats-search-section fade-in">
            {/* Search Bar */}
            <div className="eats-search-bar">
              <div className="eats-search-input-wrap">
                <span className="eats-search-icon">🔍</span>
                <input
                  className="eats-search-input"
                  placeholder='Search 2.5M+ foods...'
                  value={searchQuery}
                  onChange={function(e) { setSearchQuery(e.target.value); }}
                  onKeyDown={function(e) { if (e.key === "Enter") doSearch(); }}
                />
                {searchQuery && (
                  <button className="eats-search-clear" onClick={function() { setSearchQuery(""); setSearchResults([]); setSearchError(""); }}>×</button>
                )}
              </div>
              <button className="eats-search-btn" onClick={doSearch} disabled={searchLoading || !searchQuery.trim()}>
                {searchLoading ? "..." : "Search"}
              </button>
            </div>

            {/* Source badge */}
            <div className="eats-search-source">
              <span className="eats-source-badge off">Open Food Facts</span>
              <span className="eats-source-count">{searchCount > 0 ? searchCount.toLocaleString() + " matches" : "2.5M+ foods · Free & open-source"}</span>
            </div>

            {/* Error */}
            {searchError && <div className="eats-search-error">{searchError}</div>}

            {/* Results */}
            {searchResults.length > 0 && (
              <div className="eats-search-results">
                {searchResults.map(function(item, i) {
                  return <FoodResultCard key={i} item={item} onSelect={handleAddSearchFood} index={i} />;
                })}
              </div>
            )}

            {/* Loading */}
            {searchLoading && <SkeletonLoader count={4} />}

            {/* Empty state — popular & recent */}
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

        {/* ─── NEARBY MODE ───────────────────────────────────────────── */}
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
                <div className="eats-nearby-error-icon">📍</div>
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
                      💡 Tip: Search for dishes from local restaurants in the Search tab for nutrition info.
                    </div>
                  </div>
                )}

                {/* Browse all chains fallback */}
                <div className="eats-nearby-group">
                  <div className="eats-section-label">
                    <span>All Chain Menus</span>
                  </div>
                  <div className="eats-all-chains">
                    {FF_RESTAURANTS.map(function(r) {
                      var isNearby = nearbyChains.some(function(nc) { return nc.chainMatch === r.id; });
                      return (
                        <button key={r.id} className={"eats-chain-pill" + (isNearby ? " nearby" : "")}
                          onClick={function() { setChainDetail(r.id); setChainCat("All"); setChainSearch(""); }}
                          style={{ borderColor: isNearby ? r.color : undefined }}
                        >
                          <span>{r.icon}</span>
                          <span>{r.name}</span>
                          {isNearby && <span className="eats-chain-nearby-dot" style={{ background: r.color }} />}
                        </button>
                      );
                    })}
                  </div>
                </div>
              </div>
            )}

            {/* If geolocation wasn't fetched yet and no loading/error, show all chains */}
            {!nearbyLoading && !nearbyError && !nearbyFetched && (
              <div className="eats-nearby-group">
                <div className="eats-section-label">Browse Chain Menus</div>
                <div className="eats-all-chains">
                  {FF_RESTAURANTS.map(function(r) {
                    return (
                      <button key={r.id} className="eats-chain-pill"
                        onClick={function() { setChainDetail(r.id); setChainCat("All"); setChainSearch(""); }}
                      >
                        <span>{r.icon}</span>
                        <span>{r.name}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        )}

        {/* ─── CHAIN DETAIL VIEW ─────────────────────────────────────── */}
        {eatsMode === "nearby" && chainDetail && chainData && (
          <div className="eats-chain-detail fade-in">
            {/* Back button */}
            <button className="eats-chain-back" onClick={function() { setChainDetail(null); }}>
              ← Back to Nearby
            </button>

            {/* Chain header */}
            <div className="eats-chain-header" style={{ borderColor: chainData.color + "44" }}>
              <span className="eats-chain-header-icon" style={{ background: chainData.color + "22" }}>{chainData.icon}</span>
              <div>
                <div className="eats-chain-header-name">{chainData.name}</div>
                <div className="eats-chain-header-count">{chainMenu ? chainMenu.items.length : 0} items</div>
              </div>
            </div>

            {/* Search within chain */}
            <div className="eats-chain-search-wrap">
              <span className="eats-search-icon">🔍</span>
              <input
                className="eats-chain-search"
                placeholder={"Search " + chainData.name + "..."}
                value={chainSearch}
                onChange={function(e) { setChainSearch(e.target.value); }}
              />
            </div>

            {/* Category chips */}
            <div className="eats-chain-categories">
              <button className={"eats-cat-chip" + (chainCat === "All" ? " active" : "")} onClick={function() { setChainCat("All"); }}>All</button>
              {chainMenu && chainMenu.categories.map(function(c) {
                return <button key={c} className={"eats-cat-chip" + (chainCat === c ? " active" : "")} onClick={function() { setChainCat(c); }} style={chainCat === c ? { borderColor: chainData.color, color: chainData.color, background: chainData.color + "15" } : {}}>{c}</button>;
              })}
            </div>

            {/* Menu items */}
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

        {/* ─── MANUAL MODE ───────────────────────────────────────────── */}
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

            <button className="btn btn-primary" onClick={addMeal} style={{ marginTop: 16 }}>+ Log Meal</button>
          </div>
        )}

      </div>
    );
  }

  Screens.EatsTab = EatsTab;

})(window.PhysIQ.Screens, window.PhysIQ.Data, window.PhysIQ.Utils, window.PhysIQ.Components);
