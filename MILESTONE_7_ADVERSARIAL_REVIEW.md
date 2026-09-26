# Milestone 7 independent adversarial review

Review date: 2026-09-25 (America/Phoenix). Scope: PR #31, `claude/milestone-7-research-backend`. I began from clean commit `1dbb52c885a9e580bcbe9a936bc60b3e9b03cf40`, with `512e61f69511e52c63e0a86b7e3c393bf349853f` as the pre-M7 base. This report records independent source inspection and observed behavior; the original verification document is implementation-time evidence, not this review's authority. No merge or M8 work was done.

## 1. Reviewed repository state

The fetched PR branch matched the expected head. The M7 diff adds 115 files and about 13,407 lines. Before edits, `npm ci`, 656 JS tests and the production build passed. A fresh Python 3.12 environment was installed from `requirements-dev.lock.txt`. The hermetic run had 272 passes, 47 opt-in skips and one sandbox-denied localhost socket; the same test passed with socket permission. The original full macOS Postgres run had 313 passes and 7 real-pose skips. Final counts appear below.

## 2. Architecture assessment

The new FastAPI process streams and hashes one bounded upload, Postgres queues jobs, and a separate worker decodes and performs local pose inference. Alembic creates the schema. The consumer JS tree has no M7 networking integration. This is a coherent local Stage-3 research boundary, subject to the limitations in §21.

## 3. Confirmed findings and resolutions

| Severity | File / function | Reproduction and impact | Why earlier coverage missed it | Resolution and new coverage |
|---|---|---|---|---|
| HIGH | `workers/worker.py::process_job`, `storage/repository.py::release_upload` | Pause the original attempt at feature extraction, expire its lease, requeue and claim with a new owner, then resume it. Original worker's `finally` deleted the new owner's upload; the replacement job was left processing a missing file. | One test changed `lease_owner` without a real reclaim; another simulated a dead worker with no old finalizer. | Lock the job row while releasing an upload; retain it for a queued or later attempt and delete it on terminal completion. A new regression runs the exact interleaving on SQLite and Postgres, then has the successor finish. |
| HIGH | `storage/repository.py::delete_job` | Let a queued job succeed after `delete_job`'s initial read but before its tombstone transaction. The old code reported deletion yet left the assessment and four artifacts readable. | Sequential delete and cancellation tests never put success between the read and write. | Read the job under lock inside the deletion transaction, and delete a result that committed first. Deletion requests serialize on Postgres. A new regression forces this interleaving on SQLite and Postgres. |
| MEDIUM | `media/tempfiles.py::sweep_stale` | Hold a live upload descriptor open, age its mtime beyond 600 s, and sweep. The old code unlinked the still-in-flight upload, so resumed intake would enqueue a missing file. | Sweeper tests covered queued references and old orphans, not an open stalled upload. | Hold an advisory lock throughout intake. Sweep skips locked files, and a new test verifies deletion only after descriptor close. |
| MEDIUM | `api/schemas.py::ResearchJobResponseV1` | With the worker stopped, POST a synthetic MP4. A queued job returned `raw_video_retained: false` while its 249,272-byte temp file existed. | An API test asserted this false value for queued jobs. | Removed the blanket field from job/result/delete responses. Tests now check the queued file's actual presence, and the privacy documentation describes temporary and crash states. |
| MEDIUM, pre-existing tooling | Root `package-lock.json` | A fresh `npm audit --omit=dev` reported one critical and two high package findings: `tar`, `brace-expansion`, and `@xmldom/xmldom` via unchanged `@capacitor/cli`. | The earlier M7 report's vulnerability statement was time-specific; the lockfile was not modified by M7. | Recorded as a separate dependency-update follow-up; this PR does not change the consumer toolchain. Advisory examples: [tar](https://github.com/advisories/GHSA-r292-9mhp-454m), [brace-expansion](https://github.com/advisories/GHSA-rgw5-rvv9-x895), [xmldom](https://github.com/advisories/GHSA-93r5-fhx6-vmg9). |

## 4. Raw-video lifecycle verdict

Upload uses a server-generated `mkstemp` token, mode `0600`, inside an owned `0700` directory; the submitted filename never becomes a path. The streamed byte bound, digest check, stage fault injection, cancellation and terminal cleanup were exercised. A real `SIGKILL` during inference left a processing row and raw file; a restarted worker recovered the expired lease, completed on the second attempt, and deleted the file. The stale sweeper now excludes active locked uploads and unrelated files. An unavailable database during final cleanup still favors deletion of raw media over retry availability.

## 5. Decoder and timestamp verdict

