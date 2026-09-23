/* Milestone 6 browser acceptance — Movement Assessment (camera capture).
 *
 * Outside npm test's glob. Uses Playwright when supplied by the environment,
 * a system Chrome with Chromium's FAKE camera device, fresh contexts, never a
 * real browser profile, and only the reserved synthetic @example.com
 * profiles.
 *
 * Run: PLAYWRIGHT_MODULE=/absolute/path/to/playwright/index.mjs \
 *        node test/browser/movementAssessment.browser.mjs [dist-directory] [label]
 *
 * What is real here: the production app bundle, the camera permission and
 * MediaStream lifecycle (Chromium fake device), the model file download and
 * its on-device SHA-256 check, the adapter, geometry, segmentation and UI.
 * What is stubbed: ONLY dist/movement/pose-runtime.js, replaced through
 * page.route() by test/browser/fixtures/stubPoseRuntime.js, which returns
 * MediaPipe-shaped landmarks for a synthetic stick figure. This proves
 * pipeline behaviour and lifecycle; it says nothing about real pose-model
 * accuracy (see poseSmoke.browser.mjs for the real runtime).
 */
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { resolve, extname, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { DEMO_PROFILE_A, DEMO_PROFILE_B } from "../../js/dev/demoFixtures.js";

const here = dirname(fileURLToPath(import.meta.url));
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || "playwright");
const root = resolve(process.argv[2] || "dist");
const label = process.argv[3] || "production";
const out = `/tmp/physiq-m6-browser-${label}`;
await mkdir(out, { recursive: true });

const stub = (await build({
  entryPoints: [resolve(here, "fixtures/stubPoseRuntime.js")], bundle: true, format: "iife",
  globalName: "PhysiqPoseRuntime", target: ["es2018"], write: false, logLevel: "silent"
})).outputFiles[0].text;

const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".wasm": "application/wasm", ".md": "text/markdown", ".txt": "text/plain" };
const served = [];
const server = createServer(async (req, res) => {
  try {
    const pathname = new URL(req.url, "http://localhost").pathname;
    const file = resolve(root, "." + (pathname === "/" ? "/index.html" : pathname));
    if (!file.startsWith(root + "/")) throw new Error("Path outside fixture server");
    const body = await readFile(file);
    served.push(pathname);
    res.setHeader("Content-Type", TYPES[extname(file)] || "application/octet-stream");
    res.end(body);
  } catch { res.statusCode = 404; res.end("Not found"); }
});
await new Promise(r => server.listen(0, "127.0.0.1", r));
const url = `http://127.0.0.1:${server.address().port}`;

const browser = await chromium.launch({
  headless: true,
  executablePath: process.env.CHROME_EXECUTABLE || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  args: ["--use-fake-device-for-media-stream"]
});

const A = "demo-a@example.com", B = "demo-b@example.com";
const checks = [];
async function check(name, fn) { await fn(); checks.push(name); console.log("PASS", name); }

/* Instrumentation injected before the app runs: wraps getUserMedia to log
   calls/constraints and keep stream references (to assert every track is
   stopped), and records phase transitions of the assessment screen. */
function instrument() {
  window.__gum = { calls: [], streams: [], errors: [] };
  const md = navigator.mediaDevices;
  if (md && md.getUserMedia) {
    const original = md.getUserMedia.bind(md);
    md.getUserMedia = async (constraints) => {
      window.__gum.calls.push(JSON.parse(JSON.stringify(constraints)));
      try { const s = await original(constraints); window.__gum.streams.push(s); return s; }
      catch (e) { window.__gum.errors.push(e.name); throw e; }
    };
    const enumerate = md.enumerateDevices && md.enumerateDevices.bind(md);
    if (enumerate) md.enumerateDevices = async () => { window.__gum.enumerate = (window.__gum.enumerate || 0) + 1; return enumerate(); };
  }
  window.__phases = [];
  setInterval(() => {
    const el = document.querySelector(".ma-screen");
    const p = el ? el.getAttribute("data-phase") : null;
    if (p && window.__phases[window.__phases.length - 1] !== p) window.__phases.push(p);
  }, 10);
}

