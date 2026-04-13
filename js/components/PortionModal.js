/* ─── PHYSIQ ENGINE — PortionModal Component ─────────────────────────────── */

window.PhysIQ = window.PhysIQ || {};
window.PhysIQ.Components = window.PhysIQ.Components || {};

(function(Components, Utils) {

  var NUTRI_SCORE_COLORS = Utils.NUTRI_SCORE_COLORS || {};
  var useState = React.useState;
  var useEffect = React.useEffect;

  function PortionModal({ portionItem, setPortionItem, portionGrams, setPortionGrams, portionUnit, setPortionUnit, portionCount, setPortionCount, confirmPortion }) {
    if (!portionItem) return null;

    // ── Unit type: "grams" or "count" ──────────────────────────────────
    var unit = portionUnit || "grams";

    var GRAM_PRESETS = [
      { label: "Small (50g)",  g: 50 },
      { label: "100g",         g: 100 },
      { label: "Medium (150g)",g: 150 },
      { label: "Large (200g)", g: 200 },
      { label: "1 oz (28g)",   g: 28 },
      { label: "4 oz (113g)",  g: 113 },
      { label: "6 oz (170g)",  g: 170 },
      { label: "8 oz (227g)",  g: 227 }
    ];

    var COUNT_PRESETS = [
      { label: "1",   c: 1 },
      { label: "2",   c: 2 },
      { label: "3",   c: 3 },
      { label: "4",   c: 4 },
      { label: "5",   c: 5 },
      { label: "6",   c: 6 },
      { label: "8",   c: 8 },
      { label: "10",  c: 10 },
      { label: "12",  c: 12 }
    ];

    var hasImage = portionItem.image && portionItem.image.length > 0;
    var hasNutriScore = portionItem.nutriScore && NUTRI_SCORE_COLORS[portionItem.nutriScore];

    // ── Compute the base nutrition for one "count" item ─────────────────
    // Food data from Open Food Facts is per 100g, and portionItem.serving
    // has the actual serving size string like "30g", "1 cookie (28g)", etc.
    // We parse out the gram value from serving to know what 1 item weighs.
    var servingGrams = (function() {
      if (portionItem._servingGrams) return portionItem._servingGrams;
      if (!portionItem.serving) return 100;
      // Try to extract gram value from strings like "30g", "1 cookie (28g)", "45 g"
      var match = portionItem.serving.match(/(\d+\.?\d*)\s*g/i);
      if (match) return parseFloat(match[1]);
      return 100;
    })();

    // ── Compute nutrition based on current unit mode ────────────────────
    var scale;
    if (portionItem._perServing) {
      if (unit === "count") {
        scale = portionCount; // Base values are ALREADY exactly 1 serving
      } else {
        scale = servingGrams > 0 ? (portionGrams / servingGrams) : 1;
      }
    } else {
      if (unit === "count") {
        scale = (portionCount * servingGrams) / 100;
      } else {
        scale = portionGrams / 100;
      }
    }

    var previewNutrition = {
      cal:       Math.round(portionItem.cal      * scale),
      protein:   Math.round(portionItem.protein   * scale),
      carbs:     Math.round(portionItem.carbs     * scale),
      fats:      Math.round(portionItem.fats      * scale),
      sodium:    Math.round(portionItem.sodium    * scale),
      sugar:     Math.round(portionItem.sugar     * scale),
      fiber:     Math.round(portionItem.fiber     * scale)
    };

    var portionLabel;
    if (unit === "count") {
      portionLabel = portionCount + (portionCount === 1 ? " item" : " items") + " (" + Math.round(portionCount * servingGrams) + "g)";
    } else {
      portionLabel = portionGrams + "g";
    }

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
                {portionItem.source === "off" ? "Open Food Facts" : "USDA"} data {portionItem._perServing ? "per serving" : "per 100g"} — adjust your portion below
              </div>
            </div>
          </div>

          {/* ── Unit Type Toggle ───────────────────────────────────────── */}
          <div className="portion-unit-toggle">
            <button
              className={"portion-unit-btn" + (unit === "grams" ? " active" : "")}
              onClick={function() { setPortionUnit("grams"); }}
            >
              <span className="portion-unit-icon">⚖️</span>
              <span>Grams</span>
            </button>
            <button
              className={"portion-unit-btn" + (unit === "count" ? " active" : "")}
              onClick={function() { setPortionUnit("count"); }}
            >
              <span className="portion-unit-icon">🔢</span>
              <span>Count</span>
            </button>
          </div>

          {/* ── GRAMS MODE ────────────────────────────────────────────── */}
          {unit === "grams" && (
            <div className="fade-in">
              {/* Preset buttons */}
              <div className="portion-presets">
                {GRAM_PRESETS.map(function(p) {
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
            </div>
          )}

          {/* ── COUNT MODE ────────────────────────────────────────────── */}
          {unit === "count" && (
            <div className="fade-in">
              {/* Serving info */}
              <div className="portion-serving-info">
                <span className="portion-serving-icon">📦</span>
                <span>1 item = {servingGrams}g (from: {portionItem.serving || "100g"})</span>
              </div>

              {/* Count preset buttons */}
              <div className="portion-presets">
                {COUNT_PRESETS.map(function(p) {
                  return (
                    <button key={p.label} className={"portion-preset" + (portionCount === p.c ? " active" : "")} onClick={function() { setPortionCount(p.c); }}>
                      {p.label}
                    </button>
                  );
                })}
              </div>

              {/* Count input */}
              <div className="flex-row" style={{ gap: 12, marginBottom: 4 }}>
                <span style={{ fontSize: 12, fontWeight: 600, color: "var(--text-dim)", flexShrink: 0 }}>Count:</span>
                <input
                  className="input mono" type="number" inputMode="numeric"
                  value={portionCount}
                  onChange={function(e) { setPortionCount(Math.max(0, parseInt(e.target.value) || 0)); }}
                  style={{ width: 80, padding: "6px 10px", fontSize: 14, textAlign: "center" }}
                />
                <span style={{ fontSize: 12, color: "var(--text-faint)" }}>{portionCount === 1 ? "item" : "items"}</span>
              </div>

              {/* Count Slider */}
              <input
                type="range" className="portion-slider"
                min="1" max="20" step="1"
                value={portionCount}
                onChange={function(e) { setPortionCount(parseInt(e.target.value)); }}
              />
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10, color: "var(--text-faint)", marginBottom: 16 }}>
                <span>1</span><span>20</span>
              </div>
            </div>
          )}

          {/* Nutrition preview */}
          <div style={{ background: "var(--surface)", borderRadius: 10, padding: "10px 14px", border: "1px solid var(--border)", marginBottom: 16 }}>
            <div style={{ fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: 1, color: "var(--text-muted)", marginBottom: 8 }}>
              Nutrition for {portionLabel}
            </div>
            <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
              <span className="mono" style={{ fontSize: 13, fontWeight: 600, color: "var(--orange)" }}>{previewNutrition.cal} cal</span>
              <span className="mono" style={{ fontSize: 13, color: "var(--blue)" }}>{previewNutrition.protein}g P</span>
              <span className="mono" style={{ fontSize: 13, color: "var(--yellow)" }}>{previewNutrition.carbs}g C</span>
              <span className="mono" style={{ fontSize: 13, color: "var(--purple)" }}>{previewNutrition.fats}g F</span>
            </div>
            <div style={{ display: "flex", gap: 10, marginTop: 4 }}>
              <span style={{ fontSize: 10, color: "var(--text-faint)" }}>Na: {previewNutrition.sodium}mg</span>
              <span style={{ fontSize: 10, color: "var(--text-faint)" }}>Sugar: {previewNutrition.sugar}g</span>
              <span style={{ fontSize: 10, color: "var(--text-faint)" }}>Fiber: {previewNutrition.fiber}g</span>
            </div>
          </div>

          {/* Action buttons */}
          <div style={{ display: "flex", gap: 8 }}>
            <button className="btn" onClick={function() { setPortionItem(null); }} style={{ flex: 1, padding: 14, borderRadius: 10, background: "var(--surface)", color: "var(--text-dim)", border: "1px solid var(--border)" }}>
              Cancel
            </button>
            <button className="btn btn-primary" style={{ flex: 2 }} onClick={confirmPortion}>
              Log {portionLabel}
            </button>
          </div>
        </div>
      </div>
    );
  }

  Components.PortionModal = PortionModal;

})(window.PhysIQ.Components, window.PhysIQ.Utils);
