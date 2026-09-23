# Movement Assessment — video-estimated 2D squat mechanics (prototype)

TissueOS Milestone 6. Versions: `movement-assessment-v0.1` (result contract),
`squat-kinematics-v0.2` (algorithms and parameters), `pose-frame-v1`
(internal landmark contract). This family is independent of
`tissue-load-v0.1`, `exercise-tissue-map-v0.1`, `tissue-history-v1`,
`load-baseline-v0.1` and `recovery-guidance-v0.1`, none of which it reads or
changes.

Verification evidence: [MILESTONE_6_VERIFICATION.md](MILESTONE_6_VERIFICATION.md).

---

## 1. Scope

- **One assessment:** Bodyweight Squat — Side View (`bodyweight_squat_sagittal`).
- **One capture mode:** a single, stationary phone/browser camera, sagittal
  (side-on) view (`single_camera_sagittal`).
- **One repetition:** the protocol asks for exactly one deliberate squat.
- No jumps, landings, running, gait, single-leg tasks, loaded lifts or
  multi-rep sets.

## 2. Claim

Claim-ladder stage 3: **video-estimated movement mechanics.** Every number is
an *apparent* quantity measured on the 2D projection of body landmarks that a
pose model estimated from one camera image.

### Explicit non-claims

The assessment does **not** measure, estimate or imply: ground reaction
force, joint moments or kinetics, muscle, tendon or tissue force, tissue load,
injury risk (including knee valgus or ACL risk), patellar tendon stress,
recovery, readiness, capacity, mobility, diagnosis, "good" or "bad" form,
safe or unsafe movement, optimal depth, normative ranges, training or
rehabilitation recommendations, or a movement/form/mobility score. It is not
connected to Tissue Load, the longitudinal baseline or Recovery Guidance, and
it never writes to workouts, set metadata or TissueOS history.

