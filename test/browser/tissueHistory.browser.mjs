/* Milestones 4-5 browser acceptance — longitudinal tissue load and
 * descriptive recovery guidance.
 *
 * Outside npm test's no-write glob. Uses Playwright when supplied by the
 * environment, a fresh context, never a real browser profile, and only the
 * two reserved synthetic @example.com profiles.
 *
 * Run: PLAYWRIGHT_MODULE=/absolute/path/to/playwright/index.mjs \
 *        node test/browser/tissueHistory.browser.mjs [dist-directory] [label]
 *
 * Fixture SETUP reads/writes localStorage through page.evaluate. Everything
 * a user would do — logging a weight, running a workout, switching profiles,
 * selecting a tissue — goes through real pointer/keyboard interaction.
 */
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { resolve, extname } from "node:path";
import { DEMO_PROFILE_A, DEMO_PROFILE_B, DEMO_INTAKE_A, DEMO_MEALS_A } from "../../js/dev/demoFixtures.js";

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || "playwright");
const root = resolve(process.argv[2] || "dist");
const label = process.argv[3] || "production";
const out = `/tmp/physiq-m4-browser-${label}`;
await mkdir(out, { recursive: true });

const server = createServer(async (req, res) => {
  try {
    const pathname = new URL(req.url, "http://localhost").pathname;
    const file = resolve(root, "." + (pathname === "/" ? "/index.html" : pathname));
    if (!file.startsWith(root + "/")) throw new Error("Path outside fixture server");
    res.setHeader("Content-Type", ({ ".html": "text/html", ".js": "text/javascript", ".css": "text/css" })[extname(file)] || "application/octet-stream");
    res.end(await readFile(file));
  } catch { res.statusCode = 404; res.end("Not found"); }
});
await new Promise(r => server.listen(0, "127.0.0.1", r));
const url = `http://127.0.0.1:${server.address().port}`;

const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROME_EXECUTABLE || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" });
const context = await browser.newContext({ viewport: { width: 375, height: 812 }, timezoneId: "America/Phoenix", locale: "en-US" });
const page = await context.newPage();
const errors = [], consoleErrors = [];
page.on("pageerror", e => errors.push(e.message));
page.on("console", m => { if (m.type() === "error") consoleErrors.push(m.text()); });
await context.route(/fonts\.googleapis\.com|fonts\.gstatic\.com/, r => r.fulfill({ status: 200, body: "" }));

/* Frozen "today" = Tue 31 Mar 2026, 12:00 America/Phoenix (no DST there, so
   the local calendar day is unambiguous for every fixture timestamp). */
await page.clock.install({ time: new Date("2026-03-31T12:00:00-07:00") });

const checks = [];
async function check(name, fn) { await fn(); checks.push(name); console.log("PASS", name); }
const A = "demo-a@example.com", B = "demo-b@example.com";

/* Local Phoenix instant for a 2026 date. dayOffset counts back from Mar 31. */
const D = new Date("2026-03-31T12:00:00-07:00");
const at = (offset, hour = 10) => {
  const d = new Date(Date.UTC(2026, 2, 31 + offset, hour + 7, 0, 0));   // Phoenix = UTC-7 year-round
  return d.getTime();
};
const setDone = (weight, reps) => ({ done: true, weight, reps });
const ex = (name, sets) => ({ name, muscle: "Chest", sets });
/* Barbell Bench Press has body-mass band `none`, so chest workload is exactly
   reps × weight × 1.0 — independent of body mass, which keeps the baseline
   arithmetic checkable by hand. Squat carries a body-mass band, so it is used
   for the frozen-weight checks. */
const bench = (chestWorkload, id, offset) => ({
  id, title: "Bench " + id, startedAt: at(offset, 9), finishedAt: at(offset),
  exercises: [ex("Barbell Bench Press", [setDone(chestWorkload / 10, 10)])]
});
const LONG_NAME = "Unmapped synthetic conditioning circuit with an exceptionally long descriptive name for narrow layouts";

/* Baseline period is [Mar 25 - 34 … Mar 31 - 7] = [Feb 25 … Mar 24].
   Four bench sessions of 1000 lb*rep each → baseline 4000 / 4 = 1000 per 7 days. */
const BASELINE_SESSIONS = [bench(1000, 601, -34), bench(1000, 602, -27), bench(1000, 603, -19), bench(1000, 604, -11)];
const historyWithRecent = (recentChest, extraExercises = []) => BASELINE_SESSIONS.concat([{
  id: 700, title: "Recent", startedAt: at(-1, 9), finishedAt: at(-1),
  exercises: [ex("Barbell Bench Press", [setDone(recentChest / 10, 10)])].concat(extraExercises)
}]);

const storage = () => page.evaluate(() => Object.fromEntries(Object.entries(localStorage).sort(([a], [b]) => a.localeCompare(b))));
const tissueHistoryOf = email => page.evaluate(e => { const raw = localStorage.getItem(`pq_${e}_tissueHistory`); return raw == null ? null : JSON.parse(raw); }, email);
const detailText = () => page.locator(".tl-detail").innerText();
async function assertDetail(re) { assert.match(await detailText(), re); }
async function refuteDetail(re) { assert.doesNotMatch(await detailText(), re); }

async function seed() {
  await page.evaluate(({ A, B, profileA, profileB, intake, meals, routine }) => {
    const put = (email, suffix, v) => localStorage.setItem(`pq_${email}_${suffix}`, JSON.stringify(v));
    for (const [email, profile] of [[A, profileA], [B, profileB]]) {
      put(email, "profile", profile);
      put(email, "intake", intake); put(email, "meals", meals);
      put(email, "workoutLog", []);
      put(email, "recentFoods", [{ name: "Saved " + email, calories: 111, protein: 10, carbs: 10, fats: 3 }]);
      put(email, "routines", email === A ? [routine] : []);
      put(email, "weeklyMuscles", { weekStart: "2026-03-30", dates: {}, sessions: {}, sets: { chest: email === A ? 3 : 0 } });
      put(email, "setTargets", { chest: 8 });
      localStorage.setItem(`pq_${email}_date`, "Tue Mar 31 2026");
      localStorage.setItem(`pq_${email}_lastCheckin`, "2026-03-30");
    }
    localStorage.setItem("pq_last_email", A);
  }, {
    A, B,
    profileA: { ...DEMO_PROFILE_A, weight: 180, weightLog: [{ date: "2026-02-20", weight: 180 }] },
    profileB: { ...DEMO_PROFILE_B, weight: 142, weightLog: [{ date: "2026-02-20", weight: 142 }] },
    intake: DEMO_INTAKE_A, meals: DEMO_MEALS_A,
    routine: { id: 9101, title: "Synthetic Squat Day", exercises: [{ id: 92001, name: "Squat", muscle: "Quads", sets: [{ reps: 5, weight: 225 }] }] }
  });
  await page.reload();
}
async function openExercise() {
  await page.locator(".nav-add-btn").click();
  await page.locator(".exercise-card").click();
  await page.getByText("Weekly Muscle Tracker", { exact: true }).waitFor();
}
async function openTissue() {
  await page.getByRole("button", { name: "Tissue Load", exact: true }).click();
  await page.locator(".tl-card").waitFor();
}
async function closePopup() { await page.getByRole("button", { name: "Close", exact: true }).click(); }
/* Replace the SOURCE workout log the way an import or a fresh device would,
   then let the app's own reconciliation rebuild derived history on reload. */
