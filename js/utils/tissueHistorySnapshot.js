/* ─── TissueOS history — per-session snapshot (tissue-history-v1) ─────────
 *
 * Milestone 4. Pure functions: no React, no DOM, no storage, no clock.
 * Same inputs → same entry; inputs are never mutated.
 *
 * ── Why a snapshot exists ────────────────────────────────────────────────
 * Milestone 3 recomputed every historical workout from `workoutLog` plus
 * the CURRENT profile weight. A workout finished in March would therefore
 * silently change its modeled workload the day the user logged a new weight
 * in April, and a future coefficient table would silently rewrite the past.
 * Longitudinal exposure cannot be built on numbers that drift.
 *
 * A history entry freezes, per completed workout:
 *
 *   - which source record it came from (identity + a fingerprint of the
 *     model-relevant inputs, so a changed/replaced/deleted workout is
 *     detectable);
 *   - which model + coefficient-table version produced it;
 *   - the body mass that was actually used, and where it came from;
 *   - the stable local calendar day the workout belongs to;
 *   - the per-tissue totals, coverage and warnings the engine returned.
 *
 * It does NOT freeze the full event list. Measured on the demo fixtures a
 * full session result is roughly 6–15× the size of this entry, almost all
 * of it per-set event provenance that the longitudinal windows never read.
 * The Milestone 3 view still derives contributors live from `workoutLog`;
 * only the body mass it uses now comes from here. See
 * TISSUE_LOAD_HISTORY.md, "Full snapshot vs. minimal snapshot".
 *
 * ── What this is not ─────────────────────────────────────────────────────
 * Not a model. The numbers inside an entry are exactly what
 * `tissue-load-v0.1` returns for the frozen inputs; nothing here scales,
 * normalises or reinterprets them. Not a source of truth: `workoutLog`
 * remains authoritative and a snapshot is dropped or rebuilt whenever its
 * source changes (see tissueHistoryStore.js).
 * ───────────────────────────────────────────────────────────────────────── */

import { estimateSessionTissueLoad, WORKLOAD_UNIT, CANONICAL_WEIGHT_UNIT } from "../tissue/loadEngine.js";
import { TISSUE_LOAD_MODEL_VERSION, EXERCISE_TISSUE_MAP_VERSION } from "../tissue/modelVersion.js";

/* Layout version of a stored history ENTRY / envelope. Independent of the
   Physiq storage schema (integer, js/utils/storage.js), the TissueOS model
   version and the map version, all of which travel INSIDE an entry. Bump
   only when the on-disk shape of an entry changes. */
export const TISSUE_HISTORY_SCHEMA_VERSION = "tissue-history-v1";

/* Algorithm tag on every fingerprint, so a future change to what counts as
   "model-relevant" cannot be mistaken for a source edit. */
export const SOURCE_FINGERPRINT_VERSION = "fp1";

/* Where the frozen body mass came from. */
export const BODY_MASS_SOURCE_WEIGHT_LOG = "weight_log";         // dated measurement at/before the workout day
export const BODY_MASS_SOURCE_PROFILE_WEIGHT = "profile_weight"; // the profile's current weight at materialization
export const BODY_MASS_SOURCE_MODEL_DEFAULT = "model_default";   // nothing usable; engine used its 180 lb reference

const DATE_KEY = /^\d{4}-\d{2}-\d{2}$/;

function pad(n) { return n < 10 ? "0" + n : "" + n; }

/* Local calendar key of an epoch-ms instant, in the zone this code runs
   in. This is the only place a snapshot touches wall-clock semantics, and
   it is called exactly once per entry, at materialization, so the day a
   workout belongs to is frozen and does not move when the viewer's
   timezone later changes. */
export function localDateKey(ms) {
  if (!Number.isFinite(ms)) return null;
  const d = new Date(ms);
  if (!Number.isFinite(d.getTime())) return null;
  return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate());
}

/* Minutes east of UTC for that instant (DST-aware). Recorded for audit
   only; nothing reads it back for arithmetic.

   Normalised away from -0: in UTC the negation yields -0, which survives
   in memory but serialises as 0, so a freshly materialised entry would
   not be deep-equal to the same entry read back from disk. */
