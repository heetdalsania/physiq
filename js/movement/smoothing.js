/* ─── Movement Assessment — temporal smoothing ─────────────────────────────
 *
 * Symmetric centred moving median over at most 5 samples.
 *
 * For sample i the window is the sample itself plus, for each offset
 * k = 1, 2, the PAIR (i − k, i + k) — included only when BOTH members are
 * valid and both lie within 300 ms of sample i. The window therefore always
 * holds 1, 3 or 5 values, arranged symmetrically in sample order around i.
 *
 * Why a median: pose landmarks jitter and occasionally jump for a single
 * frame; a median removes single-frame spikes without the blurring of a
 * mean and without an opaque temporal model.
 *
 * Why symmetric pairs: an off-centre window (at the ends of the trace or
 * beside a missing frame) biases every sloped segment towards one side,
 * which would shift the phase times derived from the trace. With symmetric
 * pairs a linear segment passes through unchanged even across gaps, so
 * smoothing adds no systematic time shift anywhere.
 *
 * Behaviour, all deterministic:
 *   - A sample that was not valid stays not valid. Smoothing never invents a
 *     value for a missing frame (no interpolation, no fill).
 *   - Timestamps are copied unchanged; output[i] belongs to input[i].
 *   - At the first/last sample the window is the sample alone; one step in,
 *     three samples. Spikes in the first or last two samples are therefore
 *     not removed (the protocol puts standing, not movement, there).
 *   - Pairs more than 300 ms away in time are excluded, so the window never
 *     reaches across a long gap in the data.
 *
 * Known effect: at a sharp turning point (the bottom of a squat with no
 * pause) a 5-sample median reports a minimum slightly above the single most
 * extreme raw sample. That is the price of rejecting one-frame spikes, and it
 * is why ROM is reported as an apparent, smoothed quantity.
 * ───────────────────────────────────────────────────────────────────────── */

import { median } from "./geometry.js";

export const SMOOTHING = Object.freeze({
  method: "symmetric_centered_moving_median",
  halfWindowSamples: 2,
  maxNeighborOffsetMs: 300
});

function isValidSample(s) {
  return !!s && s.state === "valid" && typeof s.value === "number" && Number.isFinite(s.value) &&
    typeof s.tMs === "number" && Number.isFinite(s.tMs);
}

/* samples: [{ tMs, value, state }] in time order.
   → [{ tMs, raw, value, state }] — `value` is the smoothed angle (or null),
     `raw` the unsmoothed one. */
export function smoothTrace(samples, options) {
  const opt = Object.assign({}, SMOOTHING, options || {});
  const input = samples || [];
  const usable = function (j, center) {
    return j >= 0 && j < input.length && isValidSample(input[j]) &&
      Math.abs(input[j].tMs - center.tMs) <= opt.maxNeighborOffsetMs;
  };
  return input.map(function (s, i) {
    if (!isValidSample(s)) {
      return { tMs: s ? s.tMs : null, raw: null, value: null, state: s && s.state ? s.state : "malformed" };
    }
    const window = [s.value];
    for (let k = 1; k <= opt.halfWindowSamples; k++) {
      if (usable(i - k, s) && usable(i + k, s)) window.push(input[i - k].value, input[i + k].value);
    }
    return { tMs: s.tMs, raw: s.value, value: median(window), state: "valid" };
  });
}
