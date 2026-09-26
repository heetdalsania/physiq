# Research Backend — derived movement data from approved research video (prototype)

TissueOS Milestone 7. Python service in [`research_backend/`](research_backend/).
Verification evidence: [MILESTONE_7_VERIFICATION.md](MILESTONE_7_VERIFICATION.md).
Setup and commands: [research_backend/README.md](research_backend/README.md).

> **Status: local / internal research prototype.** This service must not be
> exposed publicly without authentication, authorization, participant-consent
> controls and a production security review. It has none of these.

---

## 1. Scope

- Turns ONE approved research video of ONE bodyweight squat filmed side-on
  (`bodyweight_squat_sagittal`, capture mode `single_camera_sagittal`) into
  versioned, reproducible, derived **Stage-3 (video-estimated movement
  mechanics)** data: 2D pose landmarks, a normalized skeleton, apparent 2D
  joint-angle traces, one segmented repetition, phase timing and capture
  quality.
- Research tooling only. **It is not connected to the Physiq app.** The
  on-device Movement Assessment (Milestone 6) is unchanged and still uploads
  and persists nothing; there is no upload button, sync, research mode or
  consent change in the app, and no consumer endpoint here.
- Only the squat is implemented. No jump, landing, running, gait, single-leg
  or loaded movement.

### Explicit non-claims

- No comparison against optical motion capture has been completed.
- No force-plate validation has been completed.
- No ground reaction force (GRF) is estimated.
- No joint moments, inverse dynamics or other joint kinetics are estimated.
- No muscle, tendon or tissue forces, stresses or loads are estimated; nothing
  here reads or writes TissueOS Tissue Load (`tissue-load-v0.1`,
  `exercise-tissue-map-v0.1`, `tissue-history-v1`, `load-baseline-v0.1`,
  `recovery-guidance-v0.1`).
- No injury prediction or risk, return-to-play, readiness, capacity,
  diagnosis, form/movement-quality score, safe/unsafe rating or training
  recommendation — not in the API, not in stored records, not internally
  (tests enumerate every schema key and code identifier).
- Angles are **apparent** 2D included angles between landmarks projected into
  one camera image — not 3D joint angles, not hip flexion.
- Normalized skeleton coordinates are dimensionless image-space units — not
  metres, centimetres, 3D coordinates, limb lengths or anthropometrics.
- "Capture quality" describes the measurement, never the movement.
- The pose model is used for inference only. There is no training,
  fine-tuning, classifier or force estimator, and no data becomes training data.

Milestone 8 adds a separate, local force-plate validation layer on top of
this backend (measured-force ground truth and an evaluator for future
estimates; no estimator): [FORCE_PLATE_VALIDATION.md](FORCE_PLATE_VALIDATION.md).
Nothing in this document's M7 pipeline changes; §17–§19 note the additions.

## 2. Architecture

```text
             POST /research/v1/jobs            GET/DELETE …
client ───────────────► API process (FastAPI) ◄────────────── client
                          │ streams the upload into ONE 0600 temp file,
                          │ SHA-256 while streaming, enqueues a job row
                          ▼
                     Postgres  ◄──────────── claim (atomic CAS) / lease / save
                          ▲
                          │
               worker process (one per pose provider)
                 research job service      workers/worker.py
                   pipeline orchestration  pipeline/processor.py
                     video decoder         media/decoder.py  (PyAV / FFmpeg)
                     orientation           media/orientation.py
                     frame sampling        media/sampling.py
                     pose provider         pose/mediapipe_provider.py (interface pose/base.py)
                     pose-frame contract   domain/pose_frame.py
                     M6 protocol replay    domain/protocol.py
                     squat analysis        domain/{calibration,smoothing,segmentation,capture_quality,squat_analysis}.py
                     normalized skeleton   domain/skeleton.py
                     features / traces     domain/time_normalization.py, pipeline/processor.py
                   repository              storage/repository.py (tables.py, migrations/)
```

- The API process never decodes video or runs inference; routes only parse,
  validate, enqueue and read. All FFmpeg parsing of untrusted media happens in
  the worker.
- Replaceable boundaries: `PoseProvider`/`PoseSession` protocol (pose),
  `VideoDecoder` (decode), `ResearchRepository` (persistence). Tests swap the
  pose provider for deterministic doubles; the production worker uses
  MediaPipe.
- Local development can run everything in one machine (see the README);
  Docker Compose runs Postgres, a one-shot migration job, the API and the
  worker as separate containers.

