/* ─── PHYSIQ ENGINE — App Time / Dev Mode ────────────────────────────────── */
/* Centralized "now" provider. All date-dependent app logic that means
   "today" or "current moment" should use Utils.AppTime.now() / nowMs()
   instead of new Date() / Date.now(). When Dev Mode is OFF this returns
   the real system time. When Dev Mode is ON it returns a date built from
   the developer-chosen day combined with the real current time-of-day.

   Dev Mode is persisted in localStorage and survives reloads.

   This module is intentionally framework-free so it can be removed from
   index.html in production with a single line. */

window.PhysIQ = window.PhysIQ || {};
window.PhysIQ.Utils = window.PhysIQ.Utils || {};

(function(Utils) {

  var DEV_MODE_KEY = "pq_dev_mode";
  var DEV_DATE_KEY = "pq_dev_date";

  // Internal state — mutated only via the setters below.
  var devMode = false;
  var devDate = null; // "YYYY-MM-DD" or null

  try { devMode = localStorage.getItem(DEV_MODE_KEY) === "1"; } catch(e) {}
  try { devDate = localStorage.getItem(DEV_DATE_KEY) || null; } catch(e) {}

  function pad(n) { return n < 10 ? "0" + n : "" + n; }
  function toKey(d) {
    return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate());
  }
  function realTodayKey() { return toKey(new Date()); }
  function parseKey(k) {
    var p = (k || realTodayKey()).split("-");
    return new Date(parseInt(p[0]), parseInt(p[1]) - 1, parseInt(p[2]));
  }

  /** Current app date — overridden if Dev Mode is ON, real time otherwise. */
  function now() {
    if (devMode && devDate) {
      var parts = devDate.split("-");
      var r = new Date();
      return new Date(
        parseInt(parts[0]),
        parseInt(parts[1]) - 1,
        parseInt(parts[2]),
        r.getHours(), r.getMinutes(), r.getSeconds(), r.getMilliseconds()
      );
    }
    return new Date();
  }

  /** Milliseconds equivalent of now(). Use in place of Date.now() for any
      timestamp that should reflect "when this happened in the app's time". */
  function nowMs() { return now().getTime(); }

  function getDevMode() { return devMode; }
  function getDevDate() { return devDate || realTodayKey(); }

  function setDevMode(on) {
    devMode = !!on;
    try { localStorage.setItem(DEV_MODE_KEY, devMode ? "1" : "0"); } catch(e) {}
    // If turning ON for the first time, seed the override with real today
    // so the user has a sensible starting point.
    if (devMode && !devDate) setDevDate(realTodayKey());
  }

  function setDevDate(key) {
    devDate = key || null;
    try {
      if (devDate) localStorage.setItem(DEV_DATE_KEY, devDate);
      else localStorage.removeItem(DEV_DATE_KEY);
    } catch(e) {}
  }

  function shiftDevDate(days) {
    var d = parseKey(getDevDate());
    d.setDate(d.getDate() + days);
    setDevDate(toKey(d));
  }

  Utils.AppTime = {
    now: now,
    nowMs: nowMs,
    getDevMode: getDevMode,
    getDevDate: getDevDate,
    setDevMode: setDevMode,
    setDevDate: setDevDate,
    shiftDevDate: shiftDevDate,
    realTodayKey: realTodayKey
  };

})(window.PhysIQ.Utils);
