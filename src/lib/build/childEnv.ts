/**
 * Environment for npm/node work on *scaffolded* apps.
 *
 * Packaged Cortex runs with NODE_ENV=production. Two separate concerns:
 *
 * 1) `npm install` — if production mode leaks in, npm skips devDependencies
 *    (typescript, vitest, …) and Next builds fail.
 * 2) `next build` — must run with NODE_ENV=production (Next's requirement).
 *    Using development here can break static generation.
 */
import os from "os";
import path from "path";

/**
 * Host env vars that must never reach scaffolded-app child processes.
 *
 * The packaged Cortex server (Next standalone) sets
 * `__NEXT_PRIVATE_STANDALONE_CONFIG`; if a child `next build` inherits it,
 * Next skips loading the app's own next.config and JSON-parses the HOST
 * config instead — functions like `generateBuildId` are lost in
 * serialization, and the build dies with "generate is not a function".
 * `TURBOPACK` (set by the Next 16 host) similarly breaks the child's
 * `next build`. PORT/HOSTNAME would misdirect the child's dev/start server.
 */
const BLOCKED_ENV_VARS = new Set([
  "TURBOPACK",
  "NODE_PATH",
  "PORT",
  "HOSTNAME",
  "NEXT_DEPLOYMENT_ID",
  "NEXT_RUNTIME",
  "NODE_OPTIONS",
  "KEEP_ALIVE_TIMEOUT",
]);

function sanitizedHostEnv(): NodeJS.ProcessEnv {
  const env = { ...process.env };
  for (const key of Object.keys(env)) {
    if (key.startsWith("__NEXT_PRIVATE_") || BLOCKED_ENV_VARS.has(key)) {
      delete env[key];
    }
  }
  return env;
}

function basePathEnv(): NodeJS.ProcessEnv {
  const home = os.homedir();
  const extras = [
    path.join(home, ".local", "bin"),
    path.join(home, ".nvm", "current", "bin"),
    "/opt/homebrew/bin",
    "/usr/local/bin",
    "/usr/bin",
    "/bin",
  ];
  const parts = [...(process.env.PATH || "").split(":"), ...extras].filter(
    Boolean,
  );
  const seen = new Set<string>();
  const PATH = parts
    .filter((p) => (seen.has(p) ? false : (seen.add(p), true)))
    .join(":");

  return {
    ...sanitizedHostEnv(),
    PATH,
    FORCE_COLOR: "0",
    BROWSER: "none",
    CI: "1",
  };
}

/**
 * Env for `npm install` on generated apps.
 * Forces inclusion of devDependencies even when Cortex itself is production.
 */
export function childProjectInstallEnv(
  extra: Record<string, string | undefined> = {},
): NodeJS.ProcessEnv {
  return {
    ...basePathEnv(),
    // Override parent Electron production mode so npm installs typescript/etc.
    NODE_ENV: "development",
    npm_config_production: "false",
    npm_config_omit: "",
    npm_config_include: "dev",
    npm_config_progress: "false",
    npm_config_fund: "false",
    npm_config_audit: "false",
    ...extra,
  };
}

/**
 * Env for Vitest / unit tests (React Testing Library needs non-production React).
 */
export function childProjectTestEnv(
  extra: Record<string, string | undefined> = {},
): NodeJS.ProcessEnv {
  return {
    ...basePathEnv(),
    NODE_ENV: "test",
    ...extra,
  };
}

/**
 * Env for `next build` / running generated apps.
 * NODE_ENV must be production for a correct Next production build.
 */
export function childProjectBuildEnv(
  extra: Record<string, string | undefined> = {},
): NodeJS.ProcessEnv {
  return {
    ...basePathEnv(),
    NODE_ENV: "production",
    ...extra,
  };
}

/** @deprecated Prefer childProjectInstallEnv / childProjectBuildEnv */
export function childProjectEnv(
  extra: Record<string, string | undefined> = {},
): NodeJS.ProcessEnv {
  return childProjectInstallEnv(extra);
}

/** npm args that always include devDependencies */
export const NPM_INSTALL_ARGS = [
  "install",
  "--include=dev",
  "--no-fund",
  "--no-audit",
  "--loglevel=error",
] as const;
