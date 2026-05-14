import * as esbuild from "esbuild";
import { readFile, writeFile, mkdir, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = __dirname;
const DIST = resolve(ROOT, "dist");
const watch = process.argv.includes("--watch");

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

  await writeFile(resolve(DIST, "index.html"), HTML);
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
  drop: watch ? [] : ["console"]
};

async function build() {
  await prepareDist();
  await copyAssets();

  if (watch) {
    const ctx = await esbuild.context(esbuildOptions);
    await ctx.watch();
    console.log("[build] watching for changes …");
  } else {
    await esbuild.build(esbuildOptions);
    console.log("[build] dist/ ready");
  }
}

build().catch((err) => {
  console.error(err);
  process.exit(1);
});
