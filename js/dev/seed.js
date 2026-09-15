/* ─── PHYSIQ ENGINE — Dev-only Demo Seeder ────────────────────────────────
 *
 * Loads the deterministic fixtures in ./demoFixtures.js into localStorage
 * so workout history, profile switching and nutrition persistence can be
 * exercised by hand without touching a real account.
 *
 * Safety rules, all enforced below:
 *
 *   1. NEVER auto-seeds. registerDevSeed() only installs the handles; a
 *      human has to call window.__physiqSeed.seed() from the console.
 *   2. Only available in Dev Mode (`?dev=1`). In a production load the
 *      registration is a no-op and window.__physiqSeed is never defined.
 *   3. Only ever reads/writes keys under the two reserved demo e-mails.
 *      assertDemoKey() throws on anything else, so a bug here cannot
 *      reach a real profile's data.
 *   4. Refuses to overwrite: if a demo profile already exists, seed()
 *      reports "exists" and writes nothing. Call clear() first.
 *
 * There is deliberately no UI for this — Milestone 0 adds no demo screen.
 * ───────────────────────────────────────────────────────────────────────── */

import { uKey, get, set, remove } from "../utils/storage.js";
import { isDevMode } from "../utils/devMode.js";
import {
  DEMO_BUNDLES,
  DEMO_EMAIL_A,
  DEMO_EMAIL_B
} from "./demoFixtures.js";

const DEMO_EMAILS = [DEMO_EMAIL_A, DEMO_EMAIL_B];
const DEMO_PREFIXES = DEMO_EMAILS.map(function (e) { return "pq_" + e + "_"; });

/* Hard guard: the seeder may only ever touch demo-namespaced keys. */
function assertDemoKey(key) {
  const ok = DEMO_PREFIXES.some(function (p) { return key.indexOf(p) === 0; });
  if (!ok) throw new Error("devSeed refused to touch non-demo key: " + key);
  return key;
}

function profileExists(email) {
  return get(assertDemoKey(uKey(email, "profile")), null) != null;
}

/* Writes the fixtures for any demo profile that does not already exist.
   Returns a per-profile report; never throws on "already there". */
export function seedDemoData() {
  const report = { seeded: [], skipped: [], failed: [] };

  DEMO_BUNDLES.forEach(function (bundle) {
    if (profileExists(bundle.email)) {
      report.skipped.push(bundle.email);
      return;
    }
    const written = [];
    let ok = true;
    Object.keys(bundle.keys).forEach(function (suffix) {
      if (!ok) return;
      const key = assertDemoKey(uKey(bundle.email, suffix));
      if (set(key, bundle.keys[suffix])) written.push(key);
      else ok = false;
    });
    if (ok) {
      report.seeded.push(bundle.email);
    } else {
      // Partial write — roll back so we never leave half a demo profile.
      written.forEach(function (k) { remove(assertDemoKey(k)); });
      report.failed.push(bundle.email);
    }
  });

  return report;
}

/* Removes every demo key. Real profiles are untouchable by construction. */
export function clearDemoData() {
  const removed = [];
  let keys = [];
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && DEMO_PREFIXES.some(function (p) { return k.indexOf(p) === 0; })) keys.push(k);
    }
  } catch (e) {}
  keys.forEach(function (k) { remove(assertDemoKey(k)); removed.push(k); });
  return { removed: removed };
}

/* Read-only: which demo profiles are currently present. Mutates nothing. */
export function demoStatus() {
  return DEMO_EMAILS.map(function (email) {
    return { email: email, present: profileExists(email) };
  });
}

/* Installs the console handles. Called once from App.js; a no-op unless
   the page was opened with ?dev=1. */
export function registerDevSeed() {
  if (!isDevMode()) return false;
  if (typeof window === "undefined") return false;
  window.__physiqSeed = {
    seed: seedDemoData,
    clear: clearDemoData,
    status: demoStatus,
    emails: DEMO_EMAILS.slice()
  };
  return true;
}