export function localUtcOffsetMinutes(ms) {
  if (!Number.isFinite(ms)) return null;
  const d = new Date(ms);
  if (!Number.isFinite(d.getTime())) return null;
  const offset = -d.getTimezoneOffset();
  return offset === 0 ? 0 : offset;
}

export function isDateKey(value) {
  if (typeof value !== "string" || !DATE_KEY.test(value)) return false;
  const [y, m, d] = value.split("-").map(Number);
  const date = new Date(0);
  date.setUTCFullYear(y, m - 1, d);
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d;
}

// ── Source identity and fingerprint ─────────────────────────────────────

/* A workout is datable for history purposes iff it has a finite, in-range
   `finishedAt` — the same rule Milestone 3 uses to place it in a period.
   `startedAt` is never used as a substitute. */
export function isDatableSession(session) {
  return !!session && typeof session === "object" &&
    Number.isFinite(session.finishedAt) && Number.isFinite(new Date(session.finishedAt).getTime());
}

function idPart(id) {
  return (typeof id === "number" && Number.isFinite(id)) || typeof id === "string" ? String(id) : "null";
}

/* Stable identity of a source record: id + completion instant + ordinal.
   `Date.now()` ids are unique in practice but not guaranteed (an import can
   duplicate one), so the ordinal — this record's position among records
   sharing the same id@finishedAt, in log order — keeps two duplicates as
   two entries, exactly as `workoutLog` (the source of truth) counts them. */
export function sourceKeyFor(session, ordinal) {
  return idPart(session.id) + "@" + session.finishedAt + "#" + (ordinal || 0);
}

/* Source keys for every record in a log, aligned by index; null for records
   that are not datable. Pure: the log is read, never modified. */
export function indexSourceKeys(workoutLog) {
  const seen = {};
  return (Array.isArray(workoutLog) ? workoutLog : []).map(function (session) {
    if (!isDatableSession(session)) return null;
    const base = idPart(session.id) + "@" + session.finishedAt;
    const ordinal = Object.prototype.hasOwnProperty.call(seen, base) ? seen[base] + 1 : 0;
    seen[base] = ordinal;
    return base + "#" + ordinal;
  });
}

/* 32-bit FNV-1a, run twice with different offsets and concatenated. Not
   cryptographic — it only has to make an accidental collision between two
   edits of the SAME workout vanishingly unlikely. */
function fnv1a(str, offset) {
  let h = offset >>> 0;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return ("00000000" + h.toString(16)).slice(-8);
}

/* Exactly the inputs tissue-load-v0.1 reads, and nothing else:
   completion instant, exercise names, and each set's reps / weight / done.
   Milestone 2 metadata (rir / side / tempo / rom), titles, routine ids,
   display labels and the precomputed counters are ignored by the engine
   and therefore by the fingerprint — editing them must not invalidate a
   snapshot, and a test pins that. Raw values are serialised as-is so a
   change of "5" to 5 still re-materialises (harmless: same output). */
export function canonicalSourceInputs(session) {
  const s = session || {};
  return {
    id: s.id === undefined ? null : s.id,
    finishedAt: Number.isFinite(s.finishedAt) ? s.finishedAt : null,
    exercises: (Array.isArray(s.exercises) ? s.exercises : []).map(function (ex) {
      const e = ex || {};
      return {
        name: typeof e.name === "string" ? e.name : null,
        sets: (Array.isArray(e.sets) ? e.sets : []).map(function (set) {
          const t = set || {};
          return {
            reps: t.reps === undefined ? null : t.reps,
            weight: t.weight === undefined ? null : t.weight,
            done: t.done === true
          };
        })
      };
    })
  };
}

export function sourceFingerprint(session) {
  let json;
  try { json = JSON.stringify(canonicalSourceInputs(session)); } catch (e) { json = "unserialisable"; }
  return SOURCE_FINGERPRINT_VERSION + ":" + fnv1a(json, 0x811c9dc5) + fnv1a(json, 0x01000193) + ":" + json.length;
}

// ── Historical body mass ────────────────────────────────────────────────

/* Valid weight-log entries only: "YYYY-MM-DD" date and a finite positive
   number, the shape App.logWeight() writes. Anything else is ignored, never
   repaired. Returned oldest → newest; equal dates keep log order. */
