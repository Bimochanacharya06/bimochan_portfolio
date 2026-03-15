#!/usr/bin/env node
/**
 * build-css.js — Minify all CSS files from static/css/ into dist/css/
 * Uses lightningcss for fast, modern minification.
 */

const fs = require("fs");
const path = require("path");

// Resolve paths relative to repo root
const ROOT = path.resolve(__dirname, "..");
const SRC_DIR = path.join(ROOT, "static", "css");
const OUT_DIR = path.join(ROOT, "dist", "css");

fs.mkdirSync(OUT_DIR, { recursive: true });

let lightningcss;
try {
  lightningcss = require("lightningcss");
} catch {
  console.error("lightningcss not found. Run: npm install");
  process.exit(1);
}

const files = fs.readdirSync(SRC_DIR).filter((f) => f.endsWith(".css"));

if (files.length === 0) {
  console.log("No CSS files found in", SRC_DIR);
  process.exit(0);
}

let hasError = false;
for (const file of files) {
  const srcPath = path.join(SRC_DIR, file);
  const outPath = path.join(OUT_DIR, file);
  try {
    const code = fs.readFileSync(srcPath);
    const { code: minified } = lightningcss.transform({
      filename: file,
      code,
      minify: true,
      sourceMap: false,
      targets: lightningcss.browserslistToTargets([
        "> 0.5%",
        "last 2 versions",
        "Firefox ESR",
        "not dead",
      ]),
    });
    fs.writeFileSync(outPath, minified);
    const origKB = (code.length / 1024).toFixed(1);
    const minKB = (minified.length / 1024).toFixed(1);
    const saved = (
      ((code.length - minified.length) / code.length) *
      100
    ).toFixed(0);
    console.log(`✓ ${file}: ${origKB} KB → ${minKB} KB (${saved}% smaller)`);
  } catch (err) {
    console.error(`✗ ${file}: ${err.message}`);
    hasError = true;
  }
}

if (hasError) process.exit(1);
console.log(`\nCSS build complete → dist/css/`);
