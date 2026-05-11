/* ─── PHYSIQ ENGINE — Food Search (Open Food Facts) ──────────────────────── */

let _searchSeen = null;

function isEnglishText(str) {
  if (!str) return false;
  let latin = 0, total = 0;
  for (let i = 0; i < str.length; i++) {
    const c = str.charCodeAt(i);
    if (c > 32) {
      total++;
      if ((c >= 65 && c <= 122) || (c >= 192 && c <= 687) || c === 45 || c === 39 || c === 38 || (c >= 48 && c <= 57)) {
        latin++;
      }
    }
  }
  return total === 0 || (latin / total) >= 0.7;
}

function relevanceScore(name, query) {
  const n = name.toLowerCase();
  const q = query.toLowerCase().trim();
  const words = q.split(/\s+/);

  if (n === q) return 100;
  if (n.indexOf(q) === 0) return 90;
  if (n.indexOf(q) !== -1) return 80;
  const allPresent = words.every(function(w) { return n.indexOf(w) !== -1; });
  if (allPresent) return 70;
  const count = words.filter(function(w) { return n.indexOf(w) !== -1; }).length;
  return Math.round((count / words.length) * 50);
}

export function searchOpenFoodFacts(query, pageSize) {
  if (!query || !query.trim()) return Promise.resolve({ foods: [], count: 0 });

  const fetchSize = Math.max(pageSize || 40, 40);

  const url = "https://world.openfoodfacts.org/cgi/search.pl?" +
    "search_terms=" + encodeURIComponent(query.trim()) +
    "&json=1" +
    "&page_size=" + fetchSize +
    "&fields=product_name,nutriments,brands,image_small_url,serving_size,serving_quantity,nutrition_grades,categories_tags,countries_tags,languages_tags,completeness,unique_scans_n" +
    "&search_simple=1" +
    "&action=process" +
    "&sort_by=unique_scans_n" +
    "&tagtype_0=languages" +
    "&tag_contains_0=contains" +
    "&tag_0=en";

  const attemptFetch = function(retries) {
    return fetch(url)
      .then(function(res) {
        if (!res.ok) {
          if (retries > 0) {
            return new Promise(function(resolve) { setTimeout(resolve, 500); })
              .then(function() { return attemptFetch(retries - 1); });
          }
          throw new Error("OFF API error: " + res.status);
        }
        return res.json();
      })
      .catch(function(err) {
        if (retries > 0) {
          return new Promise(function(resolve) { setTimeout(resolve, 500); })
            .then(function() { return attemptFetch(retries - 1); });
        }
        throw err;
      });
  };

  return attemptFetch(3).then(function(data) {
    const products = (data.products || []);
    const q = query.trim();

    const foods = products
      .filter(function(p) {
        if (!p.product_name || !p.nutriments) return false;
        if (!isEnglishText(p.product_name)) return false;

        const n = p.nutriments;
        let kcal = n["energy-kcal_serving"] || n["energy-kcal_100g"] || n["energy-kcal"] || 0;
        if (kcal <= 0) {
          const kj = n["energy_serving"] || n["energy_100g"] || n["energy"] || 0;
          if (kj > 0) kcal = kj / 4.184;
        }
        if (kcal <= 0) return false;

        const score = relevanceScore(p.product_name, q);
        if (score < 30) return false;

        return true;
      })
      .map(function(p) {
        const n = p.nutriments || {};

        const servQty = p.serving_quantity;
        const hasServing = servQty > 0 && (
          n["energy-kcal_serving"] != null ||
          n["proteins_serving"] != null ||
          n["carbohydrates_serving"] != null ||
          n["fat_serving"] != null
        );

        let kcal, protein, carbs, fats, fiber, sugar, sodium, potassium;

        if (hasServing) {
          kcal = n["energy-kcal_serving"] || 0;
          if (kcal <= 0) {
            const kjServ = n["energy_serving"] || 0;
            if (kjServ > 0) kcal = kjServ / 4.184;
          }
          protein   = n["proteins_serving"] || 0;
          carbs     = n["carbohydrates_serving"] || 0;
          fats      = n["fat_serving"] || 0;
          fiber     = n["fiber_serving"] || 0;
          sugar     = n["sugars_serving"] || 0;
          sodium    = n["sodium_serving"] || 0;
          potassium = n["potassium_serving"] || 0;
        } else {
          kcal = n["energy-kcal_100g"] || n["energy-kcal"] || 0;
          if (kcal <= 0) {
            const kj100 = n["energy_100g"] || n["energy"] || 0;
            if (kj100 > 0) kcal = kj100 / 4.184;
          }
          protein   = n["proteins_100g"] || n["proteins"] || 0;
          carbs     = n["carbohydrates_100g"] || n["carbohydrates"] || 0;
          fats      = n["fat_100g"] || n["fat"] || 0;
          fiber     = n["fiber_100g"] || n["fiber"] || 0;
          sugar     = n["sugars_100g"] || n["sugars"] || 0;
          sodium    = n["sodium_100g"] || n["sodium"] || 0;
          potassium = n["potassium_100g"] || n["potassium"] || 0;
        }

        return {
          name: p.product_name,
          brand: p.brands || "",
          image: p.image_small_url || "",
          nutriScore: (p.nutrition_grades || "").toUpperCase(),
          serving: p.serving_size || (hasServing ? "1 serving" : "100g"),
          cal:       Math.round(kcal),
          protein:   Math.round(protein * 10) / 10,
          carbs:     Math.round(carbs * 10) / 10,
          fats:      Math.round(fats * 10) / 10,
          fiber:     Math.round(fiber * 10) / 10,
          sugar:     Math.round(sugar * 10) / 10,
          sodium:    hasServing ? Math.round(sodium) : Math.round(sodium * 1000),
          potassium: hasServing ? Math.round(potassium) : Math.round(potassium * 1000),
          _relevance: relevanceScore(p.product_name, q),
          _scans: p.unique_scans_n || 0,
          _perServing: hasServing,
          _servingGrams: servQty || 0,
          source: "off"
        };
      })
      .sort(function(a, b) {
        if (b._relevance !== a._relevance) return b._relevance - a._relevance;
        return (b._scans || 0) - (a._scans || 0);
      })
      .filter(function(item) {
        const key = item.name.toLowerCase().replace(/[^a-z0-9]/g, "");
        if (_searchSeen && _searchSeen[key]) return false;
        if (!_searchSeen) _searchSeen = {};
        _searchSeen[key] = true;
        return true;
      })
      .slice(0, 15);

    _searchSeen = null;

    return { foods: foods, count: data.count || 0 };
  });
}

