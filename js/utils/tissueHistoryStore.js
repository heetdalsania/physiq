/* ─── TissueOS history — storage / application layer ──────────────────────
 *
 * Milestone 4. Owns ONE profile-scoped key:
 *
 *   pq_<email>_tissueHistory   →   { schemaVersion: "tissue-history-v1", entries: [ … ] }
 *
 * and the single operation that writes it: reconcileTissueHistory(). It is
 * called from App.js at the same boundary the source `workoutLog` is
 * persisted — boot restore, login, and immediately after a completed
 * workout lands — never from a render, never from the presentation layer.
 * Opening the Tissue Load view reads state; it does not write.
 *
 * ── Guarantees (each pinned by test/tissueHistoryStore.test.js) ──────────
 *   - the source of truth stays `workoutLog`: an entry whose source is gone
 *     is dropped, an entry whose source changed is rebuilt, everything else
 *     is kept BYTE-FOR-BYTE (unknown fields and all), except ordinal-only
 *     rekeys when duplicate source records move;
 *   - idempotent and duplicate-free: running twice writes nothing the
 *     second time; N runs converge on one entry per source record;
 *   - profile-scoped: only the given profile's key is read or written;
 *   - never persists derived history for a source that did not save
 *     (`persist:false` when the workoutLog write failed or Dev Mode is on);
 *   - never writes when the stored value is unreadable, or carries a
 *     schema this build does not understand, or when the SOURCE key itself
 *     is unreadable — the app still gets an in-memory history for the
 *     session, but nothing on disk is replaced or downgraded;
 *   - entries from another model/map series are preserved untouched, with
 *     detached sources retained separately from active history;
 *   - a failed write is reported as such; there is no separate "migrated"
 *     marker that could be advanced ahead of the data, because the
 *     envelope IS the data and it is written in one setItem.
 * ───────────────────────────────────────────────────────────────────────── */

import { uKey, get, set } from "./storage.js";
import {
  TISSUE_HISTORY_SCHEMA_VERSION,
  materializeTissueHistoryEntry,
  indexSourceKeys,
  sourceFingerprint,
  isValidHistoryEntry,
  isCurrentSeriesEntry
} from "./tissueHistorySnapshot.js";

export const TISSUE_HISTORY_SUFFIX = "tissueHistory";

export function tissueHistoryKey(email) {
  return uKey(email, TISSUE_HISTORY_SUFFIX);
}

/* Read-only classification of what is on disk. Never writes, never toasts
   on its own (get() toasts once per unreadable key, as for every key). */
export function readTissueHistory(email) {
  const key = tissueHistoryKey(email);
  let raw = null;
  try { raw = localStorage.getItem(key); } catch (e) { return { state: "unreadable", envelope: null, raw: null }; }
  if (raw == null) return { state: "absent", envelope: null, raw: null };
  let parsed;
  try { parsed = JSON.parse(raw); } catch (e) { return { state: "malformed", envelope: null, raw: raw }; }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return { state: "malformed", envelope: null, raw: raw };
  if (parsed.schemaVersion !== TISSUE_HISTORY_SCHEMA_VERSION) return { state: "unsupported", envelope: parsed, raw: raw };
  if (!Array.isArray(parsed.entries) || (parsed.detachedEntries !== undefined && !Array.isArray(parsed.detachedEntries))) return { state: "malformed", envelope: null, raw: raw };
  return { state: "ok", envelope: parsed, raw: raw };
}

/* The source must be readable for reconciliation to be meaningful: if
   `workoutLog` on disk is unparseable, App.js is holding the `[]` fallback
   and "reconciling" against it would delete every entry. */
function sourceIsReadable(email) {
  let raw = null;
  try { raw = localStorage.getItem(uKey(email, "workoutLog")); } catch (e) { return false; }
  if (raw == null) return true;
  try { return Array.isArray(JSON.parse(raw)); } catch (e) { return false; }
}

function compareEntries(a, b) {
  if (a.localDate !== b.localDate) return a.localDate < b.localDate ? -1 : 1;
  const fa = Number.isFinite(a.sourceFinishedAt) ? a.sourceFinishedAt : 0;
  const fb = Number.isFinite(b.sourceFinishedAt) ? b.sourceFinishedAt : 0;
  if (fa !== fb) return fa - fb;
  return a.sourceKey < b.sourceKey ? -1 : a.sourceKey > b.sourceKey ? 1 : 0;
}

