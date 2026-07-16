/* ─── PHYSIQ ENGINE — Weekly Report Screen ────────────────────────────────
 *
 * Once-weekly Mon–Sun summary: did I eat right for my phase, did I train
 * enough, and what do I change next week. All numbers come from the pure
 * data layer in utils/weeklyReport.js; this file is presentation only.
 * ───────────────────────────────────────────────────────────────────────── */

import React, { useState, useMemo } from "react";
import { AppTime } from "../utils/appTime.js";
import { buildWeeklyReport, getReportWeekStart } from "../utils/weeklyReport.js";
import { suggestRoutineForWeek } from "../utils/routineGenerator.js";

const PLAN_CTA_TYPES = { "macro": true, "macro-training": true, "calories": true };
const ROUTINE_CTA_TYPES = { "volume-fix": true, "no-data": true };

const PHASE_STYLE = {
  bulk:     { label: "BULK",     color: "var(--orange)" },
  cut:      { label: "CUT",      color: "var(--sky)" },
  maintain: { label: "MAINTAIN", color: "var(--teal)" }
};

const TONE_HEADLINE = {
  strong: "Strong week",
  mixed: "Mixed week",
  rough: "Rough week"
};

function rangeLabel(start, end) {
  const opts = { month: "short", day: "numeric" };
  return start.toLocaleDateString([], opts) + " – " + end.toLocaleDateString([], opts);
}

function signed(n) {
  return (n >= 0 ? "+" : "−") + Math.abs(n);
}

// ── Win of the Week ─────────────────────────────────────────────────────

function winCopy(win) {
  if (win.type === "stall-break" || win.type === "progression") {
    const e = win.event;
    const move = e.type === "weight"
      ? e.from + " → " + e.to + " lb"
      : e.from + " → " + e.to + " reps @ " + e.weight + " lb";
    if (win.type === "stall-break") {
      return { title: e.lift + " finally moved", sub: move + " after a 3-session stall" };
    }
    return { title: e.lift + ": " + move, sub: "Top progression this week" };
  }
  if (win.type === "volume") {
    return { title: "Best volume week yet", sub: win.sets + " completed sets — previous best " + win.prevBest };
  }
  return { title: win.days + " days on target in a row", sub: "Longest calorie streak this week" };
}

function WeightTrendCard({ trend, adjustment }) {
  if (!trend.available) {
    return (
      <div className="card" style={{ padding: "12px 16px", marginBottom: 12 }}>
        <div className="label" style={{ marginBottom: 3 }}>Weight</div>
        <div style={{ fontSize: 12, color: "var(--text-muted)" }}>
          Log your weight in the weekly check-in to unlock trends here.
        </div>
      </div>
    );
  }
  const color = trend.status === "on-pace" ? "var(--green)"
    : trend.status === "ahead" ? "var(--blue-light)" : "var(--amber)";
  return (
    <div className="card" style={{ padding: "12px 16px", marginBottom: 12 }}>
      <div className="label" style={{ marginBottom: 3 }}>
        Weight {"·"} <span className="mono" style={{ textTransform: "none", letterSpacing: 0 }}>{trend.current.weight} lb</span>
      </div>
      <div style={{ fontSize: 15, fontWeight: 700, color: "var(--text-white)" }}>{trend.lead}</div>
      <div style={{ fontSize: 12, color: color, marginTop: 3, fontWeight: 600 }}>{trend.paceText}</div>
      <div style={{ fontSize: 11, color: "var(--text-faint)", marginTop: 3 }}>
        {trend.spanDays}-day trend {"·"} weekly changes bounce around — the direction matters more than any single week
      </div>
      {!!adjustment && (
        <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 3 }}>
          Targets include your {(adjustment > 0 ? "+" : "") + adjustment} kcal/day coaching adjustment
        </div>
      )}
    </div>
  );
}

function WinCard({ win }) {
  if (!win) return null;
  const copy = winCopy(win);
  return (
    <div className="wr-win-card fade-in">
      <div className="wr-win-eyebrow">
        <span className="pq-icon pq-icon-goal-up" aria-hidden="true"></span>
        Win of the Week
      </div>
      <div style={{ fontSize: 17, fontWeight: 700, color: "var(--text-white)", marginTop: 6 }}>{copy.title}</div>
      <div style={{ fontSize: 13, color: "var(--text-dim)", marginTop: 3 }}>{copy.sub}</div>
    </div>
  );
}

