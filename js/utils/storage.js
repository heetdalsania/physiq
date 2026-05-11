/* ─── PHYSIQ ENGINE — Storage Utilities ───────────────────────────────────── */

import { EMPTY_INTAKE } from "../data/constants.js";
import { AppTime } from "./appTime.js";

export function uKey(e, k) {
  return "pq_" + e + "_" + k;
}

export function loadUser(e) {
  try {
    return JSON.parse(localStorage.getItem(uKey(e, "profile"))) || null;
  } catch (err) {
    return null;
  }
}

export function loadDaily(e) {
  try {
    const t = AppTime.now().toDateString();
    const sd = localStorage.getItem(uKey(e, "date"));
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
  } catch (err) {
    return { intake: Object.assign({}, EMPTY_INTAKE), meals: [] };
  }
}

export function loadHistory(e) {
  try {
    return JSON.parse(localStorage.getItem(uKey(e, "history"))) || [];
  } catch (err) {
    return [];
  }
}

export function saveHistory(e, h) {
  try {
    localStorage.setItem(uKey(e, "history"), JSON.stringify(h.slice(-90)));
  } catch (err) {}
}

export function sv(e, k, v) {
  try {
    localStorage.setItem(uKey(e, k), JSON.stringify(v));
  } catch (err) {}
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
