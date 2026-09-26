/* Milestone 7 — guard for the cross-language parity fixtures.

   research_backend/tests/fixtures/m6_parity/*.json were generated from the
   real Milestone 6 session and algorithms (research_backend/tools/m6_parity).
   The Python research pipeline is tested against them. If Milestone 6
   behaviour changes, this test fails until the fixtures are regenerated —
   so the research backend can never silently drift from M6 semantics.
   Numbers are compared within 1e-9 (V8 math may change in the last ulp
   between Node versions); everything else must match exactly.

   Regenerate:  node research_backend/tools/m6_parity/generate.mjs */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { scenarios, runScenario } from "../research_backend/tools/m6_parity/scenarios.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const dir = resolve(here, "../research_backend/tests/fixtures/m6_parity");

function same(a, b, path) {
  if (typeof a === "number" && typeof b === "number") {
    assert.ok(Math.abs(a - b) <= 1e-9, `${path}: ${a} vs ${b}`);
  } else if (Array.isArray(a) && Array.isArray(b)) {
    assert.equal(a.length, b.length, `${path}: length`);
    a.forEach((x, i) => same(x, b[i], `${path}[${i}]`));
  } else if (a && b && typeof a === "object" && typeof b === "object") {
    assert.deepEqual(Object.keys(a).sort(), Object.keys(b).sort(), `${path}: keys`);
    Object.keys(a).forEach((k) => same(a[k], b[k], `${path}.${k}`));
  } else {
    assert.equal(a, b, path);
  }
}

test("every M6 parity scenario has a committed fixture and vice versa", () => {
  const files = readdirSync(dir).filter((f) => f.endsWith(".json")).map((f) => f.replace(/\.json$/, "")).sort();
  assert.deepEqual(files, scenarios().map((s) => s.name).sort());
});

for (const scenario of scenarios()) {
  test(`M6 parity fixture is current: ${scenario.name}`, async () => {
    const committed = JSON.parse(readFileSync(resolve(dir, scenario.name + ".json"), "utf8"));
    const fresh = JSON.parse(JSON.stringify(await runScenario(scenario)));
    same(fresh, committed, scenario.name);
  });
}
