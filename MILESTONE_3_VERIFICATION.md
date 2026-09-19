# Milestone 3 — implementation and verification report

Verified 2026-09-18. Implementation and required verification completed locally.
No commits, pushes, publication, deployment or Milestone 4 work were performed.
The only Git integration was the explicitly authorized initial fast-forward.

## 1. Actual baseline

- Branch: `main`.
- Updated HEAD: `23109654b4c8b9ff0f3b7a5664bd6490c09d797b`.
- Started from clean `76e6249`, fetched origin, then `git merge --ff-only origin/main`.
  No reset, rebase, forced checkout or user-work deletion.
- `git merge-base --is-ancestor <commit> HEAD` succeeded for **6fd19bf**, **53a8e93**,
  **3304f3c**, **26fbe74**. Storage contract, metadata contract, domain code/README,
  metadata implementation, golden fixtures, automated tests and `npm test` present.
- No applicable `AGENTS.md` was found in the repository or inspected parent paths.
- Baseline `npm test`: **337 tests, 337 passed, 0 failed/skipped/cancelled**.
- Initial build attempt found missing local `esbuild`. Resolved with the existing
  lockfile via `npm ci --cache /tmp/physiq-npm-cache --no-audit --no-fund`; no package
  manifest or lockfile changes. Then baseline `npm run build` **passed**.
- Baseline build left **clean Git status** and reproduced the committed artifacts.
- `dist/` is committed in this repository, so regenerated production assets remain
  in the reviewable diff. SHA-256 was used to record their exact contents.

| Artifact | Baseline SHA-256 | Final SHA-256 |
| --- | --- | --- |
| `dist/app.min.js` | `61544f849170ffd546813dd901e51b0625be8110c162382cb4a6eb57b2727694` | `a097028f45dc521a293adfe8dc4925b5d5e43a61874b3b1186f4c8f7c7e0d74c` |
| `dist/index.html` | `2a3ddfcc0e8b97acb54806b5dda30f8a83f2bfc790fe41027edf4877f691522d` | unchanged |
| `dist/styles.min.css` | `15a0aebcec90c268bc924411a28be9d4f4f71d936811cba04b2f2ab393235789` | `7372e6d41452932153c44c547e80b79f148cdf0a1a819b3d9b8a8c1fb10ca7bd` |

## 2. Existing anatomy/UI findings

The muscle map is in **Exercise**, not Health. Health contains goals/activity and
lifetime stats. `MuscleTracker.js` owns a shared SVG silhouette and arrays of
region paths keyed by Physiq muscle IDs. Training Volume counts weekly completed
sets, with gray/amber/green colors and editable per-muscle targets. Cardio uses
training-day frequency. Recovery is a separate card based on weekly session times.

Front shapes: chest, shoulders, biceps, core, quads. Back shapes: back, shoulders,
triceps, glutes, hamstrings, calves. All ten TissueOS muscle definitions have a
matching coarse shape (`quadriceps` links to `quads`). Neither patellar nor Achilles
tendon has suitable geometry. They are list-only; no existing muscle shape is
misrepresented as a tendon.

Only three `export` keywords were added to MuscleTracker to reuse its geometry.
A byte comparison against HEAD after removing those keywords proved all original
volume code identical. The original tracker remains mounted when hidden, retaining
selection/target-edit state. Both Exercise entry points (tab and quick-access
popup) receive active-profile history and body mass, keyed by email.

## 3. Final Tissue Load UX

- **Training Volume / Tissue Load** native-button mode selector; Volume is default.
  Recovery stays separate and unchanged.
- **Today** default, optional **This week** using local Monday–Sunday semantics.
- Neutral purple max-relative shading, visible legend and nearby provisional-model
  and “not injury risk” wording. Gray/dashed means no modeled contribution.
- Front/back controls, pointer/Enter/Space SVG selection, accessible names and
  pressed states, plus native list buttons for all muscle regions.
- Inline detail: raw workload and unit, contributing exercises with values,
  weakest categorical confidence, model version, limitations. No hover required.
- Coverage is mapped completed sets / all completed sets; unmapped exercise names
  are expandable. Invalid completion dates are excluded with a visible count.
