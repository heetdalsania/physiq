# PhysiQ Engine → App Store: Step-by-Step Checklist

> Each step is a self-contained unit designed to be executed in a single Claude Code session.
> Say **"Run Step N"** to execute that step. Each step ends with a `git add . && git commit && git push`.
>
> 💰 = Step involves potential financial cost.

---

## Step 1 — Initialize Build System (esbuild)

- [ ] **Status: Not Started**

### 💰 Cost: None

### Context for the AI

The app currently loads React 18, ReactDOM, and Babel from CDN `<script>` tags in `index.html`. All JSX files use `type="text/babel"` and are transpiled at runtime. There is no `package.json` with dependencies yet (only an empty lockfile). The `html5-qrcode` library is also loaded from a CDN.

### What to Do

1. Create a proper `package.json` with `react`, `react-dom`, and `esbuild` as dependencies.
2. Create `build.mjs` — an esbuild build script that:
   - Bundles all JS/JSX from `js/` into a single `dist/app.min.js` (ESM, minified).
   - Uses `jsx: 'automatic'` runtime (no Babel needed).
   - Copies `css/styles.css` → `dist/styles.min.css`.
   - Generates `dist/index.html` (no CDN scripts, no `text/babel`, just the bundled output).
   - Has `--watch` mode for dev.
3. Convert all files from the `window.PhysIQ.*` global pattern to ES module `import`/`export`:
   - `js/data/constants.js` and `js/data/fastFoodMenu.js` — export their data objects.
   - `js/utils/*.js` — export named functions instead of attaching to `window.PhysIQ.Utils`.
   - `js/components/*.js` — convert to React components with `import React` and default/named exports.
   - `js/screens/*.js` — same as components.
   - `js/App.js` — becomes the entry point, imports everything, calls `ReactDOM.createRoot`.
4. Run `npm run build` and verify `dist/` loads identically in the browser.
5. Add `npm run dev` script for watch mode.
6. Verify: zero `text/babel` script tags, zero CDN dependencies, `dist/` works standalone.

### Files Involved

