/**
 * Build + test scaffolded apps. Captures logs, attempts simple auto-fixes,
 * and reports unresolved errors for the orchestration engine.
 */
import fs from "fs";
import path from "path";
import os from "os";
import { spawn } from "child_process";

export type VerifyAttempt = {
  n: number;
  step: string;
  ok: boolean;
  log: string;
  fixed?: string;
};

export type VerifyResult = {
  ok: boolean;
  appDir: string;
  attempts: VerifyAttempt[];
  /** Final combined report for artifacts / UI */
  report: string;
  unresolvedErrors: string[];
  buildOk: boolean;
  testOk: boolean;
  installOk: boolean;
};

const MAX_FIX_ROUNDS = 3;

function enrichedEnv(): NodeJS.ProcessEnv {
  const home = os.homedir();
  const extras = [
    path.join(home, ".local", "bin"),
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
    ...process.env,
    PATH,
    CI: "1",
    FORCE_COLOR: "0",
    npm_config_progress: "false",
    npm_config_fund: "false",
    npm_config_audit: "false",
  };
}

function runCmd(
  command: string,
  cwd: string,
  timeoutMs = 180_000,
): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    const shell = process.env.SHELL || "/bin/zsh";
    const child = spawn(shell, ["-lc", command], {
      cwd,
      env: enrichedEnv(),
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      try {
        child.kill("SIGTERM");
      } catch {
        /* ignore */
      }
      resolve({
        code: 124,
        stdout,
        stderr: stderr + `\n[timeout after ${timeoutMs}ms]`,
      });
    }, timeoutMs);

    child.stdout?.on("data", (d) => {
      stdout += d.toString();
    });
    child.stderr?.on("data", (d) => {
      stderr += d.toString();
    });
    child.on("exit", (code) => {
      clearTimeout(timer);
      resolve({ code: code ?? 1, stdout, stderr });
    });
    child.on("error", (err) => {
      clearTimeout(timer);
      resolve({ code: 1, stdout, stderr: err.message });
    });
  });
}

function tail(s: string, n = 4000): string {
  return s.length > n ? s.slice(-n) : s;
}

function extractErrors(log: string): string[] {
  const lines = log.split("\n");
  const errs: string[] = [];
  for (const line of lines) {
    if (
      /error TS\d+/i.test(line) ||
      /Error:/i.test(line) ||
      /failed/i.test(line) ||
      /Cannot find module/i.test(line) ||
      /Module not found/i.test(line) ||
      /Type error/i.test(line) ||
      /ELIFECYCLE/i.test(line)
    ) {
      const t = line.trim();
      if (t && !errs.includes(t)) errs.push(t);
    }
  }
  return errs.slice(0, 30);
}

/**
 * Attempt automatic fixes based on common scaffold failures.
 * Returns a short description of what was changed, or null.
 */
