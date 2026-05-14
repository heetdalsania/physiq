/* ─── PHYSIQ ENGINE — Nearby Restaurants (Overpass/OSM) ───────────────────── */

import { FF_RESTAURANTS } from "../data/fastFoodMenu.js";
import { fetchWithTimeout, isOffline } from "./network.js";

export function getUserLocation() {
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
        const msgs = {
          1: "Location access denied. Enable location permissions to see nearby restaurants.",
          2: "Location unavailable. Please try again.",
          3: "Location request timed out. Please try again."
        };
        reject(new Error(msgs[err.code] || "Could not get location."));
      },
      { enableHighAccuracy: false, timeout: 10000, maximumAge: 300000 }
    );
  });
}

function haversine(lat1, lon1, lat2, lon2) {
  const R = 3959;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
            Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
            Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

export function matchChainRestaurant(name, brand) {
  if (!FF_RESTAURANTS) return null;
  const input = ((name || "") + " " + (brand || "")).toLowerCase().trim();
  if (!input) return null;

  for (let i = 0; i < FF_RESTAURANTS.length; i++) {
    const r = FF_RESTAURANTS[i];
    const aliases = r.aliases || [];
    for (let j = 0; j < aliases.length; j++) {
      if (input.indexOf(aliases[j]) !== -1) {
        return r.id;
      }
    }
  }
  return null;
}

export function fetchNearbyRestaurants(lat, lng, radiusMeters) {
  if (isOffline()) {
    return Promise.reject(new Error("Nearby restaurants requires internet connection."));
  }

  radiusMeters = radiusMeters || 2000;

  const cacheKey = "pq_nearby_" + lat.toFixed(3) + "_" + lng.toFixed(3) + "_" + radiusMeters;
  try {
    const cached = sessionStorage.getItem(cacheKey);
    if (cached) {
      const parsed = JSON.parse(cached);
      if (parsed.ts && Date.now() - parsed.ts < 600000) {
        return Promise.resolve(parsed.data);
      }
    }
  } catch (e) {}

  const query = '[out:json][timeout:15];(' +
    'node["amenity"~"restaurant|fast_food"]["name"](around:' + radiusMeters + ',' + lat + ',' + lng + ');' +
    'way["amenity"~"restaurant|fast_food"]["name"](around:' + radiusMeters + ',' + lat + ',' + lng + ');' +
    ');out center body;';

  return fetchWithTimeout("https://overpass-api.de/api/interpreter", 10000, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: "data=" + encodeURIComponent(query)
  })
    .then(function(res) {
      if (!res.ok) throw new Error("Overpass API error: " + res.status);
      return res.json();
    })
    .then(function(data) {
      const elements = data.elements || [];
      let restaurants = elements.map(function(el) {
        const tags = el.tags || {};
        const elLat = el.lat || (el.center && el.center.lat) || 0;
        const elLng = el.lon || (el.center && el.center.lon) || 0;
        const dist = haversine(lat, lng, elLat, elLng);

        return {
          name: tags.name || "Unknown Restaurant",
          cuisine: tags.cuisine || "",
          brand: tags.brand || "",
          amenity: tags.amenity || "restaurant",
          lat: elLat,
          lng: elLng,
          distance: dist,
          distanceLabel: dist < 0.1 ? Math.round(dist * 5280) + " ft" : dist.toFixed(1) + " mi",
          chainMatch: matchChainRestaurant(tags.name || "", tags.brand || "")
        };
      });

      restaurants.sort(function(a, b) { return a.distance - b.distance; });

      const seen = {};
      restaurants = restaurants.filter(function(r) {
        const key = r.name.toLowerCase().replace(/[^a-z0-9]/g, "");
        if (seen[key]) return false;
        seen[key] = true;
        return true;
      });

      try {
        sessionStorage.setItem(cacheKey, JSON.stringify({ ts: Date.now(), data: restaurants }));
      } catch (e) {}

      return restaurants;
    });
}
