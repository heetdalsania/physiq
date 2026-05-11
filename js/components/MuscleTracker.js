/* ─── PHYSIQ ENGINE — Weekly Muscle Tracker (MuscleDiagram) ────────────────
 *
 * Modern Apple-Fitness-style silhouette with anatomically-inspired muscle
 * regions. SVG-first, zero external dependencies.
 *
 *   0 sets             →  muted gray   (not trained)
 *   1..target-1 sets   →  amber/orange (in progress)
 *   target+ sets       →  green        (volume goal met)
 *
 * "Sets" = total completed sets across the week for any exercise that
 * targets the muscle. Accumulates across multiple sessions; resets every
 * Monday with the rest of the weekly tracker.
 *
 * Cardio is the exception — it uses a days-per-week target (frequency,
 * not volume) and continues to count distinct training days.
 * ───────────────────────────────────────────────────────────────────────── */

import React, { useState } from "react";
import {
  TRACKED_MUSCLES,
  WEEKLY_SET_TARGETS,
  DEFAULT_WEEKLY_SET_TARGET,
  CARDIO_WEEKLY_DAYS_TARGET
} from "../data/constants.js";

const TRACKED = TRACKED_MUSCLES;
const SET_TARGETS = WEEKLY_SET_TARGETS || {};
const DEFAULT_SET_TARGET = DEFAULT_WEEKLY_SET_TARGET || 10;
const CARDIO_DAYS_TARGET = CARDIO_WEEKLY_DAYS_TARGET || 2;

function makeTargetFor(overrides) {
  return function(muscleId) {
    if (muscleId === "cardio") return CARDIO_DAYS_TARGET;
    if (overrides && typeof overrides[muscleId] === "number") return overrides[muscleId];
    return SET_TARGETS[muscleId] || DEFAULT_SET_TARGET;
  };
}
function targetForDefault(muscleId) {
  if (muscleId === "cardio") return CARDIO_DAYS_TARGET;
  return SET_TARGETS[muscleId] || DEFAULT_SET_TARGET;
}

function stateFor(count, target) {
  if (!count || count <= 0) return "empty";
  if (count >= target) return "hit";
  return "partial";
}
const STATE_COLOR = {
  empty:   "#3A4254",
  partial: "#F59E0B",
  hit:     "#22C55E"
};

const SILHOUETTE = [
  "M100 18 C82 18 74 34 76 50 C78 62 88 68 100 68 C112 68 122 62 124 50 C126 34 118 18 100 18 Z",
  "M92 64 L108 64 L110 76 L90 76 Z",
  "M64 74 C56 84 56 104 58 124 C58 144 62 162 68 180 C74 196 76 202 82 204 L118 204 C124 202 126 196 132 180 C138 162 142 144 142 124 C144 104 144 84 136 74 C120 68 80 68 64 74 Z",
  "M34 82 C28 94 26 112 28 134 C30 156 32 178 38 200 C42 216 46 224 50 226 C56 226 60 222 60 216 C58 196 56 174 54 150 C54 128 54 108 54 90 C54 82 48 78 42 78 C38 78 34 80 34 82 Z",
  "M166 82 C172 94 174 112 172 134 C170 156 168 178 162 200 C158 216 154 224 150 226 C144 226 140 222 140 216 C142 196 144 174 146 150 C146 128 146 108 146 90 C146 82 152 78 158 78 C162 78 166 80 166 82 Z",
  "M68 206 C62 226 60 258 62 294 C62 326 66 364 70 396 C72 412 80 418 88 414 C92 406 94 388 96 370 C96 340 98 306 98 276 C98 248 98 224 96 206 Z",
  "M132 206 C138 226 140 258 138 294 C138 326 134 364 130 396 C128 412 120 418 112 414 C108 406 106 388 104 370 C104 340 102 306 102 276 C102 248 102 224 104 206 Z"
];

