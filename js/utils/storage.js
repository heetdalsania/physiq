/* ─── PHYSIQ ENGINE — Storage Utilities ───────────────────────────────────── */

window.PhysIQ = window.PhysIQ || {};
window.PhysIQ.Utils = window.PhysIQ.Utils || {};

(function(Utils, Data) {

  var EMPTY_INTAKE = Data.EMPTY_INTAKE;

  /** Generate a namespaced localStorage key for a user */
  function uKey(e, k) {
    return "pq_" + e + "_" + k;
  }

  /** Load a user's profile from localStorage */
  function loadUser(e) {
    try {
      return JSON.parse(localStorage.getItem(uKey(e, "profile"))) || null;
    } catch(err) {
      return null;
    }
  }

  /** Load today's daily intake & meal log (auto-resets on new day) */
  function loadDaily(e) {
    try {
      // Use AppTime so Dev Mode's overridden date drives daily rollover.
      var t = (Utils.AppTime ? Utils.AppTime.now() : new Date()).toDateString();
      var sd = localStorage.getItem(uKey(e, "date"));
      if (sd !== t) {
        localStorage.setItem(uKey(e, "date"), t);
        localStorage.removeItem(uKey(e, "intake"));
        localStorage.removeItem(uKey(e, "meals"));
        return { intake: Object.assign({}, EMPTY_INTAKE), meals: [] };
      }
      return {
        intake: JSON.parse(localStorage.getItem(uKey(e, "intake"))) || Object.assign({}, EMPTY_INTAKE),
        meals: JSON.parse(localStorage.getItem(uKey(e, "meals"))) || []
      };
    } catch(err) {
      return { intake: Object.assign({}, EMPTY_INTAKE), meals: [] };
    }
  }

  /** Load historical data (up to 90 days) */
  function loadHistory(e) {
    try {
      return JSON.parse(localStorage.getItem(uKey(e, "history"))) || [];
    } catch(err) {
      return [];
    }
  }

  /** Save history (capped at 90 entries) */
  function saveHistory(e, h) {
    try {
      localStorage.setItem(uKey(e, "history"), JSON.stringify(h.slice(-90)));
    } catch(err) {}
  }

  /** Generic save helper — stores JSON under a user-scoped key */
  function sv(e, k, v) {
    try {
      localStorage.setItem(uKey(e, k), JSON.stringify(v));
    } catch(err) {}
  }

  /** Load and apply saved theme preference */
  function loadTheme() {
    try {
      var s = localStorage.getItem("pq_theme");
      if (s) {
        document.body.setAttribute("data-theme", s);
        return s;
      }
    } catch(err) {}
    return "dark";
  }

  /** Get last used email for auto-fill */
  function getLastEmail() {
    try {
      return localStorage.getItem("pq_last_email") || "";
    } catch(err) {
      return "";
    }
  }

  // ─── Exports ────────────────────────────────────────────────────────────
  Utils.uKey = uKey;
  Utils.loadUser = loadUser;
  Utils.loadDaily = loadDaily;
  Utils.loadHistory = loadHistory;
  Utils.saveHistory = saveHistory;
  Utils.sv = sv;
  Utils.loadTheme = loadTheme;
  Utils.getLastEmail = getLastEmail;

})(window.PhysIQ.Utils, window.PhysIQ.Data);