- **CREATE**: `package.json`, `build.mjs`
- **CREATE**: `dist/index.html`, `dist/app.min.js`, `dist/styles.min.css` (generated)
- **MODIFY**: Every file in `js/` (convert globals → ES modules)
- **KEEP**: Original `index.html` (don't delete yet, keep as reference)

### Done When

- `npm run build` produces `dist/` with < 100 KB JS.
- Opening `dist/index.html` in browser shows the full working app.
- No runtime Babel, no CDN scripts.

### Git Commit

```bash
git add . && git commit -m "Step 1: esbuild build system, convert to ES modules" && git push
```

---

## Step 2 — Capacitor iOS Project Setup

- [ ] **Status: Not Started**

### 💰 Cost: None (Xcode is free)

### Context for the AI

After Step 1, the app builds to `dist/`. We now wrap it in Capacitor 7 to create a native iOS project. The user has Xcode installed on their Mac.

### What to Do

1. Install Capacitor core + CLI + iOS platform:
   ```
   npm install @capacitor/core @capacitor/cli @capacitor/ios
   ```
2. Run `npx cap init` with app name "PhysiQ Engine", bundle ID `com.physiq.engine`, webDir `dist`.
3. Create `capacitor.config.ts` with:
   - `webDir: 'dist'`
   - `server.allowNavigation: ['world.openfoodfacts.org']`
   - iOS config: `contentInset: 'always'`, `allowsLinkPreview: false`
4. Run `npx cap add ios`.
5. Update `dist/index.html`:
   - Add `<meta name="viewport" content="..., viewport-fit=cover">`.
   - Add safe-area CSS: `padding: env(safe-area-inset-top) env(safe-area-inset-right) env(safe-area-inset-bottom) env(safe-area-inset-left)` on the app shell.
6. Add CSS rules to:
   - Disable rubber-band overscroll (`overscroll-behavior: none`).
   - Disable long-press text selection on buttons/nav (`-webkit-touch-callout: none; user-select: none`).
   - Apply safe-area insets to bottom nav and top header.
7. Run `npm run build && npx cap sync ios`.
8. Verify the iOS project exists at `ios/App/`.

### Files Involved

- **CREATE**: `capacitor.config.ts`
- **MODIFY**: `package.json` (new deps), `build.mjs` (ensure viewport-fit meta), CSS
- **GENERATED**: `ios/` directory (by Capacitor)

### Done When

- `ios/App/` directory exists with a valid Xcode project.
- `npx cap sync ios` completes without errors.
- CSS has safe-area and overscroll handling.

### Git Commit

```bash
git add . && git commit -m "Step 2: Capacitor iOS project setup with safe-area CSS" && git push
```

---

## Step 3 — Core Capacitor Plugins (Haptics, StatusBar, Keyboard, SplashScreen)

- [ ] **Status: Not Started**

### 💰 Cost: None

### Context for the AI

The iOS shell exists from Step 2. Now we add required Capacitor plugins that make the app feel native rather than a website wrapper.

### What to Do

1. Install plugins:
   ```
   npm install @capacitor/haptics @capacitor/status-bar @capacitor/keyboard @capacitor/splash-screen @capacitor/share
   ```
2. Create `js/utils/native.js` — a platform-aware utility module:
   - `triggerHaptic(style)` — calls Haptics on iOS, no-ops on web.
   - `configureStatusBar()` — sets dark style, overlay mode.
   - `configureKeyboard()`  — sets resize mode to `'body'`, disables accessory bar scroll.
   - `shareText(title, text)` — calls Share plugin.
   - `isNative()` — returns true if running in Capacitor.
3. Wire haptics into key interactions across the app:
   - Tab switches, food logging confirmation, exercise completion, weight log.
4. Configure splash screen in `capacitor.config.ts`:
   - `launchShowDuration: 0` (we control dismissal), `autoHide: false`.
   - Dismiss splash in App.js after first render.
5. Configure keyboard plugin to prevent input fields from being obscured.
6. Add share functionality to Profile tab ("Share Progress" button).
7. Run `npm run build && npx cap sync ios`.

### Files Involved

- **CREATE**: `js/utils/native.js`
- **MODIFY**: `js/App.js` (splash dismiss, status bar config on mount)
- **MODIFY**: `js/screens/ProfileTab.js` (share button)
- **MODIFY**: Various screens (haptics on key interactions)
- **MODIFY**: `capacitor.config.ts` (plugin configs)

### Done When

- All plugins installed and synced.
- `native.js` utility module exports all helper functions.
- Haptic calls exist in tab switches and key log actions.
- Share button in Profile.

### Git Commit

```bash
git add . && git commit -m "Step 3: Capacitor plugins — haptics, status bar, keyboard, splash, share" && git push
```

---

## Step 4 — Native Barcode Scanner

- [ ] **Status: Not Started**

### 💰 Cost: None

### Context for the AI

The app currently uses `html5-qrcode` loaded from CDN for barcode scanning in `EatsTab.js`. This is unreliable in WKWebView. We replace it with a native MLKit-based scanner.

### What to Do

1. Install: `npm install @capacitor-mlkit/barcode-scanning`
2. Remove the `html5-qrcode` CDN script and all references to it.
3. Update `EatsTab.js` barcode scanning flow:
   - On scan button press: check `isNative()`.
   - If native: request camera permission via the plugin, then call `BarcodeScanner.scan()`.
   - If web: show a manual barcode entry input field (text input for UPC code).
   - On successful scan: call existing `Utils.lookupBarcode(code)` → open PortionModal.
   - On permission denied: show graceful fallback to manual entry (never a dead end).
4. Add `NSCameraUsageDescription` to `ios/App/App/Info.plist`:
   - Value: `"Used to scan food barcodes for nutrition lookup."`
5. Run `npm run build && npx cap sync ios`.

### Files Involved

- **MODIFY**: `js/screens/EatsTab.js` (replace html5-qrcode with native scanner)
- **MODIFY**: `ios/App/App/Info.plist` (camera usage description)
- **MODIFY**: `build.mjs` (remove html5-qrcode if referenced)
- **REMOVE**: Any html5-qrcode imports/references

### Done When

- Zero references to `html5-qrcode` in the codebase.
- Native scan flow works on iOS; web shows manual entry fallback.
- Camera permission denial shows manual entry, not a dead end.

### Git Commit

```bash
git add . && git commit -m "Step 4: Native barcode scanner via MLKit, remove html5-qrcode" && git push
```

---

## Step 5 — Harden Storage Layer

- [ ] **Status: Not Started**

### 💰 Cost: None

### Context for the AI

Current `js/utils/storage.js` is a thin wrapper around raw `localStorage` with basic try/catch. Per the V2 plan, it needs hardening: quota guards, corruption recovery, schema versioning, and export/import.

### What to Do

1. Rewrite `js/utils/storage.js` to expose:
   - `get(key, defaultValue)` — safe JSON.parse; on corruption, reset key to default, emit a toast event.
   - `set(key, value)` — catches `QuotaExceededError` → auto-prune oldest history entries → retry once → emit toast if still failing.
   - `remove(key)`
   - `getUsageBytes()` — estimate total localStorage usage.
   - `exportAll()` — returns full JSON blob of all `pq_*` keys with a `schemaVersion` and timestamp.
   - `importAll(json)` — validates schema version, merges/replaces data, emits toast on success.
2. Add `schemaVersion: 1` field to every persisted blob.
3. Add a migration runner on app boot: reads `schemaVersion`, applies any needed transforms.
4. Keep backward compatibility: existing `loadUser`, `loadDaily`, `loadHistory`, `saveHistory`, `sv` functions must still work (refactor internals to use the new `get`/`set`).
5. Create a toast notification system (simple, non-blocking) for storage warnings.
6. Update Profile tab: add **Export Data** and **Import Data** buttons that call `exportAll()` / `importAll()`.
7. Verify all screens still work with the new storage layer.

### Files Involved

- **MODIFY**: `js/utils/storage.js` (major rewrite)
- **CREATE**: `js/utils/toast.js` (simple toast notification utility)
- **MODIFY**: `js/screens/ProfileTab.js` (export/import buttons)
- **MODIFY**: `js/App.js` (migration runner on boot, toast container)

### Done When

- `QuotaExceededError` is caught and handled gracefully.
- Corrupted JSON in any key doesn't white-screen the app.
- Export produces a valid JSON file; Import restores from it.
- Profile tab has working Export/Import Data buttons.

### Git Commit

```bash
git add . && git commit -m "Step 5: Hardened storage — quota guard, corruption recovery, export/import" && git push
```

---

## Step 6 — Network Layer Hardening

- [ ] **Status: Not Started**

### 💰 Cost: None

### Context for the AI

`js/utils/foodSearch.js` calls Open Food Facts API with basic retry logic but no debounce, no AbortController timeout, no LRU cache, and no offline detection.

### What to Do

1. Add 300ms debounce wrapper around `searchOpenFoodFacts` calls in `EatsTab.js`.
2. Add `AbortController` with 10s timeout to all fetch calls in `foodSearch.js`.
3. Create an in-memory LRU cache (last 50 queries) in `foodSearch.js`:
   - Also persist to localStorage via the hardened storage layer.
   - On cache hit, return immediately without network call.
4. Add `navigator.onLine` check before network calls:
   - If offline: show "Search needs internet — manual entry still works" message.
5. Apply same patterns to `lookupBarcode` and `nearbyRestaurants.js`.
6. Create `js/utils/network.js` utility with shared `fetchWithTimeout(url, timeoutMs)`.

### Files Involved

- **CREATE**: `js/utils/network.js`
- **MODIFY**: `js/utils/foodSearch.js` (debounce, abort, cache, offline)
- **MODIFY**: `js/utils/nearbyRestaurants.js` (timeout, offline)
- **MODIFY**: `js/screens/EatsTab.js` (debounce integration, offline UI)

### Done When

- Rapid typing doesn't fire multiple API calls.
- Slow API responses time out after 10s with user-facing message.
- Repeated searches hit cache.
- Airplane mode shows offline message, not an error.

### Git Commit

```bash
git add . && git commit -m "Step 6: Network hardening — debounce, timeout, LRU cache, offline detection" && git push
```

---

## Step 7 — Error Boundaries & Stability

- [ ] **Status: Not Started**

### 💰 Cost: None

### Context for the AI

The app has no React error boundaries. A single component crash white-screens everything. Per V2 plan, we need root + per-tab error boundaries, global error handlers, and dev-UI gating.

### What to Do

1. Create `js/components/ErrorBoundary.js`:
   - React class component with `componentDidCatch`.
   - Branded fallback UI with **Reload App** and **Export Data** buttons.
   - A crash never traps user data.
2. Wrap the root `<App>` in an `<ErrorBoundary>`.
3. Wrap each tab's content in its own `<ErrorBoundary>` (so one tab crashing doesn't kill others).
4. Add global handlers in App.js:
   - `window.onerror` → show toast + log.
   - `window.addEventListener('unhandledrejection')` → show toast + log.
