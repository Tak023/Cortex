/**
 * After `next build`, assemble a complete desktop runtime:
 * standalone server + its node_modules + static assets + public files.
 *
 * electron-builder strips node_modules from extraResources by default,
 * so we also re-inject them in scripts/after-pack.cjs.
 */
const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const standalone = path.join(root, ".next", "standalone");
const staticSrc = path.join(root, ".next", "static");
const publicSrc = path.join(root, "public");
const runtime = path.join(root, "desktop-runtime");

/**
 * Robust recursive copy: follows/dereferences symlinks, skips sockets/FIFOs.
 * Next standalone may contain symlinks into traced packages (e.g. transformers).
 */
function copyDir(src, dest) {
  if (!fs.existsSync(src)) return;
  fs.mkdirSync(dest, { recursive: true });

  let entries;
  try {
    entries = fs.readdirSync(src, { withFileTypes: true });
  } catch (e) {
    console.warn("copyDir: cannot read", src, e.message);
    return;
  }

  for (const entry of entries) {
    const s = path.join(src, entry.name);
    const d = path.join(dest, entry.name);
    try {
      // Prefer lstat so we can detect symlinks/sockets ourselves
      const lst = fs.lstatSync(s);
      if (lst.isSocket() || lst.isFIFO() || lst.isCharacterDevice() || lst.isBlockDevice()) {
        continue;
      }
      if (lst.isSymbolicLink()) {
        let real;
        try {
          real = fs.realpathSync(s);
        } catch {
          console.warn("Skipping broken symlink:", s);
          continue;
        }
        const st = fs.statSync(real);
        if (st.isDirectory()) copyDir(real, d);
        else if (st.isFile()) {
          fs.mkdirSync(path.dirname(d), { recursive: true });
          fs.copyFileSync(real, d);
        }
        continue;
      }
      if (lst.isDirectory()) {
        copyDir(s, d);
      } else if (lst.isFile()) {
        fs.copyFileSync(s, d);
      }
    } catch (e) {
      console.warn("copy skip:", s, "→", e.message);
    }
  }
}

function rmrf(p) {
  fs.rmSync(p, { recursive: true, force: true });
}

if (!fs.existsSync(path.join(standalone, "server.js"))) {
  console.error(
    "Standalone server not found. Ensure next.config has output: 'standalone' and build succeeded.",
  );
  process.exit(1);
}

const nm = path.join(standalone, "node_modules", "next");
if (!fs.existsSync(nm)) {
  console.error(
    "standalone/node_modules/next missing — Next standalone output is incomplete.",
  );
  process.exit(1);
}

// Ensure static + public live inside standalone (and thus desktop-runtime)
if (fs.existsSync(staticSrc)) {
  console.log("Copying .next/static → standalone/.next/static");
  copyDir(staticSrc, path.join(standalone, ".next", "static"));
}
if (fs.existsSync(publicSrc)) {
  console.log("Copying public → standalone/public");
  copyDir(publicSrc, path.join(standalone, "public"));
}

// Next file-tracing sometimes pulls the whole project (and previous builds)
// into standalone. Strip recursive / non-runtime junk before packaging.
const JUNK = [
  "desktop-runtime",
  "dist-desktop",
  "dist",
  "node_modules/.cache",
  "node_modules/@huggingface/transformers/.cache",
  ".git",
  "Resources",
  "build",
  "electron",
  "scripts",
  "src", // only needed at build time; runtime uses .next
  "data",
  "main.cjs",
  "package-lock.json",
  "tsconfig.tsbuildinfo",
  "tsconfig.json",
  "next.config.ts",
  "next.config.js",
  "README.md",
  "Agents.md",
  "AGENTS.md",
  "Claude.md",
  "CLAUDE.md",
  ".env.example",
  ".env.local",
  ".gitignore",
  "eslint.config.mjs",
  "postcss.config.mjs",
  // Duplicate of top-level node_modules (~390MB+); server resolves via NODE_PATH
  path.join(".next", "node_modules"),
];
for (const rel of JUNK) {
  const p = path.join(standalone, rel);
  if (fs.existsSync(p)) {
    console.log("Stripping junk from standalone:", rel);
    rmrf(p);
  }
}

// Stage a clean runtime folder for electron-builder extraResources
console.log("Staging desktop-runtime/ …");
rmrf(runtime);
copyDir(standalone, runtime);

// Never re-include nested packaging dirs inside the staged runtime
for (const rel of ["desktop-runtime", "dist-desktop", "dist"]) {
  const p = path.join(runtime, rel);
  if (fs.existsSync(p)) {
    console.log("Stripping nested", rel, "from desktop-runtime");
    rmrf(p);
  }
}

// App scaffold templates are read at runtime by src/lib/build/scaffold.ts,
// but src/ is stripped from standalone above — stage them at the runtime
// root where scaffold.ts looks (cwd/templates, since server.js chdirs here).
const templatesSrc = path.join(root, "src", "lib", "build", "templates");
if (fs.existsSync(templatesSrc)) {
  console.log("Copying scaffold templates → desktop-runtime/templates");
  copyDir(templatesSrc, path.join(runtime, "templates"));
} else {
  console.warn("WARNING scaffold templates not found at", templatesSrc);
}

// Double-check critical modules
const checks = [
  "server.js",
  "node_modules/next/package.json",
  "node_modules/react/package.json",
  path.join(".next", "static"),
  "public/branding/cortex.jpg",
  "templates/docker/app/page.tsx",
];
for (const rel of checks) {
  const p = path.join(runtime, rel);
  if (!fs.existsSync(p)) {
    console.warn("WARNING missing in desktop-runtime:", rel);
  } else {
    console.log("OK", rel);
  }
}

const dataPlaceholder = path.join(runtime, "data");
fs.mkdirSync(dataPlaceholder, { recursive: true });

console.log("Desktop runtime ready at desktop-runtime/");
