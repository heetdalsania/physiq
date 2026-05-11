/* ─── PHYSIQ ENGINE — App Time / Dev Mode ────────────────────────────────── */
/* Centralized "now" provider. All date-dependent app logic that means
   "today" or "current moment" should use AppTime.now() / nowMs() instead
   of new Date() / Date.now(). When Dev Mode is OFF this returns the real
   system time. When Dev Mode is ON it returns a date built from the
   developer-chosen day combined with the real current time-of-day.

   Dev Mode is persisted in localStorage and survives reloads. */

const DEV_MODE_KEY = "pq_dev_mode";
const DEV_DATE_KEY = "pq_dev_date";

let devMode = false;
let devDate = null;

try { devMode = localStorage.getItem(DEV_MODE_KEY) === "1"; } catch (e) {}
try { devDate = localStorage.getItem(DEV_DATE_KEY) || null; } catch (e) {}

function pad(n) { return n < 10 ? "0" + n : "" + n; }
function toKey(d) {
  return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate());
}
function realTodayKey() { return toKey(new Date()); }
function parseKey(k) {
  const p = (k || realTodayKey()).split("-");
  return new Date(parseInt(p[0]), parseInt(p[1]) - 1, parseInt(p[2]));
}

function now() {
  if (devMode && devDate) {
    const parts = devDate.split("-");
    const r = new Date();
    return new Date(
      parseInt(parts[0]),
      parseInt(parts[1]) - 1,
      parseInt(parts[2]),
      r.getHours(), r.getMinutes(), r.getSeconds(), r.getMilliseconds()
    );
  }
  return new Date();
}

function nowMs() { return now().getTime(); }

function getDevMode() { return devMode; }
function getDevDate() { return devDate || realTodayKey(); }

function setDevMode(on) {
  devMode = !!on;
  try { localStorage.setItem(DEV_MODE_KEY, devMode ? "1" : "0"); } catch (e) {}
  if (devMode && !devDate) setDevDate(realTodayKey());
}

function setDevDate(key) {
  devDate = key || null;
  try {
    if (devDate) localStorage.setItem(DEV_DATE_KEY, devDate);
    else localStorage.removeItem(DEV_DATE_KEY);
  } catch (e) {}
}

function shiftDevDate(days) {
  const d = parseKey(getDevDate());
  d.setDate(d.getDate() + days);
  setDevDate(toKey(d));
}

export const AppTime = {
  now,
  nowMs,
  getDevMode,
  getDevDate,
  setDevMode,
  setDevDate,
  shiftDevDate,
  realTodayKey
};
