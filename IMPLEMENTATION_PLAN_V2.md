# Physiq Engine → iOS App Store Implementation Plan (V2)

A revised, production-grade plan for shipping Physiq Engine to the Apple App Store via **Capacitor 7**. Merges the original phased build plan with corrections from real-world App Store review behavior.

---

## 1. Overview / Strategy

**Goal:** Ship a stable, polished, offline-capable iOS app with **minimum rewrite** of the existing ~14k LOC web codebase.

**Strategy:**
- Wrap existing React/JS app in Capacitor 7 (preserve ~98% of code)
- Replace fragile web APIs (`html5-qrcode`, raw `localStorage`) with native equivalents or hardened wrappers
- Prioritize **UX quality, stability, and offline behavior** over feature count
- Ship v1 with a small set of well-integrated native features; defer everything else

**Approval thesis:** Apple rejects apps that *feel* like websites — not apps with "too few" native APIs. A fast, stable, offline-capable app with native polish will pass.

---

## 2. Key Technical Decisions

| Decision | Choice | Rationale |
|---|---|---|
| Wrapper | Capacitor 7 | ~98% code reuse vs. RN/Flutter rewrite |
| Build tool | esbuild | Removes runtime Babel; ~5x faster load |
| Storage (v1) | Hardened `localStorage` wrapper | Ship fast; abstraction enables future swap |
| Storage (v2 path) | Capacitor Preferences → SQLite | Migrate when data volume warrants |
| Barcode | `@capacitor-mlkit/barcode-scanning` (native) | `html5-qrcode` in WKWebView is unreliable |
| Min iOS target | iOS 16 | Wide device coverage |
| Xcode | Latest public Xcode at submission time | Apple requirement; do not hardcode versions |
| Bundle size goal | < 100 KB JS, ~50 MB app | Fast cold start |

---

## 3. Corrected App Store Assumptions

