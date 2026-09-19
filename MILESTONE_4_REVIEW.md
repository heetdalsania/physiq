# Milestone 4 independent adversarial review

Review date: 2026-09-19. The verdicts below apply to the hardening branch, not to the original merge without its fixes. Milestone 5 was not started.

## 1. Repository state

- Repository verified: `heetdalsania/physiq`.
- Reviewed main: `eb56bfe0404ea1287630abb1c2bcbb2a11623c3a`, the expected PR #25 merge. No additional commits were present on main at review start.
- Implementation: `f7e2636525c490f258220701abc57f0443770753`; comparison base: `917e118bdc568fbcc21cc6b4d3307c4f30a7ffdd`.
- Fetched origin, switched to main, and fast-forwarded. No reset or user changes discarded. Initial and post-baseline-build working trees were clean.
- Independent baseline: **445 passed, 0 failed, 0 skipped**, successful production build, no generated-file difference.
- All ten requested M4 implementation, documentation and test files exist. Production diffs were read before the implementation verification report; that report was not used as proof.
- Hardening code commit: `844c62159ba98e6658a5061db3457ac59d067082`.

## 2. Independent architecture assessment

M4 adds a materialized projection of `workoutLog`, with one snapshot per datable session. It freezes body mass and its provenance, local day/offset, model/map/unit, workload totals, mapping counts, source identity/fingerprint and materialization time. A separate pure analytics layer groups these snapshots by day and computes rolling exposure and a preceding-period reference. The scientific model does not import or know about either layer.

The application reconciles at its workout persistence effect. Opening Tissue Load reads React state; it does not persist. The M3 map still derives its contributor detail from source workouts, but resolves each session's body mass from the current-series snapshot. This is a reasonable separation of source data, historical model context, analytics and presentation. The original implementation had concrete safety and semantic defects in its boundaries, rather than a need for architectural replacement.

Every changed M4 production file was classified:

| File | Actual purpose/change |
|---|---|
| `js/App.js` | Reconciliation after source persistence; active-profile history state; consolidated profile loading; onboarding and corrupt-profile fixes. |
| `js/components/TissueLoadTracker.js` | Longitudinal detail, sufficiency/coverage/storage copy, memoized history, frozen-mass contributor resolver. |
| `js/components/WeightCharts.js` | Date-key labels and chart comparisons switched to local date parsing. |
| `js/screens/ExerciseTab.js` | Pass active history to Tissue Load. |
| `js/screens/ProfileTab.js` | Correct date-only weight label parsing. |
| `js/utils/appTime.js` | Shared local calendar-key parser. |
| `js/utils/storage.js` | Register optional history key and return source-write success from `sv`. |
| `js/utils/tissueHistorySnapshot.js` | Identity, fingerprint, weight resolution, snapshot creation and validation. |
| `js/utils/tissueHistoryStore.js` | Read/classify/reconcile/persist snapshots without changing workout source. |
| `js/utils/tissueLoadHistory.js` | Series isolation, calendar aggregation and baseline arithmetic. |
| `js/utils/tissueLoadView.js` | Optional per-session frozen body-mass resolver; M3 display mathematics otherwise retained. |
| `js/utils/weeklyReport.js` | Replace equivalent private local parser with shared parser. |
| `css/styles.css` | Neutral longitudinal detail layout. |
| `dist/app.min.js`, `dist/styles.min.css` | Generated shipped artifacts, corresponding to source changes. |

README/contracts and the tissue README were documentation changes. The five model JavaScript files did not change. No cloud, telemetry, model coefficients, v0.2 implementation, RIR/tempo/ROM multipliers, training advice, thresholds, capacity or recovery inference was introduced.

## 3. Findings

The first ten findings were recorded before production edits. The dictionary-key case was independently reproduced during the follow-up malformed-data review before fixing it. Each entry below includes reproduction, expected versus actual behavior, impact and test gap.