const FRONT_REGIONS = [
  {
    id: "chest",
    paths: [
      "M68 82 C62 92 62 108 70 120 C86 126 96 116 98 100 C100 86 92 78 82 80 C74 80 70 80 68 82 Z",
      "M132 82 C138 92 138 108 130 120 C114 126 104 116 102 100 C100 86 108 78 118 80 C126 80 130 80 132 82 Z"
    ]
  },
  {
    id: "shoulders",
    paths: [
      "M54 78 C46 82 42 94 46 104 C54 108 62 102 66 94 C68 86 62 76 54 78 Z",
      "M146 78 C154 82 158 94 154 104 C146 108 138 102 134 94 C132 86 138 76 146 78 Z"
    ]
  },
  {
    id: "biceps",
    paths: [
      "M38 98 C34 116 32 140 36 158 C46 162 54 154 54 140 C54 124 50 104 46 96 C42 94 40 94 38 98 Z",
      "M162 98 C166 116 168 140 164 158 C154 162 146 154 146 140 C146 124 150 104 154 96 C158 94 160 94 162 98 Z"
    ]
  },
  {
    id: "core",
    paths: [
      "M80 126 C78 136 78 148 80 158 C90 162 110 162 120 158 C122 148 122 136 120 126 C110 122 90 122 80 126 Z",
      "M82 162 C80 172 80 186 84 196 C94 202 106 202 116 196 C120 186 120 172 118 162 C108 166 92 166 82 162 Z"
    ]
  },
  {
    id: "quads",
    paths: [
      "M72 212 C66 232 66 264 70 290 C80 298 90 294 92 280 C94 254 94 228 90 212 Z",
      "M128 212 C134 232 134 264 130 290 C120 298 110 294 108 280 C106 254 106 228 110 212 Z"
    ]
  }
];

const BACK_REGIONS = [
  {
    id: "back",
    paths: [
      "M68 74 C62 86 62 102 66 118 C84 128 116 128 134 118 C138 102 138 86 132 74 C118 70 82 70 68 74 Z",
      "M74 124 C70 138 70 156 76 170 C88 176 112 176 124 170 C130 156 130 138 126 124 C110 128 90 128 74 124 Z"
    ]
  },
  {
    id: "shoulders",
    paths: [
      "M54 78 C46 82 42 94 46 104 C54 108 62 102 66 94 C68 86 62 76 54 78 Z",
      "M146 78 C154 82 158 94 154 104 C146 108 138 102 134 94 C132 86 138 76 146 78 Z"
    ]
  },
  {
    id: "triceps",
    paths: [
      "M36 100 C32 118 30 144 34 162 C42 164 50 158 52 142 C52 124 48 106 44 98 C40 96 38 96 36 100 Z",
      "M164 100 C168 118 170 144 166 162 C158 164 150 158 148 142 C148 124 152 106 156 98 C160 96 162 96 164 100 Z"
    ]
  },
  {
    id: "glutes",
    paths: [
      "M80 184 C72 192 70 204 76 212 C86 216 98 212 100 200 C100 190 94 182 86 182 Z",
      "M120 184 C128 192 130 204 124 212 C114 216 102 212 100 200 C100 190 106 182 114 182 Z"
    ]
  },
  {
    id: "hamstrings",
    paths: [
      "M72 212 C66 232 66 262 72 288 C82 296 92 294 92 278 C92 252 92 226 88 212 Z",
      "M128 212 C134 232 134 262 128 288 C118 296 108 294 108 278 C108 252 108 226 112 212 Z"
    ]
  },
  {
    id: "calves",
    paths: [
      "M74 302 C70 320 68 344 72 368 C80 378 90 376 92 362 C92 340 92 318 88 302 Z",
      "M126 302 C130 320 132 344 128 368 C120 378 110 376 108 362 C108 340 108 318 112 302 Z"
    ]
  }
];

