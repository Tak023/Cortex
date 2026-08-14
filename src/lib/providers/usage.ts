/**
 * Provider usage / credits for Command Center cards (Claude, Grok, Hermes).
 *
 * Sources:
 * - Cortex local usage (always) — tokens & estimated $ from agents + usage log
 * - Claude Console session APIs (platform.claude.com) — live organization
 *   credits + spend this month (same data as the dashboard cards)
 * - Anthropic Admin API (ANTHROPIC_ADMIN_KEY) — token volume / cost reports
 * - xAI Management API (XAI_MANAGEMENT_KEY) — team prepaid balance & cycle spend
 * - Nous Portal (Hermes OAuth in ~/.hermes/auth.json; expired env JWTs are ignored)
 */

import { execFileSync } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";
import { getState } from "../store";
import { ensureSecretsLoaded } from "../env/secrets";

export type ProviderId = "claude" | "grok" | "hermes";

export type ProviderUsageCard = {
  id: ProviderId;
  label: string;
  /** Remaining prepaid / plan credits if known */
  creditsAvailable: number | null;
  creditsAvailableLabel: string;
  /** USD spent this calendar month */
  spentThisMonth: number | null;
  spentThisMonthLabel: string;
  /** Tokens this calendar month */
  tokensThisMonth: number | null;
  tokensThisMonthLabel: string;
  /** Where numbers came from */
  source:
    | "local"
    | "anthropic-admin"
    | "claude-console"
    | "xai-management"
    | "nous-portal"
    | "mixed"
    | "unavailable";
  detail?: string;
  /** Console / docs link */
  consoleUrl?: string;
  configured: boolean;
};

function startOfMonthUtc(): Date {
  const n = new Date();
  return new Date(Date.UTC(n.getUTCFullYear(), n.getUTCMonth(), 1, 0, 0, 0));
}

function endOfNextDayUtc(): Date {
  const n = new Date();
  return new Date(
    Date.UTC(n.getUTCFullYear(), n.getUTCMonth(), n.getUTCDate() + 1, 0, 0, 0),
  );
}

function formatUsd(n: number | null): string {
  if (n == null || !Number.isFinite(n)) return "—";
  if (n < 0.01 && n > 0) return `$${n.toFixed(4)}`;
  return `$${n.toFixed(2)}`;
}

function formatTokens(n: number | null): string {
  if (n == null || !Number.isFinite(n)) return "—";
  // Match Claude Console style (e.g. 107.1M)
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 10_000) return `${Math.round(n / 1000)}k`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return String(Math.round(n));
}

/** Agent ids that map into each provider bucket */
const PROVIDER_AGENTS: Record<ProviderId, string[]> = {
  claude: ["agent-claude-code"],
  grok: ["agent-grok"],
  hermes: [
    "agent-hermes",
    "agent-jarvis",
    "agent-jarvis-research",
    "agent-jarvis-code",
  ],
};

function localMonthUsage(provider: ProviderId): {
  tokens: number;
  costUsd: number;
} {
  const state = getState();
  const ids = new Set(PROVIDER_AGENTS[provider]);
  const monthStart = startOfMonthUtc().getTime();

  let tokens = 0;
  let costUsd = 0;

  for (const u of state.usage) {
    if (!ids.has(u.agentId)) continue;
    const t = Date.parse(u.createdAt);
    if (!Number.isFinite(t) || t < monthStart) continue;
    tokens += u.tokens || 0;
    costUsd += u.costUsd || 0;
  }

  // Lifetime agent counters as fallback when no monthly usage rows yet
  if (tokens === 0) {
    for (const a of state.agents) {
      if (!ids.has(a.id)) continue;
      tokens += a.metrics.tokensUsed || 0;
    }
  }

  return { tokens, costUsd };
}

type AnthropicMonth = {
  tokens: number;
  costUsd: number;
  ok: boolean;
  detail?: string;
  orgName?: string;
  orgId?: string;
  /** True when Admin API answered but org has no billed usage this month */
  emptyOrgUsage?: boolean;
  /** Live organization credits (Console prepaid/credits) */
  creditsAvailable?: number | null;
  /** Prefer Console session over Admin-only for spend/credits */
  consoleLive?: boolean;
};

type ClaudeConsoleAuth = {
  sessionKey: string;
  cookieHeader: string;
  orgId: string;
};

/**
 * Auth for platform.claude.com dashboard APIs (same cards as the Console UI).
 *
 * Priority:
 * 1. CLAUDE_SESSION_KEY / ANTHROPIC_SESSION_KEY env (sk-ant-sid…)
 * 2. Firefox cookies (sessionKey / sessionKeyV3 for platform.claude.com)
 *
 * These are not the Admin API key — they are the browser session used while
 * logged into platform.claude.com.
 */
function loadClaudeConsoleAuth(): ClaudeConsoleAuth | null {
  ensureSecretsLoaded();
  const orgId =
    process.env.ANTHROPIC_ORG_ID?.trim() ||
    process.env.CLAUDE_ORG_ID?.trim() ||
    "48ab309f-6f9f-45c7-a873-928539d1bc70";

  const envSession =
    process.env.CLAUDE_SESSION_KEY?.trim() ||
    process.env.ANTHROPIC_SESSION_KEY?.trim() ||
    process.env.CLAUDE_CONSOLE_SESSION?.trim();

  if (envSession?.startsWith("sk-ant-sid")) {
    return {
      sessionKey: envSession,
      cookieHeader: `sessionKey=${envSession}; sessionKeyV3=${envSession}`,
      orgId,
    };
  }

  // Firefox stores cookies unencrypted — usable for local desktop Cortex
  try {
    const profilesRoot = path.join(
      os.homedir(),
      "Library/Application Support/Firefox/Profiles",
    );
    if (!fs.existsSync(profilesRoot)) return null;
    const profiles = fs
      .readdirSync(profilesRoot, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => path.join(profilesRoot, d.name));

    for (const prof of profiles) {
      const dbPath = path.join(prof, "cookies.sqlite");
      if (!fs.existsSync(dbPath)) continue;
      const tmp = path.join(
        os.tmpdir(),
        `cortex-ff-cookies-${process.pid}-${Date.now()}.sqlite`,
      );
      try {
        fs.copyFileSync(dbPath, tmp);
        // Use system python — avoids Firefox lock + works without node:sqlite
        const script = `
import sqlite3, json
conn = sqlite3.connect(${JSON.stringify(tmp)})
cur = conn.cursor()
cur.execute("""
  SELECT host, name, value FROM moz_cookies
  WHERE host LIKE '%claude%' OR host LIKE '%anthropic%'
""")
rows = [{"host": h, "name": n, "value": v} for h,n,v in cur.fetchall()]
conn.close()
print(json.dumps(rows))
`;
        const out = execFileSync("python3", ["-c", script], {
          encoding: "utf8",
          timeout: 5000,
          maxBuffer: 2_000_000,
        });
        const rows = JSON.parse(out) as Array<{
          host: string;
          name: string;
          value: string;
        }>;
        let sessionKey = "";
        const cookieParts: string[] = [];
        for (const r of rows) {
          if (!r.value || r.value === '""') continue;
          cookieParts.push(`${r.name}=${r.value}`);
          if (
            (r.name === "sessionKey" || r.name === "sessionKeyV3") &&
            r.value.startsWith("sk-ant-sid")
          ) {
            // Prefer platform.claude.com host when present
            if (
              r.host.includes("platform.claude.com") ||
              !sessionKey
            ) {
              sessionKey = r.value;
            }
          }
        }
        if (sessionKey) {
          return {
            sessionKey,
            cookieHeader: cookieParts.join("; "),
            orgId,
          };
        }
      } finally {
        try {
          fs.unlinkSync(tmp);
        } catch {
          /* ignore */
        }
      }
    }
  } catch {
    /* no browser session */
  }
  return null;
}