| Severity | Exact file/function | Reproduction and original behavior | Resolution and existing-test gap |
|---|---|---|---|
| **BLOCKER** | `tissueHistoryStore.js: reconcileTissueHistory` → `storage.js: set/pruneOldestEntry` | Seed B's nutrition `history` with three records; throw `QuotaExceededError` only for A's `tissueHistory` write. A reports `write_failed`, but B loses its oldest record. Optional derived persistence must not destroy another profile's source data. | Derived writes use `pruneOnQuota: false`. Unit and real-browser failure injection prove source, prior derived bytes and B's history survive. Old quota test had no nutrition data available to prune. |
| **HIGH** | `tissueHistoryStore.js: planReconciliation`; `tissueHistorySnapshot.js: indexSourceKeys` | Two different workouts share ID and finishedAt. Freeze at 180 lb, change profile to 120 lb, reverse source array. Both snapshots rebuild at 120 lb despite no workout edits. Expected only identity reindexing, with frozen inputs retained. | Reserve unchanged fingerprint matches within duplicate identity groups before rebuilding edits; update only ordinal sourceKey when necessary. Test covers reorder, insertion and removal. Old duplicate test used identical sessions. |
| **HIGH** | `tissueHistoryStore.js: readTissueHistory/sourceIsReadable` | Make getItem throw while setItem succeeds. History is classified absent, or source as readable, allowing destructive reconciliation. Parseable non-array source is also accepted. Expected fail-closed behavior. | Read exceptions, invalid source shape and missing/non-array envelope entries block persistence. Existing tests covered malformed JSON and write failures, not thrown reads or wrong-shaped JSON. |
| **MEDIUM** | `tissueHistorySnapshot.js: isDateKey/resolveHistoricalBodyMass`; `appTime.js: parseDayKey` | A measurement dated Feb 30 is accepted for Mar 1 and marked measured/non-approximate with `daysBefore: -1`. Partial numeric date segments and calendar rollover are also accepted by the shared parser. | Validate actual calendar dates; reject impossible dates and malformed segments. Leap day and boundary tests pass in six zones. Existing invalid-date cases lacked impossible calendar dates. |
| **MEDIUM** | `tissueHistorySnapshot.js: isValidHistoryEntry` | `completedSets=1, modeledSets=9` produces `unmappedSets=-8`; negative workload and missing frozen context pass structural validation. Expected coherent counts and usable frozen inputs. | Reject negative/nonfinite workloads, invalid context and negative/fractional/inconsistent counts. Preserve invalid stored objects for recovery, but exclude them from analytics. Existing malformed tests mostly removed fields. |
| **MEDIUM** | `tissueLoadHistory.js: sum/compareToBaseline` | Recent `1e308`, baseline total `4`: original comparison reports `available` with Infinity delta/ratio/percent. Expected finite arithmetic or explicit unavailability. | Avoid overflow in rounding, propagate unavailable totals, and expose `numeric_unavailable` for unrepresentable comparisons. UI never substitutes an invented zero. Existing extreme test used only four million. |
| **MEDIUM** | `tissueLoadHistory.js: summarizeWindow`; `TissueLoadTracker.js: TissueLongitudinalDetail` | Jan 1 workout, no logs until Apr 1: absent months are labeled observed days/real zeros. The app has no evidence of training or app adherence. | Keep the logged-workload arithmetic and elapsed-span eligibility, explicitly disclose missing-log assumptions, and say “days since first log.” Old tests blessed the observed-day wording. |
| **MEDIUM** | `tissueLoadHistory.js: buildTissueLoadHistory` | Future-only history establishes a future firstObservedDate and displays unexplained zero current exposure. Expected future records not to establish present coverage. | Preserve snapshots; exclude future dates from today's aggregation/coverage; show a future-history note even in empty state. Old tests excluded tomorrow from sums but did not test future-only coverage/UI. |
| **MEDIUM** | `tissueHistoryStore.js: planReconciliation` | Delete the only source of a synthetic v0.2 entry. It remains in active history indefinitely, contradicting source-authority language. Future data also must not be destroyed. | Move known-v1 foreign entries with gone/changed sources verbatim into optional `detachedEntries`; export them; reactivate on exact source restoration. Active analytics excludes them. Old test explicitly required stale active retention. |
| **MEDIUM** | `App.js: loadProfileScopedState` | Existing `recentFoods` is replaced with an empty in-memory list; next logged meal overwrites saved recent foods. Expected the active profile's list to load. | Read that profile's list with its own fallback. Browser asserts saved A food survives reload/login/new meal and B food does not leak. Original bundled reset/loading coverage omitted this persisted state. |
| **MEDIUM** | `tissueLoadHistory.js: aggregateDaily/selectSeries` | A valid-looking synthetic tissue property `constructor` crashes `.push`; source key `__proto__` bypasses ordinary-object duplicate bookkeeping. Expected unknown keys not to crash analytics or defeat deduplication. | Internal dictionaries use null prototypes; independent regression passes with frozen inputs. No existing adversarial key test covered this. |
| **LOW** | `TISSUE_LOAD_HISTORY.md: time contract` | Original wording implied a backfilled day was the original training day even when the athlete had changed timezone before first materialization. | Clarify that legacy timezone is unknown and the device's materialization-time zone supplies the historical day/offset. No reconstructed location claim. |

