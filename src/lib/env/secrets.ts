/**
 * Load API secrets into process.env for packaged Electron / standalone Next.
 *
 * Next only auto-loads project `.env*` in dev. Desktop Cortex stores secrets in
 * `~/Library/Application Support/cortex/.env` (and project `.env.local` for dev).
 * Call `ensureSecretsLoaded()` early on the server so MCP status + Tavily/etc.
 * see the keys without baking them into the DMG.
 */
import fs from "fs";
import os from "os";
import path from "path";

let loaded = false;

function loadEnvFile(filePath: string, opts?: { override?: boolean }) {
  try {
    if (!filePath || !fs.existsSync(filePath)) return;
    const text = fs.readFileSync(filePath, "utf8");
    for (const raw of text.split(/\r?\n/)) {
      const line = raw.trim();
      if (!line || line.startsWith("#")) continue;
      const eq = line.indexOf("=");
      if (eq <= 0) continue;
      const key = line.slice(0, eq).trim();
      let val = line.slice(eq + 1).trim();
      if (
        (val.startsWith('"') && val.endsWith('"')) ||
        (val.startsWith("'") && val.endsWith("'"))
      ) {
        val = val.slice(1, -1);
      }
      if (!key) continue;
      if (opts?.override || process.env[key] === undefined || process.env[key] === "") {
        process.env[key] = val;
      }
    }
  } catch {
    /* ignore missing / unreadable */
  }
}

function secretCandidates(): string[] {
  const home = os.homedir();
  const cwd = process.cwd();
  const dataDir = process.env.CORTEX_DATA_DIR;
  const paths: string[] = [];

  // Packaged app userData (Electron sets CORTEX_DATA_DIR to .../cortex/data)
  if (dataDir) {
    paths.push(path.join(dataDir, "..", ".env"));
    paths.push(path.join(dataDir, "..", "cortex.env"));
    paths.push(path.join(dataDir, ".env"));
  }

  // Standard macOS / Linux app support locations
  paths.push(
    path.join(home, "Library/Application Support/cortex/.env"),
    path.join(home, "Library/Application Support/cortex/cortex.env"),
    path.join(home, ".config/cortex/.env"),
    path.join(home, ".cortex.env"),
  );

  // Dev / project
  paths.push(path.join(cwd, ".env.local"), path.join(cwd, ".env"));
  // monorepo when cwd is standalone/
  paths.push(
    path.join(cwd, "..", "..", "..", ".env.local"),
    path.join(cwd, "..", ".env.local"),
  );

  return paths;
}

/** Idempotent — safe to call from every API route / store load. */
export function ensureSecretsLoaded(): void {
  if (loaded) return;
  loaded = true;
  for (const p of secretCandidates()) {
    loadEnvFile(p);
  }
}

/** Force re-read (e.g. after user edits Application Support .env). */
export function reloadSecrets(): void {
  loaded = false;
  ensureSecretsLoaded();
}

export function secretPresent(key: string): boolean {
  ensureSecretsLoaded();
  const v = process.env[key];
  return Boolean(v && String(v).trim());
}
