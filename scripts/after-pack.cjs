/**
 * electron-builder strips node_modules from extraResources.
 * After packing, force-copy the Next standalone node_modules into the app.
 */
const fs = require("fs");
const path = require("path");

/**
 * Robust recursive copy: follows/dereferences symlinks, skips sockets/FIFOs.
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
      const lst = fs.lstatSync(s);
      if (
        lst.isSocket() ||
        lst.isFIFO() ||
        lst.isCharacterDevice() ||
        lst.isBlockDevice()
      ) {
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

exports.default = async function afterPack(context) {
  const projectDir = context.packager.projectDir;
  const appOutDir = context.appOutDir;
  const productName = context.packager.appInfo.productFilename;

  const srcModules = path.join(
    projectDir,
    "desktop-runtime",
    "node_modules",
  );
  const altSrc = path.join(
    projectDir,
    ".next",
    "standalone",
    "node_modules",
  );
  const modulesSrc = fs.existsSync(srcModules) ? srcModules : altSrc;

  if (!fs.existsSync(modulesSrc)) {
    throw new Error(
      `afterPack: cannot find standalone node_modules at ${modulesSrc}`,
    );
  }

  // macOS: …/Cortex.app/Contents/Resources/standalone
  // linux/win: …/resources/standalone
  const resourcesDir =
    context.electronPlatformName === "darwin"
      ? path.join(appOutDir, `${productName}.app`, "Contents", "Resources")
      : path.join(appOutDir, "resources");

  const standaloneDir = path.join(resourcesDir, "standalone");
  const destModules = path.join(standaloneDir, "node_modules");

  if (!fs.existsSync(path.join(standaloneDir, "server.js"))) {
    throw new Error(
      `afterPack: standalone/server.js missing at ${standaloneDir}`,
    );
  }

  console.log(`afterPack: copying node_modules → ${destModules}`);
  if (fs.existsSync(destModules)) {
    fs.rmSync(destModules, { recursive: true, force: true });
  }
  copyDir(modulesSrc, destModules);

  // Also ensure server can resolve next
  const nextPkg = path.join(destModules, "next", "package.json");
  if (!fs.existsSync(nextPkg)) {
    throw new Error("afterPack: next package still missing after copy");
  }
  console.log("afterPack: next module present ✓");

  // Next NFT often keeps only the ESM half of the MCP SDK (and drops its
  // runtime deps like cross-spawn). Copy the full package tree from the
  // project install so isolated stdio clients work in the packaged app.
  const projectModules = path.join(projectDir, "node_modules");
  function copyPkg(name) {
    const src = path.join(projectModules, name);
    const dest = path.join(destModules, name);
    if (!fs.existsSync(src)) return;
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    if (fs.existsSync(dest)) fs.rmSync(dest, { recursive: true, force: true });
    copyDir(src, dest);
  }
  function readDeps(pkgDir) {
    try {
      const pkg = JSON.parse(
        fs.readFileSync(path.join(pkgDir, "package.json"), "utf8"),
      );
      return Object.keys({
        ...(pkg.dependencies || {}),
        ...(pkg.optionalDependencies || {}),
      });
    } catch {
      return [];
    }
  }
  function walkNested(dir, visit) {
    if (!fs.existsSync(dir)) return;
    for (const name of fs.readdirSync(dir)) {
      if (name.startsWith(".")) continue;
      const full = path.join(dir, name);
      if (name.startsWith("@")) {
        if (!fs.existsSync(full)) continue;
        for (const scoped of fs.readdirSync(full)) {
          visit(path.join(full, scoped));
        }
      } else {
        visit(full);
      }
    }
  }
  function copyPkgTree(name, seen = new Set()) {
    if (seen.has(name)) return;
    seen.add(name);
    const src = path.join(projectModules, name);
    if (!fs.existsSync(src)) return;
    copyPkg(name);
    for (const dep of readDeps(src)) copyPkgTree(dep, seen);
    walkNested(path.join(src, "node_modules"), (nested) => {
      for (const dep of readDeps(nested)) copyPkgTree(dep, seen);
    });
  }
  console.log("afterPack: installing full @modelcontextprotocol/sdk + deps…");
  copyPkgTree("@modelcontextprotocol/sdk");
  console.log("afterPack: MCP SDK present ✓");
  console.log("afterPack: installing @lancedb/lancedb + native bindings…");
  copyPkgTree("@lancedb/lancedb");
  copyPkgTree("apache-arrow");
  console.log("afterPack: LanceDB present ✓");

  // Next standalone NFT often strips node-pty prebuilds. Force a full copy from
  // the project install (includes prebuilds + spawn-helper) for Electron PTY.
  const fullPty = path.join(projectDir, "node_modules", "node-pty");
  const destPty = path.join(destModules, "node-pty");
  if (fs.existsSync(fullPty)) {
    console.log("afterPack: installing full node-pty (prebuilds)…");
    if (fs.existsSync(destPty)) {
      fs.rmSync(destPty, { recursive: true, force: true });
    }
    copyDir(fullPty, destPty);
    // spawn-helper must be executable
    const prebuilds = path.join(destPty, "prebuilds");
    if (fs.existsSync(prebuilds)) {
      const walk = (dir) => {
        for (const name of fs.readdirSync(dir)) {
          const full = path.join(dir, name);
          const st = fs.statSync(full);
          if (st.isDirectory()) walk(full);
          else if (name === "spawn-helper") {
            try {
              fs.chmodSync(full, 0o755);
            } catch {
              /* ignore */
            }
          }
        }
      };
      walk(prebuilds);
    }
    console.log("afterPack: node-pty present ✓");
  } else {
    console.warn("afterPack: project node_modules/node-pty missing");
  }
};