function BodyDiagram(props) {
  const regions = props.side === "front" ? FRONT_REGIONS : BACK_REGIONS;
  const counts = props.counts;
  const selected = props.selected;
  const onSelect = props.onSelect;
  const targetFor = props.targetFor || targetForDefault;

  return (
    <svg viewBox="0 0 200 440" className="md-svg" preserveAspectRatio="xMidYMid meet">
      <defs>
        <linearGradient id="md-grad-empty" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#2D3544" />
          <stop offset="100%" stopColor="#232A38" />
        </linearGradient>

        <linearGradient id="md-grad-partial" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#FBBF24" />
          <stop offset="60%" stopColor="#F59E0B" />
          <stop offset="100%" stopColor="#B45309" />
        </linearGradient>

        <linearGradient id="md-grad-hit" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#4ADE80" />
          <stop offset="60%" stopColor="#22C55E" />
          <stop offset="100%" stopColor="#15803D" />
        </linearGradient>

        <linearGradient id="md-grad-body" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#1A2030" />
          <stop offset="100%" stopColor="#121827" />
        </linearGradient>

        <filter id="md-glow" x="-30%" y="-30%" width="160%" height="160%">
          <feGaussianBlur stdDeviation="2.2" result="blur" />
          <feMerge>
            <feMergeNode in="blur" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>

        <filter id="md-inner" x="-10%" y="-10%" width="120%" height="120%">
          <feGaussianBlur in="SourceAlpha" stdDeviation="1.5" />
          <feOffset dy="1" result="offsetblur" />
          <feFlood floodColor="#000" floodOpacity="0.35" />
          <feComposite in2="offsetblur" operator="in" />
          <feComposite in2="SourceGraphic" operator="over" />
        </filter>
      </defs>

      <g className="md-silhouette">
        {SILHOUETTE.map(function(d, i) {
          return (
            <path
              key={"sh-" + i}
              d={d}
              fill="url(#md-grad-body)"
              stroke="rgba(255,255,255,0.04)"
              strokeWidth="1"
            />
          );
        })}
      </g>

      <g className="md-regions">
        {regions.map(function(r) {
          const count = counts[r.id] || 0;
          const state = stateFor(count, targetFor(r.id));
          const fill = "url(#md-grad-" + state + ")";
          const isSel = selected === r.id;
          const filter = state === "empty" ? null : "url(#md-glow)";
          return (
            <g
              key={r.id}
              className={"md-region md-state-" + state + (isSel ? " md-selected" : "")}
              data-muscle={r.id}
              onClick={function(e) { e.stopPropagation(); onSelect(r.id); }}
            >
              {r.paths.map(function(d, i) {
                return (
                  <path
                    key={r.id + "-" + i}
                    d={d}
                    fill={fill}
                    stroke={isSel ? "#8B5CF6" : "rgba(255,255,255,0.08)"}
                    strokeWidth={isSel ? "1.4" : "0.8"}
                    filter={filter}
                  />
                );
              })}
            </g>
          );
        })}
      </g>
    </svg>
  );
}

