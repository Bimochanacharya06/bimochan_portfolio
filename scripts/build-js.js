#!/usr/bin/env node
/**
 * build-js.js — Minify JS files from static/ into dist/js/
 * Uses terser for ES2017+ minification.
 */

const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const SRC_DIR = path.join(ROOT, "static");
const OUT_DIR = path.join(ROOT, "dist", "js");

fs.mkdirSync(OUT_DIR, { recursive: true });

let terser;
try {
  terser = require("terser");
} catch {
  console.error("terser not found. Run: npm install");
  process.exit(1);
}

// Only top-level .js files in static/ (not subdirectories)
const files = fs
  .readdirSync(SRC_DIR)
  .filter(
    (f) => f.endsWith(".js") && fs.statSync(path.join(SRC_DIR, f)).isFile(),
  );

if (files.length === 0) {
  console.log("No JS files found in", SRC_DIR);
  process.exit(0);
}

(async () => {
  let hasError = false;
  for (const file of files) {
    const srcPath = path.join(SRC_DIR, file);
    const outPath = path.join(OUT_DIR, file);
    try {
      const code = fs.readFileSync(srcPath, "utf8");
      const result = await terser.minify(code, {
        ecma: 2017,
        compress: { drop_console: false },
        mangle: true,
        format: { comments: false },
      });
      fs.writeFileSync(outPath, result.code, "utf8");
      const origKB = (Buffer.byteLength(code) / 1024).toFixed(1);
      const minKB = (Buffer.byteLength(result.code) / 1024).toFixed(1);
      const saved = (
        ((Buffer.byteLength(code) - Buffer.byteLength(result.code)) /
          Buffer.byteLength(code)) *
        100
      ).toFixed(0);
      console.log(`✓ ${file}: ${origKB} KB → ${minKB} KB (${saved}% smaller)`);
    } catch (err) {
      console.error(`✗ ${file}: ${err.message}`);
      hasError = true;
    }
  }
  if (hasError) process.exit(1);
  console.log(`\nJS build complete → dist/js/`);
})();
