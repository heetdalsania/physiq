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

window.PhysIQ = window.PhysIQ || {};
window.PhysIQ.Components = window.PhysIQ.Components || {};

(function(Components, Data, Utils) {

  var useState = React.useState;
  var useEffect = React.useEffect;

  var TRACKED = Data.TRACKED_MUSCLES;
  var AppTime = (Utils && Utils.AppTime) || { nowMs: function() { return Date.now(); } };

  // Recovery durations in hours — midpoint of recommended ranges. Consistent
  // across sessions so the same muscle always carries the same window.
  var RECOVERY_HOURS = {
    chest:      60,  // 48–72
    back:       60,  // 48–72
    shoulders:  36,  // 24–48
    biceps:     48,
    triceps:    48,
    quads:      60,  // 48–72
    hamstrings: 60,  // 48–72
    glutes:     60,  // 48–72
    calves:     36,  // 24–48
    core:       36   // 24–48
  };

  // Format remaining hours → "Ready in 4h" / "Ready in 1d 8h" / "Ready in 2d"
  function fmtRemaining(hoursLeft) {
    var h = Math.max(0, Math.ceil(hoursLeft));
    if (h <= 0) return "Ready now";
    if (h < 24) return "Ready in " + h + "h";
    var d = Math.floor(h / 24);
    var rem = h % 24;
    if (rem === 0) return "Ready in " + d + "d";
    return "Ready in " + d + "d " + rem + "h";
  }

  // Build the {recovering: [...], ready: [...]} split from session data
  function deriveStatus(sessions, nowMs) {
    var recovering = [];
    var ready = [];
    TRACKED.forEach(function(m) {
      if (m.id === "cardio") return;          // cardio doesn't enter recovery
      var window = RECOVERY_HOURS[m.id];
      if (typeof window !== "number") return; // unknown muscles → skip silently

      var arr = (sessions && sessions[m.id]) || [];
      var lastMs = 0;
      arr.forEach(function(s) {
        var t = s && s.finishedAt;
        if (typeof t === "number" && t > lastMs) lastMs = t;
      });

      if (!lastMs) {
        ready.push({ muscle: m, lastMs: 0 });
        return;
      }

      var hoursSince = (nowMs - lastMs) / (1000 * 60 * 60);
      var hoursLeft = window - hoursSince;
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

    // Sort recovering by hoursLeft asc (closest to ready first)
    recovering.sort(function(a, b) { return a.hoursLeft - b.hoursLeft; });
    // Sort ready by lastMs asc (longest-rested first)
    ready.sort(function(a, b) { return a.lastMs - b.lastMs; });

    return { recovering: recovering, ready: ready };
  }

  // ══════════════════════════════════════════════════════════════════════
  // RecoveryTracker — top-level component
  // ══════════════════════════════════════════════════════════════════════
  function RecoveryTracker(props) {
    var data = props.weeklyMuscles || { sessions: {} };
    var sessions = data.sessions || {};

    // Tick once a minute so timers stay live without pinning the CPU.
    var _tick = useState(0);
    var setTick = _tick[1];
    useEffect(function() {
      var id = setInterval(function() { setTick(function(n) { return n + 1; }); }, 60 * 1000);
      return function() { clearInterval(id); };
    }, []);

    var status = deriveStatus(sessions, AppTime.nowMs());
    var ready = status.ready;
    var recovering = status.recovering;

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

        {/* Ready to Train */}
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

        {/* Recovering */}
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
                var cls = "rec-pill rec-pill-recover fade-in" + (r.nearReady ? " rec-near-ready" : "");
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

  Components.RecoveryTracker = RecoveryTracker;

})(window.PhysIQ.Components, window.PhysIQ.Data, window.PhysIQ.Utils);