Package layout: `physiq_research/` (`api/`, `domain/`, `media/`, `pose/`,
`pipeline/`, `storage/`, `workers/`, plus `config.py`, `versions.py`,
`canonical.py`, `failures.py`, `records.py`), `migrations/` (Alembic),
`tests/`, `tools/` (M6 parity generator, network monitor, smoke and
measurement scripts), `Dockerfile`, `compose.yaml`.

## 3. Local-only posture

| Control | Behaviour |
|---|---|
| Bind address | `127.0.0.1:8765` by default; the API refuses any non-loopback bind unless `RESEARCH_ALLOW_NON_LOOPBACK_BIND=1` (set only inside the container, whose port is published to `127.0.0.1` only). |
| Host header | must be a loopback name (`127.0.0.1`, `localhost`, `::1`), which blocks DNS-rebinding attacks from a browser. |
| CSRF from browsers | every mutating request must carry `X-Research-Client`; browsers cannot send a custom header cross-origin without a CORS preflight, and this service has **no CORS** (no `Access-Control-Allow-*` header is ever sent). |
| Docs UI | `/docs` and `/redoc` are disabled (they would load assets from a CDN); the schema is at `/research/v1/openapi.json`. |
| Worker network | in Compose the worker is on an `internal` network with no route to the Internet (verified: connects fail with "Network is unreachable", DNS fails). |
| Responses | `Cache-Control: no-store`, `X-Content-Type-Options: nosniff`, no `Server` header. |

These are safeguards against accidents, **not authentication**.

## 4. Privacy

| Question | Answer |
|---|---|
| Raw video retained after processing? | **No.** Deleted after terminal success/failure and cancellation. If an expired lease is re-queued, the upload remains only for the new attempt; its terminal outcome deletes it. Crash leftovers are removed by recovery and sweep (§6). |
| Raw video uploaded externally / to object storage? | **No.** There is no S3/GCS/Azure/Supabase client or configuration; the only copy is one local temp file. |
| Frames stored or sent anywhere? | **No.** Frames exist only in decoder buffers and as a single RGB array handed to the local pose runtime. |
| Landmarks sent externally? | **No.** Inference is local; the pinned runtime was observed making no network calls (§9). |
| Personal data stored? | **No** name, email, phone, address, Physiq account id, login, workout history, filename or free text. The API rejects any such field (`unknown_field`). The only identifier is an optional opaque **version-4 UUID** `research_subject_id`. |
| Derived movement data persisted? | **Yes, intentionally**: landmarks with confidence and timestamps, the normalized skeleton, kinematic traces and summaries (§13). |
| Model training performed? | **No.** |

**Derived pose and kinematic data are retained research artifacts even though
raw video is deleted.** They are sensitive derived biometric/movement data and
are *not* anonymous: a person's movement pattern can be identifying, and the
source SHA-256 lets anyone holding the same video confirm it was processed.
The digest is not anonymization.

Job and result responses make no blanket `raw_video_retained: false` claim:
a queued or processing job necessarily has a temporary upload, and a hard
kill can leave an orphan until the worker's bounded-age sweep. The lifecycle
and limits below describe when that temporary file is removed.

**Consent.** A boolean such as `consent=true` would not constitute research
consent, so the API has none. Real participant data may enter only through an
approved research workflow outside this service (ethics approval, consent
records and the mapping from a person to a `research_subject_id` all live
outside it). The service has no knowledge of consumer identity. There is no
model-training consent because there is no training.

## 5. API (`/research/v1`)

All responses are Pydantic models with a `contract` identity; errors are
`research-error-v1` with a stable `code` and a fixed message (never exception
text, paths or tracebacks). Mutating requests need `X-Research-Client: <any>`.

| Route | Result |
|---|---|
| `POST /research/v1/jobs` (multipart) | `202` `research-job-v1` (queued) or `200` with `deduplicated: true` |
| `GET /research/v1/jobs/{job_id}` | `research-job-v1`: status, attempts, timestamps, stable failure `{code, detail, stage, diagnostics}` |
| `DELETE /research/v1/jobs/{job_id}` | `research-deletion-v1`; cancels queued/processing work, scrubs failed jobs, deletes a succeeded job's assessment |
| `GET /research/v1/assessments/{id}[?include_artifacts=false]` | `research-assessment-result-v1`: versions, provenance, summary, integrity digests, the four artifacts (or their descriptors), and `scientific_scope.non_claims` |
| `DELETE /research/v1/assessments/{id}` | `research-deletion-v1` (`deleted` → `already_deleted` on repeat; `404` if it never existed) |
| `GET /health/live` | liveness, no dependencies (does not load the model) |
| `GET /health/ready` | database reachable, schema at the expected Alembic revision, upload directory usable; `503` otherwise |