5. Gate all dev-only UI behind a `?dev=1` URL parameter check.
   - Create `js/utils/devMode.js` with `isDevMode()` function.
   - Any debug panels, dev time controls, etc. only render when `isDevMode()` is true.
6. Ensure production build (`npm run build`) strips console.log calls or guards them.

### Files Involved

- **CREATE**: `js/components/ErrorBoundary.js`
- **CREATE**: `js/utils/devMode.js`
- **MODIFY**: `js/App.js` (wrap in ErrorBoundary, add global handlers)
- **MODIFY**: All screen files (wrap content in per-tab ErrorBoundary)

### Done When

- Throwing an error in one tab shows fallback UI for that tab only; other tabs work.
- Root error boundary catches catastrophic failures with Export Data option.
- Dev-only UI is hidden in production builds.

### Git Commit

```bash
git add . && git commit -m "Step 7: Error boundaries, global error handlers, dev-mode gating" && git push
```

---

## Step 8 — iOS UX Polish

- [ ] **Status: Not Started**

### 💰 Cost: None

### Context for the AI

The app must not feel like a website in a wrapper. This step addresses all the UX requirements from V2 §8: touch targets, pull-to-refresh, layout shift, tap delay, scroll behavior.

### What to Do

1. Audit all buttons and interactive elements — ensure minimum 44pt touch targets.
   - Add CSS: `.pq-btn, button, [role="button"] { min-height: 44px; min-width: 44px; }`.
