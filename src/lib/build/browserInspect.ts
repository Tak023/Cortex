/**
 * Browser access for build/test recovery.
 * Opens the local app (Playwright Chromium), captures console errors,
 * page crashes, failed network requests, and a screenshot — so Cortex
 * can diagnose and fix issues the headless log alone cannot show.
 */
import fs from "fs";
import path from "path";
import { spawn } from "child_process";
import http from "http";
import { childProjectInstallEnv, childProjectBuildEnv } from "./childEnv";

export type BrowserFinding = {
  kind: "console" | "pageerror" | "requestfailed" | "http" | "info";
  message: string;
};

export type BrowserInspectResult = {
  ok: boolean;
  url: string;
  title?: string;
  status?: number;
  findings: BrowserFinding[];
  screenshotPath?: string;
  bodySnippet?: string;
  log: string;
  /** Short human summary for activity feed / messages */
  summary: string;
};

function enrichedEnv(): NodeJS.ProcessEnv {
  return childProjectInstallEnv();
}

function serverEnv(): NodeJS.ProcessEnv {
  return childProjectBuildEnv({ BROWSER: "none", PORT: "3456" });
}

function runCmd(
  command: string,
  cwd: string,
  timeoutMs = 120_000,
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

function waitForHttp(url: string, timeoutMs = 60_000): Promise<number> {
  const start = Date.now();
  return new Promise((resolve, reject) => {
    const tick = () => {
      const req = http.get(url, { timeout: 2500 }, (res) => {
        res.resume();
        resolve(res.statusCode || 0);
      });
      req.on("error", () => {
        if (Date.now() - start > timeoutMs) {
          reject(new Error(`Server not ready at ${url}`));
          return;
        }
        setTimeout(tick, 400);
      });
      req.on("timeout", () => req.destroy());
    };
    tick();
  });
}

/**
 * Inspect a running (or startable) local web app with Playwright.
 * Captures runtime errors that unit/build logs miss.
 */
export async function inspectAppInBrowser(opts: {
  appDir: string;
  url?: string;
  /** Prefer production start after build; falls back to dev */
  preferStart?: boolean;
  headed?: boolean;
  screenshotDir?: string;
}): Promise<BrowserInspectResult> {
  const url = opts.url || "http://127.0.0.1:3456";
  const findings: BrowserFinding[] = [];
  const logParts: string[] = [];
  const screenshotDir =
    opts.screenshotDir || path.join(opts.appDir, "test-results", "browser");
  fs.mkdirSync(screenshotDir, { recursive: true });
  const screenshotPath = path.join(screenshotDir, `inspect-${Date.now()}.png`);

  // Ensure playwright + chromium
  if (
    !fs.existsSync(
      path.join(opts.appDir, "node_modules", "@playwright", "test"),
    )
  ) {
    const inst = await runCmd(
      "npm install --no-fund --no-audit --loglevel=error -D @playwright/test@^1.50.1",
      opts.appDir,
      240_000,
    );
    logParts.push(`install playwright: exit ${inst.code}`);
  }
  await runCmd("npx playwright install chromium", opts.appDir, 300_000);

  // Write a one-shot inspector script (no dependency on TS compile of app)
  const scriptPath = path.join(screenshotDir, "_cortex_inspect.mjs");
  const headed = Boolean(opts.headed || process.env.CORTEX_HEADED_BROWSER === "1");
  const script = `import { chromium } from "@playwright/test";
import fs from "fs";

const url = ${JSON.stringify(url)};
const screenshotPath = ${JSON.stringify(screenshotPath)};
const headed = ${headed ? "true" : "false"};
const out = {
  ok: false,
  url,
  title: "",
  status: 0,
  findings: [],
  bodySnippet: "",
  screenshotPath: "",
};

const browser = await chromium.launch({
  headless: !headed,
  args: ["--disable-dev-shm-usage"],
});
const page = await browser.newPage();

page.on("console", (msg) => {
  const type = msg.type();
  if (type === "error" || type === "warning") {
    out.findings.push({ kind: "console", message: \`[\${type}] \${msg.text()}\` });
  }
});
page.on("pageerror", (err) => {
  out.findings.push({ kind: "pageerror", message: String(err?.message || err) });
});
page.on("requestfailed", (req) => {
  const f = req.failure();
  out.findings.push({
    kind: "requestfailed",
    message: \`\${req.method()} \${req.url()} — \${f?.errorText || "failed"}\`,
  });
});

try {
  const res = await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45000 });
  out.status = res?.status() || 0;
  out.title = await page.title();
  await page.waitForTimeout(800);
  out.bodySnippet = (await page.locator("body").innerText().catch(() => "")).slice(0, 1200);
  await page.screenshot({ path: screenshotPath, fullPage: true }).catch(() => {});
  if (fs.existsSync(screenshotPath)) out.screenshotPath = screenshotPath;
  out.ok = out.status >= 200 && out.status < 400 &&
    !out.findings.some((f) => f.kind === "pageerror");
  if (out.status >= 400) {
    out.findings.push({ kind: "http", message: \`HTTP \${out.status} for \${url}\` });
  }
  if (!out.bodySnippet || out.bodySnippet.trim().length < 3) {
    out.findings.push({ kind: "info", message: "Page body appears empty" });
    out.ok = false;
  }
} catch (e) {
  out.findings.push({ kind: "pageerror", message: String(e?.message || e) });
  out.ok = false;
  try {
    await page.screenshot({ path: screenshotPath, fullPage: true });
    if (fs.existsSync(screenshotPath)) out.screenshotPath = screenshotPath;
  } catch {}
} finally {
  await browser.close().catch(() => {});
}

fs.writeFileSync(${JSON.stringify(path.join(screenshotDir, "_inspect_result.json"))}, JSON.stringify(out, null, 2));
console.log(JSON.stringify(out));
`;
  fs.writeFileSync(scriptPath, script, "utf-8");

  // Optionally ensure server is up — caller may already have started it
  let status = 0;
  try {
    status = await waitForHttp(url, 8_000);
    logParts.push(`server already up (HTTP ${status})`);
  } catch {
    // Try start production server in background
    const startCmd = opts.preferStart
      ? `npx next start -H 127.0.0.1 -p 3456`
      : `npx next dev -H 127.0.0.1 -p 3456`;
    logParts.push(`starting server: ${startCmd}`);
    const logFile = path.join(screenshotDir, "server.log");
    const child = spawn(process.env.SHELL || "/bin/zsh", ["-lc", startCmd], {
      cwd: opts.appDir,
      env: serverEnv(),
      stdio: ["ignore", "pipe", "pipe"],
      detached: true,
    });
    const logFd = fs.openSync(logFile, "a");
    child.stdout?.on("data", (d) => fs.writeSync(logFd, d));
    child.stderr?.on("data", (d) => fs.writeSync(logFd, d));
    child.unref();
    try {
      status = await waitForHttp(url, 90_000);
      logParts.push(`server ready HTTP ${status}`);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      findings.push({ kind: "http", message: msg });
      try {
        process.kill(-child.pid!, "SIGTERM");
      } catch {
        /* ignore */
      }
      return {
        ok: false,
        url,
        findings,
        log: logParts.join("\n"),
        summary: `Browser inspect failed — server not reachable at ${url}`,
      };
    }
  }

  const run = await runCmd(
    `node ${JSON.stringify(scriptPath)}`,
    opts.appDir,
    120_000,
  );
  logParts.push(run.stdout.slice(-2000));
  logParts.push(run.stderr.slice(-1000));

  // Parse JSON result from stdout (last JSON object)
  let parsed: BrowserInspectResult | null = null;
  try {
    const resultFile = path.join(screenshotDir, "_inspect_result.json");
    if (fs.existsSync(resultFile)) {
      parsed = JSON.parse(
        fs.readFileSync(resultFile, "utf-8"),
      ) as BrowserInspectResult;
    } else {
      const lines = run.stdout.trim().split("\n");
      const last = lines[lines.length - 1];
      parsed = JSON.parse(last) as BrowserInspectResult;
    }
  } catch {
    /* ignore */
  }

  if (parsed) {
    parsed.log = logParts.join("\n\n");
    const errCount = parsed.findings.filter(
      (f) => f.kind === "pageerror" || f.kind === "console" || f.kind === "http",
    ).length;
    parsed.summary = parsed.ok
      ? `Browser OK — ${parsed.title || url} (HTTP ${parsed.status ?? "?"})`
      : `Browser found ${errCount || parsed.findings.length} issue(s) at ${url}`;
    return parsed;
  }

  findings.push({
    kind: "pageerror",
    message: `Inspect script failed (exit ${run.code})`,
  });
  return {
    ok: false,
    url,
    findings,
    log: logParts.join("\n\n"),
    summary: `Browser inspect could not complete for ${url}`,
  };
}

/** Format findings for markdown reports */
export function formatBrowserFindings(r: BrowserInspectResult): string {
  const lines: string[] = [
    `## Browser inspection`,
    ``,
    `**URL:** ${r.url}`,
    `**Result:** ${r.ok ? "✅ OK" : "❌ Issues found"}`,
    r.title ? `**Title:** ${r.title}` : "",
    r.status != null ? `**HTTP:** ${r.status}` : "",
    r.screenshotPath ? `**Screenshot:** \`${r.screenshotPath}\`` : "",
    ``,
  ].filter(Boolean);

  if (r.findings.length) {
    lines.push(`### Findings`);
    for (const f of r.findings.slice(0, 40)) {
      lines.push(`- **${f.kind}:** ${f.message}`);
    }
    lines.push("");
  }
  if (r.bodySnippet) {
    lines.push(`### Visible text (snippet)`);
    lines.push("```");
    lines.push(r.bodySnippet.slice(0, 800));
    lines.push("```");
    lines.push("");
  }
  return lines.join("\n");
}
