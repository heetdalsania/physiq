/* ─── PHYSIQ ENGINE — Login Screen ────────────────────────────────────────── */

window.PhysIQ = window.PhysIQ || {};
window.PhysIQ.Screens = window.PhysIQ.Screens || {};

(function(Screens) {

  function LoginScreen({ loginEmail, setLoginEmail, doLogin }) {
    return (
      <div className="onboard-screen slide-up">
        <div style={{ marginBottom: 24 }}>
          <div className="mono" style={{ fontSize: 11, fontWeight: 700, letterSpacing: 3.5, color: "var(--blue)", marginBottom: 8 }}>
            PHYSIQ ENGINE
          </div>
          <div className="onboard-title">
            Your Body.<br />Your Fuel.<br />Optimized.
          </div>
          <div className="onboard-sub">
            Enter your email to load your profile or create a new one.
          </div>
        </div>
        <div className="onboard-card">
          <div className="onboard-input-group">
            <label>Email</label>
            <input
              className="input" type="email"
              placeholder="you@example.com"
              value={loginEmail}
              onChange={function(e) { setLoginEmail(e.target.value); }}
              onKeyDown={function(e) { if (e.key === "Enter") doLogin(); }}
            />
          </div>
          <button
            className="btn btn-primary"
            onClick={doLogin}
            disabled={!loginEmail.includes("@")}
            style={{ marginTop: 8 }}
          >
            Continue
          </button>
        </div>
      </div>
    );
  }

  Screens.LoginScreen = LoginScreen;

})(window.PhysIQ.Screens);