2. Disable pull-to-refresh where it does nothing:
   - CSS: `body { overscroll-behavior-y: contain; }`.
3. Preserve scroll position on tab switches:
   - Store scroll position per tab in a ref; restore on tab return.
4. Eliminate layout shift during launch:
   - Set explicit dimensions on the app shell.
   - Splash screen hides only after first meaningful paint.
5. Disable 300ms tap delay (verify with `touch-action: manipulation` on interactive elements).
6. Disable text selection on nav/buttons but allow it on content areas.
7. Style the app for notch/Dynamic Island/home indicator using `env(safe-area-inset-*)`.
8. Test that keyboard doesn't cover inputs — add `scrollIntoView` on input focus if needed.
9. Run `npm run build && npx cap sync ios`.

### Files Involved

- **MODIFY**: `css/styles.css` (touch targets, overscroll, safe-area, selection)
- **MODIFY**: `js/App.js` (scroll position preservation)
- **MODIFY**: Various screens (scrollIntoView on focus for inputs)

### Done When

- All buttons are ≥ 44pt.
- No rubber-band bounce on non-scrollable areas.
- Tab switches preserve scroll position.
- No visible layout shift on cold start.

### Git Commit

```bash
git add . && git commit -m "Step 8: iOS UX polish — touch targets, scroll preservation, safe areas" && git push
```

---

## Step 9 — App Icon & Splash Screen Assets

- [ ] **Status: Not Started**

### 💰 Cost: None

### Context for the AI

Apple requires a full set of app icons (including 1024×1024) and a launch storyboard. The app needs a polished icon and splash screen.

### What to Do

