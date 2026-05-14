/* ─── PHYSIQ ENGINE — Toast Event Bus ─────────────────────────────────────
 *
 * Tiny pub-sub for non-blocking notifications. Non-React modules (notably
 * the storage layer) emit messages here; the React app subscribes once at
 * mount and routes payloads into its existing toast UI. Pure JS, no DOM,
 * no globals — safe to import from anywhere.
 * ───────────────────────────────────────────────────────────────────── */

const listeners = new Set();

export function emitToast(message, options) {
  const payload = {
    message: String(message || ""),
    type: (options && options.type) || "info",
    ts: Date.now()
  };
  listeners.forEach(function(fn) {
    try { fn(payload); } catch (e) {}
  });
}

export function subscribeToast(listener) {
  if (typeof listener !== "function") return function() {};
  listeners.add(listener);
  return function() { listeners.delete(listener); };
}
