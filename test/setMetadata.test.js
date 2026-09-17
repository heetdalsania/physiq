/* ─── Tests — optional per-set metadata contract (Milestone 2) ────────────
 *
 * Pure-module coverage for js/utils/setMetadata.js: parsing of raw
 * interactive input, validation boundaries, immutable updates, nested
 * tempo independence, tolerant reading of malformed stored values, and
 * display formatting. Synthetic values only.
 * ───────────────────────────────────────────────────────────────────────── */

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  SET_METADATA_FIELDS, RIR_MIN, RIR_MAX,
  SIDE_VALUES, ROM_VALUES, TEMPO_PHASES, TEMPO_MIN_SECONDS, TEMPO_MAX_SECONDS,
  isValidRir, isValidTempoSeconds, isValidSide, isValidRom, isValidTempo,
  parseRirInput, parseTempoSecondsInput, parseSideInput, parseRomInput, parseMetadataInput,
  readSetMetadata, hasSetMetadata,
  setSetMetadataField, clearSetMetadata, clearSetDetails, hasSetDetails, SET_DETAIL_FIELDS, applyMetadataInput,
  formatTempo, formatSetMetadataSummary, metadataFieldInputValue
} from "../js/utils/setMetadata.js";

function clone(x) { return JSON.parse(JSON.stringify(x)); }
function frozenDeep(x) {
  if (x && typeof x === "object") { Object.keys(x).forEach(function(k) { frozenDeep(x[k]); }); Object.freeze(x); }
  return x;
}

// ── contract constants ──────────────────────────────────────────────────

test("the contract is exactly rir / side / tempo / rom with the agreed value sets", function() {
  assert.deepEqual(SET_METADATA_FIELDS.slice(), ["rir", "side", "tempo", "rom"]);
  assert.equal(RIR_MIN, 0); assert.equal(RIR_MAX, 5);
  assert.deepEqual(SIDE_VALUES.slice(), ["left", "right", "bilateral"]);
  assert.deepEqual(ROM_VALUES.slice(), ["partial", "standard", "full"]);
  assert.deepEqual(TEMPO_PHASES.slice(), ["eccentricSeconds", "pauseSeconds", "concentricSeconds"]);
  assert.equal(TEMPO_MIN_SECONDS, 0); assert.equal(TEMPO_MAX_SECONDS, 30);
});

// ── validation of typed values ──────────────────────────────────────────

test("RIR accepts integers 0..5 and nothing else", function() {
  [0, 1, 2, 3, 4, 5].forEach(function(v) { assert.equal(isValidRir(v), true, "rir " + v); });
  [-1, 6, 2.5, NaN, Infinity, -Infinity, "2", true, false, null, undefined, [2], { v: 2 }]
    .forEach(function(v) { assert.equal(isValidRir(v), false, "rir " + String(v)); });
});

test("tempo seconds accept whole numbers 0..30 and nothing else", function() {
  [0, 1, 15, 30].forEach(function(v) { assert.equal(isValidTempoSeconds(v), true); });
  [-1, 31, 0.5, 3.0000001, NaN, Infinity, "3", true, null, undefined, [], {}]
    .forEach(function(v) { assert.equal(isValidTempoSeconds(v), false, String(v)); });
});

test("side and rom accept only their enumerations", function() {
  SIDE_VALUES.forEach(function(v) { assert.equal(isValidSide(v), true); });
  ROM_VALUES.forEach(function(v) { assert.equal(isValidRom(v), true); });
  ["Left", "both", "", " left", 1, null, undefined, {}].forEach(function(v) {
    assert.equal(isValidSide(v), false, String(v));
    assert.equal(isValidRom(v), false, String(v));
  });
});

test("a tempo object needs at least one valid known phase; unknown keys do not count", function() {
  assert.equal(isValidTempo({ eccentricSeconds: 3 }), true);
  assert.equal(isValidTempo({ eccentricSeconds: 3, pauseSeconds: 0, concentricSeconds: 1 }), true);
  assert.equal(isValidTempo({}), false);
  assert.equal(isValidTempo({ other: 3 }), false);
  assert.equal(isValidTempo({ eccentricSeconds: 3, pauseSeconds: "1" }), false);
  assert.equal(isValidTempo({ eccentricSeconds: 31 }), false);
  assert.equal(isValidTempo([3, 1, 1]), false);
  assert.equal(isValidTempo("3-1-1"), false);
  assert.equal(isValidTempo(null), false);
});

