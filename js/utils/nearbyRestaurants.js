/* ─── PHYSIQ ENGINE — Nearby Restaurants (Overpass/OSM) ───────────────────── */

window.PhysIQ = window.PhysIQ || {};
window.PhysIQ.Utils = window.PhysIQ.Utils || {};

(function(Utils, Data) {

  /**
   * Get user's current location via browser Geolocation API
   * @returns {Promise<{lat: number, lng: number}>}
   */
  Utils.getUserLocation = function() {
    return new Promise(function(resolve, reject) {
      if (!navigator.geolocation) {
        reject(new Error("Geolocation is not supported by this browser."));
        return;
      }
      navigator.geolocation.getCurrentPosition(
        function(pos) {
          resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude });
        },
        function(err) {
          var msgs = {
            1: "Location access denied. Enable location permissions to see nearby restaurants.",
            2: "Location unavailable. Please try again.",
            3: "Location request timed out. Please try again."
          };
          reject(new Error(msgs[err.code] || "Could not get location."));
        },
        { enableHighAccuracy: false, timeout: 10000, maximumAge: 300000 }
      );
    });
  };

  /**
   * Fetch nearby restaurants from OpenStreetMap via Overpass API
   * @param {number} lat
   * @param {number} lng
   * @param {number} radiusMeters (default 2000)
   * @returns {Promise<Array>}
   */
  Utils.fetchNearbyRestaurants = function(lat, lng, radiusMeters) {
    radiusMeters = radiusMeters || 2000;

    // Check sessionStorage cache first
    var cacheKey = "pq_nearby_" + lat.toFixed(3) + "_" + lng.toFixed(3) + "_" + radiusMeters;
    try {
      var cached = sessionStorage.getItem(cacheKey);
      if (cached) {
        var parsed = JSON.parse(cached);
        if (parsed.ts && Date.now() - parsed.ts < 600000) { // 10 min cache
          return Promise.resolve(parsed.data);
        }
      }
    } catch(e) {}

    var query = '[out:json][timeout:15];(' +
      'node["amenity"~"restaurant|fast_food"]["name"](around:' + radiusMeters + ',' + lat + ',' + lng + ');' +
      'way["amenity"~"restaurant|fast_food"]["name"](around:' + radiusMeters + ',' + lat + ',' + lng + ');' +
      ');out center body;';

    return fetch("https://overpass-api.de/api/interpreter", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: "data=" + encodeURIComponent(query)
    })
    .then(function(res) {
      if (!res.ok) throw new Error("Overpass API error: " + res.status);
      return res.json();
    })
    .then(function(data) {
      var elements = data.elements || [];
      var restaurants = elements.map(function(el) {
        var tags = el.tags || {};
        var elLat = el.lat || (el.center && el.center.lat) || 0;
        var elLng = el.lon || (el.center && el.center.lon) || 0;
        var dist = Utils._haversine(lat, lng, elLat, elLng);

        return {
          name: tags.name || "Unknown Restaurant",
          cuisine: tags.cuisine || "",
          brand: tags.brand || "",
          amenity: tags.amenity || "restaurant",
          lat: elLat,
          lng: elLng,
          distance: dist,
          distanceLabel: dist < 0.1 ? Math.round(dist * 5280) + " ft" : dist.toFixed(1) + " mi",
          chainMatch: Utils.matchChainRestaurant(tags.name || "", tags.brand || "")
        };
      });

      // Sort by distance
      restaurants.sort(function(a, b) { return a.distance - b.distance; });

      // Deduplicate by name (keep closest)
      var seen = {};
      restaurants = restaurants.filter(function(r) {
        var key = r.name.toLowerCase().replace(/[^a-z0-9]/g, "");
        if (seen[key]) return false;
        seen[key] = true;
        return true;
      });

      // Cache the results
      try {
        sessionStorage.setItem(cacheKey, JSON.stringify({ ts: Date.now(), data: restaurants }));
      } catch(e) {}

      return restaurants;
    });
  };

  /**
   * Haversine distance in miles
   */
  Utils._haversine = function(lat1, lon1, lat2, lon2) {
    var R = 3959; // Earth radius in miles
    var dLat = (lat2 - lat1) * Math.PI / 180;
    var dLon = (lon2 - lon1) * Math.PI / 180;
    var a = Math.sin(dLat/2) * Math.sin(dLat/2) +
            Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
            Math.sin(dLon/2) * Math.sin(dLon/2);
    var c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
    return R * c;
  };

  /**
   * Match an OSM restaurant name/brand to our local chain database
   * Returns the chain id (e.g. "mcdonalds") or null
   */
  Utils.matchChainRestaurant = function(name, brand) {
    if (!Data || !Data.FF_RESTAURANTS) return null;
    var input = ((name || "") + " " + (brand || "")).toLowerCase().trim();
    if (!input) return null;

    for (var i = 0; i < Data.FF_RESTAURANTS.length; i++) {
      var r = Data.FF_RESTAURANTS[i];
      var aliases = r.aliases || [];
      for (var j = 0; j < aliases.length; j++) {
        if (input.indexOf(aliases[j]) !== -1) {
          return r.id;
        }
      }
    }
    return null;
  };

})(window.PhysIQ.Utils, window.PhysIQ.Data);
