/* ─── PHYSIQ ENGINE — NutrientCard Component ─────────────────────────────── */

window.PhysIQ = window.PhysIQ || {};
window.PhysIQ.Components = window.PhysIQ.Components || {};

(function(Components, Data) {

  var NUTRIENT_INFO = Data.NUTRIENT_INFO;

  function NutrientCard({ id, value, target, compact }) {
    var info = NUTRIENT_INFO[id];
    if (!info) return null;

    var pct = target > 0 ? Math.round((value / target) * 100) : 0;
    var over = value > target * 1.1;
    var low = value < target * 0.5;

    // Compact variant (single row)
    if (compact) {
      return (
        <div className="nutrient-compact">
          <div style={{ width: 8, height: 8, borderRadius: "50%", background: info.color, flexShrink: 0 }} />
          <span style={{ flex: 1, fontSize: 12, color: "var(--text-dim)" }}>{info.label}</span>
          <span className="mono" style={{ fontSize: 12, fontWeight: 600, color: over ? "var(--red)" : low ? "var(--amber)" : "var(--text)" }}>
            {value}/{target}{info.unit}
          </span>
        </div>
      );
    }

    // Full card variant
    return (
      <div
        className="card"
        style={{ borderColor: "transparent" }}
        onMouseEnter={function(e) { e.currentTarget.style.borderColor = info.color + "44"; }}
        onMouseLeave={function(e) { e.currentTarget.style.borderColor = "transparent"; }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 8 }}>
          <span style={{ fontSize: 11, fontWeight: 600, textTransform: "uppercase", letterSpacing: 1, color: info.color }}>{info.label}</span>
          <span className="mono" style={{ fontSize: 10, color: over ? "var(--red)" : "var(--text-muted)" }}>{pct}%</span>
        </div>
        <div style={{ display: "flex", alignItems: "baseline", gap: 4, marginBottom: 8 }}>
          <span className="mono" style={{ fontSize: 20, fontWeight: 700, color: "var(--text-bright)" }}>{value}</span>
          <span style={{ fontSize: 11, color: "var(--text-muted)" }}>/ {target} {info.unit}</span>
        </div>
        <div className="progress-track">
          <div className="progress-fill" style={{ width: Math.min(pct, 130) + "%", background: over ? "var(--red)" : "linear-gradient(90deg," + info.color + "88," + info.color + ")" }} />
        </div>
      </div>
    );
  }

  Components.NutrientCard = NutrientCard;

})(window.PhysIQ.Components, window.PhysIQ.Data);