export const NUTRI_SCORE_COLORS = {
  "A": "#038141",
  "B": "#85BB2F",
  "C": "#FECB02",
  "D": "#EE8100",
  "E": "#E63E11"
};

export function getMealPeriod() {
  const h = new Date().getHours();
  if (h < 11) return "breakfast";
  if (h < 15) return "lunch";
  if (h < 20) return "dinner";
  return "snacks";
}

export const MEAL_PERIODS = [
  { id: "breakfast", label: "Breakfast", iconClass: "pq-icon-cup", hours: "Before 11am" },
  { id: "lunch",     label: "Lunch",     iconClass: "pq-icon-burger", hours: "11am – 3pm" },
  { id: "dinner",    label: "Dinner",    iconClass: "pq-icon-bowl", hours: "3pm – 8pm" },
  { id: "snacks",    label: "Snacks",    iconClass: "pq-icon-cookie", hours: "Anytime" }
];

export function lookupBarcode(barcode) {
  if (!barcode || !barcode.trim()) return Promise.resolve(null);

  const url = "https://world.openfoodfacts.org/api/v2/product/" +
    encodeURIComponent(barcode.trim()) +
    ".json?fields=product_name,nutriments,brands,image_small_url,image_url,serving_size,serving_quantity,nutrition_grades,categories_tags";

  const attemptFetch = function(retries) {
    return fetch(url)
      .then(function(res) {
        if (!res.ok) {
          if (retries > 0) {
            return new Promise(function(resolve) { setTimeout(resolve, 500); })
              .then(function() { return attemptFetch(retries - 1); });
          }
          throw new Error("OFF API error: " + res.status);
        }
        return res.json();
      })
      .catch(function(err) {
        if (retries > 0) {
          return new Promise(function(resolve) { setTimeout(resolve, 500); })
            .then(function() { return attemptFetch(retries - 1); });
        }
        throw err;
      });
  };

  return attemptFetch(3).then(function(data) {
    if (!data || data.status !== 1 || !data.product) return null;

    const p = data.product;
    if (!p.product_name || !p.nutriments) return null;

    const n = p.nutriments || {};

    const servQty = p.serving_quantity;
    const hasServing = servQty > 0 && (
      n["energy-kcal_serving"] != null ||
      n["proteins_serving"] != null ||
      n["carbohydrates_serving"] != null ||
      n["fat_serving"] != null
    );

    let kcal, protein, carbs, fats, fiber, sugar, sodium, potassium;

    if (hasServing) {
      kcal = n["energy-kcal_serving"] || 0;
      if (kcal <= 0) {
        const kjServ = n["energy_serving"] || 0;
        if (kjServ > 0) kcal = kjServ / 4.184;
      }
      protein   = n["proteins_serving"] || 0;
      carbs     = n["carbohydrates_serving"] || 0;
      fats      = n["fat_serving"] || 0;
      fiber     = n["fiber_serving"] || 0;
      sugar     = n["sugars_serving"] || 0;
      sodium    = n["sodium_serving"] || 0;
      potassium = n["potassium_serving"] || 0;
    } else {
      kcal = n["energy-kcal_100g"] || n["energy-kcal"] || 0;
      if (kcal <= 0) {
        const kj100 = n["energy_100g"] || n["energy"] || 0;
        if (kj100 > 0) kcal = kj100 / 4.184;
      }
      protein   = n["proteins_100g"] || n["proteins"] || 0;
      carbs     = n["carbohydrates_100g"] || n["carbohydrates"] || 0;
      fats      = n["fat_100g"] || n["fat"] || 0;
      fiber     = n["fiber_100g"] || n["fiber"] || 0;
      sugar     = n["sugars_100g"] || n["sugars"] || 0;
      sodium    = n["sodium_100g"] || n["sodium"] || 0;
      potassium = n["potassium_100g"] || n["potassium"] || 0;
    }

    return {
      name:      p.product_name,
      brand:     p.brands || "",
      image:     p.image_small_url || p.image_url || "",
      nutriScore: (p.nutrition_grades || "").toUpperCase(),
      serving:   p.serving_size || (hasServing ? "1 serving" : "100g"),
      cal:       Math.round(kcal),
      protein:   Math.round(protein * 10) / 10,
      carbs:     Math.round(carbs * 10) / 10,
      fats:      Math.round(fats * 10) / 10,
      fiber:     Math.round(fiber * 10) / 10,
      sugar:     Math.round(sugar * 10) / 10,
      sodium:    hasServing ? Math.round(sodium) : Math.round(sodium * 1000),
      potassium: hasServing ? Math.round(potassium) : Math.round(potassium * 1000),
      barcode:   barcode,
      source:    "off",
      _perServing: hasServing,
      _servingGrams: servQty || 0
    };
  });
}
