/* ─── Test helper — in-memory localStorage ────────────────────────────────
 *
 * Node has no localStorage. This stub implements the slice the storage
 * layer uses (getItem/setItem/removeItem/key/length/clear) on a plain Map,
 * plus two seams the suite needs:
 *
 *   failWritesFor(pred) — make setItem throw for matching keys, so the
 *                         "failed write" paths can be exercised.
 *   snapshot()          — plain-object copy, for asserting that a
 *                         supposedly read-only call mutated nothing.
 *
 * Every test installs a FRESH stub, so nothing here can reach a real
 * browser profile or leak between tests.
 * ───────────────────────────────────────────────────────────────────────── */

export function installLocalStorageStub(initial) {
  const store = new Map();
  if (initial) {
    Object.keys(initial).forEach(function (k) { store.set(k, String(initial[k])); });
  }

  let failPredicate = null;
  let failError = null;

  const stub = {
    get length() { return store.size; },
    key: function (i) {
      const keys = Array.from(store.keys());
      return i >= 0 && i < keys.length ? keys[i] : null;
    },
    getItem: function (k) { return store.has(String(k)) ? store.get(String(k)) : null; },
    setItem: function (k, v) {
      if (failPredicate && failPredicate(String(k))) throw failError;
      store.set(String(k), String(v));
    },
    removeItem: function (k) { store.delete(String(k)); },
    clear: function () { store.clear(); },

    // ── test seams ──
    failWritesFor: function (pred, err) {
      failPredicate = pred;
      failError = err || new Error("write blocked by test stub");
    },
    allowWrites: function () { failPredicate = null; failError = null; },
    snapshot: function () {
      const out = {};
      store.forEach(function (v, k) { out[k] = v; });
      return out;
    },
    rawSet: function (k, v) { store.set(String(k), String(v)); }
  };

  globalThis.localStorage = stub;
  return stub;
}

export function uninstallLocalStorageStub() {
  delete globalThis.localStorage;
}

/* A QuotaExceededError-shaped error (name is what storage.set branches on). */
export function quotaError() {
  const e = new Error("quota");
  e.name = "QuotaExceededError";
  return e;
}