1. Generate a PhysiQ Engine app icon:
   - Dark theme, modern fitness/health aesthetic.
   - Create all required sizes: 20, 29, 40, 58, 60, 76, 80, 87, 120, 152, 167, 180, 1024.
   - Place in `ios/App/App/Assets.xcassets/AppIcon.appiconset/`.
   - Update `Contents.json` with all size entries.
2. Configure launch storyboard:
   - Simple branded splash: dark background + PhysiQ logo centered.
   - Update `ios/App/App/Assets.xcassets/Splash.imageset/` if needed.
3. Ensure `capacitor.config.ts` splash settings are correct.
4. Run `npx cap sync ios`.

### Files Involved

- **MODIFY**: `ios/App/App/Assets.xcassets/AppIcon.appiconset/Contents.json`
- **CREATE**: Icon image files in the appiconset directory
- **MODIFY**: `ios/App/App/Assets.xcassets/Splash.imageset/` (if customizing)
- **MODIFY**: `capacitor.config.ts` (splash config)

### Done When

- All icon sizes present and referenced in Contents.json.
- Splash screen shows branded dark screen (no white flash).

### Git Commit

```bash
git add . && git commit -m "Step 9: App icon set and splash screen assets" && git push
```

---

## Step 10 — Privacy Policy & Privacy Manifest

- [ ] **Status: Not Started**

### 💰 Cost: None

### Context for the AI

Apple requires a public privacy policy URL and a `PrivacyInfo.xcprivacy` manifest declaring all data collection and API usage. The app uses: localStorage (NSUserDefaults equivalent), Camera (barcode), and network APIs (Open Food Facts, USDA).

### What to Do

1. Create `docs/privacy-policy.html` — a simple, clear privacy policy page:
   - State: no accounts, no cloud sync, all data stored locally on device.
   - Camera used only for barcode scanning, images never stored or transmitted.
   - Network calls to Open Food Facts for food search (no user data sent).
   - No analytics, no tracking, no third-party SDKs.
2. Create `PrivacyInfo.xcprivacy` in `ios/App/App/`:
   - Declare `NSPrivacyAccessedAPICategoryUserDefaults` (localStorage).
   - Declare camera usage reason.
   - No tracking domains.
3. Ensure `Info.plist` has:
   - `NSCameraUsageDescription` (should exist from Step 4).
   - Any other required usage descriptions.
4. Run `npx cap sync ios`.

### Files Involved

- **CREATE**: `docs/privacy-policy.html`
- **CREATE**: `ios/App/App/PrivacyInfo.xcprivacy`
- **MODIFY**: `ios/App/App/Info.plist` (verify usage descriptions)

### Done When

- Privacy policy is a complete, readable HTML page ready to host.
- `PrivacyInfo.xcprivacy` is valid and declares all APIs used.
- All `Info.plist` usage descriptions have clear, user-facing copy.

### Git Commit

```bash
git add . && git commit -m "Step 10: Privacy policy and PrivacyInfo.xcprivacy manifest" && git push
```

---

## Step 11 — Real-Device Testing & Bug Fixes

- [ ] **Status: Not Started**

### 💰 Cost: None

### Context for the AI

This step runs through the full testing checklist from V2 §10. It requires building and running the app on the iOS Simulator (and ideally a real device via Xcode).

### What to Do

1. Run `npm run build && npx cap sync ios && npx cap open ios`.
2. Build and run in iOS Simulator. Test the following and fix any issues:
   - [ ] Cold start with airplane mode → app loads, all tabs render.
   - [ ] All 6 tabs render with correct safe-area insets.
   - [ ] Tab switches feel instant, scroll position preserved.
   - [ ] Food search works (when online) and shows offline message (when offline).
   - [ ] Barcode scanner: native on iOS, manual entry fallback on web/permission denied.
   - [ ] Keyboard never obscures focused input on any screen.
   - [ ] No layout shift during launch.
   - [ ] No rubber-band overscroll on non-scrollable areas.
   - [ ] Export Data produces valid JSON; Import Data restores it.
   - [ ] Error boundary: simulate a component crash → fallback UI shown, other tabs work.
   - [ ] All buttons are ≥ 44pt touch targets.
   - [ ] No dev-only UI visible in production build.
3. Fix all issues found during testing.
4. Re-run full test pass after fixes.

