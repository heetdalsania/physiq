/* Milestone 6 — the MediaPipe adapter, against a fake runtime: what it asks
   MediaPipe for, how it stages frames, and how every failure maps to a
   typed error instead of a crash. The real runtime is exercised by
   test/browser/poseSmoke.browser.mjs. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { webcrypto } from "node:crypto";
import {
  createMediaPipePoseProvider, createFrameStager, resolveAssetBase, loadPoseRuntime, RUNTIME_GLOBAL
} from "../js/movement/poseProvider.js";
import { POSE_MODEL } from "../js/movement/modelVersion.js";
import { providerPose } from "./fixtures/syntheticPose.js";

const MODEL = new Uint8Array(readFileSync(new URL("../vendor/mediapipe/pose_landmarker_full.task", import.meta.url)));

function fakeCanvasDoc() {
  const log = { canvases: [], draws: [], appended: [] };
  const doc = {
    createElement(tag) {
      if (tag !== "canvas") throw new Error("unexpected element " + tag);
      const c = { width: 300, height: 150, ctxOpts: null, getContext(kind, opts) { c.ctxOpts = opts; return { drawImage: (src, x, y, w, h) => log.draws.push({ src, x, y, w, h, cw: c.width, ch: c.height }) }; } };
      log.canvases.push(c);
      return c;
    },
    body: { appendChild: (n) => log.appended.push(n) }
  };
  return { doc, log };
}

function fakeRuntime(behaviour = {}) {
  const log = { created: 0, closed: 0, calls: [], options: null, fileset: null };
  const runtime = {
    FilesetResolver: { isSimdSupported: async () => behaviour.simd !== false },
    PoseLandmarker: {
      createFromOptions: async (fileset, options) => {
        if (behaviour.createThrows) throw new Error("wasm abort: RuntimeError: unreachable");
        log.created += 1; log.fileset = fileset; log.options = options;
        return {
          detectForVideo(source, ts) {
            log.calls.push({ source, ts });
            if (behaviour.detectThrows) throw new Error("graph error");
            return { landmarks: [providerPose(150, 10)] };
          },
          close() { log.closed += 1; }
        };
      }
    }
  };
  return { runtime, log };
}

const serveModel = (bytes = MODEL) => async () => ({ ok: true, status: 200, arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) });

async function makeProvider(overrides = {}) {
  const { runtime, log } = fakeRuntime(overrides.behaviour);
  const { doc, log: canvasLog } = fakeCanvasDoc();
  const win = { WebAssembly: {}, [RUNTIME_GLOBAL]: runtime };
  const provider = await createMediaPipePoseProvider(Object.assign({ win, doc, assetBase: "capacitor://localhost/", fetchImpl: serveModel(), subtle: webcrypto.subtle }, overrides.deps));
  return { provider, log, canvasLog };
}

test("asks MediaPipe for exactly the pinned configuration, with verified model BYTES and local WASM paths", async () => {
  const { provider, log } = await makeProvider();
  assert.deepEqual(log.fileset, {
    wasmLoaderPath: "capacitor://localhost/movement/mediapipe/vision_wasm_internal.js",
    wasmBinaryPath: "capacitor://localhost/movement/mediapipe/vision_wasm_internal.wasm"
  });
  const o = log.options;
  assert.equal(o.baseOptions.modelAssetBuffer.length, POSE_MODEL.bytes);
  assert.equal("modelAssetPath" in o.baseOptions, false, "MediaPipe never fetches a model URL itself");
  assert.equal(o.baseOptions.delegate, "CPU");
  assert.equal(o.runningMode, "VIDEO");
  assert.equal(o.numPoses, 2);
  assert.equal(o.outputSegmentationMasks, false);
  assert.equal(provider.identity.modelVerifiedOnDevice, true);
});

test("frames are staged through one reusable off-DOM canvas sized to the video, never the <video> itself", async () => {
  const { provider, log, canvasLog } = await makeProvider();
  const video = { videoWidth: 640, videoHeight: 480, tag: "video" };
  const f1 = provider.detect(video, 10.4);
  provider.detect(video, 20);
  assert.equal(canvasLog.canvases.length, 1, "one canvas, reused");
  assert.deepEqual(canvasLog.appended, [], "never attached to the document");
  const c = canvasLog.canvases[0];
  assert.deepEqual([c.width, c.height], [640, 480]);
  assert.equal(log.calls[0].source, c, "MediaPipe receives the canvas");
  assert.notEqual(log.calls[0].source, video);
  assert.deepEqual(canvasLog.draws.map((d) => [d.src.tag, d.x, d.y, d.w, d.h]), [["video", 0, 0, 640, 480], ["video", 0, 0, 640, 480]]);
  assert.equal(f1.status, "pose");
  assert.equal(f1.frameWidth, 640);
  assert.equal(f1.timestampMs, 10.4);
  // an orientation change resizes the same canvas
  provider.detect({ videoWidth: 480, videoHeight: 640, tag: "video" }, 30);
  assert.deepEqual([c.width, c.height], [480, 640]);
  assert.equal(canvasLog.canvases.length, 1);
  provider.close();
  assert.deepEqual([c.width, c.height], [0, 0], "staging buffer released on close");
  assert.equal(log.closed, 1);
  provider.close();
  assert.equal(log.closed, 1, "close is idempotent");
  assert.throws(() => provider.detect(video, 40), /closed/);
});

test("MediaPipe gets strictly increasing integer timestamps even if the clock repeats or goes back", async () => {
  const { provider, log } = await makeProvider();
  const v = { videoWidth: 640, videoHeight: 480 };
  [100.2, 100.4, 99, 250.6, 250.6].forEach((t) => provider.detect(v, t));
  assert.deepEqual(log.calls.map((c) => c.ts), [100, 101, 102, 251, 252]);
});

test("a runtime exception during inference becomes a malformed frame, not a crash", async () => {
  const { provider } = await makeProvider({ behaviour: { detectThrows: true } });
  const f = provider.detect({ videoWidth: 640, videoHeight: 480 }, 5);
  assert.equal(f.status, "malformed");
});

test("a video without dimensions yet is not sent to MediaPipe", async () => {
  const { provider, log } = await makeProvider();
  const f = provider.detect({ videoWidth: 0, videoHeight: 0 }, 5);
  assert.equal(log.calls.length, 0);
  assert.equal(f.status, "malformed");
});

test("typed failures: no WebAssembly, no SIMD, runtime missing, model tampered, init abort", async () => {
  await assert.rejects(createMediaPipePoseProvider({ win: {}, assetBase: "" }), (e) => e.code === "unsupported_runtime");
  await assert.rejects(makeProvider({ behaviour: { simd: false } }), (e) => e.code === "unsupported_runtime");
  const tampered = new Uint8Array(MODEL); tampered[12345] ^= 1;
  await assert.rejects(makeProvider({ deps: { fetchImpl: serveModel(tampered) } }), (e) => e.code === "model_integrity");
  await assert.rejects(makeProvider({ behaviour: { createThrows: true } }), (e) => e.code === "model_init_failed" && !/RuntimeError/.test(e.message));
});

test("already-verified bytes are reused without refetching", async () => {
  let fetched = 0;
  const { log } = await makeProvider({ deps: { modelBytes: MODEL, fetchImpl: async () => { fetched += 1; throw new Error("no"); } } });
  assert.equal(fetched, 0);
  assert.equal(log.options.baseOptions.modelAssetBuffer, MODEL);
});

test("runtime script: injected once, failure is typed and retryable", async () => {
  const appended = [];
  const win = {};
  const doc = { createElement: () => ({}), head: { appendChild: (s) => appended.push(s) } };
  const p1 = loadPoseRuntime("movement/pose-runtime.js", doc, win);
  const p2 = loadPoseRuntime("movement/pose-runtime.js", doc, win);
  assert.equal(appended.length, 1, "concurrent calls share one script element");
  appended[0].onerror();
  await assert.rejects(p1, (e) => e.code === "runtime_unavailable");
  await assert.rejects(p2, (e) => e.code === "runtime_unavailable");
  const p3 = loadPoseRuntime("movement/pose-runtime.js", doc, win);
  assert.equal(appended.length, 2, "a later explicit retry injects again");
  win[RUNTIME_GLOBAL] = { ok: true };
  appended[1].onload();
  assert.deepEqual(await p3, { ok: true });
});

test("asset base resolves next to app.min.js in every deployment layout", () => {
  const doc = (srcs, baseURI) => ({ baseURI, getElementsByTagName: () => srcs.map((src) => ({ src })) });
  assert.equal(resolveAssetBase(doc(["https://heetdalsania.github.io/physiq/dist/app.min.js"], "https://heetdalsania.github.io/physiq/")), "https://heetdalsania.github.io/physiq/dist/");
  assert.equal(resolveAssetBase(doc(["capacitor://localhost/app.min.js"], "capacitor://localhost/")), "capacitor://localhost/");
  assert.equal(resolveAssetBase(doc(["http://127.0.0.1:8090/app.min.js?v=2"], "http://127.0.0.1:8090/")), "http://127.0.0.1:8090/");
  assert.equal(resolveAssetBase(doc(["https://fonts.example/x.js"], "http://h/a/b.html")), "http://h/a/");
});

test("frame stager tolerates a missing document or 2D context", () => {
  assert.equal(createFrameStager(null).stage({}, 640, 480), null);
  const noCtx = createFrameStager({ createElement: () => ({ getContext: () => null }) });
  assert.equal(noCtx.stage({}, 640, 480), null);
  noCtx.release();
});