`VideoDecoder` uses the `mov` demuxer, H.264/HEVC allowlist, dimensions/frame/duration bounds, exact `(PTS - first PTS) × stream time_base`, and reports missing, duplicate and backward timestamps. Sampling uses rational 15 Hz grid comparisons and retains source timestamps. Existing VFR, B-frame, time-base, rotation, truncation and resource-bound tests passed. The decoded stream is lazy; RGB conversion occurs only for selected frames. No nominal-FPS timing path was found.

## 6. FFmpeg and network verdict

Decoder open options include `protocol_whitelist=file`, `enable_drefs=0`, and `use_absolute_path=0`; a controlled TCP listener saw no connection for prohibited HTTP/TCP inputs, while the no-whitelist control did connect. In the actual worker container, Postgres TCP connected (`connect_ex=0`), but external IPv4 and IPv6 attempts returned `ENETUNREACH` (`101`). The worker is attached only to Compose's internal network. These checks cover the tested FFmpeg and Docker paths, not every conceivable native protocol implementation.

## 7. Pose runtime and telemetry verdict

The worker requires MediaPipe `0.10.31`, verifies the vendored model SHA-256, uses a new VIDEO graph for each video, requests at most two persons to detect ambiguity, and keeps the model bytes in process. Six real-provider integration tests passed, including one person, no person, two people and rotated media. The native `libmediapipe` binary had TFLite profiler strings but no searched Clearcut or `play.googleapis.com/log` marker. A 180-second macOS libc interposer run completed 204 real jobs; it logged only one intentional loopback positive-control connection, no DNS lookup or sendto call, and sampled 90 times with `lsof`. The monitor cannot establish absence of traffic through all Apple frameworks, direct syscalls, or unobserved child processes. No rejected-version runtime positive control was run.

## 8. M6 semantic parity verdict

The fixture generator calls the real M6 session and algorithms; Python consumes the recorded raw scenario frames and compares protocol phases, unrounded angles/times and rounded outputs under explicit one-ULP tie rules. The 19 committed scenarios cover clean, paused, shallow, partial, multiple-person, low-visibility, missing-frame, irregular and low-rate cases. I temporarily changed M6's calibration window from 2000 to 1500 ms: the JS fixture guard failed across representative scenarios, and the source was restored. Fresh final JS tests passed.

## 9. Normalized skeleton verdict

The transform is one fixed similarity transform per assessment: standing median hip-centre origin, standing nose-to-ankle scale, y-up axes and recorded mirror flag. It preserves anatomical side labels and projected joint angles; missing landmarks stay missing. Tests cover translation, uniform scale, mirror and joint-motion preservation. These coordinates remain dimensionless image-space estimates, not physical lengths.

## 10. Postgres and storage verdict

Alembic migrated empty real Postgres databases in the integration suite. No implicit `create_all()` path was found. The schema has job, assessment and artifact tables, keys, indexes, checks and update-rejecting triggers. Real Postgres was used for claiming, lease recovery, transactions, deletion and integrity tests. SQLite is only the fast hermetic path; Postgres concurrency and JSONB behavior are separately exercised.

## 11. Queue, lease and concurrency verdict

Postgres claims select with `FOR UPDATE SKIP LOCKED` and conditionally update queued rows. Success and failure are owner-conditional. The high-severity reclaim/unlink race is fixed and tested against both databases. Multiple claimers do not share a job; retries retain the source only while an active later attempt needs it. A database outage can still sacrifice retry availability to delete raw media, and this is a local prototype queue rather than a distributed broker.

## 12. Immutability and checksum verdict

Stored artifacts, summary and provenance use canonical JSON SHA-256 digests; record digests include version and source identities. Raw SQL UPDATE attempts against both a live synthetic assessment and artifact were rejected by Postgres triggers. After deliberately disabling a trigger as the database owner and tampering with one artifact, API retrieval returned `500 stored_data_integrity_error`, including with artifacts omitted from the response; the test record was then deleted. Database owners/superusers can bypass triggers and rewrite unkeyed digests; this is application/database-role integrity, not cryptographic tamper proof.

## 13. Deletion verdict

Queued and processing deletion tombstones the job and removes its upload. Succeeded deletion removes assessment and artifacts; repeat deletion is idempotent. The success-between-read-and-tombstone race is fixed. In the separate-process run, assessment DELETE removed four artifacts and the next GET returned 404. A research subject can submit the same source again after explicit deletion; this is a new result, not resurrection by the cancelled worker.

## 14. API and host-security posture

A direct Python launch listened only on `127.0.0.1` (verified with `lsof`); Compose publishes API and Postgres to host loopback. Live probes returned 400 for an invalid Host, ignored spoofed forwarding headers, returned 403 without the mutating-client header, and offered no CORS permission to an external preflight. A traversal-like multipart filename did not affect storage. An `email` field returned 422 and left the upload volume empty. `X-Research-Client` is a browser friction guard, not authentication; the service must not be exposed publicly.