- Tendon buttons are always available under **Other modeled tissues**, with
  provisional mechanical-relevance and no force/stress-fraction qualification.
- Separate empty, incomplete-only, entirely-unmapped, partially-mapped,
  no-contribution and modeled-zero states.
- CSS wraps long labels/contributors at 320px and supports dark/light themes.

## 4. Mathematical/display semantics

Raw workload is the frozen heuristic `reps × effectiveLoad × coefficient`, in
**`lb*rep`**, unbounded, model **`tissue-load-v0.1`**. No force conversion or new model
normalization occurs. Optional metadata is ignored by that engine as before.

The pure presentation adapter aggregates domain events by tissue and canonical
exercise name from engine provenance/resolution. Contributors sort largest first,
then deterministic code-point name order; repeated exercises combine across sessions.

`displayIntensity = totalWorkload / maximumTissueWorkloadInSelectedPeriod`, with
zero if the maximum is zero. The maximum includes list-only tendons. This bounded
value is **presentation-only**, absent from domain output and persistence. A tiny
workout's maximum can receive the darkest color; visible copy explains this.
A darker region indicates relative concentration, not injury risk or excessive load.
**No percentages or 0–100 Tissue Load scores are shown.**

## 5. Model integrity

- All five `js/tissue/*.js` files are byte-unchanged against baseline: version,
  definitions, mappings, coefficients, bands, confidence policy, algorithm, units,
  provenance and event shapes remain frozen.
- The domain README only updates integration status and links the UI documentation;
  no scientific contract changes.
- **82 golden/model-invariance tests pass**, including completed/incomplete metadata
  variants and full event/provenance comparisons.
- An additional pre-edit capture of three representative demo sessions (including
  metadata) and an incomplete squat set, with pinned timestamps, was compared
  byte-for-byte after implementation. Both hash to:
  `769a56b05598b742ab8ec8c38206960d8fa73519e0535e3f8b855cbbcc5be884`.
  Capture: `/tmp/physiq-m3-engine-before.json`. The golden capture tool was not run.
- Existing golden JSON SHA-256 remains:
  `d88a506e887147768a2ca00d35a66d7819cfe839308d0109e22079588f127b35`.

## 6. Persistence

Reads only already-loaded active-profile `workoutLog` and `profile.weight`.
No new keys, schema, TissueLoadEvents, storage writes, model cache or mutation of
history. Schema stays **1**. Deep-frozen input tests and a throwing storage getter
verify pure computation; source guards prohibit storage APIs in the new modules.
Browser comparison of the complete localStorage snapshot before/after opening and
selecting Tissue Load is identical. Reload uses the existing log. A→B→A switching
recomputes isolated workloads and coverage.

The pre-existing app still has eager boot-time writeback effects. Milestone 3 adds
none and does not change them. Nutrition, metadata and storage implementations,
package manifests and demo fixtures have no diff.

## 7. Every changed file

| File | Purpose |
| --- | --- |
| `README.md` | Discoverable Tissue Load feature/documentation link |
| `TISSUE_LOAD_MAP.md` | Period, anatomy, workload/display semantics, limitations and verification instructions |
| `MILESTONE_3_VERIFICATION.md` | This baseline and acceptance report |
| `js/utils/tissueLoadView.js` | Pure calendar selection, engine consumption, event/contributor aggregation, coverage, confidence and display intensity |
| `js/components/TissueLoadTracker.js` | Read-only map, modes within the view, detail, legends, coverage and tendon list |
| `js/components/MuscleTracker.js` | Export existing geometry arrays only |
| `js/screens/ExerciseTab.js` | Separate Training Volume/Tissue Load selector; preserve Recovery |
| `js/App.js` | Pass active-profile history/body mass to both Exercise entry points; profile key |
| `css/styles.css` | Scoped Tissue Load styles and accessible narrow layout |
| `js/tissue/README.md` | Update previously unwired status for Milestone 3; model semantics untouched |
| `test/tissueDefinitions.test.js` | Replace Milestone 1's no-consumer guard with sole-adapter import boundary; domain purity guard retained |
| `test/tissueLoadView.test.js` | 18 deterministic presentation/integration/storage-isolation tests |
| `test/tissueLoadUi.test.js` | 7 in-memory JSX-rendered UI and wiring tests using existing esbuild/React |
| `test/browser/tissueLoad.browser.mjs` | Isolated synthetic-profile browser acceptance harness |
| `dist/app.min.js` | Regenerated production bundle |
| `dist/styles.min.css` | Regenerated production CSS |