/* Pure core: given the stored envelope (or null) and the source log,
   produce the next envelope plus a report. Exported so tests can drive it
   without storage. `now` is supplied by the caller. */
export function planReconciliation(envelope, workoutLog, profile, now) {
  const stored = envelope && Array.isArray(envelope.entries) ? envelope.entries : [];
  const owned = Object.create(null); // sourceKey → entry, current series only
  const foreign = [];    // other model/map series: preserved verbatim
  const malformed = [];  // unrecognisable entries: preserved verbatim, ignored
  let deduplicated = 0;
  stored.forEach(function (entry) {
    if (isCurrentSeriesEntry(entry)) {
      // Two owned entries for one source key would double-count. Keep the
      // first; the rest are derived duplicates of data that is still here.
      if (!Object.prototype.hasOwnProperty.call(owned, entry.sourceKey)) owned[entry.sourceKey] = entry;
      else deduplicated++;
    } else if (isValidHistoryEntry(entry)) foreign.push(entry);
    else malformed.push(entry);
  });

  const log = Array.isArray(workoutLog) ? workoutLog : [];
  const keys = indexSourceKeys(log);
  const fingerprints = log.map(session => sourceFingerprint(session));
  // Ordinals distinguish duplicates, but are not identity across a reorder.
  // Reserve unchanged matches for the entire log before rebuilding any edit.
  const group = key => key.slice(0, key.lastIndexOf("#"));
  const candidates = new Map();
  Object.values(owned).forEach(entry => {
    const id = JSON.stringify([group(entry.sourceKey), entry.sourceFingerprint]);
    if (!candidates.has(id)) candidates.set(id, { entries: [], cursor: 0 });
    candidates.get(id).entries.push(entry);
  });
  const used = new Set();
  const matches = keys.map((key, i) => {
    if (key === null) return null;
    const bucket = candidates.get(JSON.stringify([group(key), fingerprints[i]]));
    const match = bucket && bucket.entries[bucket.cursor++];
    if (match) used.add(match);
    return match || null;
  });
  const p = profile && typeof profile === "object" ? profile : {};
  const report = { created: 0, kept: 0, rebuilt: 0, removed: 0, undatable: 0, foreign: foreign.length, malformed: malformed.length, deduplicated: deduplicated };
  const next = [];
  const seen = {};

  log.forEach(function (session, i) {
    const key = keys[i];
    if (key === null) { report.undatable++; return; }
    seen[key] = true;
    const matched = matches[i];
    const existing = owned[key] && !used.has(owned[key]) ? owned[key] : null;
    if (matched) {
      report.kept++;
      next.push(matched.sourceKey === key ? matched : { ...matched, sourceKey: key });
      return;
    }
    let ordinal = 0;
    const hash = key.lastIndexOf("#");
    if (hash >= 0) ordinal = parseInt(key.slice(hash + 1), 10) || 0;
    const entry = materializeTissueHistoryEntry(session, {
      ordinal: ordinal,
      weightLog: p.weightLog,
      currentWeight: p.weight,
      materializedAt: now
    });
    if (!entry) { report.undatable++; return; }
    if (existing) report.rebuilt++; else report.created++;
    next.push(entry);
  });
  Object.keys(owned).forEach(function (key) { if (!seen[key]) report.removed++; });

  next.sort(compareEntries);
  // We understand v1 source identity even for an unsupported model. Retain
  // stale foreign records verbatim for recovery, outside the active series.
  const activeFingerprints = new Map(keys.map((key, i) => [key, fingerprints[i]]));
  const detached = [];
  const activeForeign = [];
  const retained = foreign.concat(envelope && Array.isArray(envelope.detachedEntries) ? envelope.detachedEntries : []);
  retained.forEach(entry => {
    if (isValidHistoryEntry(entry) && activeFingerprints.get(entry.sourceKey) === entry.sourceFingerprint) activeForeign.push(entry);
    else detached.push(entry);
  });
  const base = envelope && typeof envelope === "object" && !Array.isArray(envelope) ? envelope : {};
  const out = Object.assign({}, base, {
    schemaVersion: TISSUE_HISTORY_SCHEMA_VERSION,
    entries: next.concat(activeForeign, malformed)
  });
  if (detached.length || Object.prototype.hasOwnProperty.call(base, "detachedEntries")) out.detachedEntries = detached;
  return { envelope: out, entries: out.entries, report: report };
}