/**
 * Live dashboard cards from platform.claude.com (requires Console login session):
 * - GET /api/organizations/{org}/prepaid/credits  → organization credits
 * - GET /api/organizations/{org}/current_spend    → spend this month
 */
async function fetchClaudeConsoleDashboard(
  auth: ClaudeConsoleAuth,
): Promise<{
  creditsUsd: number | null;
  spentUsd: number | null;
  ok: boolean;
  detail?: string;
}> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${auth.sessionKey}`,
    Accept: "application/json",
    Cookie: auth.cookieHeader,
    Origin: "https://platform.claude.com",
    Referer: "https://platform.claude.com/dashboard",
    "User-Agent": "Cortex/0.2 (provider-usage; +local)",
  };
  const base = `https://platform.claude.com/api/organizations/${encodeURIComponent(auth.orgId)}`;

  let creditsUsd: number | null = null;
  let spentUsd: number | null = null;
  let ok = false;
  let detail: string | undefined;

  try {
    const res = await fetch(`${base}/prepaid/credits`, {
      headers,
      signal: AbortSignal.timeout(12_000),
      cache: "no-store",
    });
    if (res.ok) {
      const json = (await res.json()) as {
        amount?: number;
        balance?: { credits?: { amount_minor?: number; exponent?: number } };
        balance_credits?: number;
      };
      // amount is minor units (cents), e.g. 2493 → $24.93
      if (typeof json.amount === "number" && Number.isFinite(json.amount)) {
        creditsUsd = json.amount / 100;
      } else if (json.balance?.credits?.amount_minor != null) {
        const exp = json.balance.credits.exponent ?? 2;
        creditsUsd = json.balance.credits.amount_minor / 10 ** exp;
      }
      ok = true;
    } else {
      detail = `Console credits API ${res.status}${
        res.status === 401 || res.status === 403
          ? " — log into platform.claude.com in Firefox (or set CLAUDE_SESSION_KEY)"
          : ""
      }`;
    }
  } catch (e) {
    detail = e instanceof Error ? e.message : String(e);
  }

  try {
    const res = await fetch(`${base}/current_spend`, {
      headers,
      signal: AbortSignal.timeout(12_000),
      cache: "no-store",
    });
    if (res.ok) {
      const json = (await res.json()) as { amount?: number; resets_at?: string };
      // amount is cents, e.g. 15107 → $151.07
      if (typeof json.amount === "number" && Number.isFinite(json.amount)) {
        spentUsd = json.amount / 100;
      }
      ok = true;
    } else if (!detail) {
      detail = `Console spend API ${res.status}`;
    }
  } catch (e) {
    if (!detail) detail = e instanceof Error ? e.message : String(e);
  }

  return { creditsUsd, spentUsd, ok, detail };
}

/** Sum token fields from a Usage API result row (matches Console dashboard volume). */
function sumAnthropicUsageTokens(r: {
  uncached_input_tokens?: number;
  cache_read_input_tokens?: number;
  cache_creation_input_tokens?: number;
  output_tokens?: number;
  cache_creation?: {
    ephemeral_1h_input_tokens?: number;
    ephemeral_5m_input_tokens?: number;
  };
}): number {
  const nested = r.cache_creation || {};
  return (
    (r.uncached_input_tokens || 0) +
    (r.cache_read_input_tokens || 0) +
    (r.cache_creation_input_tokens || 0) +
    (nested.ephemeral_1h_input_tokens || 0) +
    (nested.ephemeral_5m_input_tokens || 0) +
    (r.output_tokens || 0)
  );
}

/**
 * Paginate Anthropic Admin report endpoints.
 * Default limit is only 7 daily buckets — without limit=31 the early days of the
 * month return and later high-usage days are dropped (dashboard looked empty).
 */
async function fetchAnthropicReportPages(
  path: string,
  search: Record<string, string>,
  headers: Record<string, string>,
): Promise<Array<{ results?: unknown[] }>> {
  const buckets: Array<{ results?: unknown[] }> = [];
  let page: string | undefined;
  for (let i = 0; i < 20; i++) {
    const url = new URL(`https://api.anthropic.com${path}`);
    for (const [k, v] of Object.entries(search)) {
      url.searchParams.set(k, v);
    }
    // Full calendar month needs up to 31 daily buckets (API default is 7)
    if (!url.searchParams.has("limit")) {
      url.searchParams.set("limit", "31");
    }
    if (page) url.searchParams.set("page", page);

    const res = await fetch(url.toString(), {
      headers,
      signal: AbortSignal.timeout(20_000),
      cache: "no-store",
    });
    if (!res.ok) {
      throw new Error(`${path} ${res.status}`);
    }
    const json = (await res.json()) as {
      data?: Array<{ results?: unknown[] }>;
      has_more?: boolean;
      next_page?: string | null;
    };
    buckets.push(...(json.data || []));
    if (!json.has_more || !json.next_page) break;
    page = json.next_page;
  }
  return buckets;
}

/**
 * Claude Console live data for the provider card.
 *
 * Primary (matches platform.claude.com/dashboard cards exactly):
 * - Organization credits → session API /prepaid/credits
 * - Spend this month     → session API /current_spend
 *
 * Secondary (Admin API key):
 * - Token volume + cost_report fallback when session is unavailable
 *
 * Session auth: Firefox login to platform.claude.com, or CLAUDE_SESSION_KEY.
 */
