# Milestone 6 — Movement Assessment: Verification

Verified 2026-09-23 on branch `claude/milestone-6-camera-capture-bd88ca`, based
on `origin/main` at `cc6dd4cf75544fb8fedd64bf67332635ee984896` (Milestone 5 merge,
PR #27). The method and contract are in
[MOVEMENT_ASSESSMENT.md](MOVEMENT_ASSESSMENT.md); model/runtime provenance is in
[vendor/mediapipe/NOTICE.md](vendor/mediapipe/NOTICE.md).

This report separates four kinds of evidence, which prove different things:

| Evidence | What it proves | What it does not prove |
|---|---|---|
| Node unit tests (synthetic, hand-derived) | geometry, contract, algorithms, lifecycle rules | anything about a real camera or model |
| Browser acceptance, fake camera + stubbed runtime | production UI, permission, MediaStream lifecycle, storage, network, regression | pose-model accuracy |
| Real-runtime smoke test | the shipped runtime, WASM and model initialise and return correct landmarks on a controlled image, through the app's camera path | angle accuracy for squats; any scientific validity |
| iOS build + simulator | native build, permissions string, WKWebView runtime/model loading, simulator camera, backgrounding | physical-device camera behaviour |

---

## 1. Baseline

| Check | Result |
|---|---|
| Worktree | isolated git worktree, clean |
| `HEAD` / `origin/main` / local `main` | all `cc6dd4cf75544fb8fedd64bf67332635ee984896` |
| `npm ci` | lockfile-exact install succeeded |
| `npm test` | **488 passed**, 0 failed / skipped / todo / cancelled |
| `npm run build` | passed; rebuilt `dist/` byte-identical to the committed `dist/` (`app.min.js` SHA-256 `fe708c73…67a3`) |
| Environment | macOS 26 (Darwin 25.6), Node 22.23.1, npm 10.9.8, Chrome (system) via Playwright 1.62.1, Xcode 26.5 (17F42), iOS 26.5 simulator runtime |

Milestones 0–5 were present; nothing was recreated.

## 2. Architecture decision

- **Camera API:** `navigator.mediaDevices.getUserMedia` (WKWebView supports it; Capacitor 8 grants WebKit's per-origin media prompt, so iOS shows only the system camera prompt gated by `NSCameraUsageDescription`). No native plugin was added.
- **Pose library:** `@mediapipe/tasks-vision` **0.10.35**, exact pin, CPU delegate, VIDEO mode.
- **Pose model:** `pose_landmarker_full.task` `float16/1` (BlazePose GHUM 3D Full), vendored, SHA-256 verified at build time and on the device.
- **Reasons:** established local estimator with a model card and Apache-2.0 licence for runtime and weights; per-landmark visibility; runs in WKWebView (verified, §17); all assets bundle locally; the model card's intended uses include "fitness and repetition counting" and "pose measurements (angles/distances)".
- **Rejected:**
  - `@mediapipe/tasks-vision` **1.0.0 / 1.0.1** — found by source inspection to create, unconditionally, a usage logger that POSTs task, running mode, platform, version and latency statistics to `https://odml.pa.googleapis.com/v1/log` every 60 s with an API key embedded in the WASM; no public opt-out. Versions 0.10.21, 0.10.32–0.10.35 were checked and contain no such endpoint.
  - Lite model — lower PDJ (87.0% vs 91.8%) and a wider skin-tone range; Heavy model — ~26 MB and ~4× slower.
  - TensorFlow.js pose-detection — larger runtime, hub-hosted models, no advantage here.
  - Shipping the non-SIMD WASM (10.5 MB more) — not needed for iOS 16.4+ / current browsers; documented as a device limitation instead.
- **Separation of concerns:** `mediaCapture` / `assessmentSession` (lifecycle) → `poseProvider` (only MediaPipe-aware file) → `poseContract` (`pose-frame-v1`) → pure geometry, side selection, smoothing, calibration, segmentation, quality → `squatAssessment` (result) → React. No pose calculation lives in the component.
- **Lazy loading:** the runtime is a separate script (`dist/movement/pose-runtime.js`, 137 KB) injected only after Start Camera; `app.min.js` grew by 50 KB of Milestone 6 code and contains no MediaPipe code (test-enforced).

## 3. Dependency / licence audit

| Item | Version / file | Licence | SHA-256 |
|---|---|---|---|
| `@mediapipe/tasks-vision` | 0.10.35 (npm integrity `sha512-HOvadwVR…/egg==`) | Apache-2.0 | `vision_bundle.mjs` `55d7ab62…0fe` |
| WASM loader | `vision_wasm_internal.js` (322,044 B) | Apache-2.0 | `e7fd9858e8e8f221d9b96eddc11f8e077f263e0b7bbd79d3cbe882b134274f8c` |
| WASM binary | `vision_wasm_internal.wasm` (11,153,617 B) | Apache-2.0 | `6a5c64584c2ab61c763b6e204afbdbc7ce1caf7f5216187322bca8df94f646bc` |
| Pose model | `pose_landmarker_full.task` `float16/1` (9,398,198 B), retrieved 2026-09-23; MD5 matched the server ETag | Apache-2.0 (model card) | `5134a3aad27a58b93da0088d431f366da362b44e3ccfbe3462b3827a839011b1` |
| Apache licence text | `vendor/mediapipe/LICENSE-2.0.txt` (from apache.org, unmodified) | — | `cfc7749b…3d30` |

No other dependency was added (`@mediapipe/tasks-vision` has no dependencies). `npm audit` reports the same 4 findings before and after (1 moderate, 2 high, 1 critical, in `@xmldom/xmldom`, `brace-expansion`, `esbuild`, `tar` — Capacitor CLI and build tooling); none involves MediaPipe. Repository size: the model (vendored) and the SIMD WASM (in the committed `dist/`) add ≈ 20.5 MB of binary objects; `dist/` is committed because GitHub Pages serves it.

## 4. Camera lifecycle

| Situation | Behaviour | Evidence |
|---|---|---|
| Before Start Camera | no `getUserMedia`, no `enumerateDevices`, no runtime/model download, no `<video>` | unit + browser check 2 |
| Start | model loads and is verified **first**, then `getUserMedia({audio:false, video:{facingMode:"user", width/height ideal 640×480}})` | unit + browser 3+5 |
| Permission denied / no camera / in use / unsupported / other | typed error with recovery text; model released; no automatic re-prompt; only "Try again" asks again | unit (6 modes) + browser check 4 (real Chrome denial) |
| Cancel | tracks stopped, `srcObject` cleared, runtime closed, loop cancelled | unit + browser 6 |
| Leave (Back / close Exercise popup / tab or profile switch) | component unmount disposes the session → same release | unit (dispose) + browser 19, 20 |
| Completion | camera off **before** analysis; runtime closed | unit + browser |
| Retake | fresh stream and runtime; verified model bytes reused | unit + browser 18 + smoke A4 |
| Permission prompt still open when the user cancels/leaves | the late stream is stopped immediately | unit (mutation-tested) |
| Model still loading when the user cancels | the late runtime is closed; camera never requested | unit |
| Backgrounding (`visibilitychange`→hidden, `pagehide`) | assessment stops, camera off, "nothing was saved" | unit + browser + **iOS simulator (Home button)** |
| System ends the track | `camera_interrupted` error, everything released | unit |
| Orientation change mid-assessment | explicit `orientation_changed` error | unit |
| Repeated open → cancel → reopen → complete → retake → leave | 3 streams acquired, 3 stopped; 3 runtimes created, 3 closed; never more than one scheduled frame callback | unit |

**Mutation testing.** Ten guards in `assessmentSession.js` were removed one at a time (in-flight guard, stale-generation check, late-stream stop, late-provider close, stream stop on release, visibility handling, interval throttle, release-before-analysis, orientation check, listener removal on dispose); every removal made at least one test fail, and the restored file passed 29/29. The UI language audit was likewise shown to fail when "should", "optimal", "good form" or "score" was planted in the copy.

## 5. Privacy

| Question | Answer |
|---|---|
| Is raw video persisted? | **No.** |
| Is raw video uploaded? | **No.** |
| Are frames uploaded? | **No.** Frames go only to the local WASM runtime via one off-DOM staging canvas that is never read back and is zeroed on close. |
| Are landmarks uploaded? | **No.** |
| Is any assessment saved? | **No.** In-memory only; localStorage is byte-identical before and after an assessment; no IndexedDB database or Cache Storage entry is created (browser check 21). |
| Does any third party receive movement data? | **No.** During an assessment the only requests are same-origin GETs for `movement/pose-runtime.js`, `movement/mediapipe/vision_wasm_internal.{js,wasm}` and `movement/models/pose_landmarker_full.task` (§18). |

Static scan (`test/movementPrivacy.test.js`) over every new file for `fetch`, `XMLHttpRequest`, `FormData`, `sendBeacon`, `WebSocket`, `EventSource`, upload calls, `localStorage`, `sessionStorage`, `indexedDB`, Cache Storage, file-system APIs, `CameraRoll`, `MediaRecorder`, `toDataURL`, `toBlob`, `createObjectURL`, `getImageData`, `readPixels`, `captureStream`, `createImageBitmap`, share, `postMessage`, cookies, storage helpers and Capacitor: the only hits are the model `fetch` in `loadVerifiedModel` (same-origin GET of a static file, no user data) and one `drawImage` in the frame stager. No research/training consent flow exists because nothing is retained. The in-app privacy notice and `docs/privacy-policy.html` §4 were updated to describe exactly this.

## 6. Assessment protocol

Exercise → **Movement Assessment (Prototype)** → read What this does / Privacy / Setup / Protocol → **Start Camera** → walk into position, side-on → hold still ≈2 s (calibration, with guidance) → **"Squat now"** → one slow bodyweight squat → stand and hold → capture ends automatically (1 s after the repetition, or **Done**, or 10 s) → Results or Insufficient movement data → **Retake** or **Done**.

## 7–12. Pose contract, geometry, side selection, smoothing, segmentation, outputs

Specified exactly in MOVEMENT_ASSESSMENT.md §7–§13. Summary:

- `pose-frame-v1`: 13 named landmarks in image pixels with provider visibility and `inFrame`; `z` dropped; explicit `pose / no_pose / multiple_poses / malformed`; gating at visibility ≥ 0.5 and in frame.
- Angles: `atan2(|u×v|, u·v)` in degrees [0, 180] — knee (hip–knee–ankle) and trunk–thigh (shoulder–hip–knee; not labelled hip flexion).
- Side: median over calibration frames of the weakest hip/knee/ankle visibility; tie → mean → `left`; frozen.
- Smoothing: symmetric centred moving median (1/3/5 samples, pairs within 300 ms). **Changed during verification** from a plain truncated window after a test showed that off-centre windows at trace ends and beside gaps shift sloped segments (and therefore phase times).
- Segmentation: excursion from the calibration reference, 20° detection floor, 10%-of-excursion interpolated phase threshold, half-excursion second-rep rule, 300 ms gap limit, 8 samples inside the repetition. Failure states: `insufficient_valid_frames`, `no_clear_repetition`, `repetition_started_before_capture`, `did_not_return_to_standing`, `multiple_repetitions`, `data_gap_during_repetition`, `too_few_samples_in_repetition`, plus `calibration_incomplete` and `insufficient_capture_quality`.
- Outputs: apparent 2D knee ROM, trunk–thigh change (or "not available"), descent/ascent/total time, traces with phase events, `symmetry: unavailable_for_capture_mode`, capture quality `sufficient | limited | insufficient` with six factors, model provenance. No score, grade or normative field.

Hand-checked end-to-end values (synthetic figure, 175° → 95° with a 400 ms bottom pause): ROM **80°**, trunk–thigh change **75°** (177.5° → 102.5°), descent start 3120 ms, deepest 4200 ms, ascent end 5680 ms → descent **1080 ms**, ascent **1480 ms**, total **2560 ms**. The browser run shows 80°, 1.1 s, 1.5 s, 2.6 s.

## 13. UI

Entry card in the Exercise screen (not a new tab), labelled "Prototype" and "Separate from Tissue Load and Recovery Guidance". Screens: intro (explicit step label "Step 1 of 4: Setup", text instructions), active preview (mirrored, muted, `playsinline`, labelled "Live camera preview, not recorded", `role=status aria-live=polite` guidance in large type, calibration/capture progress bar with ARIA values, Cancel always visible, Done during capture), results (definition list, SVG trace with `<title>`/`<desc>` and a visible text summary, dashed vs solid lines so colour is not required, capture-quality list, collapsible model/method details, limitation statement, Retake/Done, focus moved to the results heading), insufficient data (reason, no numbers), error (`role=alert`, Try again/Back). Neutral styling only; a test forbids status/traffic-light colour tokens in the component and its CSS. Responsive at 320/375/390 px with no horizontal overflow (screenshots in `/tmp/physiq-m6-browser-production/`). Orientation is not locked.

## 14. Files changed

New:

| File | Purpose |
|---|---|
| `js/movement/modelVersion.js` | version family, provider/model/runtime provenance and pinned hashes, telemetry denylist |
| `js/movement/poseContract.js` | `pose-frame-v1` normalisation of untrusted provider output; landmark gating |
| `js/movement/geometry.js` | pure 2D included angle and helpers |
| `js/movement/kinematics.js` | angle definitions, per-frame samples with explicit states, traces |
| `js/movement/sideSelection.js` | deterministic analysis-side rule |
| `js/movement/smoothing.js` | symmetric centred moving median |
| `js/movement/calibration.js` | standing calibration, framing and side-on checks |
| `js/movement/squatSegmentation.js` | one-repetition segmentation |
| `js/movement/captureQuality.js` | measurement-quality factors and state |
| `js/movement/squatAssessment.js` | result contract, capture protocol constants, live completion check |
| `js/movement/sha256.js` | on-device model hash (Web Crypto + pure fallback) |
| `js/movement/mediaCapture.js` | video-only camera request, error classification, track stop |
| `js/movement/poseProvider.js` | MediaPipe adapter: lazy runtime, verified model, frame staging |
| `js/movement/assessmentSession.js` | lifecycle state machine |
| `js/movement/poseRuntimeEntry.js` | entry for the separate runtime bundle |
| `js/components/MovementAssessment.js` | presentation |
| `vendor/mediapipe/pose_landmarker_full.task`, `LICENSE-2.0.txt`, `NOTICE.md` | vendored model, licence, provenance |
| `dist/movement/**` | built runtime, WASM, model, notices (committed like the rest of `dist/`) |
| `test/movement*.test.js` (11 files), `test/fixtures/syntheticPose.js` | unit tests and synthetic geometry |
| `test/browser/movementAssessment.browser.mjs`, `test/browser/poseSmoke.browser.mjs`, `test/browser/fixtures/stubPoseRuntime.js`, `test/browser/fixtures/smokeEntry.js` | browser acceptance and real-runtime smoke |
| `MOVEMENT_ASSESSMENT.md`, `MILESTONE_6_VERIFICATION.md` | documentation |

Modified:

| File | Change |
|---|---|
| `js/screens/ExerciseTab.js` | import, `movement` view, entry card (+16 lines) |
| `css/styles.css` | appended `.ma-*` rules |
| `build.mjs` | runtime bundle build, pinned-version and SHA-256 checks, telemetry scan, asset copy |
| `package.json`, `package-lock.json` | `@mediapipe/tasks-vision` 0.10.35 exact |
| `ios/App/App/Info.plist` | `NSCameraUsageDescription` covers barcode scanning and Movement Assessment |
| `docs/privacy-policy.html` | Camera section describes Movement Assessment truthfully |
| `README.md` | Movement Assessment entry |
| `.gitattributes` (new) | keeps the SHA-pinned vendored runtime/model files byte-exact and out of text whitespace checks |
| `dist/app.min.js`, `dist/styles.min.css` | rebuilt |

Not modified: `js/App.js`, every `js/tissue/*` file, `js/utils/storage.js`, `tissueHistoryStore.js`, `tissueLoadHistory.js`, `tissueRecoveryGuidance.js`, `setMetadata.js`, `workoutSession.js`, `TissueLoadTracker.js`, `RecoveryTracker.js`, `EatsTab.js`, the golden fixture, `capacitor.config.ts`, `Package.swift`.

## 15. Automated tests

| Command | Result |
|---|---|
| `npm test` | **632 passed** (488 baseline + 144 new), 0 failed / skipped / todo / cancelled |
| `node --test test/movement*.test.js` | 144 passed — assessment 23, geometry 11, pose contract 11, pose provider 10, privacy 13, segmentation 13, session 29, sha256 4, side selection 8, smoothing 10, UI 12 |
| same, under `TZ=UTC`, `America/Phoenix`, `Pacific/Chatham`, `Asia/Kolkata` | 144 passed in each |
| `node --test test/tissueModelFreeze.test.js test/tissueLoadInvariance.test.js` | 84 passed (model source pins and golden output unchanged) |
| `npm run build` | passed; two consecutive builds byte-identical across all `dist/` files |
| `git diff --cached --check` | clean (the unmodified MediaPipe loader has upstream trailing whitespace; `.gitattributes` exempts the pinned vendor files instead of editing them) |

## 16. Browser verification

Harness: Playwright 1.62.1 driving system Chrome (headless), fresh contexts, synthetic `@example.com` profiles.

**(a) Real browser camera behaviour — Chromium fake media device** (`--use-fake-device-for-media-stream`, permission granted or withheld per context). `node test/browser/movementAssessment.browser.mjs dist production` → **24 grouped checks passed** (also 24/24 against a development build), covering all 26 required items:

1 entry visible · 2 no request before Start · 3 grant path · 4 real denial (`NotAllowedError`), no auto re-prompt · 5 preview 640×480, muted, inline, no audio track · 6 Cancel stops every track · 7 reopen · 8 instructions · 9 calibration · 10 capture · 11 guidance for no person / two people / frontal / low visibility, insufficient data, 45 s positioning timeout · 12–16 ROM 80°, timings, trace path, symmetry text · 17 language audit · 18 Retake reproduces the result · 19 Back and popup close stop the camera · 20 profile switch A→B→A carries nothing · 21 localStorage unchanged, no IndexedDB/Cache Storage, reload discards · 22 Tissue Load renders (`tissue-load-v0.1`) · 23 Recovery Guidance renders (`recovery-guidance-v0.1`) · 24 manual meal logs · 25 barcode lookup (web path; Open Food Facts stubbed; no camera call) · 26 no page or console errors · plus background (`visibilitychange`, `pagehide`), responsive 320/375/390 px, and network checks.

**(b) Stubbed/injected pose sequences.** In (a), only `movement/pose-runtime.js` is replaced (via `page.route`) by a stub returning MediaPipe-shaped landmarks for the synthetic figure. The real model file is still downloaded and verified on the page (the stub receives 9,398,198 verified bytes), and the app's real adapter, geometry, segmentation and UI run. The stub also confirms: at most one inference in flight, strictly increasing timestamps, frames delivered only as the staging canvas, and every runtime closed. **This does not show real-device pose accuracy.**

**(c) Actual pose-provider smoke test** — `node test/browser/poseSmoke.browser.mjs dist` → **6 checks passed**. Input: MediaPipe's own published PoseLandmarker test image (`mediapipe-assets/pose.jpg`, SHA-256 `c8a830ed…d62b`) and its expected landmarks (`pose_landmarks.pbtxt`, `69c79cdf…5527`), downloaded at test time and hash-checked; **not committed and not shipped**.
- A1: real runtime + WASM + model initialise through the app's adapter in ≈0.2 s; model verified on the page.
- A2: 40/40 frames from a real `<video>` (canvas stream) return a pose in `pose-frame-v1`.
- A3: landmarks agree with MediaPipe's expectation — mean normalised distance **0.010**, worst **0.020**.
- A4: verified model bytes are reusable for a second landmarker (retake path); the buffer is not detached.
- B: production app, real runtime, image as Chromium's camera (Y4M): 186 frames analysed at a bounded ≈15/s, a pose in every frame, camera-path landmarks agree with the published expectation (mean **0.007** after mapping Chromium's 4:3 crop), guidance "Turn so that your side faces the camera." (the image is a frontal yoga pose), camera released, no page or console errors.
- C: production app, real runtime, Chromium's synthetic pattern: 182/182 frames report no pose; guidance "No person detected yet".

**Defect found by (c) and fixed.** Before frame staging, run B returned hips at 0.97 and ankles at 1.10 of frame height (true ≈0.71 / 0.91): MediaPipe 0.10.35 reading a camera `<video>` whose frames Chromium had scaled/cropped produced landmarks stretched by ≈4/3, while the same frames drawn into a canvas were correct (isolated with a four-way probe: constrained camera → wrong; canvas copy of the same camera → correct; unconstrained camera → correct; canvas of the image → correct). The adapter now stages every analysed frame into one off-DOM canvas (MOVEMENT_ASSESSMENT.md §5.4), and B asserts both that the runtime receives an `HTMLCanvasElement` and that camera-path landmarks match the expectation. Without this, angles would have been silently wrong on affected browsers/devices.

**Vendor stderr.** MediaPipe's WASM prints one informational line, `INFO: Created TensorFlow Lite XNNPACK delegate for CPU.`, through Emscripten's stderr, which browsers show as `console.error`. The smoke test records and allowlists exactly that line; it is not an error condition.

## 17. iOS verification

| Step | Result |
|---|---|
| `npx cap sync ios` | succeeded; `dist/movement/**` copied to `ios/App/App/public/movement/` with matching SHA-256; 6 existing plugins; `Package.swift` unchanged; only tracked iOS change is `Info.plist` |
| `xcodebuild … -sdk iphonesimulator -destination 'iPhone 17 Pro' CODE_SIGNING_ALLOWED=NO build` | **BUILD SUCCEEDED** (Xcode 26.5) |
| Built `App.app/Info.plist` | one `NSCameraUsageDescription` (barcode + Movement Assessment text); no microphone, photo-library, motion or health keys; location key unchanged |
| Simulator (iPhone 17 Pro, iOS 26.5): launch | app installs and launches; WebView loads with no JS errors (Capacitor console) |
| Movement Assessment in WKWebView | intro renders; **Start Camera → "Preparing the on-device pose model…" → MediaPipe graph starts in WKWebView** (WebGL 2 context, XNNPACK CPU delegate), so WASM SIMD, `capacitor://` asset loading and on-device model verification work natively; the iOS 26.5 simulator's virtual camera then supplied frames (640 × 480 @ 30 fps, as requested) and the real model reported **"No person detected yet"** for its test pattern |
| Backgrounding | pressing Home mid-assessment stopped it: console shows "Graph finished closing successfully" and "Successfully destroyed WebGL context"; on return the screen says the camera was turned off and nothing was saved |
| Try again → Cancel | second graph started, then closed (2 started / 2 closed / 2 WebGL contexts destroyed) |
| Camera permission prompt | the simulator did not display a system camera prompt, so the prompt wording on a device was not observed |

The Claude Code iOS Simulator integration refused to run ("Xcode is installed but not selected", although `xcode-select -p` reports `/Applications/Xcode.app/Contents/Developer`), so the simulator was driven with `xcrun simctl` (install, launch, screenshots, console) and generic desktop control of the Simulator app for taps. To skip login/onboarding, the synthetic demo profile was written into the simulator app's WKWebView localStorage. Artifacts: `/tmp/sim-*.png`, `/tmp/physiq-m6-ios-sim-console.log`.

**Physical iOS camera verification not performed.** No physical iPhone was available. A simulator does not prove physical camera operation, real-device frame geometry, thermal/performance behaviour or the permission prompt.

## 18. Network / privacy verification

Requests recorded by Playwright for the whole grant-context acceptance run (22 requests): same-origin `/`, `/app.min.js`, `/styles.min.css`, `/movement/pose-runtime.js` (stub), `/movement/models/pose_landmarker_full.task`; external only `fonts.googleapis.com` (the app's pre-existing stylesheet link, routed to an empty response) and `world.openfoodfacts.org` (only the barcode regression check, stubbed). **No request other than a GET; no request carrying media, landmarks or results.** Every request after Start Camera is one of the static `movement/` assets or the app shell (asserted).

Real-runtime run B (production app, real MediaPipe): `GET /`, `/app.min.js`, `/styles.min.css`, `/movement/pose-runtime.js`, `/movement/mediapipe/vision_wasm_internal.js`, `/movement/mediapipe/vision_wasm_internal.wasm`, `/movement/models/pose_landmarker_full.task`, and the pre-existing Google Fonts stylesheet. **No request to any Google API, MediaPipe server or other third party during inference.** Build-time: `build.mjs` refuses a runtime containing `odml.pa.googleapis.com`, `mediapipeLoggerGetEncodedApiKey`, `x-goog-api-key` or `sendBeacon`.

## 19. Performance

| Measure | Value | Where |
|---|---|---|
| Runtime + WASM + model init (adapter) | ≈0.2 s (216–288 ms) | MacBook, headless Chrome |
| Start Camera → live preview (production app, real runtime, fake camera) | ≈0.9 s | same |
| Inference per frame, Full model, CPU delegate | median ≈49–51 ms, p90 ≈49–53 ms (first frame ≈200–250 ms) | same |
| Analysis rate | bounded at ≈15/s by the 66 ms interval; skipped while an inference is pending | same |
| Backpressure | single in-flight inference, newest frame wins, nothing queued; stale results dropped by generation | unit-tested |
| Memory | one staging canvas (≤ frame size), verified model bytes (9.4 MB) held only while the screen is mounted, pose frames only during capture (≤ 10 s ≈ 150 frames of 13 landmarks) | design; not profiled on device |

No frame rate is promised on any device. Phone performance was not measured.

## 20. Scientific limitations

Monocular single view; 2D projection of 3D motion; no camera calibration to the physical world; pose-landmark uncertainty (model-card PDJ ≈ 92% at a 20%-of-torso tolerance, with documented variation across regions and skin tones); occlusion of the far leg and, at depth, parts of the near leg; clothing; camera placement, tilt and motion; lighting; sagittal symmetry unavailable; no measured force; no tissue-level inference; no injury validation; no comparison against laboratory motion capture; results from one static test image say nothing about squat-angle accuracy.

## 21. Regression evidence

| Check | Result |
|---|---|
| `test/tissueModelFreeze.test.js` + `test/tissueLoadInvariance.test.js` | pass — `tissue-load-v0.1`, `exercise-tissue-map-v0.1` sources and golden output byte-identical |
| All 488 pre-existing unit tests | pass |
| M4/M5 browser acceptance `test/browser/tissueHistory.browser.mjs` on the new build | **35 grouped checks passed** (Tissue Load, longitudinal history, baseline, Recovery Guidance, profile isolation, persistence failures) |
| M6 acceptance items 20–25 | profile isolation, Tissue Load, Recovery Guidance, nutrition, barcode path — pass |
| M3 browser script `test/browser/tissueLoad.browser.mjs` | fails at "3,600 lb\*rep" (app shows 3,585) — **identically on the untouched baseline `dist/` from `cc6dd4c`**; stale since Milestone 4's frozen body-mass rule, not a Milestone 6 regression |

`js/App.js`, TissueOS domain files, storage, history, recovery and set-metadata code are untouched; Movement Assessment has no path to workouts, TissueOS history or set metadata (test-enforced).

## 22. Remaining issues

**Blockers:** none known.

**Non-blocking limitations / follow-ups:**
- Physical iOS camera verification not performed (no device); prompt wording, real frame geometry and phone performance unobserved.
- WebAssembly SIMD required: iOS 15.0–16.3 devices (inside the app's 15.0 deployment target) get "not supported".
- The side-on (hip separation ≤ 0.25 torso) and foot-stability heuristics are unvalidated geometric proxies.
- The M3 browser script is stale (pre-existing); a follow-up task was suggested.
- The Claude Code iOS Simulator integration reports an Xcode-selection problem on this Mac despite `xcode-select -p` pointing at Xcode.app; `sudo xcode-select -s /Applications/Xcode.app/Contents/Developer` is the fix it asks for.
- Displayed reference, minimum and ROM are rounded independently, so they can differ by 1° from simple subtraction.
- ≈20.5 MB of binaries added to the repository (model + WASM in committed `dist/`).
- MediaPipe prints one informational XNNPACK line to `console.error`.

## 23. Completion

```text
Implementation complete: yes
Verification complete: yes (physical iOS camera verification not performed)
Raw media remains local and ephemeral: yes
Milestone 6 scientific boundary preserved: yes
M0–M5 regressions clear: yes
Ready for independent Astra review: yes
Ready for Milestone 7: no — pending independent review and physical-device verification
```