// ── parsing raw input ───────────────────────────────────────────────────

test("blank input is 'unknown', decided before any numeric conversion", function() {
  ["", "   ", null, undefined].forEach(function(raw) {
    const r = parseRirInput(raw);
    assert.deepEqual(r, { ok: true, value: undefined }, "rir blank " + JSON.stringify(raw));
    assert.notEqual(r.value, 0, "blank must never become 0");
    assert.deepEqual(parseTempoSecondsInput(raw, "pauseSeconds"), { ok: true, value: undefined });
    assert.deepEqual(parseSideInput(raw), { ok: true, value: undefined });
    assert.deepEqual(parseRomInput(raw), { ok: true, value: undefined });
  });
});

test("RIR parsing: boundaries pass, fractions / junk / out-of-range fail without rounding or clamping", function() {
  assert.deepEqual(parseRirInput("0"), { ok: true, value: 0 });
  assert.deepEqual(parseRirInput("5"), { ok: true, value: 5 });
  assert.deepEqual(parseRirInput(" 3 "), { ok: true, value: 3 });
  assert.deepEqual(parseRirInput(4), { ok: true, value: 4 });
  ["2.5", "2abc", "abc", "1e1", "0x2", "-1", "6", "99", "2 3", "two"].forEach(function(raw) {
    const r = parseRirInput(raw);
    assert.equal(r.ok, false, "should reject " + JSON.stringify(raw));
    assert.equal(typeof r.error, "string");
    assert.ok(r.error.length > 0);
    assert.equal("value" in r, false, "no value on failure");
  });
  [2.5, 7, -0.5, NaN, Infinity, true, false, [2], { v: 2 }].forEach(function(raw) {
    assert.equal(parseRirInput(raw).ok, false, "should reject " + String(raw));
  });
});

test("tempo parsing: explicit zero is a recorded zero; 30 is in, 31 is out; junk fails", function() {
  assert.deepEqual(parseTempoSecondsInput("0", "pauseSeconds"), { ok: true, value: 0 });
  assert.deepEqual(parseTempoSecondsInput("30", "eccentricSeconds"), { ok: true, value: 30 });
  assert.equal(parseTempoSecondsInput("31", "eccentricSeconds").ok, false);
  assert.equal(parseTempoSecondsInput("-1", "eccentricSeconds").ok, false);
  assert.equal(parseTempoSecondsInput("1.5", "eccentricSeconds").ok, false);
  assert.equal(parseTempoSecondsInput("X", "concentricSeconds").ok, false, "'X' is not interpreted as 0");
  assert.equal(parseTempoSecondsInput("3-1-1", "eccentricSeconds").ok, false, "no four-part string parsing");
  assert.equal(parseTempoSecondsInput("3abc", "eccentricSeconds").ok, false);
  // The message names the phase so the error is attributable.
  assert.match(parseTempoSecondsInput("40", "pauseSeconds").error, /Pause/);
});

test("enum parsing rejects case variants and unsupported values", function() {
  assert.deepEqual(parseSideInput("left"), { ok: true, value: "left" });
  assert.deepEqual(parseRomInput("standard"), { ok: true, value: "standard" });
  assert.equal(parseSideInput("Left").ok, false);
  assert.equal(parseSideInput("unilateral").ok, false);
  assert.equal(parseRomInput("FULL").ok, false);
  assert.equal(parseRomInput(1).ok, false);
});

test("parseMetadataInput routes by field path and rejects unknown paths", function() {
  assert.deepEqual(parseMetadataInput("rir", "2"), { ok: true, value: 2 });
  assert.deepEqual(parseMetadataInput("side", "right"), { ok: true, value: "right" });
  assert.deepEqual(parseMetadataInput("rom", "partial"), { ok: true, value: "partial" });
  assert.deepEqual(parseMetadataInput("tempo.concentricSeconds", "1"), { ok: true, value: 1 });
  assert.equal(parseMetadataInput("tempo.bogus", "1").ok, false);
  assert.equal(parseMetadataInput("rpe", "8").ok, false);
  assert.equal(parseMetadataInput("weight", "100").ok, false);
});