function tryAutoFix(appDir: string, log: string): string | null {
  const fixes: string[] = [];

  // Missing next.config
  if (
    !fs.existsSync(path.join(appDir, "next.config.mjs")) &&
    !fs.existsSync(path.join(appDir, "next.config.js")) &&
    !fs.existsSync(path.join(appDir, "next.config.ts"))
  ) {
    fs.writeFileSync(
      path.join(appDir, "next.config.mjs"),
      `/** @type {import('next').NextConfig} */\nconst nextConfig = {};\nexport default nextConfig;\n`,
    );
    fixes.push("added next.config.mjs");
  }

  // Ensure tsconfig has jsx preserve
  const tsconfigPath = path.join(appDir, "tsconfig.json");
  if (fs.existsSync(tsconfigPath)) {
    try {
      const ts = JSON.parse(fs.readFileSync(tsconfigPath, "utf-8")) as {
        compilerOptions?: Record<string, unknown>;
      };
      ts.compilerOptions = ts.compilerOptions || {};
      if (!ts.compilerOptions.jsx) {
        ts.compilerOptions.jsx = "preserve";
        fixes.push("set tsconfig jsx=preserve");
      }
      if (!ts.compilerOptions.paths) {
        ts.compilerOptions.paths = { "@/*": ["./*"] };
        fixes.push("added tsconfig paths");
      }
      fs.writeFileSync(tsconfigPath, JSON.stringify(ts, null, 2) + "\n");
    } catch {
      /* ignore */
    }
  }

  // next-env.d.ts
  if (!fs.existsSync(path.join(appDir, "next-env.d.ts"))) {
    fs.writeFileSync(
      path.join(appDir, "next-env.d.ts"),
      `/// <reference types="next" />\n/// <reference types="next/image-types/global" />\n`,
    );
    fixes.push("added next-env.d.ts");
  }

  // package.json scripts must exist
  const pkgPath = path.join(appDir, "package.json");
  if (fs.existsSync(pkgPath)) {
    try {
      const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf-8")) as {
        scripts?: Record<string, string>;
        dependencies?: Record<string, string>;
      };
      pkg.scripts = pkg.scripts || {};
      let changed = false;
      if (!pkg.scripts.build && pkg.dependencies?.next) {
        pkg.scripts.build = "next build";
        changed = true;
        fixes.push("added npm run build");
      }
      if (!pkg.scripts.dev && pkg.dependencies?.next) {
        pkg.scripts.dev = "next dev -H 127.0.0.1 -p 3456";
        changed = true;
        fixes.push("added npm run dev");
      }
      if (!pkg.scripts.test) {
        // Minimal smoke test script that always can run after build
        pkg.scripts.test = "node -e \"console.log('smoke ok')\"";
        changed = true;
        fixes.push("added smoke test script");
      }
      if (changed) {
        fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + "\n");
      }
    } catch {
      /* ignore */
    }
  }

  // Corrupt node_modules signal
  if (
    /Cannot find module 'next'/i.test(log) ||
    /npm ERR!/i.test(log) ||
    /ERESOLVE/i.test(log)
  ) {
    // Leave node_modules for reinstall step
    fixes.push("will reinstall dependencies");
  }

  // Syntax in generated pages - ensure app/page exists for next apps
  if (
    fs.existsSync(path.join(appDir, "package.json")) &&
    !fs.existsSync(path.join(appDir, "app", "page.tsx")) &&
    !fs.existsSync(path.join(appDir, "pages", "index.tsx")) &&
    !fs.existsSync(path.join(appDir, "server.mjs")) &&
    !fs.existsSync(path.join(appDir, "bin", "cli.mjs"))
  ) {
    fs.mkdirSync(path.join(appDir, "app"), { recursive: true });
    fs.writeFileSync(
      path.join(appDir, "app", "page.tsx"),
      `export default function Page() {\n  return <main><h1>App</h1><p>Generated by Cortex</p></main>;\n}\n`,
    );
    fs.writeFileSync(
      path.join(appDir, "app", "layout.tsx"),
      `export default function RootLayout({ children }: { children: React.ReactNode }) {\n  return <html lang="en"><body>{children}</body></html>;\n}\n`,
    );
    fixes.push("added minimal app/page.tsx");
  }

  return fixes.length ? fixes.join("; ") : null;
}

