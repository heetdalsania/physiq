/* ─── Tests — "YYYY-MM-DD" day keys are parsed in LOCAL time ──────────────
 *
 * `new Date("2026-03-31")` is defined as UTC midnight by the ECMAScript
 * date-only form, so in any negative-UTC offset it lands on the previous
 * local day. Every day key in Physiq — App.logWeight's weightLog entries,
 * getMondayKey's week starts, weeklyMuscles.dates, the dev date — is
 * written from a LOCAL date, so reading one back with `new Date(key)` shifts
 * it. That is what made the Profile tab show a weigh-in a day early.
 *
 * Run under several zones; the cases below are timezone-independent by
 * construction, and the guard at the bottom keeps `new Date(<key>)` from
 * creeping back into a display path.
 * ───────────────────────────────────────────────────────────────────────── */

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { parseDayKey, AppTime } from "../js/utils/appTime.js";
import { dayKey, getWeekStart } from "../js/utils/weeklyReport.js";

test("a day key round-trips through the local calendar unchanged", () => {
  ["2026-03-31", "2026-01-01", "2026-12-31", "2028-02-29", "2026-11-01", "2026-03-08"].forEach(key => {
    const d = parseDayKey(key);
    assert.equal(dayKey(d), key, key + " did not round-trip");
    assert.equal(d.getHours(), 0, "must be local midnight, not a shifted instant");
    assert.equal(d.getMinutes(), 0);
  });
});

test("parseDayKey names the same calendar day the key does, where new Date(key) can not", () => {
  const d = parseDayKey("2026-03-31");
  assert.equal(d.getFullYear(), 2026);
  assert.equal(d.getMonth(), 2);
  assert.equal(d.getDate(), 31);
  /* The bug, stated directly: west of Greenwich the UTC parse is the day
     before. East of it, or at UTC, the two agree — which is exactly why this
     went unnoticed until it was checked in America/Phoenix. */
  const utcParsed = new Date("2026-03-31");
  if (new Date(2026, 2, 31).getTimezoneOffset() > 0) {
    assert.notEqual(utcParsed.getDate(), d.getDate(), "expected the UTC parse to be off by a day in this zone");
  }
  assert.equal(parseDayKey("2026-03-31").getTime(), new Date(2026, 2, 31).getTime());
});

test("DST transition days are whole local days", () => {
  // US DST starts Mar 8 2026 and ends Nov 1 2026; neither day has a local midnight that moves.
  ["2026-03-08", "2026-11-01"].forEach(key => {
    const d = parseDayKey(key);
    assert.equal(dayKey(d), key);
    assert.equal(d.getHours(), 0);
  });
  // A week start parsed back from its own key is the same instant.
  const monday = getWeekStart(new Date(2026, 2, 11, 15));
  assert.equal(parseDayKey(dayKey(monday)).getTime(), monday.getTime());
});

test("malformed keys yield an Invalid Date rather than a wrong date or a throw", () => {
  [null, undefined, "", "2026-03", "2026/03/31", "bad", "Mon Mar 02 2026", 42, {}, "----"].forEach(bad => {
    const d = parseDayKey(bad);
    assert.equal(isNaN(d.getTime()), true, JSON.stringify(bad) + " should be an Invalid Date");
  });
  assert.doesNotThrow(() => parseDayKey(undefined));
});

test("AppTime's dev-date handling uses the same local parsing", () => {
  const key = AppTime.realTodayKey();
  assert.match(key, /^\d{4}-\d{2}-\d{2}$/);
  assert.equal(dayKey(parseDayKey(key)), key);
});

test("no display path turns a day key into a Date with new Date(key) (source guard)", () => {
  /* Matches a read of a value stored under a name a "YYYY-MM-DD" key uses.
     Deliberately narrow:
       - `new Date(someDate)` where the value is already a Date is a clone,
         and correct (weeklyReport passes Date objects named `weekStart`);
       - `new Date(k)` in MuscleTracker reads a `toDateString()` key such as
         "Tue Mar 31 2026", which JavaScript parses in LOCAL time — that
         format is not affected by this bug and must not be "fixed". Only
         the ISO date-only form is specified as UTC. */
  const files = [
    "js/screens/ProfileTab.js",
    "js/components/WeightCharts.js",
    "js/utils/weeklyReport.js"
  ];
  const DAY_KEY_READ = /new Date\(\s*(?:[A-Za-z_$][\w$]*(?:\[[^\]]*\])?\.(?:date|weekStart|localDate)|[A-Za-z_$][\w$]*Key)\s*\)/;
  files.forEach(file => {
    const src = readFileSync(new URL("../" + file, import.meta.url), "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
    const hit = src.match(DAY_KEY_READ);
    assert.equal(hit, null, file + " parses a day key with " + (hit && hit[0]) + " — use parseDayKey()");
  });
});

test("the toDateString format is NOT affected and is left alone", () => {
  /* weeklyMuscles session rows and the nutrition `history` array are keyed by
     Date.toDateString(). That form parses as LOCAL time, so reading it back
     with new Date() is correct — rewriting those call sites would be the
     actual regression. */
  const local = new Date(2026, 2, 31);
  const reparsed = new Date(local.toDateString());
  assert.equal(reparsed.getDate(), 31);
  assert.equal(reparsed.getTime(), local.getTime());
  assert.equal(isNaN(parseDayKey(local.toDateString()).getTime()), true,
    "parseDayKey is for ISO day keys only — it must not silently accept the other format");
});

test("weeklyReport no longer keeps a private copy of the parser", () => {
  const src = readFileSync(new URL("../js/utils/weeklyReport.js", import.meta.url), "utf8");
  assert.doesNotMatch(src, /function parseDayKey\s*\(/, "one definition only — import it");
  assert.match(src, /import \{ parseDayKey \} from "\.\/appTime\.js"/);
});
