/**
 * Ensure node-pty spawn-helper binaries are executable.
 * Some npm installs drop the +x bit on prebuild helpers, which breaks PTY spawn.
 */
const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..", "node_modules", "node-pty", "prebuilds");
if (!fs.existsSync(root)) process.exit(0);

function walk(dir) {
  for (const name of fs.readdirSync(dir)) {
    const full = path.join(dir, name);
    let st;
    try {
      st = fs.statSync(full);
    } catch {
      continue;
    }
    if (st.isDirectory()) walk(full);
    else if (name === "spawn-helper" || name.endsWith(".node")) {
      try {
        fs.chmodSync(full, 0o755);
      } catch {
        /* ignore */
      }
    }
  }
}

walk(root);
