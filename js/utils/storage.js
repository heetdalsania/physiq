/* ─── PHYSIQ ENGINE — Storage Utilities ──────────────────────────────────
 *
 * Hardened layer on top of localStorage:
 *
 *   - Safe parse: corrupted JSON resets the key to the caller's default
 *     and surfaces a toast (never white-screens the app).
 *   - Quota guard: QuotaExceededError prunes the oldest history entry,
 *     retries once, then toasts on persistent failure.
 *   - Schema versioning: a global `pq_schema_version` sentinel tracks the
 *     storage layer's version. runMigrations() bumps it on boot and is
 *     the future hook for any per-key transforms. Values stay in their
 *     existing on-disk shape (no envelope) so direct call sites that
 *     do `JSON.parse(localStorage.getItem(...))` continue to work.
 *   - Export / Import: full JSON snapshot of all pq_* keys, importable
 *     on the same or another device.
 *
 * Legacy helpers (uKey/loadUser/loadDaily/loadHistory/saveHistory/sv/
 * loadTheme/getLastEmail) are preserved unchanged at the call boundary —
 * they route through the new get/set internally where applicable.
 * ───────────────────────────────────────────────────────────────────── */

import { EMPTY_INTAKE } from "../data/constants.js";
import { AppTime } from "./appTime.js";
import { emitToast } from "./toast.js";

export const SCHEMA_VERSION = 1;
const SCHEMA_KEY = "pq_schema_version";

// ── new public API ──────────────────────────────────────────────────────

export function get(key, defaultValue) {
  let raw = null;
  try { raw = localStorage.getItem(key); } catch (e) {}
  if (raw == null) return defaultValue;
  try {
    const parsed = JSON.parse(raw);
    return parsed == null ? defaultValue : parsed;
  } catch (e) {
    try { localStorage.removeItem(key); } catch (err) {}
    emitToast("Storage entry was corrupted and reset", { type: "warning" });
    return defaultValue;
  }
}

function pruneOldestEntry() {
  // Find the longest pq_*_history array and drop its oldest item.
  let target = null;
  let targetLength = 0;
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (!k || k.indexOf("pq_") !== 0 || k.indexOf("_history") < 0) continue;
      let raw = null;
      try { raw = localStorage.getItem(k); } catch (err) {}
      if (!raw) continue;
      let parsed;
      try { parsed = JSON.parse(raw); } catch (err) { continue; }
      if (Array.isArray(parsed) && parsed.length > targetLength) {
        target = { key: k, arr: parsed };
        targetLength = parsed.length;
      }
    }
  } catch (e) {}
  if (!target || target.arr.length < 2) return false;
  const trimmed = target.arr.slice(1);
  try {
    localStorage.setItem(target.key, JSON.stringify(trimmed));
    return true;
  } catch (e) { return false; }
}

export function set(key, value) {
  let payload;
  try { payload = JSON.stringify(value); } catch (e) { return false; }
  try {
    localStorage.setItem(key, payload);
    return true;
  } catch (err) {
    if (err && err.name === "QuotaExceededError") {
      if (pruneOldestEntry()) {
        try {
          localStorage.setItem(key, payload);
          emitToast("Storage was full — pruned oldest history entry", { type: "warning" });
          return true;
        } catch (err2) {
          emitToast("Storage is full — try exporting and clearing data", { type: "error" });
          return false;
        }
      }
      emitToast("Storage is full — try exporting and clearing data", { type: "error" });
      return false;
    }
    return false;
  }
}

export function remove(key) {
  try { localStorage.removeItem(key); } catch (e) {}
}

export function getUsageBytes() {
  let total = 0;
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (!k || k.indexOf("pq_") !== 0) continue;
      const v = localStorage.getItem(k);
      // localStorage stores 16-bit chars → 2 bytes per char (approx).
      total += (k.length + (v ? v.length : 0)) * 2;
    }
  } catch (e) {}
  return total;
}

export function exportAll() {
  const data = {};
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (!k || k.indexOf("pq_") !== 0) continue;
      data[k] = localStorage.getItem(k);
    }
  } catch (e) {}
  return {
    schemaVersion: SCHEMA_VERSION,
    exportedAt: new Date().toISOString(),
    data: data
  };
}

export function importAll(json) {
  if (!json || typeof json !== "object") {
    emitToast("Import failed — invalid file", { type: "error" });
    return false;
  }
  if (typeof json.schemaVersion !== "number") {
    emitToast("Import failed — missing schema version", { type: "error" });
    return false;
  }
  if (json.schemaVersion > SCHEMA_VERSION) {
    emitToast("Import failed — newer schema version (" + json.schemaVersion + ")", { type: "error" });
    return false;
  }
  const data = json.data;
  if (!data || typeof data !== "object") {
    emitToast("Import failed — no data", { type: "error" });
    return false;
  }
  let count = 0;
  Object.keys(data).forEach(function(k) {
    if (k.indexOf("pq_") !== 0) return;
    try {
      localStorage.setItem(k, String(data[k]));
      count++;
    } catch (e) {}
  });
  try { localStorage.setItem(SCHEMA_KEY, String(SCHEMA_VERSION)); } catch (e) {}
  emitToast("Imported " + count + " entries", { type: "info" });
  return true;
}

export function runMigrations() {
  let current = 0;
  try { current = parseInt(localStorage.getItem(SCHEMA_KEY)) || 0; } catch (e) {}
  if (current >= SCHEMA_VERSION) return;
  // v0 → v1: stamp the schema version. No per-key transforms required at
  // this version. Future migrations can branch on `current` here.
  try { localStorage.setItem(SCHEMA_KEY, String(SCHEMA_VERSION)); } catch (e) {}
}

// ── Legacy / back-compat API ────────────────────────────────────────────

export function uKey(e, k) {
  return "pq_" + e + "_" + k;
}

export function loadUser(e) {
  return get(uKey(e, "profile"), null);
}

export function loadDaily(e) {
  try {
    const t = AppTime.now().toDateString();
    let sd = null;
    try { sd = localStorage.getItem(uKey(e, "date")); } catch (err) {}
    if (sd !== t) {
      try { localStorage.setItem(uKey(e, "date"), t); } catch (err) {}
      remove(uKey(e, "intake"));
      remove(uKey(e, "meals"));
      return { intake: Object.assign({}, EMPTY_INTAKE), meals: [] };
    }
    return {
      intake: get(uKey(e, "intake"), Object.assign({}, EMPTY_INTAKE)),
      meals: get(uKey(e, "meals"), [])
    };
  } catch (err) {
    return { intake: Object.assign({}, EMPTY_INTAKE), meals: [] };
  }
}

export function loadHistory(e) {
  const v = get(uKey(e, "history"), []);
  return Array.isArray(v) ? v : [];
}

export function saveHistory(e, h) {
  if (!Array.isArray(h)) return;
  set(uKey(e, "history"), h.slice(-90));
}

export function sv(e, k, v) {
  set(uKey(e, k), v);
}

export function loadTheme() {
  try {
    const s = localStorage.getItem("pq_theme");
    if (s) {
      document.body.setAttribute("data-theme", s);
      return s;
    }
  } catch (err) {}
  return "dark";
}

export function getLastEmail() {
  try {
    return localStorage.getItem("pq_last_email") || "";
  } catch (err) {
    return "";
  }
}