Rejected or deliberately retained behaviors:

- **NOT A DEFECT: historical weight edits do not automatically invalidate snapshots.** The committed contract resolves once at materialization and freezes model inputs; a weight-log edit is not a workout-source edit. Regression now pins this explicitly. The correction limitation is documented.
- **NOT A DEFECT: successful export includes the sidecar.** `exportAll` copies every `pq_*` raw value, so frozen inputs survive a normal roundtrip rather than being reconstructed from today's profile.
- **NOT A DEFECT: absent post-first-log days can contribute zero logged workload.** This is acceptable only as a clearly disclosed logging convention; it is not evidence of no training.
- **NOT A DEFECT: the pure planner reuses unchanged object references.** It does not mutate them, deep-frozen inputs work, and the storage boundary serializes/detaches them. It is not a defensive-cloning API; callers must treat returned snapshots as read-only.
- **NOT A DEFECT: conservative raw workout fingerprints.** Raw reps/weight edits, including numeric-string changes and edits to incomplete sets, may rebuild even where current model totals are unchanged. This is a disclosed source-edit boundary, unlike changing only RIR/side/tempo/ROM, title or unrelated fields. No fingerprint-algorithm migration was introduced.

## 4. Historical reproducibility verdict

| Question | Answer |
|---|---|
| Does current profile weight change old materialized history? | **No.** Same-source snapshots are retained, including after reload. Browser weight change and contributor checks prove this. |
| Can historical weight edits create stale derived data? | They leave the original resolved inputs unchanged **deliberately**. The snapshot is an auditable frozen estimate, not the latest estimate from the amended weight log. No automatic correction workflow exists. |
| Can timezone changes alter frozen days? | **No for retained snapshots.** Independent roundtrip test changes runtime zone; stored days, offsets and values remain unchanged. Fresh legacy backfill or source-triggered rebuild resolves context in the current device zone. |
| Can export/import alter historical values? | **A successful full export/import preserves snapshots**, including approximate profile-weight fallback, even with different current weight/zone. Missing/failed-to-import sidecars cannot guarantee identical reconstruction. |
| Can source edits be reconciled? | **Yes.** Name, reps, weight, strict done transitions and finishedAt edits invalidate as defined. Metadata-only changes retain bytes. Rebuild resolves context anew; finishedAt changes identity. |
| Can source deletion leave stale entries? | Current-series entries are removed. Known-v1 foreign entries are detached, preserved for recovery and excluded from active analytics. Opaque future-schema objects cannot safely have source semantics inferred. |