async function newAppPage(context) {
  const page = await context.newPage();
  const errors = [], consoleErrors = [], requests = [];
  page.on("pageerror", e => errors.push(e.message));
  page.on("console", m => { if (m.type() === "error") consoleErrors.push(m.text()); });
  page.on("request", r => requests.push({ url: r.url(), method: r.method(), at: Date.now() }));
  await page.addInitScript(instrument);
  await page.route(/fonts\.googleapis\.com|fonts\.gstatic\.com/, r => r.fulfill({ status: 200, body: "" }));
  await page.route(/\/movement\/pose-runtime\.js$/, r => r.fulfill({ status: 200, contentType: "text/javascript", body: stub }));
  return { page, errors, consoleErrors, requests };
}

async function seed(page) {
  await page.evaluate(({ A, B, profileA, profileB }) => {
    const pad = (n) => (n < 10 ? "0" : "") + n;
    const d = new Date(); d.setHours(0, 0, 0, 0);
    d.setDate(d.getDate() - (d.getDay() === 0 ? 6 : d.getDay() - 1));
    const monday = d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate());
    const put = (email, suffix, v) => localStorage.setItem(`pq_${email}_${suffix}`, JSON.stringify(v));
    const now = Date.now();
    for (const [email, profile] of [[A, profileA], [B, profileB]]) {
      put(email, "profile", profile);
      put(email, "workoutLog", email === A ? [{ id: 501, title: "Synthetic squat day", startedAt: now - 90000000, finishedAt: now - 86400000,
        exercises: [{ name: "Squat", muscle: "Quads", sets: [{ done: true, weight: 185, reps: 5 }, { done: true, weight: 185, reps: 5 }] }] }] : []);
      put(email, "routines", []);
      put(email, "recentFoods", []);
      localStorage.setItem(`pq_${email}_lastCheckin`, monday);
    }
    localStorage.setItem("pq_last_email", A);
  }, { A, B, profileA: { ...DEMO_PROFILE_A, weight: 180 }, profileB: { ...DEMO_PROFILE_B, weight: 142 } });
  await page.reload();
}

const openExercise = async (page) => {
  await page.locator(".nav-add-btn").click();
  await page.locator(".exercise-card").click();
  await page.getByText("Weekly Muscle Tracker", { exact: true }).waitFor();
};
const openAssessment = async (page) => {
  await page.locator(".ma-entry").click();
  await page.getByRole("button", { name: "Start Camera", exact: true }).waitFor();
};
const closePopup = (page) => page.getByRole("button", { name: "Close", exact: true }).click();
const phase = (page) => page.locator(".ma-screen").getAttribute("data-phase");
const waitPhase = (page, p, timeout = 20000) => page.waitForSelector(`.ma-screen[data-phase="${p}"]`, { timeout });
const setScenario = (page, s) => page.evaluate((s) => { window.__stubPose = Object.assign(window.__stubPose || {}, { scenario: s }); }, s);
const liveTracks = (page) => page.evaluate(() => window.__gum.streams.flatMap(s => s.getTracks()).filter(t => t.readyState !== "ended").length);
const allTracks = (page) => page.evaluate(() => window.__gum.streams.flatMap(s => s.getTracks()).length);
const storage = (page) => page.evaluate(() => Object.fromEntries(Object.entries(localStorage).sort(([a], [b]) => a.localeCompare(b))));
const text = (page) => page.locator(".ma-screen").innerText();
const FORBIDDEN = /\b(injur\w*|risk\w*|safe|unsafe|force|stress|strain|tendon load|tissue load|recover\w*|ready|readiness|healed?|diagnos\w*|good form|bad form|optimal|should|recommend\w*|score|grade)\b/i;
const LIMITATION = "This prototype estimates 2D movement mechanics from a single camera view. It does not measure force, tissue load, injury risk, or recovery.";
const SEPARATION = "It is separate from Tissue Load and Recovery Guidance and does not change your workouts.";

const results = { label, checks: null, timings: {}, network: null, errors: null };
const grant = await browser.newContext({ viewport: { width: 375, height: 812 }, locale: "en-US", permissions: ["camera"] });
const { page, errors, consoleErrors, requests } = await newAppPage(grant);

