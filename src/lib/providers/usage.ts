/**
 * Provider usage / credits for Command Center cards (Claude, Grok, Hermes).
 *
 * Sources:
 * - Cortex local usage (always) — tokens & estimated $ from agents + usage log
 * - Anthropic Admin API (optional ANTHROPIC_ADMIN_KEY) — org spend & tokens this month
 * - xAI Management API (XAI_MANAGEMENT_KEY) — team prepaid balance & cycle spend
 * - Nous Portal (Hermes OAuth in ~/.hermes/auth.json, or NOUS_PORTAL_TOKEN) —
 *   org billing for portal.nousresearch.com/orgs/{slug}/billing
 *
 * Note: Scraping HTML consoles requires a browser login session and is not
 * reliable for a server app. Prefer the official APIs above.
 */

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
};

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
 * Anthropic Usage & Cost Admin API (requires sk-ant-admin01-… key).
 * Mirrors platform.claude.com/dashboard / usage / cost for the Console org.
 *
 * - Spend this month → cost_report (USD, amounts in cents)
 * - Token volume → usage_report/messages (includes cache read + cache creation)
 * - Organization credits → not in public Admin API; set CLAUDE_CREDITS_AVAILABLE
 *
 * https://platform.claude.com/docs/en/manage-claude/usage-cost-api
 */