Milestone 2's subjective per-set `rom: partial | standard | full` is a
different concept (the lifter's own call) and is never populated from video.

## 3. Privacy

| Question | Answer |
|---|---|
| Is raw video persisted? | No. Frames exist only in the live `MediaStream`, the `<video>` element and one reusable in-memory staging canvas (§5.4) while a capture runs. |
| Is raw video uploaded? | No. |
| Are frames uploaded? | No. Frames are passed only to the local WebAssembly pose runtime. |
| Are landmarks uploaded? | No. Landmarks stay in the session's memory and are discarded when the capture ends. |
| Is any assessment saved? | No. The result lives in React state on the assessment screen and is discarded on leave, retake, profile switch or reload. There is no storage key. |
| Does any third party receive movement data? | No. After the static app files load, the assessment makes only same-origin GETs for its own runtime, WASM and model files. |

- The camera is requested only after the user taps **Start Camera** (never at
  app start), with `audio: false`. No microphone, photo-library, motion or
  health permission exists or was added.
- The camera stops when the user cancels, leaves the screen, closes the
  Exercise popup, switches profile, the page/app goes to the background
  (`visibilitychange` → hidden, `pagehide`), the system ends the track, the
  capture finishes, or any error occurs — before any analysis runs.
- There is no consent flow for research or model training because no media or
  derived data is retained. Camera permission for operating the feature and
  research/training consent are separate concepts; Milestone 6 has only the
  former.
- iOS `NSCameraUsageDescription`: *"PhysiQ Engine uses the camera only when you
  choose to scan a food barcode or run a Movement Assessment. Movement
  Assessment video is processed on this device and is not saved or uploaded."*

## 4. Pose provider

| Field | Value |
|---|---|
| Runtime | `@mediapipe/tasks-vision` **0.10.35**, pinned exactly (Apache-2.0) |
| Task | `PoseLandmarker`, `runningMode: "VIDEO"`, `delegate: "CPU"`, `numPoses: 2`, detection/presence/tracking confidence 0.5, no segmentation masks |
| Model | `pose_landmarker_full.task`, `float16/1` — BlazePose GHUM 3D Full (`blazepose_ghum_39kp_full_oss_2021_07_02` + `blazepose_detector_eff_retina_4kp_sparse_2021_10_18`), Apache-2.0 per the model card |
| Model SHA-256 | `5134a3aad27a58b93da0088d431f366da362b44e3ccfbe3462b3827a839011b1` (9,398,198 bytes) |
| WASM | `vision_wasm_internal.wasm` `6a5c6458…46bc`, loader `vision_wasm_internal.js` `e7fd9858…4f8c` |
| Provenance | [vendor/mediapipe/NOTICE.md](vendor/mediapipe/NOTICE.md) (source URLs, retrieval date, licences, hashes) |

**Why this runtime and version.** MediaPipe's pose landmarker is an
established local 2D/3D pose estimator with a published model card, per-landmark
visibility, a WebAssembly build that runs in WKWebView, and bundleable assets.
TensorFlow.js pose-detection (MoveNet/BlazePose) was the main alternative; it
needs the larger TF.js runtime and its models are normally fetched from a model
hub, with no advantage for this scope. **`@mediapipe/tasks-vision` 1.0.0 and
1.0.1 were rejected**: they create, unconditionally and without a public
opt-out, a usage logger that POSTs the task name, running mode, device
platform, library version and inference-latency statistics to
`https://odml.pa.googleapis.com/v1/log` every 60 s. 0.10.35 is the latest
release without it. `build.mjs` fails if the shipped runtime contains that
endpoint or related markers, or if any runtime/model file differs from its
pinned SHA-256.

**Why the Full model.** The model card reports PDJ (PCK@0.2) averages of 87.0%
(Lite), 91.8% (Full) and 94.2% (Heavy), and a narrower skin-tone range for Full
than Lite (7.0 vs 7.3 points; Lite's lowest skin-tone group is 80.5%). Heavy is
~26 MB and about 4× slower. Angle measurements depend directly on landmark
accuracy, so Full was chosen over Lite; the analysis rate is bounded (§5.3) to
keep it usable on phones.

**Why the verified bytes are passed in.** The app fetches the model from its
own bundle, checks size and SHA-256 **on the device** (Web Crypto, or a pure
FIPS 180-4 implementation when Web Crypto is unavailable), and hands MediaPipe
the verified bytes (`modelAssetBuffer`). MediaPipe therefore never fetches a
model URL, and every result's `provenance.modelVerifiedOnDevice` is a checked
fact.

**Requirements.** WebAssembly SIMD (iOS 16.4+, current Chrome/Firefox/Safari).
The non-SIMD fallback binary is not shipped; unsupported engines get a clear
"not supported" state. The app's iOS deployment target is 15.0, so iOS
15.0–16.3 devices cannot use Movement Assessment.

**Replacing the model or runtime** requires updating `POSE_PROVIDER`,
`POSE_MODEL` and `RUNTIME_ASSETS` in `js/movement/modelVersion.js`,
`vendor/mediapipe/NOTICE.md`, and bumping `squat-kinematics-v0.2`: different
landmarks are a different measurement.

## 5. Architecture

```text
camera/media lifecycle        js/movement/mediaCapture.js, assessmentSession.js
        ↓
pose-provider adapter         js/movement/poseProvider.js  (only file that knows MediaPipe)
        ↓
pose frame contract           js/movement/poseContract.js  (pose-frame-v1)
        ↓
pure geometry                 js/movement/geometry.js, kinematics.js
        ↓
side / smoothing / calibration / segmentation / quality
                              sideSelection.js, smoothing.js, calibration.js,
                              squatSegmentation.js, captureQuality.js
        ↓
assessment result             js/movement/squatAssessment.js  (movement-assessment-v0.1)
        ↓
React presentation            js/components/MovementAssessment.js
```

Entry point: **Exercise → Movement Assessment (Prototype)** card, inside the
existing Exercise screen (no new navigation tab). The component receives only
an exit callback.

### 5.1 Lazy runtime

`build.mjs` compiles the MediaPipe runtime into its own script,
`dist/movement/pose-runtime.js` (an IIFE exposing `PhysiqPoseRuntime`), and
copies the WASM and model next to it. The app bundle does not contain it;
it is injected only after **Start Camera**. Assets resolve relative to
`app.min.js`, which works for `dist/index.html`, the repository-root
`index.html` served by GitHub Pages, and the Capacitor bundle
(`capacitor://localhost/`).

### 5.2 Session lifecycle (`assessmentSession.js`)

```text
idle → loading_model → starting_camera → positioning ⇄ calibrating
     → capturing → analyzing → results | insufficient
any active phase → error      cancel() from anywhere → idle
```

The model loads **before** the camera is requested, so an unsupported device
never turns the camera on. Invariants (each covered by a test that fails when
the guard is removed):

1. Every acquired `MediaStreamTrack` is stopped when the session leaves an
   active phase for any reason — including a stream that arrives after the
   user cancelled while the permission prompt was open.
2. At most one inference is in flight; ticks that arrive meanwhile, or sooner
   than 66 ms after the previous inference, are skipped. Nothing is queued —
   the newest frame wins.
3. Every async continuation carries a generation number; results from a
   cancelled, retaken, failed or unmounted session are discarded.
4. Pose frames live only in the session closure and are released when capture
   ends; only the derived result survives, in memory.

Background behaviour: `visibilitychange` → hidden and `pagehide` stop the
assessment (camera off, runtime closed, "nothing was saved" message). Verified
in Chromium and in the iOS 26.5 simulator's WKWebView by pressing Home. There
is no background capture.

Orientation: the app's orientation settings are unchanged (no lock). The
setup instructions ask for portrait; if the frame dimensions change during an
assessment, it stops with an explicit "orientation changed" state rather than
mixing geometries.

### 5.3 Frame rate and backpressure

The frame loop runs on `requestAnimationFrame`; the preview itself plays at
camera rate. Inference runs at most every 66 ms (≈15 per second) and only
when no inference is pending. Measured on a MacBook (headless Chrome, CPU
delegate): about 50 ms per inference with the Full model, runtime +
model initialisation about 0.2 s. No fixed rate is promised on any device.

### 5.4 Frame staging (defect found and fixed during verification)

MediaPipe 0.10.35 reading a camera `<video>` directly returned landmarks
stretched by about 4/3 when the browser scaled or cropped the camera frames to
meet the requested size (Chromium; hips reported at 97% of frame height instead
of 71%). The same frames drawn into a canvas gave correct positions. The
adapter therefore draws each analysed frame into **one reusable, off-DOM 2D
canvas** of exactly `videoWidth × videoHeight` and passes that canvas to
MediaPipe. The canvas is never attached to the document or read back by app
code (no `getImageData`, `toDataURL`, `toBlob`), each frame overwrites the
previous one, and it is shrunk to 0 × 0 when the runtime closes. A browser
regression check compares camera-path landmarks with MediaPipe's published
expectation for its own test image.

## 6. Camera protocol

**Setup (shown as text before the camera starts):** phone on a stable surface,
portrait; stand side-on; move the camera back until head to feet stay visible
throughout the squat; feet visible with room to squat; camera level; bright,
even lighting; only one person in view; clothing that does not completely
cover hips, knees and ankles; stay within about 4 m (setup guidance only — the
app does not measure distance; the model card lists > 4 m as out of scope).

**Protocol:**

1. Tap **Start Camera**, then walk into position.
2. Stand still, side-on, until the screen shows **"Squat now"** (≈2 s calibration).
3. Do one slow, controlled bodyweight squat.
4. Return to standing and hold still; capture ends automatically.

Capture ends 1 s after a complete repetition is detected, when the user taps
**Done**, after 10 s, or immediately if a second person enters the view.
If no usable standing pose is found within 45 s the
assessment ends as "insufficient" with the last guidance message.

**Camera request:** `{ audio: false, video: { facingMode: "user", width: { ideal: 640 }, height: { ideal: 480 } } }`.
The front camera lets the person see the framing; the preview is mirrored for
display only (a CSS transform — analysed pixels are not mirrored).

## 7. Internal pose contract (`pose-frame-v1`)

```text
{ contract: "pose-frame-v1", timestampMs, frameWidth, frameHeight,
  provider: "mediapipe-tasks-vision", modelId: "pose_landmarker_full",
  status: "pose" | "no_pose" | "multiple_poses" | "malformed",
  poseCount, landmarks: { <name>: { x, y, visibility, inFrame } | null } }
```

- Landmarks kept: `nose`, and left/right `shoulder`, `hip`, `knee`, `ankle`,
  `heel`, `foot_index` (BlazePose indices 0, 11–12, 23–32). "Left"/"right" are
  the subject's anatomical sides as labelled by the model.
- `x`, `y` are **image pixels** (provider-normalised values × frame size),
  converted once so that angles are aspect-correct. Angles computed in
  separately normalised units would be distorted on non-square frames.
- `visibility` is the provider probability in [0, 1] that the point is in
  frame and not occluded (model card definition). `inFrame` is true when the
  normalised x and y are both within [0, 1].
- `z` is dropped: the model card states it is synthetic, relative to the hips,
  and "not metric but up to scale".
- Provider output is untrusted. Non-finite or out-of-range coordinates, out-of-range
  visibility, short arrays and wrong types become `null` landmarks or a
  `malformed` frame — never `(0, 0)`, never NaN/Infinity.
- Two poses → `multiple_poses` with no landmarks (which person is the subject
  is ambiguous). Zero poses → `no_pose`.

**Landmark gating (measurement-quality threshold, not an athlete threshold):**
a landmark is usable for an angle only when it is present, `inFrame`, and
`visibility ≥ 0.5` (more likely visible than not; MediaPipe's own default
cut-off). Each angle sample records why it is unavailable:
`valid | no_pose | multiple_poses | malformed | missing | out_of_frame | low_confidence | degenerate`.

## 8. Geometry

Included angle at B for image points A–B–C, in **degrees**, range **[0, 180]**:

```text
u = A − B,  v = C − B,  angle = atan2(|u × v|, u · v)
```

`atan2` of the cross and dot products is exact at 0° and 180° (unlike `acos`).
180° = collinear with B between A and C; smaller = more flexion at B. The angle
is unsigned — a 2D projection cannot tell which way a joint bends. Missing,
non-finite or coincident points (segment length < 1e-9 px) return `null`.

| Metric | Points | Vertex | Meaning |
|---|---|---|---|
| Apparent 2D knee angle | hip → knee → ankle | knee | 180° = straight leg in the image |
| Apparent 2D trunk–thigh angle | shoulder → hip → knee | hip | Angle between the shoulder–hip and hip–knee lines. Combines hip flexion with trunk and pelvic motion; **not** hip flexion and never labelled as such |

## 9. Side selection

Chosen once from the calibration frames, then **frozen** for the assessment.

1. Only single-pose frames take part.
2. Per frame and side, the side's score is the **lowest** visibility among its
   hip, knee and ankle (a missing or out-of-frame landmark scores 0).
3. Each side's score is the median over those frames.
4. The higher median wins; equal medians → higher mean (summed in sorted order,
   so frame order cannot matter); still equal → `left` by documented
   convention.
5. If the winning median is below 0.5, no side is chosen (calibration reports
   the landmarks are not clearly visible).

The result exposes `analysisSide: "left" | "right"`.

## 10. Calibration

The latest 2 s of pose frames are evaluated as a block. Calibration completes
the first time every check passes:

| Check | Rule | Failure guidance |
|---|---|---|
| One person | no `multiple_poses` frame in the window | "More than one person is in view…" |
| Person present | at least one single-pose frame | "No person detected yet…" |
| Side | §9 selects a side | "Your hip, knee and ankle are not clearly visible…" |
| Framing | ≥ 90% of frames have nose, analysed hip/knee/ankle and heel-or-toe in the image | "Your whole body is not in view…" |
| Side-on | median of hip-to-hip distance ÷ torso length (shoulder midpoint to hip midpoint) ≤ 0.25 | "Turn so that your side faces the camera." |
| Visibility | ≥ 90% of frames have a valid knee angle and full framing | as Side |
| Still | smoothed knee angle range ≤ 10° | "Hold still, standing upright." |
| Duration | window spans ≥ 1.7 s with ≥ 8 usable frames | "Calibrating…" (progress shown) |

It establishes only: the analysis side; the **standing reference knee angle**
(median raw knee angle in the window); the standing reference trunk–thigh angle
(median, when ≥ 8 valid samples); the apparent standing height in pixels (nose
to analysed ankle) and the ankle's image position, both used only by the
capture-quality check. It does not establish limb lengths, camera distance or
any physical scale. The side-on ratio is a geometric heuristic, not validated
against a reference system.

All thresholds in §10–§13 are **algorithmic detection parameters** deciding
whether the capture is usable. None is a health, mobility or form standard.

## 11. Smoothing

Symmetric centred moving median over at most 5 samples: sample *i* plus, for
*k* = 1, 2, the **pair** (*i − k*, *i + k*) — included only when both members
are valid and both lie within 300 ms of *i*. Windows therefore hold 1, 3 or 5
values.

- A linear segment passes through unchanged, including at the ends of the
  trace and across gaps, so smoothing adds no systematic time shift to the
  phase times.
- Invalid samples stay invalid; nothing is interpolated or filled.
- Timestamps are unchanged. The first and last sample keep their own value;
  one step in, 3 values.
- Single-frame spikes are removed away from the ends.
- At a sharp turning point without a pause, the median can report a minimum
  slightly above the most extreme raw sample; this is one reason ROM is
  called apparent.

## 12. Segmentation (one repetition)

Input: the smoothed knee-angle trace of the capture window and the standing
reference R.

1. At least 10 valid samples, otherwise `insufficient_valid_frames`.
2. Deepest point: the smallest smoothed angle A_min, **earliest** on ties (a
   pause at the bottom is counted in the ascent).
3. Observed excursion E = R − A_min. If E < 20° → `no_clear_repetition`.
   20° is a detection floor several times the standing jitter of the smoothed
   trace; it is not a depth standard. Shallower movements are outside what
   v0.1 can segment.
4. Phase threshold T = R − 0.1·E.
5. **Descent start:** walking back from the deepest point, the first valid
   sample ≥ T; the start is the linearly interpolated T-crossing between that
   sample and the next valid one. None → `repetition_started_before_capture`.
6. **Ascent end:** walking forward, the first valid sample ≥ T, interpolated
   the same way. None → `did_not_return_to_standing`.
7. **One-repetition protocol:** any valid sample outside [start, end] at or
   below R − 0.5·E → `multiple_repetitions`. Reps are never averaged or chosen
   between.
8. **Data sufficiency:** every step between consecutive valid samples from the
   sample before the start to the sample after the end must be ≤ 300 ms
   (`data_gap_during_repetition`), and ≥ 8 valid samples must lie inside the
   repetition (`too_few_samples_in_repetition`).

Because the boundaries sit 10% of E inside the movement, durations exclude the
first and last slow tenth of the knee excursion.

## 13. Outputs

### ROM

```text
apparent 2D knee ROM (°) = R_knee − min(smoothed knee angle in the detected repetition)
```

Positive: the knee angle closed by that many degrees. Shown as, for example,
**"Apparent 2D knee ROM 80°"** with "standing 175° → minimum 95°" beneath —
never as "your knee flexion". Stored to 0.1°, displayed as whole degrees
(reference, minimum and ROM are each rounded independently for display).

`apparent 2D trunk–thigh angle change (°) = R_trunk − min(smoothed trunk–thigh angle between start and end)`
— reported only when a standing reference exists and ≥ 80% of the trunk–thigh
samples inside the repetition are valid (and at least 8); otherwise
"Not available — landmark quality too low for this angle".

### Timing

```text
descent = deepest − descent start
ascent  = ascent end − deepest
total   = ascent end − descent start
```

Milliseconds in the result (integers, never negative, NaN or Infinity);
displayed in seconds to 0.1 s. Descriptive only: no power, velocity quality,
fatigue or readiness inference.

### Traces

Knee and trunk–thigh traces (`tMs` from capture start, raw and smoothed angle,
sample state) and the three phase events are shown in a small SVG chart: time
on x, apparent 2D angle in degrees on y, neutral colours, solid knee line and
dashed trunk–thigh line (distinguishable without colour), neutral dashed
markers labelled start / deepest / end, and an adjacent text summary. Invalid
samples break the line; non-finite values can never reach the SVG path.

### Symmetry

Always `{ state: "unavailable_for_capture_mode", captureMode: "single_camera_sagittal", reason: "single_sagittal_view" }`.
UI: *"Left/right symmetry is not estimated from a single sagittal capture in
this prototype."* One side-on camera sees one leg clearly and the other
occluded or differently projected, so comparing them would be false precision.
A future front-view assessment may support a validated symmetry metric.

### Capture quality (measurement quality, not movement quality)

| Factor | Measure | Limited / insufficient when |
|---|---|---|
| `usable_frames` | share of capture frames with a valid knee angle | < 0.8 limited; < 0.5 insufficient |
| `landmark_confidence` | median over valid samples of the lowest hip/knee/ankle visibility | < 0.75 limited |
| `single_person` | frames with two poses | any → insufficient; stop capture because subject identity is ambiguous |
| `body_in_frame` | share of pose frames with head and analysed leg/foot in view | < 0.9 limited |
| `foot_stability` | 90th-percentile ankle displacement from its calibration position ÷ apparent standing height | > 0.08 limited (camera or feet moved; one camera cannot tell which) |
| `repetition` | one repetition segmented | no → insufficient |

`sufficient` = segmented and every factor passed; `limited` = numbers shown
with the caveat; `insufficient` = no numbers are shown (status
`insufficient_data`, metrics `unavailable`, no traces, no events). The UI states
that quality "describes how reliable this measurement is, not how you moved".
Quality never changes a measured value. Model visibility is reported as model
visibility, not as a statistical or biological confidence interval; no
confidence intervals are invented.

### Result contract (`movement-assessment-v0.1`)

```text
{ contract, kinematicsVersion, poseFrameContract,
  assessment: { id, label, captureMode, repetitionsRequested: 1 },
  provenance: { provider, providerVersion, task, delegate, modelId,
                modelVersion, modelSha256, modelVerifiedOnDevice },
  parameters: { every threshold above },
  status: "complete" | "insufficient_data", insufficientReason,
  analysisSide, reference: { kneeDeg, trunkThighDeg, calibrationFrames, calibrationSpanMs },
  metrics: { kneeRom, trunkThighChange, timing, symmetry },
  events: { descentStartMs, deepestMs, ascentEndMs } | null,
  traces: { knee: [...], trunkThigh: [...] } | null,
  quality: { state, factors, totalFrames, captureDurationMs, usableFrames, ... } }
```

There is no score, grade, rating, norm, percentile rank, force, load, tissue,
injury, readiness or recovery field (a test enumerates every key).

## 14. Persistence

None. No localStorage key, IndexedDB database, Cache Storage entry, file or
upload is created. A page reload, leaving the screen, retake or profile switch
discards the result. This is intentional for the prototype: Milestone 7 owns a
research backend and derived-feature architecture, and storing movement
profiles deserves its own contract.

## 15. Limitations

- **Monocular, single view:** one camera, one side; depth is not measured.
- **2D projection:** angles depend on how the limb projects onto the image;
  rotation away from a true side view changes them.
- **No camera calibration:** no lens model, no physical scale, no camera
  height or distance.
- **Pose-model uncertainty:** landmarks are estimates (model-card PDJ ≈ 92% for
  Full at a 20%-of-torso tolerance); occluded landmarks are "best guess"
  predictions; performance varies across people and conditions as reported in
  the model card.
- **Occlusion:** the far leg is hidden in a side view; the near leg can be
  partly hidden at the bottom of a squat.
- **Clothing:** loose clothing moves landmark estimates.
- **Camera placement and motion:** tilt, height and a moving camera change or
  corrupt the measurement; foot stability is only a proxy.
- **Lighting and background** affect landmark quality.
- **Symmetry:** not available in sagittal v0.1.
- **No force or tissue measurement; no injury validation;** no comparison with
  laboratory motion capture has been performed.
- **Device support:** WebAssembly SIMD required (iOS 16.4+); physical-device
  camera behaviour has not been verified (see the verification report).

## 16. Tests

| File | Covers |
|---|---|
| `test/movementGeometry.test.js` | included-angle maths against hand-derived values; invariances; invalid input |
| `test/movementPoseContract.test.js` | adapter normalisation, pixel conversion, malformed and multi-person input |
| `test/movementPoseProvider.test.js` | MediaPipe configuration, frame staging, timestamps, typed failures |
| `test/movementSideSelection.test.js` | deterministic, frozen side choice |
| `test/movementSmoothing.test.js` | symmetric median, gaps, boundaries, spikes |
| `test/movementSegmentation.test.js` | clean, none, partial, two-rep, jitter, gaps, hand-calculated times |
| `test/movementAssessment.test.js` | calibration, ROM, timing, quality, result contract |
| `test/movementSession.test.js` | camera/inference lifecycle, races, backgrounding |
| `test/movementUi.test.js` | rendering of every state, accessibility hooks, language audit |
| `test/movementPrivacy.test.js` | no upload/persistence APIs, runtime pin, hashes, iOS permissions, boundaries |
| `test/movementSha256.test.js` | on-device hash against node:crypto; tampered model rejected |
| `test/browser/movementAssessment.browser.mjs` | end-to-end acceptance with a fake camera and a stubbed runtime |
| `test/browser/poseSmoke.browser.mjs` | real runtime + model on MediaPipe's own test image, including the camera path |
