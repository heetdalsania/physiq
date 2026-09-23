/* Milestone 6 — REAL pose-engine smoke test (runtime integration only).
 *
 * Runs the shipped dist/movement/ runtime, WASM and model — nothing stubbed —
 * on a controlled input: MediaPipe's own published test image
 * (mediapipe-assets/pose.jpg, used by MediaPipe's PoseLandmarker tests),
 * downloaded at run time and verified against a pinned SHA-256. The image
 * is NOT committed to this repository and is never bundled with the app.
 *
 *   A. In-page: the app's real adapter (createMediaPipePoseProvider) loads
 *      runtime + WASM + model (on-device SHA-256 check included) and
 *      estimates landmarks from a real <video> element fed by
 *      canvas.captureStream() of the image. Landmarks are compared with
 *      MediaPipe's published expected landmarks for the same image, and
 *      initialisation and per-frame inference times are measured.
 *   B. End to end: the image is converted to a Y4M file and used as
 *      Chromium's fake camera; the production app runs Movement Assessment
 *      with the real runtime while all network requests are recorded.
 *   C. End to end with Chromium's default synthetic camera pattern (no
 *      person): the real model must report no pose.
 *
 * This is NOT scientific validation. One static image says nothing about
 * angle accuracy, and a still frame cannot contain a squat.
 *
 * Run: PLAYWRIGHT_MODULE=/abs/path/playwright/index.mjs node test/browser/poseSmoke.browser.mjs [dist]
 */
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { createHash } from "node:crypto";
import { resolve, extname, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { DEMO_PROFILE_A } from "../../js/dev/demoFixtures.js";

const here = dirname(fileURLToPath(import.meta.url));
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || "playwright");
const root = resolve(process.argv[2] || "dist");
const out = "/tmp/physiq-m6-pose-smoke";
await mkdir(out, { recursive: true });
const CHROME = process.env.CHROME_EXECUTABLE || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

const FIXTURE = {
  image: { url: "https://storage.googleapis.com/mediapipe-assets/pose.jpg", sha256: "c8a830ed683c0276d713dd5aeda28f415f10cd6291972084a40d0d8b934ed62b" },
  expected: { url: "https://storage.googleapis.com/mediapipe-assets/pose_landmarks.pbtxt", sha256: "69c79cdf3964d7819776eab1172e47e70684139d72a6d7edcbdd62dbb2ca5527" }
};
async function fixture(f, name) {
  const path = `${out}/${name}`;
  if (!existsSync(path)) {
    const res = await fetch(f.url);   // test-harness download, never part of the app
    assert.ok(res.ok, "download " + f.url);
    await writeFile(path, Buffer.from(await res.arrayBuffer()));
  }
  const bytes = await readFile(path);
  assert.equal(createHash("sha256").update(bytes).digest("hex"), f.sha256, name + " hash");
  return bytes;
}
const image = await fixture(FIXTURE.image, "pose.jpg");
const expectedText = (await fixture(FIXTURE.expected, "pose_landmarks.pbtxt")).toString("utf8");
const expected = [...expectedText.matchAll(/landmark \{\s*x: ([-\d.e]+)\s*y: ([-\d.e]+)\s*z: [-\d.e]+\s*visibility: ([-\d.e]+)/g)]
  .map(m => ({ x: +m[1], y: +m[2], visibility: +m[3] }));
assert.equal(expected.length, 33);

const smokeBundle = (await build({ entryPoints: [resolve(here, "fixtures/smokeEntry.js")], bundle: true, format: "iife", target: ["es2018"], write: false, logLevel: "silent" })).outputFiles[0].text;

const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".wasm": "application/wasm", ".jpg": "image/jpeg" };
const server = createServer(async (req, res) => {
  try {
    const pathname = new URL(req.url, "http://localhost").pathname;
    if (pathname === "/__smoke.html") { res.setHeader("Content-Type", "text/html"); return res.end("<!doctype html><html><body><script>" + smokeBundle + "</script></body></html>"); }
    if (pathname === "/__fixture/pose.jpg") { res.setHeader("Content-Type", "image/jpeg"); return res.end(image); }
    const file = resolve(root, "." + (pathname === "/" ? "/index.html" : pathname));
    if (!file.startsWith(root + "/")) throw new Error("outside");
    res.setHeader("Content-Type", TYPES[extname(file)] || "application/octet-stream");
    res.end(await readFile(file));
  } catch { res.statusCode = 404; res.end("Not found"); }
});
await new Promise(r => server.listen(0, "127.0.0.1", r));
const url = `http://127.0.0.1:${server.address().port}`;
const report = { fixture: FIXTURE, a: null, b: null, c: null };
const checks = [];
async function check(name, fn) { await fn(); checks.push(name); console.log("PASS", name); }