async function fetchAnthropicMonth(): Promise<AnthropicMonth> {
  ensureSecretsLoaded();
  const adminKey =
    process.env.ANTHROPIC_ADMIN_KEY?.trim() ||
    process.env.ANTHROPIC_ADMIN_API_KEY?.trim();
  const consoleAuth = loadClaudeConsoleAuth();

  if (!adminKey && !consoleAuth) {
    return {
      tokens: 0,
      costUsd: 0,
      ok: false,
      detail:
        "Set ANTHROPIC_ADMIN_KEY and/or log into platform.claude.com in Firefox (or CLAUDE_SESSION_KEY) for live Claude Console data",
    };
  }

  const starting = startOfMonthUtc().toISOString();
  const ending = endOfNextDayUtc().toISOString();
  const adminHeaders = adminKey
    ? {
        "anthropic-version": "2023-06-01",
        "x-api-key": adminKey,
        "User-Agent": "Cortex/0.2 (provider-usage; +local)",
      }
    : null;

  let tokens = 0;
  let costUsd = 0;
  let creditsAvailable: number | null = null;
  let ok = false;
  let consoleLive = false;
  let detail: string | undefined;
  let orgName: string | undefined;
  let orgId =
    process.env.ANTHROPIC_ORG_ID?.trim() ||
    process.env.CLAUDE_ORG_ID?.trim() ||
    consoleAuth?.orgId;

  // 1) Live dashboard cards (credits + spend) — same source as the Console UI
  if (consoleAuth) {
    const dash = await fetchClaudeConsoleDashboard(consoleAuth);
    if (dash.ok) {
      if (dash.creditsUsd != null) creditsAvailable = dash.creditsUsd;
      if (dash.spentUsd != null) costUsd = dash.spentUsd;
      ok = true;
      consoleLive = true;
      orgId = consoleAuth.orgId;
    } else if (dash.detail) {
      detail = dash.detail;
    }
  }

  // 2) Org name via Admin key (optional)
  if (adminHeaders) {
    try {
      const meRes = await fetch(
        "https://api.anthropic.com/v1/organizations/me",
        {
          headers: adminHeaders,
          signal: AbortSignal.timeout(10_000),
          cache: "no-store",
        },
      );
      if (meRes.ok) {
        const me = (await meRes.json()) as { id?: string; name?: string };
        orgName = me.name || undefined;
        if (me.id) orgId = me.id;
      }
    } catch {
      /* optional */
    }
  }

  // 3) Token volume (+ Admin cost as fallback if Console spend missing)
  if (adminHeaders) {
    try {
      const buckets = await fetchAnthropicReportPages(
        "/v1/organizations/usage_report/messages",
        {
          starting_at: starting,
          ending_at: ending,
          bucket_width: "1d",
          limit: "31",
        },
        adminHeaders,
      );
      for (const bucket of buckets) {
        for (const raw of bucket.results || []) {
          if (!raw || typeof raw !== "object") continue;
          tokens += sumAnthropicUsageTokens(
            raw as Parameters<typeof sumAnthropicUsageTokens>[0],
          );
        }
      }
      ok = true;
    } catch (e) {
      if (!detail) detail = e instanceof Error ? e.message : String(e);
    }

    if (!consoleLive || costUsd <= 0) {
      try {
        const buckets = await fetchAnthropicReportPages(
          "/v1/organizations/cost_report",
          {
            starting_at: starting,
            ending_at: ending,
            bucket_width: "1d",
            limit: "31",
          },
          adminHeaders,
        );
        let adminCost = 0;
        for (const bucket of buckets) {
          for (const raw of bucket.results || []) {
            if (!raw || typeof raw !== "object") continue;
            const r = raw as { amount?: string | number };
            const cents =
              typeof r.amount === "string"
                ? Number(r.amount)
                : Number(r.amount ?? 0);
            if (Number.isFinite(cents)) adminCost += cents / 100;
          }
        }
        if (!consoleLive) costUsd = adminCost;
        ok = true;
      } catch (e) {
        if (!detail) detail = e instanceof Error ? e.message : String(e);
      }
    }
  }

  const emptyOrgUsage = ok && tokens === 0 && costUsd === 0;
  const orgLabel = orgName ? `“${orgName}”` : "Console org";
  if (ok) {
    if (consoleLive) {
      detail = `Live from platform.claude.com/dashboard (${orgLabel}) · prepaid credits + current spend`;
    } else if (emptyOrgUsage) {
      detail = `Claude ${orgLabel}: Admin API returned $0 this month. Log into platform.claude.com in Firefox for live credits/spend.`;
    } else {
      detail = `Live Claude Admin Usage & Cost for ${orgLabel} (credits need Console session)`;
    }
  }

  return {
    tokens,
    costUsd,
    ok,
    detail,
    orgName,
    orgId,
    emptyOrgUsage,
    creditsAvailable,
    consoleLive,
  };
}

function creditsFromEnv(provider: ProviderId): number | null {
  const map: Record<ProviderId, string[]> = {
    claude: ["CLAUDE_CREDITS_AVAILABLE", "ANTHROPIC_CREDITS_AVAILABLE"],
    grok: ["GROK_CREDITS_AVAILABLE", "XAI_CREDITS_AVAILABLE"],
    hermes: ["HERMES_CREDITS_AVAILABLE"],
  };
  for (const k of map[provider]) {
    const v = process.env[k]?.trim();
    if (v && Number.isFinite(Number(v))) return Number(v);
  }
  return null;
}

/** USD cents string → USD number. Accounting vals may be negative for credits. */
function centsValToUsd(
  val: string | number | undefined | null,
  abs = true,
): number {
  if (val == null || val === "") return 0;
  const n = typeof val === "string" ? Number(val) : val;
  if (!Number.isFinite(n)) return 0;
  const usd = n / 100;
  return abs ? Math.abs(usd) : usd;
}

type XaiMonth = {
  creditsAvailable: number | null;
  spentThisMonth: number | null;
  tokensThisMonth: number | null;
  ok: boolean;
  detail?: string;
  teamId?: string;
};

/**
 * xAI Management API (billing) — requires a *management* key, not the chat API key.
 * Docs: https://docs.x.ai/developers/rest-api-reference/management/billing
 *
 * Accounting: prepaid balances are often negative cents (e.g. "-2000" = $20.00).
 * SPEND amounts are positive cents. Invoice preview fields:
 *   prepaidCredits      — prepaid wallet (purchase side; not always "remaining")
 *   prepaidCreditsUsed  — prepaid consumed this cycle
 * Console remaining ≈ |prepaidCredits| − |prepaidCreditsUsed|
 */