| Original Claim | Reality |
|---|---|
| "Apple requires 4+ native features (Guideline 4.2)" | ❌ False. No specific count exists. |
| "Pure web wrappers always rejected" | ⚠️ Rejected when they *feel* like websites — slow, unpolished, no offline use, no native chrome. |
| "html5-qrcode works fine in WKWebView" | ❌ Camera permissions, autofocus, and perf are unreliable. Use a native plugin. |
| "localStorage 5MB is fine forever" | ⚠️ True for v1 data volumes, but iOS can evict WKWebView storage under pressure. Must add quota guard, corruption recovery, and export/import. |
| "Open Food Facts / USDA are unlimited" | ⚠️ Best-effort public APIs. Add caching, retry, debounce, and offline messaging. |
| "Xcode 26 / iOS 26 required" | ❌ Speculative. Apple requires whatever the *current* public Xcode is at submission. Don't hardcode. |
| "Guideline 4.0" | Corrected to **4.2 — Minimum Functionality** (but framed correctly: it's about polish, not feature count). |

---

## 4. Architecture Decisions

### 4.1 Storage Strategy (with Upgrade Path)

**v1 — Hardened localStorage wrapper** (`js/utils/storage.js`)

All reads/writes go through a single module exposing:
```
get(key, default)     // safe JSON.parse, returns default on corruption
set(key, value)       // catches QuotaExceededError → prune → retry
remove(key)
getUsageBytes()
exportAll() / importAll(json)
```

Required guards:
- **Safe parse:** corruption resets the key to default + emits toast (no white screen)
- **Quota guard:** on `QuotaExceededError`, auto-prune oldest history entries, retry once, surface toast if still failing
- **Schema version field** on every persisted blob → enables migrations
- **Export/Import** as JSON file (user-driven backup; also doubles as App Review safety net)

**v2 upgrade path (post-launch, behind flag):**
- Drop-in replace internals with `@capacitor/preferences` (KV) for small data
- For history/logs, migrate to `@capacitor-community/sqlite`
- Public API of the wrapper does not change → screens untouched

### 4.2 Barcode Scanning (Native Plugin)

- **Remove** `html5-qrcode` from the food search flow
- **Add** `@capacitor-mlkit/barcode-scanning` (or `@capacitor-community/barcode-scanner`)
- Native UI for camera preview; web fallback shows "Open the iOS app to scan"
- Add `NSCameraUsageDescription` to `Info.plist` with clear copy: *"Used to scan food barcodes for nutrition lookup."*
- Permission denied → graceful manual-entry fallback, never a dead end

### 4.3 Network Layer (Food Search APIs)

- 300 ms debounce on input
- 10 s `AbortController` timeout
- LRU cache of last 50 queries (in-memory + persisted)
- Retry once on transient failure with backoff
- `navigator.onLine` short-circuit → "Search needs internet — manual entry still works"

### 4.4 Error Boundaries

- React `<ErrorBoundary>` at the app root + per-tab
- Branded fallback UI with **Reload** + **Export Data** buttons (so a crash never traps user data)
- Global `window.onerror` and `unhandledrejection` → toast + log

---

## 5. Implementation Phases

### Phase 1 — Build System (esbuild)
- Add `package.json`, `build.mjs`
- Bundle React + ReactDOM locally
- JSX automatic runtime
- Output `dist/{index.html, app.min.js, styles.min.css}`
- `--watch` for dev
- **Done when:** `dist/` loads in browser, zero `text/babel` script tags

### Phase 2 — Capacitor iOS Setup
- `capacitor.config.ts` (`webDir: dist`, `contentInset: 'always'`)
- `npx cap add ios`
- Plugins: `@capacitor/haptics`, `@capacitor/share`, `@capacitor/status-bar`, `@capacitor/keyboard`, `@capacitor/splash-screen`
- Safe-area CSS via `env(safe-area-inset-*)`, `viewport-fit=cover`
- Disable rubber-band overscroll, long-press selection on interactive elements
- **Done when:** App boots in Simulator with correct insets and no flash of unstyled content

### Phase 3 — Native Enhancements
**Required (UX-critical):**
- Native barcode scanner (replaces html5-qrcode)
- Haptics on key interactions (log, complete, tab switch)
- Native share sheet ("Share Progress" in Profile)
- Splash screen + launch storyboard (no white flash)
- Keyboard plugin (resize behavior, accessory bar)

**Optional (user-toggleable, never blocking):**
- Local notifications (hydration / meal reminders)
- Biometric lock (FaceID/TouchID) — must have a **clear bypass**

### Phase 4 — Data Layer
- Implement storage abstraction (§4.1)
- Add `exportUserData()` / `importUserData()` with schema version
- Profile tab: **Export Data**, **Import Data** buttons
- Pruning logic for history > N days (configurable, default keep 365)

### Phase 5 — Stability & Error Handling
- `<ErrorBoundary>` (root + per-tab)
- Global error/unhandledrejection handlers → toast
- Offline state surfaced in food search and any other network screen
- Remove all dev-only UI from production builds (`?dev=1` gate)

### Phase 6 — App Store Preparation
- Privacy policy (GitHub Pages)
- `PrivacyInfo.xcprivacy` manifest
- App icons (full set incl. 1024)
- Launch storyboard polish
- App Store Connect metadata + screenshots
- TestFlight build → real-device pass → submit

---

## 6. Native Features (Required vs Optional)

| Feature | Required? | Plugin | Notes |
|---|---|---|---|
| Native barcode scanner | ✅ Required | `@capacitor-mlkit/barcode-scanning` | Replaces unreliable web scanner |
| Haptics | ✅ Required | `@capacitor/haptics` | Cheap, large UX win |
| Share sheet | ✅ Required | `@capacitor/share` | Justifies "native" feel |
| Status bar / Splash / Keyboard | ✅ Required | `@capacitor/*` | Eliminates web-feel issues |
| Safe-area handling | ✅ Required | CSS only | Notch / Dynamic Island / home indicator |
| Local notifications | ⚙️ Optional | `@capacitor/local-notifications` | Off by default; explained on prompt |
| Biometric lock | ⚙️ Optional | `@capgo/capacitor-native-biometric` | User-toggle; never blocks app |
| Health integration | ❌ Future | `@capacitor-community/health` | Out of scope for v1 |

> Apple does **not** require any specific count. These are chosen because each removes a real web-app pain point.

---

## 7. Data Resilience Plan

| Concern | Mitigation |
|---|---|
| WKWebView storage eviction | Storage abstraction + quota guard + automatic export reminder every 30 days |
| Quota exceeded | Catch → prune oldest history → retry → toast on failure |
| JSON corruption | Safe parse → reset to default for that key → toast (never white-screen) |
| Schema drift between versions | `schemaVersion` field + idempotent migration step on app boot |
| User data loss on uninstall | **Export Data** in Profile (JSON download via share sheet) |
| Reviewer-induced data loss | Pre-seeded demo account; export works without login |
| Future scale | Public API stable; can swap to Preferences/SQLite without screen changes |

---

## 8. UX / Stability Requirements

**Hard requirements before submission:**

- ✅ **Cold start < 2s** to interactive UI on iPhone 12 or newer
- ✅ **No white screen** ever — splash → app shell, then content; ErrorBoundary catches render errors
- ✅ **Offline launch works** — all tabs render; only network-dependent flows (food search) show offline state
- ✅ **Tab switches feel instant** — no remount, scroll position preserved
- ✅ **Keyboard never covers active input** — Capacitor Keyboard plugin + scroll-into-view on focus
- ✅ **No layout shift** during launch
- ✅ **No "tap delay"** (300ms) — handled by modern WebView, but verify
- ✅ **Pull-to-refresh disabled** where it does nothing
- ✅ **Long-press text selection disabled** on buttons / nav
- ✅ **Safe areas respected** on notch + Dynamic Island + home indicator
- ✅ **All buttons hit ≥ 44pt** target

---

## 9. App Store Submission Requirements

**Required:**
- Apple Developer Program enrollment ($99/yr)
- Bundle ID (permanent — decide before first archive)
- Privacy policy URL (public)
- `PrivacyInfo.xcprivacy` manifest (declare: NSUserDefaults, Camera, FaceID if used)
- App Privacy labels in App Store Connect (match the manifest)
- Camera + (optional) FaceID + (optional) Notifications usage strings in `Info.plist` — clear, user-facing copy
- Demo account or "no login required" path documented in Reviewer Notes
- App icon set incl. 1024×1024
- ≥ 3 screenshots per required device size
- Age rating, category (**Health & Fitness**), keywords

**Open decisions (block submission):**
- [ ] Final **Bundle ID**
- [ ] Final **App Name** (≤ 30 chars) + **Subtitle** (≤ 30 chars)
- [ ] Monetization: free / paid / IAP later? (affects StoreKit + privacy labels)
- [ ] Login flow: required, optional, or removed for v1?

**Not required (despite original plan):**
- Specific count of native features
- IAP / StoreKit unless monetizing
- Account deletion API (only required if accounts exist server-side)

---

## 10. Testing Plan (Real Device Emphasis)

Simulator catches ~60% of issues. The rest only show on hardware.

**On real iPhone (minimum: one modern + one older device):**
- [ ] Cold start in airplane mode → app loads, all tabs render
- [ ] Force-quit → relaunch → data persists, scroll positions reasonable
- [ ] Barcode scan in dim light + glare + curved package
- [ ] Camera permission denied → graceful manual entry
- [ ] Notification permission denied → toggles disabled, no crash
- [ ] FaceID enabled → bypass works (passcode + "skip")
- [ ] Keyboard never obscures focused input on any screen
- [ ] Rotate device (if supported) — no layout break
- [ ] Fill localStorage near 5MB → quota guard prunes + toast
- [ ] Corrupt a key in storage → app recovers, no white screen
- [ ] Background app for 30 min → return → state intact
- [ ] Low Power Mode → no perf regression
- [ ] iOS Dark/Light mode (if supporting) — no contrast issues
- [ ] VoiceOver smoke test on primary flow

**Automated:**
- [ ] esbuild: `npm run build` produces `dist/` deterministically
- [ ] `npx cap sync ios` clean
- [ ] Xcode **Validate App** passes
- [ ] `PrivacyInfo.xcprivacy` lints

---

## 11. Timeline (Realistic, Not Optimistic)

| Phase | Effort | Notes |
|---|---|---|
| 1. Build system (esbuild) | 2–3 hrs | |
| 2. Capacitor + iOS shell | 2–3 hrs | First-time signing/provisioning eats time |
| 3. Native enhancements | 4–6 hrs | Native scanner integration is the long pole |
| 4. Storage abstraction + export/import | 3–4 hrs | Touches every persistence call site |
| 5. Error boundaries + offline UX | 2–3 hrs | |
| 6. Icons, privacy, metadata | 2–3 hrs | Designing 1024 icon often slips |
| Real-device testing + fixes | 4–6 hrs | Always finds 2–3 layout bugs |
| App Store Connect setup + submit | 1–2 hrs | |
| **Total implementation** | **20–30 hrs** | |
| Apple review wait | 1–3 days typical, up to 7 first-time | Out of our control |

> Original plan's 13 hrs is achievable only if everything goes perfectly on the first try. Plan for 20–30.

---

## 12. Definition of Done

A build is submission-ready when **all** of the following hold:

- [ ] `npm run build` → `dist/` deterministic, < 100 KB JS
- [ ] App boots offline on real iPhone in < 2s with no white screen
- [ ] All 6 tabs render with correct safe-area insets
- [ ] Native barcode scanner works in good + poor lighting
- [ ] Haptics + share sheet + (optional) notifications + (optional) biometrics function or no-op gracefully
- [ ] Storage: quota guard, corruption recovery, export/import all verified
- [ ] No dev-only UI reachable in production build
- [ ] Privacy policy live + linked in App Store Connect
- [ ] `PrivacyInfo.xcprivacy` matches App Privacy labels
- [ ] Xcode Validate App passes
- [ ] TestFlight build installed and exercised end-to-end on a physical device
- [ ] Reviewer Notes include demo creds (if login) or note that login is not required
- [ ] All "Open decisions" in §9 closed

---

## 13. Future Scope (Explicitly Excluded)

| Feature | Why deferred |
|---|---|
| Cloud sync (Firebase/Supabase) | Architecture-level change; v1 is local-first |
| SQLite migration | Premature until data volumes warrant |
| HealthKit / Apple Health integration | Adds review surface; defer to v1.1 |
| Apple Watch companion / Widgets | Build after baseline app ships |
| Android / Google Play | One platform at a time |
| In-App Purchases / subscriptions | Decide monetization first |
| Analytics / telemetry | Privacy-first v1 |
| Account deletion API | Only required if/when server-side accounts exist |
| Push notifications (remote) | Local notifications are sufficient for v1 |
| Localization beyond English | Post-launch based on demand |

---

### Bottom Line

> Ship a fast, stable, offline-capable app with a few well-integrated native touches and bulletproof local data. That passes review. Feature count does not.