async function completeAssessment(scenario = "squat") {
  await setScenario(page, scenario);
  await page.getByRole("button", { name: "Start Camera", exact: true }).click();
  await waitPhase(page, "results", 30000);
}

try {
  await page.goto(url + "/");
  await page.getByRole("button", { name: "Continue", exact: true }).waitFor();
  await seed(page);
  await openExercise(page);
  const storageBeforeAssessments = await storage(page);

  await check("1. Movement Assessment entry is visible in the Exercise screen, labelled as a separate prototype", async () => {
    const entry = page.locator(".ma-entry");
    await entry.waitFor();
    const t = await entry.innerText();
    assert.match(t, /Movement Assessment/);
    assert.match(t, /Prototype/i);
    assert.match(t, /Separate from Tissue Load and Recovery Guidance/);
  });

  await check("2. no permission request, camera access or runtime/model download before Start Camera", async () => {
    await openAssessment(page);
    const gum = await page.evaluate(() => window.__gum);
    assert.equal(gum.calls.length, 0);
    assert.equal(gum.enumerate || 0, 0);
    assert.equal(requests.filter(r => /\/movement\//.test(r.url)).length, 0, "nothing under movement/ fetched yet");
    assert.equal(await page.locator("video").count(), 0);
    const perm = await page.evaluate(async () => (await navigator.permissions.query({ name: "camera" })).state);
    results.cameraPermissionBeforeStart = perm;
  });

  await check("8. setup instructions, privacy notice and protocol are visible as text", async () => {
    const t = await text(page);
    assert.match(t, /Camera video is processed on this device for this assessment\. Raw video is not saved or uploaded by this prototype\./);
    assert.match(t, /Stand side-on/);
    assert.match(t, /head to feet/);
    assert.match(t, /the app does not measure distance/);
    assert.match(t, /Step 1 of 4: Setup/i);
  });

  let startClickedAt;
  await check("3+5. grant path: model loads and is verified, then a video-only preview starts", async () => {
    await setScenario(page, "squat");
    startClickedAt = Date.now();
    await page.getByRole("button", { name: "Start Camera", exact: true }).click();
    await waitPhase(page, "positioning");
    results.timings.startToPositioningMs = Date.now() - startClickedAt;
    const gum = await page.evaluate(() => window.__gum);
    assert.equal(gum.calls.length, 1);
    assert.equal(gum.calls[0].audio, false);
    assert.ok(gum.calls[0].video);
    await page.waitForFunction(() => { const v = document.querySelector("video.ma-video"); return v && v.readyState >= 2 && v.videoWidth > 0; });
    const v = await page.evaluate(() => { const v = document.querySelector("video.ma-video"); return { w: v.videoWidth, h: v.videoHeight, muted: v.muted, inline: v.playsInline, live: v.srcObject && v.srcObject.getTracks().every(t => t.readyState === "live"), audio: v.srcObject.getAudioTracks().length }; });
    assert.equal(v.muted, true);
    assert.equal(v.inline, true);
    assert.equal(v.live, true);
    assert.equal(v.audio, 0, "no audio track");
    results.previewSize = v.w + "x" + v.h;
    const stubLog = await page.evaluate(() => window.__stubPose);
    assert.equal(stubLog.modelBytes, 9398198, "the real model file was fetched, verified and handed over as bytes");
    assert.equal(stubLog.options.baseOptions.delegate, "CPU");
    assert.equal(stubLog.options.runningMode, "VIDEO");
    assert.equal(stubLog.options.numPoses, 2);
    assert.equal(stubLog.options.baseOptions.modelAssetPath, undefined, "MediaPipe never fetches a model URL");
    assert.match(stubLog.fileset.wasmBinaryPath, new RegExp("^" + url.replace(/\./g, "\\.") + "/movement/mediapipe/vision_wasm_internal\\.wasm$"));
  });

  await check("9+10. calibration, then capture ('Squat now') states are shown with step labels", async () => {
    await waitPhase(page, "capturing");
    const phases = await page.evaluate(() => window.__phases);
    assert.ok(phases.includes("calibrating"), phases.join(","));
    assert.match(await text(page), /Step 4 of 4: One squat/i);
    assert.match(await page.locator(".ma-status").innerText(), /Squat now: one slow squat, then stand still\./);
    assert.equal(await page.getByRole("button", { name: "Done", exact: true }).count(), 1);
  });

  let first;
  await check("12-16. the synthetic sequence gives the hand-derived ROM, timing, trace and explicit symmetry state", async () => {
    await waitPhase(page, "results", 20000);
    const t = await text(page);
    first = t;
    assert.match(t, /Apparent 2D knee ROM\s+80°/);
    assert.match(t, /standing 175° → minimum 95°/);
    const secs = (re) => parseFloat(t.match(re)[1]);
    assert.ok(Math.abs(secs(/Descent time\s+([\d.]+) s/) - 1.08) <= 0.12, t);
    assert.ok(Math.abs(secs(/Ascent time\s+([\d.]+) s/) - 1.48) <= 0.12, t);
    assert.ok(Math.abs(secs(/Total repetition time\s+([\d.]+) s/) - 2.56) <= 0.12, t);
    assert.match(t, /Apparent 2D trunk–thigh angle change\s+75°/);
    assert.match(t, /Symmetry\s+Not estimated for this capture mode/);
    assert.match(t, /Left\/right symmetry is not estimated from a single sagittal capture in this prototype\./);
    assert.match(t, /Capture quality: Sufficient/);
    const d = await page.locator("path.ma-line-knee").getAttribute("d");
    assert.match(d, /^M[\d. ]+(L[\d. ]+)+$/);
    assert.equal(await page.locator("svg[role=img] title").textContent(), "Joint-angle trace");
    results.firstResultText = t;
  });

  await check("17. no injury, recovery, tissue-force, score or form language in the results", async () => {
    const t = (await page.locator("body").innerText()).split(LIMITATION).join(" ").split(SEPARATION).join(" ");
    const maText = (await text(page)).split(LIMITATION).join(" ");
    assert.doesNotMatch(maText, FORBIDDEN);
    assert.match(await text(page), new RegExp(LIMITATION.replace(/[.()]/g, "\\$&")));
    assert.ok(t.length > 0);
  });

  await check("camera and runtime released at completion; one inference at a time; monotonic timestamps", async () => {
    assert.equal(await liveTracks(page), 0);
    assert.equal(await page.locator("video").count(), 0);
    const s = await page.evaluate(() => window.__stubPose);
    assert.equal(s.closed, s.created);
    assert.equal(s.maxInFlight, 1);
    assert.equal(s.nonMonotonic, 0);
    assert.deepEqual(Object.keys(s.sourceTypes), ["HTMLCanvasElement"], "frames reach the runtime only via the staging canvas");
    results.timings.detectCallsFirstRun = s.detectCalls;
  });

  await check("18. Retake resets the result and starts a fresh capture that reproduces the same result", async () => {
    await page.getByRole("button", { name: "Retake", exact: true }).click();
    await waitPhase(page, "positioning");
    assert.doesNotMatch(await text(page), /Apparent 2D knee ROM/);
    await waitPhase(page, "results", 30000);
    const t = await text(page);
    assert.equal(t.match(/Apparent 2D knee ROM\s+\d+°/)[0], first.match(/Apparent 2D knee ROM\s+\d+°/)[0]);
    assert.equal(await liveTracks(page), 0);
  });

  await check("6. Cancel during capture stops every track and releases the runtime", async () => {
    await page.getByRole("button", { name: "Retake", exact: true }).click();
    await waitPhase(page, "capturing");
    assert.equal(await liveTracks(page), 1);
    await page.getByRole("button", { name: "Cancel", exact: true }).click();
    await waitPhase(page, "idle");
    assert.equal(await liveTracks(page), 0);
    const s = await page.evaluate(() => window.__stubPose);
    assert.equal(s.closed, s.created);
  });

  await check("7. reopen after cancel works", async () => {
    await page.getByRole("button", { name: "Start Camera", exact: true }).click();
    await waitPhase(page, "positioning");
    assert.equal(await liveTracks(page), 1);
  });

  await check("19. leaving (Back, or closing the Exercise popup mid-capture) stops the camera", async () => {
    await page.getByRole("button", { name: "‹ Back", exact: true }).click();
    await page.locator(".ma-entry").waitFor();
    assert.equal(await liveTracks(page), 0);
    await openAssessment(page);
    await page.getByRole("button", { name: "Start Camera", exact: true }).click();
    await waitPhase(page, "capturing");
    await closePopup(page);
    await page.waitForTimeout(100);
    assert.equal(await liveTracks(page), 0);
    const s = await page.evaluate(() => window.__stubPose);
    assert.equal(s.closed, s.created);
  });

  await check("11. guidance for no person / two people / frontal view, then the insufficient-data state", async () => {
    await openExercise(page);
    await openAssessment(page);
    for (const [scenario, msg] of [["none", /No person detected yet/], ["two", /More than one person is in view/], ["front", /Turn so that your side faces the camera/], ["low", /hip, knee and ankle are not clearly visible/]]) {
      await setScenario(page, scenario);
      await page.getByRole("button", { name: "Start Camera", exact: true }).click();
      await page.waitForFunction((src) => new RegExp(src).test(document.querySelector(".ma-status")?.textContent || ""), msg.source);
      assert.equal(await page.locator(".ma-status").getAttribute("aria-live"), "polite");
      await page.getByRole("button", { name: "Cancel", exact: true }).click();
      await waitPhase(page, "idle");
    }
    await setScenario(page, "stand");
    await page.getByRole("button", { name: "Start Camera", exact: true }).click();
    await waitPhase(page, "insufficient", 25000);
    const t = await text(page);
    assert.match(t, /Insufficient movement data/);
    assert.match(t, /No squat could be told apart from small movements/);
    assert.doesNotMatch(t, /Apparent 2D knee ROM|\b\d+°/);
    assert.equal(await liveTracks(page), 0);
  });

  await check("11b. no usable pose for 45 s ends in an insufficient-pose state with the camera off", async () => {
    await setScenario(page, "none");
    await page.getByRole("button", { name: "Retake", exact: true }).click();
    await waitPhase(page, "insufficient", 60000);
    assert.match(await text(page), /A usable standing, side-on pose was not established within 45 seconds\. Last message: No person detected yet/);
    assert.equal(await liveTracks(page), 0);
  });

  await check("background: visibilitychange→hidden and pagehide stop capture and say nothing was saved", async () => {
    for (const fire of [
      () => { Object.defineProperty(document, "visibilityState", { value: "hidden", configurable: true }); document.dispatchEvent(new Event("visibilitychange")); },
      () => { window.dispatchEvent(new PageTransitionEvent("pagehide", { persisted: false })); }
    ]) {
      await setScenario(page, "squat");
      await page.getByRole("button", { name: /^(Retake|Try again|Start Camera)$/ }).first().click();
      await waitPhase(page, "capturing");
      await page.evaluate(fire);
      await waitPhase(page, "error");
      assert.match(await page.locator("[role=alert]").innerText(), /left the foreground\. The camera was turned off and nothing was saved\./);
      assert.equal(await liveTracks(page), 0);
      await page.evaluate(() => { delete document.visibilityState; });
    }
  });

  await check("21. an assessment writes nothing: localStorage unchanged, no IndexedDB, no Cache Storage; reload discards the result", async () => {
    await page.getByRole("button", { name: "Try again", exact: true }).click();
    await waitPhase(page, "results", 30000);
    assert.deepEqual(await storage(page), storageBeforeAssessments);
    const stores = await page.evaluate(async () => ({ idb: indexedDB.databases ? (await indexedDB.databases()).map(d => d.name) : "n/a", caches: await caches.keys() }));
    assert.deepEqual(stores, { idb: [], caches: [] });
    await page.reload();
    await openExercise(page);
    await openAssessment(page);
    assert.equal(await phase(page), "idle");
    assert.doesNotMatch(await text(page), /Apparent 2D knee ROM/);
    assert.deepEqual(await storage(page), storageBeforeAssessments);
  });

  await check("20. profile switch: no capture or result carries over to another profile", async () => {
    await completeAssessment();
    await closePopup(page);
    assert.equal(await liveTracks(page), 0);
    await page.getByRole("button", { name: "Profile", exact: true }).click();
    await page.getByRole("button", { name: "Log out", exact: true }).click();
    await page.getByPlaceholder("you@example.com").fill(B);
    await page.getByRole("button", { name: "Continue", exact: true }).click();
    await openExercise(page);
    await openAssessment(page);
    assert.equal(await phase(page), "idle");
    assert.doesNotMatch(await page.locator("body").innerText(), /Apparent 2D knee ROM/);
    const all = await storage(page);
    assert.equal(Object.keys(all).some(k => /movement|pose|assessment/i.test(k)), false);
    await closePopup(page);
    await page.getByRole("button", { name: "Profile", exact: true }).click();
    await page.getByRole("button", { name: "Log out", exact: true }).click();
    await page.getByPlaceholder("you@example.com").fill(A);
    await page.getByRole("button", { name: "Continue", exact: true }).click();
  });

  await check("22+23. Tissue Load and Recovery Guidance still render from the same history", async () => {
    await openExercise(page);
    await page.getByRole("button", { name: "Tissue Load", exact: true }).click();
    await page.locator(".tl-card").waitFor();
    assert.match(await page.locator(".tl-card").innerText(), /tissue-load-v0\.1/);
    const rec = await page.locator(".rec-card").innerText();
    assert.match(rec, /Recovery Guidance/);
    assert.match(rec, /recovery-guidance-v0\.1/);
    assert.match(rec, /Quad/i);
    await closePopup(page);
  });

  await check("24. Nutrition: a manual meal can still be logged", async () => {
    await page.locator(".nav-add-btn").click();
    await page.locator(".eats-card").click();
    await page.getByRole("button", { name: /Manual/ }).click();
    await page.getByPlaceholder("Meal name (e.g. Grilled Chicken)").fill("Synthetic M6 regression meal");
    await page.locator(".eats-manual-input").first().fill("321");
    await page.getByRole("button", { name: "+ Log Meal", exact: true }).click();
    await page.getByText("Synthetic M6 regression meal logged!").waitFor();
  });

  await check("25. Barcode path still initialises (web: manual lookup against a stubbed Open Food Facts)", async () => {
    await page.route(/world\.openfoodfacts\.org\/api\/v2\/product\//, r => r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ status: 1, product: { product_name: "Synthetic Barcode Oats", brands: "Fixture", nutriments: { "energy-kcal_100g": 380, proteins_100g: 13, carbohydrates_100g: 60, fat_100g: 7 } } }) }));
    const cameraCallsBefore = await page.evaluate(() => window.__gum.calls.length);
    await page.getByRole("button", { name: /Scan/ }).click();
    await page.getByText("Barcode Scanner", { exact: true }).waitFor();
    await page.getByPlaceholder("Enter barcode number...").fill("0000000000017");
    await page.getByRole("button", { name: "Lookup", exact: true }).click();
    await page.getByText("Synthetic Barcode Oats").first().waitFor();
    assert.equal(await page.evaluate(() => window.__gum.calls.length), cameraCallsBefore, "the web barcode path never opens the camera");
    await closePopup(page);
  });

  await check("responsive: 320 / 375 / 390 px — no horizontal overflow; controls reachable", async () => {
    for (const width of [320, 375, 390]) {
      await page.setViewportSize({ width, height: 740 });
      await openExercise(page);
      await openAssessment(page);
      const overflow = () => page.evaluate(() => {
        const els = [document.documentElement, document.body, document.getElementById("app"), document.querySelector(".popup-content")].filter(Boolean);
        return els.some(e => e.scrollWidth > e.clientWidth + 1);
      });
      assert.equal(await overflow(), false, "intro overflow at " + width);
      await page.screenshot({ path: `${out}/intro-${width}.png`, animations: "disabled" });
      await setScenario(page, "squat");
      await page.getByRole("button", { name: "Start Camera", exact: true }).click();
      await waitPhase(page, "capturing");
      assert.equal(await overflow(), false, "capture overflow at " + width);
      const box = await page.getByRole("button", { name: "Cancel", exact: true }).boundingBox();
      assert.ok(box && box.x >= 0 && box.x + box.width <= width, "Cancel inside viewport");
      await page.screenshot({ path: `${out}/capture-${width}.png`, animations: "disabled" });
      await waitPhase(page, "results", 30000);
      assert.equal(await overflow(), false, "results overflow at " + width);
      // The popup scrolls internally, so a tall viewport shows the whole result.
      await page.setViewportSize({ width, height: 2600 });
      assert.equal(await overflow(), false, "results overflow at " + width + " (tall)");
      await page.screenshot({ path: `${out}/results-${width}.png`, animations: "disabled" });
      await page.setViewportSize({ width, height: 740 });
      await closePopup(page);
    }
    await page.setViewportSize({ width: 375, height: 812 });
  });

  await check("network: only same-origin static files; no upload, no POST, nothing but app assets after Start", async () => {
    const external = requests.filter(r => !r.url.startsWith(url) && !/fonts\.(googleapis|gstatic)\.com|world\.openfoodfacts\.org|^data:|^blob:/.test(r.url));
    assert.deepEqual(external, []);
    assert.deepEqual(requests.filter(r => r.method !== "GET"), []);
    const afterStart = requests.filter(r => r.at >= startClickedAt && r.url.startsWith(url)).map(r => new URL(r.url).pathname);
    assert.ok(afterStart.every(p => /^\/movement\/(pose-runtime\.js|mediapipe\/vision_wasm_internal\.(js|wasm)|models\/pose_landmarker_full\.task)$/.test(p) || p === "/" || /^\/(app\.min\.js|styles\.min\.css|index\.html|dev-seed\.js)$/.test(p)), afterStart.join(","));
    const offRequests = requests.filter(r => /openfoodfacts/.test(r.url));
    assert.ok(offRequests.every(r => /\/api\/v2\/product\/0000000000017\.json/.test(r.url)), "Open Food Facts is only the barcode check");
    results.network = { total: requests.length, sameOrigin: [...new Set(requests.filter(r => r.url.startsWith(url)).map(r => new URL(r.url).pathname))].sort(), externalRouted: [...new Set(requests.filter(r => !r.url.startsWith(url)).map(r => new URL(r.url).host))] };
  });

  await check("26. no runtime or console errors in the grant context", async () => {
    assert.deepEqual(errors, []);
    assert.deepEqual(consoleErrors, []);
  });

  /* Denial runs in a fresh context without the camera permission. */
  const deny = await browser.newContext({ viewport: { width: 375, height: 812 }, locale: "en-US" });
  const d = await newAppPage(deny);
  await check("4. permission denied: concise recovery guidance, no crash, no automatic re-prompt", async () => {
    await d.page.goto(url + "/");
    await d.page.getByRole("button", { name: "Continue", exact: true }).waitFor();
    await seed(d.page);
    await openExercise(d.page);
    await openAssessment(d.page);
    await d.page.getByRole("button", { name: "Start Camera", exact: true }).click();
    await waitPhase(d.page, "error");
    assert.equal(await d.page.locator("[role=alert]").innerText(), "Camera access is required for this assessment. You can enable it in your device or browser settings and try again.");
    const gum = await d.page.evaluate(() => window.__gum);
    assert.deepEqual(gum.errors, ["NotAllowedError"]);
    await d.page.waitForTimeout(1500);
    assert.equal((await d.page.evaluate(() => window.__gum.calls.length)), 1, "no automatic re-prompt");
    await d.page.getByRole("button", { name: "Try again", exact: true }).click();
    await waitPhase(d.page, "error");
    assert.equal((await d.page.evaluate(() => window.__gum.calls.length)), 2, "only an explicit retry asks again");
    assert.deepEqual(d.errors, []);
    await d.page.screenshot({ path: `${out}/denied-375.png` });
  });
  await deny.close();

  results.checks = checks;
  results.errors = { errors, consoleErrors };
  await writeFile(`${out}/results.json`, JSON.stringify(results, null, 2));
  console.log(`\n${checks.length} grouped checks passed (${label}). Artifacts: ${out}`);
} catch (error) {
  await page.screenshot({ path: `${out}/failure.png`, fullPage: true }).catch(() => {});
  await writeFile(`${out}/failure.txt`, error.stack + "\n\n" + await page.locator("body").innerText().catch(() => ""));
  console.error(error);
  console.error("Artifacts:", out);
  process.exitCode = 1;
} finally {
  await browser.close();
  await new Promise(r => server.close(r));
}
