/* ─── Movement Assessment — pose-provider adapter (MediaPipe) ─────────────
 *
 * The ONLY module that knows MediaPipe exists. It returns an object with
 *
 *   detect(videoElement, timestampMs) → pose-frame-v1   (poseContract.js)
 *   close()                            → releases the runtime graph
 *   identity                            → provenance, incl. on-device hash check
 *
 * Loading, all from the app's own files (see RUNTIME_ASSETS):
 *   1. movement/pose-runtime.js — the MediaPipe JS runtime, built by
 *      build.mjs as a separate script so that nothing is downloaded or
 *      evaluated until the user starts an assessment.
 *   2. WebAssembly SIMD support is required (the non-SIMD fallback binary is
 *      not shipped); unsupported engines get a clear error, not a crash.
 *   3. The model file is fetched from the app bundle, its size and SHA-256
 *      are verified on the device, and the verified BYTES are handed to
 *      MediaPipe (modelAssetBuffer). MediaPipe therefore never fetches a
 *      model URL itself.
 *   4. MediaPipe loads its WASM loader and binary from the app bundle paths
 *      given here.
 *
 * Frame staging: each analysed frame is drawn into ONE reusable, off-DOM
 * canvas of exactly videoWidth × videoHeight, and that canvas — not the
 * <video> — is given to MediaPipe. Measured in Chromium (see
 * MILESTONE_6_VERIFICATION.md): when the browser scales or crops camera
 * frames to meet the requested size, MediaPipe 0.10.35 reading the <video>
 * directly returns landmarks stretched by about 4/3 (hips reported at 97% of
 * the frame height instead of 71%), while the same frames drawn into a
 * canvas give the correct positions. The canvas pixels are never read back
 * by this code, the canvas is never attached to the document, each frame
 * overwrites the previous one, and close() shrinks it to 0 × 0.
 *
 * Network: every request above is a same-origin GET for a static app file.
 * No frame, landmark or result is ever passed to fetch or any other network
 * API. The pinned runtime (0.10.35) contains no telemetry client; build.mjs
 * enforces that.
 * ───────────────────────────────────────────────────────────────────────── */

import { POSE_PROVIDER, POSE_MODEL, RUNTIME_ASSETS, poseProvenance } from "./modelVersion.js";
import { normalizePoseResult } from "./poseContract.js";
import { sha256Hex } from "./sha256.js";

export const RUNTIME_GLOBAL = "PhysiqPoseRuntime";

export class PoseProviderError extends Error {
  constructor(code, detail) {
    super(code);
    this.name = "PoseProviderError";
    this.code = code;
    this.detail = detail ? String(detail) : null;
  }
}

/* The directory holding app.min.js. Assets live next to it in every
   deployment (dist/index.html, the repo-root index.html that GitHub Pages
   serves, and the Capacitor bundle), whereas document.baseURI differs. */
