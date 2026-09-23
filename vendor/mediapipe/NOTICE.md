# Third-party notice — MediaPipe pose runtime and model

PhysiQ's Movement Assessment prototype (TissueOS Milestone 6) runs Google
MediaPipe's Pose Landmarker locally on the device. No camera frame, landmark
or result is sent anywhere.

Both components below are licensed under the **Apache License, Version 2.0**;
the full text is in [`LICENSE-2.0.txt`](LICENSE-2.0.txt) (copied unmodified
from https://www.apache.org/licenses/LICENSE-2.0.txt). Neither file has been
modified.

## 1. Runtime — `@mediapipe/tasks-vision`

| Field | Value |
|---|---|
| Package | `@mediapipe/tasks-vision` (npm), Copyright The MediaPipe Authors |
| Version | **0.10.35**, pinned exactly in `package.json` |
| License | Apache-2.0 (package `license` field; source headers) |
| Registry integrity | `sha512-HOvadwVRE6JC+45nyYhmnywnr5h/J8KZvOeUNVOG9q/0875pZgItznFB9bRTvLc264YSJqiZ1NsIpCStJw/egg==` |
| Shipped files | `dist/movement/pose-runtime.js` (compiled from the package's `vision_bundle.mjs`), `dist/movement/mediapipe/vision_wasm_internal.js`, `dist/movement/mediapipe/vision_wasm_internal.wasm` |
| `vision_wasm_internal.js` SHA-256 | `e7fd9858e8e8f221d9b96eddc11f8e077f263e0b7bbd79d3cbe882b134274f8c` |
| `vision_wasm_internal.wasm` SHA-256 | `6a5c64584c2ab61c763b6e204afbdbc7ce1caf7f5216187322bca8df94f646bc` |
| Not shipped | the non-SIMD and ES-module WASM variants (WebAssembly SIMD is required) |

**Why 0.10.35 and not the newer 1.x line.** `@mediapipe/tasks-vision` 1.0.0
and 1.0.1 add a usage logger that sends the task name, running mode, device
platform, library version and inference-latency statistics to
`https://odml.pa.googleapis.com/v1/log` every 60 seconds, using an API key
embedded in the WASM. It is created unconditionally and has no public
opt-out. 0.10.35 (2026-04-27) is the latest release without it; its only
network calls are fetching a model URL (unused here, because the verified
model bytes are passed in) and a graph-config URL (unused by
PoseLandmarker). `build.mjs` fails if the shipped runtime contains that
endpoint, and `test/movementPrivacy.test.js` checks the pin.

## 2. Model — `pose_landmarker_full.task`

| Field | Value |
|---|---|
| File | `vendor/mediapipe/pose_landmarker_full.task`, copied to `dist/movement/models/` at build |
| Source | `https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_full/float16/1/pose_landmarker_full.task` |
| Version | `float16/1` (object generation 2023-04-28; the unversioned `latest` URL is deliberately not used) |
| Retrieved | 2026-09-23 |
| Size | 9,398,198 bytes |
| SHA-256 | `5134a3aad27a58b93da0088d431f366da362b44e3ccfbe3462b3827a839011b1` |
| MD5 | `83879689d373d143be094c972355e48e` (matches the server's ETag at download) |
| Contents | `pose_detector.tflite` (`blazepose_detector_eff_retina_4kp_sparse_2021_10_18`), `pose_landmarks_detector.tflite` (`blazepose_ghum_39kp_full_oss_2021_07_02`) |
| Model card | "BlazePose GHUM 3D", Google (V. Bazarevsky, I. Grishchenko, E. G. Bazavan), dated 2021-04-16 — `https://storage.googleapis.com/mediapipe-assets/Model%20Card%20BlazePose%20GHUM%203D.pdf` |
| License | "Licensed under Apache License, Version 2.0" (model card) |
| Runtime role | 2D body-landmark estimation for the Movement Assessment prototype only |

Model-card facts this prototype relies on: 33 landmarks with x, y, z,
visibility and presence; visibility is the probability that a point is in
frame and not occluded; z is "not metric but up to scale" and comes from
synthetic data (so PhysiQ ignores z). Listed intended uses include "fitness
and repetition counting" and "3D pose measurements (angles / distances)";
listed out-of-scope uses include multiple people in the image, people further
than about 4 m from the camera, a head that is not visible, and applications
that need metric depth. The card states the model is not intended for human
life-critical decisions. Reported accuracy (PDJ / PCK@0.2) for the Full model
averages 91.8% across 14 geographic subregions, with per-skin-tone averages
from 85.9% to 92.9%.

**Replacing the weights** requires changing `POSE_MODEL` / `RUNTIME_ASSETS`
in `js/movement/modelVersion.js`, bumping `squat-kinematics-v0.2`, and updating
this notice. `build.mjs` refuses to ship a model or runtime file whose SHA-256
differs from the pinned value, and the app re-verifies the model's SHA-256 on
the device before using it.
