# PhysiQ Engine — Production Readiness Plan

Currently, the PhysiQ Engine is a robust **Local-First Prototype**. All application logic operates beautifully on the client side, and data is stored locally on the device using browser `localStorage`. 

To launch a polished, secure, and scalable application to the App Store, the project must transition to a production-ready architecture. Below is the roadmap to achieve this.

---

## 1. Authentication & User Accounts
Right now, the login screen acts as a gateway but doesn't authenticate against a server. 

**The Plan:**
- **Backend as a Service (BaaS)**: Integrate **Supabase** (or Firebase). Supabase provides a seamless PostgreSQL database with built-in Authentication that works perfectly with React and Capacitor.
- **Apple Sign-In**: This is a strict **Apple App Store Requirement** for any iOS app that offers third-party logins (like Google/Facebook). We will use the `@capacitor-community/apple-sign-in` plugin.
- **Magic Links / Email**: Allow users to authenticate via secure email links, removing the need to manage passwords.

## 2. Cloud Storage & Data Synchronization
Currently, if a user deletes the app or gets a new phone, their nutrition and weight history is permanently lost.

**The Plan:**
- **Robust Local Database**: Migrate from `localStorage` to **IndexedDB** (or the Capacitor SQLite plugin). iOS Safari can unexpectedly clear `localStorage` if device storage runs low. IndexedDB is much more persistent.
- **Cloud Sync**: Whenever the user logs a meal or weight, the app will save it locally first (for instantaneous UI feedback and offline support), and then quietly sync it to the Supabase PostgreSQL database in the background.
- **Cross-Device Support**: When a user logs in on a new device, the app will instantly pull their profile, targets, and history from the cloud.

## 3. Build Tooling & Performance
The app currently uses `babel-standalone` to compile React JSX directly in the phone's browser at runtime. While fantastic for rapid prototyping, this introduces a heavy performance penalty on launch.

**The Plan:**
- **Migrate to Vite**: We will introduce **Vite**, an ultra-fast modern build tool. 
- **Pre-compilation**: Vite will compile all React code into highly optimized, minified JavaScript *before* the app is bundled for iOS. This will reduce app launch times from ~1 second down to milliseconds.
- **Offline Reliability**: We will bundle React and ReactDOM directly into the app rather than fetching them from a CDN, ensuring the app works perfectly in airplane mode or low connectivity.

## 4. App Store Compliance & Launch
Apple has strict guidelines for apps entering the App Store.

**The Plan:**
- **Legal Documents**: Host a standard Privacy Policy and Terms of Service (required for the App Store).
- **App Tracking Transparency (ATT)**: If we integrate any analytics tools that track users across other apps, we must implement the native iOS ATT prompt.
- **Crash Reporting**: Integrate **Sentry** or **Firebase Crashlytics** to monitor for any JavaScript or native crashes happening on users' devices in the wild.
- **App Icon & Splash Screen**: Finalize all resolutions for the app icon and ensuring the Capacitor Splash Screen seamlessly hands off to the React app without any white flashes.

---

## Next Immediate Steps
If you're ready to proceed, the next development sprint will focus exclusively on **Phase 3**: Migrating the codebase to a Vite build system to instantly unlock massive performance gains and lay the groundwork for importing the Supabase Auth SDK.
