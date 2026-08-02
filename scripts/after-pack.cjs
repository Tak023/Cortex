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
};
