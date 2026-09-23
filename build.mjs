import * as esbuild from "esbuild";
import { readFile, writeFile, mkdir, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { createHash } from "node:crypto";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { POSE_PROVIDER, RUNTIME_ASSETS, FORBIDDEN_RUNTIME_MARKERS } from "./js/movement/modelVersion.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = __dirname;
const DIST = resolve(ROOT, "dist");
const watch = process.argv.includes("--watch");

/* Development builds keep console output and additionally emit the dev-only
   demo seeder as its OWN bundle (dist/dev-seed.js), referenced only by the
   HTML those builds write. A production build never compiles js/dev/ and
   never emits the script tag, so the seeder and its fixtures are absent
   from the shipped app rather than merely disabled at runtime — nothing
   about that depends on dead-code elimination succeeding. */
const dev = watch || process.argv.includes("--dev");

const DEV_SEED_TAG = '<script type="module" src="dev-seed.js"></script>\n';

const HTML = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0, user-scalable=no, viewport-fit=cover">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
<meta name="theme-color" content="#0B0F1A">
<meta name="description" content="PHYSIQ ENGINE — A comprehensive nutrition and fitness optimizer personalized to your body, goals, and routine.">
<title>PHYSIQ ENGINE</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700&family=Space+Mono:wght@400;700&display=swap" rel="stylesheet">
<link rel="stylesheet" href="styles.min.css">
</head>
<body data-theme="dark">
<div id="app"></div>
<script type="module" src="app.min.js"></script>
</body>
</html>
`;

async function prepareDist() {
  if (existsSync(DIST)) await rm(DIST, { recursive: true, force: true });
  await mkdir(DIST, { recursive: true });
}

async function copyAssets() {
  const css = await readFile(resolve(ROOT, "css/styles.css"), "utf8");
  await writeFile(resolve(DIST, "styles.min.css"), css);

  await writeFile(resolve(DIST, "index.html"), dev ? HTML.replace("</body>", DEV_SEED_TAG + "</body>") : HTML);
}

const esbuildOptions = {
  entryPoints: [resolve(ROOT, "js/App.js")],
  bundle: true,
  format: "esm",
  target: ["es2018"],
  minify: true,
  jsx: "automatic",
  loader: { ".js": "jsx" },
  outfile: resolve(DIST, "app.min.js"),
  legalComments: "none",
  logLevel: "info",
  drop: dev ? [] : ["console"]
};

/* Second, dev-only bundle. Never built for production. */
const devSeedOptions = {
  entryPoints: [resolve(ROOT, "js/dev/seedEntry.js")],
  bundle: true,
  format: "esm",
  target: ["es2018"],
  minify: true,
  jsx: "automatic",
  loader: { ".js": "jsx" },
  outfile: resolve(DIST, "dev-seed.js"),
  legalComments: "none",
  logLevel: "info"
};

/* Milestone 6 — Movement Assessment pose runtime.
   The MediaPipe runtime is compiled into its OWN script (never part of
   app.min.js) and loaded only when a user starts an assessment. Its WASM and
   the vendored model are copied next to it. Every file is checked against
   the SHA-256 pinned in js/movement/modelVersion.js, and the shipped
   JavaScript is scanned for the telemetry endpoint that @mediapipe/tasks-vision
   1.x added: a mismatch or a hit fails the build instead of shipping. */
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

function assertNoTelemetry(label, text) {
  FORBIDDEN_RUNTIME_MARKERS.forEach((marker) => {
    if (text.includes(marker)) throw new Error(`[build] ${label} contains forbidden runtime marker "${marker}"`);
  });
}

async function buildMovementRuntime() {
  const pkg = JSON.parse(await readFile(resolve(ROOT, "node_modules/@mediapipe/tasks-vision/package.json"), "utf8"));
  if (pkg.version !== POSE_PROVIDER.packageVersion) {
    throw new Error(`[build] @mediapipe/tasks-vision ${pkg.version} installed; ${POSE_PROVIDER.packageVersion} is pinned`);
  }

  const out = await esbuild.build({
    entryPoints: [resolve(ROOT, "js/movement/poseRuntimeEntry.js")],
    bundle: true,
    format: "iife",
    globalName: "PhysiqPoseRuntime",
    target: ["es2018"],
    minify: true,
    write: false,
    legalComments: "none",
    logLevel: "warning"
  });
  const runtimeText = out.outputFiles[0].text;
  assertNoTelemetry("pose runtime bundle", runtimeText);
  await mkdir(resolve(DIST, "movement/mediapipe"), { recursive: true });
  await mkdir(resolve(DIST, "movement/models"), { recursive: true });
  await writeFile(resolve(DIST, RUNTIME_ASSETS.runtimeBundle), runtimeText);

  for (const asset of [RUNTIME_ASSETS.wasmLoader, RUNTIME_ASSETS.wasmBinary, RUNTIME_ASSETS.model]) {
    const bytes = await readFile(resolve(ROOT, asset.from));
    const digest = sha256(bytes);
    if (digest !== asset.sha256) {
      throw new Error(`[build] ${asset.from} has SHA-256 ${digest}; ${asset.sha256} is pinned`);
    }
    if (asset.path.endsWith(".js")) assertNoTelemetry(asset.from, bytes.toString("utf8"));
    await writeFile(resolve(DIST, asset.path), bytes);
  }

  for (const notice of ["NOTICE.md", "LICENSE-2.0.txt"]) {
    await writeFile(resolve(DIST, "movement", notice), await readFile(resolve(ROOT, "vendor/mediapipe", notice)));
  }
}

async function build() {
  await prepareDist();
  await copyAssets();
  await buildMovementRuntime();

  if (watch) {
    const ctx = await esbuild.context(esbuildOptions);
    await ctx.watch();
    const devCtx = await esbuild.context(devSeedOptions);
    await devCtx.watch();
    console.log("[build] watching for changes …");
  } else {
    await esbuild.build(esbuildOptions);
    if (dev) await esbuild.build(devSeedOptions);
    console.log("[build] dist/ ready" + (dev ? " (dev build — includes demo seeder)" : ""));
  }
}

build().catch((err) => {
  console.error(err);
  process.exit(1);
});
