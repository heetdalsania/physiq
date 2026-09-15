/* ─── PHYSIQ ENGINE — Storage Utilities ──────────────────────────────────
 *
 * Hardened layer on top of localStorage:
 *
 *   - Safe parse: corrupted JSON falls back to the caller's default and
 *     surfaces a toast (never white-screens the app). The unreadable raw
 *     value is LEFT ON DISK rather than deleted — reads are strictly
 *     read-only. App.js persistence effects DO write a fallback back over
 *     a bad value on the next mount, so the profile-load paths call
 *     quarantineProfile() first to copy anything unreadable to
 *     `<key>__corrupt`. Between the two, a bad parse never destroys data.
 *   - Quota guard: QuotaExceededError prunes the oldest history entry,
 *     retries once, then toasts on persistent failure.
 *   - Schema versioning: a global `pq_schema_version` sentinel tracks the
 *     storage layer's version. runMigrations() walks MIGRATIONS in order,
 *     committing the version after each step that actually succeeds, so a
 *     failed write never leaves a falsely advanced version behind. Values
 *     stay in their existing on-disk shape (no envelope) so direct call
 *     sites that do `JSON.parse(localStorage.getItem(...))` continue to
 *     work, and unversioned (pre-v1) data stays readable as-is.
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
export const SCHEMA_KEY = "pq_schema_version";

// Keys already reported as unreadable this session. Without this a
// corrupted value would re-toast on every single read; with it the user
// is told once and the raw value stays put for a later export/repair.
const corruptWarned = new Set();

/* Keys whose stored value could not be parsed at load time, mapped to the
   serialized fallback the app substituted in memory.

   The problem this solves: App.js persistence effects fire on mount and
   write the current in-memory value back. For a key whose read just
   failed, that value IS the fallback — so merely opening the app would
   overwrite the malformed bytes with an empty object. A protected key
   therefore refuses exactly one payload: the registered fallback. Any
   other payload is a genuine user edit, which releases the protection and
   writes through normally. */
const writeProtected = new Map();

// Test seams: let the suite drive these registries without reaching into
// module state.
export function _resetCorruptWarnings() {
  corruptWarned.clear();
}

export function _resetProtections() {
  writeProtected.clear();
}

/* Whether a key is currently refusing its passive write-back. */
export function isWriteProtected(key) {
  return writeProtected.has(key);
}

// ── new public API ──────────────────────────────────────────────────────

export function get(key, defaultValue) {
  let raw = null;
  try { raw = localStorage.getItem(key); } catch (e) {}
  if (raw == null) return defaultValue;
  try {
    const parsed = JSON.parse(raw);
    return parsed == null ? defaultValue : parsed;
  } catch (e) {
    // Do NOT delete: the raw value may still be salvageable by hand or via
    // Export Data. Fall back to the default and warn once per key.
    if (!corruptWarned.has(key)) {
      corruptWarned.add(key);
      emitToast("Storage entry could not be read — using defaults", { type: "warning" });
    }
    return defaultValue;
  }
}

/* Profile-scoped key suffixes this build owns. Used to sweep a profile for
   unreadable values at load time. */
export const PROFILE_KEY_SUFFIXES = [
  "profile", "intake", "meals", "history", "routines",
  "workoutLog", "weeklyMuscles", "setTargets", "recentFoods", "planDrafts"
];

export const CORRUPT_SUFFIX = "__corrupt";

/* Copies an unreadable raw value aside before anything can overwrite it.
 *
 * `get()` and the direct JSON.parse readers in App.js both fall back to a
 * default when a value will not parse — and App.js then persists that
 * default back over the bad value on the next render. Without this the
 * original bytes would be gone for good. With it they survive under
 * `<key>__corrupt`, where Export Data will pick them up.
 *
 * Idempotent: keeps the FIRST copy, never overwrites an existing
 * quarantine, and does nothing at all when the value parses fine. */