export function validWeightLogEntries(weightLog) {
  return (Array.isArray(weightLog) ? weightLog : [])
    .filter(function (e) { return !!e && isDateKey(e.date) && typeof e.weight === "number" && Number.isFinite(e.weight) && e.weight > 0; })
    .map(function (e, i) { return { date: e.date, weight: e.weight, order: i }; })
    .sort(function (a, b) { return a.date < b.date ? -1 : a.date > b.date ? 1 : a.order - b.order; });
}

/* Deterministic resolution policy — see TISSUE_LOAD_HISTORY.md, "Body mass".
 *
 *   1. the latest valid weight-log measurement dated ON OR BEFORE the
 *      workout's local day (a later measurement is never back-applied,
 *      however close it is);
 *   2. otherwise the profile's current weight, recorded as such —
 *      contemporaneous when materialization happens on the workout's own
 *      day, and flagged `approximate` (a legacy fallback) when it does not;
 *   3. otherwise nothing: the engine applies its documented 180 lb reference
 *      and its own `default_body_mass` warning, unchanged.
 *
 * The engine's confidence category is NOT touched by any of this; input
 * provenance is a separate, parallel fact. */
export function resolveHistoricalBodyMass(input) {
  const opts = input || {};
  const localDate = opts.localDate;
  const entries = validWeightLogEntries(opts.weightLog);
  let match = null;
  if (isDateKey(localDate)) {
    for (let i = entries.length - 1; i >= 0; i--) {
      if (entries[i].date <= localDate) { match = entries[i]; break; }
    }
  }
  if (match) {
    return {
      bodyMass: match.weight,
      provenance: {
        source: BODY_MASS_SOURCE_WEIGHT_LOG,
        measurementDate: match.date,
        daysBefore: diffDayKeys(match.date, localDate),
        contemporaneous: match.date === localDate,
        approximate: false
      }
    };
  }
  const current = opts.currentWeight;
  if (typeof current === "number" && Number.isFinite(current) && current > 0) {
    const contemporaneous = isDateKey(opts.materializedOnDate) && opts.materializedOnDate === localDate;
    return {
      bodyMass: current,
      provenance: {
        source: BODY_MASS_SOURCE_PROFILE_WEIGHT,
        measurementDate: null,
        daysBefore: null,
        contemporaneous: contemporaneous,
        approximate: !contemporaneous
      }
    };
  }
  return {
    bodyMass: null,
    provenance: {
      source: BODY_MASS_SOURCE_MODEL_DEFAULT,
      measurementDate: null,
      daysBefore: null,
      contemporaneous: false,
      approximate: true
    }
  };
}

/* Whole days from `a` to `b` ("YYYY-MM-DD" each), timezone-free. */
export function diffDayKeys(a, b) {
  if (!isDateKey(a) || !isDateKey(b)) return null;
  const pa = a.split("-").map(Number), pb = b.split("-").map(Number);
  const epoch = p => { const d = new Date(0); d.setUTCFullYear(p[0], p[1] - 1, p[2]); return d.getTime(); };
  return Math.round((epoch(pb) - epoch(pa)) / 86400000);
}

// ── Materialization ─────────────────────────────────────────────────────

/* Builds ONE history entry for a datable workout, or null when the record
   cannot be dated. `context`:
 *
 *   ordinal         position among records sharing id@finishedAt (see sourceKeyFor)
 *   weightLog       the profile's weight log (read only)
 *   currentWeight   the profile's current weight (read only)
 *   materializedAt  epoch ms supplied by the caller — never read from a clock here
 *
 * Field order is fixed so identical inputs serialise identically. */