There is **no route that returns video, frames or images**.

**Submission parts** (anything else → `422 unknown_field`): `video` (declared
`video/mp4` or `video/quicktime`; content must start with an ISO-BMFF `ftyp`
box), `movement_type=bodyweight_squat_sagittal`,
`capture_mode=single_camera_sagittal`, optional `research_subject_id` (v4
UUID). The filename is ignored and never touches the filesystem. Errors:
`unsupported_media_type` 415, `upload_too_large` 413 (checked from
`Content-Length` and again while streaming), `malformed_multipart` 400,
`missing_file` / `missing_field` / `unknown_movement` /
`unsupported_capture_mode` / `invalid_research_subject_id` /
`duplicate_field` / `field_too_large` 422, `invalid_identifier` 422 (bad
UUID in a path), `queue_full` 503, `invalid_host` 400,
`missing_client_header` 403, `*_not_found` 404, `internal_error` /
`stored_data_integrity_error` 500.

## 6. Jobs, worker and the raw-video lifecycle

```text
queued ──claim──▶ processing ──▶ succeeded | failed
   │                  │  └─ lease expired ─▶ queued (attempt < max) | failed(worker_lost)
   └──── DELETE ──────┴──────▶ deleted (scrubbed tombstone; also from succeeded/failed)
```

- **Durable queue.** Jobs are Postgres rows. A worker claims the oldest
  `queued` job with a compare-and-set (`UPDATE … WHERE id=:id AND
  status='queued'`, candidate selected `FOR UPDATE SKIP LOCKED` on Postgres).
  Two workers can never own one job (tested with concurrent claimers on
  SQLite and Postgres).
- **Lease.** `lease_owner` + `lease_expires_at` (default 120 s), renewed by a
  heartbeat at least every 15 s of processing. Every worker write (heartbeat,
  failure, success) is conditional on still owning the lease.
- **Recovery.** On start and every 60 s a worker (1) re-queues expired
  `processing` jobs while `attempts < max_attempts` (2) and the upload still
  exists, else fails them as `worker_lost`; (2) fails queued jobs older than
  `upload_max_age_s` (1 h) as `upload_expired`; (3) sweeps orphaned upload
  files. An interrupted job therefore never looks permanently healthy.
- **Atomic success.** The job flips to `succeeded` and the assessment plus all
  four artifacts are inserted in ONE transaction; there is no half-successful
  assessment. A concurrent duplicate is linked to the existing assessment.
- **Cancellation.** `DELETE` of a queued/processing job tombstones it and
  deletes its upload at once; the worker notices at its next heartbeat and
  discards its work.
- **Concurrency.** One worker process = one pose provider = one job at a time
  on one thread. Scale by running more worker processes.
- **Not a production queue.** Moving to Redis/SQS would replace claim,
  heartbeat and recovery with the broker's receive/visibility-timeout/
  redelivery; the job row stays the source of truth.

### Raw video exists only

1. in the HTTP request stream;
2. as **one** file created by `mkstemp` (mode `0600`) in an application
   directory (`RESEARCH_UPLOAD_DIR`, mode `0700`, owned by the service user,
   symlinks refused), named `rv-<random>.upload` — never derived from client
   input; the job row stores only that opaque token, re-validated on use;
3. in decoder buffers while the worker decodes it.

It is deleted: by the API on any upload rejection, on a deduplicated
submission and on `DELETE` of a queued/processing job; by the worker in a
`finally` after success, after every classified failure, after an unexpected
exception (including a failed database write), and after cancellation. On
lease loss, cleanup checks the locked job row: it preserves the upload only
if the job has been re-queued or a newer attempt owns it. The terminal
attempt deletes it. Recovery deletes uploads when a crashed job fails; the
sweep deletes an
unreferenced file is older than 10 minutes. The sweep touches only regular
files matching `^rv-[A-Za-z0-9_]{8,64}\.upload$` in that directory, never
symlinks and never anything else. The API holds an advisory lock while an
upload is in flight, so the sweep skips a stalled but still-open upload.

**Limitation:** a killed process or power loss skips `finally`; the file then
remains until the next worker start/maintenance pass (at most `upload_max_age_s`
for queued uploads). Disk use is bounded by `max_pending_uploads` (8) ×
`max_upload_bytes` (100 MiB).

## 7. Media validation and decoding (`video-decoding-v0.1`)