Same-day measurements are eligible; future measurements are not. Unsorted logs are sorted and same-day ties select the last valid record. Numeric strings, zero, negative, NaN/Infinity and impossible dates are ignored for body mass. Invalid or absent weight logs fall through to valid numeric profile weight, then model default. Bare values are pounds; accidental kg cannot be inferred without unit metadata. Older fallback profile weights remain approximate. Measured data is marked as such; it is not evidence of exact body mass at workout time.

`materializedAt` is informational, excluded from fingerprints and no-op invalidation. Advancing now alone does not change entries. Workout ordering is stable for normal identities, and the fixed duplicate-group matching preserves context for distinguishable duplicate workouts. Truly identical duplicate records with different provenance remain inherently ambiguous without a persistent source UUID.

## 5. Baseline-math verdict

The ordinary calendar mathematics was correct at the original merge. The hardening fixes numeric safety and invalid inputs without changing the model or normal window definitions.

For **D = Mar 31, 2026**, independent literal-date test inputs are:

| Date | Workload | Membership |
|---|---:|---|
| Feb 24 | 10,000 | Outside all three windows; establishes earlier logging span |
| Feb 25 | 40 | Baseline start, D-34 |
| Mar 3 | 80 | Baseline; outside 28-day exposure |
| Mar 4 | 120 | Baseline and 28-day start, D-27 |
| Mar 24 | 160 | Baseline end, D-7; outside recent seven |
| Mar 25 | 30 | Recent start, D-6 |
| Mar 31, two sessions | 20 + 10 | Today and recent windows |
| Apr 1 | 9,999 | Future; excluded |

Therefore:

- Recent seven `[D-6 … D]`: **30 + 20 + 10 = 60**.
- Recent 28 `[D-27 … D]`: **120 + 160 + 30 + 20 + 10 = 340**.
- Baseline period `[D-34 … D-7]`: **40 + 80 + 120 + 160 = 400**, exactly 28 keys and no overlap with recent seven.
- Baseline: **400 / 4 = 100**, units per seven days, comparable with the recent seven-day sum.
- Delta **60 − 100 = −40**, ratio **0.6**, percent **−40%**.
- Reversing input order produces identical output. Multiple same-day sessions add normally.

Calendar keys use UTC calendar arithmetic, not elapsed local milliseconds. Sparse logs do not change denominators. Baseline eligibility requires the first nonfuture valid entry to be on or before D-34. Zero baseline produces no ratio/percentage, including both-zero; zero recent against positive baseline gives −100%. Large increases are not clamped. Normal arithmetic rounds to six decimals; a tiny positive baseline that rounds to zero uses the zero-baseline state. Unrepresentable sums/comparisons are unavailable, not Infinity/NaN or zero. Negative/invalid snapshots never enter the sums.

## 6. Observation-model verdict

The app **does not know** whether missing dates represent rest, unlogged training, an uninstall or abandonment. The original observed-day wording overstated its evidence.

The hardening retains the simple logged-exposure contract: days after the first recorded workout with no entries contribute zero logged workload. `firstObservedDate`, `observedDays` and `complete` remain compatibility field names describing elapsed logging span, not monitoring completeness. The UI explicitly says so. A Jan 1 workout followed by an Apr 1 return can yield an eligible zero logged baseline; it is not described as three months of observed rest. No adherence model or arbitrary suppression threshold was invented.

Cross-period coverage remains visible independently: recent modeled/completed sets and baseline modeled/completed sets are printed, with the warning that comparisons cover modeled exercises only. Independent rendering tests exercise 100% versus 10% coverage in both directions without rescaling or suppressing the percentage.

## 7. Versioning verdict

