/* ─── PHYSIQ ENGINE — Chart Components ────────────────────────────────────── */

window.PhysIQ = window.PhysIQ || {};
window.PhysIQ.Components = window.PhysIQ.Components || {};

(function(Components, Data) {

  var GOALS = Data.GOALS;

  // ─── MiniChart (bar chart) ──────────────────────────────────────────────
  function MiniChart({ data, labels, colors, title, height }) {
    height = height || 120;
    var max = Math.max.apply(null, data.concat([1]));
    var w = 300;
    var barW = w / data.length * 0.6;
    var gap = w / data.length;

    return (
      <div className="chart-container">
        <div className="chart-title">{title}</div>
        <svg viewBox={"0 0 " + w + " " + (height + 20)} style={{ width: "100%", height: "auto" }}>
          {data.map(function(v, i) {
            var bh = (v / max) * (height - 10);
            var x = i * gap + gap * 0.2;
            return (
              <g key={i}>
                <rect x={x} y={height - bh} width={barW} height={bh} rx={3} fill={(colors && colors[i]) || "var(--blue)"} opacity={0.85} />
                <text x={x + barW / 2} y={height + 14} textAnchor="middle" fontSize="8" fill="var(--chart-text)" fontFamily="'DM Sans',sans-serif">
                  {(labels && labels[i]) || ""}
                </text>
                <text x={x + barW / 2} y={height - bh - 4} textAnchor="middle" fontSize="8" fill="var(--text-dim)" fontFamily="'Space Mono',monospace" fontWeight="600">
                  {v}
                </text>
              </g>
            );
          })}
        </svg>
      </div>
    );
  }

  // ─── ProjectionChart (12-week weight projection) ───────────────────────
  function ProjectionChart({ profile, targets }) {
    var gd = GOALS.find(function(g) { return g.id === profile.goal; });
    var wkCh = gd ? (targets.tdee * gd.pct * 7 / 3500) : 0;
    var weeks = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];
    var proj = weeks.map(function(w) { return Math.round((profile.weight + wkCh * w) * 10) / 10; });
    var max = Math.max.apply(null, proj);
    var min = Math.min.apply(null, proj);
    var range = max - min || 10;
    var svgW = 300, svgH = 100, pad = 5;
    var pts = proj.map(function(w, i) {
      var x = pad + i * (svgW - 2 * pad) / 12;
      var y = pad + (max - w) / range * (svgH - 2 * pad);
      return x + "," + y;
    }).join(" ");

    return (
      <div className="chart-container">
        <div className="chart-title">12-Week Weight Projection ({gd ? gd.label : ""})</div>
        <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
          <span style={{ fontSize: 11, color: "var(--text-dim)" }}>Now: <strong>{profile.weight}lb</strong></span>
          <span style={{ fontSize: 11, color: wkCh > 0 ? "var(--orange)" : wkCh < 0 ? "var(--green)" : "var(--text-dim)" }}>
            {wkCh > 0 ? "+" : ""}{wkCh.toFixed(1)}lb/wk {"\u2192"} <strong>{proj[12]}lb</strong> at Wk 12
          </span>
        </div>
        <svg viewBox={"0 0 " + svgW + " " + (svgH + 18)} style={{ width: "100%", height: "auto" }}>
          {weeks.map(function(i) {
            var x = pad + i * (svgW - 2 * pad) / 12;
            return i % 2 === 0 ? (
              <text key={i} x={x} y={svgH + 14} textAnchor="middle" fontSize="7.5" fill="var(--chart-text)" fontFamily="'DM Sans'">Wk {i}</text>
            ) : null;
          })}
          <polyline points={pts} fill="none" stroke="var(--blue)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          {proj.map(function(w, i) {
            var x = pad + i * (svgW - 2 * pad) / 12;
            var y = pad + (max - w) / range * (svgH - 2 * pad);
            return i % 4 === 0 ? <circle key={i} cx={x} cy={y} r="3" fill="var(--blue)" /> : null;
          })}
        </svg>
      </div>
    );
  }

  // ─── HistoryChart (past week calorie & protein bars) ───────────────────
  function HistoryChart({ history }) {
    if (history.length < 2) {
      return (
        <div className="card" style={{ padding: 20, textAlign: "center", marginBottom: 16 }}>
          <span style={{ fontSize: 12, color: "var(--text-faint)" }}>Log meals for 2+ days to see history charts</span>
        </div>
      );
    }

    var last = history.slice(-7);
    var labels = last.map(function(d) {
      var dt = new Date(d.date);
      return ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][dt.getDay()] + " " + (dt.getMonth() + 1) + "/" + dt.getDate();
    });

    return (
      <React.Fragment>
        <MiniChart
          data={last.map(function(d) { return d.calories; })}
          labels={labels}
          colors={last.map(function() { return "var(--orange)"; })}
          title="Calorie History (Past Week)"
          height={100}
        />
        <MiniChart
          data={last.map(function(d) { return d.protein; })}
          labels={labels}
          colors={last.map(function() { return "var(--blue)"; })}
          title="Protein History (Past Week)"
          height={80}
        />
      </React.Fragment>
    );
  }

  // ─── Exports ────────────────────────────────────────────────────────────
  Components.MiniChart = MiniChart;
  Components.ProjectionChart = ProjectionChart;
  Components.HistoryChart = HistoryChart;

})(window.PhysIQ.Components, window.PhysIQ.Data);