export function materializeTissueHistoryEntry(session, context) {
  if (!isDatableSession(session)) return null;
  const ctx = context || {};
  const localDate = localDateKey(session.finishedAt);
  const materializedAt = Number.isFinite(ctx.materializedAt) ? ctx.materializedAt : null;
  const resolved = resolveHistoricalBodyMass({
    weightLog: ctx.weightLog,
    currentWeight: ctx.currentWeight,
    localDate: localDate,
    materializedOnDate: materializedAt === null ? null : localDateKey(materializedAt)
  });

  const result = estimateSessionTissueLoad(session, resolved.bodyMass === null ? undefined : { bodyMass: resolved.bodyMass });

  const tissues = {};
  Object.keys(result.tissues).sort().forEach(function (id) {
    const t = result.tissues[id];
    tissues[id] = { workload: t.totalWorkload, eventCount: t.eventCount, confidence: t.confidence };
  });

  let completedSets = 0, modeledSets = 0;
  const unmapped = [];
  result.exercises.forEach(function (ex) {
    completedSets += ex.completedSets;
    if (ex.status === "mapped") modeledSets += ex.completedSets;
    else if (ex.completedSets > 0) {
      const name = ex.exerciseName || "Unnamed exercise";
      if (unmapped.indexOf(name) < 0) unmapped.push(name);
    }
  });

  return {
    schemaVersion: TISSUE_HISTORY_SCHEMA_VERSION,
    sourceKey: sourceKeyFor(session, ctx.ordinal),
    sourceId: session.id === undefined ? null : session.id,
    sourceFinishedAt: session.finishedAt,
    sourceFingerprint: sourceFingerprint(session),
    localDate: localDate,
    utcOffsetMinutes: localUtcOffsetMinutes(session.finishedAt),
    modelVersion: result.modelVersion,
    mapVersion: result.mapVersion,
    workloadUnit: result.workloadUnit,
    inputs: {
      bodyMass: resolved.bodyMass,
      weightUnit: CANONICAL_WEIGHT_UNIT,
      bodyMassProvenance: resolved.provenance
    },
    tissues: tissues,
    coverage: {
      completedSets: completedSets,
      modeledSets: modeledSets,
      unmappedExercises: unmapped.slice().sort()
    },
    warnings: result.warnings.slice(),
    materializedAt: materializedAt
  };
}

/* Structural check used by readers: is this a well-formed v1 entry? Does
   not check the model version — a foreign-series entry is still valid. */
export function isValidHistoryEntry(entry) {
  return !!entry && typeof entry === "object" && !Array.isArray(entry) &&
    entry.schemaVersion === TISSUE_HISTORY_SCHEMA_VERSION &&
    typeof entry.sourceKey === "string" && entry.sourceKey.length > 0 &&
    typeof entry.sourceFingerprint === "string" &&
    isDateKey(entry.localDate) &&
    typeof entry.modelVersion === "string" && typeof entry.mapVersion === "string" &&
    typeof entry.workloadUnit === "string" &&
    !!entry.inputs && (entry.inputs.bodyMass === null || (Number.isFinite(entry.inputs.bodyMass) && entry.inputs.bodyMass > 0)) &&
    !!entry.inputs.bodyMassProvenance && typeof entry.inputs.bodyMassProvenance.approximate === "boolean" &&
    !!entry.tissues && typeof entry.tissues === "object" && !Array.isArray(entry.tissues) &&
    Object.values(entry.tissues).every(t => t && typeof t === "object" && Number.isFinite(t.workload) && t.workload >= 0) &&
    !!entry.coverage && typeof entry.coverage === "object" &&
    Number.isSafeInteger(entry.coverage.completedSets) && entry.coverage.completedSets >= 0 &&
    Number.isSafeInteger(entry.coverage.modeledSets) && entry.coverage.modeledSets >= 0 &&
    entry.coverage.modeledSets <= entry.coverage.completedSets;
}

/* Is an entry produced by THIS build's engine (same model + map)? Entries
   from any other series are preserved by the store and ignored by the
   analytics for this series; they are never merged. */
export function isCurrentSeriesEntry(entry) {
  return isValidHistoryEntry(entry) &&
    entry.modelVersion === TISSUE_LOAD_MODEL_VERSION &&
    entry.mapVersion === EXERCISE_TISSUE_MAP_VERSION &&
    entry.workloadUnit === WORKLOAD_UNIT;
}

export const CURRENT_SERIES = Object.freeze({
  modelVersion: TISSUE_LOAD_MODEL_VERSION,
  mapVersion: EXERCISE_TISSUE_MAP_VERSION,
  workloadUnit: WORKLOAD_UNIT
});