## 8. Automated verification

| Exact command | Outcome |
| --- | --- |
| `node --test test/tissueLoadView.test.js test/tissueLoadUi.test.js` | **25/25 passed** |
| `node --test test/tissueLoadInvariance.test.js` | **82/82 passed** |
| `TZ=America/Phoenix node --test test/tissueLoadView.test.js` | **18/18 passed** |
| `TZ=America/New_York node --test test/tissueLoadView.test.js` | **18/18 passed**, including DST calendar boundaries |
| `TZ=UTC node --test test/tissueLoadView.test.js` | **18/18 passed** |
| `npm test` | **362/362 passed**, zero failures/skips/cancellations |
| `npm run build:dev` | Passed; development build copied to `/tmp/physiq-m3-development-build` for isolated verification |
| `npm run build` | Passed; final repository artifacts are production, no dev seeder |
| `git diff --check` | Passed |
| `git diff --exit-code -- 'js/tissue/*.js' js/utils/storage.js js/utils/setMetadata.js js/utils/workoutSession.js js/dev/demoFixtures.js test/fixtures/tissueLoadBaseline.v0.1.json package.json package-lock.json` | Passed, no changes |
| `shasum -a 256 dist/* test/fixtures/tissueLoadBaseline.v0.1.json` | Hashes recorded above |

Tests use Node's existing test runner. JSX tests build in memory, without disk
writes or a new framework. The entire original suite passes; one milestone-specific
no-import guard was intentionally replaced now that consuming the engine is in scope.

Scientific-language audit command:

```sh
rg -n 'risk|safe|danger|injury|damage|recovered|recovery|capacity|force|stress|score|percent|overload' \
  js/utils/tissueLoadView.js js/components/TissueLoadTracker.js TISSUE_LOAD_MAP.md \
  test/tissueLoadView.test.js test/tissueLoadUi.test.js test/browser/tissueLoad.browser.mjs
```

All new UI occurrences are explicit limitations or negations, not diagnoses or
recommendations. Accessibility labels describe workload/no modeled contribution.
Existing Recovery terminology is outside the new Tissue Load surface and unchanged.

## 9. Browser verification

Actual browser: headless installed Google Chrome, Playwright pointer/keyboard
interaction, new context with no user profile, synthetic A/B accounts, fixed
March 4 2026 local date, `America/Phoenix`. Network fonts were stubbed; no external
food API was required for the manual logging smoke test.

Exact run commands in this environment:

```sh
PLAYWRIGHT_MODULE=/Users/arunvelkumar/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs \
  node test/browser/tissueLoad.browser.mjs dist production

PLAYWRIGHT_MODULE=/Users/arunvelkumar/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs \
  node test/browser/tissueLoad.browser.mjs /tmp/physiq-m3-development-build development
```

Both builds pass **20 grouped behavioral checks**, collectively covering all 25
requested browser items. Both result files contain **zero runtime exceptions and
zero console errors**. Normal pointer/keyboard automation was available. Fixture
setup and storage assertions use JavaScript; user actions use browser locators,
clicks, typing/select controls and Enter/Space, not direct React-state injection.