async function fetchXaiMonth(): Promise<XaiMonth> {
  ensureSecretsLoaded();
  const mgmtKey =
    process.env.XAI_MANAGEMENT_KEY?.trim() ||
    process.env.XAI_MANAGEMENT_API_KEY?.trim() ||
    process.env.XAI_MGMT_KEY?.trim();
  const teamId =
    process.env.XAI_TEAM_ID?.trim() ||
    process.env.XAI_TEAM?.trim() ||
    "a8b8b3bc-6273-4c12-ad6c-d03f0df486f4";

  if (!mgmtKey) {
    return {
      creditsAvailable: null,
      spentThisMonth: null,
      tokensThisMonth: null,
      ok: false,
      detail:
        "Set XAI_MANAGEMENT_KEY (management key from console.x.ai — not the chat API key) for live Grok credits.",
      teamId,
    };
  }

  const base = "https://management-api.x.ai/v1";
  const headers = {
    Authorization: `Bearer ${mgmtKey}`,
    "Content-Type": "application/json",
    "User-Agent": "Cortex/0.2 (provider-usage; +local)",
  };

  let creditsAvailable: number | null = null;
  let spentThisMonth: number | null = null;
  let tokensThisMonth: number | null = null;
  let ok = false;
  let detail: string | undefined;
  let prepaidWalletUsd: number | null = null; // |purchases/total|
  let prepaidUsedUsd: number | null = null;

  // 1) Invoice preview — best match for console remaining / cycle spend
  try {
    const prevRes = await fetch(
      `${base}/billing/teams/${encodeURIComponent(teamId)}/postpaid/invoice/preview`,
      {
        headers,
        signal: AbortSignal.timeout(12_000),
        cache: "no-store",
      },
    );
    if (prevRes.ok) {
      const json = (await prevRes.json()) as {
        coreInvoice?: {
          prepaidCredits?: { val?: string };
          prepaidCreditsUsed?: { val?: string };
          amountAfterVat?: string;
          amountBeforeVat?: string;
          totalWithCorr?: { val?: string };
          lines?: Array<{
            numUnits?: string;
            unitType?: string;
            amount?: string;
          }>;
        };
        // Some deployments flatten coreInvoice fields to the root
        prepaidCredits?: { val?: string };
        prepaidCreditsUsed?: { val?: string };
        amountAfterVat?: string;
        amountBeforeVat?: string;
        totalWithCorr?: { val?: string };
        lines?: Array<{
          numUnits?: string;
          unitType?: string;
          amount?: string;
        }>;
      };
      const core = json.coreInvoice ?? json;
      const prepaidRaw =
        core.prepaidCredits?.val ?? json.prepaidCredits?.val;
      const usedRaw =
        core.prepaidCreditsUsed?.val ?? json.prepaidCreditsUsed?.val;

      if (prepaidRaw != null && prepaidRaw !== "") {
        prepaidWalletUsd = centsValToUsd(prepaidRaw, true);
      }
      if (usedRaw != null && usedRaw !== "") {
        prepaidUsedUsd = centsValToUsd(usedRaw, true);
      }

      // Postpaid (cash) portion of the cycle — usually 0 while prepaid remains
      const postpaid = centsValToUsd(
        core.amountAfterVat ??
          core.amountBeforeVat ??
          json.amountAfterVat ??
          json.amountBeforeVat,
        true,
      );
      // totalWithCorr is often cycle usage in cents (e.g. "1" = $0.01)
      const totalCorr = centsValToUsd(
        core.totalWithCorr?.val ?? json.totalWithCorr?.val,
        true,
      );

      // Spent this cycle: prefer prepaid used + postpaid; fall back to line totals
      let cycleSpend =
        (prepaidUsedUsd ?? 0) + (Number.isFinite(postpaid) ? postpaid : 0);
      if (cycleSpend <= 0 && totalCorr > 0) cycleSpend = totalCorr;
      if (cycleSpend <= 0 && core.lines?.length) {
        let lineCents = 0;
        for (const line of core.lines || []) {
          const a = Number(line.amount || 0);
          if (Number.isFinite(a)) lineCents += Math.abs(a);
        }
        if (lineCents > 0) cycleSpend = lineCents / 100;
      }
      if (cycleSpend > 0) spentThisMonth = cycleSpend;

      // Remaining credits (matches console): wallet − used
      if (prepaidWalletUsd != null) {
        const used = prepaidUsedUsd ?? 0;
        creditsAvailable = Math.max(0, prepaidWalletUsd - used);
      }

      // Token estimate from line units
      let units = 0;
      for (const line of core.lines || json.lines || []) {
        const n = Number(line.numUnits || 0);
        if (Number.isFinite(n)) units += n;
      }
      if (units > 0) tokensThisMonth = units;

      ok = true;
      detail = `Live from xAI Management API (team ${teamId.slice(0, 8)}…)`;
    } else {
      const body = await prevRes.text().catch(() => "");
      detail = `xAI invoice preview ${prevRes.status}${
        body.includes("management key")
          ? " — use a management key, not XAI_API_KEY"
          : ""
      }`;
    }
  } catch (e) {
    detail = e instanceof Error ? e.message : String(e);
  }

  // 2) Prepaid ledger — fill gaps; sum SPEND for the month
  try {
    const balRes = await fetch(
      `${base}/billing/teams/${encodeURIComponent(teamId)}/prepaid/balance`,
      {
        headers,
        signal: AbortSignal.timeout(12_000),
        cache: "no-store",
      },
    );
    if (balRes.ok) {
      const json = (await balRes.json()) as {
        total?: { val?: string };
        changes?: Array<{
          changeOrigin?: string;
          amount?: { val?: string };
          createTime?: string;
          createTs?: string;
        }>;
      };
      const totalAbs = centsValToUsd(json.total?.val, true);
      if (prepaidWalletUsd == null && totalAbs > 0) {
        prepaidWalletUsd = totalAbs;
      }

      const monthStart = startOfMonthUtc().getTime();
      let spendCents = 0;
      let purchaseCents = 0;
      for (const ch of json.changes || []) {
        const cents = Math.abs(Number(ch.amount?.val || 0));
        const origin = (ch.changeOrigin || "").toUpperCase();
        if (origin === "PURCHASE" || origin === "AUTO_PURCHASE") {
          purchaseCents += cents;
        }
        if (origin !== "SPEND") continue;
        const ts = Date.parse(ch.createTs || ch.createTime || "");
        if (!Number.isFinite(ts) || ts < monthStart) continue;
        spendCents += cents;
      }

      // If balance total still equals purchases (no SPEND rows yet), don't
      // treat total as remaining — subtract known cycle spend instead.
      if (creditsAvailable == null && prepaidWalletUsd != null) {
        const used =
          prepaidUsedUsd ??
          (spendCents > 0 ? spendCents / 100 : spentThisMonth ?? 0);
        creditsAvailable = Math.max(0, prepaidWalletUsd - used);
      } else if (creditsAvailable == null && totalAbs > 0) {
        // Only trust |total| as remaining when SPEND entries exist in ledger
        // (total already net of spend) or there is no known cycle spend.
        if (spendCents > 0 || (spentThisMonth == null || spentThisMonth === 0)) {
          creditsAvailable =
            spendCents > 0
              ? totalAbs
              : Math.max(0, totalAbs - (spentThisMonth ?? 0));
        }
      }

      if ((spentThisMonth == null || spentThisMonth === 0) && spendCents > 0) {
        spentThisMonth = spendCents / 100;
      }
      // purchaseCents unused except for future diagnostics
      void purchaseCents;

      ok = true;
      if (!detail) {
        detail = `Live from xAI Management API (team ${teamId.slice(0, 8)}…)`;
      }
    } else if (!detail) {
      const body = await balRes.text().catch(() => "");
      detail = `xAI balance ${balRes.status}${
        body.includes("management key")
          ? " — use a management key, not XAI_API_KEY"
          : ""
      }`;
    }
  } catch (e) {
    if (!detail) detail = e instanceof Error ? e.message : String(e);
  }

  // 3) Usage analytics — only when invoice/ledger did not give cycle spend
  if (spentThisMonth == null || spentThisMonth === 0) {
    try {
      const now = new Date();
      const y = now.getUTCFullYear();
      const m = String(now.getUTCMonth() + 1).padStart(2, "0");
      const lastDay = new Date(
        Date.UTC(y, now.getUTCMonth() + 1, 0),
      ).getUTCDate();
      const usageRes = await fetch(
        `${base}/billing/teams/${encodeURIComponent(teamId)}/usage`,
        {
          method: "POST",
          headers,
          body: JSON.stringify({
            analyticsRequest: {
              timeRange: {
                startTime: `${y}-${m}-01 00:00:00`,
                endTime: `${y}-${m}-${String(lastDay).padStart(2, "0")} 23:59:59`,
                timezone: "Etc/UTC",
              },
              timeUnit: "TIME_UNIT_NONE",
              values: [{ name: "usd", aggregation: "AGGREGATION_SUM" }],
              groupBy: [],
              filters: [],
            },
          }),
          signal: AbortSignal.timeout(12_000),
          cache: "no-store",
        },
      );
      if (usageRes.ok) {
        const json = (await usageRes.json()) as {
          timeSeries?: Array<{
            dataPoints?: Array<{ values?: number[] }>;
          }>;
        };
        let usdSum = 0;
        for (const series of json.timeSeries || []) {
          for (const dp of series.dataPoints || []) {
            const vals = dp.values || [];
            if (typeof vals[0] === "number") usdSum += vals[0];
          }
        }
        if (usdSum > 0) {
          spentThisMonth = usdSum;
          ok = true;
        }
      }
    } catch {
      /* optional */
    }
  }

  // Remaining = prepaid wallet − cycle spend (matches console.x.ai)
  if (prepaidWalletUsd != null) {
    const used = spentThisMonth ?? prepaidUsedUsd ?? 0;
    creditsAvailable = Math.max(0, prepaidWalletUsd - used);
  }

  return {
    creditsAvailable,
    spentThisMonth,
    tokensThisMonth,
    ok,
    detail,
    teamId,
  };
}