Library: **PyAV 18.1.0** (FFmpeg 8.1.2 bundled in the wheel). Untrusted input:
filename, extension and `Content-Type` are never trusted alone.

| Check | Where | Failure |
|---|---|---|
| ISO-BMFF `ftyp` box first | API (no FFmpeg in the API) | 415 |
| byte size ≤ 100 MiB | API while streaming; worker again | 413 / `file_too_large` |
| SHA-256 matches the upload | worker | `digest_mismatch` |
| only the `mov` demuxer, only the `file` protocol, external data references off | worker | `container_open_failed` |
| exactly one video stream; H.264 or HEVC | worker | `no_video_stream`, `multiple_video_streams`, `unsupported_codec` |
| long side ≤ 3840, short side ≤ 2160 (before decoding, and per frame) | worker | `dimensions_exceeded` |
| square pixels | worker | `non_square_pixels` |
| declared duration ≤ 30 s (+1 s tolerance), per-frame media time ≤ 30 s | worker | `duration_exceeded` |
| indexed and decoded frames ≤ 3600 | worker | `frame_count_exceeded` |
| decodable, not truncated (decoder error, corrupt frame, fewer packets than indexed) | worker | `truncated_or_corrupt` |
| ≥ 1 frame with a timestamp | worker | `no_video_frames` |

The limits are configurable (`RESEARCH_MAX_*`), versioned in each result's
provenance (`media_limits`) and tested. Changing a limit never changes a stored
value; it only changes what is accepted.

**Timestamps.** A frame's time is `t = (pts − pts₀) × time_base` as an **exact
rational**, where `pts₀` is the first decoded frame's pts; `t_ms` is its value
in milliseconds ("media time", from the first decoded frame). Never
`frame_index / nominal_fps`, never wall-clock time. Frames arrive in
presentation order (B-frames are reordered by the decoder). A frame without a
pts, with a pts equal to the previous one, or lower than it is dropped and
counted (`missing_pts`, `duplicate_pts`, `non_monotonic_pts`); more than 10%
dropped → `invalid_timestamps`. Accepted timestamps are strictly increasing.
Variable frame rate needs no special case.

