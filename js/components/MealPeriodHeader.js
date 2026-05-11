/* ─── PHYSIQ ENGINE — MealPeriodHeader Component (with Drag & Drop) ────── */

import React, { useState } from "react";
import { MEAL_PERIODS } from "../utils/foodSearch.js";

export function MealPeriodHeader(props) {
  const mealLog = props.mealLog;
  const expandedPeriod = props.expandedPeriod;
  const setExpandedPeriod = props.setExpandedPeriod;
  const removeMeal = props.removeMeal;
  const onAddFood = props.onAddFood;
  const moveMealToPeriod = props.moveMealToPeriod;

  const [draggedMealId, setDraggedMealId] = useState(null);
  const [dropTarget, setDropTarget] = useState(null);

  const handleDragStart = function(e, mealId) {
    setDraggedMealId(mealId);
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", String(mealId));
    if (e.target && e.target.style) {
      setTimeout(function() { e.target.style.opacity = "0.4"; }, 0);
    }
  };

  const handleDragEnd = function(e) {
    setDraggedMealId(null);
    setDropTarget(null);
    if (e.target && e.target.style) {
      e.target.style.opacity = "1";
    }
  };

  const handleDragOver = function(e, periodId) {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    if (dropTarget !== periodId) {
      setDropTarget(periodId);
    }
  };

  const handleDragLeave = function(e, periodId) {
    const relatedTarget = e.relatedTarget;
    const currentTarget = e.currentTarget;
    if (currentTarget && !currentTarget.contains(relatedTarget)) {
      setDropTarget(null);
    }
  };

  const handleDrop = function(e, targetPeriodId) {
    e.preventDefault();
    const mealId = parseInt(e.dataTransfer.getData("text/plain"));
    setDraggedMealId(null);
    setDropTarget(null);

    if (mealId && moveMealToPeriod) {
      const meal = mealLog.find(function(m) { return m.id === mealId; });
      if (meal && meal.period !== targetPeriodId) {
        moveMealToPeriod(mealId, targetPeriodId);
      }
    }
  };

  const [touchDragId, setTouchDragId] = useState(null);
  const [touchStartPos, setTouchStartPos] = useState(null);

  const handleTouchStart = function(e, mealId) {
    const touch = e.touches[0];
    setTouchDragId(mealId);
    setTouchStartPos({ x: touch.clientX, y: touch.clientY });
  };

  const handleTouchMove = function(e) {
    if (!touchDragId) return;
    const touch = e.touches[0];
    const dx = Math.abs(touch.clientX - (touchStartPos ? touchStartPos.x : 0));
    const dy = Math.abs(touch.clientY - (touchStartPos ? touchStartPos.y : 0));

    if (dy > 10 || dx > 5) {
      e.preventDefault();

      const el = document.elementFromPoint(touch.clientX, touch.clientY);
      if (el) {
        const card = el.closest(".meal-period-card");
        if (card) {
          const periodId = card.getAttribute("data-period");
          if (periodId && periodId !== dropTarget) {
            setDropTarget(periodId);
          }
        } else {
          setDropTarget(null);
        }
      }
    }
  };

  const handleTouchEnd = function() {
    if (touchDragId && dropTarget) {
      const meal = mealLog.find(function(m) { return m.id === touchDragId; });
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
        const periodMeals = mealLog.filter(function(m) { return m.period === period.id; });
        const periodCals = periodMeals.reduce(function(sum, m) { return sum + (m.calories || 0); }, 0);
        const isExpanded = expandedPeriod === period.id;
        const isDragOver = dropTarget === period.id;
        const isDragging = draggedMealId !== null || touchDragId !== null;

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
                  const isBeingDragged = draggedMealId === meal.id || touchDragId === meal.id;
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

      {(draggedMealId || touchDragId) && (
        <div className="meal-drag-hint fade-in">
          Drag to another meal period to move
        </div>
      )}
    </div>
  );
}