/* Wraps the REAL runtime's detectForVideo (via a setter trap on the global
   the runtime script defines) to time every inference and keep the last raw
   result — instrumentation only; results pass through unchanged. */
function instrumentRuntime() {
  window.__rt = { detect: 0, ms: [], poses: [], created: 0, closed: 0, createMs: null };
  let value;
  Object.defineProperty(window, "PhysiqPoseRuntime", {
    configurable: true,
    get() { return value; },
    set(v) {
      const PL = v.PoseLandmarker;
      const create = PL.createFromOptions.bind(PL);
      PL.createFromOptions = async (...args) => {
        const t0 = performance.now();
        const lm = await create(...args);
        window.__rt.createMs = performance.now() - t0;
        window.__rt.created += 1;
        const detect = lm.detectForVideo.bind(lm);
        const close = lm.close.bind(lm);
        lm.detectForVideo = (video, ts) => {
          const s = performance.now();
          const r = detect(video, ts);
          window.__rt.ms.push(performance.now() - s);
          window.__rt.detect += 1;
          window.__rt.poses.push(r && r.landmarks ? r.landmarks.length : -1);
          if (r && r.landmarks && r.landmarks[0]) {
            const keep = { left_hip: 23, right_hip: 24, left_knee: 25, right_knee: 26, left_ankle: 27, right_ankle: 28, left_heel: 29, right_heel: 30, nose: 0 };
            window.__rt.lastLandmarks = Object.fromEntries(Object.entries(keep).map(([k, i]) => [k, { x: +r.landmarks[0][i].x.toFixed(3), y: +r.landmarks[0][i].y.toFixed(3), visibility: +r.landmarks[0][i].visibility.toFixed(3) }]));
            window.__rt.frameSize = [video.videoWidth || video.width, video.videoHeight || video.height];
            window.__rt.sourceType = video.constructor && video.constructor.name;
          }
          return r;
        };
        lm.close = () => { window.__rt.closed += 1; return close(); };
        return lm;
      };
      value = v;
    }
  });
}

