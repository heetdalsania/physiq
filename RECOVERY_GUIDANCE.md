# Milestone 5 - Recovery Guidance Contract

Milestone 5 replaces Physiq's fixed per-muscle recovery countdowns with
descriptive context derived from versioned TissueOS history.

This is guidance about **logged modeled training exposure**. It is not a
measurement or estimate of biological recovery, readiness, tissue capacity,
healing, injury risk or safety.

## Previous behavior being retired

`RecoveryTracker` assigned every muscle a universal 36-60 hour window. It
then labeled muscles `Ready to Train` or `Recovering` and displayed a precise
countdown. Workout severity, recent frequency, athlete history, mapping
coverage and uncertainty did not affect that timer.

Those outputs looked individualized but were only elapsed-time rules.

## Version and boundary

| Contract | Value |
|---|---|
| Guidance version | `recovery-guidance-v0.1` |
| Input history | `tissue-history-v1` |
| Workload model | `tissue-load-v0.1` |
| Baseline analytics | `load-baseline-v0.1` |
| Persistence | None; read-only derivation |

The implementation lives in `js/utils/tissueRecoveryGuidance.js`. It is a
pure adapter over frozen history. React renders its output and storage remains
owned by the Milestone 4 reconciler.

## Inputs

- current-series TissueOS history entries for one profile;
- an explicit current date/time supplied by the caller;
- the existing model/map/workload-unit series selector.

The adapter never reads the clock, React, storage, the network or another
profile.

## Outputs

For every modeled muscle region:

- latest modeled-load timestamp and elapsed time;
- latest session's modeled workload;
- number of modeled sessions in the current seven-day calendar window;
- seven-day and 28-day modeled workload;
- literal comparison with the athlete's own recent modeled baseline;
- weakest model confidence among the relevant entries;
- one data-presence state:
  - `recent_modeled_load` - modeled load exists in the last seven days;
  - `no_recent_modeled_load` - older modeled load exists, but none in the
    last seven days;
  - `no_modeled_history` - no modeled load exists for that region.

These states describe records, not physiology. They must never be renamed or
rendered as `ready`, `recovered`, `resting`, `safe`, `high risk` or similar
biological conclusions.

## UI contract

The Recovery Guidance card shows:

- which muscle regions have modeled load in the last seven days;
- time since the latest logged modeled load;
- modeled session count and seven-day workload;
- the literal baseline comparison when enough history exists;
- muscle regions with no modeled load in the seven-day window;
- coverage and uncertainty disclosures.

There is no countdown, progress-to-recovery bar, traffic-light readiness
color, percentage recovered or recommendation about what to train next.

## Known limitations

- Logged history cannot distinguish no training from unlogged training.
- Unmapped exercises are absent from modeled totals.
- Coefficients remain provisional and unvalidated.
- Body-mass inputs can be approximate for legacy workouts.
- A baseline comparison describes exposure, not tolerance or capacity.
- Sleep, soreness, nutrition, illness and non-Physiq activity are not inputs.

Changing any state semantics or deriving a biological conclusion requires a
new guidance version and separate scientific validation.

## Time and data quality

Calendar windows retain M4's definitions. This elapsed-time view additionally
excludes known completion timestamps later than the supplied clock, including
later today. Such entries become eligible once both their frozen day and
completion time have arrived. No historical data is rewritten.

An undated positive contribution makes the latest-load time unavailable;
missing contributing confidence makes combined confidence unavailable.
Equal completion timestamps use source-key order for deterministic selection.
Mapping coverage is disclosed for both the recent and baseline periods, and
approximate, foreign, future and invalid history notices remain visible.
