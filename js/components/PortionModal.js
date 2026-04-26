/* ─── PHYSIQ ENGINE — PortionModal Component ─────────────────────────────── */

window.PhysIQ = window.PhysIQ || {};
window.PhysIQ.Components = window.PhysIQ.Components || {};

(function(Components, Utils) {

  var NUTRI_SCORE_COLORS = Utils.NUTRI_SCORE_COLORS || {};
  var useState = React.useState;
  var useEffect = React.useEffect;

  function PortionModal({ portionItem, setPortionItem, portionGrams, setPortionGrams, portionUnit, setPortionUnit, portionCount, setPortionCount, confirmPortion }) {
    if (!portionItem) return null;

    // ── Local state for custom grams input ──────────────────────────────
    var _showCustom = useState(false);
    var showCustom = _showCustom[0], setShowCustom = _showCustom[1];

    // ── Determine serving size ──────────────────────────────────────────
    var servingGrams = (function() {
      if (portionItem._servingGrams) return portionItem._servingGrams;
      if (!portionItem.serving) return 100;
      var match = portionItem.serving.match(/(\d+\.?\d*)\s*g/i);
      if (match) return parseFloat(match[1]);
      return 100;
    })();

    var servingLabel = portionItem.serving || (servingGrams + "g");
    var hasImage = portionItem.image && portionItem.image.length > 0;
    var hasNutriScore = portionItem.nutriScore && NUTRI_SCORE_COLORS[portionItem.nutriScore];
    var isPerServing = portionItem._perServing;

    // ── Serving multiplier presets ──────────────────────────────────────
    var SERVING_PRESETS = [
      { label: "½",   mult: 0.5 },
      { label: "1",   mult: 1   },
      { label: "1½",  mult: 1.5 },
      { label: "2",   mult: 2   },
      { label: "3",   mult: 3   }
    ];

    // ── Determine current mode and active multiplier ────────────────────
    var currentMode = portionUnit; // "servings" or "custom"
    var currentMult = portionCount;

    // ── Compute nutrition based on current selection ─────────────────────
    var scale;
    if (currentMode === "custom") {
      // Custom grams mode
      if (isPerServing) {
        scale = servingGrams > 0 ? (portionGrams / servingGrams) : 1;
      } else {
        scale = portionGrams / 100;
      }
    } else {
      // Serving multiplier mode
      if (isPerServing) {
        scale = currentMult; // Base values are already 1 serving
      } else {
        scale = (currentMult * servingGrams) / 100;
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

    // Compute display grams for the serving multiplier mode
    var displayGrams = currentMode === "custom"
      ? portionGrams
      : Math.round(currentMult * servingGrams);

    // ── Portion label for the log button ────────────────────────────────
    var portionLabel;
    if (currentMode === "custom") {
      portionLabel = portionGrams + "g";
    } else {
      var multLabel = currentMult === 1 ? "1 serving"
        : currentMult === 0.5 ? "½ serving"
        : currentMult === 1.5 ? "1½ servings"
        : currentMult + " servings";
      portionLabel = multLabel + " (" + displayGrams + "g)";
    }

    // ── Macro total for the donut chart ─────────────────────────────────
    var macroTotal = previewNutrition.protein + previewNutrition.carbs + previewNutrition.fats;
    var proteinPct = macroTotal > 0 ? (previewNutrition.protein / macroTotal) * 100 : 33;
    var carbsPct = macroTotal > 0 ? (previewNutrition.carbs / macroTotal) * 100 : 33;
    var fatsPct = macroTotal > 0 ? (previewNutrition.fats / macroTotal) * 100 : 34;

    // ── Select a serving preset ─────────────────────────────────────────
    var selectServing = function(mult) {
      setPortionUnit("servings");
      setPortionCount(mult);
      setShowCustom(false);
    };

    var selectCustom = function() {
      setPortionUnit("custom");
      setPortionGrams(displayGrams || servingGrams);
      setShowCustom(true);
    };

    return (
      <div className="portion-overlay" onClick={function(e) { if (e.target === e.currentTarget) setPortionItem(null); }}>
        <div className="portion-modal">

          {/* ── Header ──────────────────────────────────────────────── */}
          <div className="portion-modal-header">
            {hasImage && (
              <div className="portion-modal-thumb">
                <img src={portionItem.image} alt="" onError={function(e) { e.target.parentElement.style.display = "none"; }} />
              </div>
            )}
            <div className="portion-modal-title-wrap">
              <div className="portion-item-name">
                {portionItem.name.toLowerCase()}
                {hasNutriScore && (
                  <span className="portion-nutri-badge" style={{ background: NUTRI_SCORE_COLORS[portionItem.nutriScore], marginLeft: 8 }}>
                    {portionItem.nutriScore}
                  </span>
                )}
              </div>
              {portionItem.brand && <div className="portion-item-brand">{portionItem.brand}</div>}
              <div className="portion-item-source">
                {portionItem.source === "off" ? "Open Food Facts" : "USDA"} · {isPerServing ? "per serving" : "per 100g"}
              </div>
            </div>
          </div>

          {/* ── Serving Size Info ────────────────────────────────────── */}
          <div className="portion-serving-badge">
            <span className="portion-serving-badge-icon">📦</span>
            <span className="portion-serving-badge-text">
              1 serving = {servingLabel}
              {servingGrams > 0 && !servingLabel.match(/^\d+g$/) && " (" + servingGrams + "g)"}
            </span>
          </div>

          {/* ── Serving Multiplier Buttons ───────────────────────────── */}
          <div className="portion-multiplier-section">
            <div className="portion-multiplier-label">How much?</div>
            <div className="portion-multiplier-row">
              {SERVING_PRESETS.map(function(p) {
                var isActive = currentMode === "servings" && currentMult === p.mult;
                return (
                  <button
                    key={p.label}
                    className={"portion-mult-btn" + (isActive ? " active" : "")}
                    onClick={function() { selectServing(p.mult); }}
                  >
                    <span className="portion-mult-value">{p.label}</span>
                    <span className="portion-mult-unit">
                      {p.mult === 1 ? "serving" : "servings"}
                    </span>
                  </button>
                );
              })}
              <button
                className={"portion-mult-btn custom-btn" + (currentMode === "custom" ? " active" : "")}
                onClick={selectCustom}
              >
                <span className="portion-mult-value">⚙</span>
                <span className="portion-mult-unit">Custom</span>
              </button>
            </div>
          </div>

          {/* ── Custom Grams Input (only shown when custom selected) ── */}
          {showCustom && currentMode === "custom" && (
            <div className="portion-custom-section fade-in">
              <div className="portion-custom-row">
                <input
                  className="input mono portion-custom-input"
                  type="number"
                  inputMode="decimal"
                  value={portionGrams}
                  onChange={function(e) { setPortionGrams(Math.max(0, parseFloat(e.target.value) || 0)); }}
                  autoFocus
                />
                <span className="portion-custom-unit">grams</span>
              </div>
              <input
                type="range"
                className="portion-slider"
                min="5"
                max="1000"
                step="5"
                value={portionGrams}
                onChange={function(e) { setPortionGrams(parseInt(e.target.value)); }}
              />
              <div className="portion-slider-labels">
                <span>5g</span><span>1000g</span>
              </div>
            </div>
          )}

          {/* ── Nutrition Preview ────────────────────────────────────── */}
          <div className="portion-nutrition-card">
            <div className="portion-nutrition-header">
              <span className="portion-nutrition-title">Nutrition</span>
              <span className="portion-nutrition-amount">{displayGrams}g</span>
            </div>

            {/* Calories — prominent */}
            <div className="portion-cal-display">
              <span className="portion-cal-number mono">{previewNutrition.cal}</span>
              <span className="portion-cal-label">calories</span>
            </div>

            {/* Macro bars */}
            <div className="portion-macro-bars">
              <div className="portion-macro-row">
                <div className="portion-macro-info">
                  <span className="portion-macro-dot" style={{ background: "var(--blue)" }} />
                  <span className="portion-macro-name">Protein</span>
                </div>
                <span className="portion-macro-value mono" style={{ color: "var(--blue)" }}>{previewNutrition.protein}g</span>
              </div>
              <div className="portion-macro-row">
                <div className="portion-macro-info">
                  <span className="portion-macro-dot" style={{ background: "var(--yellow)" }} />
                  <span className="portion-macro-name">Carbs</span>
                </div>
                <span className="portion-macro-value mono" style={{ color: "var(--yellow)" }}>{previewNutrition.carbs}g</span>
              </div>
              <div className="portion-macro-row">
                <div className="portion-macro-info">
                  <span className="portion-macro-dot" style={{ background: "var(--purple)" }} />
                  <span className="portion-macro-name">Fat</span>
                </div>
                <span className="portion-macro-value mono" style={{ color: "var(--purple)" }}>{previewNutrition.fats}g</span>
              </div>
            </div>

            {/* Macro distribution bar */}
            <div className="portion-macro-dist">
              <div className="portion-macro-dist-bar">
                <div style={{ width: proteinPct + "%", background: "var(--blue)", borderRadius: "4px 0 0 4px" }} />
                <div style={{ width: carbsPct + "%", background: "var(--yellow)" }} />
                <div style={{ width: fatsPct + "%", background: "var(--purple)", borderRadius: "0 4px 4px 0" }} />
              </div>
            </div>

            {/* Micro nutrients — compact row */}
            <div className="portion-micro-row">
              <span>Na: {previewNutrition.sodium}mg</span>
              <span>Sugar: {previewNutrition.sugar}g</span>
              <span>Fiber: {previewNutrition.fiber}g</span>
            </div>
          </div>

          {/* ── Action Buttons ───────────────────────────────────────── */}
          <div className="portion-actions">
            <button className="portion-cancel-btn" onClick={function() { setPortionItem(null); }}>
              Cancel
            </button>
            <button className="portion-log-btn" onClick={confirmPortion}>
              Log {portionLabel}
            </button>
          </div>
        </div>
      </div>
    );
  }

  Components.PortionModal = PortionModal;

})(window.PhysIQ.Components, window.PhysIQ.Utils);
