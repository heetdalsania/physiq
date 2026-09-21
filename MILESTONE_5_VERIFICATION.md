# Milestone 5 - Recovery Guidance Verification

Verified 2026-09-21 on branch `codex/milestone-5-contract`, based on
`origin/main` at `25b3ed92f481703c2bad7ac54bb47c93932330d9`.

## Scope

Milestone 5 removes fixed per-muscle recovery-hour assumptions and replaces
them with a read-only, versioned summary of existing TissueOS history.

The new UI reports:

- the latest logged modeled load and elapsed time;
- modeled-session frequency in the last seven calendar days;
- seven-day workload;
- a literal athlete-relative baseline comparison when available;
- inherited model confidence and mapping limitations.

It does not produce a recovery percentage, readiness state, capacity estimate,
healing claim, safety decision or training prescription.

The complete contract is in [RECOVERY_GUIDANCE.md](RECOVERY_GUIDANCE.md).

## Baseline

Before editing:

| Check | Result |
|---|---|
| Worktree | Clean, isolated from the older local checkout |
| `HEAD` / `origin/main` | Both `25b3ed92f481703c2bad7ac54bb47c93932330d9` |
| `npm ci` | Lockfile-exact install succeeded |
| `npm test` | 472 passed, 0 failed/skipped/todo |
| `npm run build` | Passed; generated files reproduced cleanly |

## Architecture

```text
tissue-history-v1 entries
        |
        v
js/utils/tissueRecoveryGuidance.js  (pure, explicit clock)
        |
        v
js/components/RecoveryTracker.js    (read-only presentation)
```

- `recovery-guidance-v0.1` is independent of the workload, mapping, history
  and baseline versions.
- `tissue-load-v0.1` and its golden fixture are unchanged.
- No storage key, migration, writer or network call was added.
- `RecoveryTracker` consumes the same profile-scoped history already passed
  into `ExerciseTab` for the Tissue Load view.
- Foreign model series, future entries and invalid entries remain excluded by
  the Milestone 4 series-selection rules.

## Retired behavior

- universal 24-72 hour values in shared muscle constants;
- `RECOVERY_HOURS` in the component;
- `Ready to Train`, `Recovering`, `Ready in ...`, `resting` and `fair game`;
- progress-to-recovery styling and green/amber readiness signaling.

A source-guard test fails if the fixed-hour model or readiness countdown copy
returns.

## Verification

| Check | Result |
|---|---|
| Full Node test suite (`test/*.test.js`, same suite as `npm test`) | 488 passed, 0 failed/skipped/todo |
| Guidance suite across six time zones | 12 passed per zone |
| `npm run build` | Passed; `dist/` regenerated |
| `git diff --check` | Clean |
| Production browser acceptance | 35 grouped checks passed |
| Runtime/console errors | None |
| Responsive checks | No overflow at 320px or 375px |

The browser suite uses isolated synthetic `@example.com` profiles, a frozen
Phoenix clock and a fresh Chrome context. It verifies the M5 values against a
hand-checkable baseline, confirms fixed readiness terms are absent, exercises
profile isolation and persistence failures, and reruns the complete M4
regression flow.

Visual artifacts were inspected at:

```text
/tmp/physiq-m4-browser-milestone-5-push-review/recovery-320.png
/tmp/physiq-m4-browser-milestone-5-push-review/recovery-375.png
```

## Remaining limitations

- The guidance is only as complete as the user's logged, mapped workouts.
- A day without a record can mean no training or unlogged training.
- Workload coefficients remain provisional and unvalidated.
- Sleep, soreness, illness, nutrition and external activity are not inputs.
- Baseline direction is exposure context, not a tolerance or capacity signal.

The UI discloses missing logs, provisional coefficients and unassessed inputs;
none is converted into hidden thresholds.

## Pre-push review

The final review fixed same-day future completions contributing before their
timestamp, missing confidence being silently ignored, and an undated
contribution allowing an older event to be presented as definitively latest.
Regression tests pin those cases and deterministic selection for tied times.

Mapping gaps in the baseline are disclosed even when recent mapping is
complete. Approximate inputs, foreign model data, future/invalid records and
unsaved source workouts now have visible notices, including empty states.
No changes were made to the M4 persistence or workload model.

The guidance tests pass in Phoenix, Los Angeles, New York, UTC, Kolkata and
Adelaide. Browser acceptance runs in Phoenix. Native iOS execution was not
tested during this milestone.
