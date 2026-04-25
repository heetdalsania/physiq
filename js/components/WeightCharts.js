/* ─── PHYSIQ ENGINE — Weight Tracking Charts ─────────────────────────────── */
/* Two strictly-separate charts:
     1. ActualWeightChart  — driven only by user-entered weightLog entries.
                             Never reads or merges estimated data.
     2. EstimatedWeightChangeChart — cumulative projection from calendar
                                     calorie data vs maintenance. Never
                                     reads or merges actual weight data.
   When required inputs are missing each chart renders a neutral fallback
   instead of fabricating numbers. */

window.PhysIQ = window.PhysIQ || {};
window.PhysIQ.Components = window.PhysIQ.Components || {};

(function(Components, Utils) {

  var WP = Utils.WeightProjection;

  // ── Shared helpers ───────────────────────────────────────────────────
  function fmtDate(d) {
    return d.toLocaleDateString([], { month: "short", day: "numeric" });
  }
  function fmtDelta(v) {
    if (typeof v !== "number" || isNaN(v)) return "—";
    var s = v >= 0 ? "+" : "";
    return s + v.toFixed(1);
  }

  // Generic line plot helper — given series of {x, y} renders polyline
  // and dots. Caller controls labels and color.
  function LinePlot(props) {
    var points = props.points; // [{ x: number 0..1, y: number, label, dim }]
    var color = props.color || "var(--blue)";
    var height = props.height || 110;
    var fillBaseline = props.fillBaseline; // optional y value to draw zero line at
    var pad = 8;
    var w = 300;
    var h = height;

    if (!points || points.length === 0) return null;

    var ys = points.map(function(p) { return p.y; });
    if (typeof fillBaseline === "number") ys = ys.concat([fillBaseline]);
    var maxY = Math.max.apply(null, ys);
    var minY = Math.min.apply(null, ys);
    if (maxY === minY) { maxY = minY + 1; }
    var range = maxY - minY;

    function px(p) {
      var x = pad + p.x * (w - 2 * pad);
      var y = pad + (maxY - p.y) / range * (h - 2 * pad);
      return { x: x, y: y };
    }

    // Solid polyline only across consecutive non-dim points
    var solidSegs = [];
    var cur = [];
    points.forEach(function(p) {
      if (p.dim) {
        if (cur.length > 1) solidSegs.push(cur);
        cur = [];
      } else {
        cur.push(p);
      }
    });
    if (cur.length > 1) solidSegs.push(cur);

    // Faint connector across all points so dim ones don't break visual flow
    var allPath = points.map(function(p) {
      var c = px(p);
      return c.x + "," + c.y;
    }).join(" ");

    // Optional zero baseline
    var zeroY = null;
    if (typeof fillBaseline === "number") {
      zeroY = pad + (maxY - fillBaseline) / range * (h - 2 * pad);
    }

    return (
      <svg viewBox={"0 0 " + w + " " + (h + 22)} style={{ width: "100%", height: "auto" }}>
        {zeroY !== null && (
          <line x1={pad} y1={zeroY} x2={w - pad} y2={zeroY} stroke="var(--stat-border, rgba(255,255,255,0.12))" strokeDasharray="3 3" />
        )}
        {/* faint full path */}
        <polyline points={allPath} fill="none" stroke={color} strokeOpacity="0.25" strokeWidth="1.5" strokeDasharray="2 3" strokeLinecap="round" />
        {/* solid segments */}
        {solidSegs.map(function(seg, i) {
          var pts = seg.map(function(p) { var c = px(p); return c.x + "," + c.y; }).join(" ");
          return <polyline key={i} points={pts} fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />;
        })}
        {points.map(function(p, i) {
          var c = px(p);
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

  // ──────────────────────────────────────────────────────────────────────
  // ActualWeightChart
  //   Inputs:
  //     weightLog : Array<{ date, weight }>  (user-entered only)
  //   Behavior:
  //     - 0 entries → fallback message
  //     - 1 entry  → single dot + note that more data is needed
  //     - ≥2 entries → line plot
  // ──────────────────────────────────────────────────────────────────────
  function ActualWeightChart(props) {
    var series = WP.buildActualSeries(props.weightLog);

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

    var n = series.length;
    var first = series[0].weight;
    var last = series[n - 1].weight;
    var delta = last - first;

    var points = series.map(function(e, i) {
      var d = new Date(e.date);
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

  // ──────────────────────────────────────────────────────────────────────
  // EstimatedWeightChangeChart
  //   Inputs:
  //     history     : Array<historyEntry>     (calendar calorie data)
  //     maintenance : number                  (TDEE; from profile/targets)
  //     weightLog   : Array<{date, weight}>   (optional, for comparison only —
  //                                            never merged into the line)
  //   Behavior:
  //     - missing maintenance → error fallback
  //     - no calorie history  → fallback message
  //     - draws cumulative line from complete weeks; incomplete weeks
  //       appear as dimmed dots that don't contribute to the cumulative
  //   The chart is explicitly labeled as an estimate; it never claims
  //   reality.
  // ──────────────────────────────────────────────────────────────────────
  function EstimatedWeightChangeChart(props) {
    var history = props.history;
    var maintenance = props.maintenance;
    var weightLog = props.weightLog;

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

    var series = WP.buildEstimatedSeries(history, maintenance);

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

    // Build plot points — incomplete weeks get null cumulative, but we still
    // show a dimmed marker at "previous cumulative" so the gap is visible.
    var lastKnownCum = 0;
    var n = series.length;
    var points = series.map(function(w, i) {
      var y;
      if (typeof w.cumulativeChange === "number") {
        lastKnownCum = w.cumulativeChange;
        y = w.cumulativeChange;
      } else {
        y = lastKnownCum;
      }
      var d = new Date(w.weekStart);
      return {
        x: n === 1 ? 0.5 : i / (n - 1),
        y: y,
        label: "Wk " + (i + 1),
        dim: !w.complete || w.cumulativeChange === null
      };
    });

    var lastComplete = null;
    for (var i = series.length - 1; i >= 0; i--) {
      if (typeof series[i].cumulativeChange === "number") { lastComplete = series[i]; break; }
    }
    var completeCount = series.filter(function(w) { return w.complete; }).length;
    var incompleteCount = series.length - completeCount;

    // ── Comparison block (only if BOTH datasets exist) ─────────────────
    var comparison = null;
    var actuals = WP.buildActualSeries(weightLog);
    if (lastComplete && actuals.length >= 2) {
      // Find actual weight closest to first complete week start and to last
      var firstWeekStart = null;
      for (var j = 0; j < series.length; j++) {
        if (typeof series[j].cumulativeChange === "number") { firstWeekStart = series[j].weekStart; break; }
      }
      // Cumulative is measured from start of first complete week.
      // Compare actual weight on/after firstWeekStart to actual weight on/before last week's end.
      function nearestWeight(targetISO, mode) {
        var t = new Date(targetISO).getTime();
        var best = null;
        for (var k = 0; k < actuals.length; k++) {
          var et = new Date(actuals[k].date).getTime();
          if (mode === "after" && et < t) continue;
          if (mode === "before" && et > t + 7 * 86400000) continue;
          if (best === null) { best = actuals[k]; continue; }
          if (Math.abs(et - t) < Math.abs(new Date(best.date).getTime() - t)) best = actuals[k];
        }
        return best;
      }
      var startW = nearestWeight(firstWeekStart, "after");
      var endW = nearestWeight(lastComplete.weekStart, "before");
      if (startW && endW && startW !== endW) {
        var actualChange = endW.weight - startW.weight;
        var verdict = WP.compareWeek(actualChange, lastComplete.cumulativeChange, 1.0);
        var verdictText, verdictColor;
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

  // ──────────────────────────────────────────────────────────────────────
  // WeightTrackingChart
  //   Both lines on one chart, sharing a pounds-based Y-axis.
  //
  //   - Actual line: user-entered weightLog points plotted as lbs over time.
  //   - Estimated line: cumulative estimated change anchored to a starting
  //     weight (first weightLog entry if present, otherwise profile.weight),
  //     so both series live in the same coordinate space.
  //
  //   The two series are computed independently — they're rendered on the
  //   same axes for easy comparison, but never blended into a single
  //   dataset. Incomplete weeks render as dim dots and don't contribute
  //   to the cumulative total.
  // ──────────────────────────────────────────────────────────────────────
  function WeightTrackingChart(props) {
    var history = props.history;
    var maintenance = props.maintenance;
    var weightLog = props.weightLog;
    var profileWeight = props.profileWeight;

    var actuals = WP.buildActualSeries(weightLog);
    var estSeries = (typeof maintenance === "number" && maintenance > 0)
      ? WP.buildEstimatedSeries(history, maintenance)
      : [];

    var hasActual = actuals.length > 0;
    var hasEstimated = estSeries.length > 0;

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

    // Anchor the estimated line to a starting weight in lbs.
    var anchorWeight = hasActual
      ? actuals[0].weight
      : (typeof profileWeight === "number" && profileWeight > 0 ? profileWeight : null);

    // Build estimated lb-points anchored to the start. We also need a
    // baseline point at "anchor week" so the line begins at the start
    // weight rather than at the first complete week's delta only.
    var estPoints = [];
    var firstAnchorTime = null;
    if (hasEstimated && anchorWeight !== null) {
      // Insert a synthetic anchor at the first week's start so the line
      // visually departs from the user's actual starting weight.
      var firstWeekStart = estSeries[0].weekStart;
      firstAnchorTime = new Date(firstWeekStart).getTime();
      estPoints.push({
        time: firstAnchorTime,
        y: anchorWeight,
        label: "Start",
        dim: false,
        kind: "estimated"
      });
      var lastKnown = anchorWeight;
      estSeries.forEach(function(w) {
        var t = new Date(w.weekStart).getTime() + 6 * 86400000; // anchor end of week
        var y;
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

    // Actual lb-points
    var actPoints = actuals.map(function(e) {
      return {
        time: new Date(e.date).getTime(),
        y: e.weight,
        label: null,
        dim: false,
        kind: "actual"
      };
    });

    // Shared X domain: min/max across all rendered points
    var allTimes = actPoints.map(function(p) { return p.time; })
      .concat(estPoints.map(function(p) { return p.time; }));
    var tMin = Math.min.apply(null, allTimes);
    var tMax = Math.max.apply(null, allTimes);
    if (tMax === tMin) tMax = tMin + 86400000;

    // Shared Y domain: across both series, with light padding
    var allY = actPoints.map(function(p) { return p.y; })
      .concat(estPoints.map(function(p) { return p.y; }));
    var yMin = Math.min.apply(null, allY);
    var yMax = Math.max.apply(null, allY);
    if (yMax === yMin) { yMax = yMin + 1; }
    var yPad = (yMax - yMin) * 0.1;
    yMin -= yPad; yMax += yPad;

    var w = 320, h = 150, padL = 28, padR = 8, padT = 10, padB = 22;
    function px(time, y) {
      return {
        x: padL + ((time - tMin) / (tMax - tMin)) * (w - padL - padR),
        y: padT + ((yMax - y) / (yMax - yMin)) * (h - padT - padB)
      };
    }

    function buildPolyline(pts) {
      // Draw faint connector across all (incl. dim) and solid across
      // consecutive non-dim runs.
      var all = pts.map(function(p) { var c = px(p.time, p.y); return c.x + "," + c.y; }).join(" ");
      var solidSegs = [];
      var cur = [];
      pts.forEach(function(p) {
        if (p.dim) { if (cur.length > 1) solidSegs.push(cur); cur = []; }
        else cur.push(p);
      });
      if (cur.length > 1) solidSegs.push(cur);
      return { all: all, solidSegs: solidSegs };
    }

    var estLine = hasEstimated && estPoints.length > 0 ? buildPolyline(estPoints) : null;
    var actLine = hasActual && actPoints.length > 1 ? buildPolyline(actPoints) : null;

    // Y-axis tick marks (3 levels)
    var yTicks = [yMin + (yMax - yMin) * 0.1, (yMin + yMax) / 2, yMax - (yMax - yMin) * 0.1];

    // X-axis labels — show first, middle, last dates
    var xTickTimes = [tMin, (tMin + tMax) / 2, tMax];
    function fmtT(t) {
      var d = new Date(t);
      return d.toLocaleDateString([], { month: "short", day: "numeric" });
    }

    // Latest values for header
    var latestActual = hasActual ? actuals[actuals.length - 1].weight : null;
    var lastCompleteEst = null;
    for (var i = estSeries.length - 1; i >= 0; i--) {
      if (typeof estSeries[i].cumulativeChange === "number") { lastCompleteEst = estSeries[i]; break; }
    }
    var projectedNow = (lastCompleteEst && anchorWeight !== null)
      ? anchorWeight + lastCompleteEst.cumulativeChange
      : null;

    // Comparison verdict (only when we can fairly compare)
    var verdict = null;
    if (hasActual && actuals.length >= 2 && lastCompleteEst) {
      var actualDelta = actuals[actuals.length - 1].weight - actuals[0].weight;
      var estDelta = lastCompleteEst.cumulativeChange;
      var v = WP.compareWeek(actualDelta, estDelta, 1.0);
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

        {/* Legend */}
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

        {/* Header values */}
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
          {/* Y grid */}
          {yTicks.map(function(t, i) {
            var y = padT + ((yMax - t) / (yMax - yMin)) * (h - padT - padB);
            return (
              <g key={"y" + i}>
                <line x1={padL} y1={y} x2={w - padR} y2={y} stroke="var(--stat-border, rgba(255,255,255,0.08))" strokeDasharray="2 4" />
                <text x={padL - 4} y={y + 3} textAnchor="end" fontSize="8" fill="var(--chart-text)" fontFamily="'Space Mono',monospace">{t.toFixed(1)}</text>
              </g>
            );
          })}

          {/* X labels */}
          {xTickTimes.map(function(t, i) {
            var c = px(t, yMin);
            return (
              <text key={"x" + i} x={c.x} y={h - 6} textAnchor={i === 0 ? "start" : i === xTickTimes.length - 1 ? "end" : "middle"} fontSize="8" fill="var(--chart-text)" fontFamily="'DM Sans'">{fmtT(t)}</text>
            );
          })}

          {/* Estimated line — purple, dashed where incomplete */}
          {estLine && (
            <g>
              <polyline points={estLine.all} fill="none" stroke="var(--purple)" strokeOpacity="0.35" strokeWidth="1.5" strokeDasharray="3 3" strokeLinecap="round" />
              {estLine.solidSegs.map(function(seg, i) {
                var pts = seg.map(function(p) { var c = px(p.time, p.y); return c.x + "," + c.y; }).join(" ");
                return <polyline key={"es" + i} points={pts} fill="none" stroke="var(--purple)" strokeWidth="2" strokeDasharray="5 4" strokeLinecap="round" strokeLinejoin="round" />;
              })}
              {estPoints.map(function(p, i) {
                var c = px(p.time, p.y);
                return <circle key={"ed" + i} cx={c.x} cy={c.y} r={p.dim ? 2 : 2.5} fill={p.dim ? "var(--bg, #0B0F1A)" : "var(--purple)"} stroke="var(--purple)" strokeWidth={p.dim ? 1 : 0} />;
              })}
            </g>
          )}

          {/* Actual line — blue, solid */}
          {hasActual && (
            <g>
              {actLine && actLine.solidSegs.map(function(seg, i) {
                var pts = seg.map(function(p) { var c = px(p.time, p.y); return c.x + "," + c.y; }).join(" ");
                return <polyline key={"as" + i} points={pts} fill="none" stroke="var(--blue)" strokeWidth="2.25" strokeLinecap="round" strokeLinejoin="round" />;
              })}
              {actPoints.map(function(p, i) {
                var c = px(p.time, p.y);
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

  Components.ActualWeightChart = ActualWeightChart;
  Components.EstimatedWeightChangeChart = EstimatedWeightChangeChart;
  Components.WeightTrackingChart = WeightTrackingChart;

})(window.PhysIQ.Components, window.PhysIQ.Utils);