try {
  /* ─── A. in-page adapter run on the real runtime ───────────────────── */
  const b1 = await chromium.launch({ headless: true, executablePath: CHROME });
  const p1 = await (await b1.newContext()).newPage();
  const p1Errors = [];
  p1.on("pageerror", e => p1Errors.push(e.message));
  await p1.addInitScript(instrumentRuntime);
  await p1.goto(url + "/__smoke.html");

  await check("A1. real runtime + WASM + model initialise through the app's adapter (hash verified on device)", async () => {
    report.a = await p1.evaluate(async (assetBase) => {
      const t0 = performance.now();
      const provider = await window.__smoke.createMediaPipePoseProvider({ assetBase });
      const initMs = performance.now() - t0;
      return { initMs, identity: provider.identity, modelBytes: provider.modelBytes.length, ok: typeof provider.detect === "function" };
    }, url + "/");
    assert.equal(report.a.ok, true);
    assert.equal(report.a.modelBytes, 9398198);
    assert.equal(report.a.identity.modelVerifiedOnDevice, true);
    assert.equal(report.a.identity.providerVersion, "0.10.35");
  });

  await check("A2. frames process and landmarks are returned in the pose-frame-v1 contract", async () => {
    const r = await p1.evaluate(async (assetBase) => {
      const img = new Image();
      img.src = "/__fixture/pose.jpg";
      await img.decode();
      const canvas = document.createElement("canvas");
      canvas.width = 960; canvas.height = 640;
      const ctx = canvas.getContext("2d");
      const paint = () => ctx.drawImage(img, 0, 0, 960, 640);
      paint();
      const timer = setInterval(paint, 33);
      const video = document.createElement("video");
      video.muted = true; video.playsInline = true;
      video.srcObject = canvas.captureStream(30);
      await video.play();
      await new Promise(r => { const w = () => (video.readyState >= 2 && video.videoWidth ? r() : requestAnimationFrame(w)); w(); });
      const provider = await window.__smoke.createMediaPipePoseProvider({ assetBase });
      const frames = [];
      const times = [];
      for (let i = 0; i < 40; i++) {
        await new Promise(r => requestAnimationFrame(r));
        const s = performance.now();
        frames.push(provider.detect(video, 1000 + i * 66));
        times.push(performance.now() - s);
      }
      provider.close();
      clearInterval(timer);
      video.srcObject.getTracks().forEach(t => t.stop());
      const last = frames[frames.length - 1];
      const sorted = times.slice(5).sort((a, b) => a - b);
      return {
        statuses: frames.map(f => f.status),
        contract: last.contract,
        size: [last.frameWidth, last.frameHeight],
        landmarks: last.landmarks,
        medianMs: sorted[Math.floor(sorted.length / 2)],
        p90Ms: sorted[Math.floor(sorted.length * 0.9)],
        firstMs: times[0],
        calibration: window.__smoke.evaluateCalibration(frames.slice(-25).map((f, i) => Object.assign({}, f, { timestampMs: i * 100 })))
      };
    }, url + "/");
    report.a.frames = r;
    assert.equal(r.contract, "pose-frame-v1");
    assert.deepEqual(r.size, [960, 640]);
    assert.ok(r.statuses.filter(s => s === "pose").length >= 35, r.statuses.join(","));
    Object.entries(r.landmarks).forEach(([name, lm]) => {
      assert.ok(lm, name + " present");
      assert.ok(Number.isFinite(lm.x) && Number.isFinite(lm.y) && lm.visibility >= 0 && lm.visibility <= 1, name);
    });
  });

  await check("A3. landmarks agree with MediaPipe's published expectation for this image (integration sanity, not accuracy)", async () => {
    const IDX = { nose: 0, left_shoulder: 11, right_shoulder: 12, left_hip: 23, right_hip: 24, left_knee: 25, right_knee: 26, left_ankle: 27, right_ankle: 28, left_heel: 29, right_heel: 30, left_foot_index: 31, right_foot_index: 32 };
    const lm = report.a.frames.landmarks;
    const diffs = Object.entries(IDX).map(([name, i]) => {
      const e = expected[i];
      const dx = lm[name].x / 960 - e.x, dy = lm[name].y / 640 - e.y;
      return { name, dist: Math.hypot(dx, dy) };
    });
    report.a.expectedComparison = diffs;
    const worst = Math.max(...diffs.map(d => d.dist));
    const meanDist = diffs.reduce((s, d) => s + d.dist, 0) / diffs.length;
    report.a.expectedMeanDist = meanDist;
    report.a.expectedWorstDist = worst;
    // Same image, different model variant/version than MediaPipe's own test:
    // expect agreement to a few percent of the frame, which proves the
    // coordinate conventions (normalisation, x/y order, side labels) are right.
    assert.ok(meanDist < 0.03, "mean normalised distance " + meanDist);
    assert.ok(worst < 0.08, "worst normalised distance " + worst);
    assert.deepEqual(p1Errors, []);
  });
  await check("A4. retake path: verified model bytes are reusable for a second landmarker", async () => {
    const r = await p1.evaluate(async (assetBase) => {
      const first = await window.__smoke.createMediaPipePoseProvider({ assetBase });
      const bytes = first.modelBytes;
      first.close();
      const second = await window.__smoke.createMediaPipePoseProvider({ assetBase, modelBytes: bytes });
      const c = document.createElement("canvas"); c.width = 320; c.height = 240;
      const v = { videoWidth: 320, videoHeight: 240 };
      let ok = true;
      try { second.detect(c, 5); } catch (e) { ok = false; }
      second.close();
      return { ok, bytes: bytes.length, byteLengthAfter: bytes.byteLength };
    }, url + "/");
    assert.equal(r.ok, true);
    assert.equal(r.byteLengthAfter, 9398198, "buffer not detached by MediaPipe");
  });
  await b1.close();

  /* ─── B. production app, real runtime, image as the camera ─────────── */
  const y4m = `${out}/pose-960x640.y4m`;
  {
    const b = await chromium.launch({ headless: true, executablePath: CHROME });
    const p = await b.newPage();
    await p.goto(url + "/__smoke.html");
    const rgba = await p.evaluate(async () => {
      const img = new Image(); img.src = "/__fixture/pose.jpg"; await img.decode();
      const c = document.createElement("canvas"); c.width = 960; c.height = 640;
      const g = c.getContext("2d"); g.drawImage(img, 0, 0, 960, 640);
      return Array.from(g.getImageData(0, 0, 960, 640).data);
    });
    await b.close();
    const W = 960, H = 640;
    const Y = Buffer.alloc(W * H), U = Buffer.alloc(W * H / 4), V = Buffer.alloc(W * H / 4);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4, r = rgba[i], g = rgba[i + 1], bl = rgba[i + 2];
      Y[y * W + x] = Math.max(0, Math.min(255, Math.round(0.257 * r + 0.504 * g + 0.098 * bl + 16)));
      if (y % 2 === 0 && x % 2 === 0) {
        const j = (y / 2) * (W / 2) + x / 2;
        U[j] = Math.max(0, Math.min(255, Math.round(-0.148 * r - 0.291 * g + 0.439 * bl + 128)));
        V[j] = Math.max(0, Math.min(255, Math.round(0.439 * r - 0.368 * g - 0.071 * bl + 128)));
      }
    }
    const frame = Buffer.concat([Buffer.from("FRAME\n"), Y, U, V]);
    await writeFile(y4m, Buffer.concat([Buffer.from(`YUV4MPEG2 W${W} H${H} F30:1 Ip A1:1 C420jpeg\n`), frame, frame]));
  }

  async function runApp(args, tag) {
    const b = await chromium.launch({ headless: true, executablePath: CHROME, args });
    try { return await runAppIn(b, tag); } finally { await b.close(); }
  }
  async function runAppIn(b, tag) {
    const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, permissions: ["camera"] });
    const page = await ctx.newPage();
    const errors = [], consoleErrors = [], requests = [], vendorInfo = [];
    page.on("pageerror", e => errors.push(e.message));
    // MediaPipe's WASM prints one informational TFLite line to stderr, which
    // Emscripten routes to console.error. It is recorded, not treated as an error.
    page.on("console", m => {
      if (m.type() !== "error") return;
      if (/^INFO: Created TensorFlow Lite XNNPACK delegate for CPU\.$/.test(m.text())) { vendorInfo.push(m.text()); return; }
      consoleErrors.push(m.text());
    });
    page.on("request", r => requests.push({ url: r.url(), method: r.method() }));
    await page.addInitScript(instrumentRuntime);
    await page.addInitScript(() => {
      window.__streams = [];
      const md = navigator.mediaDevices, orig = md.getUserMedia.bind(md);
      md.getUserMedia = async (c) => { const s = await orig(c); window.__streams.push(s); return s; };
    });
    await page.route(/fonts\.googleapis\.com|fonts\.gstatic\.com/, r => r.fulfill({ status: 200, body: "" }));
    await page.goto(url + "/");
    await page.evaluate((profile) => {
      const pad = (n) => (n < 10 ? "0" : "") + n;
      const d = new Date(); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() - (d.getDay() === 0 ? 6 : d.getDay() - 1));
      localStorage.setItem("pq_demo-a@example.com_profile", JSON.stringify(profile));
      localStorage.setItem("pq_demo-a@example.com_lastCheckin", d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate()));
      localStorage.setItem("pq_last_email", "demo-a@example.com");
    }, DEMO_PROFILE_A);
    await page.reload();
    await page.locator(".nav-add-btn").click();
    await page.locator(".exercise-card").click();
    await page.locator(".ma-entry").click();
    const t0 = Date.now();
    await page.getByRole("button", { name: "Start Camera", exact: true }).click();
    await page.waitForSelector('.ma-screen[data-phase="positioning"], .ma-screen[data-phase="calibrating"], .ma-screen[data-phase="error"]', { timeout: 60000 });
    const startToPreviewMs = Date.now() - t0;
    const phase0 = await page.locator(".ma-screen").getAttribute("data-phase");
    const seen = new Set();
    const phases = new Set();
    const until = Date.now() + 12000;
    while (Date.now() < until) {
      seen.add(await page.locator(".ma-status").innerText().catch(() => ""));
      phases.add(await page.locator(".ma-screen").getAttribute("data-phase"));
      await page.waitForTimeout(250);
    }
    const rt = await page.evaluate(() => ({ detect: window.__rt.detect, created: window.__rt.created, createMs: window.__rt.createMs, ms: window.__rt.ms, poses: window.__rt.poses, lastLandmarks: window.__rt.lastLandmarks, frameSize: window.__rt.frameSize, sourceType: window.__rt.sourceType }));
    await page.screenshot({ path: `${out}/${tag}-live.png` });
    const phaseBeforeCancel = await page.locator(".ma-screen").getAttribute("data-phase");
    if (await page.getByRole("button", { name: "Cancel", exact: true }).count()) await page.getByRole("button", { name: "Cancel", exact: true }).click();
    const tracksLive = await page.evaluate(() => window.__streams.flatMap(s => s.getTracks()).filter(t => t.readyState !== "ended").length);
    const closed = await page.evaluate(() => window.__rt.closed);
    const sortedMs = rt.ms.slice(3).sort((a, b) => a - b);
    const result = {
      startToPreviewMs, phase0, phases: [...phases], phaseBeforeCancel, guidance: [...seen].filter(Boolean),
      runtimeCreateMs: rt.createMs, inferences: rt.detect, analysedFps: rt.detect / 12,
      medianInferenceMs: sortedMs[Math.floor(sortedMs.length / 2)], p90InferenceMs: sortedMs[Math.floor(sortedMs.length * 0.9)],
      poseCounts: rt.poses.reduce((m, n) => (m[n] = (m[n] || 0) + 1, m), {}),
      frameSize: rt.frameSize, sourceType: rt.sourceType, lastLandmarks: rt.lastLandmarks,
      tracksLiveAfterCancel: tracksLive, runtimeClosed: closed, created: rt.created,
      requests: [...new Set(requests.map(r => r.method + " " + (r.url.startsWith(url) ? new URL(r.url).pathname : r.url)))].sort(),
      errors, consoleErrors, vendorStderrInfoLines: vendorInfo.length
    };
    return result;
  }

  await check("B. production app + real runtime with the test image as the camera: frames analysed, landmarks returned, guidance shown, camera released, no external requests", async () => {
    report.b = await runApp(["--use-fake-device-for-media-stream", `--use-file-for-fake-video-capture=${y4m}`], "image-camera");
    const b = report.b;
    assert.notEqual(b.phase0, "error", JSON.stringify(b));
    assert.ok(b.inferences > 20, "inferences " + b.inferences);
    assert.ok((b.poseCounts[1] || 0) > 0, "the real model found the person: " + JSON.stringify(b.poseCounts));
    assert.ok(b.guidance.length > 0);
    assert.equal(b.tracksLiveAfterCancel, 0);
    assert.equal(b.runtimeClosed, b.created);
    assert.deepEqual(b.errors, []);
    assert.deepEqual(b.consoleErrors, []);
    b.requests.forEach(r => assert.match(r, /^GET \/|^GET https:\/\/fonts\.(googleapis|gstatic)\.com/, r));
    // Regression for the scaled-camera-frame defect: Chromium delivers a
    // centred 4:3 crop (853.3 × 640 → 640 × 480) of the 960 × 640 image, so
    // MediaPipe's published landmarks map to x' = (x·960 − 53.33) / 853.33.
    assert.equal(b.sourceType, "HTMLCanvasElement", "the runtime reads the staging canvas, not the <video>");
    assert.deepEqual(b.frameSize, [640, 480]);
    const idx = { left_hip: 23, right_hip: 24, left_knee: 25, right_knee: 26, nose: 0 };
    const dist = Object.entries(idx).map(([n, i]) => Math.hypot(b.lastLandmarks[n].x - (expected[i].x * 960 - 53.333) / 853.333, b.lastLandmarks[n].y - expected[i].y));
    b.expectedMeanDist = dist.reduce((s, d) => s + d, 0) / dist.length;
    assert.ok(b.expectedMeanDist < 0.03, "camera-path landmarks agree with the published expectation: " + b.expectedMeanDist);
    assert.ok(b.guidance.some(g => /Turn so that your side faces the camera/.test(g)), "a frontal pose is recognised as not side-on: " + b.guidance.join(" | "));
  });

  await check("C. production app + real runtime with Chromium's synthetic pattern: no person is reported as no person", async () => {
    report.c = await runApp(["--use-fake-device-for-media-stream"], "pattern-camera");
    const c = report.c;
    assert.ok(c.inferences > 20);
    assert.equal(c.poseCounts[1] || 0, 0, JSON.stringify(c.poseCounts));
    assert.ok(c.guidance.some(g => /No person detected yet/.test(g)), c.guidance.join(" | "));
    assert.equal(c.tracksLiveAfterCancel, 0);
    assert.deepEqual(c.errors, []);
  });

  await writeFile(`${out}/report.json`, JSON.stringify(Object.assign({ checks }, report), null, 2));
  console.log(JSON.stringify({ a: { initMs: report.a.initMs, medianMs: report.a.frames.medianMs, p90Ms: report.a.frames.p90Ms, firstMs: report.a.frames.firstMs, expectedMeanDist: report.a.expectedMeanDist, expectedWorstDist: report.a.expectedWorstDist, calibration: report.a.frames.calibration.state + ":" + (report.a.frames.calibration.reason || "") },
    b: Object.assign({}, report.b, { requests: report.b.requests }), c: { inferences: report.c.inferences, poseCounts: report.c.poseCounts, guidance: report.c.guidance } }, null, 2));
  console.log(`\n${checks.length} smoke checks passed. Artifacts: ${out}`);
} catch (error) {
  await writeFile(`${out}/report.json`, JSON.stringify(Object.assign({ checks, error: String(error.stack) }, report), null, 2)).catch(() => {});
  console.error(error);
  process.exitCode = 1;
} finally {
  await new Promise(r => server.close(r));
  process.exit(process.exitCode || 0);
}