// ---------------------------------------------------------------------------
// Nous Portal (Hermes) — org billing for portal.nousresearch.com
// ---------------------------------------------------------------------------

const DEFAULT_NOUS_PORTAL = "https://portal.nousresearch.com";
const DEFAULT_NOUS_ORG_SLUG = "b9365baa";

type HermesAuthStore = {
  accessToken: string;
  refreshToken?: string;
  clientId: string;
  portalBaseUrl: string;
  authPath?: string;
  expiresAt?: string;
};

type NousAuthStatus = {
  auth: HermesAuthStore | null;
  /** Why OAuth is missing / unusable (from Hermes last_auth_error) */
  reason?: string;
};

type NousMonth = {
  creditsAvailable: number | null;
  spentThisMonth: number | null;
  tokensThisMonth: number | null;
  ok: boolean;
  detail?: string;
  orgSlug?: string;
  plan?: string;
};

function moneyNum(v: unknown): number | null {
  if (v == null || v === "") return null;
  const n = typeof v === "number" ? v : Number(String(v).trim());
  return Number.isFinite(n) ? n : null;
}

function jwtExpMs(token: string): number | null {
  try {
    const parts = token.split(".");
    if (parts.length < 2) return null;
    const b64 = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    const pad = b64 + "=".repeat((4 - (b64.length % 4)) % 4);
    const json = JSON.parse(Buffer.from(pad, "base64").toString("utf8")) as {
      exp?: number;
    };
    return typeof json.exp === "number" ? json.exp * 1000 : null;
  } catch {
    return null;
  }
}

function hermesAuthJsonPath(): string {
  return (
    process.env.HERMES_AUTH_PATH?.trim() ||
    path.join(os.homedir(), ".hermes", "auth.json")
  );
}

function portalBaseFromEnv(): string {
  return (
    process.env.HERMES_PORTAL_BASE_URL?.trim() ||
    process.env.NOUS_PORTAL_BASE_URL?.trim() ||
    DEFAULT_NOUS_PORTAL
  ).replace(/\/$/, "");
}

/** JWT with a past/near-past exp is unusable. Opaque keys (sk-…) stay valid. */
function tokenExpired(token: string, expiresAt?: string, skewMs = 5_000): boolean {
  const expMs = jwtExpMs(token) ?? (expiresAt ? Date.parse(expiresAt) : null);
  return expMs != null && Number.isFinite(expMs) && expMs <= Date.now() + skewMs;
}

let lastHermesRefreshAt = 0;
const HERMES_REFRESH_COOLDOWN_MS = 30_000;

/**
 * Ask Hermes (the token owner) to refresh Nous OAuth.
 * Never call Portal /api/oauth/token from Cortex — refresh tokens are
 * single-use and a dual writer revokes the whole session.
 */
function askHermesToRefreshNous(): boolean {
  if (Date.now() - lastHermesRefreshAt < HERMES_REFRESH_COOLDOWN_MS) {
    return false;
  }
  lastHermesRefreshAt = Date.now();
  const hermesBin =
    process.env.HERMES_BIN?.trim() ||
    path.join(os.homedir(), ".local", "bin", "hermes");
  const bin = fs.existsSync(hermesBin) ? hermesBin : "hermes";
  try {
    execFileSync(bin, ["auth", "status", "nous"], {
      encoding: "utf8",
      timeout: 12_000,
      stdio: ["ignore", "pipe", "pipe"],
    });
    return true;
  } catch {
    return false;
  }
}

type NousAuthFile = {
  providers?: {
    nous?: {
      access_token?: string;
      refresh_token?: string;
      client_id?: string;
      portal_base_url?: string;
      expires_at?: string;
      agent_key?: string;
      last_auth_error?: {
        code?: string;
        message?: string;
        relogin_required?: boolean;
      };
    };
  };
};

function readHermesAuthFile(): NousAuthStatus {
  const authPath = hermesAuthJsonPath();
  try {
    if (!fs.existsSync(authPath)) {
      return {
        auth: null,
        reason:
          "No ~/.hermes/auth.json — run `hermes portal login` for live Nous credits.",
      };
    }
    const raw = JSON.parse(fs.readFileSync(authPath, "utf8")) as NousAuthFile;
    const nous = raw.providers?.nous;
    const access =
      nous?.access_token?.trim() || nous?.agent_key?.trim() || "";
    const err = nous?.last_auth_error;

    if (!access) {
      if (err?.relogin_required || err?.code === "invalid_grant") {
        return {
          auth: null,
          reason:
            "Nous OAuth expired (refresh token rejected). Run `hermes portal login` to restore Hermes credits.",
        };
      }
      return {
        auth: null,
        reason:
          "Hermes is not logged into Nous Portal. Run `hermes portal login` for live credits.",
      };
    }

    if (tokenExpired(access, nous?.expires_at)) {
      return {
        auth: null,
        reason:
          "Nous access token expired. Run `hermes portal login` (or use Hermes once) to refresh credits.",
      };
    }

    return {
      auth: {
        accessToken: access,
        refreshToken: nous?.refresh_token?.trim() || undefined,
        clientId: nous?.client_id?.trim() || "hermes-cli",
        portalBaseUrl: (
          nous?.portal_base_url?.trim() || portalBaseFromEnv()
        ).replace(/\/$/, ""),
        authPath,
        expiresAt: nous?.expires_at,
      },
    };
  } catch {
    return {
      auth: null,
      reason: "Could not read ~/.hermes/auth.json for Nous Portal credentials.",
    };
  }
}