// ── Nutrition tab ───────────────────────────────────────────────────────

function DivergingCalorieChart({ days }) {
  const w = 300, mid = 66, maxBar = 52, labelY = 138;
  const gap = w / 7, barW = gap * 0.52;
  const deltas = days.filter(function(d) { return d.logged; }).map(function(d) { return Math.abs(d.delta); });
  const maxAbs = Math.max(250, Math.max.apply(null, deltas.concat([0])));

  return (
    <svg viewBox={"0 0 " + w + " 148"} style={{ width: "100%", height: "auto", marginTop: 10 }}>
      <line x1="0" y1={mid} x2={w} y2={mid} stroke="var(--text-faint)" strokeWidth="1" strokeDasharray="4 4" />
      {days.map(function(d, i) {
        const x = i * gap + (gap - barW) / 2;
        const cx = i * gap + gap / 2;
        if (!d.logged) {
          return (
            <g key={d.key}>
              <rect x={x} y={mid - 1.5} width={barW} height={3} rx={1.5} fill="var(--track)" />
              <text x={cx} y={labelY} textAnchor="middle" fontSize="9" fill="var(--chart-text)" fontFamily="'DM Sans',sans-serif">{d.label}</text>
            </g>
          );
        }
        const h = Math.max(3, Math.abs(d.delta) / maxAbs * maxBar);
        const up = d.delta >= 0;
        const color = d.hit ? "var(--green)" : "var(--red)";
        return (
          <g key={d.key}>
            <rect x={x} y={up ? mid - h : mid} width={barW} height={h} rx={3} fill={color} opacity="0.85" />
            <text x={cx} y={up ? mid - h - 5 : mid + h + 11} textAnchor="middle" fontSize="8" fill="var(--text-dim)" fontFamily="'Space Mono',monospace">
              {signed(d.delta)}
            </text>
            <text x={cx} y={labelY} textAnchor="middle" fontSize="9" fill="var(--chart-text)" fontFamily="'DM Sans',sans-serif">{d.label}</text>
          </g>
        );
      })}
    </svg>
  );
}

function NutritionTab({ report }) {
  const n = report.nutrition;
  const macroColor = { success: "var(--green)", warning: "var(--amber)", miss: "var(--red)" };

  return (
    <React.Fragment>
      <div className="card" style={{ padding: 16, marginBottom: 12 }}>
        <div className="label" style={{ marginBottom: 4 }}>Calories</div>
        {n.loggedCount === 0 ? (
          <div className="wr-empty">No meals logged this week. Log meals and this chart fills in.</div>
        ) : (
          <React.Fragment>
            <div style={{ fontSize: 15, fontWeight: 700, color: "var(--text-white)" }}>
              {n.caloriesHit}/7 days on target
              <span style={{ color: "var(--text-muted)", fontWeight: 500 }}>
                {" · avg "}<span className="mono">{signed(n.avgDelta)}</span> kcal vs target
              </span>
            </div>
            <DivergingCalorieChart days={n.days} />
            <div style={{ fontSize: 11, color: "var(--text-faint)", marginTop: 2 }}>
              Dashed line = {n.calorieTarget} kcal target {"·"} {report.phase === "cut" ? "below the line is a hit on a cut" : report.phase === "bulk" ? "at or above the line is a hit on a bulk" : "within ±300 is a hit"}
            </div>
          </React.Fragment>
        )}
      </div>

      <div className="card" style={{ padding: 16, marginBottom: 12 }}>
        <div className="label" style={{ marginBottom: 10 }}>Macros</div>
        {n.loggedCount === 0 ? (
          <div className="wr-empty">Nothing to score yet.</div>
        ) : (
          n.macros.map(function(m) {
            return (
              <div key={m.id} className="wr-row">
                <span style={{ fontSize: 14, fontWeight: 600, color: "var(--text)", flex: 1 }}>{m.label}</span>
                <span style={{ fontSize: 12, color: "var(--text-muted)" }}>{m.target}g daily</span>
                <span className="mono" style={{ fontSize: 13, fontWeight: 700, color: macroColor[m.level], minWidth: 52, textAlign: "right" }}>
                  {m.hits}/7 {"✓"}
                </span>
              </div>
            );
          })
        )}
      </div>
    </React.Fragment>
  );
}

// ── Training tab ────────────────────────────────────────────────────────

