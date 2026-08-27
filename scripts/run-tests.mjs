#!/usr/bin/env node
/**
 * Compile the pure modules under test to a temp directory, then run the
 * suites in tests/ against them.
 *
 * These previously lived in /tmp and were cited as verification for work that
 * had no durable tests — four days later the harnesses had been cleaned up and
 * nothing could be re-run. They belong in the repo.
 *
 * Only dependency-free modules are compiled here. Anything reaching for the
 * store, the filesystem or child processes is covered by its behaviour at the
 * seams instead (see tests/codegen.test.mjs, which drives real directories).
 */
import { execFileSync } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";
import { fileURLToPath, pathToFileURL } from "url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT = fs.mkdtempSync(path.join(os.tmpdir(), "cortex-tests-"));

const ENTRYPOINTS = [
  "src/lib/agents/router.ts",
  "src/lib/agents/adapters/modelMatch.ts",
  "src/lib/agents/adapters/cliOutput.ts",
  "src/lib/build/styleCheck.ts",
];

function compile() {
  execFileSync(
    "npx",
    [
      "tsc",
      ...ENTRYPOINTS,
      "--outDir", OUT,
      // Pin the root so output is always OUT/lib/... regardless of which
      // entrypoints are listed; tsc otherwise infers it from their common
      // ancestor and the layout shifts under you.
      "--rootDir", "src",
      "--module", "esnext",
      "--target", "es2022",
      "--moduleResolution", "bundler",
      "--skipLibCheck",
      "--noEmitOnError", "false",
    ],
    { cwd: ROOT, stdio: ["ignore", "ignore", "pipe"] },
  );
}

/**
 * tsc emits bare relative specifiers, which Node's ESM loader rejects.
 * Rewrite them to explicit .js paths.
 */
function addExtensions(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const abs = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      addExtensions(abs);
    } else if (entry.name.endsWith(".js")) {
      const src = fs.readFileSync(abs, "utf8");
      const fixed = src.replace(
        /(from\s+")(\.[^"]*?)(")/g,
        (m, a, spec, c) => (spec.endsWith(".js") ? m : `${a}${spec}.js${c}`),
      );
      if (fixed !== src) fs.writeFileSync(abs, fixed);
    }
  }
}

/** Resolver handed to each suite: "agents/router.js" → file URL in OUT. */
const mod = (rel) => pathToFileURL(path.join(OUT, "lib", rel)).href;

try {
  compile();
} catch (e) {
  // tsc exits non-zero on the alias imports it cannot resolve; the pure
  // modules still emit, so only a genuinely missing output is fatal.
  const stderr = e?.stderr?.toString?.() ?? "";
  if (!fs.existsSync(path.join(OUT, "lib"))) {
    console.error("Failed to compile modules under test:\n" + stderr);
    process.exit(1);
  }
}
addExtensions(OUT);

const { report } = await import("../tests/harness.mjs");
const suites = fs
  .readdirSync(path.join(ROOT, "tests"))
  .filter((f) => f.endsWith(".test.mjs"))
  .sort();

for (const file of suites) {
  const suite = await import(pathToFileURL(path.join(ROOT, "tests", file)).href);
  await suite.run(mod);
}

const ok = report();
fs.rmSync(OUT, { recursive: true, force: true });
process.exit(ok ? 0 : 1);