// ── immutable updates ───────────────────────────────────────────────────

test("setting a field returns a new set; the source is never mutated", function() {
  const src = frozenDeep({ reps: 8, weight: 135, done: true, note: "keep me" });
  const next = setSetMetadataField(src, "rir", 2);
  assert.notEqual(next, src);
  assert.deepEqual(next, { reps: 8, weight: 135, done: true, note: "keep me", rir: 2 });
  assert.deepEqual(src, { reps: 8, weight: 135, done: true, note: "keep me" });
});

test("editing one field preserves the others and unknown record fields", function() {
  let s = { reps: 5, weight: 225, done: false, custom: { nested: true } };
  s = setSetMetadataField(s, "rir", 1);
  s = setSetMetadataField(s, "side", "left");
  s = setSetMetadataField(s, "tempo.eccentricSeconds", 3);
  s = setSetMetadataField(s, "rom", "full");
  s = setSetMetadataField(s, "rir", 4);   // change one
  assert.deepEqual(s, {
    reps: 5, weight: 225, done: false, custom: { nested: true },
    rir: 4, side: "left", tempo: { eccentricSeconds: 3 }, rom: "full"
  });
});

test("clearing uses absence: no null, 0, '' or {} is left behind", function() {
  let s = { reps: 5, weight: 225, done: true, rir: 3, side: "right", rom: "partial",
            tempo: { eccentricSeconds: 3, pauseSeconds: 1, concentricSeconds: 1 } };
  s = setSetMetadataField(s, "rir", undefined);
  assert.equal("rir" in s, false);
  s = setSetMetadataField(s, "side", undefined);
  assert.equal("side" in s, false);
  s = setSetMetadataField(s, "rom", undefined);
  assert.equal("rom" in s, false);
  s = setSetMetadataField(s, "tempo.eccentricSeconds", undefined);
  assert.deepEqual(s.tempo, { pauseSeconds: 1, concentricSeconds: 1 });
  s = setSetMetadataField(s, "tempo.pauseSeconds", undefined);
  s = setSetMetadataField(s, "tempo.concentricSeconds", undefined);
  assert.equal("tempo" in s, false, "tempo removed once every phase is cleared");
  assert.deepEqual(s, { reps: 5, weight: 225, done: true });
});

test("explicit tempo zero survives as 0 and is distinct from a cleared phase", function() {
  const s = setSetMetadataField({ reps: 1, weight: 1, done: true }, "tempo.pauseSeconds", 0);
  assert.deepEqual(s.tempo, { pauseSeconds: 0 });
  assert.equal(hasSetMetadata(s), true);
  const cleared = setSetMetadataField(s, "tempo.pauseSeconds", undefined);
  assert.equal("tempo" in cleared, false);
});

test("clearSetMetadata drops all four keys and nothing else", function() {
  const src = { reps: 8, weight: 100, done: true, rir: 2, side: "left", rom: "full",
                tempo: { eccentricSeconds: 2 }, extra: 1 };
  const out = clearSetMetadata(src);
  assert.deepEqual(out, { reps: 8, weight: 100, done: true, extra: 1 });
  assert.deepEqual(src.tempo, { eccentricSeconds: 2 }, "source untouched");
});

test("clearSetDetails drops side / tempo / rom only; hasSetDetails ignores rir", function() {
  assert.deepEqual(SET_DETAIL_FIELDS.slice(), ["side", "tempo", "rom"]);
  const src = { reps: 8, weight: 100, done: true, rir: 2, side: "left", rom: "full", tempo: { eccentricSeconds: 2 }, extra: 1 };
  assert.deepEqual(clearSetDetails(src), { reps: 8, weight: 100, done: true, rir: 2, extra: 1 });
  assert.equal(hasSetDetails(src), true);
  assert.equal(hasSetDetails({ rir: 2 }), false);
  assert.equal(hasSetDetails({ tempo: { pauseSeconds: 0 } }), true);
  assert.equal(hasSetDetails({ side: "Left" }), false, "malformed does not count");
});

