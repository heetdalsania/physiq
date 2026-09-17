/* ─── PHYSIQ ENGINE — Optional per-set metadata (Milestone 2) ─────────────
 *
 * Pure helpers for the four OPTIONAL fields a performed workout set may
 * carry alongside `reps`, `weight` and `done`:
 *
 *   rir    integer 0..5            reps the lifter believes they had left
 *   side   "left"|"right"|"bilateral"
 *   tempo  { eccentricSeconds?, pauseSeconds?, concentricSeconds? }
 *          whole seconds 0..30 per phase, each phase optional
 *   rom    "partial"|"standard"|"full"
 *
 * Everything here is USER-REPORTED. RIR is a subjective estimate, side is
 * what the user chose (never inferred from the exercise name), tempo is
 * the seconds the user typed, and ROM is a self-assessed category — not a
 * measured joint angle. No biomechanics assumptions live in this file and
 * the tissue-load model does not read any of these fields (see
 * js/tissue/loadEngine.js, "Inputs used").
 *
 * ── Missing means missing ────────────────────────────────────────────────
 * A field the user never entered is ABSENT from the set object. `0` is a
 * recorded value (RIR 0 = nothing left; pause 0 = no pause), so absence is
 * never encoded as 0, null, "" or {}. Clearing a field deletes the key;
 * clearing the last tempo phase deletes `tempo` itself. Old sets that have
 * none of these keys are never rewritten to add defaults.
 *
 * ── Malformed stored values ──────────────────────────────────────────────
 * readSetMetadata() is the tolerant reader used for display: anything that
 * fails validation is reported as `undefined` (unavailable) and the stored
 * bytes are left alone. The write path (setSetMetadataField) only ever
 * emits validated values, and an edit to a field replaces that field's
 * stored value — valid or not — with the validated one.
 *
 * No React, no DOM, no storage, no clock. Inputs are never mutated.
 * ───────────────────────────────────────────────────────────────────────── */

export const SET_METADATA_FIELDS = Object.freeze(["rir", "side", "tempo", "rom"]);
/* The fields that live behind the per-set "details" disclosure in the UI
   (RIR has its own visible control). */
export const SET_DETAIL_FIELDS = Object.freeze(["side", "tempo", "rom"]);

export const RIR_MIN = 0;
export const RIR_MAX = 5;

export const SIDE_VALUES = Object.freeze(["left", "right", "bilateral"]);
export const SIDE_LABELS = Object.freeze({
  left: "Left",
  right: "Right",
  bilateral: "Both sides"
});

export const ROM_VALUES = Object.freeze(["partial", "standard", "full"]);
export const ROM_LABELS = Object.freeze({
  partial: "Partial",
  standard: "Standard",
  full: "Full"
});
/* Short explanatory text. Deliberately vague: these are the lifter's own
   categories, not calibrated joint-angle boundaries. */
export const ROM_HINTS = Object.freeze({
  partial: "Deliberately shortened range",
  standard: "Your usual range for this lift",
  full: "As deep or as far as you can go"
});

/* Tempo phases, in the order they are recorded and displayed. */
export const TEMPO_PHASES = Object.freeze(["eccentricSeconds", "pauseSeconds", "concentricSeconds"]);
export const TEMPO_PHASE_LABELS = Object.freeze({
  eccentricSeconds: "Eccentric (lowering)",
  pauseSeconds: "Pause (after lowering)",
  concentricSeconds: "Concentric (lifting)"
});
export const TEMPO_PHASE_SHORT = Object.freeze({
  eccentricSeconds: "Ecc",
  pauseSeconds: "Pause",
  concentricSeconds: "Con"
});
export const TEMPO_MIN_SECONDS = 0;
export const TEMPO_MAX_SECONDS = 30;   // product input bound, not a physiological range

// ── Validation of already-typed values ──────────────────────────────────

