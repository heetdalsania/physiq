# Milestone 6 independent adversarial review

Review date: 2026-09-23. Scope: PR #28, Movement Assessment only. This review did not merge the PR or begin Milestone 7.

## 1. Reviewed state

- Canonical pre-M6 main: `cc6dd4cf75544fb8fedd64bf67332635ee984896`.
- Original PR head: `e84c17178e39f021db9202d7690535731a565758`, branch `claude/milestone-6-camera-capture-bd88ca`. `git fetch` and fast-forward found no newer commit.
- Baseline after `npm ci`: 632 tests passed, 0 failed, 0 skipped; `npm run build` succeeded; worktree clean. These counts were observed, not taken from the implementation report.
- After review fixes: 634 tests passed, 0 failed, 0 skipped; production build and `git diff --check` succeeded.

## 2. Independent architecture assessment

`ExerciseTab` mounts a standalone React screen and passes no workout or TissueOS data into it. `assessmentSession` owns the camera, one frame loop, provider, in-memory frames and generation guard. `poseProvider` lazily loads a separate MediaPipe runtime, local WASM and verified model bytes; it stages each frame in one reusable canvas. `poseContract` converts normalized landmarks to image pixels. Pure calibration, smoothing, kinematics, segmentation and quality modules produce one result, kept in component memory until exit or retake.

## 3. Findings

| Severity | File/function | Reproduction and impact | Prior coverage | Resolution |
|---|---|---|---|---|
| HIGH | `captureQuality`, `squatAssessment`, `assessmentSession` | One `multiple_poses` frame during a synthetic squat still produced a complete 80° result. A second person makes subject identity ambiguous, and the model card lists multiple people as out of scope. | A test explicitly expected the unsafe limited-quality result. | Stop capture immediately; classify it insufficient, give a specific reason, suppress metrics. Unit, session and browser checks added. |
| MEDIUM | `poseProvider` cached model path | A one-byte-mutated cached model was accepted and labeled verified on device. | The prior test asserted reuse without refetch, but did not rehash. | Recheck size and SHA-256 on every provider creation, including retake. Tampered cache test added. |
| MEDIUM | `poseProvider.loadPoseRuntime` | A script request that never emitted load or error left model loading pending indefinitely; later retry shared that promise. | Error and retry covered; stalled request was not. | A 30-second timeout rejects, removes the script when possible and clears the shared promise; timeout and retry tested. |
| LOW | Results copy | “Total repetition time” implied full motion, while phase boundaries are the 10% observed-excursion crossings. | Math tested; wording was not. | Label changed to “Detected repetition time” and the excluded movement ends are explained. |
| NOT A DEFECT | M3 browser test | It expects 3,600 lb\*rep while the app shows 3,585. | Existing test failure. | Reproduced on untouched `cc6dd4c`; left outside M6. |

The capture-quality rule changed, so the result's `squat-kinematics` version advanced to `v0.2`. No unrelated architecture was refactored.

## 4. Privacy verdict

| Question | Finding |
|---|---|
| Raw video persisted? | No production path found. |
| Raw video or frames uploaded? | No production path found; browser network observation found no such request. |
| Landmarks uploaded? | No. |
| Assessment result persisted? | No; browser storage snapshots and reload check agree. |
| Third-party telemetry? | None found in the pinned runtime strings, WASM endpoint search, or a 65-second real-engine inference run. This is observed evidence, not a proof about every future runtime. |
| External runtime/model fetch? | No. Assessment assets were same-origin static GETs. The existing Google Fonts request and unrelated food lookup are separate app traffic. |

The staging canvas is not attached to the DOM, read back, encoded or saved by production code. Browser fixtures do use image readback to make a fake camera file; they are test-only.

## 5. Camera lifecycle verdict

The model loads before camera permission is requested. The camera request uses `audio: false`. Completion, Done, Cancel, Back, popup close, profile switch, unmount, backgrounding, pagehide, track end, orientation change and error paths stop tracks, detach video, cancel the loop and close the provider. A stream resolving after cancellation is stopped. Generation checks discard old inference and provider continuations. Session tests cover pending model, permission and inference races; the production browser flow covers cancellation, retake, background, profile change and navigation. An independent 20-cycle start/cancel loop acquired and stopped 20 tracks, created and closed 20 providers, and canceled 20 scheduled frames. Three temporary mutations of `track.stop()`, the generation guard and the model hash guard each made tests fail; all mutations were restored.

