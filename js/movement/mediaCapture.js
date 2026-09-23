/* ─── Movement Assessment — camera acquisition and release ────────────────
 *
 * Thin, injectable wrapper around getUserMedia so that the session's
 * lifecycle rules can be tested without a browser.
 *
 *   - Video only: `audio: false`. No microphone is ever requested.
 *   - Front ("user") camera preferred so the person can see the framing;
 *     `ideal` constraints never fail on devices that lack them.
 *   - The stream is never recorded, copied into a canvas, encoded or stored:
 *     it is attached to a <video> element and read by the pose runtime.
 * ───────────────────────────────────────────────────────────────────────── */

export const CAMERA_CONSTRAINTS = Object.freeze({
  audio: false,
  video: Object.freeze({
    facingMode: "user",
    width: Object.freeze({ ideal: 640 }),
    height: Object.freeze({ ideal: 480 })
  })
});

export class CameraError extends Error {
  constructor(code, cause) {
    super(code);
    this.name = "CameraError";
    this.code = code;
    this.causeName = cause && cause.name ? String(cause.name) : null;
  }
}

/* DOMException name → user-level category. */
export function classifyCameraError(err) {
  const name = err && err.name ? String(err.name) : "";
  if (name === "NotAllowedError" || name === "PermissionDeniedError" || name === "SecurityError") return "permission_denied";
  if (name === "NotFoundError" || name === "DevicesNotFoundError" || name === "OverconstrainedError" || name === "ConstraintNotSatisfiedError") return "no_camera";
  if (name === "NotReadableError" || name === "TrackStartError" || name === "AbortError") return "camera_in_use";
  if (name === "TypeError") return "unsupported_browser";
  return "camera_error";
}

export function cameraSupported(mediaDevices) {
  return !!mediaDevices && typeof mediaDevices.getUserMedia === "function";
}

/* Resolves with a MediaStream or rejects with a CameraError. Never prompts
   on its own: callers invoke it only from an explicit user action. */
export async function requestCameraStream(mediaDevices) {
  if (!cameraSupported(mediaDevices)) throw new CameraError("unsupported_browser");
  try {
    return await mediaDevices.getUserMedia({
      audio: false,
      video: {
        facingMode: CAMERA_CONSTRAINTS.video.facingMode,
        width: { ideal: CAMERA_CONSTRAINTS.video.width.ideal },
        height: { ideal: CAMERA_CONSTRAINTS.video.height.ideal }
      }
    });
  } catch (err) {
    throw new CameraError(classifyCameraError(err), err);
  }
}

/* Stops every track of a stream. Returns how many tracks it stopped.
   Idempotent and tolerant of partial/foreign objects. */
export function stopMediaStream(stream) {
  if (!stream || typeof stream.getTracks !== "function") return 0;
  let stopped = 0;
  let tracks = [];
  try { tracks = stream.getTracks() || []; } catch (e) { tracks = []; }
  tracks.forEach(function (track) {
    try {
      if (track && typeof track.stop === "function") { track.stop(); stopped += 1; }
    } catch (e) { /* a track that throws on stop is already unusable */ }
  });
  return stopped;
}
