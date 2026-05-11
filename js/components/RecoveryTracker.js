/* ─── PHYSIQ ENGINE — Recovery Tracker ──────────────────────────────────────
 *
 * Smart Recovery Guidance — tells the user which muscles are recovered and
 * ready to train, and which still need rest. Pure derivation from existing
 * weeklyMuscles.sessions data; no extra storage. Resets automatically with
 * the weekly muscle tracker on Monday.
 *
 * Guidance, not restriction. Nothing here disables buttons or blocks
 * workouts — it just answers "what should I train today?".
 * ───────────────────────────────────────────────────────────────────────── */

import React, { useState, useEffect } from "react";
import { TRACKED_MUSCLES } from "../data/constants.js";
import { AppTime } from "../utils/appTime.js";

const TRACKED = TRACKED_MUSCLES;

// Midpoint of recommended recovery ranges. Consistent across sessions
// so the same muscle always carries the same window.
const RECOVERY_HOURS = {
  chest:      60,
  back:       60,
  shoulders:  36,
  biceps:     48,
  triceps:    48,
  quads:      60,
  hamstrings: 60,
  glutes:     60,
  calves:     36,
  core:       36
};

function fmtRemaining(hoursLeft) {
  const h = Math.max(0, Math.ceil(hoursLeft));
  if (h <= 0) return "Ready now";
  if (h < 24) return "Ready in " + h + "h";
  const d = Math.floor(h / 24);
  const rem = h % 24;
  if (rem === 0) return "Ready in " + d + "d";
  return "Ready in " + d + "d " + rem + "h";
}

function deriveStatus(sessions, nowMs) {
  const recovering = [];
  const ready = [];
  TRACKED.forEach(function(m) {
    if (m.id === "cardio") return;
    const window = RECOVERY_HOURS[m.id];
    if (typeof window !== "number") return;

    const arr = (sessions && sessions[m.id]) || [];
    let lastMs = 0;
    arr.forEach(function(s) {
      const t = s && s.finishedAt;
      if (typeof t === "number" && t > lastMs) lastMs = t;
    });

    if (!lastMs) {
      ready.push({ muscle: m, lastMs: 0 });
      return;
    }

    const hoursSince = (nowMs - lastMs) / (1000 * 60 * 60);
    const hoursLeft = window - hoursSince;
    if (hoursLeft <= 0) {
      ready.push({ muscle: m, lastMs: lastMs });
    } else {
      recovering.push({
        muscle: m,
        lastMs: lastMs,
        hoursLeft: hoursLeft,
        windowHours: window,
        progress: Math.max(0, Math.min(1, hoursSince / window)),
        nearReady: hoursLeft <= 6
      });
    }
  });

  recovering.sort(function(a, b) { return a.hoursLeft - b.hoursLeft; });
  ready.sort(function(a, b) { return a.lastMs - b.lastMs; });

  return { recovering: recovering, ready: ready };
}

export function RecoveryTracker(props) {
  const data = props.weeklyMuscles || { sessions: {} };
  const sessions = data.sessions || {};

  // Tick once a minute so timers stay live without pinning the CPU.
  const [, setTick] = useState(0);
  useEffect(function() {
    const id = setInterval(function() { setTick(function(n) { return n + 1; }); }, 60 * 1000);
    return function() { clearInterval(id); };
  }, []);

  const status = deriveStatus(sessions, AppTime.nowMs());
  const ready = status.ready;
  const recovering = status.recovering;

  return (
    <div className="rec-card fade-in">
      <div className="rec-header">
        <div>
          <div className="rec-title">Recovery</div>
          <div className="rec-sub">What to train next {"·"} guidance only</div>
        </div>
        <div className="rec-counts">
          <span className="rec-count rec-count-ready">
            <span className="rec-count-dot rec-dot-ready" />{ready.length} ready
          </span>
          <span className="rec-count rec-count-recover">
            <span className="rec-count-dot rec-dot-recover" />{recovering.length} resting
          </span>
        </div>
      </div>

      <div className="rec-zone rec-zone-ready">
        <div className="rec-zone-label">
          <span className="rec-zone-dot rec-dot-ready" />
          Ready to Train
        </div>
        {ready.length === 0 ? (
          <div className="rec-empty">All muscles are resting right now — pick something light or take a break.</div>
        ) : (
          <div className="rec-pill-row">
            {ready.map(function(r) {
              return (
                <span key={r.muscle.id} className="rec-pill rec-pill-ready fade-in">
                  {r.muscle.label}
                </span>
              );
            })}
          </div>
        )}
      </div>

      <div className="rec-zone rec-zone-recover">
        <div className="rec-zone-label">
          <span className="rec-zone-dot rec-dot-recover" />
          Recovering
        </div>
        {recovering.length === 0 ? (
          <div className="rec-empty">Nothing recovering — every muscle is fair game.</div>
        ) : (
          <div className="rec-pill-row">
            {recovering.map(function(r) {
              const cls = "rec-pill rec-pill-recover fade-in" + (r.nearReady ? " rec-near-ready" : "");
              return (
                <span
                  key={r.muscle.id}
                  className={cls}
                  style={{ "--rec-progress": (r.progress * 100).toFixed(1) + "%" }}
                >
                  <span className="rec-pill-name">{r.muscle.label}</span>
                  <span className="rec-pill-timer mono">{fmtRemaining(r.hoursLeft)}</span>
                </span>
              );
            })}
          </div>
        )}
      </div>

      <div className="rec-foot">
        Recovery times are general guidance — listen to your body.
      </div>
    </div>
  );
}