function VolumeRow({ row }) {
  const state = row.done <= 0 ? "empty" : row.hit ? "hit" : "partial";
  const barColor = state === "hit" ? "var(--green)" : state === "partial" ? "var(--amber)" : "var(--track)";
  // Fill can overshoot past the target tick; visual cap at 125% of target.
  const fillPct = Math.min(row.done / row.target, 1.25) / 1.25 * 100;
  const tickPct = 1 / 1.25 * 100;

  return (
    <div style={{ marginBottom: 14 }}>
      <div className="wr-row" style={{ borderBottom: "none", padding: 0, marginBottom: 6 }}>
        <span style={{ fontSize: 14, fontWeight: 600, color: "var(--text)", flex: 1 }}>{row.label}</span>
        <span className="mono" style={{ fontSize: 13, fontWeight: 700, color: row.hit ? "var(--green)" : "var(--text-dim)" }}>
          {row.done}/{row.target} sets {row.hit ? "✓" : "✗"}
        </span>
      </div>
      <div className="wr-vol-track">
        {fillPct > 0 && <div className="wr-vol-fill" style={{ width: fillPct + "%", background: barColor }} />}
        <div className="wr-vol-tick" style={{ left: tickPct + "%" }} />
      </div>
      <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 5 }}>
        {row.exercises.length === 0
          ? "Not trained this week"
          : row.exercises.map(function(e) { return e.name + " " + e.sets; }).join(" · ")}
      </div>
    </div>
  );
}

function TrainingTab({ report }) {
  const t = report.training;
  const moved = report.progression.events.filter(function(e) { return e.type === "weight" || e.type === "reps"; });
  const rest = report.progression.events.filter(function(e) { return e.type !== "weight" && e.type !== "reps"; });

  return (
    <React.Fragment>
      <div className="card" style={{ padding: 16, marginBottom: 12 }}>
        <div className="label" style={{ marginBottom: 10 }}>
          Volume{t.rows.length > 0 ? " · " + t.hitCount + "/" + t.rows.length + " muscle groups hit" : ""}
        </div>
        {t.rows.length === 0 ? (
          <div className="wr-empty">No workouts logged this week. Finish a session and volume shows up here.</div>
        ) : (
          <React.Fragment>
            {t.sessions.length === 0 && (
              <div className="wr-empty" style={{ marginBottom: 10 }}>No workouts logged this week.</div>
            )}
            {t.rows.map(function(r) { return <VolumeRow key={r.id} row={r} />; })}
          </React.Fragment>
        )}
        {t.notProgrammed.length > 0 && t.rows.length > 0 && (
          <div style={{ fontSize: 11, color: "var(--text-faint)", marginTop: 2 }}>
            Not programmed: {t.notProgrammed.join(", ")}
          </div>
        )}
      </div>

      <div className="card" style={{ padding: 16, marginBottom: 12 }}>
        <div className="label" style={{ marginBottom: 10 }}>
          Progression {"·"} {report.progression.movedCount} {report.progression.movedCount === 1 ? "lift" : "lifts"} moved
        </div>
        {report.progression.events.length === 0 ? (
          <div className="wr-empty">No lifts logged this week.</div>
        ) : (
          moved.concat(rest).map(function(e) {
            let value, valueColor;
            if (e.type === "weight") {
              value = e.from + " → " + e.to + " lb";
              valueColor = "var(--green)";
            } else if (e.type === "reps") {
              value = (e.weight > 0 ? e.weight + " lb · " : "") + e.from + " → " + e.to + " reps";
              valueColor = "var(--green)";
            } else {
              value = (e.weight > 0 ? e.weight + " lb × " + e.reps : e.reps + " reps") +
                " · " + (e.type === "new" ? "new" : "held");
              valueColor = "var(--text-faint)";
            }
            return (
              <div key={e.lift} className="wr-row">
                <span style={{
                  fontSize: 14, fontWeight: 600, flex: 1, minWidth: 0,
                  overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                  color: e.type === "held" ? "var(--text-muted)" : "var(--text)"
                }}>{e.lift}</span>
                <span className="mono" style={{ fontSize: 13, fontWeight: 700, color: valueColor }}>{value}</span>
              </div>
            );
          })
        )}
      </div>
    </React.Fragment>
  );
}

// ── Screen ──────────────────────────────────────────────────────────────