test("invalid values throw instead of being persisted", function() {
  const s = { reps: 1, weight: 1, done: true };
  assert.throws(function() { setSetMetadataField(s, "rir", 6); }, TypeError);
  assert.throws(function() { setSetMetadataField(s, "rir", 2.5); }, TypeError);
  assert.throws(function() { setSetMetadataField(s, "rir", "2"); }, TypeError);
  assert.throws(function() { setSetMetadataField(s, "side", "both"); }, TypeError);
  assert.throws(function() { setSetMetadataField(s, "rom", ""); }, TypeError);
  assert.throws(function() { setSetMetadataField(s, "tempo.eccentricSeconds", 31); }, TypeError);
  assert.throws(function() { setSetMetadataField(s, "tempo.nope", 1); }, TypeError);
  assert.throws(function() { setSetMetadataField(s, "rpe", 8); }, TypeError);
});

test("applyMetadataInput returns the untouched set on invalid input", function() {
  const s = frozenDeep({ reps: 1, weight: 1, done: true, rir: 3 });
  const bad = applyMetadataInput(s, "rir", "2abc");
  assert.equal(bad.ok, false);
  assert.equal(bad.set, s, "prior valid value is not replaced");
  assert.equal(typeof bad.error, "string");
  const good = applyMetadataInput(s, "rir", "");
  assert.equal(good.ok, true);
  assert.equal("rir" in good.set, false, "blank clears");
});

// ── nested-object independence ──────────────────────────────────────────

test("tempo objects are never shared between sets", function() {
  const a = setSetMetadataField({ reps: 1, weight: 1, done: true }, "tempo.eccentricSeconds", 3);
  const b = setSetMetadataField(a, "tempo.pauseSeconds", 1);
  assert.notEqual(a.tempo, b.tempo);
  assert.deepEqual(a.tempo, { eccentricSeconds: 3 });
  assert.deepEqual(b.tempo, { eccentricSeconds: 3, pauseSeconds: 1 });

  // A set copied with Object.assign would alias tempo; the write path
  // still produces a fresh object on the next edit.
  const shallow = Object.assign({}, b);
  assert.equal(shallow.tempo, b.tempo, "precondition: shallow copy aliases");
  const edited = setSetMetadataField(shallow, "tempo.concentricSeconds", 2);
  assert.notEqual(edited.tempo, b.tempo);
  assert.deepEqual(b.tempo, { eccentricSeconds: 3, pauseSeconds: 1 }, "original tempo untouched");
});

test("unknown keys inside tempo are carried over; malformed known phases are dropped on edit", function() {
  const s = { reps: 1, weight: 1, done: true, tempo: { eccentricSeconds: "3", pauseSeconds: 1, vendor: "x" } };
  const out = setSetMetadataField(s, "tempo.concentricSeconds", 2);
  assert.deepEqual(out.tempo, { pauseSeconds: 1, vendor: "x", concentricSeconds: 2 });
  assert.deepEqual(s.tempo, { eccentricSeconds: "3", pauseSeconds: 1, vendor: "x" }, "source untouched");
});

// ── tolerant reading ────────────────────────────────────────────────────

test("readSetMetadata reports missing fields as undefined and never invents defaults", function() {
  const legacy = frozenDeep({ reps: 8, weight: 135, done: true });
  assert.deepEqual(readSetMetadata(legacy), { rir: undefined, side: undefined, tempo: undefined, rom: undefined });
  assert.equal(hasSetMetadata(legacy), false);
  assert.deepEqual(readSetMetadata(null), { rir: undefined, side: undefined, tempo: undefined, rom: undefined });
  assert.deepEqual(readSetMetadata("junk"), { rir: undefined, side: undefined, tempo: undefined, rom: undefined });
});