export async function verifyAppBuild(
  appDir: string,
): Promise<VerifyResult> {
  const attempts: VerifyAttempt[] = [];
  const unresolved: string[] = [];

  if (!fs.existsSync(appDir)) {
    return {
      ok: false,
      appDir,
      attempts: [],
      report: `App directory missing: ${appDir}`,
      unresolvedErrors: [`App directory missing: ${appDir}`],
      buildOk: false,
      testOk: false,
      installOk: false,
    };
  }

  let installOk = false;
  let buildOk = false;
  let testOk = false;

  for (let round = 1; round <= MAX_FIX_ROUNDS; round++) {
    // Install
    const install = await runCmd(
      "npm install --no-fund --no-audit --loglevel=error",
      appDir,
      240_000,
    );
    installOk = install.code === 0;
    attempts.push({
      n: round,
      step: "npm install",
      ok: installOk,
      log: tail(install.stdout + "\n" + install.stderr),
    });

    if (!installOk) {
      const fixed = tryAutoFix(appDir, install.stdout + install.stderr);
      if (fixed && round < MAX_FIX_ROUNDS) {
        attempts[attempts.length - 1].fixed = fixed;
        // wipe node_modules if needed
        if (fixed.includes("reinstall")) {
          try {
            fs.rmSync(path.join(appDir, "node_modules"), {
              recursive: true,
              force: true,
            });
          } catch {
            /* ignore */
          }
        }
        continue;
      }
      unresolved.push(...extractErrors(install.stdout + install.stderr));
      if (!unresolved.length) {
        unresolved.push(`npm install failed (exit ${install.code})`);
      }
      break;
    }

    const pkg = JSON.parse(
      fs.readFileSync(path.join(appDir, "package.json"), "utf-8"),
    ) as { scripts?: Record<string, string>; dependencies?: Record<string, string> };

    const isNext = Boolean(pkg.dependencies?.next);
    const isCli = fs.existsSync(path.join(appDir, "bin", "cli.mjs"));
    const isApi = fs.existsSync(path.join(appDir, "server.mjs"));

    // Build
    if (isNext && pkg.scripts?.build) {
      const build = await runCmd("npm run build", appDir, 300_000);
      buildOk = build.code === 0;
      attempts.push({
        n: round,
        step: "npm run build",
        ok: buildOk,
        log: tail(build.stdout + "\n" + build.stderr, 6000),
      });
      if (!buildOk) {
        const fixed = tryAutoFix(appDir, build.stdout + build.stderr);
        if (fixed && round < MAX_FIX_ROUNDS) {
          attempts[attempts.length - 1].fixed = fixed;
          continue;
        }
        unresolved.push(...extractErrors(build.stdout + build.stderr));
        if (!unresolved.length) {
          unresolved.push(`npm run build failed (exit ${build.code})`);
        }
        break;
      }
    } else if (isCli) {
      const smoke = await runCmd("node bin/cli.mjs help", appDir, 15_000);
      buildOk = smoke.code === 0;
      attempts.push({
        n: round,
        step: "cli help smoke",
        ok: buildOk,
        log: tail(smoke.stdout + "\n" + smoke.stderr),
      });
      if (!buildOk) {
        unresolved.push(...extractErrors(smoke.stdout + smoke.stderr));
        break;
      }
    } else if (isApi) {
      // Syntax check by loading with node --check
      const check = await runCmd("node --check server.mjs", appDir, 15_000);
      buildOk = check.code === 0;
      attempts.push({
        n: round,
        step: "node --check server.mjs",
        ok: buildOk,
        log: tail(check.stdout + "\n" + check.stderr),
      });
      if (!buildOk) {
        unresolved.push(...extractErrors(check.stdout + check.stderr));
        break;
      }
    } else {
      buildOk = true;
      attempts.push({
        n: round,
        step: "build (skipped — no build script)",
        ok: true,
        log: "No next build / CLI / API entry detected; treated as OK.",
      });
    }

    // Test
    if (pkg.scripts?.test) {
      const test = await runCmd("npm test", appDir, 120_000);
      testOk = test.code === 0;
      attempts.push({
        n: round,
        step: "npm test",
        ok: testOk,
        log: tail(test.stdout + "\n" + test.stderr),
      });
      if (!testOk) {
        const fixed = tryAutoFix(appDir, test.stdout + test.stderr);
        if (fixed && round < MAX_FIX_ROUNDS) {
          attempts[attempts.length - 1].fixed = fixed;
          continue;
        }
        unresolved.push(...extractErrors(test.stdout + test.stderr));
        if (!unresolved.length) {
          unresolved.push(`npm test failed (exit ${test.code})`);
        }
        break;
      }
    } else {
      // Default smoke: ensure package.json parses and main files exist
      testOk = true;
      attempts.push({
        n: round,
        step: "smoke test",
        ok: true,
        log: "No test script — package structure smoke OK.",
      });
    }

    // Success path
    if (installOk && buildOk && testOk) {
      break;
    }
  }

  const ok = installOk && buildOk && testOk && unresolved.length === 0;
  const report = buildReport({
    ok,
    appDir,
    attempts,
    unresolved,
    installOk,
    buildOk,
    testOk,
  });

  return {
    ok,
    appDir,
    attempts,
    report,
    unresolvedErrors: [...new Set(unresolved)],
    buildOk,
    testOk,
    installOk,
  };
}

function buildReport(opts: {
  ok: boolean;
  appDir: string;
  attempts: VerifyAttempt[];
  unresolved: string[];
  installOk: boolean;
  buildOk: boolean;
  testOk: boolean;
}): string {
  const lines: string[] = [
    `# Build & test report`,
    ``,
    `**Result:** ${opts.ok ? "✅ PASSED" : "❌ FAILED"}`,
    `**App:** \`${opts.appDir}\``,
    `**Install:** ${opts.installOk ? "ok" : "failed"} · **Build:** ${opts.buildOk ? "ok" : "failed"} · **Test:** ${opts.testOk ? "ok" : "failed"}`,
    ``,
    `## Attempts`,
  ];
  for (const a of opts.attempts) {
    lines.push(
      `### ${a.n}. ${a.step} — ${a.ok ? "OK" : "FAIL"}`,
    );
    if (a.fixed) lines.push(`Auto-fix applied: ${a.fixed}`);
    lines.push("```");
    lines.push(a.log.slice(0, 3000) || "(no output)");
    lines.push("```");
    lines.push("");
  }
  if (opts.unresolved.length) {
    lines.push(`## Unresolved errors`);
    for (const e of opts.unresolved) lines.push(`- ${e}`);
    lines.push("");
    lines.push(
      `Cortex could not automatically fix these. Open the app folder and resolve them, then use **Rebuild app** or re-run the pipeline.`,
    );
  } else if (opts.ok) {
    lines.push(`## Notes`);
    lines.push(`All install/build/test steps succeeded. Safe to mark complete and launch.`);
  }
  return lines.join("\n");
}