export function WeeklyReportScreen({ profile, targets, history, workoutLog, routines, setTargets, onBack, onPlanDay, saveRoutine }) {
  const [tab, setTab] = useState("nutrition");

  const report = useMemo(function() {
    return buildWeeklyReport({
      goal: profile.goal,
      history: history,
      workoutLog: workoutLog,
      routines: routines,
      setTargets: setTargets,
      targets: targets,
      weightLog: profile.weightLog,
      weekStart: getReportWeekStart(AppTime.now())
    });
  }, [profile.goal, history, workoutLog, routines, setTargets, targets]);

  const [routineCopied, setRoutineCopied] = useState(false);
  const suggestedRoutine = useMemo(function() {
    return suggestRoutineForWeek(report.training.rows, routines, workoutLog);
  }, [report, routines, workoutLog]);

  const phase = PHASE_STYLE[report.phase];
  const firstName = (profile.name || "").trim().split(" ")[0];
  const headline = TONE_HEADLINE[report.tone] + (firstName ? ", " + firstName + "." : ".");
  const brandNew = report.nutrition.loggedCount === 0 && report.training.sessions.length === 0;
  const nudge = tab === "nutrition" ? report.nudges.nutrition : report.nudges.training;

  return (
    <div className="fade-in" style={{ paddingTop: 16, paddingBottom: 24 }}>
      {onBack && (
        <div className="screen-header">
          <button className="screen-back-btn" onClick={onBack}>{"‹"} Back</button>
          <div style={{ flex: 1 }} />
        </div>
      )}

      <div className="label" style={{ marginBottom: 6 }}>
        Weekly Report {"·"} {rangeLabel(report.weekStart, report.weekEnd)}
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 16 }}>
        <div style={{ fontSize: 24, fontWeight: 700, color: "var(--text-white)", letterSpacing: -0.3, flex: 1 }}>
          {headline}
        </div>
        <span className="wr-phase-badge" style={{ color: phase.color, borderColor: phase.color }}>
          {phase.label}
        </span>
      </div>

      {brandNew ? (
        <div className="card" style={{ padding: 18, marginBottom: 12, textAlign: "center" }}>
          <div style={{ fontSize: 14, fontWeight: 600, color: "var(--text)" }}>Not enough data yet</div>
          <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 5, lineHeight: 1.5 }}>
            This report covers {rangeLabel(report.weekStart, report.weekEnd)}. Log meals and workouts through the week and your first full report appears here.
          </div>
        </div>
      ) : (
        <React.Fragment>
          <WinCard win={report.win} />
          <WeightTrendCard trend={report.weightTrend} adjustment={targets.adjustment || 0} />
        </React.Fragment>
      )}

      <div className="wr-tabs">
        {[{ id: "nutrition", label: "Nutrition" }, { id: "training", label: "Training" }].map(function(t) {
          return (
            <button
              key={t.id}
              className={"wr-tab" + (tab === t.id ? " active" : "")}
              onClick={function() { setTab(t.id); }}
            >
              {t.label}
            </button>
          );
        })}
      </div>

      {tab === "nutrition" ? <NutritionTab report={report} /> : <TrainingTab report={report} />}

      <div className="wr-nudge-card">
        <div className="wr-nudge-eyebrow">Next week</div>
        <div style={{ fontSize: 14, color: "var(--text-suggestion)", lineHeight: 1.5, marginTop: 5 }}>
          {nudge.text}
        </div>
        {tab === "nutrition" && onPlanDay && PLAN_CTA_TYPES[nudge.type] && (
          <button className="wr-cta-btn" onClick={function() { onPlanDay(nudge.macroId || null); }}>
            Plan a day {"→"}
          </button>
        )}
        {tab === "training" && saveRoutine && ROUTINE_CTA_TYPES[nudge.type] && suggestedRoutine && (
          <div style={{ marginTop: 10 }}>
            <div style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 8 }}>
              {suggestedRoutine.title.replace("Suggested · ", "")}{": "}
              {suggestedRoutine.exercises.map(function(e) { return e.name + " ×" + e.sets.length; }).join(" · ")}
            </div>
            <button
              className="wr-cta-btn"
              style={{ marginTop: 0 }}
              disabled={routineCopied}
              onClick={function() {
                if (routineCopied) return;
                saveRoutine(Object.assign({ id: Date.now() }, suggestedRoutine));
                setRoutineCopied(true);
              }}
            >
              {routineCopied ? "Added to My Routines ✓" : "Copy to My Routines"}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
