/* ─── PHYSIQ ENGINE — MealPeriodHeader Component (with Drag & Drop) ────── */

window.PhysIQ = window.PhysIQ || {};
window.PhysIQ.Components = window.PhysIQ.Components || {};

(function(Components, Utils) {

  var useState = React.useState;
  var MEAL_PERIODS = Utils.MEAL_PERIODS;

  function MealPeriodHeader(props) {
    var mealLog = props.mealLog;
    var expandedPeriod = props.expandedPeriod;
    var setExpandedPeriod = props.setExpandedPeriod;
    var removeMeal = props.removeMeal;
    var onAddFood = props.onAddFood;
    var moveMealToPeriod = props.moveMealToPeriod;

    // Drag state
    var _dd = useState(null); var draggedMealId = _dd[0], setDraggedMealId = _dd[1];
    var _dt = useState(null); var dropTarget = _dt[0], setDropTarget = _dt[1];

    // ─── Drag Handlers ──────────────────────────────────────────────
    var handleDragStart = function(e, mealId) {
      setDraggedMealId(mealId);
      e.dataTransfer.effectAllowed = "move";
      e.dataTransfer.setData("text/plain", String(mealId));
      // Make the drag image slightly transparent
      if (e.target && e.target.style) {
        setTimeout(function() { e.target.style.opacity = "0.4"; }, 0);
      }
    };

    var handleDragEnd = function(e) {
      setDraggedMealId(null);
      setDropTarget(null);
      if (e.target && e.target.style) {
        e.target.style.opacity = "1";
      }
    };

    var handleDragOver = function(e, periodId) {
      e.preventDefault();
      e.dataTransfer.dropEffect = "move";
      if (dropTarget !== periodId) {
        setDropTarget(periodId);
      }
    };

    var handleDragLeave = function(e, periodId) {
      // Only clear if we're actually leaving the card (not entering a child)
      var relatedTarget = e.relatedTarget;
      var currentTarget = e.currentTarget;
      if (currentTarget && !currentTarget.contains(relatedTarget)) {
        setDropTarget(null);
      }
    };

    var handleDrop = function(e, targetPeriodId) {
      e.preventDefault();
      var mealId = parseInt(e.dataTransfer.getData("text/plain"));
      setDraggedMealId(null);
      setDropTarget(null);

      if (mealId && moveMealToPeriod) {
        // Find the meal to check if it's actually moving to a different period
        var meal = mealLog.find(function(m) { return m.id === mealId; });
        if (meal && meal.period !== targetPeriodId) {
          moveMealToPeriod(mealId, targetPeriodId);
        }
      }
    };

    // ─── Touch Drag Support ─────────────────────────────────────────
    var _td = useState(null); var touchDragId = _td[0], setTouchDragId = _td[1];
    var _tp = useState(null); var touchStartPos = _tp[0], setTouchStartPos = _tp[1];
    var _tg = useState(null); var touchGhost = _tg[0], setTouchGhost = _tg[1];

    var handleTouchStart = function(e, mealId) {
      var touch = e.touches[0];
      setTouchDragId(mealId);
      setTouchStartPos({ x: touch.clientX, y: touch.clientY });
    };

    var handleTouchMove = function(e) {
      if (!touchDragId) return;
      var touch = e.touches[0];
      var dx = Math.abs(touch.clientX - (touchStartPos ? touchStartPos.x : 0));
      var dy = Math.abs(touch.clientY - (touchStartPos ? touchStartPos.y : 0));

      // Only start drag if moved more than 10px vertically
      if (dy > 10 || dx > 5) {
        e.preventDefault();

        // Find which period we're hovering over
        var el = document.elementFromPoint(touch.clientX, touch.clientY);
        if (el) {
          var card = el.closest(".meal-period-card");
          if (card) {
            var periodId = card.getAttribute("data-period");
            if (periodId && periodId !== dropTarget) {
              setDropTarget(periodId);
            }
          } else {
            setDropTarget(null);
          }
        }
      }
    };

    var handleTouchEnd = function(e) {
      if (touchDragId && dropTarget) {
        var meal = mealLog.find(function(m) { return m.id === touchDragId; });
        if (meal && meal.period !== dropTarget && moveMealToPeriod) {
          moveMealToPeriod(touchDragId, dropTarget);
        }
      }
      setTouchDragId(null);
      setTouchStartPos(null);
      setDropTarget(null);
    };

    return (
      <div className="meal-periods-container"
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
      >
        {MEAL_PERIODS.map(function(period) {
          var periodMeals = mealLog.filter(function(m) { return m.period === period.id; });
          var periodCals = periodMeals.reduce(function(sum, m) { return sum + (m.calories || 0); }, 0);
          var isExpanded = expandedPeriod === period.id;
          var isDragOver = dropTarget === period.id;
          var isDragging = draggedMealId !== null || touchDragId !== null;

          return (
            <div key={period.id}
              data-period={period.id}
              className={"meal-period-card" + (isExpanded ? " expanded" : "") + (isDragOver ? " drag-over" : "") + (isDragging ? " drag-active" : "")}
              onDragOver={function(e) { handleDragOver(e, period.id); }}
              onDragLeave={function(e) { handleDragLeave(e, period.id); }}
              onDrop={function(e) { handleDrop(e, period.id); }}
            >
              <div className="meal-period-header" onClick={function() { setExpandedPeriod(isExpanded ? null : period.id); }}>
                <div className="meal-period-left">
                  <span className={"meal-period-icon pq-icon " + period.iconClass} aria-hidden="true"></span>
                  <div>
                    <div className="meal-period-label">{period.label}</div>
                    <div className="meal-period-count">
                      {isDragOver && isDragging ? (
                        <span className="meal-period-drop-hint">Drop here to move</span>
                      ) : (
                        periodMeals.length === 0 ? period.hours : periodMeals.length + " item" + (periodMeals.length !== 1 ? "s" : "")
                      )}
                    </div>
                  </div>
                </div>
                <div className="meal-period-right">
                  <span className={"meal-period-cals mono" + (periodCals > 0 ? " has-cals" : "")}>{periodCals > 0 ? periodCals + " cal" : "—"}</span>
                  <button className="meal-period-add-btn" onClick={function(e) { e.stopPropagation(); onAddFood(period.id); }} title={"Add food to " + period.label}>
                    +
                  </button>
                  <span className={"meal-period-chevron" + (isExpanded ? " open" : "")}>›</span>
                </div>
              </div>

              {isExpanded && periodMeals.length > 0 && (
                <div className="meal-period-items">
                  {periodMeals.map(function(meal) {
                    var isBeingDragged = draggedMealId === meal.id || touchDragId === meal.id;
                    return (
                      <div key={meal.id}
                        className={"meal-period-item" + (isBeingDragged ? " dragging" : "")}
                        draggable="true"
                        onDragStart={function(e) { handleDragStart(e, meal.id); }}
                        onDragEnd={handleDragEnd}
                        onTouchStart={function(e) { handleTouchStart(e, meal.id); }}
                      >
                        <div className="meal-period-item-grip" title="Drag to move">⠿</div>
                        <div className="meal-period-item-info">
                          <div className="meal-period-item-name">{meal.name}</div>
                          <div className="meal-period-item-macros">
                            <span style={{ color: "var(--blue)" }}>{meal.protein || 0}P</span>
                            <span style={{ color: "var(--yellow)" }}>{meal.carbs || 0}C</span>
                            <span style={{ color: "var(--purple)" }}>{meal.fats || 0}F</span>
                          </div>
                        </div>
                        <div className="meal-period-item-right">
                          <span className="mono meal-period-item-cal">{meal.calories || 0}</span>
                          <button className="meal-period-item-remove" onClick={function() { removeMeal(meal.id); }} title="Remove">×</button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}

              {isExpanded && periodMeals.length === 0 && (
                <div className={"meal-period-empty" + (isDragOver ? " drag-over" : "")}>
                  {isDragOver && isDragging ? (
                    <span className="meal-period-drop-hint-lg">⬇ Drop food here</span>
                  ) : (
                    <React.Fragment>
                      <span>No foods logged yet</span>
                      <button className="meal-period-empty-add" onClick={function() { onAddFood(period.id); }}>
                        + Add Food
                      </button>
                    </React.Fragment>
                  )}
                </div>
              )}
            </div>
          );
        })}

        {/* Drag instruction hint */}
        {(draggedMealId || touchDragId) && (
          <div className="meal-drag-hint fade-in">
            Drag to another meal period to move
          </div>
        )}
      </div>
    );
  }

  Components.MealPeriodHeader = MealPeriodHeader;

})(window.PhysIQ.Components, window.PhysIQ.Utils);
