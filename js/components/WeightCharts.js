/* ─── PHYSIQ ENGINE — Weight Tracking Charts ─────────────────────────────── */
/* Two strictly-separate charts:
     1. ActualWeightChart  — driven only by user-entered weightLog entries.
                             Never reads or merges estimated data.
     2. EstimatedWeightChangeChart — cumulative projection from calendar
                                     calorie data vs maintenance. Never
                                     reads or merges actual weight data.
   When required inputs are missing each chart renders a neutral fallback
   instead of fabricating numbers. */

import React from "react";
import { WeightProjection as WP } from "../utils/weightProjection.js";

function fmtDate(d) {
  return d.toLocaleDateString([], { month: "short", day: "numeric" });
}
function fmtDelta(v) {
  if (typeof v !== "number" || isNaN(v)) return "—";
  const s = v >= 0 ? "+" : "";
  return s + v.toFixed(1);
}

function LinePlot(props) {
  const points = props.points;
  const color = props.color || "var(--blue)";
  const height = props.height || 110;
  const fillBaseline = props.fillBaseline;
  const pad = 8;
  const w = 300;
  const h = height;

  if (!points || points.length === 0) return null;

  let ys = points.map(function(p) { return p.y; });
  if (typeof fillBaseline === "number") ys = ys.concat([fillBaseline]);
  let maxY = Math.max.apply(null, ys);
  const minY = Math.min.apply(null, ys);
  if (maxY === minY) { maxY = minY + 1; }
  const range = maxY - minY;

  function px(p) {
    const x = pad + p.x * (w - 2 * pad);
    const y = pad + (maxY - p.y) / range * (h - 2 * pad);
    return { x: x, y: y };
  }

  const solidSegs = [];
  let cur = [];
  points.forEach(function(p) {
    if (p.dim) {
      if (cur.length > 1) solidSegs.push(cur);
      cur = [];
    } else {
      cur.push(p);
    }
  });
  if (cur.length > 1) solidSegs.push(cur);

  const allPath = points.map(function(p) {
    const c = px(p);
    return c.x + "," + c.y;
  }).join(" ");

  let zeroY = null;
  if (typeof fillBaseline === "number") {
    zeroY = pad + (maxY - fillBaseline) / range * (h - 2 * pad);
  }

  return (
    <svg viewBox={"0 0 " + w + " " + (h + 22)} style={{ width: "100%", height: "auto" }}>
      {zeroY !== null && (
        <line x1={pad} y1={zeroY} x2={w - pad} y2={zeroY} stroke="var(--stat-border, rgba(255,255,255,0.12))" strokeDasharray="3 3" />
      )}
      <polyline points={allPath} fill="none" stroke={color} strokeOpacity="0.25" strokeWidth="1.5" strokeDasharray="2 3" strokeLinecap="round" />
      {solidSegs.map(function(seg, i) {
        const pts = seg.map(function(p) { const c = px(p); return c.x + "," + c.y; }).join(" ");
        return <polyline key={i} points={pts} fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />;
      })}
      {points.map(function(p, i) {
        const c = px(p);
        return (
          <g key={i}>
            <circle cx={c.x} cy={c.y} r={p.dim ? 2 : 3} fill={p.dim ? "var(--bg, #0B0F1A)" : color} stroke={color} strokeWidth={p.dim ? 1 : 0} />
            {p.label && i % Math.max(1, Math.ceil(points.length / 6)) === 0 && (
              <text x={c.x} y={h + 14} textAnchor="middle" fontSize="8" fill="var(--chart-text)" fontFamily="'DM Sans',sans-serif">{p.label}</text>
            )}
          </g>
        );
      })}
    </svg>
  );
}