### Files Involved

- **MODIFY**: Any files with bugs found during testing.

### Done When

- All checklist items pass.
- App boots in Simulator cleanly with no console errors.
- Full user flow works: onboard → log food → log exercise → view calendar → export data.

### Git Commit

```bash
git add . && git commit -m "Step 11: Testing pass — bug fixes from Simulator/device testing" && git push
```

---

## Step 12 — App Store Connect Setup & Submission 💰

- [ ] **Status: Not Started**

### 💰 Cost: $99/year Apple Developer Program enrollment

### Context for the AI

This is the final step. The user must have an Apple Developer account ($99/year). This step prepares all App Store Connect metadata and builds the final archive.

### What to Do

1. **Pre-requisites (user must do manually):**
   - [ ] Enroll in Apple Developer Program ($99/yr) at developer.apple.com.
   - [ ] Decide final **Bundle ID** (e.g., `com.physiq.engine`).
   - [ ] Decide **App Name** (≤ 30 chars) and **Subtitle** (≤ 30 chars).
   - [ ] Decide monetization: free, paid, or IAP later.
2. **In Xcode:**
   - Set the correct Team and Bundle ID in Signing & Capabilities.
   - Set deployment target to iOS 16.0.
   - Ensure all capabilities are correct (Camera).
3. **Prepare App Store metadata:**
   - App description (4000 chars max).
   - Keywords (100 chars max).
   - Category: Health & Fitness.
   - Age rating: 4+ (no objectionable content).
   - Support URL (can be GitHub repo).
   - Privacy policy URL (host the `docs/privacy-policy.html` on GitHub Pages).
   - Reviewer notes: "No login required. App is fully functional offline. All data is stored locally."
4. **Take screenshots** for required device sizes:
   - 6.7" (iPhone 15 Pro Max): ≥ 3 screenshots.
   - 6.1" (iPhone 15 Pro): ≥ 3 screenshots.
   - Create screenshot set showing: Dashboard, Eats tab, Exercise tab.
5. **Archive and upload:**
   - In Xcode: Product → Archive.
   - Validate the archive (Xcode → Validate App).
   - Upload to App Store Connect.
6. **In App Store Connect:**
   - Create the app listing.
   - Fill in all metadata.
   - Upload screenshots.
   - Set pricing (Free).
   - Link privacy policy URL.
   - Set App Privacy labels to match `PrivacyInfo.xcprivacy`.
   - Submit for review.

### Files Involved

- **MODIFY**: Xcode project settings (signing, bundle ID, deployment target)
- **HOST**: `docs/privacy-policy.html` on GitHub Pages

### Done When

- Archive validates successfully in Xcode.
- Build uploaded to App Store Connect.
- All metadata filled in.
- App submitted for Apple review.

### Git Commit

```bash
git add . && git commit -m "Step 12: App Store submission — metadata, screenshots, archive" && git push
```

---

## Summary Table

| Step | Description | 💰 Cost | Depends On |
|------|-------------|---------|------------|
| 1 | esbuild + ES modules | None | — |
| 2 | Capacitor iOS setup | None | Step 1 |
| 3 | Core plugins (haptics, status bar, keyboard, splash, share) | None | Step 2 |
| 4 | Native barcode scanner | None | Step 2 |
| 5 | Hardened storage layer | None | Step 1 |
| 6 | Network hardening | None | Step 5 |
| 7 | Error boundaries & stability | None | Step 1 |
| 8 | iOS UX polish | None | Steps 2–7 |
| 9 | App icon & splash assets | None | Step 2 |
| 10 | Privacy policy & manifest | None | Step 4 |
| 11 | Testing & bug fixes | None | Steps 1–10 |
| 12 | App Store submission | **$99/yr** | Steps 1–11 |

### Parallel-Safe Steps

Steps 3, 4, 5 can be done in any order after Step 2 is complete.
Steps 6 and 7 can be done in any order after Step 5 and Step 1 respectively.
Step 8 should come after all feature steps (3–7) are done.
Steps 9 and 10 can be done anytime after Step 2.
Step 11 must be after all other steps.
Step 12 is always last.