export function quarantineCorrupt(key) {
  if (!key || key.indexOf(CORRUPT_SUFFIX) >= 0) return false;
  let raw = null;
  try { raw = localStorage.getItem(key); } catch (e) { return false; }
  if (raw == null) return false;
  try { JSON.parse(raw); return false; } catch (e) {}   // parses fine → nothing to do

  const sidecar = key + CORRUPT_SUFFIX;
  try {
    if (localStorage.getItem(sidecar) != null) return false;
    localStorage.setItem(sidecar, raw);
    return true;
  } catch (e) { return false; }
}

/* Sweeps one profile's keys at load time and does two things for every
   value that will not parse:
 *
 *   1. copies the raw bytes to `<key>__corrupt` (recovery sidecar);
 *   2. write-protects the key against the passive mount-time write-back,
 *      so the ORIGINAL bytes stay in place at the original key.
 *
 * `passiveFallbacks` maps a key suffix to the value App.js substitutes in
 * memory when that key's read fails. Only suffixes present in the map are
 * write-protected — a suffix the app never passively re-writes needs no
 * protection, and protecting it would suppress a legitimate first write.
 * `profile` is deliberately absent for exactly that reason: a malformed
 * profile makes loadUser() return null, the app routes to onboarding, and
 * the next write is the user explicitly creating a profile.
 *
 * Called from both profile-load paths, before React's persistence effects
 * can run. Idempotent: re-running clears this profile's protections and
 * re-derives them, so repeated initialization converges. Only ever touches
 * the given profile's namespace. Returns the keys it rescued. */
export function quarantineProfile(email, passiveFallbacks) {
  const rescued = [];
  if (!email) return rescued;
  const fallbacks = passiveFallbacks || {};

  PROFILE_KEY_SUFFIXES.forEach(function (suffix) {
    const key = uKey(email, suffix);
    writeProtected.delete(key);

    let raw = null;
    try { raw = localStorage.getItem(key); } catch (e) { return; }
    if (raw == null) return;
    try { JSON.parse(raw); return; } catch (e) {}   // readable → nothing to do

    quarantineCorrupt(key);
    rescued.push(key);

    if (Object.prototype.hasOwnProperty.call(fallbacks, suffix)) {
      try {
        writeProtected.set(key, JSON.stringify(fallbacks[suffix]));
      } catch (e) {}
    }
  });

  if (rescued.length > 0) {
    emitToast("Some saved data could not be read — the original was kept", { type: "warning" });
  }
  return rescued;
}

/* Read-only view of the on-disk schema version. Never writes, so tests and
   diagnostics can inspect storage without mutating it. Returns 0 for
   unversioned (pre-v1) or unreadable sentinels. */
export function readSchemaVersion() {
  let raw = null;
  try { raw = localStorage.getItem(SCHEMA_KEY); } catch (e) { return 0; }
  const n = parseInt(raw, 10);
  return isNaN(n) || n < 0 ? 0 : n;
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

/* Persists `value` under `key`.
 *
 * Returns true when the key holds the requested value afterwards. For a
 * write-protected key that includes the deliberate no-op: the caller asked
 * to store the same fallback the failed read produced, and storage is left
 * exactly as it was. Callers treat false as "could not store", so a
 * suppressed passive write must not report failure. */
export function set(key, value) {
  let payload;
  try { payload = JSON.stringify(value); } catch (e) { return false; }

  if (writeProtected.has(key)) {
    // Passive write-back of the substituted fallback — leave the malformed
    // bytes alone.
    if (payload === writeProtected.get(key)) return true;
    // Anything else is a real change the user made. Release and write.
    writeProtected.delete(key);
  }

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

/* remove(), but never discards a value that cannot be parsed. Used by the
   day rollover so routine housekeeping cannot silently delete malformed
   data the user might still want to recover. */
export function removeIfReadable(key) {
  let raw = null;
  try { raw = localStorage.getItem(key); } catch (e) { return false; }
  if (raw == null) return true;
  try { JSON.parse(raw); } catch (e) { return false; }
  remove(key);
  return true;
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
    if (k.indexOf("pq_") !== 0 || k === SCHEMA_KEY) return;
    try {
      localStorage.setItem(k, String(data[k]));
      count++;
    } catch (e) {}
  });
  // Stamp the version the imported DATA was written at, not this build's —
  // then let the normal runner replay whatever steps that data still owes.
  // Stamping SCHEMA_VERSION directly would skip them.
  try { localStorage.setItem(SCHEMA_KEY, String(json.schemaVersion)); } catch (e) {}
  runMigrations();
  emitToast("Imported " + count + " entries", { type: "info" });
  return true;
}