**Orientation.** Phones store portrait video as landscape pixels plus a display
matrix. The first frame's matrix must be one of the four pure rotations
(0/90/180/−90°, FFmpeg's counter-clockwise convention); the pixels are rotated
with `np.rot90` exactly as `ffmpeg -autorotate` displays them (verified against
the ffmpeg CLI). Mirror, scale, shear or projective matrices are rejected
(`unsupported_orientation`) — a mirrored display would silently swap which leg
faces the camera. Later frames must keep the same rotation. The applied
transform is recorded in provenance. Pose always runs on the display-oriented
image.

**Memory.** Frames are decoded lazily and converted to RGB only if sampled; at
most two decoded frames are held. PyAV's per-frame `side_data` container forms
a reference cycle that kept every decoded frame alive (found during
verification: 840 MB for 211 1080p frames); the full matrix is therefore read
only from the first frame and later frames are checked via `frame.rotation`.
A regression test bounds peak memory.

## 8. Frame sampling (`video-sampling-v0.1`)

Grid `g_k = t₀ + k·Δ` with `Δ = 1000/15 ms` (M6's ≈15 Hz analysis cadence),
`t₀` = first frame. For each grid time the **nearest** frame is selected (ties
→ earlier), only if `|t − g_k| ≤ Δ/2`, not already selected for the previous
slot, and with a strictly larger integer provider timestamp `⌊t_ms⌋`.
Exact rational arithmetic. Selected frames keep their **original** timestamps;
the grid only decides which frames are analysed. Sources at ≤ 15 fps keep every
frame. A brute-force statement of the rule is tested against the streaming
implementation on random variable-rate sequences.

## 9. Pose provider and model provenance

| Field | Value |
|---|---|
| Runtime | **`mediapipe` 0.10.31** (PyPI, Apache-2.0), pinned exactly; the worker refuses any other installed version |
| API | `mediapipe.tasks.python.vision.PoseLandmarker` — MediaPipe's C API (`libmediapipe`) via ctypes |
| Settings | `running_mode=VIDEO`, `delegate=CPU`, `num_poses=2` (only to detect a second person), detection/presence/tracking confidence 0.5, no segmentation masks |
| Model | `pose_landmarker_full.task` `float16/1` — the file Milestone 6 vendors in `vendor/mediapipe/` (not duplicated); BlazePose GHUM 3D Full |
| Model SHA-256 | `5134a3aad27a58b93da0088d431f366da362b44e3ccfbe3462b3827a839011b1` (9,398,198 bytes), verified when the provider is created and before every session; the runtime receives the verified bytes, never a path or URL |
| Native library | SHA-256 of the installed `libmediapipe` build recorded in every result (macOS arm64 `da58c7d3…2444`, Linux x86-64 `715145a5…0639`) |
| Model card / licence | see [vendor/mediapipe/NOTICE.md](vendor/mediapipe/NOTICE.md) |

**Why 0.10.31.** The macOS arm64 wheels of 0.10.21, 0.10.30–0.10.33, 0.10.35
and 1.0.1 were inspected (1.0.0 was not downloaded):

- **0.10.35 and 1.0.1** contain a Clearcut usage logger: the native library
  embeds `https://play.googleapis.com/log` with `LogRequest`/`log_source`
  machinery (`portable_clearcut_uploader`, `ion_http_client`), and the Python
  layer passes it the host OS, Python version and a TLS CA bundle
  (`certifi`). Run inside a network-denying sandbox with a libc network
  monitor, 0.10.35 attempted to resolve `play.googleapis.com` and logged
  "Failed to send to clearcut" **once per pose graph — 134 times in 181 s**
  (nothing left the machine). This is the same class of telemetry Milestone 6
  rejected for `@mediapipe/tasks-vision` 1.x.
- **0.10.33** adds host-environment reporting and a TLS stack.
- **0.10.21 and 0.10.30–0.10.32** contain none of these; 0.10.21 (older
  pybind11 API) pulls in jax, jaxlib, opencv-contrib-python, matplotlib and
  `numpy<2`, and 0.10.32 pulls in opencv-contrib-python and matplotlib.
  **0.10.31** is the newest release with neither the logger markers nor those
  extra native dependencies. Under the same sandbox and monitor, 0.10.31 made **zero** lookups
  and zero Internet connections over 131 graphs / 19,650 frames; in a 180 s
  run of the real worker (212 jobs) the only socket activity apart from one
  local `/var/run/syslog` connection was the monitor's own deliberate
  loopback control, and a packet capture of the Docker worker showed only
  Postgres traffic.
- 0.10.31 publishes wheels for macOS arm64 and Linux x86-64 only, so the Docker
  image is `linux/amd64` (emulated on Apple silicon).

**Not the M6 runtime.** Python MediaPipe 0.10.31 (native C++) and the
JavaScript/WASM `@mediapipe/tasks-vision` 0.10.35 used on the device are
**separate implementations** that share the same model file and the same
intended kinematic semantics. Their landmarks are not assumed to be identical,
and results carry their own provider identity.

**Isolation.** One provider per worker (model loaded and verified once); a
**fresh graph per video**, so VIDEO-mode tracking state and timestamps never
carry from one research subject's video to another's; one thread per graph
(MediaPipe does not document a graph as thread-safe).

## 10. Pose-frame contract (`research-pose-frame-v1`)

Python counterpart of M6 `pose-frame-v1`: `t_ms`, `frame_width`,
`frame_height`, `status ∈ {pose, no_pose, multiple_poses, malformed}`,
`pose_count`, `landmarks`, `provider`, `model_id`, plus `source_pts` and
`frame_index`. Same 13 landmarks as M6 (nose; shoulders, hips, knees, ankles,
heels, toes); other face landmarks are never kept; `z` is dropped. Each
landmark: `x`, `y` in **pixels of the display-oriented frame**, `visibility`
∈ [0,1], `in_frame`. Untrusted provider output: non-finite, out-of-range or
wrong-type values become `null` landmarks or a `malformed` frame — never
`(0, 0)`, never NaN. **Two poses → `multiple_poses` with no landmarks: no
person is ever chosen** (not the largest, not the closest). A landmark is
usable when present, in frame and `visibility ≥ 0.5`.

## 11. Normalized skeleton (`normalized-skeleton-v0.1`)

One similarity transform **per assessment** (never per frame), derived from the
calibration frames M6 counts as usable:

```text
origin O  = component-wise median of midpoint(left_hip, right_hip)   (pixels)
scale  s  = median distance nose → analysis-side ankle               (pixels; M6 "standing height")
facing    = sign of median(analysis-side foot_index.x − heel.x);  mirror m = −1 if negative, else +1
x_n = m·(x − O.x)/s        y_n = (O.y − y)/s        (+y up, +x = facing direction)
```

- ≥ 8 reference frames with both hips are required; `s ≥ 1 px`; otherwise the
  job fails `insufficient_calibration / skeleton_*`. Facing needs ≥ 8 frames
  with heel and toe in frame, else `undetermined` (no mirror).
- Fixed origin and scale preserve real movement (the hip descends; it is not
  re-centred away), and a similarity transform preserves included angles, so
  joint-angle differences are never normalized away (tested).
- Mirroring never changes anatomical labels: `analysis_side` is recorded
  unchanged and `mirror_applied` records the reflection.
- Recorded per result: origin, scale, facing, mirror flag, reference-frame
  counts, the version and the parameters.
- Units: dimensionless — fractions of the standing apparent nose-to-ankle
  image height. **Not** metres, centimetres, 3D, limb lengths, physical scale
  or anthropometrics.
- Tested: translation, uniform scale, different resolutions, left/right mirror
  give identical normalized skeletons; angles match pixel angles to 1e-9°.

## 12. Segmentation and its relationship to Milestone 6

The squat calibration, side selection, smoothing, segmentation, capture
quality and trunk–thigh rules are an **independent Python implementation** of
the on-device semantics `squat-kinematics-v0.2` / `movement-assessment-v0.1`
(see [MOVEMENT_ASSESSMENT.md](MOVEMENT_ASSESSMENT.md) §9–§13). No JavaScript is
called at run time. The research record names them as *source semantics* and
names `research-pipeline-v0.1` as the implementation — the two never share a
version identity. Any intentional semantic difference would need a new metric
identity.

**Protocol replay.** A research video records the M6 protocol, so the worker
replays the M6 session's frame handling on **media time**: the latest 2 s of
frames are evaluated until calibration first completes (frames past 45 s of
media time end positioning); capture frames follow until one repetition plus
1 s of standing is seen, a second person appears (capture ends; no result),
10 s of media time pass, or the video ends. Every frame's phase is stored.

**Parity.** `tools/m6_parity/scenarios.mjs` drives the **real M6 session
controller** with a fake camera, clock and provider over 19 scenarios (clean at
100 ms and at 15 Hz, bottom pause, no movement, shallow, partial, two
reps, back-to-back reps, missing frames, tracking gap, 5 Hz and 3 Hz, irregular
timing, noise, right side, second person, frontal, low visibility) and records
the exact provider output plus the session's result and unrounded internals.
`tests/test_m6_parity.py` feeds the byte-identical input to Python and checks
the same calibration window and capture frames (exact), every unrounded value
(max |Δ| 5.7e-14° and 4.6e-13 ms against tolerances of 1e-9° and 1e-6 ms), and
every rounded result field exactly — except documented rounding-boundary ties,
where a one-ulp `atan2` difference between V8 and libm puts a value exactly on
a .x5 boundary (all 20 are the fixture's exact 121.25° trunk–thigh angle).
`test/researchParityFixtures.test.js` (in `npm test`) fails if M6 behaviour
drifts from the fixtures.

## 13. Stored features (`kinematic-features-v0.1`) and artifacts

Units: angles in degrees (apparent 2D included angles), times in milliseconds
of media time since the first decoded frame, durations in media ms.

**Summary** (`research-assessment-summary-v1`): movement, capture mode,
analysis side, facing, mirror flag; calibration (window, frames, span,
knee-angle range, hip-separation ratio, apparent standing height px, side
selection details); segmentation (reference, minimum, excursion, threshold,
events: descent crossing, deepest point, ascent crossing, samples, max gap,
protocol end); kinematics — knee: standing reference, minimum, **apparent 2D
knee ROM**; trunk–thigh: availability, reference, minimum, apparent change;
timing: **descent, ascent, detected repetition** durations; symmetry
`unavailable_for_capture_mode`; capture quality (M6 factors: usable frames,
landmark confidence, single person, body in frame, foot stability,
repetition); frame statistics (decoded, accepted, sampled, pose-status and
phase counts, dropped-timestamp counts, sampling slots).

**Artifacts** (each with `schema_version`, `content_sha256`, `byte_size`):

| Kind | Schema | Content |
|---|---|---|
| `pose_series` | `research-pose-series-v1` | every sampled frame: index, source pts, `t_ms`, provider timestamp, status, pose count, phase, 13 image-space landmarks |
| `normalized_skeleton` | `research-normalized-skeleton-v1` | the transform plus every frame's normalized landmarks |
| `kinematic_traces` | `research-kinematic-traces-v1` | capture-window knee and trunk–thigh traces (raw, smoothed, state) and events, in real media time |
| `time_normalized_traces` | `research-time-normalized-traces-v1` | 101 samples, 0–100% of the detected repetition (`time-normalization-v0.1`: linear interpolation of smoothed values between bracketing valid samples, null across gaps > 300 ms, no extrapolation); the original real-time traces are kept and absolute timing never uses normalized time |

Stored values keep full double precision; M6's 0.1°/1 ms rounding is display
only. A 7 s capture produces ≈ 290 KB of derived JSON (§21 of the
verification report).

**Failed jobs** store only a stable `failure_code` (`invalid_video`,
`decode_failed`, `no_pose`, `multiple_people`, `insufficient_calibration`,
`no_clear_repetition`, `data_gap`, `insufficient_capture_quality`,
`upload_expired`, `worker_lost`, `pipeline_error`), a stable `failure_detail`
(e.g. `not_side_on`, `data_gap_during_repetition`, `truncated_or_corrupt`), the
stage, and small diagnostics (frame counts, status counts, protocol end,
calibration guidance, segmentation reason/excursion, quality state, source
technical metadata) — no landmarks, no traces, no exception text.

## 14. Provenance

Every result answers, from stored data: which source (SHA-256, byte size,
container, codec, dimensions, time base, frame counts), which decoder (PyAV and
FFmpeg library versions, contract and parameters), which orientation transform
(display matrix, rotation, transform), which sampling (contract, parameters,
slot statistics), which pose provider and model (runtime identity and
settings, installed version, native-library SHA-256, platform, model id,
version and SHA-256, verification), which normalization (contract and
transform), which segmentation semantics (M6 source identities, implementation
version, every parameter), which feature and time-normalization versions,
which pipeline version and processing fingerprint, the media limits, and when
(processing start and finish).

## 15. Versions (independent families)

| Family | Identity |
|---|---|
| Research pipeline | `research-pipeline-v0.1` |
| Decoding / sampling | `video-decoding-v0.1` / `video-sampling-v0.1` |
| Pose frame | `research-pose-frame-v1` |
| Normalized skeleton | `normalized-skeleton-v0.1` |
| Features / time normalization | `kinematic-features-v0.1` / `time-normalization-v0.1` |
| API contracts | `research-job-v1`, `research-assessment-result-v1`, `research-deletion-v1`, `research-error-v1` |
| Artifact schemas | `research-pose-series-v1`, `research-normalized-skeleton-v1`, `research-kinematic-traces-v1`, `research-time-normalized-traces-v1`, `research-assessment-summary-v1`, `research-failure-diagnostics-v1` |
| Pose runtime / model | `mediapipe` 0.10.31 / `pose_landmarker_full` `float16/1` `5134a3aa…11b1` |
| Source semantics (recorded, not ours) | `squat-kinematics-v0.2`, `movement-assessment-v0.1`, `pose-frame-v1` |
| Database migration | Alembic `0001_research_initial`; `0002_force_plate_validation` (Milestone 8, additive) — independent of every scientific version |

None is shared with TissueOS (`tissue-load-v0.1` …) or the app's storage
contracts.

**Processing fingerprint** = SHA-256 of the canonical JSON of the processing
contract (all versions, all parameters, runtime identity and model SHA-256).
**Idempotency key** = SHA-256 of `{source SHA-256, fingerprint, movement,
capture mode, research_subject_id}`. Canonical JSON: sorted keys, no
whitespace, shortest round-trip floats, integral floats as integers, NaN and
Infinity rejected; never `repr`. Submitting the same key returns the existing
queued/processing/succeeded job, or a failed job whose failure is
deterministic; `pipeline_error`, `worker_lost` and `upload_expired` may be
retried. The key excludes the platform binary (same declared contract); the
platform is recorded in provenance.

## 16. Immutability and reprocessing

Assessment and artifact rows cannot be updated: a database trigger rejects any
`UPDATE` (Postgres and SQLite). Code upgrades therefore cannot silently change
old values. Reprocessing under a new version produces a new processing key and
a **new** assessment, leaving the old one untouched (tested). Replacing a record
is a documented research operation: delete it, then resubmit. On read, every
artifact's digest, the summary/provenance digests and a record digest over all
of them are recomputed and every artifact is schema-validated; a tampered or
malformed row is refused (`stored_data_integrity_error`), never served.

## 17. Database

Postgres 17 is the target (JSONB); SQLite is used for isolated tests. The
schema is created **only** by Alembic migrations (`migrations/versions/
0001_research_initial.py`, and `0002_force_plate_validation.py` for the
Milestone 8 tables), never at service start. The worker refuses to start
and readiness fails unless the database is at the expected revision (now
`0002_force_plate_validation`; run `alembic upgrade head`).

| Table | Purpose |
|---|---|
| `research_jobs` | one row per submission: status, movement, capture mode, optional subject UUID, source digest and size, opaque upload token, idempotency key, fingerprint, lease fields, attempts, timestamps, stable failure fields and diagnostics, assessment id |
| `research_assessments` | one immutable row per success: identities, versions, provenance, summary, their digests, record digest, processing times |
| `research_assessment_artifacts` | the four immutable artifacts (`ON DELETE CASCADE` from the assessment) |
| `force_plate_trials`, `force_plate_trial_artifacts`, `grf_validation_results`, `force_plate_trial_tombstones` | Milestone 8 (FORCE_PLATE_VALIDATION.md §20–§21); trials reference an assessment `ON DELETE CASCADE` |

## 18. Deletion

`DELETE /research/v1/assessments/{id}` removes the assessment and all its
artifacts and turns every job that referenced it into a **tombstone**: status
`deleted`, `deleted_at`, and the (random) assessment id are kept so repeat
deletes answer `already_deleted`; the subject id, source digest, idempotency
key, fingerprint, movement, failure data and upload token are erased.
`DELETE /research/v1/jobs/{id}` does the same for one job (cancelling queued or
processing work and deleting its upload). Raw video is already gone. Backups
and logs outside this service are out of scope and must follow the research
data-management plan.

Retention: derived data is kept until research deletion; the service has no
automatic expiry of successful assessments.

Milestone 8: deleting an assessment also removes every force-plate trial
derived from it, with its artifacts and validation results (foreign key
`ON DELETE CASCADE`; a trigger records trial tombstones). The API response
above is unchanged and counts M7 artifacts only. Deleting an M8 trial never
touches the assessment (FORCE_PLATE_VALIDATION.md §20).

## 19. Milestone 8 boundary

Milestone 7 itself contains no force plates, GRF, kinetics, OpenSim, PyTorch
or other force/tissue model, training or validation numbers, and still
estimates no GRF. Milestone 8 is a separate package
(`physiq_research/force_plate/`, command line only) that stores MEASURED
force-plate ground truth linked to an immutable M7 assessment and evaluates
separately supplied estimates; it contains no estimator and no validation
result — see [FORCE_PLATE_VALIDATION.md](FORCE_PLATE_VALIDATION.md). The M7
boundary test (`tests/test_boundaries.py`) still covers every M7 module; the
M8 package has its own (`tests/test_force_plate_boundaries.py`).
`tools/` contains no fabricated evaluation metrics; future joint-angle
MAE/RMSE, repeatability or camera-angle sensitivity analyses require ground
truth that does not exist here.

## 20. Dependencies

Exact pins: [`research_backend/requirements.lock.txt`](research_backend/requirements.lock.txt)
(runtime) and `requirements-dev.lock.txt` (tests/lint). `pip-audit`: no known
vulnerabilities (2026-09-25).

| Package | Why | Licence (package metadata) |
|---|---|---|
| fastapi 0.141.1, starlette 1.7.0, uvicorn 0.54.0 | HTTP API and ASGI server | MIT, BSD-3-Clause, BSD-3-Clause |
| pydantic 2.13.5 | API schemas and stored-artifact validation | MIT |
| python-multipart 0.0.32 | streaming multipart parser | Apache-2.0 |
| SQLAlchemy 2.1.1, alembic 1.20.0 | database access and migrations | MIT |
| psycopg[binary] 3.3.6 | Postgres driver | LGPL-3.0-only |
| av 18.1.0 (PyAV) | FFmpeg demux/decode with real timestamps | BSD-3-Clause (PyAV); see below |
| numpy 2.5.3 | frame arrays | BSD-3-Clause and others |
| mediapipe 0.10.31 (+ absl-py, flatbuffers, sounddevice, cffi) | local pose runtime | Apache-2.0 (+ Apache-2.0, Apache, MIT, MIT-0) |

**PyAV / FFmpeg licensing.** The PyAV binary wheel bundles FFmpeg 8.1.2
configured with `--enable-version3`, together with shared libraries including
libx264 and libx265 (distributed by their projects under the GNU GPL v2 or
later) and GnuTLS. This service only demuxes and decodes H.264/HEVC with
FFmpeg's own decoders and never encodes, but the wheel and any Docker image
containing it include those GPL components. Running it locally for research is
not a redistribution; **publishing the image or bundling the wheel must be
reviewed for GPL/LGPL-3.0 obligations** (or PyAV rebuilt against an LGPL-only
FFmpeg). psycopg is LGPL-3.0; it is used unmodified as a library.