/**
 * Read Nous OAuth from Hermes CLI auth store (~/.hermes/auth.json), then a
 * still-valid env token. Short-lived JWTs must never win over a live Hermes
 * login — a stale NOUS_PORTAL_TOKEN is why the Hermes card can show "—".
 *
 * Cortex does **not** POST to /api/oauth/token. Refresh-token rotation is
 * owned by `hermes auth status nous`.
 */
function loadHermesAuth(): NousAuthStatus {
  ensureSecretsLoaded();

  const envToken =
    process.env.NOUS_PORTAL_TOKEN?.trim() ||
    process.env.HERMES_PORTAL_TOKEN?.trim() ||
    process.env.NOUS_ACCESS_TOKEN?.trim();
  const envUsable = Boolean(envToken && !tokenExpired(envToken));

  let file = readHermesAuthFile();
  if (!file.auth && file.reason?.includes("expired")) {
    askHermesToRefreshNous();
    file = readHermesAuthFile();
  }

  if (file.auth) return file;

  if (envUsable && envToken) {
    return {
      auth: {
        accessToken: envToken,
        clientId: process.env.NOUS_CLIENT_ID?.trim() || "hermes-cli",
        portalBaseUrl: portalBaseFromEnv(),
      },
    };
  }

  if (envToken && !envUsable) {
    return {
      auth: null,
      reason:
        file.reason ||
        "Stale NOUS_PORTAL_TOKEN ignored (JWT expired). Hermes auth.json is the live source.",
    };
  }

  return file;
}

/**
 * Local Hermes Agent dashboard (default http://127.0.0.1:9119).
 * Uses the injected session token from the SPA HTML — same auth the UI uses.
 *
 * - GET /api/analytics/usage?days=N → local token volume + estimated cost
 * - GET /api/portal → whether Nous OAuth is linked
 *
 * Complements portal billing when OAuth is available; alone fills tokens/spend
 * from Hermes local session analytics (registered dashboard OAuth client is
 * for dashboard login, not credit balance).
 */
async function fetchHermesLocalDashboard(): Promise<{
  tokens: number | null;
  spentUsd: number | null;
  portalLoggedIn: boolean | null;
  ok: boolean;
  detail?: string;
  baseUrl?: string;
}> {
  const base = (
    process.env.HERMES_DASHBOARD_URL?.trim() ||
    process.env.HERMES_LOCAL_DASHBOARD_URL?.trim() ||
    "http://127.0.0.1:9119"
  ).replace(/\/$/, "");

  try {
    const homeRes = await fetch(`${base}/`, {
      signal: AbortSignal.timeout(4_000),
      cache: "no-store",
    });
    if (!homeRes.ok) {
      return {
        tokens: null,
        spentUsd: null,
        portalLoggedIn: null,
        ok: false,
        detail: `Hermes dashboard ${homeRes.status} at ${base}`,
      };
    }
    const html = await homeRes.text();
    const m = html.match(/__HERMES_SESSION_TOKEN__="([^"]+)"/);
    const session = m?.[1];
    if (!session) {
      return {
        tokens: null,
        spentUsd: null,
        portalLoggedIn: null,
        ok: false,
        detail: "Hermes dashboard running but no session token found",
        baseUrl: base,
      };
    }

    const headers = {
      Accept: "application/json",
      Authorization: `Bearer ${session}`,
      "User-Agent": "Cortex/0.2 (provider-usage; +local)",
    };

    let portalLoggedIn: boolean | null = null;
    try {
      const pRes = await fetch(`${base}/api/portal`, {
        headers,
        signal: AbortSignal.timeout(6_000),
        cache: "no-store",
      });
      if (pRes.ok) {
        const p = (await pRes.json()) as { logged_in?: boolean };
        portalLoggedIn = Boolean(p.logged_in);
      }
    } catch {
      /* optional */
    }

    // Calendar month from daily buckets (Hermes stores local session analytics)
    const days = Math.min(
      62,
      Math.max(
        7,
        new Date().getUTCDate() + 1, // days so far this month + buffer
      ),
    );
    const uRes = await fetch(`${base}/api/analytics/usage?days=${days}`, {
      headers,
      signal: AbortSignal.timeout(10_000),
      cache: "no-store",
    });
    if (!uRes.ok) {
      return {
        tokens: null,
        spentUsd: null,
        portalLoggedIn,
        ok: false,
        detail: `Hermes analytics ${uRes.status}`,
        baseUrl: base,
      };
    }
    const usage = (await uRes.json()) as {
      daily?: Array<{
        day?: string;
        input_tokens?: number;
        output_tokens?: number;
        cache_read_tokens?: number;
        reasoning_tokens?: number;
        estimated_cost?: number;
        actual_cost?: number;
      }>;
    };
    const monthPrefix = `${new Date().getUTCFullYear()}-${String(new Date().getUTCMonth() + 1).padStart(2, "0")}`;
    let tokens = 0;
    let spentUsd = 0;
    for (const d of usage.daily || []) {
      if (!String(d.day || "").startsWith(monthPrefix)) continue;
      tokens +=
        (d.input_tokens || 0) +
        (d.output_tokens || 0) +
        (d.cache_read_tokens || 0) +
        (d.reasoning_tokens || 0);
      spentUsd += Number(d.actual_cost || 0) || Number(d.estimated_cost || 0) || 0;
    }

    return {
      tokens: tokens > 0 ? tokens : null,
      spentUsd: spentUsd > 0 ? spentUsd : null,
      portalLoggedIn,
      ok: true,
      baseUrl: base,
      detail:
        portalLoggedIn === false
          ? `Hermes local dashboard (${base}) — Nous not linked; showing local analytics. Run portal login for subscription credits.`
          : `Hermes local dashboard (${base})`,
    };
  } catch (e) {
    return {
      tokens: null,
      spentUsd: null,
      portalLoggedIn: null,
      ok: false,
      detail: e instanceof Error ? e.message : String(e),
    };
  }
}

/**
 * Hermes / Nous usage for the Command Center card.
 *
 * Sources (best available):
 * 1. Local Hermes dashboard (registered OAuth client / hermes dashboard :9119)
 *    — tokens + estimated spend from session analytics
 * 2. Nous Portal OAuth (auth.json or NOUS_PORTAL_TOKEN)
 *    — subscription credits remaining + plan spend
 *
 * Endpoints (Portal Bearer OAuth):
 * - GET /api/oauth/account
 * - GET /api/billing/state
 * - GET /api/billing/subscription
 */