export function ActualWeightChart(props) {
  const series = WP.buildActualSeries(props.weightLog);

  if (series.length === 0) {
    return (
      <div className="chart-container weight-chart-empty">
        <div className="chart-title">Actual Weight</div>
        <div className="weight-empty-msg">
          No weight logs yet. Use the “Log Weight” box below to start tracking.
        </div>
      </div>
    );
  }

  const n = series.length;
  const first = series[0].weight;
  const last = series[n - 1].weight;
  const delta = last - first;

  const points = series.map(function(e, i) {
    const d = new Date(e.date);
    return {
      x: n === 1 ? 0.5 : i / (n - 1),
      y: e.weight,
      label: fmtDate(d),
      dim: false
    };
  });

  return (
    <div className="chart-container">
      <div className="chart-title">Actual Weight</div>
      <div className="weight-chart-meta">
        <span>Latest: <strong className="mono">{last.toFixed(1)} lb</strong></span>
        {n > 1 && (
          <span style={{ color: delta < 0 ? "var(--green)" : delta > 0 ? "var(--orange)" : "var(--text-dim)" }}>
            {delta >= 0 ? "+" : ""}{delta.toFixed(1)} lb total
          </span>
        )}
      </div>
      {n === 1 ? (
        <div className="weight-empty-msg" style={{ paddingTop: 12 }}>
          One log so far — add another to draw a trend.
        </div>
      ) : (
        <LinePlot points={points} color="var(--blue)" height={110} />
      )}
    </div>
  );
}

export function EstimatedWeightChangeChart(props) {
  const history = props.history;
  const maintenance = props.maintenance;
  const weightLog = props.weightLog;

  if (typeof maintenance !== "number" || maintenance <= 0) {
    return (
      <div className="chart-container weight-chart-empty">
        <div className="chart-title">Estimated Weight Change</div>
        <div className="weight-empty-msg">
          Maintenance calories aren't available yet — fill in your build (age,
          weight, height, activity) on Profile to enable this estimate.
        </div>
      </div>
    );
  }

  const series = WP.buildEstimatedSeries(history, maintenance);

  if (series.length === 0) {
    return (
      <div className="chart-container weight-chart-empty">
        <div className="chart-title">Estimated Weight Change</div>
        <div className="weight-empty-msg">
          No calorie history yet. Log meals across multiple days for the app to
          estimate your trajectory.
        </div>
        <div className="weight-disclaimer">
          Estimate only · uses 3,500 kcal ≈ 1 lb · not a measurement
        </div>
      </div>
    );
  }

  let lastKnownCum = 0;
  const n = series.length;
  const points = series.map(function(w, i) {
    let y;
    if (typeof w.cumulativeChange === "number") {
      lastKnownCum = w.cumulativeChange;
      y = w.cumulativeChange;
    } else {
      y = lastKnownCum;
    }
    return {
      x: n === 1 ? 0.5 : i / (n - 1),
      y: y,
      label: "Wk " + (i + 1),
      dim: !w.complete || w.cumulativeChange === null
    };
  });

  let lastComplete = null;
  for (let i = series.length - 1; i >= 0; i--) {
    if (typeof series[i].cumulativeChange === "number") { lastComplete = series[i]; break; }
  }
  const completeCount = series.filter(function(w) { return w.complete; }).length;
  const incompleteCount = series.length - completeCount;

  let comparison = null;
  const actuals = WP.buildActualSeries(weightLog);
  if (lastComplete && actuals.length >= 2) {
    let firstWeekStart = null;
    for (let j = 0; j < series.length; j++) {
      if (typeof series[j].cumulativeChange === "number") { firstWeekStart = series[j].weekStart; break; }
    }
    function nearestWeight(targetISO, mode) {
      const t = new Date(targetISO).getTime();
      let best = null;
      for (let k = 0; k < actuals.length; k++) {
        const et = new Date(actuals[k].date).getTime();
        if (mode === "after" && et < t) continue;
        if (mode === "before" && et > t + 7 * 86400000) continue;
        if (best === null) { best = actuals[k]; continue; }
        if (Math.abs(et - t) < Math.abs(new Date(best.date).getTime() - t)) best = actuals[k];
      }
      return best;
    }
    const startW = nearestWeight(firstWeekStart, "after");
    const endW = nearestWeight(lastComplete.weekStart, "before");
    if (startW && endW && startW !== endW) {
      const actualChange = endW.weight - startW.weight;
      const verdict = WP.compareWeek(actualChange, lastComplete.cumulativeChange, 1.0);
      let verdictText, verdictColor;
      if (verdict === "on-track") {
        verdictText = "Your actual weight is tracking close to the estimated trend.";
        verdictColor = "var(--green)";
      } else if (verdict === "above") {
        verdictText = "Your actual weight is slightly above the estimated trend.";
        verdictColor = "var(--orange)";
      } else if (verdict === "below") {
        verdictText = "Your actual weight is slightly below the estimated trend.";
        verdictColor = "var(--blue)";
      } else {
        verdictText = "";
        verdictColor = "var(--text-dim)";
      }
      if (verdictText) {
        comparison = (
          <div className="weight-compare" style={{ borderColor: verdictColor + "55" }}>
            <div className="weight-compare-row">
              <span className="weight-compare-label">Actual</span>
              <span className="mono">{fmtDelta(actualChange)} lb</span>
            </div>
            <div className="weight-compare-row">
              <span className="weight-compare-label">Estimated</span>
              <span className="mono">{fmtDelta(lastComplete.cumulativeChange)} lb</span>
            </div>
            <div className="weight-compare-verdict" style={{ color: verdictColor }}>
              {verdictText} Day-to-day shifts from water, sodium, carbs, and digestion are normal.
            </div>
          </div>
        );
      }
    }
  }

  return (
    <div className="chart-container">
      <div className="chart-title">
        Estimated Weight Change
        <span className="weight-estimate-tag">ESTIMATE</span>
      </div>
      <div className="weight-chart-meta">
        <span>Cumulative: <strong className="mono" style={{ color: lastComplete && lastComplete.cumulativeChange < 0 ? "var(--green)" : lastComplete && lastComplete.cumulativeChange > 0 ? "var(--orange)" : "var(--text-dim)" }}>
          {lastComplete ? fmtDelta(lastComplete.cumulativeChange) + " lb" : "—"}
        </strong></span>
        <span style={{ fontSize: 10, color: "var(--text-faint)" }}>
          {completeCount} full wk{completeCount === 1 ? "" : "s"}{incompleteCount > 0 ? " · " + incompleteCount + " incomplete" : ""}
        </span>
      </div>
      <LinePlot points={points} color="var(--purple)" height={110} fillBaseline={0} />
      <div className="weight-disclaimer">
        Estimate only · cumulative weekly (consumed − maintenance) ÷ 3,500 · not a measurement.
        Real weight fluctuates with water, sodium, carbs, and digestion.
      </div>
      {comparison}
    </div>
  );
}