## 15. Derived-data privacy verdict

No raw frames or video are stored in assessment artifacts. Landmarks, normalized skeletons, trajectories and traces are intentionally persisted sensitive data. The optional subject identifier is a UUIDv4, and the SHA-256 source digest can support matching; neither makes the record anonymous. Production logs use job IDs and digest prefixes, not full landmarks or video bytes. The misleading response boolean was removed.

## 16. Scientific boundary verdict

Source, schemas and storage were searched for GRF, force, moment, tissue stress, injury risk, readiness, capacity, diagnosis and scoring outputs. The implemented result consists of pose landmarks, normalized 2D skeleton, apparent angles/ROM, timing and measurement quality. Scientific non-claims are explicit in the API. No M8 kinetics or training pipeline was found.

## 17. Performance and memory verdict

For an 8 s 1080×1920 real-provider fixture, 241 frames decoded, 121 were sampled; the elevated run took 2.774 s for the job, including 2.480 s pose inference (20.5 ms per sampled frame), and peak RSS was 281.2 MiB. A separate 7 s 1080p deterministic success stored about 289,271 bytes of derived JSON. Across the 180-second monitor, max RSS was 302.8 MiB. Independent reference-cycle stress runs with GC disabled at 60/120/240 decoded frames measured 225/406/768 MiB for the old per-frame `side_data` path versus about 50 MiB for `frame.rotation`; temporarily restoring per-frame side-data access made the normal memory regression test fail at 785.7 MiB. The mutation was reverted.

## 18. Dependencies and container verdict

Runtime and dev dependencies are exact-version pinned, but lock files do not contain wheel hashes. The model is hash-checked at build and runtime. The image is pinned `linux/amd64`; Apple Silicon uses emulation. The built image contains PyAV 18.1.0 / FFmpeg 8.1.2 and FFmpeg configuration with `--enable-libx264` and `--enable-libx265`; redistribution licensing needs a separate review. `pip check` reports MediaPipe `0.10.31` unsupported on both macOS and Linux because its installed WHEEL metadata claims a `cp39-cp39` tag, although the pinned install, imports and real integration tests work on Python 3.12. Current npm audit findings in unchanged consumer CLI tooling are in §3. No Python advisory scanner was installed.

## 19. Frontend regression verdict

After fixes, 656 JS tests and the production build passed. Headless Chrome acceptance passed: M3 Tissue Load 20 checks, M4/M5 history and recovery 35 checks, M6 Movement Assessment 28 checks, and the real M6 browser pose smoke 6 checks. The M6 camera flow's request trace showed no POST, upload or `/research/` request; the real-runtime smoke loaded only app assets and the expected font request. The M6 browser suite also checked no assessment persistence.

## 20. Review fixes pushed

The review commit on `claude/milestone-7-research-backend` contains the lease/retry, deletion and stale-upload fixes, regression tests, correction of the API privacy response, and this report. It was pushed to PR #31's branch without rewriting the original M7 commit. PR #31 was not merged.

## 21. Remaining limitations

No approved real-person sagittal squat completed the entire real-provider success path. The real provider was integrated and its failure cases exercised; the full successful human assessment remains unverified. No ground-truth kinematic validation, force-plate validation, consent workflow, production authentication or public-deployment security is claimed. Network monitoring has the scope in §7. The dependency and licensing follow-ups in §18 remain release/process work; the npm advisories predate M7.

## 22. Final status

```text
M7 architecture sound: yes
Raw-video lifecycle sound: yes
Decoder/timestamp handling sound: yes
FFmpeg local-file isolation sound: yes
Pose runtime telemetry-free in tested scope: yes
M6 semantic parity sound: yes
Normalized skeleton contract sound: yes
Postgres persistence sound: yes
Job claiming/lease semantics sound: yes
Stored scientific outputs reproducible/immutable: yes
Deletion semantics sound: yes
Derived-data privacy boundary sound: yes
Consumer M6 remains disconnected: yes
Stage-3 scientific boundary preserved: yes
Real successful human squat validated: no
M0–M6 regressions clear: yes
Blocking defects remaining: no
Review fixes pushed to PR #31: yes
Ready to merge Milestone 7: yes
Ready to begin Milestone 8: no
```

Final verification: macOS Python `324 passed, 1 deselected` (the separate 180 s netmon test passed); rebuilt Linux container `322 passed, 3 environment skips`; `ruff check`, `ruff format --check`, and `mypy` passed. The three Linux skips are two consumer-source checks because that image contains only the research backend and the macOS-only libc interposer. `git diff --check` passed.
