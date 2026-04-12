/* ─── PHYSIQ ENGINE — Food Search (Open Food Facts) ──────────────────────── */

window.PhysIQ = window.PhysIQ || {};
window.PhysIQ.Utils = window.PhysIQ.Utils || {};

(function(Utils) {

  // ─── Helpers ────────────────────────────────────────────────────────────

  /** Check if a string is mostly Latin/English characters */
  function isEnglishText(str) {
    if (!str) return false;
    // Count Latin chars vs total non-space chars
    var latin = 0, total = 0;
    for (var i = 0; i < str.length; i++) {
      var c = str.charCodeAt(i);
      if (c > 32) { // skip whitespace
        total++;
        if ((c >= 65 && c <= 122) || (c >= 192 && c <= 687) || c === 45 || c === 39 || c === 38 || (c >= 48 && c <= 57)) {
          latin++;
        }
      }
    }
    return total === 0 || (latin / total) >= 0.7;
  }

  /** Simple relevance score: how well does the product name match the query? */
  function relevanceScore(name, query) {
    var n = name.toLowerCase();
    var q = query.toLowerCase().trim();
    var words = q.split(/\s+/);

    // Exact match
    if (n === q) return 100;
    // Starts with query
    if (n.indexOf(q) === 0) return 90;
    // Contains full query
    if (n.indexOf(q) !== -1) return 80;
    // All query words present
    var allPresent = words.every(function(w) { return n.indexOf(w) !== -1; });
    if (allPresent) return 70;
    // Some words present
    var count = words.filter(function(w) { return n.indexOf(w) !== -1; }).length;
    return Math.round((count / words.length) * 50);
  }

  /**
   * Search Open Food Facts for food products
   * Uses English/US filters, popularity sorting, and client-side quality filtering
   * @param {string} query - Search term
   * @param {number} pageSize - Number of results to fetch (default 40, filtered down)
   * @returns {Promise<{foods: Array, count: number}>}
   */
  Utils.searchOpenFoodFacts = function(query, pageSize) {
    if (!query || !query.trim()) return Promise.resolve({ foods: [], count: 0 });

    // Fetch extra to filter aggressively later
    var fetchSize = Math.max(pageSize || 40, 40);

    var url = "https://world.openfoodfacts.org/cgi/search.pl?" +
      "search_terms=" + encodeURIComponent(query.trim()) +
      "&json=1" +
      "&page_size=" + fetchSize +
      "&fields=product_name,nutriments,brands,image_small_url,serving_size,nutrition_grades,categories_tags,countries_tags,languages_tags,completeness,unique_scans_n" +
      "&search_simple=1" +
      "&action=process" +
      "&sort_by=unique_scans_n" +       // Sort by most-scanned (popularity)
      "&tagtype_0=languages" +           // Filter: product has English
      "&tag_contains_0=contains" +
      "&tag_0=en";

    return fetch(url)
    .then(function(res) {
      if (!res.ok) throw new Error("OFF API error: " + res.status);
      return res.json();
    })
    .then(function(data) {
      var products = (data.products || []);
      var q = query.trim();

      var foods = products
        // ─── Filter: must have name and nutrition data ─────────
        .filter(function(p) {
          if (!p.product_name || !p.nutriments) return false;

          // Must be English text
          if (!isEnglishText(p.product_name)) return false;

          // Must have at least calories
          var n = p.nutriments;
          var kcal = n["energy-kcal_100g"] || n["energy-kcal"] || 0;
          if (kcal <= 0) {
            // Try converting from kJ
            var kj = n["energy_100g"] || n["energy"] || 0;
            if (kj > 0) kcal = kj / 4.184;
          }
          if (kcal <= 0) return false;

          // Must have some relevance to the search query
          var score = relevanceScore(p.product_name, q);
          if (score < 30) return false;

          return true;
        })
        // ─── Map to clean objects ──────────────────────────────
        .map(function(p) {
          var n = p.nutriments || {};
          var kcal = n["energy-kcal_100g"] || n["energy-kcal"] || 0;
          if (kcal <= 0) {
            var kj = n["energy_100g"] || n["energy"] || 0;
            if (kj > 0) kcal = kj / 4.184;
          }

          return {
            name: p.product_name,
            brand: p.brands || "",
            image: p.image_small_url || "",
            nutriScore: (p.nutrition_grades || "").toUpperCase(),
            serving: p.serving_size || "100g",
            cal:       Math.round(kcal),
            protein:   Math.round((n["proteins_100g"] || n["proteins"] || 0) * 10) / 10,
            carbs:     Math.round((n["carbohydrates_100g"] || n["carbohydrates"] || 0) * 10) / 10,
            fats:      Math.round((n["fat_100g"] || n["fat"] || 0) * 10) / 10,
            fiber:     Math.round((n["fiber_100g"] || n["fiber"] || 0) * 10) / 10,
            sugar:     Math.round((n["sugars_100g"] || n["sugars"] || 0) * 10) / 10,
            sodium:    Math.round((n["sodium_100g"] || n["sodium"] || 0) * 1000),
            potassium: Math.round((n["potassium_100g"] || n["potassium"] || 0) * 1000),
            _relevance: relevanceScore(p.product_name, q),
            _scans: p.unique_scans_n || 0,
            source: "off"
          };
        })
        // ─── Sort: relevance first, then popularity ───────────
        .sort(function(a, b) {
          // Primary: relevance to query
          if (b._relevance !== a._relevance) return b._relevance - a._relevance;
          // Secondary: popularity (scan count)
          return (b._scans || 0) - (a._scans || 0);
        })
        // ─── Deduplicate by name ──────────────────────────────
        .filter(function(item) {
          var key = item.name.toLowerCase().replace(/[^a-z0-9]/g, "");
          if (Utils._searchSeen && Utils._searchSeen[key]) return false;
          if (!Utils._searchSeen) Utils._searchSeen = {};
          Utils._searchSeen[key] = true;
          return true;
        })
        // ─── Limit to best results ────────────────────────────
        .slice(0, 15);

      // Clean up temporary dedup map
      Utils._searchSeen = null;

      return { foods: foods, count: data.count || 0 };
    });
  };

  /**
   * Nutri-Score color mapping
   */
  Utils.NUTRI_SCORE_COLORS = {
    "A": "#038141",
    "B": "#85BB2F",
    "C": "#FECB02",
    "D": "#EE8100",
    "E": "#E63E11"
  };

  /**
   * Get meal period from current time
   */
  Utils.getMealPeriod = function() {
    var h = new Date().getHours();
    if (h < 11) return "breakfast";
    if (h < 15) return "lunch";
    if (h < 20) return "dinner";
    return "snacks";
  };

  /**
   * Meal period labels & icons
   */
  Utils.MEAL_PERIODS = [
    { id: "breakfast", label: "Breakfast", icon: "☀️", hours: "Before 11am" },
    { id: "lunch",     label: "Lunch",     icon: "🌤️", hours: "11am – 3pm" },
    { id: "dinner",    label: "Dinner",    icon: "🌙", hours: "3pm – 8pm" },
    { id: "snacks",    label: "Snacks",    icon: "🍿", hours: "Anytime" }
  ];

})(window.PhysIQ.Utils);