/* Application entry point.
 *
 *   { email, workoutLog, profile, now, persist, inMemoryReason }
 *
 * Returns the history the app should hold in memory this session, plus
 * how it relates to disk:
 *
 *   {
 *     schemaVersion, entries,               ← what the UI/analytics consume
 *     persisted: boolean,                   ← true only when disk now holds `entries`
 *     storageState: "unchanged" | "persisted" | "write_failed" | "in_memory"
 *                 | "malformed" | "unsupported" | "source_unreadable" | <inMemoryReason>,
 *     report: { created, kept, rebuilt, removed, undatable, foreign, malformed }
 *   }
 */
export function reconcileTissueHistory(options) {
  const opts = options || {};
  const email = opts.email;
  const now = Number.isFinite(opts.now) ? opts.now : null;
  const empty = { schemaVersion: TISSUE_HISTORY_SCHEMA_VERSION, entries: [], persisted: false, storageState: "no_profile",
    report: { created: 0, kept: 0, rebuilt: 0, removed: 0, undatable: 0, foreign: 0, malformed: 0, deduplicated: 0 } };
  if (!email) return empty;

  const stored = readTissueHistory(email);

  if (stored.state === "unsupported") {
    // Written by a newer build. Leave it exactly as it is; serve this
    // session from a fresh in-memory derivation that is never written.
    const planned = planReconciliation(null, opts.workoutLog, opts.profile, now);
    return { schemaVersion: TISSUE_HISTORY_SCHEMA_VERSION, entries: planned.entries, persisted: false, storageState: "unsupported", report: planned.report };
  }
  if (stored.state === "malformed" || stored.state === "unreadable") {
    // Unreadable bytes stay at their key (quarantineProfile() has already
    // copied them to <key>__corrupt). Nothing is written over them.
    const planned = planReconciliation(null, opts.workoutLog, opts.profile, now);
    return { schemaVersion: TISSUE_HISTORY_SCHEMA_VERSION, entries: planned.entries, persisted: false, storageState: stored.state, report: planned.report };
  }
  if (!Array.isArray(opts.workoutLog) || !sourceIsReadable(email)) {
    // The app is holding a fallback for workoutLog. Serve what was stored
    // and touch nothing.
    const entries = stored.envelope && Array.isArray(stored.envelope.entries) ? stored.envelope.entries : [];
    return { schemaVersion: TISSUE_HISTORY_SCHEMA_VERSION, entries: entries, persisted: false, storageState: "source_unreadable",
      report: { created: 0, kept: entries.length, rebuilt: 0, removed: 0, undatable: 0, foreign: 0, malformed: 0, deduplicated: 0 } };
  }

  const planned = planReconciliation(stored.envelope, opts.workoutLog, opts.profile, now);
  const result = { schemaVersion: TISSUE_HISTORY_SCHEMA_VERSION, entries: planned.entries, persisted: false, storageState: "in_memory", report: planned.report };

  if (opts.persist !== true) {
    result.storageState = typeof opts.inMemoryReason === "string" && opts.inMemoryReason ? opts.inMemoryReason : "in_memory";
    return result;
  }

  let payload;
  try { payload = JSON.stringify(planned.envelope); } catch (e) { result.storageState = "write_failed"; return result; }
  if (stored.state === "ok" && stored.raw === payload) {
    result.persisted = true;
    result.storageState = "unchanged";
    return result;
  }
  if (set(tissueHistoryKey(email), planned.envelope, { pruneOnQuota: false })) {
    result.persisted = true;
    result.storageState = "persisted";
  } else {
    result.storageState = "write_failed";
  }
  return result;
}

/* Read-only helper for tests/diagnostics: the entries currently on disk
   for a profile, or [] when absent/unreadable. Never writes. */
export function loadStoredTissueHistoryEntries(email) {
  const stored = readTissueHistory(email);
  return stored.state === "ok" && stored.envelope && Array.isArray(stored.envelope.entries) ? stored.envelope.entries : [];
}

// get() is imported so the module's read path shares the storage layer's
// once-per-key corrupt warning when a caller prefers a parsed read.
export function getTissueHistoryEnvelope(email) {
  return get(tissueHistoryKey(email), null);
}
