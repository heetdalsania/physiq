/* ─── PHYSIQ ENGINE — Main App Component ─────────────────────────────────── */

window.PhysIQ = window.PhysIQ || {};

(function(PhysIQ) {

  var useState = React.useState;
  var useEffect = React.useEffect;
  var useMemo = React.useMemo;
  var useRef = React.useRef;

  // ─── Pull in all dependencies from namespace ───────────────────────────
  var Data = PhysIQ.Data;
  var Utils = PhysIQ.Utils;
  var Components = PhysIQ.Components;
  var Screens = PhysIQ.Screens;

  var GOALS = Data.GOALS;
  var EMPTY_INTAKE = Data.EMPTY_INTAKE;
  var DEFAULT_PROFILE = Data.DEFAULT_PROFILE;
  var FF_RESTAURANTS = Data.FF_RESTAURANTS;

  var loadUser = Utils.loadUser;
  var loadDaily = Utils.loadDaily;
  var loadHistory = Utils.loadHistory;
  var saveHistory = Utils.saveHistory;
  var sv = Utils.sv;
  var loadTheme = Utils.loadTheme;
  var getLastEmail = Utils.getLastEmail;
  var uKey = Utils.uKey;
  var calcTargets = Utils.calcTargets;
  var getSuggestions = Utils.getSuggestions;
  var getMealPeriod = Utils.getMealPeriod;
  var MEAL_PERIODS = Utils.MEAL_PERIODS;
  var AppTime = Utils.AppTime;

  var EXERCISE_MUSCLE = Data.EXERCISE_MUSCLE || {};

  // ─── Weekly muscle-tracker helpers ──────────────────────────────────────
  // Week boundary: Monday 00:00 local time.
  function getMondayKey(date) {
    var d = new Date(date);
    d.setHours(0, 0, 0, 0);
    var day = d.getDay();                    // 0=Sun..6=Sat
    var offset = day === 0 ? 6 : day - 1;    // days since Monday
    d.setDate(d.getDate() - offset);
    var y = d.getFullYear();
    var m = String(d.getMonth() + 1).padStart(2, "0");
    var dd = String(d.getDate()).padStart(2, "0");
    return y + "-" + m + "-" + dd;
  }
  function getEmptyWeeklyMuscles() {
    return { weekStart: getMondayKey(AppTime.now()), dates: {}, sessions: {} };
  }
  // If the stored weekStart is older than the current week's Monday, reset.
  // Schema: { weekStart, dates: { muscleId: [dateKey, ...] }, sessions: { muscleId: [...] } }
  // A muscle "hit" = one unique calendar day it was trained. Multiple workouts
  // on the same day for the same muscle still count as 1 hit.
  function rolloverWeeklyMuscles(raw) {
    var cur = getMondayKey(AppTime.now());
    if (!raw || !raw.weekStart || raw.weekStart !== cur) {
      return { weekStart: cur, dates: {}, sessions: {} };
    }
    return {
      weekStart: raw.weekStart,
      dates: raw.dates || {},
      sessions: raw.sessions || {}
    };
  }
  // Given a completed session, return the set of muscle ids that were hit
  // (at least one completed set targeting that muscle). No double-counting.
  function musclesHitBySession(session) {
    var hit = {};
    if (!session || !session.exercises) return [];
    session.exercises.forEach(function(ex) {
      var anyDone = (ex.sets || []).some(function(s) { return s.done; });
      if (!anyDone) return;
      var m = EXERCISE_MUSCLE[ex.name];
      if (m) hit[m] = true;
    });
    return Object.keys(hit);
  }

  var PortionModal = Components.PortionModal;
  var MuscleTracker = Components.MuscleTracker;

  var LoginScreen = Screens.LoginScreen;
  var OnboardScreen = Screens.OnboardScreen;
  var DashboardTab = Screens.DashboardTab;
  var EatsTab = Screens.EatsTab;
  var HealthTab = Screens.HealthTab;
  var CalendarTab = Screens.CalendarTab;
  var ExerciseTab = Screens.ExerciseTab;
  var ProfileTab = Screens.ProfileTab;

  // ─── App Component ─────────────────────────────────────────────────────
  function App() {
    // ── State ──────────────────────────────────────────────────────────
    var _theme = useState(loadTheme);           var theme = _theme[0], setTheme = _theme[1];
    var _email = useState("");                   var email = _email[0], setEmail = _email[1];
    var _screen = useState("loading");           var screen = _screen[0], setScreen = _screen[1];
    var _onboardStep = useState(0);              var onboardStep = _onboardStep[0], setOnboardStep = _onboardStep[1];

    var _profile = useState(Object.assign({}, DEFAULT_PROFILE)); var profile = _profile[0], setProfile = _profile[1];
    var _intake = useState(Object.assign({}, EMPTY_INTAKE));      var intake = _intake[0], setIntake = _intake[1];
    var _mealLog = useState([]);                 var mealLog = _mealLog[0], setMealLog = _mealLog[1];
    var _history = useState([]);                 var history = _history[0], setHistory = _history[1];

    var _tab = useState("dashboard");            var tab = _tab[0], setTab = _tab[1];
    var _addMenuOpen = useState(false);          var addMenuOpen = _addMenuOpen[0], setAddMenuOpen = _addMenuOpen[1];
    var _popupType = useState(null);             var popupType = _popupType[0], setPopupType = _popupType[1];
    var _mealForm = useState({ name: "", calories: "", protein: "", carbs: "", fats: "", fiber: "", sugar: "", sodium: "", potassium: "" });
    var mealForm = _mealForm[0], setMealForm = _mealForm[1];

    var _editingBMR = useState(false);           var editingBMR = _editingBMR[0], setEditingBMR = _editingBMR[1];
    var _bmrInput = useState("");                var bmrInput = _bmrInput[0], setBmrInput = _bmrInput[1];

    var _toast = useState(null);                 var toast = _toast[0], setToast = _toast[1];
    var _loginEmail = useState(getLastEmail());  var loginEmail = _loginEmail[0], setLoginEmail = _loginEmail[1];
    var _editing = useState(false);              var editing = _editing[0], setEditing = _editing[1];

    // ── Dev Mode (date override for testing time-based features) ──────
    // Source of truth lives in Utils.AppTime (persisted in localStorage).
    // We mirror it into React state so toggling re-renders the UI.
    var _devMode = useState(function() { return AppTime.getDevMode(); });
    var devMode = _devMode[0], setDevModeState = _devMode[1];
    var _devDate = useState(function() { return AppTime.getDevDate(); });
    var devDate = _devDate[0], setDevDateState = _devDate[1];

    var toggleDevMode = function() {
      var next = !AppTime.getDevMode();
      AppTime.setDevMode(next);
      setDevModeState(next);
      setDevDateState(AppTime.getDevDate());
    };
    var changeDevDate = function(key) {
      AppTime.setDevDate(key);
      setDevDateState(AppTime.getDevDate());
    };
    var shiftDevDate = function(days) {
      AppTime.shiftDevDate(days);
      setDevDateState(AppTime.getDevDate());
    };

    // Portion modal state
    var _portionItem = useState(null);           var portionItem = _portionItem[0], setPortionItem = _portionItem[1];
    var _portionGrams = useState(100);           var portionGrams = _portionGrams[0], setPortionGrams = _portionGrams[1];
    var _portionUnit = useState("grams");        var portionUnit = _portionUnit[0], setPortionUnit = _portionUnit[1];
    var _portionCount = useState(1);             var portionCount = _portionCount[0], setPortionCount = _portionCount[1];

    // Routines: array of routine objects { id, title, exercises: [{id, name, muscle, sets:[{reps,weight}]}] }
    var _routines = useState(function() {
      if (!email) return [];
      try {
        return JSON.parse(localStorage.getItem(uKey(email, "routines"))) || [];
      } catch(e) { return []; }
    });
    var routines = _routines[0], setRoutines = _routines[1];

    // Weekly muscle tracker: { weekStart: "YYYY-MM-DD", counts: {...}, sessions: {...} }
    var _weeklyMuscles = useState(function() {
      if (!email) return getEmptyWeeklyMuscles();
      try {
        var raw = JSON.parse(localStorage.getItem(uKey(email, "weeklyMuscles")));
        return rolloverWeeklyMuscles(raw);
      } catch(e) { return getEmptyWeeklyMuscles(); }
    });
    var weeklyMuscles = _weeklyMuscles[0], setWeeklyMuscles = _weeklyMuscles[1];

    // Completed workout log: array of session records
    var _workoutLog = useState(function() {
      if (!email) return [];
      try {
        return JSON.parse(localStorage.getItem(uKey(email, "workoutLog"))) || [];
      } catch(e) { return []; }
    });
    var workoutLog = _workoutLog[0], setWorkoutLog = _workoutLog[1];

    // Active meal period for food logging
    var _activeMealPeriod = useState(getMealPeriod());
    var activeMealPeriod = _activeMealPeriod[0], setActiveMealPeriod = _activeMealPeriod[1];

    // Onboarding form state
    var _obName = useState("");                  var obName = _obName[0], setObName = _obName[1];
    var _obAge = useState("28");                 var obAge = _obAge[0], setObAge = _obAge[1];
    var _obWeight = useState("180");             var obWeight = _obWeight[0], setObWeight = _obWeight[1];
    var _obHeight = useState("70");              var obHeight = _obHeight[0], setObHeight = _obHeight[1];
    var _obSex = useState("male");               var obSex = _obSex[0], setObSex = _obSex[1];
    var _obBodyfat = useState("18");             var obBodyfat = _obBodyfat[0], setObBodyfat = _obBodyfat[1];
    var _obGoal = useState("build");             var obGoal = _obGoal[0], setObGoal = _obGoal[1];
    var _obActivity = useState("moderate");      var obActivity = _obActivity[0], setObActivity = _obActivity[1];
    var _obSteps = useState("8000");             var obSteps = _obSteps[0], setObSteps = _obSteps[1];
    var _obGymDays = useState("5");              var obGymDays = _obGymDays[0], setObGymDays = _obGymDays[1];

    // ── Derived values ────────────────────────────────────────────────
    var targets = useMemo(function() { return calcTargets(profile); }, [profile]);
    var suggestions = useMemo(function() { return getSuggestions(profile, targets, intake); }, [profile, targets, intake]);

    // ── Effects ───────────────────────────────────────────────────────
    useEffect(function() {
      var last = getLastEmail();
      if (last) {
        var p = loadUser(last);
        if (p) {
          setEmail(last);
          setProfile(p);
          var d = loadDaily(last);
          setIntake(d.intake);
          setMealLog(d.meals);
          setHistory(loadHistory(last));
          try { setRoutines(JSON.parse(localStorage.getItem(uKey(last, "routines"))) || []); } catch(e) {}
          try { setWorkoutLog(JSON.parse(localStorage.getItem(uKey(last, "workoutLog"))) || []); } catch(e) {}
          try { setWeeklyMuscles(rolloverWeeklyMuscles(JSON.parse(localStorage.getItem(uKey(last, "weeklyMuscles"))))); } catch(e) { setWeeklyMuscles(getEmptyWeeklyMuscles()); }
          setScreen("app");
          return;
        }
      }
      setScreen("login");
    }, []);

    useEffect(function() {
      document.body.setAttribute("data-theme", theme);
      try { localStorage.setItem("pq_theme", theme); } catch(err) {}
    }, [theme]);

    // Persistence effects — all skip writing to localStorage while Dev
    // Mode is on, so dev-session changes are sandboxed in memory and
    // discarded when Dev Mode is turned off.
    useEffect(function() {
      if (screen === "app" && email && !AppTime.getDevMode()) sv(email, "profile", profile);
    }, [profile, screen, email]);

    useEffect(function() {
      if (screen === "app" && email && !AppTime.getDevMode()) sv(email, "intake", intake);
    }, [intake, screen, email]);

    useEffect(function() {
      if (screen === "app" && email && !AppTime.getDevMode()) {
        sv(email, "meals", mealLog);
        try { localStorage.setItem(uKey(email, "date"), AppTime.now().toDateString()); } catch(err) {}
      }
    }, [mealLog, screen, email]);

    useEffect(function() {
      if (screen !== "app" || !email || intake.calories === 0) return;
      // History React state always updates so the calendar/charts reflect
      // dev-day macros immediately. localStorage write is skipped in Dev
      // Mode so real history isn't tainted.
      var t = AppTime.now().toDateString();
      var h = history.slice();
      var ei = h.findIndex(function(d) { return d.date === t; });
      var sn = { date: t, calories: intake.calories, protein: intake.protein, carbs: intake.carbs, fats: intake.fats, sodium: intake.sodium };
      if (ei >= 0) h[ei] = sn; else h.push(sn);
      if (JSON.stringify(h) !== JSON.stringify(history)) {
        setHistory(h);
        if (!AppTime.getDevMode()) saveHistory(email, h);
      }
    }, [intake, screen, email]);

    // Persist routines
    useEffect(function() {
      if (screen === "app" && email && !AppTime.getDevMode()) sv(email, "routines", routines);
    }, [routines, screen, email]);

    // Persist workout log
    useEffect(function() {
      if (screen === "app" && email && !AppTime.getDevMode()) sv(email, "workoutLog", workoutLog);
    }, [workoutLog, screen, email]);

    // Persist weekly muscle tracker
    useEffect(function() {
      if (screen === "app" && email && !AppTime.getDevMode()) sv(email, "weeklyMuscles", weeklyMuscles);
    }, [weeklyMuscles, screen, email]);

    // Rollover check — runs once per render cycle; cheap and guards against
    // users returning after a week without reloading.
    useEffect(function() {
      var cur = getMondayKey(AppTime.now());
      if (weeklyMuscles && weeklyMuscles.weekStart !== cur) {
        setWeeklyMuscles({ weekStart: cur, counts: {}, sessions: {} });
      }
    }, [weeklyMuscles && weeklyMuscles.weekStart]);

    // ── Dev Mode session sandbox ─────────────────────────────────────
    //
    // Goal: while Dev Mode is on, intake/meals are scoped to the current
    // app date. Skipping to a new day starts fresh. Skipping back to a
    // day already visited in this session restores what was logged then.
    // Toggling Dev Mode OFF discards everything logged during the session
    // and restores the user's real data exactly as it was.
    //
    // We keep:
    //   realSnapshotRef  → whole-state snapshot taken when Dev Mode turns
    //                      on. Used to restore on turn-off.
    //   devBufferRef     → { "YYYY-MM-DD": { intake, mealLog } } per dev
    //                      day visited in this session. Lives in memory
    //                      only; never persisted.
    //   prevDevModeRef   → tracks the previous render's devMode so we can
    //                      detect transitions.
    //   prevDevDateRef   → tracks previous render's devDate to detect
    //                      day rollover within an active session.
    //
    // We initialize prevDevModeRef to false so a page-load that hydrates
    // with Dev Mode already on is treated as a fresh OFF→ON transition,
    // snapshotting the just-loaded real data as the baseline.
    var realSnapshotRef = useRef(null);
    var devBufferRef = useRef({});
    var prevDevModeRef = useRef(false);
    var prevDevDateRef = useRef(devDate);

    useEffect(function() {
      if (screen !== "app" || !email) return;
      var prevMode = prevDevModeRef.current;
      var prevDate = prevDevDateRef.current;

      if (!prevMode && devMode) {
        // OFF → ON: snapshot the entire real state so we can restore it.
        realSnapshotRef.current = {
          intake: intake,
          mealLog: mealLog,
          workoutLog: workoutLog,
          weeklyMuscles: weeklyMuscles,
          history: history,
          weightLog: profile.weightLog ? profile.weightLog.slice() : null,
          weight: profile.weight
        };
        // Seed the buffer for the initial dev day with the real data so
        // the screen doesn't visually wipe at the moment of toggle.
        devBufferRef.current = {};
        devBufferRef.current[devDate] = { intake: intake, mealLog: mealLog };
      } else if (prevMode && !devMode) {
        // ON → OFF: restore real state. Drop the buffer.
        var snap = realSnapshotRef.current;
        if (snap) {
          setIntake(snap.intake);
          setMealLog(snap.mealLog);
          setWorkoutLog(snap.workoutLog);
          setWeeklyMuscles(snap.weeklyMuscles);
          setHistory(snap.history);
          // Restore weight log + weight number on profile (other profile
          // fields kept as-is since they aren't time-bound logs).
          setProfile(function(p) {
            return Object.assign({}, p, { weightLog: snap.weightLog, weight: snap.weight });
          });
        }
        realSnapshotRef.current = null;
        devBufferRef.current = {};
      } else if (prevMode && devMode && prevDate !== devDate) {
        // Day change within an active dev session.
        // Save what's currently on screen under the OLD dev date.
        devBufferRef.current[prevDate] = { intake: intake, mealLog: mealLog };
        // Load the buffered values for the NEW dev date if we've been
        // there before in this session; otherwise start fresh.
        var next = devBufferRef.current[devDate];
        if (next) {
          setIntake(next.intake);
          setMealLog(next.mealLog);
        } else {
          setIntake(Object.assign({}, EMPTY_INTAKE));
          setMealLog([]);
        }
      }

      prevDevModeRef.current = devMode;
      prevDevDateRef.current = devDate;
    }, [devMode, devDate, screen, email]);

    // ── Handlers ──────────────────────────────────────────────────────
    var up = function(k, v) { setProfile(function(p) { return Object.assign({}, p, { [k]: v }); }); };

    // Append-or-replace today's actual weight log entry. We replace the
    // entry for the current app date if one already exists (so users can
    // correct a same-day mistake) but never touch past entries — that
    // would corrupt actual weight history. The current `profile.weight`
    // (used by BMR/TDEE) is also synced so calculations stay consistent.
    var logWeight = function(lbs) {
      if (typeof lbs !== "number" || lbs <= 0) return;
      var now = AppTime.now();
      var pad = function(n) { return n < 10 ? "0" + n : "" + n; };
      var key = now.getFullYear() + "-" + pad(now.getMonth() + 1) + "-" + pad(now.getDate());
      setProfile(function(p) {
        var prev = Array.isArray(p.weightLog) ? p.weightLog.slice() : [];
        var idx = -1;
        for (var i = 0; i < prev.length; i++) { if (prev[i] && prev[i].date === key) { idx = i; break; } }
        var entry = { date: key, weight: lbs };
        if (idx >= 0) prev[idx] = entry; else prev.push(entry);
        return Object.assign({}, p, { weightLog: prev, weight: lbs });
      });
      showToast("Weight logged");
    };

    var toggleMuscle = function(id) {
      setProfile(function(p) {
        return Object.assign({}, p, {
          todayMuscles: p.todayMuscles.includes(id)
            ? p.todayMuscles.filter(function(m) { return m !== id; })
            : p.todayMuscles.concat([id])
        });
      });
    };

    var DAYS_FULL = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

    // ─── Routine handlers ─────────────────────────────────────────────
    var saveRoutine = function(routine) {
      setRoutines(function(prev) {
        var exists = prev.some(function(r) { return r.id === routine.id; });
        if (exists) {
          var updated = prev.map(function(r) { return r.id === routine.id ? routine : r; });
          showToast("Routine updated!");
          return updated;
        }
        showToast("Routine saved!");
        return prev.concat([routine]);
      });
    };

    var deleteRoutine = function(routineId) {
      setRoutines(function(prev) {
        return prev.filter(function(r) { return r.id !== routineId; });
      });
      showToast("Routine deleted");
    };

    var logCompletedWorkout = function(session) {
      setWorkoutLog(function(prev) { return prev.concat([session]); });

      // Update weekly muscle tracker — one hit per muscle per unique DAY.
      // Same muscle trained twice in one day still counts as 1 hit toward the
      // weekly 2-day target.
      var hitMuscles = musclesHitBySession(session);
      if (hitMuscles.length > 0) {
        var dayKey = (function() {
          var d = new Date(session.finishedAt || AppTime.nowMs());
          return d.getFullYear() + "-" +
            String(d.getMonth() + 1).padStart(2, "0") + "-" +
            String(d.getDate()).padStart(2, "0");
        })();
        setWeeklyMuscles(function(prev) {
          var base = rolloverWeeklyMuscles(prev);
          var dates = Object.assign({}, base.dates);
          var sessions = Object.assign({}, base.sessions);
          hitMuscles.forEach(function(m) {
            var days = (dates[m] || []).slice();
            if (days.indexOf(dayKey) < 0) days.push(dayKey);
            dates[m] = days;
            var sArr = (sessions[m] || []).slice();
            sArr.push({ id: session.id, title: session.title, finishedAt: session.finishedAt });
            sessions[m] = sArr;
          });
          return { weekStart: base.weekStart, dates: dates, sessions: sessions };
        });
      }

      var label = session.totalSets > 0 && session.completedSets === session.totalSets
        ? "Workout complete!"
        : "Workout saved (" + session.completedSets + "/" + session.totalSets + " sets)";
      showToast(label);
    };

    var logNutrients = function(name, nums, period) {
      var mealPeriod = period || activeMealPeriod || getMealPeriod();
      setMealLog(function(prev) {
        return prev.concat([Object.assign({
          id: Date.now(),
          name: name,
          time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
          period: mealPeriod
        }, nums)]);
      });
      setIntake(function(prev) {
        var n = Object.assign({}, prev);
        Object.keys(nums).forEach(function(k) { if (k in n) n[k] = (n[k] || 0) + nums[k]; });
        return n;
      });
    };

    var addMeal = function() {
      var nums = {};
      Object.keys(mealForm).forEach(function(k) { if (k !== "name") nums[k] = parseFloat(mealForm[k]) || 0; });
      logNutrients(mealForm.name || "Meal", nums);
      setMealForm({ name: "", calories: "", protein: "", carbs: "", fats: "", fiber: "", sugar: "", sodium: "", potassium: "" });
      showToast((mealForm.name || "Meal") + " logged!");
    };

    var addFF = function(item, chainId) {
      var rName = chainId ? ((FF_RESTAURANTS.find(function(r) { return r.id === chainId; }) || {}).name || "") : "";
      var fullName = rName ? rName + " — " + item.name : item.name;
      logNutrients(
        fullName,
        { calories: item.cal, protein: item.protein, carbs: item.carbs, fats: item.fats, fiber: item.fiber, sugar: item.sugar, sodium: item.sodium, potassium: item.potassium || 0 }
      );
      showToast(item.name + " logged!");
    };

    // Open Food Facts food → portion modal
    var addSearchFood = function(item) {
      setPortionItem(item);
      setPortionGrams(parseFloat(item.serving) || 100);
      setPortionUnit("grams");
      setPortionCount(1);
    };

    var confirmPortion = function() {
      if (!portionItem) return;

      var s;
      if (portionItem._perServing) {
        var baseGrams = portionItem._servingGrams || 100;
        if (portionUnit === "count") {
          s = portionCount; // Exactly 1x multiplier for 1 count
        } else {
          s = baseGrams > 0 ? (portionGrams / baseGrams) : 1;
        }
      } else {
        if (portionUnit === "count") {
          // Parse serving grams from the serving string (e.g. "30g", "1 cookie (28g)")
          var servingGrams = 100;
          if (portionItem.serving) {
            var match = portionItem.serving.match(/(\d+\.?\d*)\s*g/i);
            if (match) servingGrams = parseFloat(match[1]);
          }
          s = (portionCount * servingGrams) / 100;
        } else {
          s = portionGrams / 100;
        }
      }

      var nums = {
        calories: Math.round(portionItem.cal * s),
        protein: Math.round(portionItem.protein * s),
        carbs: Math.round(portionItem.carbs * s),
        fats: Math.round(portionItem.fats * s),
        fiber: Math.round(portionItem.fiber * s),
        sugar: Math.round(portionItem.sugar * s),
        sodium: Math.round(portionItem.sodium * s),
        potassium: Math.round(portionItem.potassium * s)
      };

      var suffix = portionUnit === "count"
        ? " ×" + portionCount
        : "";

      logNutrients(portionItem.name + (portionItem.brand ? " (" + portionItem.brand + ")" : "") + suffix, nums);
      showToast(portionItem.name + " logged!");
      setPortionItem(null);
    };

    // Re-add a previously logged food (from Recent Eats)
    var reAddFood = function(meal) {
      logNutrients(meal.name, {
        calories: meal.calories || 0,
        protein: meal.protein || 0,
        carbs: meal.carbs || 0,
        fats: meal.fats || 0,
        fiber: meal.fiber || 0,
        sugar: meal.sugar || 0,
        sodium: meal.sodium || 0,
        potassium: meal.potassium || 0
      });
      showToast(meal.name + " added again!");
    };

    var removeMeal = function(id) {
      var meal = mealLog.find(function(m) { return m.id === id; });
      if (!meal) return;
      setMealLog(function(prev) { return prev.filter(function(m) { return m.id !== id; }); });
      setIntake(function(prev) {
        var n = Object.assign({}, prev);
        ["calories", "protein", "carbs", "fats", "fiber", "sugar", "sodium", "potassium"].forEach(function(k) {
          n[k] = Math.max(0, (n[k] || 0) - (meal[k] || 0));
        });
        return n;
      });
    };

    var moveMealToPeriod = function(mealId, newPeriod) {
      setMealLog(function(prev) {
        return prev.map(function(m) {
          if (m.id === mealId) {
            return Object.assign({}, m, { period: newPeriod });
          }
          return m;
        });
      });
      var periodLabel = (MEAL_PERIODS.find(function(p) { return p.id === newPeriod; }) || {}).label || newPeriod;
      showToast("Moved to " + periodLabel);
    };

    var addWater = function(oz) { setIntake(function(prev) { return Object.assign({}, prev, { water: Math.max(0, prev.water + oz) }); }); };

    var showToast = function(msg) {
      setToast(msg);
      setTimeout(function() { setToast(null); }, 1800);
    };

    var resetDay = function() {
      if (!confirm("Reset today's data?")) return;
      setIntake(Object.assign({}, EMPTY_INTAKE));
      setMealLog([]);
      setProfile(function(p) { return Object.assign({}, p, { todayMuscles: [] }); });
    };

    var doLogin = function() {
      if (!loginEmail.trim() || !loginEmail.includes("@")) return;
      var e = loginEmail.trim().toLowerCase();
      localStorage.setItem("pq_last_email", e);
      setEmail(e);
      var p = loadUser(e);
      if (p) {
        setProfile(p);
        var d = loadDaily(e);
        setIntake(d.intake);
        setMealLog(d.meals);
        setHistory(loadHistory(e));
        try { setRoutines(JSON.parse(localStorage.getItem(uKey(e, "routines"))) || []); } catch(err) {}
        try { setWorkoutLog(JSON.parse(localStorage.getItem(uKey(e, "workoutLog"))) || []); } catch(err) {}
        try { setWeeklyMuscles(rolloverWeeklyMuscles(JSON.parse(localStorage.getItem(uKey(e, "weeklyMuscles"))))); } catch(err) { setWeeklyMuscles(getEmptyWeeklyMuscles()); }
        setScreen("app");
      } else {
        setScreen("onboard");
        setOnboardStep(0);
      }
    };

    var finishOnboard = function() {
      var p = Object.assign({}, DEFAULT_PROFILE, {
        name: obName,
        age: parseInt(obAge) || 28,
        weight: parseInt(obWeight) || 180,
        height: parseInt(obHeight) || 70,
        sex: obSex,
        bodyfat: parseInt(obBodyfat) || 18,
        goal: obGoal,
        activity: obActivity,
        steps: parseInt(obSteps) || 8000,
        gymDays: parseInt(obGymDays) || 5
      });
      setProfile(p);
      sv(email, "profile", p);
      localStorage.setItem("pq_last_email", email);
      setScreen("app");
    };

    // ── Render ────────────────────────────────────────────────────────
    if (screen === "loading") return null;

    if (screen === "login") {
      return <LoginScreen loginEmail={loginEmail} setLoginEmail={setLoginEmail} doLogin={doLogin} />;
    }

    if (screen === "onboard") {
      return (
        <OnboardScreen
          onboardStep={onboardStep} setOnboardStep={setOnboardStep}
          obName={obName} setObName={setObName}
          obAge={obAge} setObAge={setObAge}
          obWeight={obWeight} setObWeight={setObWeight}
          obHeight={obHeight} setObHeight={setObHeight}
          obSex={obSex} setObSex={setObSex}
          obBodyfat={obBodyfat} setObBodyfat={setObBodyfat}
          obGoal={obGoal} setObGoal={setObGoal}
          obActivity={obActivity} setObActivity={setObActivity}
          obSteps={obSteps} setObSteps={setObSteps}
          obGymDays={obGymDays} setObGymDays={setObGymDays}
          finishOnboard={finishOnboard}
        />
      );
    }

    // ── Main App UI ───────────────────────────────────────────────────
    // Pretty-format dev date for the banner
    var devDateLabel = (function() {
      try {
        var p = devDate.split("-");
        var d = new Date(parseInt(p[0]), parseInt(p[1]) - 1, parseInt(p[2]));
        return d.toLocaleDateString([], { weekday: "short", month: "short", day: "numeric", year: "numeric" });
      } catch(e) { return devDate; }
    })();

    return (
      <React.Fragment>
        {/* Dev Mode banner — visible everywhere when active */}
        {devMode && (
          <div className="dev-banner" onClick={function() { setTab("dashboard"); }}>
            <span className="dev-banner-dot" />
            <span className="dev-banner-text">DEV MODE ACTIVE — {devDateLabel}</span>
          </div>
        )}

        {/* Toast */}
        {toast && <div className="added-toast">{"\u2705"} {toast}</div>}

        {/* Portion Modal */}
        <PortionModal
          portionItem={portionItem} setPortionItem={setPortionItem}
          portionGrams={portionGrams} setPortionGrams={setPortionGrams}
          portionUnit={portionUnit} setPortionUnit={setPortionUnit}
          portionCount={portionCount} setPortionCount={setPortionCount}
          confirmPortion={confirmPortion}
        />

        {/* Header */}
        <div style={{ padding: "20px 20px 16px", background: "linear-gradient(180deg,var(--bg-header) 0%,transparent 100%)" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
            <div className="mono" style={{ fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: 2, color: "var(--blue)" }}>PHYSIQ ENGINE</div>
            <div className="flex-row" style={{ gap: 8 }}>
              <span style={{ fontSize: 11, color: "var(--text-muted)" }}>{theme === "dark" ? "\uD83C\uDF19" : "\u2600\uFE0F"}</span>
              <button className="theme-toggle" onClick={function() { setTheme(function(t) { return t === "dark" ? "light" : "dark"; }); }} />
            </div>
          </div>
          <div style={{ fontSize: 22, fontWeight: 700, color: "var(--text-white)", lineHeight: 1.2 }}>
            {(GOALS.find(function(g) { return g.id === profile.goal; }) || {}).icon} {(GOALS.find(function(g) { return g.id === profile.goal; }) || {}).label} Mode
          </div>
          <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 4 }}>
            {targets.tdee} TDEE {"\u00B7"} {targets.leanMass}lb lean {"\u00B7"} {profile.steps.toLocaleString()} steps
            {targets.isOverridden && <span className="bmr-override-badge">{"\u00B7"} BMR Override</span>}
          </div>
        </div>

        {/* Tab Content */}
        <div style={{ padding: "0 16px" }}>
          {tab === "dashboard" && (
            <DashboardTab
              intake={intake} targets={targets} profile={profile}
              suggestions={suggestions} mealLog={mealLog}
              addWater={addWater} removeMeal={removeMeal} resetDay={resetDay}
              onQuickNav={function(tabId, mode) { setTab(tabId); setAddMenuOpen(false); setPopupType(null); }}
              devMode={devMode} devDate={devDate}
              toggleDevMode={toggleDevMode} changeDevDate={changeDevDate} shiftDevDate={shiftDevDate}
            />
          )}

          {tab === "eats" && (
            <EatsTab
              intake={intake} targets={targets}
              mealLog={mealLog}
              addSearchFood={addSearchFood}
              addFF={addFF}
              mealForm={mealForm} setMealForm={setMealForm} addMeal={addMeal}
              removeMeal={removeMeal}
              moveMealToPeriod={moveMealToPeriod}
              activeMealPeriod={activeMealPeriod}
              setActiveMealPeriod={setActiveMealPeriod}
              reAddFood={reAddFood}
            />
          )}

          {tab === "health" && (
            <HealthTab
              profile={profile} targets={targets}
              up={up} workoutLog={workoutLog}
            />
          )}

          {tab === "calendar" && (
            <CalendarTab
              history={history}
              workoutLog={workoutLog}
              intake={intake}
              targets={targets}
              profile={profile}
              devTick={devMode + "|" + devDate}
            />
          )}

          {tab === "exercise" && (
            <ExerciseTab
              routines={routines}
              saveRoutine={saveRoutine}
              deleteRoutine={deleteRoutine}
              logCompletedWorkout={logCompletedWorkout}
              weeklyMuscles={weeklyMuscles}
            />
          )}

          {tab === "profile" && (
            <ProfileTab
              profile={profile} targets={targets} email={email} history={history}
              up={up} logWeight={logWeight}
              editingBMR={editingBMR} setEditingBMR={setEditingBMR}
              bmrInput={bmrInput} setBmrInput={setBmrInput}
              editing={editing} setEditing={setEditing}
              theme={theme} setTheme={setTheme}
              setScreen={setScreen} setEmail={setEmail} setLoginEmail={setLoginEmail}
            />
          )}
        </div>

        {/* Bottom Navigation */}
        <div className="nav">
          {[
            { id: "dashboard", label: "Dashboard", icon: "\u25C9" },
            { id: "health",    label: "Health",    icon: "\u2666" },
            { id: "__add",     label: "",          icon: "+"      },
            { id: "calendar",  label: "Calendar",  icon: "\u25A6" },
            { id: "profile",   label: "Profile",   icon: "\u2699" }
          ].map(function(t) {
            if (t.id === "__add") {
              var addActive = tab === "eats" || tab === "exercise" || addMenuOpen;
              return (
                <button
                  key="__add"
                  className={"nav-btn nav-add-btn" + (addActive ? " active" : "")}
                  onClick={function() { setAddMenuOpen(true); }}
                  aria-label="Open quick menu"
                >
                  <span className="nav-add-circle">{t.icon}</span>
                </button>
              );
            }
            return (
              <button key={t.id} className={"nav-btn" + (tab === t.id ? " active" : "")} onClick={function() { setTab(t.id); setAddMenuOpen(false); setPopupType(null); }}>
                <span>{t.icon}</span>
                <span>{t.label}</span>
              </button>
            );
          })}
        </div>

        {/* Add Menu Bottom Sheet — Redesigned */}
        {addMenuOpen && !popupType && (
          <div className="add-menu-backdrop" onClick={function() { setAddMenuOpen(false); }}>
            <div className="add-menu-sheet" onClick={function(e) { e.stopPropagation(); }}>
              <div className="add-menu-handle" />
              <div className="add-menu-title">Quick Access</div>
              <div className="add-menu-cards">
                <button
                  className="add-menu-card eats-card"
                  onClick={function() { setPopupType("eats"); }}
                >
                  <div className="add-menu-card-icon">{"\uD83C\uDF4E"}</div>
                  <div className="add-menu-card-label">Eats</div>
                  <div className="add-menu-card-sub">Log food & nutrition</div>
                </button>
                <button
                  className="add-menu-card exercise-card"
                  onClick={function() { setPopupType("exercise"); }}
                >
                  <div className="add-menu-card-icon">{"\uD83C\uDFCB\uFE0F"}</div>
                  <div className="add-menu-card-label">Exercise</div>
                  <div className="add-menu-card-sub">Routines & workouts</div>
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Eats Popup Overlay — Full EatsTab embedded */}
        {popupType === "eats" && (
          <div className="popup-overlay">
            <div className="popup-header">
              <button className="popup-close-btn" onClick={function() { setPopupType(null); setAddMenuOpen(false); }} aria-label="Close">{"\u00D7"}</button>
              <div className="popup-header-title">Log Food</div>
              <span className="popup-header-icon">{"\uD83C\uDF4E"}</span>
            </div>
            <div className="popup-content">
              <EatsTab
                intake={intake} targets={targets}
                mealLog={mealLog}
                addSearchFood={addSearchFood}
                addFF={addFF}
                mealForm={mealForm} setMealForm={setMealForm} addMeal={addMeal}
                removeMeal={removeMeal}
                moveMealToPeriod={moveMealToPeriod}
                activeMealPeriod={activeMealPeriod}
                setActiveMealPeriod={setActiveMealPeriod}
                reAddFood={reAddFood}
              />
            </div>
            {/* Portion modal inside popup so it renders above the overlay */}
            <PortionModal
              portionItem={portionItem} setPortionItem={setPortionItem}
              portionGrams={portionGrams} setPortionGrams={setPortionGrams}
              portionUnit={portionUnit} setPortionUnit={setPortionUnit}
              portionCount={portionCount} setPortionCount={setPortionCount}
              confirmPortion={confirmPortion}
            />
          </div>
        )}

        {/* Exercise Popup Overlay — Full ExerciseTab embedded */}
        {popupType === "exercise" && (
          <div className="popup-overlay">
            <div className="popup-header">
              <button className="popup-close-btn" onClick={function() { setPopupType(null); setAddMenuOpen(false); }} aria-label="Close">{"\u00D7"}</button>
              <div className="popup-header-title">Exercise</div>
              <span className="popup-header-icon">{"\uD83C\uDFCB\uFE0F"}</span>
            </div>
            <div className="popup-content">
              <ExerciseTab
                routines={routines}
                saveRoutine={saveRoutine}
                deleteRoutine={deleteRoutine}
                logCompletedWorkout={logCompletedWorkout}
                weeklyMuscles={weeklyMuscles}
              />
            </div>
          </div>
        )}
      </React.Fragment>
    );
  }

  // ─── Mount ──────────────────────────────────────────────────────────────
  ReactDOM.createRoot(document.getElementById("app")).render(<App />);

})(window.PhysIQ);
