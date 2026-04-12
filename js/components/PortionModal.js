/* ─── PHYSIQ ENGINE — PortionModal Component ─────────────────────────────── */

window.PhysIQ = window.PhysIQ || {};
window.PhysIQ.Components = window.PhysIQ.Components || {};

(function(Components, Utils) {

  var NUTRI_SCORE_COLORS = Utils.NUTRI_SCORE_COLORS || {};

  function PortionModal({ portionItem, setPortionItem, portionGrams, setPortionGrams, confirmPortion }) {
    if (!portionItem) return null;

    var PRESETS = [
      { label: "Small (50g)",  g: 50 },
      { label: "100g",         g: 100 },
      { label: "Medium (150g)",g: 150 },
      { label: "Large (200g)", g: 200 },
      { label: "1 oz (28g)",   g: 28 },
      { label: "4 oz (113g)",  g: 113 },
      { label: "6 oz (170g)",  g: 170 },
      { label: "8 oz (227g)",  g: 227 }
    ];

    var hasImage = portionItem.image && portionItem.image.length > 0;
    var hasNutriScore = portionItem.nutriScore && NUTRI_SCORE_COLORS[portionItem.nutriScore];

    return (
      <div className="portion-overlay" onClick={function(e) { if (e.target === e.currentTarget) setPortionItem(null); }}>
        <div className="portion-modal">
          {/* Header with optional image */}
          <div className="portion-modal-header">
            {hasImage && (
              <div className="portion-modal-thumb">
                <img src={portionItem.image} alt="" onError={function(e) { e.target.parentElement.style.display = "none"; }} />
              </div>
            )}
            <div className="portion-modal-title-wrap">
              <div style={{ fontSize: 16, fontWeight: 700, color: "var(--text-white)", marginBottom: 2, textTransform: "capitalize" }}>
                {portionItem.name.toLowerCase()}
                {hasNutriScore && (
                  <span className="portion-nutri-badge" style={{ background: NUTRI_SCORE_COLORS[portionItem.nutriScore], marginLeft: 8 }}>
                    {portionItem.nutriScore}
                  </span>
                )}
              </div>
              {portionItem.brand && <div style={{ fontSize: 12, color: "var(--text-dim)", marginBottom: 2 }}>{portionItem.brand}</div>}
              <div style={{ fontSize: 11, color: "var(--text-faint)" }}>
                {portionItem.source === "off" ? "Open Food Facts" : "USDA"} data per 100g — adjust your portion below
              </div>
            </div>
          </div>

          {/* Preset buttons */}
          <div className="portion-presets">
            {PRESETS.map(function(p) {
              return (
                <button key={p.label} className={"portion-preset" + (portionGrams === p.g ? " active" : "")} onClick={function() { setPortionGrams(p.g); }}>
                  {p.label}
                </button>
              );
            })}
          </div>

          {/* Amount input */}
          <div className="flex-row" style={{ gap: 12, marginBottom: 4 }}>
            <span style={{ fontSize: 12, fontWeight: 600, color: "var(--text-dim)", flexShrink: 0 }}>Amount:</span>
            <input
              className="input mono" type="number" inputMode="decimal"
              value={portionGrams}
              onChange={function(e) { setPortionGrams(Math.max(0, parseFloat(e.target.value) || 0)); }}
              style={{ width: 80, padding: "6px 10px", fontSize: 14, textAlign: "center" }}
            />
            <span style={{ fontSize: 12, color: "var(--text-faint)" }}>grams</span>
          </div>

          {/* Slider */}
          <input
            type="range" className="portion-slider"
            min="10" max="500" step="5"
            value={portionGrams}
            onChange={function(e) { setPortionGrams(parseInt(e.target.value)); }}
          />
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10, color: "var(--text-faint)", marginBottom: 16 }}>
            <span>10g</span><span>500g</span>
          </div>

          {/* Nutrition preview */}
          <div style={{ background: "var(--surface)", borderRadius: 10, padding: "10px 14px", border: "1px solid var(--border)", marginBottom: 16 }}>
            <div style={{ fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: 1, color: "var(--text-muted)", marginBottom: 8 }}>
              Nutrition for {portionGrams}g
            </div>
            <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
              <span className="mono" style={{ fontSize: 13, fontWeight: 600, color: "var(--orange)" }}>{Math.round(portionItem.cal * portionGrams / 100)} cal</span>
              <span className="mono" style={{ fontSize: 13, color: "var(--blue)" }}>{Math.round(portionItem.protein * portionGrams / 100)}g P</span>
              <span className="mono" style={{ fontSize: 13, color: "var(--yellow)" }}>{Math.round(portionItem.carbs * portionGrams / 100)}g C</span>
              <span className="mono" style={{ fontSize: 13, color: "var(--purple)" }}>{Math.round(portionItem.fats * portionGrams / 100)}g F</span>
            </div>
            <div style={{ display: "flex", gap: 10, marginTop: 4 }}>
              <span style={{ fontSize: 10, color: "var(--text-faint)" }}>Na: {Math.round(portionItem.sodium * portionGrams / 100)}mg</span>
              <span style={{ fontSize: 10, color: "var(--text-faint)" }}>Sugar: {Math.round(portionItem.sugar * portionGrams / 100)}g</span>
              <span style={{ fontSize: 10, color: "var(--text-faint)" }}>Fiber: {Math.round(portionItem.fiber * portionGrams / 100)}g</span>
            </div>
          </div>

          {/* Action buttons */}
          <div style={{ display: "flex", gap: 8 }}>
            <button className="btn" onClick={function() { setPortionItem(null); }} style={{ flex: 1, padding: 14, borderRadius: 10, background: "var(--surface)", color: "var(--text-dim)", border: "1px solid var(--border)" }}>
              Cancel
            </button>
            <button className="btn btn-primary" style={{ flex: 2 }} onClick={confirmPortion}>
              Log {portionGrams}g
            </button>
          </div>
        </div>
      </div>
    );
  }

  Components.PortionModal = PortionModal;

})(window.PhysIQ.Components, window.PhysIQ.Utils);