function isPlainObject(v) {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

function isIntegerInRange(v, min, max) {
  return typeof v === "number" && Number.isInteger(v) && v >= min && v <= max;
}

export function isValidRir(v) {
  return isIntegerInRange(v, RIR_MIN, RIR_MAX);
}

export function isValidTempoSeconds(v) {
  return isIntegerInRange(v, TEMPO_MIN_SECONDS, TEMPO_MAX_SECONDS);
}

export function isValidSide(v) {
  return typeof v === "string" && SIDE_VALUES.indexOf(v) >= 0;
}

export function isValidRom(v) {
  return typeof v === "string" && ROM_VALUES.indexOf(v) >= 0;
}

/* A tempo is valid when it is a plain object whose KNOWN phases are all
   valid and at least one known phase is present. Unknown keys are ignored
   for validity (and preserved by the write path). */
export function isValidTempo(t) {
  if (!isPlainObject(t)) return false;
  let known = 0;
  for (let i = 0; i < TEMPO_PHASES.length; i++) {
    const phase = TEMPO_PHASES[i];
    if (!Object.prototype.hasOwnProperty.call(t, phase)) continue;
    if (!isValidTempoSeconds(t[phase])) return false;
    known++;
  }
  return known > 0;
}

// ── Parsing of raw interactive input ─────────────────────────────────────
//
// Every parser returns { ok: true, value } where `value` is `undefined` for
// blank/unset input, or { ok: false, error } with a short user-facing
// message. Blank is decided BEFORE any numeric conversion so that
// Number("") can never turn "unknown" into 0.

function isBlank(raw) {
  return raw === undefined || raw === null || (typeof raw === "string" && raw.trim() === "");
}

const INTEGER_RE = /^[+-]?\d+$/;

/* Whole-number parser shared by RIR and tempo. Accepts a number or a
   numeric string; rejects fractions, non-finite values, booleans, objects,
   and partially numeric junk like "2abc". Never rounds or clamps. */
function parseWholeNumber(raw, min, max, label) {
  if (isBlank(raw)) return { ok: true, value: undefined };
  let n;
  if (typeof raw === "number") {
    n = raw;
  } else if (typeof raw === "string") {
    const s = raw.trim();
    if (!INTEGER_RE.test(s)) {
      return { ok: false, error: label + " must be a whole number" + rangeText(min, max) };
    }
    n = Number(s);
  } else {
    return { ok: false, error: label + " must be a whole number" + rangeText(min, max) };
  }
  if (!Number.isFinite(n) || !Number.isInteger(n)) {
    return { ok: false, error: label + " must be a whole number" + rangeText(min, max) };
  }
  if (n < min || n > max) {
    return { ok: false, error: label + " must be between " + min + " and " + max };
  }
  return { ok: true, value: n };
}

function rangeText(min, max) {
  return " (" + min + "–" + max + ")";
}

export function parseRirInput(raw) {
  return parseWholeNumber(raw, RIR_MIN, RIR_MAX, "RIR");
}

export function parseTempoSecondsInput(raw, phase) {
  const label = (phase && TEMPO_PHASE_LABELS[phase]) ? TEMPO_PHASE_LABELS[phase] + " seconds" : "Tempo seconds";
  return parseWholeNumber(raw, TEMPO_MIN_SECONDS, TEMPO_MAX_SECONDS, label);
}

function parseEnumInput(raw, values, label) {
  if (isBlank(raw)) return { ok: true, value: undefined };
  if (typeof raw !== "string" || values.indexOf(raw) < 0) {
    return { ok: false, error: label + " must be one of: " + values.join(", ") };
  }
  return { ok: true, value: raw };
}

export function parseSideInput(raw) {
  return parseEnumInput(raw, SIDE_VALUES, "Side");
}

export function parseRomInput(raw) {
  return parseEnumInput(raw, ROM_VALUES, "Range of motion");
}

/* Field paths accepted by parseMetadataInput / setSetMetadataField:
   "rir", "side", "rom", "tempo.eccentricSeconds", "tempo.pauseSeconds",
   "tempo.concentricSeconds". */
export function isTempoFieldPath(field) {
  return typeof field === "string" && field.indexOf("tempo.") === 0 &&
    TEMPO_PHASES.indexOf(field.slice("tempo.".length)) >= 0;
}

export function parseMetadataInput(field, raw) {
  if (field === "rir") return parseRirInput(raw);
  if (field === "side") return parseSideInput(raw);
  if (field === "rom") return parseRomInput(raw);
  if (isTempoFieldPath(field)) return parseTempoSecondsInput(raw, field.slice("tempo.".length));
  return { ok: false, error: "Unknown set metadata field: " + String(field) };
}

// ── Tolerant reading ─────────────────────────────────────────────────────

/* The tolerant reader. Returns { rir, side, tempo, rom } where each member
   is either a validated value or `undefined`. A tempo whose known phases
   are partly invalid is returned with only its valid phases; a tempo with
   no valid phase is `undefined`. Never throws, never mutates. */
export function readSetMetadata(set) {
  const out = { rir: undefined, side: undefined, tempo: undefined, rom: undefined };
  if (!isPlainObject(set)) return out;
  if (isValidRir(set.rir)) out.rir = set.rir;
  if (isValidSide(set.side)) out.side = set.side;
  if (isValidRom(set.rom)) out.rom = set.rom;
  if (isPlainObject(set.tempo)) {
    const t = {};
    let any = false;
    TEMPO_PHASES.forEach(function(phase) {
      if (isValidTempoSeconds(set.tempo[phase])) { t[phase] = set.tempo[phase]; any = true; }
    });
    if (any) out.tempo = t;
  }
  return out;
}

export function hasSetMetadata(set) {
  const m = readSetMetadata(set);
  return m.rir !== undefined || m.side !== undefined || m.tempo !== undefined || m.rom !== undefined;
}

// ── Immutable updates ────────────────────────────────────────────────────

/* Returns a new set with `field` set to `value`, or with the field removed
   when `value` is undefined. All other keys of the set — including ones
   this module knows nothing about — are carried over. `tempo` is always
   rebuilt as a fresh object so two sets can never share one. Throws on an
   invalid value or field: callers are expected to parse first. */
export function setSetMetadataField(set, field, value) {
  const base = isPlainObject(set) ? set : {};
  const next = Object.assign({}, base);

  if (field === "rir" || field === "side" || field === "rom") {
    if (value === undefined) {
      delete next[field];
      return next;
    }
    const valid = field === "rir" ? isValidRir(value) : field === "side" ? isValidSide(value) : isValidRom(value);
    if (!valid) throw new TypeError("Invalid " + field + " value: " + JSON.stringify(value));
    next[field] = value;
    return next;
  }

  if (isTempoFieldPath(field)) {
    const phase = field.slice("tempo.".length);
    if (value !== undefined && !isValidTempoSeconds(value)) {
      throw new TypeError("Invalid " + field + " value: " + JSON.stringify(value));
    }
    const tempo = rebuildTempo(base.tempo);
    if (value === undefined) delete tempo[phase]; else tempo[phase] = value;
    if (tempoHasKnownPhase(tempo)) next.tempo = tempo; else delete next.tempo;
    return next;
  }

  throw new TypeError("Unknown set metadata field: " + String(field));
}

/* Fresh tempo object: unknown keys copied, known phases kept only when
   valid (so an edit never re-persists a malformed phase). */
function rebuildTempo(tempo) {
  const out = {};
  if (!isPlainObject(tempo)) return out;
  Object.keys(tempo).forEach(function(k) {
    if (TEMPO_PHASES.indexOf(k) >= 0) {
      if (isValidTempoSeconds(tempo[k])) out[k] = tempo[k];
    } else {
      out[k] = tempo[k];
    }
  });
  return out;
}

function tempoHasKnownPhase(tempo) {
  return TEMPO_PHASES.some(function(p) { return Object.prototype.hasOwnProperty.call(tempo, p); });
}

/* Returns a new set with all four metadata keys removed. Other keys stay. */
export function clearSetMetadata(set) {
  const base = isPlainObject(set) ? set : {};
  const next = Object.assign({}, base);
  SET_METADATA_FIELDS.forEach(function(f) { delete next[f]; });
  return next;
}

/* Returns a new set with side / tempo / rom removed; rir and everything
   else stay. */
export function clearSetDetails(set) {
  const base = isPlainObject(set) ? set : {};
  const next = Object.assign({}, base);
  SET_DETAIL_FIELDS.forEach(function(f) { delete next[f]; });
  return next;
}

/* True when the set carries any readable side / tempo / rom value. */
export function hasSetDetails(set) {
  const m = readSetMetadata(set);
  return m.side !== undefined || m.tempo !== undefined || m.rom !== undefined;
}

/* Parse raw input and, when valid, apply it. Returns
   { ok: true, set } or { ok: false, error, set } where `set` is the
   original, untouched set on failure. */
export function applyMetadataInput(set, field, raw) {
  const parsed = parseMetadataInput(field, raw);
  if (!parsed.ok) return { ok: false, error: parsed.error, set: set };
  return { ok: true, set: setSetMetadataField(set, field, parsed.value) };
}

// ── Display ──────────────────────────────────────────────────────────────

/* "3-1-1" style, phases in eccentric / pause / concentric order; a phase
   the user left blank renders as "–" so "3-–-1" is distinguishable from
   "3-0-1". Returns null when no phase is valid. */
export function formatTempo(tempo) {
  const m = readSetMetadata({ tempo: tempo }).tempo;
  if (!m) return null;
  return TEMPO_PHASES.map(function(p) {
    return m[p] === undefined ? "–" : String(m[p]);
  }).join("-") + "s";
}

/* Compact one-line summary for history views, e.g.
   "RIR 2 · Left · Tempo 3-1-1s · Full ROM". Null when the set carries no
   readable metadata, so callers can simply hide it. */
export function formatSetMetadataSummary(set) {
  const m = readSetMetadata(set);
  const parts = [];
  if (m.rir !== undefined) parts.push("RIR " + m.rir);
  if (m.side !== undefined) parts.push(SIDE_LABELS[m.side]);
  if (m.tempo !== undefined) parts.push("Tempo " + formatTempo(m.tempo));
  if (m.rom !== undefined) parts.push(ROM_LABELS[m.rom] + " ROM");
  return parts.length ? parts.join(" · ") : null;
}

/* The string an <input>/<select> should show for a stored value:
   "" when absent or unreadable. */
export function metadataFieldInputValue(set, field) {
  const m = readSetMetadata(set);
  if (field === "rir") return m.rir === undefined ? "" : String(m.rir);
  if (field === "side") return m.side === undefined ? "" : m.side;
  if (field === "rom") return m.rom === undefined ? "" : m.rom;
  if (isTempoFieldPath(field)) {
    const phase = field.slice("tempo.".length);
    return m.tempo && m.tempo[phase] !== undefined ? String(m.tempo[phase]) : "";
  }
  return "";
}
