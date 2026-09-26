/* Writes research_backend/tests/fixtures/m6_parity/<scenario>.json from the
   real Milestone 6 JavaScript (see scenarios.mjs).
   Run from the repository root:  node research_backend/tools/m6_parity/generate.mjs */
import { writeFile, mkdir } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { buildAll } from "./scenarios.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const outDir = resolve(here, "../../tests/fixtures/m6_parity");
await mkdir(outDir, { recursive: true });
const fixtures = await buildAll();
for (const f of fixtures) {
  await writeFile(resolve(outDir, f.scenario + ".json"), JSON.stringify(f) + "\n");
  const r = f.expected.result;
  console.log(f.scenario.padEnd(28), f.expected.sessionPhase.padEnd(12), r ? (r.status + " " + (r.insufficientReason || "")) : "no result", f.frames.length, "frames");
}