| Requested acceptance item | Result/evidence |
| --- | --- |
| 1. Existing app loads | Pass, login then seeded profile app |
| 2. Volume unchanged | Pass, 3/8 chest target and original amber fill; identical tracker DOM before/after mode switch |
| 3. Tissue mode opens | Pass, keyboard Enter and pressed state |
| 4. No-workout state | Pass, no workouts today |
| 5. Mapped workload visible | Pass, quadriceps 3,600 `lb*rep` |
| 6. Multiple exercises aggregate | Pass, hamstrings 3,040 |
| 7. Multiple sessions aggregate | Pass, two today; three in calendar week |
| 8. Incomplete sets excluded | Pass, huge incomplete set and later completed-one-set logging |
| 9. Metadata leaves workload unchanged | Pass, all four fields varied without changing detail |
| 10. Front/back selection | Pass, quadriceps pointer and hamstrings Space |
| 11. Contributors match | Pass, Romanian Deadlift 1,960; Squat 1,080 |
| 12. Confidence matches | Pass, quadriceps Medium; hamstrings Low |
| 13. Partial coverage | Pass, 4 of 5 completed sets modeled |
| 14. Entirely unmapped | Pass, 0 of 1 modeled, unknown workload, no numerical zero detail |
| 15. Tendons inspectable | Pass, patellar 2,880; Achilles 2,115; no SVG tendon regions |
| 16. Reload | Pass, workload/log reproduced |
| 17. Profile isolation | Pass, A→B→A; B biceps 200 and no A coverage leakage |
| 18. Nutrition smoke | Pass, water +8 and manual meal +200 calories/+20 protein persisted |
| 19. Workout logging | Pass, routine start, metadata edits, done toggle, finish, reload-backed storage assertion and resulting chest 1,080 |
| 20. 375px mobile | Pass, viewport/element overflow checks and screenshots |
| 21. 320px narrow | Pass, no horizontal overflow in document, popup, card or list items |
| 22. Long names | Pass, long unmapped name and contributor layout wrap without overflow |
| 23. Accessibility labels/states | Pass, native mode/period buttons, SVG button names/tab order/pressed state, keyboard activation, unique detail IDs |
| 24. Development errors | Pass, none |
| 25. Production errors | Pass, none; production seeder absent |

Additional browser checks distinguish mapped-zero from incomplete-only sessions,
verify opening/selecting performs no storage writes, and exercise light theme.

Artifacts (local, intentionally outside the review diff):

- `/tmp/physiq-m3-browser-production/results.json`
- `/tmp/physiq-m3-browser-development/results.json`
- Each directory: `header-320.png`, `header-375.png`, `map-320.png`, `map-375.png`,
  `detail-320.png`, `detail-375.png`, `light-detail-320.png`.

**Visually inspected:** production narrow header, body map, detail/contributor
panel and light-theme detail screenshots. Text wraps, legend/confidence are
readable, selected regions have an outline, and touch-independent detail exists.

**Not verified on hardware:** native iOS/WKWebView, physical touch devices and a
screen-reader session. These are non-blocking platform validation limitations;
Chrome mobile viewport emulation is not a physical-device claim. No requested
browser acceptance item remains pending in the available environment.

Initial harness retries corrected locator targeting (click a real SVG path rather
than the gap between bilateral paths; the old Start Routine name contains a play
icon). These were automation issues, not product changes or waived failures.

## 10. Scientific limitations

Provisional, unvalidated coefficients and body-mass bands; only 25 mapped exercise
names; no measured biomechanics; broad bilateral shapes; no tendon geometry;
current rather than historical body mass; optional RIR/side/tempo/ROM and intensity
relative to capacity ignored; no personal baseline or longitudinal state. Confidence
is categorical model-author judgment, never statistical accuracy or training safety.
The UI exposes these limits and does not prescribe training or interpret pain.

## 11. Remaining issues

- **Blockers:** none found for this milestone.
- **Non-blocking:** limited model coverage/validation and anatomy described above;
  physical iOS and screen-reader testing not performed. Invalid/missing completion
  timestamps are visibly excluded rather than inferred or repaired.
- **Pre-existing:** legacy weight fields assume pounds; changing exercise display
  names can orphan mapping matches; existing Recovery remains its old model;
  workout history is unbounded. These were neither changed nor expanded in scope.
- Dependency installation was an environment setup issue, resolved before edits.
- Git status is intentionally dirty with the 16 implementation/test/documentation
  and generated-asset files listed above; there were no pre-existing user changes.

## 12. Completion status

```text
Implementation complete: yes
Verification complete: yes
Milestone 3 acceptance criteria satisfied: yes
Ready for Milestone 4: yes
```

“Ready” means this milestone's work is ready for review before any subsequent
milestone. No Milestone 4 code, persistence, model revision, commit or deployment
was started. The branch remains `main` at the updated baseline HEAD with a
reviewable, uncommitted Milestone 3 diff.