| Layer | Version/behavior |
|---|---|
| Physiq storage | Integer `1`, unchanged; new optional key rather than a migration of existing source bytes. |
| History envelope/entry | `tissue-history-v1`; optional `detachedEntries` preserves foreign recovery records. |
| Workload model | `tissue-load-v0.1`, unchanged. |
| Exercise map | `exercise-tissue-map-v0.1`, unchanged. |
| Analytics | `load-baseline-v0.1`; ordinary windows/divisor unchanged, validation/overflow handling hardened. |
| Fingerprint | `fp1`, unchanged, no hidden whole-history migration. |

Model, map and workload unit all participate in series selection. Synthetic other-model/map/unit records never enter current totals or baselines. Unsupported envelope schemas are not rewritten. Unknown envelope and unchanged entry fields survive. Unknown entry schemas are preserved opaquely and excluded. Missing schema is treated as unsupported; malformed envelopes remain untouched.

Foreign v1 entries are only active while their exact source key/fingerprint exists. Deleted/changed sources retain their objects in `detachedEntries`; restoration can reactivate them. No production v0.2 data is generated. An older M4 build ignores the optional detached field and preserves it as an unknown field, rather than summing it.

## 8. Persistence/failure verdict

- JSON serialization failure and setItem exceptions do not report success or advance a separate migration marker. One envelope write is the materialization boundary.
- A failed derived quota write no longer invokes the storage layer's global nutrition-history pruner. Source workouts, previous derived bytes and other profiles survive.
- Malformed history, malformed sidecars, unknown schemas and read exceptions are protected. Parseable but non-array source is not treated as an empty authoritative log by the reconciler.
- Source write failure/Dev Mode gates derived persistence. Malformed protected source can make legacy `set` report a suppressed passive write as successful; the separate source-readability check still prevents derived deletion.
- No-op reconciliation compares serialized bytes and performs no derived write. Existing entries retain nested context, warnings and workload values; pure analytics accepts deep-frozen inputs.
- The App effect runs on boot restore, login, onboarding completion and source workout updates. Reload/import triggers reloading and reconciliation. Profile switch resets derived state before its target loads. Weight-only changes do not trigger backfill. Opening the Tissue Load view, changing tissue selection and unrelated renders do not write.
- `setTissueHistory` is not an effect dependency, so the state update does not loop. The profile/source setters are synchronous and batched at login; storage work is synchronous with no pending asynchronous writer that can land under a later profile.

These are M4 guarantees, not a claim that the entire inherited storage API is transactional. See remaining limitations for pre-existing multi-key import and general quota behavior.

## 9. Bundled pre-existing fixes verdict

**A. Onboarding carry-over: passes, with one additional loader fix.** Existing A → logout → brand-new C onboarding produces empty workouts, routines, weekly sets, targets, meals, nutrition history and TissueOS history; no recent foods or plan drafts carry over. A's profile, workouts, routines, nutrition, targets, recent foods, plans and derived history remain unchanged. Returning between A/B isolates histories and mass. `PlanDayScreen` owns its drafts and remounts when leaving/re-entering the app; it reads its own profile key. The missing existing-profile `recentFoods` load was fixed. Removing the reset in an isolated mutation build triggers the browser's “new account inherited workouts” assertion.

**B. YYYY-MM-DD parsing: passes for the intended date-label correction.** Actual/profile chart and profile labels now parse local calendar components; weekly report previously already used local parsing, so consolidation does not move its date frame. Roundtrip labels, year/month boundaries, leap day and DST tests pass in Phoenix, Los Angeles, New York, UTC, Kolkata and Adelaide. The new strict parser also rejects impossible dates. Existing timestamp-based M3 periods retain their prior semantics. The six-zone suite exercises date/calendar helpers; the complete browser acceptance suite was run in Phoenix, not claimed in all six zones.