export function WeightTrackingChart(props) {
  const history = props.history;
  const maintenance = props.maintenance;
  const weightLog = props.weightLog;
  const profileWeight = props.profileWeight;

  const actuals = WP.buildActualSeries(weightLog);
  const estSeries = (typeof maintenance === "number" && maintenance > 0)
    ? WP.buildEstimatedSeries(history, maintenance)
    : [];

  const hasActual = actuals.length > 0;
  const hasEstimated = estSeries.length > 0;

  if (!hasActual && !hasEstimated) {
    return (
      <div className="chart-container weight-chart-empty">
        <div className="chart-title">Weight Tracking</div>
        <div className="weight-empty-msg">
          Log a weight below or accumulate a full week of meals to start the chart.
        </div>
        <div className="weight-disclaimer">
          Estimate uses 3,500 kcal ≈ 1 lb · not a measurement
        </div>
      </div>
    );
  }

  const anchorWeight = hasActual
    ? actuals[0].weight
    : (typeof profileWeight === "number" && profileWeight > 0 ? profileWeight : null);

  const estPoints = [];
  let firstAnchorTime = null;
  if (hasEstimated && anchorWeight !== null) {
    const firstWeekStart = estSeries[0].weekStart;
    firstAnchorTime = new Date(firstWeekStart).getTime();
    estPoints.push({
      time: firstAnchorTime,
      y: anchorWeight,
      label: "Start",
      dim: false,
      kind: "estimated"
    });
    let lastKnown = anchorWeight;
    estSeries.forEach(function(w) {
      const t = new Date(w.weekStart).getTime() + 6 * 86400000;
      let y;
      if (typeof w.cumulativeChange === "number") {
        y = anchorWeight + w.cumulativeChange;
        lastKnown = y;
      } else {
        y = lastKnown;
      }
      estPoints.push({
        time: t,
        y: y,
        label: null,
        dim: !w.complete || w.cumulativeChange === null,
        kind: "estimated"
      });
    });
  }

  const actPoints = actuals.map(function(e) {
    return {
      time: new Date(e.date).getTime(),
      y: e.weight,
      label: null,
      dim: false,
      kind: "actual"
    };
  });

  const allTimes = actPoints.map(function(p) { return p.time; })
    .concat(estPoints.map(function(p) { return p.time; }));
  const tMin = Math.min.apply(null, allTimes);
  let tMax = Math.max.apply(null, allTimes);
  if (tMax === tMin) tMax = tMin + 86400000;

  const allY = actPoints.map(function(p) { return p.y; })
    .concat(estPoints.map(function(p) { return p.y; }));
  let yMin = Math.min.apply(null, allY);
  let yMax = Math.max.apply(null, allY);
  if (yMax === yMin) { yMax = yMin + 1; }
  const yPad = (yMax - yMin) * 0.1;
  yMin -= yPad; yMax += yPad;

  const w = 320, h = 150, padL = 28, padR = 8, padT = 10, padB = 22;
  function px(time, y) {
    return {
      x: padL + ((time - tMin) / (tMax - tMin)) * (w - padL - padR),
      y: padT + ((yMax - y) / (yMax - yMin)) * (h - padT - padB)
    };
  }

  function buildPolyline(pts) {
    const all = pts.map(function(p) { const c = px(p.time, p.y); return c.x + "," + c.y; }).join(" ");
    const solidSegs = [];
    let cur = [];
    pts.forEach(function(p) {
      if (p.dim) { if (cur.length > 1) solidSegs.push(cur); cur = []; }
      else cur.push(p);
    });
    if (cur.length > 1) solidSegs.push(cur);
    return { all: all, solidSegs: solidSegs };
  }

  const estLine = hasEstimated && estPoints.length > 0 ? buildPolyline(estPoints) : null;
  const actLine = hasActual && actPoints.length > 1 ? buildPolyline(actPoints) : null;

  const yTicks = [yMin + (yMax - yMin) * 0.1, (yMin + yMax) / 2, yMax - (yMax - yMin) * 0.1];

  const xTickTimes = [tMin, (tMin + tMax) / 2, tMax];
  function fmtT(t) {
    const d = new Date(t);
    return d.toLocaleDateString([], { month: "short", day: "numeric" });
  }

  const latestActual = hasActual ? actuals[actuals.length - 1].weight : null;
  let lastCompleteEst = null;
  for (let i = estSeries.length - 1; i >= 0; i--) {
    if (typeof estSeries[i].cumulativeChange === "number") { lastCompleteEst = estSeries[i]; break; }
  }
  const projectedNow = (lastCompleteEst && anchorWeight !== null)
    ? anchorWeight + lastCompleteEst.cumulativeChange
    : null;

  let verdict = null;
  if (hasActual && actuals.length >= 2 && lastCompleteEst) {
    const actualDelta = actuals[actuals.length - 1].weight - actuals[0].weight;
    const estDelta = lastCompleteEst.cumulativeChange;
    const v = WP.compareWeek(actualDelta, estDelta, 1.0);
    if (v === "on-track") verdict = { text: "Your actual weight is tracking close to the estimated trend.", color: "var(--green)" };
    else if (v === "above") verdict = { text: "Your actual weight is slightly above the estimated trend.", color: "var(--orange)" };
    else if (v === "below") verdict = { text: "Your actual weight is slightly below the estimated trend.", color: "var(--blue)" };
  }

  return (
    <div className="chart-container">
      <div className="chart-title">
        Weight Tracking
        <span className="weight-estimate-tag">ACTUAL + ESTIMATE</span>
      </div>

      <div className="weight-legend">
        <span className="weight-legend-item">
          <span className="weight-legend-swatch" style={{ background: "var(--blue)" }} />
          Actual
        </span>
        <span className="weight-legend-item">
          <span className="weight-legend-swatch weight-legend-dashed" style={{ background: "var(--purple)" }} />
          Estimated
        </span>
      </div>

      <div className="weight-chart-meta">
        <span>
          Actual: <strong className="mono">{latestActual !== null ? latestActual.toFixed(1) + " lb" : "—"}</strong>
        </span>
        <span>
          Estimated: <strong className="mono" style={{ color: "var(--purple)" }}>
            {projectedNow !== null ? projectedNow.toFixed(1) + " lb" : "—"}
          </strong>
        </span>
      </div>

      <svg viewBox={"0 0 " + w + " " + h} style={{ width: "100%", height: "auto" }}>
        {yTicks.map(function(t, i) {
          const y = padT + ((yMax - t) / (yMax - yMin)) * (h - padT - padB);
          return (
            <g key={"y" + i}>
              <line x1={padL} y1={y} x2={w - padR} y2={y} stroke="var(--stat-border, rgba(255,255,255,0.08))" strokeDasharray="2 4" />
              <text x={padL - 4} y={y + 3} textAnchor="end" fontSize="8" fill="var(--chart-text)" fontFamily="'Space Mono',monospace">{t.toFixed(1)}</text>
            </g>
          );
        })}

        {xTickTimes.map(function(t, i) {
          const c = px(t, yMin);
          return (
            <text key={"x" + i} x={c.x} y={h - 6} textAnchor={i === 0 ? "start" : i === xTickTimes.length - 1 ? "end" : "middle"} fontSize="8" fill="var(--chart-text)" fontFamily="'DM Sans'">{fmtT(t)}</text>
          );
        })}

        {estLine && (
          <g>
            <polyline points={estLine.all} fill="none" stroke="var(--purple)" strokeOpacity="0.35" strokeWidth="1.5" strokeDasharray="3 3" strokeLinecap="round" />
            {estLine.solidSegs.map(function(seg, i) {
              const pts = seg.map(function(p) { const c = px(p.time, p.y); return c.x + "," + c.y; }).join(" ");
              return <polyline key={"es" + i} points={pts} fill="none" stroke="var(--purple)" strokeWidth="2" strokeDasharray="5 4" strokeLinecap="round" strokeLinejoin="round" />;
            })}
            {estPoints.map(function(p, i) {
              const c = px(p.time, p.y);
              return <circle key={"ed" + i} cx={c.x} cy={c.y} r={p.dim ? 2 : 2.5} fill={p.dim ? "var(--bg, #0B0F1A)" : "var(--purple)"} stroke="var(--purple)" strokeWidth={p.dim ? 1 : 0} />;
            })}
          </g>
        )}

        {hasActual && (
          <g>
            {actLine && actLine.solidSegs.map(function(seg, i) {
              const pts = seg.map(function(p) { const c = px(p.time, p.y); return c.x + "," + c.y; }).join(" ");
              return <polyline key={"as" + i} points={pts} fill="none" stroke="var(--blue)" strokeWidth="2.25" strokeLinecap="round" strokeLinejoin="round" />;
            })}
            {actPoints.map(function(p, i) {
              const c = px(p.time, p.y);
              return <circle key={"ad" + i} cx={c.x} cy={c.y} r="3" fill="var(--blue)" />;
            })}
          </g>
        )}
      </svg>

      <div className="weight-disclaimer">
        Estimate only · cumulative weekly (consumed − maintenance) ÷ 3,500 lb · not a measurement.
        Real weight fluctuates with water, sodium, carbs, and digestion.
      </div>

      {verdict && (
        <div className="weight-compare" style={{ borderColor: verdict.color + "55" }}>
          <div className="weight-compare-verdict" style={{ color: verdict.color, borderTop: "none", paddingTop: 0, fontStyle: "normal" }}>
            {verdict.text}
          </div>
        </div>
      )}
    </div>
  );
}
