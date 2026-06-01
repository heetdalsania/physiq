# PhysiQ Engine — Production Readiness Plan

Currently, the PhysiQ Engine is a robust **Local-First Prototype**. All application logic operates beautifully on the client side, and data is stored locally on the device using browser `localStorage`. 

To launch a polished, secure, and scalable application to the App Store, the project must transition to a production-ready architecture. Below is the roadmap to achieve this.

---

## 1. Authentication & User Accounts
Right now, the login screen acts as a gateway but doesn't authenticate against a server. 

**The Plan:**
- **Backend as a Service (BaaS)**: Integrate **[Supabase](https://supabase.com/)** (or [Firebase](https://firebase.google.com/)). Supabase provides a seamless PostgreSQL database with built-in Authentication that works perfectly with React and Capacitor.
  - Docs: [Supabase Auth Guide](https://supabase.com/docs/guides/auth) · [Supabase JavaScript SDK](https://supabase.com/docs/reference/javascript/introduction)
- **Apple Sign-In**: This is a strict **Apple App Store Requirement** for any iOS app that offers third-party logins (like Google/Facebook). We will use the [`@capgo/capacitor-social-login`](https://www.npmjs.com/package/@capgo/capacitor-social-login) plugin (modern replacement for the legacy `@capacitor-community/apple-sign-in`).
  - Docs: [Apple Sign-In — Developer Guide](https://developer.apple.com/sign-in-with-apple/) · [Capgo Social Login GitHub](https://github.com/Cap-go/capacitor-social-login)
- **Magic Links / Email**: Allow users to authenticate via secure email links, removing the need to manage passwords.
  - Docs: [Supabase Magic Link Auth](https://supabase.com/docs/guides/auth/auth-magic-link)

### 💰 Section 1 — Cost Breakdown

| Item | Free Tier | Production Tier | Notes |
|---|---|---|---|
| **Supabase** (BaaS + Auth) | **$0/mo** — 50K MAUs, 500 MB DB, 2 projects | **$25/mo** (Pro) — 100K MAUs, 8 GB DB, daily backups | Free tier pauses after 1 week of inactivity |
| **Apple Sign-In Plugin** | **$0** (open source) | **$0** | MIT-licensed Capacitor plugin |
| **Magic Link Emails** | Included in Supabase Auth | Included in Supabase Auth | Uses Supabase's built-in email provider |
| **Section Total** | **$0/mo** | **$25/mo** | |

---

## 2. Cloud Storage & Data Synchronization
Currently, if a user deletes the app or gets a new phone, their nutrition and weight history is permanently lost.

**The Plan:**
- **Robust Local Database**: Migrate from `localStorage` to **[IndexedDB](https://developer.mozilla.org/en-US/docs/Web/API/IndexedDB_API)** (or the [Capacitor SQLite plugin](https://github.com/capacitor-community/sqlite)). iOS Safari can unexpectedly clear `localStorage` if device storage runs low. IndexedDB is much more persistent.
  - Docs: [MDN — Using IndexedDB](https://developer.mozilla.org/en-US/docs/Web/API/IndexedDB_API/Using_IndexedDB) · [`@capacitor-community/sqlite` GitHub](https://github.com/capacitor-community/sqlite)
- **Cloud Sync**: Whenever the user logs a meal or weight, the app will save it locally first (for instantaneous UI feedback and offline support), and then quietly sync it to the [Supabase PostgreSQL database](https://supabase.com/docs/guides/database/overview) in the background.
  - Docs: [Supabase Database Guide](https://supabase.com/docs/guides/database/overview) · [Supabase Realtime](https://supabase.com/docs/guides/realtime)
- **Cross-Device Support**: When a user logs in on a new device, the app will instantly pull their profile, targets, and history from the cloud.

### 💰 Section 2 — Cost Breakdown

| Item | Free Tier | Production Tier | Notes |
|---|---|---|---|
| **IndexedDB** | **$0** (browser-native API) | **$0** | Built into all modern browsers, no dependency |
| **Capacitor SQLite Plugin** | **$0** (open source) | **$0** | Alternative to IndexedDB; MIT-licensed |
| **Supabase Database** (cloud sync) | Included in Section 1 | Included in Section 1 | Same Supabase project; 8 GB on Pro |
| **Supabase Storage** (if needed for files) | **$0** — 1 GB | Included in Pro — 100 GB | Only needed if storing user-uploaded images |
| **Section Total** | **$0/mo** | **$0/mo** (covered by Section 1) | |

---

## 3. Build Tooling & Performance
The app currently uses `babel-standalone` to compile React JSX directly in the phone's browser at runtime. While fantastic for rapid prototyping, this introduces a heavy performance penalty on launch.

**The Plan:**
- **Migrate to [Vite](https://vite.dev/)**: We will introduce **Vite**, an ultra-fast modern build tool. 
  - Docs: [Vite Getting Started](https://vite.dev/guide/) · [Vite React Plugin](https://github.com/vitejs/vite-plugin-react)
- **Pre-compilation**: Vite will compile all React code into highly optimized, minified JavaScript *before* the app is bundled for iOS. This will reduce app launch times from ~1 second down to milliseconds.
- **Offline Reliability**: We will bundle React and ReactDOM directly into the app rather than fetching them from a CDN, ensuring the app works perfectly in airplane mode or low connectivity.

### 💰 Section 3 — Cost Breakdown

| Item | Free Tier | Production Tier | Notes |
|---|---|---|---|
| **Vite** | **$0** (open source, MIT) | **$0** | Core Vite is free forever; "Vite+" is a separate commercial product |
| **React / ReactDOM** | **$0** (open source, MIT) | **$0** | Bundled into the app at build time |
| **Section Total** | **$0/mo** | **$0/mo** | |

---

## 4. App Store Compliance & Launch
Apple has strict guidelines for apps entering the App Store.

**The Plan:**
- **Legal Documents**: Host a standard Privacy Policy and Terms of Service (required for the App Store).
  - Reference: [Apple App Store Review Guidelines](https://developer.apple.com/app-store/review/guidelines/) · [App Privacy Details](https://developer.apple.com/app-store/app-privacy-details/)
- **App Tracking Transparency (ATT)**: If we integrate any analytics tools that track users across other apps, we must implement the native iOS ATT prompt.
  - Docs: [AppTrackingTransparency Framework](https://developer.apple.com/documentation/apptrackingtransparency) · [User Privacy and Data Use](https://developer.apple.com/app-store/user-privacy-and-data-use/)
- **Crash Reporting**: Integrate **[Sentry](https://sentry.io/)** or **[Firebase Crashlytics](https://firebase.google.com/products/crashlytics)** to monitor for any JavaScript or native crashes happening on users' devices in the wild.
  - Docs: [Sentry for Capacitor/React](https://docs.sentry.io/platforms/javascript/guides/react/) · [Firebase Crashlytics Docs](https://firebase.google.com/docs/crashlytics)
- **App Icon & Splash Screen**: Finalize all resolutions for the app icon and ensuring the [Capacitor Splash Screen](https://capacitorjs.com/docs/apis/splash-screen) seamlessly hands off to the React app without any white flashes.
  - Docs: [`@capacitor/splash-screen` API](https://capacitorjs.com/docs/apis/splash-screen) · [`@capacitor/assets` (icon/splash generator)](https://github.com/ionic-team/capacitor-assets)

### 💰 Section 4 — Cost Breakdown

| Item | Free Tier | Production Tier | Notes |
|---|---|---|---|
| **Apple Developer Program** | — | **$99/year** ($8.25/mo) | **Required** to publish on the App Store |
| **Privacy Policy / ToS Hosting** | **$0** | **$0** | Can be hosted as static pages on GitHub Pages or the app's marketing site |
| **Sentry** (crash reporting) | **$0** — 5K errors/mo, 1 user | **$26/mo** (Team) — higher limits, unlimited users | Free tier is sufficient for initial launch |
| **Firebase Crashlytics** (alternative) | **$0** (always free) | **$0** (always free) | Completely free regardless of scale; recommended if keeping costs low |
| **Capacitor Splash Screen** | **$0** (open source) | **$0** | Included with `@capacitor/splash-screen` |
| **Section Total** | **$99/year** | **$99/year** + $0–26/mo | Apple fee is unavoidable; Crashlytics recommended over Sentry for cost |

---

## 📊 Total Cost Summary

| Scenario | Monthly Cost | Annual Cost | What You Get |
|---|---|---|---|
| **🟢 Minimum Viable Launch** (all free tiers) | **$8.25/mo** | **$99/year** | Supabase Free, Firebase Crashlytics (free), Vite (free), Apple Developer ($99/yr) |
| **🟡 Recommended Production** (Supabase Pro + free crash reporting) | **$33.25/mo** | **$399/year** | Supabase Pro ($25/mo), Firebase Crashlytics (free), Vite (free), Apple Developer ($99/yr) |
| **🔴 Full Production** (Supabase Pro + Sentry Team) | **$59.25/mo** | **$711/year** | Supabase Pro ($25/mo), Sentry Team ($26/mo), Vite (free), Apple Developer ($99/yr) |

> **💡 Recommendation**: Start with the **Minimum Viable Launch** tier during development and beta testing. Upgrade to the **Recommended Production** tier ($33.25/mo) before going live on the App Store — the Supabase Pro plan removes the inactivity pause and adds daily backups, which are critical for a live app.

---

## Next Immediate Steps
If you're ready to proceed, the next development sprint will focus exclusively on **Phase 3**: Migrating the codebase to a Vite build system to instantly unlock massive performance gains and lay the groundwork for importing the Supabase Auth SDK.
