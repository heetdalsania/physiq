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

/* Parses a "YYYY-MM-DD" day key as a LOCAL calendar date.
 *
 * `new Date("2026-03-31")` must not be used for this. The ECMAScript
 * date-only form is defined as UTC, so in any negative-UTC offset it lands
 * on the previous local day — a weigh-in logged on Mar 31 in Phoenix
 * renders as "Mar 30". Passing the components separately builds the date in
 * local time, which is the frame every one of these keys was written in
 * (App.logWeight, getMondayKey, weeklyMuscles.dates, the dev date).
 *
 * Returns an Invalid Date for malformed or impossible calendar keys, so
 * callers can guard with isNaN(d.getTime()). Never throws. */
export function parseDayKey(key) {
  if (typeof key !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(key)) return new Date(NaN);
  const [y, m, d] = key.split("-").map(Number);
  const result = new Date(0);
  result.setFullYear(y, m - 1, d);
  result.setHours(0, 0, 0, 0);
  return result.getFullYear() === y && result.getMonth() === m - 1 && result.getDate() === d ? result : new Date(NaN);
}

function parseKey(k) {
  return parseDayKey(k || realTodayKey());
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