async function fetchAnthropicMonth(): Promise<AnthropicMonth> {
  ensureSecretsLoaded();
  const adminKey =
    process.env.ANTHROPIC_ADMIN_KEY?.trim() ||
    process.env.ANTHROPIC_ADMIN_API_KEY?.trim();
  if (!adminKey) {
    return {
      tokens: 0,
      costUsd: 0,
      ok: false,
      detail: "Set ANTHROPIC_ADMIN_KEY for live Claude Console usage",
    };
  }

  const starting = startOfMonthUtc().toISOString();
  const ending = endOfNextDayUtc().toISOString();
  const headers = {
    "anthropic-version": "2023-06-01",
    "x-api-key": adminKey,
    "User-Agent": "Cortex/0.2 (provider-usage; +local)",
  };

  let tokens = 0;
  let costUsd = 0;
  let ok = false;
  let detail: string | undefined;
  let orgName: string | undefined;
  let orgId: string | undefined;

  // Resolve which Console org this admin key belongs to
  try {
    const meRes = await fetch("https://api.anthropic.com/v1/organizations/me", {
      headers,
      signal: AbortSignal.timeout(10_000),
      cache: "no-store",
    });
    if (meRes.ok) {
      const me = (await meRes.json()) as { id?: string; name?: string };
      orgName = me.name || undefined;
      orgId = me.id || undefined;
    }
  } catch {
    /* optional */
  }

  // Messages usage (Console “Token volume” / usage page)
  try {
    const buckets = await fetchAnthropicReportPages(
      "/v1/organizations/usage_report/messages",
      {
        starting_at: starting,
        ending_at: ending,
        bucket_width: "1d",
        limit: "31",
      },
      headers,
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
    detail = e instanceof Error ? e.message : String(e);
  }

  // Cost report (Console “Spend this month”) — amounts are cents as decimal strings
  try {
    const buckets = await fetchAnthropicReportPages(
      "/v1/organizations/cost_report",
      {
        starting_at: starting,
        ending_at: ending,
        bucket_width: "1d",
        limit: "31",
      },
      headers,
    );
    for (const bucket of buckets) {
      for (const raw of bucket.results || []) {
        if (!raw || typeof raw !== "object") continue;
        const r = raw as { amount?: string | number };
        const cents =
          typeof r.amount === "string" ? Number(r.amount) : Number(r.amount ?? 0);
        if (Number.isFinite(cents)) costUsd += cents / 100;
      }
    }
    ok = true;
  } catch (e) {
    if (!detail) detail = e instanceof Error ? e.message : String(e);
  }

  const emptyOrgUsage = ok && tokens === 0 && costUsd === 0;
  const orgLabel = orgName ? `“${orgName}”` : "Console org";
  if (ok) {
    detail = emptyOrgUsage
      ? `Claude Console ${orgLabel}: $0 spend / 0 tokens this month via Admin API. Organization credits need CLAUDE_CREDITS_AVAILABLE (no public balance API).`
      : `Live Claude Console ${orgLabel} (platform.claude.com/dashboard) · Admin Usage & Cost API`;
  }

  return {
    tokens,
    costUsd,
    ok,
    detail,
    orgName,
    orgId,
    emptyOrgUsage,
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

/** Read Nous OAuth from env or Hermes CLI auth store (~/.hermes/auth.json). */
function loadHermesAuth(): HermesAuthStore | null {
  ensureSecretsLoaded();

  const envToken =
    process.env.NOUS_PORTAL_TOKEN?.trim() ||
    process.env.HERMES_PORTAL_TOKEN?.trim() ||
    process.env.NOUS_ACCESS_TOKEN?.trim();
  const portalBase =
    process.env.HERMES_PORTAL_BASE_URL?.trim() ||
    process.env.NOUS_PORTAL_BASE_URL?.trim() ||
    DEFAULT_NOUS_PORTAL;

  if (envToken) {
    return {
      accessToken: envToken,
      clientId: process.env.NOUS_CLIENT_ID?.trim() || "hermes-cli",
      portalBaseUrl: portalBase.replace(/\/$/, ""),
    };
  }

  const authPath = hermesAuthJsonPath();
  try {
    if (!fs.existsSync(authPath)) return null;
    const raw = JSON.parse(fs.readFileSync(authPath, "utf8")) as {
      providers?: {
        nous?: {
          access_token?: string;
          refresh_token?: string;
          client_id?: string;
          portal_base_url?: string;
          expires_at?: string;
          agent_key?: string;
        };
      };
    };
    const nous = raw.providers?.nous;
    const access =
      nous?.access_token?.trim() || nous?.agent_key?.trim() || "";
    if (!access) return null;
    return {
      accessToken: access,
      refreshToken: nous?.refresh_token?.trim() || undefined,
      clientId: nous?.client_id?.trim() || "hermes-cli",
      portalBaseUrl: (
        nous?.portal_base_url?.trim() ||
        portalBase ||
        DEFAULT_NOUS_PORTAL
      ).replace(/\/$/, ""),
      authPath,
      expiresAt: nous?.expires_at,
    };
  } catch {
    return null;
  }
}

/** Refresh access token when near expiry; persist rotation back to auth.json. */
async function ensureFreshNousToken(
  auth: HermesAuthStore,
): Promise<HermesAuthStore> {
  const expMs =
    jwtExpMs(auth.accessToken) ??
    (auth.expiresAt ? Date.parse(auth.expiresAt) : null);
  const skewMs = 90_000; // refresh 90s early
  if (expMs != null && expMs > Date.now() + skewMs) return auth;
  if (!auth.refreshToken) return auth;

  try {
    const res = await fetch(`${auth.portalBaseUrl}/api/oauth/token`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        "User-Agent": "Cortex/0.2 (provider-usage; +local)",
      },
      body: JSON.stringify({
        grant_type: "refresh_token",
        refresh_token: auth.refreshToken,
        client_id: auth.clientId || "hermes-cli",
      }),
      signal: AbortSignal.timeout(12_000),
      cache: "no-store",
    });
    if (!res.ok) return auth;
    const json = (await res.json()) as {
      access_token?: string;
      refresh_token?: string;
      expires_in?: number;
      token_type?: string;
      scope?: string;
    };
    if (!json.access_token) return auth;

    const next: HermesAuthStore = {
      ...auth,
      accessToken: json.access_token,
      refreshToken: json.refresh_token || auth.refreshToken,
    };

    // Persist so Hermes CLI keeps a valid refresh token chain
    if (auth.authPath) {
      try {
        const raw = JSON.parse(fs.readFileSync(auth.authPath, "utf8")) as {
          providers?: { nous?: Record<string, unknown> };
          [k: string]: unknown;
        };
        const nous = { ...(raw.providers?.nous || {}) };
        const now = new Date();
        const ttl = Number(json.expires_in) || 3600;
        nous.access_token = json.access_token;
        if (json.refresh_token) nous.refresh_token = json.refresh_token;
        if (json.token_type) nous.token_type = json.token_type;
        if (json.scope) nous.scope = json.scope;
        nous.obtained_at = now.toISOString();
        nous.expires_in = ttl;
        nous.expires_at = new Date(now.getTime() + ttl * 1000).toISOString();
        // agent_key often mirrors access for inference
        if (nous.agent_key) {
          nous.agent_key = json.access_token;
          nous.agent_key_expires_at = nous.expires_at;
          nous.agent_key_expires_in = ttl;
          nous.agent_key_obtained_at = now.toISOString();
        }
        raw.providers = { ...(raw.providers || {}), nous };
        raw.updated_at = now.toISOString();
        const tmp = `${auth.authPath}.cortex-tmp`;
        fs.writeFileSync(tmp, JSON.stringify(raw, null, 2), { mode: 0o600 });
        fs.renameSync(tmp, auth.authPath);
      } catch {
        /* in-memory token still usable this request */
      }
    }
    return next;
  } catch {
    return auth;
  }
}

/**
 * Nous Portal org billing (Hermes).
 * Uses the same OAuth JWT as `hermes portal` — not HTML scraping of
 * https://portal.nousresearch.com/orgs/{slug}/billing (SPA + rate-limited).
 *
 * Endpoints (Bearer OAuth):
 * - GET /api/oauth/account
 * - GET /api/billing/state
 * - GET /api/billing/subscription
 */
async function fetchNousMonth(): Promise<NousMonth> {
  ensureSecretsLoaded();
  let auth = loadHermesAuth();
  const orgSlug =
    process.env.NOUS_ORG_SLUG?.trim() ||
    process.env.HERMES_ORG_SLUG?.trim() ||
    DEFAULT_NOUS_ORG_SLUG;

  if (!auth) {
    return {
      creditsAvailable: null,
      spentThisMonth: null,
      tokensThisMonth: null,
      ok: false,
      detail:
        "Hermes: log in with `hermes portal login`, or set NOUS_PORTAL_TOKEN for live Nous credits.",
      orgSlug,
    };
  }

  auth = await ensureFreshNousToken(auth);
  const headers = {
    Authorization: `Bearer ${auth.accessToken}`,
    Accept: "application/json",
    "User-Agent": "Cortex/0.2 (provider-usage; +local)",
  };
  const base = auth.portalBaseUrl;

  let creditsAvailable: number | null = null;
  let spentThisMonth: number | null = null;
  let tokensThisMonth: number | null = null;
  let ok = false;
  let detail: string | undefined;
  let plan: string | undefined;
  let resolvedSlug = orgSlug;

  // Account: total usable + subscription remaining + member spend
  try {
    const res = await fetch(`${base}/api/oauth/account`, {
      headers,
      signal: AbortSignal.timeout(12_000),
      cache: "no-store",
    });
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

      const usable =
        moneyNum(json.paid_service_access?.total_usable_credits) ??
        moneyNum(json.subscription?.credits_remaining);
      const purchased =
        moneyNum(json.paid_service_access?.purchased_credits_remaining) ??
        moneyNum(json.purchased_credits_remaining) ??
        0;
      if (usable != null) creditsAvailable = usable;
      else if (purchased > 0) creditsAvailable = purchased;

      const monthly = moneyNum(json.subscription?.monthly_credits);
      const remaining =
        moneyNum(json.paid_service_access?.subscription_credits_remaining) ??
        moneyNum(json.subscription?.credits_remaining);
      if (monthly != null && remaining != null && monthly >= remaining) {
        spentThisMonth = Math.max(0, monthly - remaining);
      }
      const memberSpend = moneyNum(json.paid_service_access?.member_spend_usd);
      if (
        memberSpend != null &&
        (spentThisMonth == null || memberSpend > spentThisMonth)
      ) {
        // Prefer higher of cycle usage vs member spend when both present
        if (spentThisMonth == null) spentThisMonth = memberSpend;
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
      // Prepaid top-up wallet (often 0 when only subscription credits remain)
      if (bal != null && bal > 0) {
        creditsAvailable =
          creditsAvailable != null ? creditsAvailable + bal : bal;
      }
      const calSpend = moneyNum(json.monthlyCap?.spentThisMonthUsd);
      if (calSpend != null && calSpend > 0) {
        // Calendar-month prepaid spend; keep max with subscription-period usage
        spentThisMonth =
          spentThisMonth != null
            ? Math.max(spentThisMonth, calSpend)
            : calSpend;
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
      if (remaining != null) {
        creditsAvailable =
          creditsAvailable != null
            ? Math.max(creditsAvailable, remaining)
            : remaining;
      }
      if (monthly != null && remaining != null && monthly >= remaining) {
        const used = Math.max(0, monthly - remaining);
        spentThisMonth =
          spentThisMonth != null ? Math.max(spentThisMonth, used) : used;
      }
      ok = true;
      detail = `Live from Nous Portal${plan ? ` (${plan})` : ""} · org ${resolvedSlug}`;
    }
  } catch {
    /* optional */
  }

  // Env override still wins for manual credit display
  const envCredits = creditsFromEnv("hermes");
  if (envCredits != null && !ok) creditsAvailable = envCredits;

  return {
    creditsAvailable,
    spentThisMonth,
    tokensThisMonth,
    ok,
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
      process.env.ANTHROPIC_ADMIN_API_KEY?.trim(),
  );
  const grokConfigured = Boolean(
    process.env.XAI_API_KEY?.trim() ||
      process.env.XAI_MANAGEMENT_KEY?.trim() ||
      process.env.XAI_MANAGEMENT_API_KEY?.trim(),
  );
  // Hermes agents are always available locally; live credits need portal auth
  const hermesConfigured = true;

  // Prefer Admin API when it has real usage. If the Console org is empty
  // (common for a new org created only to mint an admin key), fall back to
  // Cortex-local Claude agent metrics so the card isn't a blank zero.
  const claudeUseLocalFallback =
    anthropic.ok &&
    anthropic.emptyOrgUsage &&
    (claudeLocal.tokens > 0 || claudeLocal.costUsd > 0);
  const claudeTokens = claudeUseLocalFallback
    ? claudeLocal.tokens
    : anthropic.ok
      ? anthropic.tokens
      : claudeLocal.tokens;
  const claudeSpend = claudeUseLocalFallback
    ? claudeLocal.costUsd
    : anthropic.ok
      ? anthropic.costUsd
      : claudeLocal.costUsd;

  const claudeCredits = creditsFromEnv("claude");

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
        : anthropic.ok
          ? "anthropic-admin"
          : "local",
      detail: claudeUseLocalFallback
        ? `${anthropic.detail || "Admin org has $0 this month."} Showing Cortex local Claude agents (${formatTokens(claudeLocal.tokens)}, ${formatUsd(claudeLocal.costUsd)} est.).`
        : anthropic.ok
          ? anthropic.detail || "Live from Anthropic Admin Usage & Cost API"
          : anthropic.detail ||
            "Local Cortex usage. Add ANTHROPIC_ADMIN_KEY for Console-linked spend.",
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