async function fetchNousMonth(): Promise<NousMonth> {
  ensureSecretsLoaded();
  const localDash = await fetchHermesLocalDashboard();
  const { auth, reason } = loadHermesAuth();
  const orgSlug =
    process.env.NOUS_ORG_SLUG?.trim() ||
    process.env.HERMES_ORG_SLUG?.trim() ||
    DEFAULT_NOUS_ORG_SLUG;

  // Match portal.nousresearch.com/orgs/{slug}/billing:
  //   credits = subscription credits remaining (not prepaid wallet)
  //   spent   = monthly allotment − remaining (not monthlyCap / auto-reload)
  let creditsAvailable: number | null = null;
  let spentThisMonth: number | null = null;
  let monthlyCredits: number | null = null;
  let prepaidWallet: number | null = null;
  let tokensThisMonth: number | null = localDash.tokens;
  let ok = localDash.ok;
  let detail: string | undefined = localDash.detail;
  let plan: string | undefined;
  let resolvedSlug = orgSlug;

  if (!auth) {
    // Local dashboard alone is enough for tokens/spend; credits need portal
    if (localDash.ok) {
      return {
        creditsAvailable,
        spentThisMonth,
        tokensThisMonth,
        ok: true,
        detail:
          (reason ? `${reason} ` : "") +
          (localDash.detail ||
            "Local Hermes dashboard analytics (subscription credits need portal login)."),
        orgSlug,
      };
    }
    return {
      creditsAvailable,
      spentThisMonth: spentThisMonth,
      tokensThisMonth: tokensThisMonth,
      ok: false,
      detail:
        reason ||
        "Hermes: start `hermes dashboard` and/or run `hermes portal login` for live credits.",
      orgSlug,
    };
  }

  let headers = {
    Authorization: `Bearer ${auth.accessToken}`,
    Accept: "application/json",
    "User-Agent": "Cortex/0.2 (provider-usage; +local)",
  };
  let base = auth.portalBaseUrl;

  // Account: total usable + subscription remaining + member spend
  try {
    let res = await fetch(`${base}/api/oauth/account`, {
      headers,
      signal: AbortSignal.timeout(12_000),
      cache: "no-store",
    });
    if (res.status === 401) {
      askHermesToRefreshNous();
      const retried = loadHermesAuth();
      if (retried.auth) {
        headers = {
          ...headers,
          Authorization: `Bearer ${retried.auth.accessToken}`,
        };
        base = retried.auth.portalBaseUrl;
        res = await fetch(`${base}/api/oauth/account`, {
          headers,
          signal: AbortSignal.timeout(12_000),
          cache: "no-store",
        });
      }
    }
    if (res.ok) {
      const json = (await res.json()) as {
        organisation?: { slug?: string; name?: string };
        subscription?: {
          plan?: string;
          monthly_credits?: number | string;
          credits_remaining?: number | string;
        };
        purchased_credits_remaining?: number | string;
        paid_service_access?: {
          total_usable_credits?: number | string;
          subscription_credits_remaining?: number | string;
          purchased_credits_remaining?: number | string;
          member_spend_usd?: number | string;
          subscription_monthly_charge?: number | string;
        };
      };
      if (json.organisation?.slug) resolvedSlug = json.organisation.slug;
      plan = json.subscription?.plan || plan;

      const remaining =
        moneyNum(json.subscription?.credits_remaining) ??
        moneyNum(json.paid_service_access?.subscription_credits_remaining);
      const monthly = moneyNum(json.subscription?.monthly_credits);
      const purchased =
        moneyNum(json.paid_service_access?.purchased_credits_remaining) ??
        moneyNum(json.purchased_credits_remaining);
      if (remaining != null) creditsAvailable = remaining;
      if (monthly != null) monthlyCredits = monthly;
      if (purchased != null) prepaidWallet = purchased;
      if (monthly != null && remaining != null && monthly >= remaining) {
        spentThisMonth = Math.max(0, monthly - remaining);
      }
      ok = true;
      detail = `Live from Nous Portal${plan ? ` (${plan})` : ""} · org ${resolvedSlug}`;
    } else {
      detail = `Nous account API ${res.status}${
        res.status === 401
          ? " — re-run `hermes portal login`"
          : ""
      }`;
    }
  } catch (e) {
    detail = e instanceof Error ? e.message : String(e);
  }

  // Billing state: prepaid balanceUsd + calendar-month cap spend
  try {
    const res = await fetch(`${base}/api/billing/state`, {
      headers,
      signal: AbortSignal.timeout(12_000),
      cache: "no-store",
    });
    if (res.ok) {
      const json = (await res.json()) as {
        org?: { slug?: string };
        balanceUsd?: string | number;
        monthlyCap?: {
          limitUsd?: string | number;
          spentThisMonthUsd?: string | number;
        };
      };
      if (json.org?.slug) resolvedSlug = json.org.slug;
      const bal = moneyNum(json.balanceUsd);
      // Prepaid / auto-reload wallet is a separate balance on the billing
      // page — do not add it to subscription credits or treat monthlyCap
      // spend as the card's "Spent / mo".
      if (bal != null && bal > 0) {
        prepaidWallet = prepaidWallet ?? bal;
      }
      ok = true;
      if (!detail) {
        detail = `Live from Nous Portal billing · org ${resolvedSlug}`;
      }
    }
  } catch {
    /* optional */
  }

  // Subscription: confirm remaining / plan name
  try {
    const res = await fetch(`${base}/api/billing/subscription`, {
      headers,
      signal: AbortSignal.timeout(12_000),
      cache: "no-store",
    });
    if (res.ok) {
      const json = (await res.json()) as {
        org?: { slug?: string };
        current?: {
          tierName?: string;
          monthlyCredits?: string | number;
          creditsRemaining?: string | number;
        };
      };
      if (json.org?.slug) resolvedSlug = json.org.slug;
      if (json.current?.tierName) plan = json.current.tierName;
      const monthly = moneyNum(json.current?.monthlyCredits);
      const remaining = moneyNum(json.current?.creditsRemaining);
      if (remaining != null) creditsAvailable = remaining;
      if (monthly != null) monthlyCredits = monthly;
      if (monthly != null && remaining != null && monthly >= remaining) {
        spentThisMonth = Math.max(0, monthly - remaining);
      }
      ok = true;
      detail = `Live from Nous Portal${plan ? ` (${plan})` : ""} · org ${resolvedSlug}`;
    }
  } catch {
    /* optional */
  }

  // Prefer portal credits when present; keep local-dashboard tokens/spend if
  // portal doesn't expose token totals (it usually doesn't).
  if (localDash.ok) {
    if (tokensThisMonth == null && localDash.tokens != null) {
      tokensThisMonth = localDash.tokens;
    }
    if (
      (spentThisMonth == null || spentThisMonth === 0) &&
      localDash.spentUsd != null
    ) {
      spentThisMonth = localDash.spentUsd;
    }
  }

  // Manual override only when portal didn't return credits
  if (creditsAvailable == null) {
    creditsAvailable = creditsFromEnv("hermes");
  }

  if (ok && creditsAvailable != null) {
    const wallet =
      prepaidWallet != null && prepaidWallet > 0
        ? ` · $${prepaidWallet.toFixed(0)} prepaid wallet`
        : "";
    const allotment =
      monthlyCredits != null ? ` of $${monthlyCredits.toFixed(0)}` : "";
    detail = `Live Nous Portal${plan ? ` (${plan})` : ""} · org ${resolvedSlug}${allotment}${wallet}`;
  } else if (ok) {
    detail =
      detail ||
      `Nous Portal linked${plan ? ` (${plan})` : ""} · org ${resolvedSlug}`;
  }

  return {
    creditsAvailable,
    spentThisMonth,
    tokensThisMonth,
    ok: ok || localDash.ok,
    detail,
    orgSlug: resolvedSlug,
    plan,
  };
}