test("malformed stored values read as unavailable, field by field, without throwing", function() {
  const bad = frozenDeep({
    reps: 8, weight: 135, done: true,
    rir: "2", side: "Left", rom: 3,
    tempo: { eccentricSeconds: 3, pauseSeconds: "x", concentricSeconds: 99 }
  });
  const m = readSetMetadata(bad);
  assert.equal(m.rir, undefined);
  assert.equal(m.side, undefined);
  assert.equal(m.rom, undefined);
  assert.deepEqual(m.tempo, { eccentricSeconds: 3 }, "only the valid phase survives");
  assert.equal(hasSetMetadata(bad), true);
  assert.equal(hasSetMetadata({ rir: null, side: "", tempo: {}, rom: 0 }), false);
  assert.equal(hasSetMetadata({ tempo: [3, 1, 1] }), false);
  assert.equal(hasSetMetadata({ rir: 2.5 }), false);
  assert.equal(hasSetMetadata({ rir: true }), false);
});

test("readSetMetadata returns fresh objects — callers cannot reach the stored tempo", function() {
  const s = { tempo: { eccentricSeconds: 3 } };
  const m = readSetMetadata(s);
  assert.notEqual(m.tempo, s.tempo);
});

// ── display ─────────────────────────────────────────────────────────────

test("formatTempo shows phases in eccentric-pause-concentric order, blanks as dashes", function() {
  assert.equal(formatTempo({ eccentricSeconds: 3, pauseSeconds: 1, concentricSeconds: 1 }), "3-1-1s");
  assert.equal(formatTempo({ eccentricSeconds: 4 }), "4-–-–s");
  assert.equal(formatTempo({ eccentricSeconds: 2, pauseSeconds: 0, concentricSeconds: 1 }), "2-0-1s");
  assert.equal(formatTempo({ concentricSeconds: 2 }), "–-–-2s");
  assert.equal(formatTempo({}), null);
  assert.equal(formatTempo(undefined), null);
  assert.equal(formatTempo("3-1-1"), null);
});

test("formatSetMetadataSummary is compact and null when nothing is set", function() {
  assert.equal(formatSetMetadataSummary({ reps: 8, weight: 135, done: true }), null);
  assert.equal(formatSetMetadataSummary({ rir: 2 }), "RIR 2");
  assert.equal(formatSetMetadataSummary({ rir: 0 }), "RIR 0", "zero is shown, not hidden");
  assert.equal(formatSetMetadataSummary({ side: "left" }), "Left");
  assert.equal(formatSetMetadataSummary({ side: "bilateral" }), "Both sides");
  assert.equal(formatSetMetadataSummary({ rom: "partial" }), "Partial ROM");
  assert.equal(
    formatSetMetadataSummary({ rir: 5, side: "right", tempo: { eccentricSeconds: 3, pauseSeconds: 1, concentricSeconds: 1 }, rom: "full" }),
    "RIR 5 · Right · Tempo 3-1-1s · Full ROM"
  );
  assert.equal(formatSetMetadataSummary({ rir: "junk", side: "Left" }), null, "malformed → hidden");
});

test("metadataFieldInputValue maps stored values to control values, '' when absent", function() {
  const s = { rir: 0, side: "left", tempo: { pauseSeconds: 0 } };
  assert.equal(metadataFieldInputValue(s, "rir"), "0");
  assert.equal(metadataFieldInputValue(s, "side"), "left");
  assert.equal(metadataFieldInputValue(s, "rom"), "");
  assert.equal(metadataFieldInputValue(s, "tempo.pauseSeconds"), "0");
  assert.equal(metadataFieldInputValue(s, "tempo.eccentricSeconds"), "");
  assert.equal(metadataFieldInputValue({ rir: "2" }, "rir"), "", "malformed shows as unset");
  assert.equal(metadataFieldInputValue({}, "bogus"), "");
});

test("a JSON round-trip of a fully populated set is lossless", function() {
  const s = { reps: 5, weight: 185, done: true, rir: 5, side: "bilateral",
              tempo: { eccentricSeconds: 3, pauseSeconds: 1, concentricSeconds: 1 }, rom: "full" };
  assert.deepEqual(clone(s), s);
  assert.deepEqual(readSetMetadata(clone(s)), readSetMetadata(s));
});
