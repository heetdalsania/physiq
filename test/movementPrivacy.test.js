/* Milestone 6 — privacy, provenance and boundary guards (static).
 *
 * Camera frames, landmarks and results must never leave the device or be
 * persisted; the pose runtime must be the pinned, telemetry-free release;
 * movement code must stay separate from TissueOS load, history and recovery.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { createHash } from "node:crypto";
import { POSE_PROVIDER, POSE_MODEL, RUNTIME_ASSETS, FORBIDDEN_RUNTIME_MARKERS } from "../js/movement/modelVersion.js";
import { CAMERA_CONSTRAINTS } from "../js/movement/mediaCapture.js";

const root = new URL("../", import.meta.url);
const read = (p) => readFileSync(new URL(p, root), "utf8");
const sha = (p) => createHash("sha256").update(readFileSync(new URL(p, root))).digest("hex");
const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

const MOVEMENT_FILES = readdirSync(new URL("js/movement/", root)).filter((f) => f.endsWith(".js")).map((f) => "js/movement/" + f)
  .concat(["js/components/MovementAssessment.js"]);

/* Double-quoted string literals removed: API usage cannot hide in them, and
   prose such as "not saved or uploaded" or the telemetry denylist in
   modelVersion.js must not trip the scan. */
const code = (f) => strip(read(f)).replace(/"(?:[^"\\\n]|\\.)*"/g, '""');

