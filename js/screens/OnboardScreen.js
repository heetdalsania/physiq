/* ─── PHYSIQ ENGINE — Onboarding Screen ──────────────────────────────────── */

window.PhysIQ = window.PhysIQ || {};
window.PhysIQ.Screens = window.PhysIQ.Screens || {};

(function(Screens, Data) {

  var GOALS = Data.GOALS;
  var ACTIVITY_LEVELS = Data.ACTIVITY_LEVELS;

  function OnboardScreen(props) {
    var onboardStep = props.onboardStep, setOnboardStep = props.setOnboardStep;
    var obName = props.obName, setObName = props.setObName;
    var obAge = props.obAge, setObAge = props.setObAge;
    var obWeight = props.obWeight, setObWeight = props.setObWeight;
    var obHeight = props.obHeight, setObHeight = props.setObHeight;
    var obSex = props.obSex, setObSex = props.setObSex;
    var obBodyfat = props.obBodyfat, setObBodyfat = props.setObBodyfat;
    var obGoal = props.obGoal, setObGoal = props.setObGoal;
    var obActivity = props.obActivity, setObActivity = props.setObActivity;
    var obSteps = props.obSteps, setObSteps = props.setObSteps;
    var obGymDays = props.obGymDays, setObGymDays = props.setObGymDays;
    var finishOnboard = props.finishOnboard;

    return (
      <div className="onboard-screen slide-up" key={onboardStep}>
        <div className="mono onboard-step">Step {onboardStep + 1} of 3</div>
        <div className="onboard-card">

          {/* Step 1: Your Build */}
          {onboardStep === 0 && (
            <React.Fragment>
              <div className="onboard-title" style={{ fontSize: 22 }}>Your Build</div>
              <div className="onboard-sub">We'll calculate your personalized targets.</div>

              <div className="onboard-input-group">
                <label>Name</label>
                <input className="input" placeholder="Your name" value={obName} onChange={function(e) { setObName(e.target.value); }} />
              </div>

              <div className="grid-2" style={{ gap: 10 }}>
                <div className="onboard-input-group">
                  <label>Age</label>
                  <input className="input" type="number" value={obAge} onChange={function(e) { setObAge(e.target.value); }} />
                </div>
                <div className="onboard-input-group">
                  <label>Weight (lbs)</label>
                  <input className="input" type="number" value={obWeight} onChange={function(e) { setObWeight(e.target.value); }} />
                </div>
                <div className="onboard-input-group">
                  <label>Height (in)</label>
                  <input className="input" type="number" value={obHeight} onChange={function(e) { setObHeight(e.target.value); }} />
                </div>
                <div className="onboard-input-group">
                  <label>Body Fat %</label>
                  <input className="input" type="number" value={obBodyfat} onChange={function(e) { setObBodyfat(e.target.value); }} />
                </div>
              </div>

              <div className="onboard-input-group" style={{ marginTop: 10 }}>
                <label>Sex</label>
                <div style={{ display: "flex", gap: 8 }}>
                  {[{ id: "male", label: "Male" }, { id: "female", label: "Female" }].map(function(s) {
                    return (
                      <button key={s.id} className={"sex-btn" + (obSex === s.id ? " active" : "")} onClick={function() { setObSex(s.id); }} style={{ flex: 1 }}>
                        {s.label}
                      </button>
                    );
                  })}
                </div>
              </div>

              <button className="btn btn-primary" style={{ marginTop: 14 }} onClick={function() { setOnboardStep(1); }}>Next</button>
            </React.Fragment>
          )}

          {/* Step 2: Your Goal */}
          {onboardStep === 1 && (
            <React.Fragment>
              <div className="onboard-title" style={{ fontSize: 22 }}>Your Goal</div>
              <div className="onboard-sub">What are you working towards?</div>

              <div className="flex-col gap-6" style={{ marginBottom: 14 }}>
                {GOALS.map(function(g) {
                  return (
                    <button key={g.id} className={"option-btn" + (obGoal === g.id ? " active" : "")} onClick={function() { setObGoal(g.id); }} style={{ padding: 14 }}>
                      <span className={"option-icon pq-icon " + g.iconClass} aria-hidden="true"></span>
                      <div style={{ flex: 1 }}>
                        <div style={{ fontSize: 13, fontWeight: 600 }}>{g.label}</div>
                        <div style={{ fontSize: 10, color: "var(--text-faint)" }}>
                          {g.pct > 0 ? "+" : ""}{Math.round(g.pct * 100)}% cal {"\u00B7"} {g.proteinGKg}g/kg protein
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>

              <div style={{ display: "flex", gap: 8 }}>
                <button className="btn" onClick={function() { setOnboardStep(0); }} style={{ flex: 1, padding: 14, borderRadius: 10, background: "var(--surface)", color: "var(--text-dim)", border: "1px solid var(--border)" }}>Back</button>
                <button className="btn btn-primary" style={{ flex: 2 }} onClick={function() { setOnboardStep(2); }}>Next</button>
              </div>
            </React.Fragment>
          )}

          {/* Step 3: Activity & Routine */}
          {onboardStep === 2 && (
            <React.Fragment>
              <div className="onboard-title" style={{ fontSize: 22 }}>Activity & Routine</div>
              <div className="onboard-sub">Fine-tune your daily targets.</div>

              <div className="onboard-input-group">
                <label>Activity Level</label>
                <div className="flex-col gap-6">
                  {ACTIVITY_LEVELS.map(function(a) {
                    return (
                      <button key={a.id} className={"option-btn" + (obActivity === a.id ? " active" : "")} onClick={function() { setObActivity(a.id); }} style={{ padding: 10 }}>
                        <span style={{ fontSize: 12, flex: 1 }}>{a.label}</span>
                        <span className="mono" style={{ fontSize: 10, color: "var(--text-faint)" }}>{a.steps}</span>
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="grid-2" style={{ gap: 10, marginTop: 10 }}>
                <div className="onboard-input-group">
                  <label>Avg Steps/Day</label>
                  <input className="input" type="number" value={obSteps} onChange={function(e) { setObSteps(e.target.value); }} />
                </div>
                <div className="onboard-input-group">
                  <label>Gym Days/Week</label>
                  <input className="input" type="number" value={obGymDays} onChange={function(e) { setObGymDays(e.target.value); }} />
                </div>
              </div>

              <div style={{ display: "flex", gap: 8, marginTop: 14 }}>
                <button className="btn" onClick={function() { setOnboardStep(1); }} style={{ flex: 1, padding: 14, borderRadius: 10, background: "var(--surface)", color: "var(--text-dim)", border: "1px solid var(--border)" }}>Back</button>
                <button className="btn btn-primary" style={{ flex: 2 }} onClick={finishOnboard}>Finish Setup</button>
              </div>
            </React.Fragment>
          )}

        </div>
      </div>
    );
  }

  Screens.OnboardScreen = OnboardScreen;

})(window.PhysIQ.Screens, window.PhysIQ.Data);