/* ── Migrations ──────────────────────────────────────────────────────────
 *
 * Ordered, append-only list. Each step upgrades storage FROM `to - 1` TO
 * `to` and must be:
 *
 *   - idempotent   — safe to run twice on the same data;
 *   - additive     — never delete or rewrite keys it does not own, and
 *                    never drop unknown fields inside the keys it does;
 *   - throwing     — throw (or return false) on failure, so the runner can
 *                    stop WITHOUT stamping the new version.
 *
 * To add v2: append `{ to: 2, describe: "...", run: function () { ... } }`
 * and bump SCHEMA_VERSION to 2. The runner replays only the steps whose
 * `to` is above the on-disk version, so an install sitting at v1 runs just
 * the v2 step, and a fresh install runs v1 then v2 in order.
 *
 * Pre-v1 data is unversioned and was written in exactly the shape the app
 * reads today, so the v1 step is a pure stamp with no transform.
 * ──────────────────────────────────────────────────────────────────────── */

export const MIGRATIONS = [
  {
    to: 1,
    describe: "Stamp the baseline version. Values are already in v1 shape.",
    run: function () { return true; }
  }
];

/* Walks the pending migrations in order and commits the version after each
   step that succeeds. Returns a report (never throws) so callers and tests
   can see what happened:

     { from, to, applied: [n...], ok: boolean, error: string|null }

   Guarantees:
     - Idempotent: a second call with no pending steps is a no-op.
     - No downgrade: an on-disk version ABOVE SCHEMA_VERSION (data written
       by a newer build) is left untouched and reported as ok.
     - No false advance: if a step throws, or the version write itself
       fails, the runner stops and the on-disk version stays at the last
       step that genuinely completed. */
export function runMigrations() {
  const from = readSchemaVersion();
  const report = { from: from, to: from, applied: [], ok: true, error: null };

  if (from > SCHEMA_VERSION) {
    // Newer data than this build understands. Do not touch it, and do not
    // roll the sentinel backwards.
    report.error = "storage version " + from + " is newer than app version " + SCHEMA_VERSION;
    return report;
  }
  if (from === SCHEMA_VERSION) return report;

  for (let i = 0; i < MIGRATIONS.length; i++) {
    const step = MIGRATIONS[i];
    if (step.to <= from || step.to > SCHEMA_VERSION) continue;

    try {
      if (step.run() === false) throw new Error("migration step returned false");
    } catch (e) {
      report.ok = false;
      report.error = "migration to v" + step.to + " failed: " + (e && e.message ? e.message : e);
      emitToast("Storage upgrade incomplete — your data is unchanged", { type: "error" });
      return report;
    }

    // Commit this step before attempting the next one. If the sentinel
    // write fails the data transform already landed, but the version stays
    // put — so the next boot replays an idempotent step rather than
    // skipping a pending one.
    try {
      localStorage.setItem(SCHEMA_KEY, String(step.to));
    } catch (e) {
      report.ok = false;
      report.error = "could not record schema version " + step.to;
      return report;
    }

    report.applied.push(step.to);
    report.to = step.to;
  }

  return report;
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
      // Today's intake/meals are ephemeral by design, but only clear what
      // we could actually read — an unparseable value is left in place so
      // opening the app on a new day cannot destroy it.
      removeIfReadable(uKey(e, "intake"));
      removeIfReadable(uKey(e, "meals"));
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