export function MuscleTracker(props) {
  const data = props.weeklyMuscles || { dates: {}, sessions: {}, sets: {} };
  const datesByMuscle = data.dates || {};
  const sessions = data.sessions || {};
  const setsByMuscle = data.sets || {};
  const setTargetOverrides = props.setTargets || {};
  const updateSetTarget = props.updateSetTarget;
  const targetFor = makeTargetFor(setTargetOverrides);

  const counts = {};
  TRACKED.forEach(function(m) {
    if (m.id === "cardio") {
      counts.cardio = (datesByMuscle.cardio || []).length;
    } else {
      counts[m.id] = setsByMuscle[m.id] || 0;
    }
  });

  const [side, setSide] = useState("front");
  const [selected, setSelected] = useState(null);

  const [editingTarget, setEditingTarget] = useState(false);
  const [editVal, setEditVal] = useState("");

  const select = function(id) {
    setEditingTarget(false);
    setSelected(function(cur) { return cur === id ? null : id; });
  };

  const beginEdit = function() {
    setEditVal(String(targetFor(selected)));
    setEditingTarget(true);
  };
  const commitEdit = function() {
    const v = parseInt(editVal, 10);
    if (!isNaN(v) && v >= 1 && v <= 99 && updateSetTarget) {
      updateSetTarget(selected, v);
    }
    setEditingTarget(false);
  };
  const resetEdit = function() {
    if (updateSetTarget) updateSetTarget(selected, null);
    setEditingTarget(false);
  };
  const cancelEdit = function() {
    setEditingTarget(false);
  };

  const selectedMuscle = selected ? TRACKED.find(function(m) { return m.id === selected; }) : null;
  const selectedTarget = selected ? targetFor(selected) : 0;
  const selectedCount = selected ? (counts[selected] || 0) : 0;
  const selectedState = stateFor(selectedCount, selectedTarget);
  const selectedIsCardio = selected === "cardio";
  const selectedUnit = selectedIsCardio ? "days" : "sets";
  const selectedPct = selectedTarget > 0 ? Math.min(100, Math.round((selectedCount / selectedTarget) * 100)) : 0;
  const selectedSessions = selected ? (sessions[selected] || []) : [];

  const byDay = {};
  selectedSessions.forEach(function(s) {
    const d = new Date(s.finishedAt);
    const k = d.toDateString();
    if (!byDay[k]) byDay[k] = [];
    byDay[k].push(s);
  });

  const cardioCount = counts.cardio || 0;
  const cardioState = stateFor(cardioCount, CARDIO_DAYS_TARGET);

  const bodyMuscles = TRACKED.filter(function(m) { return m.side !== "badge"; });
  const hitCount = bodyMuscles.filter(function(m) {
    return (counts[m.id] || 0) >= targetFor(m.id);
  }).length;

  return (
    <div className="md-card fade-in">
      <div className="md-header">
        <div>
          <div className="md-title">Weekly Muscle Tracker</div>
          <div className="md-sub">Mon–Sun {"·"} {hitCount}/{bodyMuscles.length} muscles on target</div>
        </div>
        <div className="md-legend">
          <span className="md-legend-item"><span className="md-legend-dot" style={{ background: STATE_COLOR.empty }} />0</span>
          <span className="md-legend-item"><span className="md-legend-dot" style={{ background: STATE_COLOR.partial }} />in&nbsp;progress</span>
          <span className="md-legend-item"><span className="md-legend-dot" style={{ background: STATE_COLOR.hit }} />target</span>
        </div>
      </div>

      <div className="md-toggle">
        <div className={"md-toggle-indicator md-toggle-" + side} />
        <button
          className={"md-toggle-btn" + (side === "front" ? " active" : "")}
          onClick={function() { setSide("front"); setSelected(null); }}
        >Front</button>
        <button
          className={"md-toggle-btn" + (side === "back" ? " active" : "")}
          onClick={function() { setSide("back"); setSelected(null); }}
        >Back</button>
      </div>

      <div className="md-stage">
        <BodyDiagram side={side} counts={counts} selected={selected} onSelect={select} targetFor={targetFor} />
      </div>

      <button
        className={"md-cardio md-state-" + cardioState}
        onClick={function() { select("cardio"); }}
      >
        <span className="md-cardio-icon pq-icon pq-icon-cardio" aria-hidden="true"></span>
        <span className="md-cardio-label">Cardio</span>
        <span className="mono md-cardio-count" style={{ color: STATE_COLOR[cardioState] }}>
          {cardioCount}/{CARDIO_DAYS_TARGET} days
        </span>
      </button>

      {selectedMuscle ? (
        <div className="md-tooltip fade-in">
          <div className="md-tooltip-head">
            <span className={"md-tooltip-dot md-state-" + selectedState} style={{ background: STATE_COLOR[selectedState] }} />
            <span className="md-tooltip-name">{selectedMuscle.label}</span>
            {editingTarget && !selectedIsCardio ? (
              <div className="md-target-edit">
                <span className="mono md-target-edit-prefix">{selectedCount}/</span>
                <input
                  className="mono md-target-edit-input"
                  type="number"
                  min="1"
                  max="99"
                  value={editVal}
                  autoFocus
                  onChange={function(e) { setEditVal(e.target.value); }}
                  onKeyDown={function(e) {
                    if (e.key === "Enter") commitEdit();
                    else if (e.key === "Escape") cancelEdit();
                  }}
                />
                <span className="mono md-target-edit-suffix">sets</span>
              </div>
            ) : (
              <span className="mono md-tooltip-count" style={{ color: STATE_COLOR[selectedState] }}>
                {selectedCount}/{selectedTarget} {selectedUnit}
              </span>
            )}
            {!selectedIsCardio && updateSetTarget && (
              editingTarget ? (
                <div className="md-target-actions">
                  <button className="md-target-btn md-target-save" onClick={commitEdit} title="Save">{"✓"}</button>
                  {typeof setTargetOverrides[selected] === "number" && (
                    <button className="md-target-btn md-target-reset" onClick={resetEdit} title="Reset to default">{"↺"}</button>
                  )}
                  <button className="md-target-btn md-target-cancel" onClick={cancelEdit} title="Cancel">{"✕"}</button>
                </div>
              ) : (
                <button className="md-target-btn md-target-edit-trigger" onClick={beginEdit} title="Edit weekly target">
                  Edit
                </button>
              )
            )}
          </div>
          {!selectedIsCardio && (
            <div className="md-tooltip-bar">
              <div
                className={"md-tooltip-bar-fill md-bar-" + selectedState}
                style={{ width: selectedPct + "%" }}
              />
            </div>
          )}
          {!selectedIsCardio && typeof setTargetOverrides[selected] === "number" && !editingTarget && (
            <div className="md-target-hint">Custom target {"·"} default {SET_TARGETS[selected] || DEFAULT_SET_TARGET}</div>
          )}
          {Object.keys(byDay).length > 0 ? (
            <div className="md-tooltip-sessions">
              {Object.keys(byDay).map(function(k) {
                const arr = byDay[k];
                const d = new Date(k);
                const day = d.toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" });
                const titles = Array.from(new Set(arr.map(function(a) { return a.title || "Workout"; }))).join(", ");
                return (
                  <div key={k} className="md-tooltip-row">
                    <span className="md-tooltip-day">{day}</span>
                    <span className="md-tooltip-title">{titles}</span>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="md-tooltip-empty">Not trained yet this week.</div>
          )}
        </div>
      ) : (
        <div className="md-hint">Tap a muscle for details</div>
      )}
    </div>
  );
}

export { MuscleTracker as MuscleDiagram };