**C. Corrupt-profile sibling protection: passes.** Malformed profile bytes are quarantined; onboarding replaces only the explicitly recreated profile. Browser fixtures verify readable workouts, routines, targets, weekly rollup, history, same-day intake/meals, recent foods and plans survive recovery and two subsequent reloads. Existing materialized history remains consistent. The app's pre-existing day rollover may intentionally clear prior-day intake/meals; tests use current-day data to distinguish that from corruption loss.

## 10. Model-freeze evidence

`git diff 917e118..HEAD -- js/tissue` contains only the tissue README change from M4. All five JavaScript domain files and the pre-M2 golden fixture remain byte-identical. The SHA expectations are literal constants, not generated during testing; golden data was not regenerated. Imports among all actual model files form a closed pinned graph, so merely adding an unreferenced file cannot change execution, while importing it would modify a pinned file.

`node --test test/tissueModelFreeze.test.js test/tissueLoadInvariance.test.js`: **84 passed**. Raw-byte hashes intentionally include line endings. The repo's checked-out bytes pass; the test was not weakened to hide platform variation.

M3 map shading remains relative workload concentration across tissues within Today/This week. It does not use baseline deviation. Contributor calculations use the frozen mass; a browser case shows 1,800 squat quadriceps workload and 1,800 longitudinal exposure after the profile has changed. Confidence, provisional tendon semantics, geometry, completed-set filtering and independent Volume/Recovery features remain unchanged.

## 11. Browser verification

Baseline: existing harness, **30 grouped checks passed** on the original production build.

Final hardening: **34 grouped checks passed** on both production and development builds, fresh isolated Chrome contexts, synthetic `@example.com` profiles, actual DOM interaction for user actions. Storage seeding and failure injection set up fixtures; no direct React state injection was used.

Actually exercised:

- M3 map, Today/This week, 7/28-day exposure, above/below/equal baseline, insufficient and zero-baseline states.
- Partial mapping, approximate context, foreign-series warning, malformed/future envelopes, changed/deleted source reconciliation.
- Weight logging and exact local-date label, unchanged prior snapshots, completed new workout using new context, metadata independence.
- Frozen contributor totals, duplicate-source reorder after historical-weight correction, future-only history notice.
- Reload stability, backfill idempotence, no duplicates, A/B isolation, A → new C onboarding, readable sibling protection after corrupted profile and repeated reloads.
- Nutrition, hydration, workout logging, independent Volume and Recovery, keyboard access, 320px and 375px layouts and long labels.
- Real browser quota failure affecting only optional derived writes: source and prior derived bytes preserved, B nutrition untouched, unsaved-state copy visible.
- No captured runtime or console errors in final production/development runs.

Local artifacts: `/tmp/physiq-m4-browser-review-baseline`, `/tmp/physiq-m4-browser-review-final-production`, `/tmp/physiq-m4-browser-development`. Results JSON files record check names and empty error arrays. The 320px detail screenshot was visually inspected; stats and disclosure wrap within the viewport. These temporary artifacts are not source-controlled.

## 12. Tests added/changed

`test/tissueHistoryReview.test.js` adds **23 independent adversarial tests**: real-wrapper quota behavior, thrown reads, malformed sources, duplicate identity edits, historical weight correction policy, metadata/no-op stability, detached future records/restoration, invalid dates/weights, hand-calculated windows, malformed coverage/context, overflow, future-only history, absence semantics, export/import across zone/profile changes, serialization/sidecar failure, unknown schemas and dictionary-key safety.

Four rendering tests in `tissueLoadUi.test.js` cover observation disclosure, warnings in empty states, overflow unavailability and asymmetric mapping coverage. Existing text assertions were updated to the deliberately corrected contract. The foreign-retention test now checks detached preservation rather than stale active retention. The loader guard checks the additional recentFoods reader. The browser suite adds four grouped regressions and broadens profile-state assertions.

Final verification:

| Check | Result |
|---|---|
| `npm test` | **472 passed, 0 failed, 0 skipped** |
| `npm run build` | Success; committed production bundle regenerated |
| `git diff --check` | Clean |
| Snapshot / store / analytics individual suites | **15 / 26 / 19 passed** |
| Model freeze + invariance | **84 passed** |
| Date/snapshot/analytics/review suite in six specified zones | **65 passed per zone**, no skips/failures |
| Production / development browser acceptance | **34 grouped checks each**, no runtime/console errors |

Mutation experiments ran only in a temporary copied workspace, and all modifications there were restored. Tests failed when: future weights were allowed to back-apply; D-7 was included in recent; baseline overlapped recent; model series were combined; incomplete sets were counted; quota-pruning protection was removed; read-error protection was removed; onboarding reset was removed. The last case was detected in actual browser execution, not merely a source-text guard.

## 13. Fixes made

Code/tests/contracts/production bundle: **`844c62159ba98e6658a5061db3457ac59d067082`**, `fix: harden longitudinal history persistence and invariants`.

Review report is committed separately. Delivery branch: **`codex/milestone-4-review-hardening`**, targeting `main`. The fixes are pushed and [PR #26](https://github.com/heetdalsania/physiq/pull/26) is open. No merge was performed.

## 14. Remaining limitations

**Blocking M4 defects after these fixes:** none confirmed in the reviewed scope. The original merge alone should receive this hardening before proceeding.

**Non-blocking inherited limitations:** localStorage and source history grow without bound. General source writes still use the pre-existing quota pruner, and `importAll` is a nontransactional multi-key loop that can partially write under storage failure; a successful full roundtrip is verified, but a quota-interrupted import is not an atomic restore guarantee. This review removes destructive quota behavior from the newly added optional history write, without redesigning the app's entire persistence system. The wider app also does not have uniform schema validation for every parseable but wrong-shaped profile/source value. A missing sidecar or failed save may force approximate reconstruction on a later reload.

Performance sanity, separate 18-set squat fixtures rather than copying the PR fixture: at 624 sessions, about **36 ms cold / 5 ms no-op / 5 ms analytics**, 633,189 serialized characters; at 2,496 sessions, about **82 / 17 / 6 ms**, 2,536,261 characters. Timing varies. Strings can consume roughly twice these counts in UTF-16 storage, making large-history quota risk real. No obvious quadratic reconciliation growth, repeated model execution on tissue selection, or persistence loop was observed. Weight-log sorting still occurs during each new materialization; larger data may warrant optimization later.

**Deliberate contracts:** frozen inputs do not follow historical weight-log corrections; raw workout edits can rebuild and re-resolve context; missing post-first-log days mean zero logged workload; legacy timezone cannot be recovered; identical duplicate workouts lack a stronger identity; mapping percentages compare modeled work only; unsupported data is preserved without interpreting unknown schemas. None supports medical or readiness conclusions.

**Future work, not implemented:** audited context-correction workflows, stronger import transactions/source validation, stable imported source UUIDs, quota-aware storage redesign and any later milestone model work. No Milestone 5 feature was started.

## 15. Final status

These verdicts are for the reviewed hardening branch and the explicit logged-history contracts above. “Ready” means ready after review/merge of the hardening PR, not that original main has already been repaired.

```text
Milestone 4 architecture sound: yes
Milestone 4 mathematics sound: yes
Historical reproducibility sound: yes
Profile isolation sound: yes
Scientific semantics sound: yes
Model v0.1 still frozen: yes
Blocking defects remaining: no
Hardening fixes pushed: yes
Ready to proceed toward Milestone 5: yes
```

## Appendix: contemporaneous Phase A decision record

The following was recorded before production edits; the final findings and verification above supersede its planning language.
# Phase A decision record — before production edits
Reviewed eb56bfe0404ea1287630abb1c2bcbb2a11623c3a; clean main; 445/445 tests; production build clean; 84 freeze/invariance tests; existing 42-test date/history suite passes in all six requested zones.

Severity | Area | Finding and reproduction | Fix required?
---|---|---|---
BLOCKER | tissueHistoryStore.reconcile -> storage.set | Seed B nutrition history with 3 entries; fail A tissueHistory setItem with QuotaExceededError. A reports write_failed but B loses oldest nutrition entry. Existing failure test seeded no nutrition history, missing real wrapper side effect. | Yes; derived writes must never prune source/profile data.
HIGH | planReconciliation/indexSourceKeys | Two different workouts share id + timestamp; freeze at 180 lb; reverse log after profile changes to 120 lb. Both rebuild at 120 despite unchanged workouts. Existing duplicate test only used identical workouts. | Yes; match unchanged duplicate-group fingerprints before ordinal assignment.
HIGH | readTissueHistory/sourceIsReadable | Make getItem throw while setItem succeeds. Existing history classified absent and overwritten; source read throw classified readable. Non-array JSON source also accepted. | Yes; fail closed, preserve bytes.
MEDIUM | isDateKey/parseDayKey | Feb 30 accepted; resolver for Mar 1 picks 90 lb Feb 30 with daysBefore=-1 and approximate=false. parseDayKey accepts partial numeric segments/rollover. | Yes; validate actual calendar dates.
MEDIUM | isValidHistoryEntry/analytics | completed=1 modeled=9 accepted, unmapped=-8; negative tissue load accepted. | Yes; reject invalid numeric records; preserve raw stored entries.
MEDIUM | compareToBaseline/sum | recent=1e308 and baseline total=4 gives available Infinity delta/ratio/percent. Existing extreme test only reaches 4 million. | Yes; safe rounding and explicit unavailable arithmetic.
MEDIUM | observation semantics/UI | Jan 1 workout, return Apr 1: missing 3 months called observed days; app has no logging adherence telemetry. | Yes; retain logged-history arithmetic and eligibility but label days since first log and missing-log assumption explicitly.
MEDIUM | future-only history | First entry Jan 2027 with today Mar 2026 establishes future firstObservedDate and renders unexplained zero current windows. | Yes; exclude future records from current coverage, retain snapshots and disclose.
MEDIUM | foreign deletion | Remove only source of synthetic v0.2 entry: remains active forever, contradicting source-of-truth contract. Existing test explicitly blesses retention. | Yes; preserve detached foreign records separately from active entries.
MEDIUM | App.loadProfileScopedState | recentFoods always reset [] even for existing account; next food write replaces saved recent list. Existing onboarding test omits this state. | Yes; restore per-profile list with own fallback.
LOW | legacy timezone docs | No historical timezone retained before M4; backfill uses current runtime zone, cannot establish original training day. | Documentation clarification.
NOT A DEFECT | historical weight edits | Fingerprint excludes weight log by deliberate once-at-materialization contract. Later historical measurements do not automatically rewrite snapshots. | Pin explicit regression and document correction limitation.
NOT A DEFECT | export/import | exportAll includes every pq_* key including history and provenance; successful import preserves snapshots even with later profile weight. | Independent roundtrip regression.
NOT A DEFECT | model/scoping | Five domain files unchanged; only tissue README diff. No new coefficients/model, cloud, telemetry or training inference. | Preserve pins; no golden regeneration.
NOT A DEFECT | reference aliases | Pure planner retains unchanged object references for byte equality, but does not mutate them; storage boundary JSON serializes/detaches. Deep-frozen inputs supported. | Test read-only contract, do not add blanket deep cloning.

Core baseline boundaries independently read: D-6..D, D-27..D, D-34..D-7, divisor 4. Ordinary sums correct. New tests will use explicit dates and hand totals, not boundary helpers.

No production files changed during Phase A. Temporary reproductions: /tmp/physiq-m4-audit.mjs. Existing browser harness exercised real DOM and source/storage fixture setup; no React state injection.
