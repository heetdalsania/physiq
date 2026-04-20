/* ─── PHYSIQ ENGINE — Dashboard Tab ──────────────────────────────────────── */

window.PhysIQ = window.PhysIQ || {};
window.PhysIQ.Screens = window.PhysIQ.Screens || {};

(function(Screens, Components, Data) {

  var ProgressRing = Components.ProgressRing;
  var NutrientCard = Components.NutrientCard;
  var NUTRIENT_INFO = Data.NUTRIENT_INFO;
  var MUSCLE_GROUPS = Data.MUSCLE_GROUPS;

  // Suggestion styling
  var SUGGESTION_COLORS = { critical: "#EF4444", warning: "#FBBF24", info: "#3B82F6", muscle: "#A855F7" };
  var SUGGESTION_ICONS = { critical: "\u26A0", warning: "\u26A1", info: "\uD83D\uDCA1", muscle: "\uD83D\uDCAA" };

  function DashboardTab({ intake, targets, profile, suggestions, mealLog, addWater, removeMeal, resetDay, onQuickNav }) {
    // Compute macro data locally
    var macroData = [
      { label: "Protein", val: intake.protein, target: targets.protein, cal: intake.protein * 4, color: "var(--blue)" },
      { label: "Carbs",   val: intake.carbs,   target: targets.carbs,   cal: intake.carbs * 4,   color: "var(--yellow)" },
      { label: "Fats",    val: intake.fats,    target: targets.fats,    cal: intake.fats * 9,    color: "var(--purple)" }
    ];
    var totalMC = macroData.reduce(function(s, m) { return s + m.cal; }, 0) || 1;

    return (
      <div className="fade-in">
        {/* Calorie ring + macro split */}
        <div className="flex-row" style={{ gap: 20, padding: "16px 0 20px" }}>
          <ProgressRing value={intake.calories} max={targets.calories} color="var(--orange)">
            <span className="mono" style={{ fontSize: 20, fontWeight: 700, color: "var(--text-white)" }}>{intake.calories}</span>
            <span style={{ fontSize: 9, color: "var(--text-muted)" }}>/ {targets.calories}</span>
          </ProgressRing>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 11, color: "var(--text-muted)", marginBottom: 8 }}>MACRO SPLIT</div>
            <div style={{ display: "flex", gap: 2, height: 8, borderRadius: 4, overflow: "hidden", marginBottom: 10 }}>
              {macroData.map(function(m) { return <div key={m.label} style={{ flex: m.cal / totalMC, background: m.color, transition: "flex .4s" }} />; })}
            </div>
            {macroData.map(function(m) {
              return (
                <div key={m.label} className="flex-row" style={{ gap: 6, marginBottom: 4 }}>
                  <div style={{ width: 6, height: 6, borderRadius: "50%", background: m.color }} />
                  <span style={{ fontSize: 11, color: "var(--text-dim)", flex: 1 }}>{m.label}</span>
                  <span className="mono" style={{ fontSize: 12, fontWeight: 600, color: m.val >= m.target ? "var(--green)" : "var(--text)" }}>{m.val}g</span>
                  <span style={{ fontSize: 10, color: "var(--text-faint)" }}>/{m.target}g</span>
                </div>
              );
            })}
          </div>
        </div>

        {/* Water tracker */}
        <div style={{ background: "var(--water-bg)", borderRadius: 12, padding: 14, border: "1px solid var(--water-border)", marginBottom: 16 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
            <span style={{ fontSize: 12, fontWeight: 600, color: "var(--sky)" }}>Water</span>
            <span className="mono" style={{ fontSize: 13, fontWeight: 700, color: "var(--text-bright)" }}>
              {intake.water}oz <span style={{ color: "var(--text-faint)", fontWeight: 400 }}>/ {targets.water}oz</span>
            </span>
          </div>
          <div style={{ height: 6, borderRadius: 3, background: "var(--track)", overflow: "hidden", marginBottom: 10 }}>
            <div style={{ height: "100%", borderRadius: 3, width: Math.min(intake.water / (targets.water || 1) * 100, 100) + "%", background: "linear-gradient(90deg,#0EA5E9,#38BDF8)", transition: "width .4s" }} />
          </div>
          <div style={{ display: "flex", gap: 6 }}>
            <button className="water-btn subtract" onClick={function() { addWater(-8); }}>-8oz</button>
            {[8, 16, 24].map(function(oz) {
              return <button key={oz} className="water-btn" onClick={function() { addWater(oz); }}>+{oz}oz</button>;
            })}
          </div>
        </div>

        {/* Key Nutrients */}
        <div className="label">Key Nutrients</div>
        <div className="grid-2" style={{ marginBottom: 20 }}>
          {["protein", "sodium", "potassium", "sugar", "fiber", "creatine"].map(function(id) {
            return <NutrientCard key={id} id={id} value={intake[id] || 0} target={targets[id]} />;
          })}
        </div>

        {/* Micronutrients */}
        <div className="label">Micronutrients</div>
        <div className="card" style={{ padding: "8px 14px", marginBottom: 20 }}>
          {["calcium", "magnesium", "iron", "zinc", "vitaminD", "b12", "omega3"].map(function(id) {
            return <NutrientCard key={id} id={id} value={intake[id] || 0} target={targets[id]} compact />;
          })}
        </div>

        {/* Smart Suggestions */}
        {suggestions.length > 0 && (
          <React.Fragment>
            <div className="label">Smart Suggestions</div>
            <div className="flex-col gap-8" style={{ marginBottom: 20 }}>
              {suggestions.map(function(s, i) {
                return (
                  <div key={i} className="suggestion" style={{ background: SUGGESTION_COLORS[s.type] + "08", border: "1px solid " + SUGGESTION_COLORS[s.type] + "22" }}>
                    <span style={{ marginRight: 8 }}>{SUGGESTION_ICONS[s.type]}</span>{s.text}
                  </div>
                );
              })}
            </div>
          </React.Fragment>
        )}

        {/* Today's Muscles */}
        {profile.todayMuscles.length > 0 && (
          <React.Fragment>
            <div className="label">Today's Muscles</div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 20 }}>
              {profile.todayMuscles.map(function(id) {
                var mg = MUSCLE_GROUPS.find(function(m) { return m.id === id; });
                return <div key={id} className="muscle-tag">{mg ? mg.icon : ""} {mg ? mg.label : ""}</div>;
              })}
            </div>
          </React.Fragment>
        )}

        {/* Today's Meals */}
        {mealLog.length > 0 && (
          <React.Fragment>
            <div className="label">Today's Meals</div>
            <div className="flex-col gap-6" style={{ marginBottom: 20 }}>
              {mealLog.map(function(m) {
                return (
                  <div key={m.id} className="meal-row">
                    <span className="mono" style={{ fontSize: 10, color: "var(--text-faint)" }}>{m.time}</span>
                    <span style={{ flex: 1, fontSize: 12, fontWeight: 500 }}>{m.name}</span>
                    <span className="mono" style={{ fontSize: 11, color: "var(--orange)" }}>{m.calories}</span>
                    <span className="mono" style={{ fontSize: 11, color: "var(--blue)" }}>{m.protein}P</span>
                    <button className="meal-remove" onClick={function() { removeMeal(m.id); }}>{"\u00D7"}</button>
                  </div>
                );
              })}
            </div>
          </React.Fragment>
        )}

        {/* Reset button */}
        <div style={{ display: "flex", justifyContent: "center", paddingBottom: 20 }}>
          <button className="reset-btn" onClick={resetDay}>Reset Today</button>
        </div>
      </div>
    );
  }

  Screens.DashboardTab = DashboardTab;

})(window.PhysIQ.Screens, window.PhysIQ.Components, window.PhysIQ.Data);