test("no new code can send, store or export media, landmarks or results", () => {
  const banned = [
    /XMLHttpRequest/, /FormData/, /sendBeacon/, /WebSocket/, /EventSource/, /\bupload\w*\s*\(/i,
    /localStorage/, /sessionStorage/, /indexedDB/i, /\bcaches\./, /FileSystem/i, /Filesystem/, /CameraRoll/i,
    /MediaRecorder/, /toDataURL/, /toBlob/, /createObjectURL/, /getImageData/, /readPixels/, /captureStream/, /transferToImageBitmap/, /createImageBitmap/,
    /navigator\.share|\bShare\./, /postMessage/, /document\.cookie/, /\bsv\(|uKey\(/, /@capacitor/
  ];
  MOVEMENT_FILES.forEach((f) => {
    const src = code(f);
    banned.forEach((re) => assert.doesNotMatch(src, re, f + " matches " + re));
  });
});

test("frame pixels go to exactly one place: the off-DOM staging canvas handed to the local runtime", () => {
  const users = MOVEMENT_FILES.filter((f) => /drawImage|createElement\(/.test(code(f)));
  assert.deepEqual(users, ["js/movement/poseProvider.js"]);
  const src = code("js/movement/poseProvider.js");
  assert.equal((src.match(/drawImage/g) || []).length, 1);
  const stager = src.slice(src.indexOf("export function createFrameStager"));
  assert.match(stager, /ctx\.drawImage\(video, 0, 0, width, height\)/);
  assert.match(stager, /canvas\.width = 0; canvas\.height = 0;/, "released on close");
  assert.doesNotMatch(src, /appendChild\(canvas|appendChild\(stage|getImageData|toDataURL|toBlob/);
});

test("the only fetch is the same-origin GET of the bundled model file", () => {
  const hits = [];
  MOVEMENT_FILES.forEach((f) => {
    const n = (code(f).match(/\bfetch\b/g) || []).length;
    if (n) hits.push([f, n]);
  });
  // `typeof fetch === "function" ? fetch : null` inside loadVerifiedModel
  assert.deepEqual(hits, [["js/movement/poseProvider.js", 2]], JSON.stringify(hits));
  const src = strip(read("js/movement/poseProvider.js"));
  const loader = src.slice(src.indexOf("export async function loadVerifiedModel"), src.indexOf("export async function createMediaPipePoseProvider"));
  assert.match(loader, /typeof fetch === "function" \? fetch : null/);
  assert.match(loader, /await f\(url, \{ method: "GET", credentials: "same-origin" \}\)/);
  assert.match(src, /sessionCachedModel\(base \+ RUNTIME_ASSETS\.model\.path/);
  const cacheFn = src.slice(src.indexOf("async function sessionCachedModel"), src.indexOf("export async function loadVerifiedModel"));
  assert.match(cacheFn, /loadVerifiedModel\(url, fetchImpl, subtle\)/, "the cache only ever fetches the bundled model URL it was given");
  // detect() hands frames only to the local runtime and returns a normalised frame
  const detect = src.slice(src.indexOf("detect: function"), src.indexOf("close: function"));
  assert.doesNotMatch(detect, /fetch|send|post|upload/i);
});

test("camera constraints are video-only", () => {
  assert.equal(CAMERA_CONSTRAINTS.audio, false);
  const src = strip(read("js/movement/mediaCapture.js"));
  assert.match(src, /getUserMedia\(\{\s*audio: false,/);
  assert.doesNotMatch(src, /audio: true/);
  MOVEMENT_FILES.forEach((f) => assert.doesNotMatch(strip(read(f)), /getDisplayMedia|enumerateDevices/, f));
});

test("the camera is requested from exactly one place, reached only from start()", () => {
  const callers = MOVEMENT_FILES.filter((f) => /requestCameraStream\(|getUserMedia\(/.test(strip(read(f))));
  assert.deepEqual(callers.sort(), ["js/movement/assessmentSession.js", "js/movement/mediaCapture.js"]);
  const session = strip(read("js/movement/assessmentSession.js"));
  assert.equal((session.match(/requestCameraStream\(/g) || []).length, 1);
  const startBody = session.slice(session.indexOf("async function start()"), session.indexOf("function scheduleLoop"));
  assert.match(startBody, /requestCameraStream\(d\.mediaDevices\)/);
  // App start never touches the camera: no movement import in App.js.
  assert.doesNotMatch(read("js/App.js"), /movement|MovementAssessment|getUserMedia/);
});

test("runtime pin: exact package version, lockfile, and no telemetry markers in shipped runtime code", () => {
  const pkg = JSON.parse(read("package.json"));
  assert.equal(pkg.dependencies["@mediapipe/tasks-vision"], POSE_PROVIDER.packageVersion, "exact pin, no range");
  const lock = JSON.parse(read("package-lock.json"));
  assert.equal(lock.packages["node_modules/@mediapipe/tasks-vision"].version, "0.10.35");
  assert.equal(JSON.parse(read("node_modules/@mediapipe/tasks-vision/package.json")).version, "0.10.35");
  const shipped = [RUNTIME_ASSETS.wasmLoader.from, "node_modules/@mediapipe/tasks-vision/vision_bundle.mjs"];
  if (existsSync(new URL("dist/" + RUNTIME_ASSETS.runtimeBundle, root))) shipped.push("dist/" + RUNTIME_ASSETS.runtimeBundle);
  shipped.forEach((f) => {
    const text = read(f);
    FORBIDDEN_RUNTIME_MARKERS.forEach((m) => assert.equal(text.includes(m), false, f + " contains " + m));
  });
});

test("runtime and model files match their pinned SHA-256 (source and built copies)", () => {
  [RUNTIME_ASSETS.wasmLoader, RUNTIME_ASSETS.wasmBinary, RUNTIME_ASSETS.model].forEach((a) => {
    assert.equal(sha(a.from), a.sha256, a.from);
    if (existsSync(new URL("dist/" + a.path, root))) assert.equal(sha("dist/" + a.path), a.sha256, "dist/" + a.path);
  });
  assert.equal(RUNTIME_ASSETS.model.sha256, POSE_MODEL.sha256);
  assert.match(POSE_MODEL.source, /\/float16\/1\//, "a versioned URL, never /latest/");
  const notice = read("vendor/mediapipe/NOTICE.md");
  [POSE_MODEL.sha256, RUNTIME_ASSETS.wasmLoader.sha256, RUNTIME_ASSETS.wasmBinary.sha256, "0.10.35", "Apache License, Version 2.0", "2026-09-23"]
    .forEach((s) => assert.ok(notice.includes(s), "NOTICE.md must record " + s));
  assert.match(read("vendor/mediapipe/LICENSE-2.0.txt"), /Apache License\s+Version 2\.0, January 2004/);
});

test("the main app bundle never contains the pose runtime; the runtime is a separate lazy script", () => {
  const app = strip(read("js/App.js")) + strip(read("js/screens/ExerciseTab.js")) +
    MOVEMENT_FILES.filter((f) => !f.endsWith("poseRuntimeEntry.js")).map((f) => strip(read(f))).join("\n");
  assert.doesNotMatch(app, /from "@mediapipe\/tasks-vision"/);
  assert.match(read("js/movement/poseRuntimeEntry.js"), /from "@mediapipe\/tasks-vision"/);
  if (existsSync(new URL("dist/app.min.js", root))) {
    // MediaPipe-internal identifiers (our own asset-path constants are allowed).
    const bundle = read("dist/app.min.js");
    ["CLOSURE_FLAGS", "_registerModelResourcesGraphService", "forVisionTasks"].forEach((m) => {
      assert.equal(bundle.includes(m), false, "app.min.js contains MediaPipe code: " + m);
    });
    assert.equal(read("dist/" + RUNTIME_ASSETS.runtimeBundle).includes("CLOSURE_FLAGS"), true, "…which lives in the runtime bundle instead");
  }
});

test("iOS: one camera usage string covering both uses; no microphone, photo, motion or health permission", () => {
  const plist = read("ios/App/App/Info.plist");
  assert.equal((plist.match(/<key>NSCameraUsageDescription<\/key>/g) || []).length, 1);
  const camera = plist.match(/<key>NSCameraUsageDescription<\/key>\s*<string>([^<]*)<\/string>/)[1];
  assert.match(camera, /barcode/i);
  assert.match(camera, /Movement Assessment/);
  assert.match(camera, /processed on this device and is not saved or uploaded/);
  assert.doesNotMatch(plist, /NSMicrophoneUsageDescription|NSPhotoLibrary|NSMotionUsageDescription|NSHealth|NSLocationAlways/);
  assert.equal((plist.match(/<key>NSLocationWhenInUseUsageDescription<\/key>/g) || []).length, 1, "existing location key unchanged");
});

test("no persistence: no new storage key and no movement data in the storage layer", () => {
  const storage = read("js/utils/storage.js");
  assert.doesNotMatch(storage, /movement|pose|assessment/i);
  MOVEMENT_FILES.forEach((f) => assert.doesNotMatch(strip(read(f)), /["'`]pq_/, f));
});

test("separation: movement code and TissueOS load/history/recovery never import each other", () => {
  MOVEMENT_FILES.forEach((f) => {
    const imports = (read(f).match(/from\s+"[^"]+"/g) || []).join(" ");
    assert.doesNotMatch(imports, /tissue|Tissue|recovery|Recovery|workoutSession|setMetadata|storage|weeklyReport|loadEngine/, f + ": " + imports);
  });
  const other = ["js/tissue/loadEngine.js", "js/tissue/exerciseTissueMap.js", "js/tissue/modelVersion.js", "js/utils/tissueHistoryStore.js",
    "js/utils/tissueLoadHistory.js", "js/utils/tissueRecoveryGuidance.js", "js/utils/workoutSession.js", "js/utils/setMetadata.js",
    "js/components/TissueLoadTracker.js", "js/components/RecoveryTracker.js", "js/utils/storage.js"];
  other.forEach((f) => assert.doesNotMatch(read(f), /from\s+"[^"]*movement[^"]*"|MovementAssessment/, f));
});

test("an assessment cannot edit workouts: the Exercise screen gives it no workout or history callbacks", () => {
  const src = read("js/screens/ExerciseTab.js");
  const block = src.slice(src.indexOf('if (view === "movement")'), src.indexOf('if (view === "main")'));
  assert.doesNotMatch(block, /logCompletedWorkout|saveRoutine|workoutLog|tissueHistory|updateSetTarget|setActive/);
  // Milestone 2's subjective set ROM stays a separate concept; movement code never references it.
  MOVEMENT_FILES.forEach((f) => assert.doesNotMatch(strip(read(f)), /ROM_VALUES|ROM_LABELS|"partial"|"standard"|"full"\b(?! )/, f));
});

test("no backend, service or remote inference was added", () => {
  const pkg = JSON.parse(read("package.json"));
  const deps = Object.keys(Object.assign({}, pkg.dependencies, pkg.devDependencies));
  deps.forEach((d) => assert.doesNotMatch(d, /firebase|supabase|aws|gcloud|google-cloud|axios|socket|openai|anthropic|analytics|sentry|segment|mixpanel/i, d));
  ["server", "api", "backend", "functions", "supabase"].forEach((dir) => assert.equal(existsSync(new URL(dir + "/", root)), false, dir));
});