## 6. Pose/runtime verdict

`@mediapipe/tasks-vision` is exactly `0.10.35` in `package.json` and the lockfile, with registry integrity pinned. The versioned Full model URL in [Google's MediaPipe sample](https://github.com/google-ai-edge/mediapipe-samples-web/blob/main/src/tasks/pose-landmarker.ts) matches the vendored bytes byte-for-byte: SHA-256 `5134a3aad27a58b93da0088d431f366da362b44e3ccfbe3462b3827a839011b1`, 9,398,198 bytes. The WASM loader and binary match their build-time SHA-256 constants. The build checks those hashes and scans the generated runtime for known telemetry markers. The model is checked again in the browser before inference and on cached reuse. The [Google model card](https://storage.googleapis.com/mediapipe-assets/Model%20Card%20BlazePose%20GHUM%203D.pdf) states Apache-2.0 licensing and lists multiple-person input as out of scope.

MediaPipe received an `HTMLCanvasElement`, not the video element, in the real Chrome camera-path run. That path produced a 640×480 frame from the non-4:3 fixture and landmarks near the independent expected coordinates (mean normalized distance 0.0073). In an isolated temporary build, replacing the staging canvas with the video element made the real-engine smoke test fail: the observed source became `HTMLVideoElement`, and mean landmark distance rose to 0.272. No mutation was committed. The preview mirror is CSS-only; the staged analysis pixels are not mirrored. The runtime resolves assets beside `app.min.js`; browser tests cover path variants, and the Capacitor app bundle contains those paths. WASM SIMD is checked before model fetch and camera request; unsupported engines receive an error. The iOS 15–16.3 compatibility gap remains a disclosed feature-level limitation. The global iOS deployment target was not raised.

Same-origin JavaScript compromise is outside this integrity boundary: malicious replacement of `app.min.js` could also remove client-side checks. The model hash does protect against an accidental or isolated model asset replacement.

## 7. Geometry verdict

The included angle at B is `atan2(abs((A-B)×(C-B)), (A-B)·(C-B))`, in degrees. Independent hand cases returned 0°, 45°, 90°, 135° and 180°. Degenerate or non-finite points yield no angle. Normalized x and y are separately multiplied by frame width and height before geometry, so a rectangular image does not skew the angle. The reported knee metric is an apparent 2D image angle, not a 3D anatomical angle.

## 8. Calibration verdict

Calibration uses a rolling two-second window, at least 1.7 seconds of span, at least eight usable frames, a selected anatomical side, framing and visibility checks, stillness, and a hip-separation/torso-length ratio ≤0.25. The ratio is a rough, unvalidated side-view proxy. It can misclassify oblique views, perspective and body proportions; this remains a prototype limitation. The reference is the captured standing knee angle, not anatomical zero or proven full extension. The side is frozen. If its visibility collapses during capture, metrics fail rather than switch sides.

## 9. Segmentation verdict

The algorithm requires ten valid capture samples, a 20° observed-excursion detection floor, 10% phase crossings, at least eight in-repetition samples, and gaps no longer than 300 ms. Boundaries are linearly interpolated. The earliest deepest-point tie assigns a bottom pause to ascent, as documented. Durations are nonnegative and finite in tests. The 20° and 50% second-rep values are detection rules, not depth or form standards. Independent synthetic traces at 5, 8, 10, 15 and 30 fps returned the expected 900 ms descent and ascent between crossings. Sparse, gapped, incomplete and multiple-rep paths have explicit insufficient states. This does not establish measurement accuracy on real squats.

## 10. Scientific semantics verdict

Visible output stays within video-estimated 2D angles, apparent ROM, phase timing and measurement quality. The shoulder–hip–knee metric is called trunk–thigh change, not hip flexion. No force, tissue load, injury probability, safety grade, diagnosis, recommendation or movement score is produced. The Movement Assessment path neither reads nor writes the workload, history, baseline, recovery, workout or M2 ROM stores.

## 11. Profile/privacy isolation verdict

Unmount on profile switch disposes the session and clears video, frames, provider and result. Browser tests switched synthetic profiles during capture and verified no old result or camera remained. Storage snapshots before and after assessment matched.

## 12. Browser verification

- **Stubbed pose runtime, real app and fake camera:** production and development acceptance each passed 28 grouped checks with same-origin model fetch and on-device hash verification. Checks covered permission, retake, cancel, background, profile switch, no person, multiple people, orientation change, runtime 404, bad model bytes, responsiveness, storage and network.
- **Real runtime and model:** the smoke fixture produced landmarks and a no-person response; the adapter used the staging canvas. Its published expected landmarks are an integration reference with a few-percent tolerance, not a scientific ground truth. A temporary direct-video mutation failed this test and materially distorted the landmark positions.
- **Long real-engine run:** 65 seconds, 658 inferences, no movement-data upload or delayed telemetry request. Only same-origin app assets and the pre-existing Google Fonts request appeared.

## 13. Native verification

`npx cap sync ios` and an unsigned iOS simulator Xcode build succeeded. The built app launched on an iPhone 17 Pro iOS 26.5 simulator, and the Movement Assessment setup screen rendered in WKWebView. No simulator camera capture was claimed. **Physical iPhone camera verification remains unperformed.** No iOS 15–16.3 simulator run was available.

## 14. Performance verdict

No pose runtime, WASM or model request occurred on ordinary app startup before Start Camera. The assessment adds about 20 MB of lazily loaded assets. The real smoke run observed about 0.96 s adapter/model initialization, 28 ms median inference in its first image loop, and 14.4 analysed fps in its 12-second camera run. The 65-second run averaged 10.1 fps on the test host. One inference at a time and no queued backlog were verified; these are host observations, not phone guarantees.

## 15. M0–M5 regression verdict

The full 634-test suite passed. Ninety-nine targeted model-freeze/invariance/history tests passed. The M4/M5 browser harness passed 35 grouped checks, including persistence, profile isolation, workload and recovery paths. The barcode web path initialized and its manual lookup worked against a stub; physical barcode camera behavior was not exercised.

## 16. Pre-existing issue

The M3 `tissueLoad.browser.mjs` script fails on untouched `cc6dd4c`: it expects `3,600 lb*rep`, while the current post-M4 behavior renders `3,585 lb*rep`. This review did not change it.

## 17. Fixes made

Commits `446f315` and `9017a9b` on `claude/milestone-6-camera-capture-bd88ca` harden person-identity handling, cached-model integrity and runtime loading; clarify phase-time copy; bump the kinematics version; add focused and browser coverage; and record the isolated staging mutation. Both were pushed to PR #28. The PR remains open and unmerged.

## 18. Remaining limitations

- **Blocking defects:** none found after the fixes and verification above.
- **Prototype limitations:** side-view and capture-quality heuristics are not validated orientation or movement-performance measures; detection may miss a second person; very short or low-sample movements fail explicitly. A 20 MB asset bundle affects storage and first-use loading. A stale runtime/WASM cache mix in a future version upgrade was not reproduced; versioned asset paths should be considered when those pinned bytes change.
- **Scientific validation gaps:** no calibrated 3D motion-capture comparison, clinical validation or performance normative study was performed.
- **Device-validation gaps:** physical iPhone camera, native permission flow and older iOS behavior remain untested. The simulator verifies build and screen load only.

## 19. Final status

| Decision | Status |
|---|---|
| M6 architecture sound | Yes, for the scoped prototype |
| Camera lifecycle sound | Yes in tested web/session paths; physical device gap remains |
| Privacy contract sound | Yes in code and observed network runs |
| Pose/runtime provenance sound | Yes within the same-origin app trust boundary |
| 2D geometry sound | Yes |
| Segmentation/timing sound | Yes for tested synthetic inputs; not scientifically validated |
| Scientific boundary preserved | Yes |
| M0–M5 regressions clear | Yes, apart from the independently reproduced pre-existing M3 test drift |
| Physical iPhone validated | No |
| Blocking defects remaining | No known blocker |
| Review fixes pushed to PR #28 | Yes |
| Ready to merge Milestone 6 | Yes for this review scope, with stated device gaps |
| Ready to begin Milestone 7 | No; PR #28 remains unmerged and this review did not begin M7 |
