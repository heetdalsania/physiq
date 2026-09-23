/* Browser-acceptance STUB for dist/movement/pose-runtime.js.
 *
 * Bundled by movementAssessment.browser.mjs (esbuild IIFE, global
 * PhysiqPoseRuntime — the same shape build.mjs produces) and served in
 * place of the real MediaPipe runtime via page.route(). The production app
 * bundle is untouched and contains no test hook.
 *
 * It returns MediaPipe-shaped results from the hand-checkable synthetic
 * figure (test/fixtures/syntheticPose.js), so the app's REAL adapter,
 * geometry, segmentation and UI run end to end. It proves pipeline
 * behaviour, not pose-estimation accuracy.
 *
 * Scenario: window.__stubPose.scenario ("squat" by default; see
 * providerResultAt). Instrumentation is recorded on window.__stubPose.
 */
import { providerResultAt } from "../../fixtures/syntheticPose.js";

const log = (window.__stubPose = window.__stubPose || {});
Object.assign(log, {
  scenario: log.scenario || "squat",
  simdChecks: 0, created: 0, closed: 0, detectCalls: 0,
  inFlight: 0, maxInFlight: 0, nonMonotonic: 0,
  options: null, fileset: null, modelBytes: 0
});

export const FilesetResolver = {
  isSimdSupported: async function () { log.simdChecks += 1; return true; }
};

export const PoseLandmarker = {
  createFromOptions: async function (fileset, options) {
    log.created += 1;
    log.fileset = fileset;
    const buf = options && options.baseOptions && options.baseOptions.modelAssetBuffer;
    log.modelBytes = buf ? buf.length : 0;
    log.options = JSON.parse(JSON.stringify(Object.assign({}, options, {
      baseOptions: Object.assign({}, options.baseOptions, { modelAssetBuffer: buf ? "<" + buf.length + " bytes>" : null })
    })));
    let lastTs = -1;
    let closed = false;
    return {
      detectForVideo: function (video, ts) {
        if (closed) throw new Error("detect after close");
        log.detectCalls += 1;
        log.inFlight += 1;
        log.maxInFlight = Math.max(log.maxInFlight, log.inFlight);
        if (!(ts > lastTs)) log.nonMonotonic += 1;
        lastTs = ts;
        // The app hands MediaPipe its staging canvas (see poseProvider.js).
        log.sourceTypes = log.sourceTypes || {};
        const kind = video && video.constructor ? video.constructor.name : typeof video;
        log.sourceTypes[kind] = (log.sourceTypes[kind] || 0) + 1;
        const result = providerResultAt(ts, log.scenario, { pose: { width: video.videoWidth || video.width, height: video.videoHeight || video.height } });
        log.inFlight -= 1;
        return result;
      },
      close: function () { if (!closed) { closed = true; log.closed += 1; } }
    };
  }
};
