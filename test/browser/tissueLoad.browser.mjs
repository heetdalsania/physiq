/* Explicit browser acceptance harness, outside npm test's no-write glob.
 * Uses Playwright when supplied by the environment, never a real browser profile.
 * Run: PLAYWRIGHT_MODULE=/absolute/path/to/playwright/index.mjs node test/browser/tissueLoad.browser.mjs [dist-directory] [label]
 */
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { resolve, extname } from "node:path";
import { DEMO_PROFILE_A, DEMO_PROFILE_B, DEMO_INTAKE_A, DEMO_MEALS_A, DEMO_ROUTINE_PUSH } from "../../js/dev/demoFixtures.js";
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || "playwright");
const root = resolve(process.argv[2] || "dist");
const label = process.argv[3] || "production";
const out = `/tmp/physiq-m3-browser-${label}`;
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
await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
const url = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROME_EXECUTABLE || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" });
const context = await browser.newContext({ viewport: { width: 375, height: 812 }, timezoneId: "America/Phoenix", locale: "en-US" });
const page = await context.newPage();
const errors = [];
const consoleErrors = [];
page.on("pageerror", e => errors.push(e.message));
page.on("console", m => { if (m.type() === "error") consoleErrors.push(m.text()); });
// Fonts are unrelated to acceptance and need no external network.
await context.route(/fonts\.googleapis\.com|fonts\.gstatic\.com/, route => route.fulfill({ status: 200, body: "" }));
await page.clock.install({ time: new Date("2026-03-04T12:00:00-07:00") });
const checks = [];
async function check(name, fn) { await fn(); checks.push(name); console.log("PASS", name); }
const A = "demo-a@example.com", B = "demo-b@example.com";
const at = (day, hour = 10) => new Date(`2026-03-${String(day).padStart(2, "0")}T${String(hour).padStart(2, "0")}:00:00-07:00`).getTime();
const completed = (weight, reps) => ({ done: true, weight, reps });
const exercise = (name, sets) => ({ name, muscle: "Quads", sets });
const longName = "Unmapped synthetic exercise with an exceptionally long descriptive name for checking narrow mobile layouts";
// Milestone 4 freezes body mass per workout from the dated weight log
// (TISSUE_LOAD_HISTORY.md §4, STORAGE_CONTRACT.md §10): the latest valid
// profile.weightLog entry on or before the workout's local day wins over the
// current profile weight. Profile A keeps DEMO_PROFILE_A.weightLog
// (2026-02-23 -> 176, 2026-03-02 -> 178), so these 2026-03-04 workouts use
// 178 lb, not the `weight: 180` override (which only applies without a log entry).
// Squat ("most" = 0.75): 225 + 0.75*178 = 358.5 lb; x5 reps = 1,792.5 per set.
//   Quadriceps 1.0 x 2 sets = 3,585; patellar 0.8 = 2,868; hamstrings 0.3 = 1,075.5
// Romanian Deadlift ("half"): (155 + 0.5*178) x 8 = 1,952 -> hamstrings 3,027.5
// Standing Calf Raise ("most"): (100 + 133.5) x 10 = 2,335 -> Achilles 0.9 = 2,101.5
const logA = [
  { id: 301, title: "Synthetic mixed", startedAt: at(4, 9), finishedAt: at(4), exercises: [
    exercise("Squat", [completed(225, 5), { done: false, weight: 99999, reps: 99, rir: 0, side: "left" }]),
    exercise("Romanian Deadlift", [completed(155, 8)]),
    exercise("Standing Calf Raise", [completed(100, 10)]),
    exercise(longName, [completed(0, 1)])
  ] },
  { id: 302, title: "Synthetic second", startedAt: at(4, 10), finishedAt: at(4, 11), exercises: [exercise("Squat", [completed(225, 5)])] },
  { id: 303, title: "Yesterday", startedAt: at(3, 9), finishedAt: at(3), exercises: [exercise("Barbell Bench Press", [completed(100, 10)])] }
];
const logB = [{ id: 401, finishedAt: at(4), exercises: [exercise("Dumbbell Curl", [completed(20, 10)])] }];
async function seed() {
  await page.evaluate(({ A, B, profileA, profileB, intake, meals, routine, logB }) => {
    const put = (email, suffix, v) => localStorage.setItem(`pq_${email}_${suffix}`, JSON.stringify(v));
    for (const [email, profile] of [[A, profileA], [B, profileB]]) {
      put(email, "profile", profile);
      put(email, "intake", intake); put(email, "meals", meals);
      put(email, "workoutLog", email === A ? [] : logB);
      put(email, "routines", email === A ? [routine] : []);
      put(email, "weeklyMuscles", { weekStart: "2026-03-02", dates: {}, sessions: {}, sets: { chest: email === A ? 3 : 0 } });
      put(email, "setTargets", { chest: 8 });
      localStorage.setItem(`pq_${email}_date`, "Wed Mar 04 2026");
      localStorage.setItem(`pq_${email}_lastCheckin`, "2026-03-02");
    }
    localStorage.setItem("pq_last_email", A);
  }, { A, B, profileA: { ...DEMO_PROFILE_A, weight: 180 }, profileB: DEMO_PROFILE_B, intake: DEMO_INTAKE_A, meals: DEMO_MEALS_A, routine: DEMO_ROUTINE_PUSH, logB });
  await page.reload();
}
async function openExercise() {
  await page.locator(".nav-add-btn").click();
  await page.locator(".exercise-card").click();
  await page.getByText("Weekly Muscle Tracker", { exact: true }).waitFor();
}
async function openTissue() { await page.getByRole("button", { name: "Tissue Load", exact: true }).click(); await page.locator(".tl-card").waitFor(); }
async function replaceHistory(history) {
  await page.evaluate(({ A, history }) => localStorage.setItem(`pq_${A}_workoutLog`, JSON.stringify(history)), { A, history });
  await page.reload(); await openExercise(); await openTissue();
}
const storage = () => page.evaluate(() => Object.fromEntries(Object.entries(localStorage).sort(([a], [b]) => a.localeCompare(b))));
async function assertText(selector, regex) { assert.match(await page.locator(selector).innerText(), regex); }
try {
  await page.goto(url + (label === "development" ? "/?dev=1" : "/"));
  await check("app loads normally", async () => { await page.getByRole("button", { name: "Continue", exact: true }).waitFor(); });
  await seed();
  await openExercise();
  let volumeBefore;
  await check("Training Volume uses existing targets, colors and interactions", async () => {
    await page.locator('[data-muscle="chest"] path').first().click();
    await assertText(".md-tooltip", /3\/8 sets/);
    assert.equal(await page.locator('[data-muscle="chest"] path').first().getAttribute("fill"), "url(#md-grad-partial)");
    volumeBefore = await page.locator(".md-card:not(.tl-card)").innerHTML();
  });
  const beforeOpen = await storage();
  await check("Tissue Load selector works by keyboard and shows no-workout state", async () => {
    await page.getByRole("button", { name: "Tissue Load", exact: true }).focus(); await page.keyboard.press("Enter");
    await assertText(".tl-empty", /No completed workouts today/);
    assert.equal(await page.getByRole("button", { name: "Tissue Load", exact: true }).getAttribute("aria-pressed"), "true");
  });
  await check("opening and selecting Tissue Load writes no storage", async () => {
    await page.locator('.tl-region[data-tissue="quadriceps"] path').first().click();
    assert.deepEqual(await storage(), beforeOpen);
  });
  await check("switching back preserves Volume selection and rendering", async () => {
    await page.getByRole("button", { name: "Training Volume", exact: true }).click();
    assert.equal(await page.locator(".md-card:not(.tl-card)").innerHTML(), volumeBefore);
  });
  await replaceHistory(logA);
  await check("mapped exercises and multiple sessions aggregate with honest partial coverage", async () => {
    await assertText(".tl-coverage", /4 of 5 completed sets modeled.*2 saved workouts/);
    await page.locator('.tl-region[data-tissue="quadriceps"] path').first().click();
    await assertText(".tl-detail", /3,585 lb\*rep/);
    await assertText(".tl-detail", /Model confidence: Medium/);
  });
  await check("front/back selections, contributors and weakest confidence match fixture", async () => {
    await page.locator('.tl-card').getByRole("button", { name: "Back", exact: true }).click();
    await page.locator('.tl-region[data-tissue="hamstrings"]').focus(); await page.keyboard.press("Space");
    await assertText(".tl-detail", /3,027\.5 lb\*rep/);
    assert.deepEqual(await page.locator(".tl-contributors li").allTextContents(), ["Romanian Deadlift1,952 lb*rep", "Squat1,075.5 lb*rep"]);
    await assertText(".tl-detail", /Model confidence: Low/);
    assert.equal(await page.locator('.tl-region[data-tissue="hamstrings"]').getAttribute("aria-pressed"), "true");
  });
  await check("both tendon workloads remain inspectable without fake geometry", async () => {
    assert.equal(await page.locator('svg [data-tissue$="tendon"]').count(), 0);
    await page.getByRole("button", { name: /^Patellar tendon/ }).click();
    await assertText(".tl-detail", /2,868 lb\*rep/);
    await assertText(".tl-detail", /not an estimated tendon force or stress fraction/);
    await page.getByRole("button", { name: /^Achilles tendon/ }).click();
    await assertText(".tl-detail", /2,101\.5 lb\*rep/);
  });
  await check("calendar-week selector includes yesterday without a rolling baseline", async () => {
    await page.getByRole("button", { name: "This week", exact: true }).click();
    await assertText(".tl-coverage", /5 of 6 completed sets modeled.*3 saved workouts/);
    await page.getByRole("button", { name: "Today", exact: true }).click();
    await assertText(".tl-coverage", /4 of 5 completed sets modeled/);
  });
  await check("375px and 320px layouts, long names, confidence and accessible controls", async () => {
    await page.getByText("Unmapped exercises (1)", { exact: true }).click();
    await page.locator('.tl-card').getByRole("button", { name: "Back", exact: true }).click();
    await page.locator('.tl-region[data-tissue="hamstrings"] path').first().click();
    for (const width of [375, 320]) {
      await page.setViewportSize({ width, height: 812 });
      const measurements = await page.evaluate(() => {
        const nodes = [document.documentElement, document.querySelector('.popup-content'), document.querySelector('.tl-card'), ...document.querySelectorAll('.tl-card li')];
        return nodes.map(n => ({ width: n.clientWidth, scroll: n.scrollWidth }));
      });
      assert.ok(measurements.every(m => m.scroll <= m.width + 1), JSON.stringify(measurements));
      assert.ok(await page.locator('.tl-region[role="button"][tabindex="0"][aria-label]').count() > 0);
      await page.locator('.tl-legend').scrollIntoViewIfNeeded();
      await page.screenshot({ path: `${out}/map-${width}.png` });
      await page.locator('.tl-detail').scrollIntoViewIfNeeded();
      await page.screenshot({ path: `${out}/detail-${width}.png` });
      await page.locator('.tl-card h2').scrollIntoViewIfNeeded();
      await page.screenshot({ path: `${out}/header-${width}.png` });
    }
  });
  await check("reload reproduces workload from saved history", async () => {
    const saved = await storage();
    await page.reload(); await openExercise(); await openTissue();
    await page.locator('.tl-card').getByRole("button", { name: "Back", exact: true }).click();
    await page.locator('.tl-region[data-tissue="hamstrings"] path').first().click();
    await assertText(".tl-detail", /3,027\.5 lb\*rep/);
    assert.equal((await storage())[`pq_${A}_workoutLog`], saved[`pq_${A}_workoutLog`]);
  });
  await check("incomplete sets and changed RIR/side/tempo/ROM do not alter displayed workload", async () => {
    const previous = await page.locator(".tl-detail").innerText();
    const modified = structuredClone(logA);
    modified.forEach(s => s.exercises.forEach(ex => ex.sets.forEach(set => { Object.assign(set, { rir: 5, side: "right", tempo: { eccentricSeconds: 8, pauseSeconds: 0 }, rom: "partial" }); if (!set.done) set.weight = 999999; })));
    await replaceHistory(modified);
    await page.locator('.tl-card').getByRole("button", { name: "Back", exact: true }).click();
    await page.locator('.tl-region[data-tissue="hamstrings"] path').first().click();
    assert.equal(await page.locator(".tl-detail").innerText(), previous);
  });
  await check("entirely unmapped activity is unknown, not a modeled zero", async () => {
    await replaceHistory([{ ...logA[0], exercises: [logA[0].exercises[3]] }]);
    await assertText(".tl-coverage", /0 of 1 completed sets modeled/);
    await assertText(".tl-empty", /not yet covered.*workload is unknown/);
    await page.locator('.tl-region[data-tissue="quadriceps"] path').first().click();
    await assertText(".tl-detail", /No modeled workload in this period/);
    assert.equal(await page.locator('.tl-value').count(), 0);
  });
  await check("mapped zero and incomplete-only saved sessions have distinct states", async () => {
    await replaceHistory([{ ...logA[0], exercises: [exercise("Barbell Bench Press", [completed(0, 10)])] }]);
    await page.locator('.tl-region[data-tissue="chest"] path').first().click();
    await assertText(".tl-detail", /0 lb\*rep/);
    await assertText(".tl-detail", /Mapped completed sets produced zero modeled workload/);
    await replaceHistory([{ ...logA[0], exercises: [exercise("Squat", [{ done: false, weight: 225, reps: 5 }])] }]);
    await assertText(".tl-empty", /No completed sets/);
  });
  // Additional user-flow smoke tests are below, kept on synthetic profiles.
  await replaceHistory(logA);
  await page.getByRole("button", { name: "Close", exact: true }).click();
  await check("nutrition/water survives Tissue Load and still logs", async () => {
    const before = JSON.parse((await storage())[`pq_${A}_intake`]);
    await page.getByRole("button", { name: "+8oz", exact: true }).click();
    const after = JSON.parse((await storage())[`pq_${A}_intake`]);
    assert.equal(after.water, before.water + 8);
    assert.equal(after.calories, before.calories);
    assert.equal(after.protein, before.protein);
    assert.equal(JSON.parse((await storage())[`pq_${A}_meals`]).length, DEMO_MEALS_A.length);
  });
  await check("manual nutrition logging still persists meals and macros", async () => {
    const before = JSON.parse((await storage())[`pq_${A}_intake`]);
    await page.locator(".nav-add-btn").click();
    await page.locator(".eats-card").click();
    await page.getByRole("button", { name: "Manual", exact: true }).click();
    await page.getByPlaceholder("Meal name (e.g. Grilled Chicken)").fill("Synthetic acceptance meal");
    const inputs = page.locator(".eats-manual-macros-grid").first().locator("input");
    for (const [i, value] of [200, 20, 15, 5].entries()) await inputs.nth(i).fill(String(value));
    await page.getByRole("button", { name: "+ Log Meal", exact: true }).click();
    const after = JSON.parse((await storage())[`pq_${A}_intake`]);
    assert.equal(after.calories, before.calories + 200);
    assert.equal(after.protein, before.protein + 20);
    assert.ok(JSON.parse((await storage())[`pq_${A}_meals`]).some(m => m.name === "Synthetic acceptance meal"));
    await page.getByRole("button", { name: "Close", exact: true }).click();
  });
  await check("profile switching isolates mapped workload and coverage in both directions", async () => {
    async function switchTo(email) {
      await page.getByRole("button", { name: "Profile", exact: true }).click();
      await page.getByRole("button", { name: "Log out", exact: true }).click();
      await page.getByPlaceholder("you@example.com").fill(email);
      await page.getByRole("button", { name: "Continue", exact: true }).click();
      await openExercise(); await openTissue();
    }
    await switchTo(B);
    await assertText(".tl-coverage", /1 of 1 completed sets modeled/);
    await page.locator('.tl-region[data-tissue="biceps"] path').first().click();
    await assertText(".tl-detail", /200 lb\*rep/);
    assert.equal(await page.locator('.tl-coverage-details').count(), 0);
    await page.getByRole("button", { name: "Close", exact: true }).click();
    await switchTo(A);
    await assertText(".tl-coverage", /4 of 5 completed sets modeled/);
    await page.locator('.tl-region[data-tissue="quadriceps"] path').first().click();
    await assertText(".tl-detail", /3,585 lb\*rep/);
  });
  await check("workout logging and optional metadata persist while only completed sets reach Tissue Load", async () => {
    const before = JSON.parse((await storage())[`pq_${A}_workoutLog`]);
    await page.locator(".start-routine-btn").first().click();
    const bench = page.locator(".active-ex-card").first();
    await bench.getByLabel("Set 1 reps in reserve (optional)", { exact: true }).selectOption("0");
    await bench.getByLabel("Set 2 reps in reserve (optional)", { exact: true }).selectOption("5");
    await bench.getByRole("button", { name: "Set 1 details (side, tempo, range of motion)", exact: true }).click();
    await bench.getByLabel("Side", { exact: true }).selectOption("bilateral");
    await bench.locator(".set-tempo-input").first().fill("3");
    await bench.getByLabel("Range of motion", { exact: true }).selectOption("full");
    await bench.getByRole("button", { name: "Set 1 done", exact: true }).click();
    await page.getByRole("button", { name: "Finish Workout", exact: true }).click();
    await page.getByText("Weekly Muscle Tracker", { exact: true }).waitFor({state:"attached"});
    const history = JSON.parse((await storage())[`pq_${A}_workoutLog`]);
    assert.equal(history.length, before.length + 1);
    const saved = history.at(-1).exercises[0].sets;
    assert.equal(saved[0].done, true); assert.equal(saved[0].rir, 0);
    assert.equal(saved[0].side, "bilateral"); assert.equal(saved[0].tempo.eccentricSeconds, 3); assert.equal(saved[0].rom, "full");
    assert.equal(saved[1].done, false); assert.equal(saved[1].rir, 5);
    await openTissue();
    await page.locator('.tl-region[data-tissue="chest"] path').first().click();
    await assertText(".tl-detail", /1,080 lb\*rep/);
    await assertText(".tl-coverage", /5 of 6 completed sets modeled/);
  });
  await check("light theme remains readable and body/list selection still works", async () => {
    await page.getByRole("button", { name: "Close", exact: true }).click();
    await page.getByRole("button", { name: "Toggle theme", exact: true }).click();
    await openExercise(); await openTissue();
    await page.locator('.tl-region[data-tissue="quadriceps"] path').first().click();
    assert.equal(await page.locator("body").getAttribute("data-theme"), "light");
    await page.locator('.tl-detail').scrollIntoViewIfNeeded();
    await page.screenshot({ path: `${out}/light-detail-320.png` });
  });
  await check("no runtime exceptions and only the contracted TissueOS storage key", async () => {
    assert.deepEqual(errors, []);
    assert.deepEqual(consoleErrors, []);
    // Milestone 3 wrote no TissueOS keys. Milestone 4 adds exactly one derived,
    // per-profile key, pq_<email>_tissueHistory (STORAGE_CONTRACT.md); any other
    // tissue-named key is still a contract violation.
    const tissueKeys = Object.keys(await storage()).filter(k => /tissue/i.test(k));
    assert.ok(tissueKeys.every(k => k === `pq_${A}_tissueHistory` || k === `pq_${B}_tissueHistory`), JSON.stringify(tissueKeys));
    assert.equal((await storage()).pq_schema_version, "1");
    if (label === "production") assert.equal(await page.evaluate(() => typeof window.__physiqSeed), "undefined");
  });
  await writeFile(`${out}/results.json`, JSON.stringify({ label, checks, errors, consoleErrors }, null, 2));
} catch (error) {
  await page.screenshot({ path: `${out}/failure.png`, fullPage: true });
  await writeFile(`${out}/failure.txt`, error.stack + "\n" + await page.locator("body").innerText());
  console.error(error);
  console.error("Artifacts:", out);
  process.exitCode = 1;
} finally {
  await browser.close();
  await new Promise(resolve => server.close(resolve));
}