export function resolveAssetBase(doc) {
  const d = doc || (typeof document !== "undefined" ? document : null);
  if (!d) return "";
  const scripts = d.getElementsByTagName ? d.getElementsByTagName("script") : [];
  for (let i = 0; i < scripts.length; i++) {
    const src = scripts[i].src || "";
    const m = src.match(/^(.*\/)app\.min\.js(?:[?#].*)?$/);
    if (m) return m[1];
  }
  try { return new URL(".", d.baseURI).href; } catch (e) { return ""; }
}

let runtimePromise = null;

/* Model bytes that passed verification, kept for the rest of the app session
   so reopening Movement Assessment does not download 9.4 MB again. They are
   the model's weights (no user data), are never written to storage, and are
   still re-verified before every use; a copy that fails is dropped and the
   model is downloaded again. */
let sessionModelBytes = null;
export function clearSessionModelCache() { sessionModelBytes = null; }

async function sessionCachedModel(url, fetchImpl, subtle) {
  if (sessionModelBytes) {
    try { return await verifyModelBytes(sessionModelBytes, subtle); }
    catch (e) { sessionModelBytes = null; }
  }
  sessionModelBytes = await loadVerifiedModel(url, fetchImpl, subtle);
  return sessionModelBytes;
}

/* Injects movement/pose-runtime.js once and resolves with its global. */
export function loadPoseRuntime(url, doc, win, timeoutMs = 30000) {
  const w = win || (typeof window !== "undefined" ? window : null);
  const d = doc || (typeof document !== "undefined" ? document : null);
  if (w && w[RUNTIME_GLOBAL]) return Promise.resolve(w[RUNTIME_GLOBAL]);
  if (runtimePromise) return runtimePromise;
  if (!w || !d) return Promise.reject(new PoseProviderError("runtime_unavailable", "no document"));
  runtimePromise = new Promise(function (resolve, reject) {
    const script = d.createElement("script");
    script.src = url;
    script.async = true;
    let settled = false;
    const timer = setTimeout(function () {
      finish(new PoseProviderError("runtime_unavailable", "runtime script timed out"));
    }, timeoutMs);
    function finish(err, value) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      script.onload = script.onerror = null;
      if (err) {
        try { if (typeof script.remove === "function") script.remove(); } catch (e) { /* best effort */ }
        reject(err);
      } else resolve(value);
    }
    script.onload = function () {
      if (w[RUNTIME_GLOBAL]) finish(null, w[RUNTIME_GLOBAL]);
      else finish(new PoseProviderError("runtime_unavailable", "runtime global missing"));
    };
    script.onerror = function () { finish(new PoseProviderError("runtime_unavailable", "runtime script failed to load")); };
    try { (d.head || d.body).appendChild(script); }
    catch (err) { finish(new PoseProviderError("runtime_unavailable", err && err.message)); }
  }).catch(function (err) {
    runtimePromise = null;   // allow a later, user-initiated retry
    throw err;
  });
  return runtimePromise;
}

/* Fetch + verify the model. Resolves with the verified bytes. */
export async function loadVerifiedModel(url, fetchImpl, subtle) {
  const f = fetchImpl || (typeof fetch === "function" ? fetch : null);
  if (!f) throw new PoseProviderError("model_unavailable", "fetch unavailable");
  let bytes;
  try {
    const res = await f(url, { method: "GET", credentials: "same-origin" });
    if (!res || !res.ok) throw new Error("HTTP " + (res && res.status));
    bytes = new Uint8Array(await res.arrayBuffer());
  } catch (err) {
    throw new PoseProviderError("model_unavailable", err && err.message);
  }
  return verifyModelBytes(bytes, subtle);
}

async function verifyModelBytes(bytes, subtle) {
  if (!(bytes instanceof Uint8Array) || bytes.length !== POSE_MODEL.bytes) {
    throw new PoseProviderError("model_integrity", "unexpected model bytes");
  }
  const digest = await sha256Hex(bytes, subtle);
  if (digest !== POSE_MODEL.sha256) throw new PoseProviderError("model_integrity", "sha256 " + digest);
  return bytes;
}

/* deps (all optional, for tests): { doc, win, fetchImpl, subtle, assetBase,
   modelBytes (already verified bytes to reuse) }. */
export async function createMediaPipePoseProvider(deps) {
  const o = deps || {};
  const win = o.win || (typeof window !== "undefined" ? window : null);
  if (!win || typeof win.WebAssembly !== "object") throw new PoseProviderError("unsupported_runtime", "WebAssembly unavailable");

  const base = o.assetBase != null ? o.assetBase : resolveAssetBase(o.doc);
  const runtime = await loadPoseRuntime(base + RUNTIME_ASSETS.runtimeBundle, o.doc, win);

  let simd = false;
  try { simd = await runtime.FilesetResolver.isSimdSupported(); } catch (e) { simd = false; }
  if (!simd) throw new PoseProviderError("unsupported_runtime", "WebAssembly SIMD unavailable");

  // Cached bytes are mutable, so verify them again on every provider creation.
  const modelBytes = o.modelBytes
    ? await verifyModelBytes(o.modelBytes, o.subtle)
    : await sessionCachedModel(base + RUNTIME_ASSETS.model.path, o.fetchImpl, o.subtle);

  let landmarker;
  try {
    landmarker = await runtime.PoseLandmarker.createFromOptions(
      {
        wasmLoaderPath: base + RUNTIME_ASSETS.wasmLoader.path,
        wasmBinaryPath: base + RUNTIME_ASSETS.wasmBinary.path
      },
      {
        baseOptions: { modelAssetBuffer: modelBytes, delegate: POSE_PROVIDER.delegate },
        runningMode: POSE_PROVIDER.runningMode,
        numPoses: POSE_PROVIDER.numPoses,
        minPoseDetectionConfidence: POSE_PROVIDER.minPoseDetectionConfidence,
        minPosePresenceConfidence: POSE_PROVIDER.minPosePresenceConfidence,
        minTrackingConfidence: POSE_PROVIDER.minTrackingConfidence,
        outputSegmentationMasks: false
      }
    );
  } catch (err) {
    throw new PoseProviderError("model_init_failed", err && err.message);
  }

  const stager = createFrameStager(o.doc || (typeof document !== "undefined" ? document : null));
  let lastProviderTs = -1;
  let closed = false;
  return {
    identity: poseProvenance(true),
    modelBytes: modelBytes,
    detect: function (video, timestampMs) {
      if (closed) throw new PoseProviderError("closed");
      const width = video && video.videoWidth, height = video && video.videoHeight;
      // MediaPipe VIDEO mode needs strictly increasing integer timestamps.
      let ts = Math.round(timestampMs);
      if (!(ts > lastProviderTs)) ts = lastProviderTs + 1;
      lastProviderTs = ts;
      let raw = null;
      try {
        const frame = stager.stage(video, width, height);
        raw = frame ? landmarker.detectForVideo(frame, ts) : null;
      } catch (e) { raw = null; }
      return normalizePoseResult(raw, { timestampMs: timestampMs, frameWidth: width, frameHeight: height });
    },
    close: function () {
      if (closed) return;
      closed = true;
      try { landmarker.close(); } catch (e) { /* already released */ }
      landmarker = null;
      stager.release();
    }
  };
}

/* One reusable off-DOM canvas holding only the most recent analysed frame.
   Exported for tests. */
export function createFrameStager(doc) {
  let canvas = null, ctx = null;
  return {
    stage: function (video, width, height) {
      if (!doc || !(width > 0) || !(height > 0)) return null;
      if (!canvas) {
        canvas = doc.createElement("canvas");
        ctx = canvas.getContext("2d", { alpha: false });
      }
      if (!ctx) return null;
      if (canvas.width !== width || canvas.height !== height) { canvas.width = width; canvas.height = height; }
      ctx.drawImage(video, 0, 0, width, height);
      return canvas;
    },
    release: function () {
      if (canvas) { canvas.width = 0; canvas.height = 0; }
      canvas = null;
      ctx = null;
    }
  };
}