export async function getProviderUsageCards(): Promise<ProviderUsageCard[]> {
  ensureSecretsLoaded();

  const [anthropic, xai, nous] = await Promise.all([
    fetchAnthropicMonth(),
    fetchXaiMonth(),
    fetchNousMonth(),
  ]);

  const claudeLocal = localMonthUsage("claude");
  const grokLocal = localMonthUsage("grok");
  const hermesLocal = localMonthUsage("hermes");

  const claudeConfigured = Boolean(
    process.env.ANTHROPIC_API_KEY?.trim() ||
      process.env.ANTHROPIC_ADMIN_KEY?.trim() ||
      process.env.ANTHROPIC_ADMIN_API_KEY?.trim() ||
      process.env.CLAUDE_SESSION_KEY?.trim() ||
      loadClaudeConsoleAuth(),
  );
  const grokConfigured = Boolean(
    process.env.XAI_API_KEY?.trim() ||
      process.env.XAI_MANAGEMENT_KEY?.trim() ||
      process.env.XAI_MANAGEMENT_API_KEY?.trim(),
  );
  // Hermes agents are always available locally; live credits need portal auth
  const hermesConfigured = true;

  // Console session (dashboard) wins for credits + spend; Admin API for tokens.
  // Only fall back to local when both Console and Admin report empty.
  const claudeUseLocalFallback =
    anthropic.ok &&
    !anthropic.consoleLive &&
    anthropic.emptyOrgUsage &&
    (claudeLocal.tokens > 0 || claudeLocal.costUsd > 0);
  const claudeTokens = claudeUseLocalFallback
    ? claudeLocal.tokens
    : anthropic.ok
      ? anthropic.tokens
      : claudeLocal.tokens;
  const claudeSpend =
    anthropic.ok && anthropic.costUsd > 0
      ? anthropic.costUsd
      : claudeUseLocalFallback
        ? claudeLocal.costUsd
        : anthropic.ok
          ? anthropic.costUsd
          : claudeLocal.costUsd;

  // Live Console prepaid credits first; env only if session unavailable
  const claudeCredits =
    anthropic.creditsAvailable != null
      ? anthropic.creditsAvailable
      : creditsFromEnv("claude");

  const grokCredits =
    xai.ok && xai.creditsAvailable != null
      ? xai.creditsAvailable
      : creditsFromEnv("grok");
  const grokSpend =
    xai.ok && xai.spentThisMonth != null
      ? xai.spentThisMonth
      : grokLocal.costUsd;
  const grokTokens =
    xai.ok && xai.tokensThisMonth != null && xai.tokensThisMonth > 0
      ? xai.tokensThisMonth
      : grokLocal.tokens;

  const hermesCredits =
    nous.ok && nous.creditsAvailable != null
      ? nous.creditsAvailable
      : creditsFromEnv("hermes");
  const hermesSpend =
    nous.ok && nous.spentThisMonth != null
      ? nous.spentThisMonth
      : hermesLocal.costUsd;
  // Portal does not expose token totals; keep Cortex-local agent tokens
  const hermesTokens = hermesLocal.tokens;

  const teamConsole = `https://console.x.ai/team/${
    process.env.XAI_TEAM_ID?.trim() ||
    "a8b8b3bc-6273-4c12-ad6c-d03f0df486f4"
  }`;

  const hermesConsole = `${
    process.env.HERMES_PORTAL_BASE_URL?.trim() ||
    process.env.NOUS_PORTAL_BASE_URL?.trim() ||
    DEFAULT_NOUS_PORTAL
  }/orgs/${nous.orgSlug || DEFAULT_NOUS_ORG_SLUG}/billing`;

  const cards: ProviderUsageCard[] = [
    {
      id: "claude",
      label: "Claude",
      creditsAvailable: claudeCredits,
      creditsAvailableLabel: formatUsd(claudeCredits),
      spentThisMonth: claudeSpend,
      spentThisMonthLabel: formatUsd(claudeSpend),
      tokensThisMonth: claudeTokens,
      tokensThisMonthLabel: formatTokens(claudeTokens),
      source: claudeUseLocalFallback
        ? "mixed"
        : anthropic.consoleLive
          ? anthropic.tokens > 0
            ? "mixed"
            : "claude-console"
          : anthropic.ok
            ? "anthropic-admin"
            : "local",
      detail: claudeUseLocalFallback
        ? `${anthropic.detail || "Admin org has $0 this month."} Showing Cortex local Claude agents (${formatTokens(claudeLocal.tokens)}, ${formatUsd(claudeLocal.costUsd)} est.).`
        : anthropic.ok
          ? anthropic.detail ||
            "Live from Claude Console dashboard + Admin Usage API"
          : anthropic.detail ||
            "Local Cortex usage. Log into platform.claude.com (Firefox) and set ANTHROPIC_ADMIN_KEY.",
      consoleUrl: "https://platform.claude.com/dashboard",
      configured: claudeConfigured,
    },
    {
      id: "grok",
      label: "Grok",
      creditsAvailable: grokCredits,
      creditsAvailableLabel: formatUsd(grokCredits),
      spentThisMonth: grokSpend,
      spentThisMonthLabel: formatUsd(grokSpend),
      tokensThisMonth: grokTokens,
      tokensThisMonthLabel: formatTokens(grokTokens),
      source: xai.ok
        ? grokLocal.tokens > 0
          ? "mixed"
          : "xai-management"
        : "local",
      detail: xai.ok
        ? xai.detail || "Live from xAI Management billing API"
        : xai.detail ||
          "Set XAI_MANAGEMENT_KEY + XAI_TEAM_ID for live console credits (chat XAI_API_KEY alone cannot read billing).",
      consoleUrl: teamConsole,
      configured: grokConfigured,
    },
    {
      id: "hermes",
      label: "Hermes",
      creditsAvailable: hermesCredits,
      creditsAvailableLabel:
        hermesCredits != null ? formatUsd(hermesCredits) : "—",
      spentThisMonth: hermesSpend,
      spentThisMonthLabel: formatUsd(hermesSpend),
      tokensThisMonth: hermesTokens,
      tokensThisMonthLabel: formatTokens(hermesTokens),
      source: nous.ok
        ? hermesLocal.tokens > 0
          ? "mixed"
          : "nous-portal"
        : "local",
      detail: nous.ok
        ? nous.detail ||
          "Live from Nous Portal billing (subscription credits are USD)."
        : nous.detail ||
          "Local Hermes agents. Run `hermes portal login` for live Nous org credits.",
      consoleUrl: hermesConsole,
      configured: hermesConfigured,
    },
  ];

  return cards;
}
