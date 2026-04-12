/* ─── PHYSIQ ENGINE — ProgressRing Component ─────────────────────────────── */

window.PhysIQ = window.PhysIQ || {};
window.PhysIQ.Components = window.PhysIQ.Components || {};

(function(Components) {

  function ProgressRing({ value, max, size = 100, stroke = 7, color, children }) {
    var r = (size - stroke) / 2;
    var ci = 2 * Math.PI * r;
    var pct = Math.min(value / (max || 1), 1.3);
    var off = ci * (1 - pct);
    var over = value > max;

    return (
      <div style={{ position: "relative", width: size, height: size, flexShrink: 0 }}>
        <svg width={size} height={size} style={{ transform: "rotate(-90deg)" }}>
          <circle
            cx={size / 2} cy={size / 2} r={r}
            fill="none" stroke="var(--track)" strokeWidth={stroke}
          />
          <circle
            cx={size / 2} cy={size / 2} r={r}
            fill="none" stroke={over ? "var(--red)" : color}
            strokeWidth={stroke}
            strokeDasharray={ci}
            strokeDashoffset={Math.max(off, 0)}
            strokeLinecap="round"
            style={{ transition: "stroke-dashoffset .6s ease" }}
          />
        </svg>
        <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", flexDirection: "column" }}>
          {children}
        </div>
      </div>
    );
  }

  Components.ProgressRing = ProgressRing;

})(window.PhysIQ.Components);