async function setSource(history, { clearDerived = true, email = A } = {}) {
  await page.evaluate(({ email, history, clearDerived }) => {
    localStorage.setItem(`pq_${email}_workoutLog`, JSON.stringify(history));
    if (clearDerived) localStorage.removeItem(`pq_${email}_tissueHistory`);
  }, { email, history, clearDerived });
  await page.reload(); await openExercise(); await openTissue();
}
async function selectTissue(id) {
  const region = page.locator(`.tl-region[data-tissue="${id}"] path`).first();
  if (await region.count() > 0) { await region.click(); return; }
  await page.getByRole("button", { name: new RegExp("^" + id.replace(/_/g, " "), "i") }).click();
}

try {
  await page.goto(url + (label === "development" ? "/?dev=1" : "/"));

  await check("1. existing app loads", async () => {
    await page.getByRole("button", { name: "Continue", exact: true }).waitFor();
  });

  await seed();
  await openExercise();

  let volumeBefore, recoveryBefore;
  await check("2. Training Volume is unchanged by Milestone 4", async () => {
    await page.locator('[data-muscle="chest"] path').first().click();
    assert.match(await page.locator(".md-tooltip").innerText(), /3\/8 sets/);
    assert.equal(await page.locator('[data-muscle="chest"] path').first().getAttribute("fill"), "url(#md-grad-partial)");
    volumeBefore = await page.locator(".md-card:not(.tl-card)").innerHTML();
  });
  await check("25. Recovery Guidance retires fixed readiness timers", async () => {
    recoveryBefore = await page.locator(".rec-card").innerHTML();
    const text = await page.locator(".rec-card").innerText();
    assert.match(text, /Recovery Guidance/);
    assert.match(text, /No modeled tissue history yet/);
    assert.match(text, /not a measure of recovery, readiness, capacity or safety/);
    assert.doesNotMatch(text, /Ready to Train|Ready in|resting|fair game/);
  });

  await setSource(historyWithRecent(1200));

  await check("25a. Recovery Guidance uses frozen history, frequency and athlete-relative baseline", async () => {
    const text = await page.locator(".rec-card").innerText();
    assert.match(text, /Modeled load in the last 7 days/i);
    assert.match(text, /Chest/);
    assert.match(text, /Last modeled load 1d ago/);
    assert.match(text, /1 modeled session/);
    assert.match(text, /1,200 lb\*rep/);
    assert.match(text, /20% above recent baseline/);
    assert.match(text, /medium model confidence/i);
    assert.match(text, /recovery-guidance-v0\.1/);
    assert.doesNotMatch(text, /Ready to Train|Ready in|resting|fair game|% recovered/);
    for (const width of [375, 320]) {
      await page.setViewportSize({ width, height: 812 });
      const measurements = await page.locator(".rec-card").evaluate(card => {
        const nodes = [card, ...card.querySelectorAll(".rec-header, .rec-load-row, .rec-load-main, .rec-load-meta, .rec-pill-row")];
        return nodes.map(node => ({ width: node.clientWidth, scrollWidth: node.scrollWidth }));
      });
      assert.ok(measurements.every(item => item.scrollWidth <= item.width + 1), width + "px Recovery Guidance overflow: " + JSON.stringify(measurements));
      await page.locator(".rec-card").screenshot({ path: `${out}/recovery-${width}.png` });
    }
    await page.setViewportSize({ width: 375, height: 812 });
  });

  await check("3. the Milestone 3 map keeps relative-concentration meaning and its legend", async () => {
    assert.match(await page.locator(".tl-legend").innerText(), /Less → more relative modeled workload/);
    assert.match(await page.locator(".tl-card").innerText(), /Color shows relative workload distribution within the selected period/);
    await refuteDetail(/baseline deviation/i);
    const fills = await page.locator('.tl-region path').evaluateAll(ns => ns.map(n => n.getAttribute("fill")));
    assert.ok(fills.every(f => f === "#3A4254" || /^hsl\(258, 65%/.test(f)), "map must keep the single neutral purple ramp: " + fills.join(","));
  });

  await check("4. Today and This week still behave as Milestone 3 defined them", async () => {
    assert.match(await page.locator(".tl-coverage").innerText(), /0 of 0 completed sets modeled · 0 saved workouts/);
    assert.match(await page.locator(".tl-empty").innerText(), /No completed workouts today/);
    await page.getByRole("button", { name: "This week", exact: true }).click();
    assert.match(await page.locator(".tl-coverage").innerText(), /1 of 1 completed sets modeled · 1 saved workout/);
    await page.getByRole("button", { name: "Today", exact: true }).click();
    assert.match(await page.locator(".tl-coverage").innerText(), /0 of 0 completed sets modeled/);
  });

  await check("5+6. the selected tissue shows exact 7-day and 28-day exposure", async () => {
    await selectTissue("chest");
    await assertDetail(/Last 7 days\s+1,200 lb\*rep/);
    await assertDetail(/Last 28 days\s+4,200 lb\*rep/);   // Mar 4 + Mar 12 + Mar 20 (1,000 each) + Mar 30 (1,200)
  });

  await check("7+9. an eligible baseline shows a mathematically correct above-baseline comparison", async () => {
    await assertDetail(/Recent baseline\s+1,000 lb\*rep\s*per 7 days, Feb 25 – Mar 24/);
    await assertDetail(/Change vs recent baseline\s+\+20%\s*above recent modeled baseline/);
    await assertDetail(/20% above the mean of the four 7-day periods before them \(1,000 lb\*rep\)/);
    await assertDetail(/not injury risk, recovery or capacity/);
  });

  await check("10. below-baseline is correct and signed", async () => {
    await setSource(historyWithRecent(800));
    await selectTissue("chest");
    await assertDetail(/Last 7 days\s+800 lb\*rep/);
    await assertDetail(/Change vs recent baseline\s+−20%\s*below recent modeled baseline/);
  });

  await check("11. an exactly equal baseline is handled cleanly", async () => {
    await setSource(historyWithRecent(1000));
    await selectTissue("chest");
    await assertDetail(/Change vs recent baseline\s+\+0%\s*equal to recent modeled baseline/);
    await refuteDetail(/above recent modeled baseline|below recent modeled baseline/);
  });

  await check("12. a zero historical baseline produces no Infinity, NaN or invented percentage", async () => {
    await setSource(historyWithRecent(1000, [{ name: "Squat", muscle: "Quads", sets: [setDone(225, 5)] }]));
    await selectTissue("quadriceps");
    await assertDetail(/Last 7 days\s+1,800 lb\*rep/);
    await assertDetail(/Recent baseline\s+0 lb\*rep/);
    await assertDetail(/Change vs recent baseline\s+Not comparable/);
    await assertDetail(/No prior modeled workload for this tissue in the baseline period \(Feb 25 – Mar 24\)/);
    await refuteDetail(/Infinity|NaN|∞/);
  });

  await check("8. insufficient history is stated honestly, with elapsed logging-span counts", async () => {
    await setSource([bench(1000, 801, -2), bench(500, 802, -1)]);
    await selectTissue("chest");
    await assertDetail(/Last 7 days\s+1,500 lb\*rep\s*3 of 7 days since first log/);
    await assertDetail(/Last 28 days\s+1,500 lb\*rep\s*3 of 28 days since first log/);
    await assertDetail(/Recent baseline\s+Not yet available/);
    await assertDetail(/Change vs recent baseline\s+Not comparable/);
    await assertDetail(/Baseline needs modeled history covering the 28 days before the last 7 days \(Feb 25 – Mar 24\)\. History begins Mar 29\./);
    await setSource([]);
    await selectTissue("chest");
    await assertDetail(/No modeled history yet/);
  });

  await check("13. partial mapping coverage is visible across both compared periods", async () => {
    const withUnmapped = BASELINE_SESSIONS.map((s, i) => i < 2
      ? { ...s, exercises: s.exercises.concat([{ name: LONG_NAME, muscle: "Cardio", sets: [setDone(0, 1), setDone(0, 1)] }]) }
      : s);
    await setSource(withUnmapped.concat([{ id: 700, title: "Recent", startedAt: at(-1, 9), finishedAt: at(-1), exercises: [ex("Barbell Bench Press", [setDone(120, 10)])] }]));
    await selectTissue("chest");
    await assertDetail(/Coverage: last 7 days 1 of 1 completed sets modeled; last 28 days 4 of 6 completed sets modeled; baseline period 4 of 8 completed sets modeled\./);
    await assertDetail(/Unmapped sets are excluded from every total above, so the comparison covers modeled exercises only\./);
    await assertDetail(/Change vs recent baseline\s+\+20%/);
  });

  await check("14. a synthetic other-model-version entry is never merged and is preserved on disk", async () => {
    await setSource(historyWithRecent(1200));
    const injected = await page.evaluate(A => {
      const key = `pq_${A}_tissueHistory`;
      const env = JSON.parse(localStorage.getItem(key));
      const foreign = JSON.parse(JSON.stringify(env.entries[0]));
      foreign.modelVersion = "tissue-load-v0.2";
      foreign.mapVersion = "exercise-tissue-map-v0.2";
      foreign.tissues = { chest: { workload: 999999, eventCount: 1, confidence: "low" } };
      env.entries.push(foreign);
      localStorage.setItem(key, JSON.stringify(env));
      return JSON.stringify(foreign);
    }, A);
    await page.reload(); await openExercise(); await openTissue();
    await selectTissue("chest");
    await assertDetail(/Last 7 days\s+1,200 lb\*rep/);
    await refuteDetail(/999,999/);
    await assertDetail(/1 history entry from a different model version is kept separately and not included\./);
    const after = await tissueHistoryOf(A);
    assert.ok(after.entries.some(e => JSON.stringify(e) === injected), "the foreign entry must survive reconciliation byte-for-byte");
    assert.equal(after.entries.filter(e => e.modelVersion === "tissue-load-v0.1").length, 5);
  });

  // ── frozen historical body mass ───────────────────────────────────────
  const squatSession = (id, offset) => ({ id, title: "Squat day", startedAt: at(offset, 9), finishedAt: at(offset), exercises: [{ name: "Squat", muscle: "Quads", sets: [setDone(225, 5)] }] });
  await check("15. changing the current profile weight does not alter already-materialized history", async () => {
    await setSource([squatSession(901, -6)]);
    await selectTissue("quadriceps");
    await assertDetail(/1,800 lb\*rep/);   // 5 × (225 + 0.75 × 180)
    const before = await tissueHistoryOf(A);
    assert.equal(before.entries[0].inputs.bodyMass, 180);
    assert.equal(before.entries[0].inputs.bodyMassProvenance.source, "weight_log");
    await closePopup();
    // Log a new weight through the real Profile UI.
    await page.getByRole("button", { name: "Profile", exact: true }).click();
    await page.getByPlaceholder("Enter today's weight (lb)").fill("240");
    await page.getByRole("button", { name: "Log Weight", exact: true }).click();
    /* Exact: the weigh-in was logged on Mar 31 local (America/Phoenix) and
       must render as Mar 31. This assertion was `Mar 3[01]` while the
       Profile tab still parsed the "YYYY-MM-DD" key as UTC midnight and
       showed Mar 30 west of Greenwich; the parseDayKey fix is what lets it
       be exact. */
    assert.match(await page.locator(".weight-log-recent").innerText(), /Latest: 240 lb on Mar 31, 2026/);
    await openExercise(); await openTissue(); await selectTissue("quadriceps");
    await assertDetail(/1,800 lb\*rep/);
    const after = await tissueHistoryOf(A);
    assert.equal(after.entries[0].inputs.bodyMass, 180, "frozen mass must not follow the profile");
    assert.deepEqual(after.entries[0], before.entries[0], "the entry is byte-identical after a weight change");
  });

  await check("24. weight logging and weight history still work", async () => {
    await closePopup();
    await page.getByRole("button", { name: "Profile", exact: true }).click();
    const log = await page.evaluate(A => JSON.parse(localStorage.getItem(`pq_${A}_profile`)).weightLog, A);
    assert.deepEqual(log, [{ date: "2026-02-20", weight: 180 }, { date: "2026-03-31", weight: 240 }]);
    assert.equal(await page.evaluate(A => JSON.parse(localStorage.getItem(`pq_${A}_profile`)).weight, A), 240);
  });

  await check("16+20+21+22. a new workout uses the new historical context; logging and metadata still work", async () => {
    await openExercise();
    await page.locator(".start-routine-btn").first().click();
    const card = page.locator(".active-ex-card").first();
    await card.getByLabel("Set 1 reps in reserve (optional)", { exact: true }).selectOption("2");
    await card.getByRole("button", { name: "Set 1 details (side, tempo, range of motion)", exact: true }).click();
    await card.getByLabel("Side", { exact: true }).selectOption("bilateral");
    await card.locator(".set-tempo-input").first().fill("3");
    await card.getByLabel("Range of motion", { exact: true }).selectOption("full");
    await card.getByRole("button", { name: "Set 1 done", exact: true }).click();
    await page.getByRole("button", { name: "Finish Workout", exact: true }).click();
    await page.getByText("Weekly Muscle Tracker", { exact: true }).waitFor({ state: "attached" });

    const saved = await page.evaluate(A => JSON.parse(localStorage.getItem(`pq_${A}_workoutLog`)), A);
    assert.equal(saved.length, 2, "the workout itself saved");
    const set = saved.at(-1).exercises[0].sets[0];
    assert.equal(set.done, true); assert.equal(set.rir, 2); assert.equal(set.side, "bilateral");
    assert.equal(set.tempo.eccentricSeconds, 3); assert.equal(set.rom, "full");

    const hist = await tissueHistoryOf(A);
    assert.equal(hist.entries.length, 2, "exactly one new derived entry");
    const fresh = hist.entries.find(e => e.localDate === "2026-03-31");
    assert.equal(fresh.inputs.bodyMass, 240, "the new workout uses the weight logged today");
    assert.equal(fresh.inputs.bodyMassProvenance.source, "weight_log");
    assert.equal(fresh.tissues.quadriceps.workload, 5 * (225 + 0.75 * 240));   // 2025
    assert.equal(hist.entries.find(e => e.localDate !== "2026-03-31").inputs.bodyMass, 180);

    await openTissue(); await selectTissue("quadriceps");
    await assertDetail(/2,025 lb\*rep/);                 // today, at the new mass
    await assertDetail(/Last 7 days\s+3,825 lb\*rep/);   // 1,800 frozen + 2,025 new
  });

  await check("22b. Milestone 2 metadata does not change the v0.1 workload or the derived entry", async () => {
    const before = await tissueHistoryOf(A);
    const beforeDetail = await detailText();
    await page.evaluate(A => {
      const key = `pq_${A}_workoutLog`;
      const log = JSON.parse(localStorage.getItem(key));
      log.forEach(s => s.exercises.forEach(e => e.sets.forEach(x => Object.assign(x, { rir: 5, side: "left", tempo: { eccentricSeconds: 9, pauseSeconds: 0 }, rom: "partial" }))));
      localStorage.setItem(key, JSON.stringify(log));
    }, A);
    await page.reload(); await openExercise(); await openTissue(); await selectTissue("quadriceps");
    assert.equal(await detailText(), beforeDetail, "displayed longitudinal numbers are unchanged");
    const after = await tissueHistoryOf(A);
    assert.deepEqual(after.entries, before.entries, "metadata-only edits do not rebuild a snapshot");
  });

  await check("17+34. reconciliation is idempotent across repeated reloads, with no duplicate entries", async () => {
    const first = JSON.stringify(await tissueHistoryOf(A));
    for (let i = 0; i < 3; i++) {
      await page.reload(); await openExercise(); await openTissue();
      assert.equal(JSON.stringify(await tissueHistoryOf(A)), first, "reload " + i + " changed stored history");
    }
    const keys = (await tissueHistoryOf(A)).entries.map(e => e.sourceKey);
    assert.equal(new Set(keys).size, keys.length, "duplicate sourceKey after repeated initialization");
    assert.equal(keys.length, 2);
  });

  await check("18. reload reproduces the longitudinal view", async () => {
    await selectTissue("quadriceps");
    const before = await detailText();
    await page.reload(); await openExercise(); await openTissue(); await selectTissue("quadriceps");
    assert.equal(await detailText(), before);
  });

  await check("19+33. profile A and B histories stay isolated in both directions", async () => {
    await setSource(historyWithRecent(1200));
    await page.evaluate(({ B, log }) => localStorage.setItem(`pq_${B}_workoutLog`, JSON.stringify(log)), { B, log: [bench(300, 950, -1)] });
    await closePopup();
    async function switchTo(email) {
      await page.getByRole("button", { name: "Profile", exact: true }).click();
      await page.getByRole("button", { name: "Log out", exact: true }).click();
      await page.getByPlaceholder("you@example.com").fill(email);
      await page.getByRole("button", { name: "Continue", exact: true }).click();
      await openExercise(); await openTissue();
    }
    const aHistory = JSON.stringify(await tissueHistoryOf(A));
    await switchTo(B);
    await selectTissue("chest");
    await assertDetail(/Last 7 days\s+300 lb\*rep/);
    await assertDetail(/Recent baseline\s+Not yet available/);
    const bHistory = await tissueHistoryOf(B);
    assert.equal(bHistory.entries.length, 1);
    assert.equal(bHistory.entries[0].inputs.bodyMass, 142, "B froze its own body mass");
    assert.equal(JSON.stringify(await tissueHistoryOf(A)), aHistory, "A's history untouched while B is active");
    await closePopup();
    await switchTo(A);
    await selectTissue("chest");
    await assertDetail(/Last 7 days\s+1,200 lb\*rep/);
    await assertDetail(/Change vs recent baseline\s+\+20%/);
    assert.equal(JSON.stringify(await tissueHistoryOf(A)), aHistory);
    const all = await storage();
    assert.ok(JSON.parse(all[`pq_${A}_tissueHistory`]).entries.every(e => e.sourceId !== 950), "no B record in A's history");
    assert.ok(JSON.parse(all[`pq_${B}_tissueHistory`]).entries.every(e => e.sourceId === 950), "no A record in B's history");
  });

  await check("26. no recovery, capacity, readiness or risk interpretation in the longitudinal UI", async () => {
    await selectTissue("chest");
    const text = await detailText();
    const block = text.slice(text.indexOf("Recent exposure"));
    const stripped = block
      .replace(/It is a descriptive comparison with your own logged history, not injury risk, recovery or capacity\./g, "")
      .replace(/not tissue capacity, and it makes no training recommendation\./g, "")
      .replace(/not measured tissue force\./g, "");
    const forbidden = stripped.match(/\b(capacity|recover(?:y|ed)?|ready|readiness|risk|injur\w*|safe|danger\w*|overload\w*|damage|strain|optimal|should|rest|normal|elevated|excessive)\b/i);
    assert.equal(forbidden, null, "forbidden term " + (forbidden && forbidden[0]) + " in:\n" + stripped);
    assert.match(block, /descriptive|Baseline is this profile's own recent modeled exposure/);
  });

  await check("23. nutrition and hydration still log and persist", async () => {
    await closePopup();
    // The profile switch above left the app on the Profile tab; +8oz lives on the Dashboard.
    await page.locator(".nav-btn", { hasText: "Dashboard" }).click();
    const before = JSON.parse((await storage())[`pq_${A}_intake`]);
    await page.getByRole("button", { name: "+8oz", exact: true }).click();
    let after = JSON.parse((await storage())[`pq_${A}_intake`]);
    assert.equal(after.water, before.water + 8);
    await page.locator(".nav-add-btn").click();
    await page.locator(".eats-card").click();
    await page.getByRole("button", { name: "Manual", exact: true }).click();
    await page.getByPlaceholder("Meal name (e.g. Grilled Chicken)").fill("Synthetic M4 meal");
    const inputs = page.locator(".eats-manual-macros-grid").first().locator("input");
    for (const [i, v] of [200, 20, 15, 5].entries()) await inputs.nth(i).fill(String(v));
    await page.getByRole("button", { name: "+ Log Meal", exact: true }).click();
    after = JSON.parse((await storage())[`pq_${A}_intake`]);
    assert.equal(after.calories, before.calories + 200);
    assert.equal(after.protein, before.protein + 20);
    const recent = JSON.parse((await storage())[`pq_${A}_recentFoods`]);
    assert.ok(recent.some(food => food.name === "Saved " + A), "existing recent foods must survive reload, profile switches, and a new meal");
    assert.ok(!recent.some(food => food.name === "Saved " + B), "another profile food leaked");
    await closePopup();
  });

  await check("2b+25b. switching views leaves Volume and Recovery Guidance byte-identical", async () => {
    /* Self-contained: capture, visit the longitudinal view, come back. The
       snapshots from check 2/25 are not reused here because the harness has
       since logged a real workout, which legitimately changes weekly volume
       and guidance — that is the app working, not a regression. */
    await openExercise();
    await page.locator('[data-muscle="chest"] path').first().click();
    const volumeNow = await page.locator(".md-card:not(.tl-card)").innerHTML();
    const recoveryNow = await page.locator(".rec-card").innerHTML();
    await openTissue();
    await selectTissue("chest");
    assert.match(await detailText(), /Recent exposure/);
    await page.getByRole("button", { name: "Training Volume", exact: true }).click();
    assert.equal(await page.locator(".md-card:not(.tl-card)").innerHTML(), volumeNow, "Weekly Muscle Tracker DOM changed");
    assert.equal(await page.locator(".rec-card").innerHTML(), recoveryNow, "Recovery Guidance DOM changed");
    /* The pre-milestone snapshots are not compared byte-for-byte here: the
       harness logged a real squat in between, which legitimately moves the
       quads volume state and the M5 guidance. The two views must remain
       separate even though both consume the same frozen M4 history. */
    assert.doesNotMatch(volumeNow, /tl-|Recent exposure|recent modeled baseline|Last 7 days|Last 28 days|recovery-guidance/, "Volume leaked TissueOS markup");
    assert.doesNotMatch(recoveryNow, /tl-|Recent exposure|Last 28 days/, "Recovery Guidance leaked Tissue Load detail markup");
    assert.match(recoveryNow, /Recovery Guidance/);
    assert.match(recoveryNow, /recovery-guidance-v0\.1/);
    assert.ok(volumeBefore.length > 0 && recoveryBefore.length > 0);
  });

  await check("30. the longitudinal detail is reachable and readable by keyboard alone", async () => {
    await openTissue();
    await page.locator('.tl-region[data-tissue="chest"]').focus();
    await page.keyboard.press("Space");
    assert.equal(await page.locator('.tl-region[data-tissue="chest"]').getAttribute("aria-pressed"), "true");
    await assertDetail(/Recent exposure/);
    await page.getByRole("button", { name: /^Patellar tendon/ }).focus();
    await page.keyboard.press("Enter");
    await assertDetail(/Patellar tendon/);
    await assertDetail(/Recent exposure/);
    assert.equal(await page.locator('.tl-detail').getAttribute("aria-live"), "polite");
  });

  await check("27+28+29. 375px and 320px layouts are usable and long names wrap", async () => {
    await setSource(historyWithRecent(1200, [{ name: LONG_NAME, muscle: "Cardio", sets: [setDone(0, 1)] }]));
    await selectTissue("chest");
    for (const width of [375, 320]) {
      await page.setViewportSize({ width, height: 812 });
      const m = await page.evaluate(() => {
        const nodes = [document.documentElement, document.querySelector(".popup-content"), document.querySelector(".tl-card"),
          document.querySelector(".tl-detail"), ...document.querySelectorAll(".tl-stats div"), ...document.querySelectorAll(".tl-card li")];
        return nodes.filter(Boolean).map(n => ({ w: n.clientWidth, s: n.scrollWidth }));
      });
      assert.ok(m.every(x => x.s <= x.w + 1), width + "px overflow: " + JSON.stringify(m.filter(x => x.s > x.w + 1)));
      await page.locator(".tl-detail").scrollIntoViewIfNeeded();
      await page.screenshot({ path: `${out}/detail-${width}.png` });
      await page.locator(".tl-card h2").scrollIntoViewIfNeeded();
      await page.screenshot({ path: `${out}/header-${width}.png` });
    }
    await page.setViewportSize({ width: 375, height: 812 });
  });

  await check("adversarial: malformed and future-version stored history are never overwritten", async () => {
    await page.evaluate(A => localStorage.setItem(`pq_${A}_tissueHistory`, "{not json"), A);
    await page.reload(); await openExercise(); await openTissue(); await selectTissue("chest");
    await assertDetail(/Last 7 days\s+1,200 lb\*rep/);
    await assertDetail(/Saved modeled history could not be read\. The original was kept/);
    assert.equal(await page.evaluate(A => localStorage.getItem(`pq_${A}_tissueHistory`), A), "{not json");
    assert.equal(await page.evaluate(A => localStorage.getItem(`pq_${A}_tissueHistory__corrupt`), A), "{not json");
    const future = JSON.stringify({ schemaVersion: "tissue-history-v9", entries: [{ shape: "unknown" }] });
    await page.evaluate(({ A, future }) => localStorage.setItem(`pq_${A}_tissueHistory`, future), { A, future });
    await page.reload(); await openExercise(); await openTissue(); await selectTissue("chest");
    await assertDetail(/written by a newer version of the app and has been left unchanged/);
    await assertDetail(/Last 7 days\s+1,200 lb\*rep/);
    assert.equal(await page.evaluate(A => localStorage.getItem(`pq_${A}_tissueHistory`), A), future, "a newer schema must never be downgraded");
    await page.evaluate(A => { localStorage.removeItem(`pq_${A}_tissueHistory`); localStorage.removeItem(`pq_${A}_tissueHistory__corrupt`); }, A);
    await page.reload(); await openExercise(); await openTissue();
  });

  await check("adversarial: a changed or deleted source workout reconciles, leaving no stale derived entry", async () => {
    const full = historyWithRecent(1200);
    await setSource(full);
    assert.equal((await tissueHistoryOf(A)).entries.length, 5);
    await setSource(full.slice(0, 4), { clearDerived: false });
    const afterDelete = await tissueHistoryOf(A);
    assert.equal(afterDelete.entries.length, 4, "the removed workout's entry is gone");
    const edited = full.slice(0, 4).concat([{ ...full[4], exercises: [ex("Barbell Bench Press", [setDone(300, 10)])] }]);
    await setSource(edited, { clearDerived: false });
    await selectTissue("chest");
    await assertDetail(/Last 7 days\s+3,000 lb\*rep/);
    assert.equal((await tissueHistoryOf(A)).entries.length, 5);
  });

  await check("regression: onboarding a brand-new account after logout inherits nothing from the previous profile", async () => {
    /* Pre-existing carry-over bug, fixed alongside this milestone: doLogin()
       took the onboarding branch without clearing React state, so the eager
       persistence effects wrote the previous profile's workouts, routines,
       nutrition and weekly rollup under the new e-mail — and Milestone 4's
       derived history followed that source. Profile A here has saved
       workouts, routines, meals and a weekly rollup. */
    const C = "demo-c@example.com";
    await closePopup().catch(() => {});
    const aBefore = await page.evaluate(A => JSON.stringify({
      workoutLog: localStorage.getItem(`pq_${A}_workoutLog`),
      routines: localStorage.getItem(`pq_${A}_routines`),
      tissueHistory: localStorage.getItem(`pq_${A}_tissueHistory`),
      recentFoods: localStorage.getItem(`pq_${A}_recentFoods`),
      intake: localStorage.getItem(`pq_${A}_intake`), meals: localStorage.getItem(`pq_${A}_meals`),
      history: localStorage.getItem(`pq_${A}_history`), profile: localStorage.getItem(`pq_${A}_profile`),
      setTargets: localStorage.getItem(`pq_${A}_setTargets`), weeklyMuscles: localStorage.getItem(`pq_${A}_weeklyMuscles`),
      planDrafts: localStorage.getItem(`pq_${A}_planDrafts`)
    }), A);
    assert.ok(JSON.parse(aBefore).workoutLog.length > 100, "profile A must actually have workouts to leak");

    await page.getByRole("button", { name: "Profile", exact: true }).click();
    await page.getByRole("button", { name: "Log out", exact: true }).click();
    await page.getByPlaceholder("you@example.com").fill(C);
    await page.getByRole("button", { name: "Continue", exact: true }).click();
    await page.getByText("Step 1 of 3", { exact: true }).waitFor();
    await page.getByPlaceholder("Your name").fill("Demo C");
    await page.getByRole("button", { name: "Next", exact: true }).click();
    await page.getByRole("button", { name: /^Next$/ }).click();
    await page.getByRole("button", { name: "Finish Setup", exact: true }).click();
    await page.locator(".nav-add-btn").waitFor();

    const c = await page.evaluate(C => {
      const read = s => localStorage.getItem(`pq_${C}_${s}`);
      return { profile: read("profile"), workoutLog: read("workoutLog"), routines: read("routines"),
        weeklyMuscles: read("weeklyMuscles"), setTargets: read("setTargets"), meals: read("meals"),
        intake: read("intake"), history: read("history"), recentFoods: read("recentFoods"), planDrafts: read("planDrafts"), tissueHistory: read("tissueHistory") };
    }, C);
    assert.deepEqual(JSON.parse(c.workoutLog), [], "the new account inherited workouts");
    assert.deepEqual(JSON.parse(c.routines), [], "the new account inherited routines");
    assert.deepEqual(JSON.parse(c.setTargets), {}, "the new account inherited set targets");
    assert.deepEqual(JSON.parse(c.meals), [], "the new account inherited meals");
    assert.deepEqual(JSON.parse(c.weeklyMuscles).sets, {}, "the new account inherited a weekly rollup");
    assert.equal(c.history, null, "the new account inherited nutrition history");
    assert.equal(c.recentFoods, null, "the new account inherited recent foods");
    assert.equal(c.planDrafts, null, "the new account inherited meal plans");
    assert.equal(JSON.parse(c.intake).calories, 0, "the new account inherited today's intake");
    assert.equal(JSON.parse(c.profile).name, "Demo C");
    assert.equal(JSON.parse(c.profile).weightLog, undefined, "the new account inherited a weight log");
    assert.deepEqual(JSON.parse(c.tissueHistory), { schemaVersion: "tissue-history-v1", entries: [] },
      "derived TissueOS history must start empty for a new account");

    // Profile A is untouched by any of it.
    assert.equal(await page.evaluate(A => JSON.stringify({
      workoutLog: localStorage.getItem(`pq_${A}_workoutLog`),
      routines: localStorage.getItem(`pq_${A}_routines`),
      tissueHistory: localStorage.getItem(`pq_${A}_tissueHistory`),
      recentFoods: localStorage.getItem(`pq_${A}_recentFoods`),
      intake: localStorage.getItem(`pq_${A}_intake`), meals: localStorage.getItem(`pq_${A}_meals`),
      history: localStorage.getItem(`pq_${A}_history`), profile: localStorage.getItem(`pq_${A}_profile`),
      setTargets: localStorage.getItem(`pq_${A}_setTargets`), weeklyMuscles: localStorage.getItem(`pq_${A}_weeklyMuscles`),
      planDrafts: localStorage.getItem(`pq_${A}_planDrafts`)
    }), A), aBefore, "profile A changed while onboarding a new account");

    // And the new account's own first workout lands only under its own key.
    await page.evaluate(({ C, log }) => localStorage.setItem(`pq_${C}_workoutLog`, JSON.stringify(log)),
      { C, log: [bench(500, 990, -1)] });
    await page.reload(); await openExercise(); await openTissue();
    await selectTissue("chest");
    await assertDetail(/Last 7 days\s+500 lb\*rep/);
    const cHistory = await tissueHistoryOf(C);
    assert.equal(cHistory.entries.length, 1);
    assert.equal(cHistory.entries[0].sourceId, 990);
    assert.equal(await page.evaluate(A => localStorage.getItem(`pq_${A}_tissueHistory`), A), JSON.parse(aBefore).tissueHistory);
  });

  await check("regression: a corrupted profile key re-onboards without destroying that account's other data", async () => {
    /* Pre-existing bug, fixed alongside this milestone: an unreadable
       `profile` made loadUser() return null, the app treated the account as
       brand-new, and the eager write-back replaced its readable workouts,
       routines, targets and nutrition with empty values. An unreadable
       profile says nothing about the rest of the account. */
    const R = "demo-r@example.com";
    await closePopup().catch(() => {});
    const seeded = await page.evaluate(({ R, log, routine }) => {
      const put = (s, v) => localStorage.setItem(`pq_${R}_${s}`, JSON.stringify(v));
      put("profile", { name: "Demo R", weight: 190, age: 30, height: 70, sex: "male", bodyfat: 18,
        goal: "build", activity: "moderate", gymDays: 4, steps: 9000, todayMuscles: [], bmrOverride: null });
      put("workoutLog", log);
      put("intake", { calories: 0, protein: 20, carbs: 10, fats: 5, sodium: 2, water: 8 });
      put("meals", [{ id: 12, name: "Saved recovery meal", calories: 0 }]);
      put("recentFoods", [{ name: "Saved recovery food", calories: 0 }]);
      put("planDrafts", { training: [], rest: [] });
      localStorage.setItem(`pq_${R}_date`, "Tue Mar 31 2026");
      put("routines", [routine]);
      put("setTargets", { chest: 14 });
      put("weeklyMuscles", { weekStart: "2026-03-30", dates: { chest: ["2026-03-30"] }, sessions: {}, sets: { chest: 5 } });
      put("history", [{ date: "Mon Mar 30 2026", calories: 2600, protein: 170, carbs: 300, fats: 80, sodium: 2200 }]);
      return { workoutLog: localStorage.getItem(`pq_${R}_workoutLog`), routines: localStorage.getItem(`pq_${R}_routines`),
        setTargets: localStorage.getItem(`pq_${R}_setTargets`), weeklyMuscles: localStorage.getItem(`pq_${R}_weeklyMuscles`),
        history: localStorage.getItem(`pq_${R}_history`),
        intake: localStorage.getItem(`pq_${R}_intake`), meals: localStorage.getItem(`pq_${R}_meals`),
        recentFoods: localStorage.getItem(`pq_${R}_recentFoods`), planDrafts: localStorage.getItem(`pq_${R}_planDrafts`) };
    }, { R, log: [bench(2000, 970, -1)], routine: { id: 9301, title: "Demo R Push", exercises: [{ id: 1, name: "Barbell Bench Press", muscle: "Chest", sets: [{ reps: 8, weight: 135 }] }] } });

    // Log in once so the derived history materializes, then corrupt ONLY the profile.
    await page.getByRole("button", { name: "Profile", exact: true }).click();
    await page.getByRole("button", { name: "Log out", exact: true }).click();
    await page.getByPlaceholder("you@example.com").fill(R);
    await page.getByRole("button", { name: "Continue", exact: true }).click();
    await page.locator(".nav-add-btn").waitFor();
    assert.equal((await tissueHistoryOf(R)).entries.length, 1, "profile R should have derived history before the corruption");

    await page.evaluate(R => localStorage.setItem(`pq_${R}_profile`, '{"name":"Demo R","weight":190,'), R);
    await page.reload();
    // An unreadable profile falls through to the login screen.
    await page.getByPlaceholder("you@example.com").waitFor();
    await page.getByPlaceholder("you@example.com").fill(R);
    await page.getByRole("button", { name: "Continue", exact: true }).click();
    await page.getByText("Step 1 of 3", { exact: true }).waitFor();
    await page.getByPlaceholder("Your name").fill("Demo R Recovered");
    await page.getByRole("button", { name: "Next", exact: true }).click();
    await page.getByRole("button", { name: /^Next$/ }).click();
    await page.getByRole("button", { name: "Finish Setup", exact: true }).click();
    await page.locator(".nav-add-btn").waitFor();

    const after = await page.evaluate(R => ({
      profile: localStorage.getItem(`pq_${R}_profile`),
      corrupt: localStorage.getItem(`pq_${R}_profile__corrupt`),
      workoutLog: localStorage.getItem(`pq_${R}_workoutLog`), routines: localStorage.getItem(`pq_${R}_routines`),
      setTargets: localStorage.getItem(`pq_${R}_setTargets`), weeklyMuscles: localStorage.getItem(`pq_${R}_weeklyMuscles`),
      history: localStorage.getItem(`pq_${R}_history`),
        intake: localStorage.getItem(`pq_${R}_intake`), meals: localStorage.getItem(`pq_${R}_meals`),
        recentFoods: localStorage.getItem(`pq_${R}_recentFoods`), planDrafts: localStorage.getItem(`pq_${R}_planDrafts`)
    }), R);
    assert.equal(after.workoutLog, seeded.workoutLog, "the account's workouts were destroyed");
    assert.equal(after.routines, seeded.routines, "the account's routines were destroyed");
    assert.equal(after.setTargets, seeded.setTargets, "the account's set targets were destroyed");
    assert.equal(after.weeklyMuscles, seeded.weeklyMuscles, "the account's weekly rollup was destroyed");
    assert.equal(after.history, seeded.history, "the account's nutrition history was destroyed");
    for (const suffix of ["intake", "meals", "recentFoods", "planDrafts"]) assert.equal(after[suffix], seeded[suffix], suffix + " destroyed during corrupt-profile recovery");
    // The new profile landed and the original bytes are recoverable.
    assert.equal(JSON.parse(after.profile).name, "Demo R Recovered");
    assert.equal(after.corrupt, '{"name":"Demo R","weight":190,');
    // Derived TissueOS history still matches the surviving source.
    const hist = await tissueHistoryOf(R);
    assert.equal(hist.entries.length, 1);
    assert.equal(hist.entries[0].sourceId, 970);
    for (let i = 0; i < 2; i++) {
      await page.reload(); await page.locator(".nav-add-btn").waitFor();
      const preserved = await page.evaluate(({ R, keys }) => Object.fromEntries(keys.map(k => [k, localStorage.getItem(`pq_${R}_${k}`)])), { R, keys: Object.keys(seeded) });
      assert.deepEqual(preserved, seeded, "repeated reload changed readable siblings");
    }
    // And it is all visible in the UI.
    await openExercise(); await openTissue(); await selectTissue("chest");
    await assertDetail(/Last 7 days\s+2,000 lb\*rep/);
  });

  await check("review: frozen historical contributors agree with longitudinal totals", async () => {
    await closePopup().catch(() => {});
    await page.getByRole("button", { name: "Profile", exact: true }).click();
    await page.getByRole("button", { name: "Log out", exact: true }).click();
    await page.getByPlaceholder("you@example.com").fill(A);
    await page.getByRole("button", { name: "Continue", exact: true }).click();
    await page.locator(".nav-add-btn").waitFor();
    await openExercise(); await openTissue();
    await setSource([squatSession(1201, -1)]);
    await page.getByRole("button", { name: "This week", exact: true }).click();
    await selectTissue("quadriceps");
    assert.equal((await tissueHistoryOf(A)).entries[0].inputs.bodyMass, 180);
    assert.match(await page.locator(".tl-contributors").innerText(), /Squat\s+1,800/);
    await assertDetail(/Last 7 days\s+1,800 lb\*rep/);
  });

  await check("review: duplicate-source reordering after a weight correction retains context", async () => {
    const a = squatSession(1202, -1), b = structuredClone(a);
    b.exercises[0].sets[0].weight = 100;
    await setSource([a, b]);
    const before = (await tissueHistoryOf(A)).entries;
    await page.evaluate(({ A, log }) => {
      const p = JSON.parse(localStorage.getItem(`pq_${A}_profile`));
      p.weight = 90; p.weightLog = [{ date: "2026-02-01", weight: 90 }];
      localStorage.setItem(`pq_${A}_profile`, JSON.stringify(p));
      localStorage.setItem(`pq_${A}_workoutLog`, JSON.stringify(log));
    }, { A, log: [b, a] });
    await page.reload(); await openExercise(); await openTissue();
    const after = (await tissueHistoryOf(A)).entries;
    for (const e of before) {
      const match = after.find(x => x.sourceFingerprint === e.sourceFingerprint);
      assert.deepEqual({ ...match, sourceKey: e.sourceKey }, e);
    }
  });

  await check("review: future-only history explains why no present exposure exists", async () => {
    await setSource([bench(1000, 1300, 1)]);
    await selectTissue("chest");
    await assertDetail(/No modeled history yet/);
    await assertDetail(/Future-dated workouts are kept but excluded/);
    await refuteDetail(/Last 7 days\s+0/);
    assert.equal((await tissueHistoryOf(A)).entries.length, 1);
  });

  await check("review: derived quota failure preserves source and other profiles", async () => {
    await setSource([bench(1000, 1400, -1)]);
    const before = await storage();
    const siblingKey = `pq_${B}_history`;
    const sibling = JSON.stringify([{ day: 1 }, { day: 2 }, { day: 3 }]);
    await page.evaluate(({ siblingKey, sibling, A, log }) => {
      localStorage.setItem(siblingKey, sibling);
      localStorage.setItem(`pq_${A}_workoutLog`, JSON.stringify(log));
    }, { siblingKey, sibling, A, log: [bench(1000, 1400, -1), bench(500, 1401, 0)] });
    await page.addInitScript(() => {
      const original = Storage.prototype.setItem;
      Storage.prototype.setItem = function(k, v) {
        if (k.endsWith("_tissueHistory")) throw new DOMException("Synthetic quota", "QuotaExceededError");
        return original.call(this, k, v);
      };
    });
    await page.reload(); await openExercise(); await openTissue(); await selectTissue("chest");
    await assertDetail(/Modeled history could not be saved this time/);
    const after = await storage();
    assert.equal(after[siblingKey], sibling);
    assert.equal(after[`pq_${A}_tissueHistory`], before[`pq_${A}_tissueHistory`]);
    assert.equal(JSON.parse(after[`pq_${A}_workoutLog`]).length, 2);
  });

  await check("31+32. no runtime or console errors, and no schema drift", async () => {
    assert.deepEqual(errors, []);
    assert.deepEqual(consoleErrors, []);
    const all = await storage();
    assert.equal(all.pq_schema_version, "1");
    assert.equal(JSON.parse(all[`pq_${A}_tissueHistory`]).schemaVersion, "tissue-history-v1");
    if (label === "production") assert.equal(await page.evaluate(() => typeof window.__physiqSeed), "undefined");
  });

  await writeFile(`${out}/results.json`, JSON.stringify({ label, checks, errors, consoleErrors }, null, 2));
  console.log(`\n${checks.length} grouped checks passed (${label}). Artifacts: ${out}`);
} catch (error) {
  await page.screenshot({ path: `${out}/failure.png`, fullPage: true });
  await writeFile(`${out}/failure.txt`, error.stack + "\n\n" + await page.locator("body").innerText());
  console.error(error);
  console.error("Artifacts:", out);
  process.exitCode = 1;
} finally {
  await browser.close();
  await new Promise(r => server.close(r));
}
