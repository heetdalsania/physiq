/* ─── PHYSIQ ENGINE — Dev seed bundle entry point ─────────────────────────
 *
 * Built to dist/dev-seed.js ONLY by `npm run build:dev` / `npm run dev`,
 * and referenced only by the HTML those builds emit. A production build
 * neither compiles this file nor writes the script tag, so the seeder and
 * its fixtures are absent from the shipped app — not merely disabled.
 *
 * This is the whole reason the seeder is a separate entry point rather than
 * a guarded import inside App.js: nothing about its exclusion depends on
 * dead-code elimination succeeding.
 *
 * Loading this file still does not seed anything. It only installs
 * window.__physiqSeed (and only when the page was opened with ?dev=1);
 * a human has to call .seed() from the console.
 * ───────────────────────────────────────────────────────────────────────── */

import { registerDevSeed } from "./seed.js";

if (registerDevSeed()) {
  console.log(
    "[physiq:dev] demo seeder ready — " +
    "__physiqSeed.status() / .seed() / .clear()"
  );
}
