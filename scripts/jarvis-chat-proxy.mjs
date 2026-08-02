#!/usr/bin/env node
/**
 * Cortex Jarvis chat proxy — OpenAI-compatible API for packaged Cortex 0.2.x
 *
 * OpenJarvis orchestrator often dumps fake tool-call JSON instead of answers.
 * This proxy sits on :8000 (or JARVIS_PROXY_PORT), injects live web context
 * (Tavily → Brave → DuckDuckGo), then answers via:
 *   1) Grok (live questions, when XAI_API_KEY set)
 *   2) LM Studio (:1234)
 *   3) Ollama (:11434)
 *
 * Usage:
 *   node scripts/jarvis-chat-proxy.mjs
 *   # loads .env.local + Application Support/cortex/.env
 */
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.join(__dirname, "..");
const PORT = Number(process.env.JARVIS_PROXY_PORT || 8000);
const LM_STUDIO = (
  process.env.JARVIS_CHAT_BASE_URL || "http://127.0.0.1:1234"
).replace(/\/$/, "");
const OLLAMA = (
  process.env.OLLAMA_HOST || "http://127.0.0.1:11434"
).replace(/\/$/, "");
const MODE =
  (process.env.JARVIS_CHAT_MODE || "hybrid").trim().toLowerCase() || "hybrid";
const GROK_MODEL =
  process.env.JARVIS_GROK_MODEL?.trim() ||
  process.env.XAI_CHAT_MODEL?.trim() ||
  "grok-4.5";
const DEFAULT_LOCAL_MODEL =
  process.env.JARVIS_CHAT_MODEL?.trim() ||
  process.env.JARVIS_MODEL?.trim() ||
  "hermes-3-llama-3.1-8b-abliterated";
/** Prefer local LM Studio first (faster); set JARVIS_USE_GROK=1 to try Grok first. */
const USE_GROK_FIRST =
  process.env.JARVIS_USE_GROK === "1" ||
  process.env.JARVIS_USE_GROK === "true" ||
  MODE === "grok";
/** Skip LLM when Tavily returns a direct answer for simple fact questions (much faster). */
const FAST_SEARCH =
  process.env.JARVIS_FAST_SEARCH !== "0" &&
  process.env.JARVIS_FAST_SEARCH !== "false";

/** Cache /v1/models for a short window — listing every turn adds avoidable RTT. */
const modelCache = new Map(); // base -> { at, ids }
/** Skip Grok for a while after 403/credit failures. */
let grokCooldownUntil = 0;

function loadEnvFile(filePath) {
  try {
    if (!fs.existsSync(filePath)) return;
    for (const raw of fs.readFileSync(filePath, "utf8").split(/\r?\n/)) {
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
      if (key && process.env[key] === undefined) process.env[key] = val;
    }
  } catch {
    /* ignore */
  }
}

loadEnvFile(path.join(PROJECT_ROOT, ".env"));
loadEnvFile(path.join(PROJECT_ROOT, ".env.local"));
loadEnvFile(path.join(os.homedir(), "Library/Application Support/cortex/.env"));

const TEMPORAL =
  /\b(today|tonight|now|current|currently|latest|recent|recently|this\s+(morning|afternoon|evening|week|month|year|weekend)|right\s+now|as\s+of|breaking|live|headline|headlines|update|updates|202[4-9]|2026)\b/i;
const LIVE_TOPICS =
  /\b(news|weather|forecast|temperature|stock|stocks|market|score|scores|election|poll|traffic|crypto|bitcoin|ethereum|price\s+of|who\s+won|what\s+happened|standings|earnings|ipo|war\s+in|conflict\s+in|president|prime\s+minister|ceo\s+of)\b/i;

function needsLiveData(prompt) {
  const q = (prompt || "").trim();
  if (q.length < 3) return false;
  // Pure math / code / jokes — local model only (no web RTT)
  if (
    /^[\d\s+\-*/().=?x]+$/i.test(q) ||
    /\b(joke|riddle|poem|haiku|code|function|refactor)\b/i.test(q)
  ) {
    return false;
  }
  if (TEMPORAL.test(q) || LIVE_TOPICS.test(q)) return true;
  if (
    /\b(who is|who's|who won|current|latest|news|weather|price of|stock|ceo of|president)\b/i.test(
      q,
    ) &&
    q.length < 200
  ) {
    return true;
  }
  // "what is X" only when X looks like a real-world entity (not 2+2)
  if (
    /\b(what'?s|whats|what\s+is)\b/i.test(q) &&
    q.length < 160 &&
    !/[\d+\-*/=]/.test(q)
  ) {
    return true;
  }
  return false;
}

function formatClock() {
  const now = new Date();
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || "local";
  return (
    `Current date/time: ${now.toLocaleString("en-US", {
      weekday: "long",
      year: "numeric",
      month: "long",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
      timeZoneName: "short",
    })} (${tz}). ISO: ${now.toISOString()}.`
  );
}

function isGarbage(content) {
  const t = (content || "").trim();
  if (!t) return true;
  if (/Using Tavily for web search/i.test(t)) return true;
  if (/tavily_search|brave_search|firecrawl/i.test(t) && /\{[\s\S]*"name"\s*:/.test(t))
    return true;
  if (/^\s*\{[\s\S]*"name"\s*:\s*"[^"]+"[\s\S]*\}\s*$/.test(t)) return true;
  if (/^\s*\{\s*"name"\s*:/.test(t)) return true;
  if (/tool[_ ]?call/i.test(t) && t.length < 400) return true;
  if (/I made a mistake.*(tool|parameter|function)/i.test(t)) return true;
  if (
    /\*\*Actionable Steps:\*\*|Use \*\*Tavily\*\*|Utiliz(e|ing) \*\*Firecrawl\*\*/i.test(
      t,
    )
  ) {
    return true;
  }
  if (/\[insert president's name\]/i.test(t)) return true;
  // Hermes sometimes loops "overposting"
  if ((t.match(/overposting/gi) || []).length >= 3) return true;
  return false;
}

function cleanModelText(content) {
  let t = (content || "").trim();
  // Strip hermes "overposting" loops and log-style garbage
  t = t.replace(/(?:\s*overposting)+/gi, "").trim();
  t = t.replace(/\s*RTALog:[\s\S]*$/i, "").trim();
  t = t.replace(/\s*User asked[\s\S]*Assistant replied[\s\S]*$/i, "").trim();
  // Drop trailing single junk tokens some local models append
  t = t.replace(/\s+\b(councill|overposting)\b\.?\s*$/i, "").trim();
  // Collapse word spam: "foo foo foo" or "YYSY. YYSY. YYSY."
  const spam =
    t.match(/\b([A-Za-z]{2,})(?:[\s.]+?\1){3,}/i) ||
    t.match(/\b([A-Za-z]{3,})(?:\s+\1){3,}/i);
  if (spam && spam.index != null && spam.index > 8) {
    t = t.slice(0, spam.index).trim();
  } else if (spam) {
    t = t.replace(/\b([A-Za-z]{2,})(?:[\s.]+?\1){2,}/gi, "$1");
  }
  // Keep only the first clean sentence when the rest is nonsense
  const firstSentence = t.match(/^([\s\S]{6,300}?[.!?])(?=\s|$)/);
  if (firstSentence) {
    const rest = t.slice(firstSentence[0].length).trim();
    if (
      rest &&
      (/^([A-Z0-9]{2,}[\s.]*){3,}/.test(rest) ||
        /(.)\1{5,}/.test(rest) ||
        (/[A-Z]{4,}/.test(rest) && rest.split(/\s+/).length <= 3) ||
        (rest.split(/\s+/).length === 1 && rest.length > 16) ||
        /^[A-Z]{2,}(\s*[.!]?\s*[A-Z]{2,}){2,}/.test(rest))
    ) {
      t = firstSentence[1].trim();
    }
  }
  // Prefer first 2 sentences if the tail is long noise
  const sentences = t.split(/(?<=[.!?])\s+/);
  if (sentences.length > 3 && t.length > 280) {
    t = sentences.slice(0, 2).join(" ").trim();
  }
  t = t.replace(/\n{3,}/g, "\n\n").trim();
  return t;
}

async function searchTavily(query) {
  const key = process.env.TAVILY_API_KEY?.trim();
  if (!key) return null;
  const res = await fetch("https://api.tavily.com/search", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      api_key: key,
      query,
      search_depth: "basic",
      max_results: 5,
      include_answer: true,
    }),
    signal: AbortSignal.timeout(12_000),
  });
  if (!res.ok) return null;
  const data = await res.json();
  const hits = [];
  if (data.answer?.trim()) {
    hits.push({ title: "Tavily summary", snippet: data.answer.trim() });
  }
  for (const r of data.results || []) {
    hits.push({
      title: r.title || "Result",
      url: r.url,
      snippet: (r.content || "").trim().slice(0, 400),
    });
  }
  return hits.length ? { provider: "tavily", hits } : null;
}

async function searchDuckDuckGo(query) {
  const url = new URL("https://api.duckduckgo.com/");
  url.searchParams.set("q", query);
  url.searchParams.set("format", "json");
  url.searchParams.set("no_html", "1");
  url.searchParams.set("skip_disambig", "1");
  const res = await fetch(url, {
    headers: { "User-Agent": "Cortex-Jarvis-Proxy/0.2" },
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) return null;
  const data = await res.json();
  const hits = [];
  if (data.Answer?.trim())
    hits.push({ title: "Direct answer", snippet: data.Answer.trim() });
  if (data.AbstractText?.trim()) {
    hits.push({
      title: data.Heading || "Summary",
      url: data.AbstractURL,
      snippet: data.AbstractText.trim().slice(0, 500),
    });
  }
  return hits.length ? { provider: "duckduckgo", hits } : null;
}

async function fetchLive(query) {
  for (const fn of [searchTavily, searchDuckDuckGo]) {
    try {
      const r = await fn(query);
      if (r?.hits?.length) return r;
    } catch {
      /* next */
    }
  }
  return null;
}

function liveBlock(live) {
  if (!live?.hits?.length) {
    return "Live web search returned no results. Do not invent current events.";
  }
  const lines = live.hits.slice(0, 6).map((h, i) => {
    const url = h.url ? ` (${h.url})` : "";
    return `${i + 1}. ${h.title}${url}\n   ${h.snippet || ""}`;
  });
  return (
    `Live web results (source: ${live.provider}). Prefer these over training memory.\n` +
    lines.join("\n")
  );
}

const SYSTEM = `You are Jarvis, a personal AI assistant inside Cortex.

Rules:
- Answer the user's latest message accurately and directly in plain language.
- Never invent tools, tool calls, APIs, or JSON function payloads.
- Never output {"name":...} tool syntax. Speak only to the user.
- Prefer Live web results and the current date/time for facts that change.
- If live results are missing and you are unsure, say you cannot verify — do not invent.
- Keep replies concise: a few sentences unless asked for depth.`;

function lastUserText(messages) {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m?.role === "user" && typeof m.content === "string") {
      return m.content.trim();
    }
  }
  return "";
}

function buildMessages(bodyMessages, live, forceLive) {
  const out = [{ role: "system", content: SYSTEM }];
  const ctx = [formatClock()];
  if (live || forceLive) {
    ctx.push(liveBlock(live));
  }
  out[0].content += `\n\nRealtime context:\n${ctx.join("\n\n")}`;

  for (const m of bodyMessages || []) {
    if (!m || !m.content) continue;
    if (m.role === "system") continue;
    if (m.role === "assistant" && isGarbage(String(m.content))) continue;
    const role = m.role === "assistant" ? "assistant" : "user";
    let content = String(m.content).slice(0, 6000);
    content = cleanModelText(content);
    if (!content) continue;
    out.push({ role, content });
  }
  return out;
}

async function listModels(base) {
  const hit = modelCache.get(base);
  if (hit && Date.now() - hit.at < 60_000) return hit.ids;
  try {
    const res = await fetch(`${base}/v1/models`, {
      signal: AbortSignal.timeout(2000),
    });
    if (!res.ok) return hit?.ids || [];
    const data = await res.json();
    const ids = (data.data || []).map((d) => d.id).filter(Boolean);
    modelCache.set(base, { at: Date.now(), ids });
    return ids;
  } catch {
    return hit?.ids || [];
  }
}

function pickModel(available, preferred) {
  if (!available.length) return preferred;
  if (preferred && available.includes(preferred)) return preferred;
  const lower = (preferred || "").toLowerCase();
  const partial = available.find(
    (id) =>
      id.toLowerCase() === lower ||
      id.toLowerCase().includes(lower) ||
      lower.includes(id.toLowerCase()),
  );
  if (partial) return partial;
  const scored = available.map((id) => {
    const l = id.toLowerCase();
    let s = 0;
    if (/embed|image|whisper|tts|stable-diffusion/i.test(l)) s -= 100;
    if (/hermes.*8b|abliterated/i.test(l)) s += 80;
    if (/hermes/i.test(l)) s += 40;
    if (/llama3\.2|llama-3/i.test(l)) s += 30;
    if (/code|coder/i.test(l)) s -= 5;
    return { id, s };
  });
  scored.sort((a, b) => b.s - a.s);
  return scored[0]?.id || preferred;
}

async function chatCompletions(base, model, messages, opts = {}) {
  const res = await fetch(`${base}/v1/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: "Bearer not-needed",
    },
    body: JSON.stringify({
      model,
      messages,
      temperature: opts.temperature ?? 0.3,
      max_tokens: opts.max_tokens ?? 280,
      stream: false,
      // Hint for backends that support it — keep completions tight
      stop: opts.stop,
    }),
    signal: AbortSignal.timeout(opts.timeoutMs ?? 90_000),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`${base} HTTP ${res.status}: ${text.slice(0, 200)}`);
  }
  return res.json();
}

async function chatGrok(messages, opts = {}) {
  const key = process.env.XAI_API_KEY?.trim();
  if (!key) throw new Error("XAI_API_KEY not set");
  if (Date.now() < grokCooldownUntil) {
    throw new Error("Grok on cooldown after prior failure");
  }
  const res = await fetch("https://api.x.ai/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${key}`,
    },
    body: JSON.stringify({
      model: GROK_MODEL,
      messages,
      temperature: opts.temperature ?? 0.3,
      max_tokens: opts.max_tokens ?? 280,
    }),
    signal: AbortSignal.timeout(opts.timeoutMs ?? 12_000),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    if (res.status === 403 || /credit|license|permission/i.test(text)) {
      grokCooldownUntil = Date.now() + 15 * 60_000;
    }
    throw new Error(`Grok HTTP ${res.status}: ${text.slice(0, 200)}`);
  }
  return res.json();
}

function tavilySummary(live) {
  if (!live?.hits?.length) return "";
  return (
    live.hits.find((h) => h.title === "Tavily summary")?.snippet ||
    live.hits.map((h) => h.snippet).filter(Boolean).join(" ").slice(0, 500)
  );
}

/** Simple factoid questions can return Tavily's answer without waiting on an LLM. */
function isSimpleFactoid(prompt) {
  const q = (prompt || "").trim();
  if (q.length > 140) return false;
  if (
    /\b(explain|compare|analyze|write|code|list all|how do i|step by step|joke|poem)\b/i.test(
      q,
    )
  ) {
    return false;
  }
  // Prefer direct search answers for current-events style asks
  return (
    LIVE_TOPICS.test(q) ||
    TEMPORAL.test(q) ||
    /\b(who is|who's|who won|current president|president of|ceo of|prime minister)\b/i.test(
      q,
    )
  );
}

function completionFromText(content, model, meta) {
  return {
    id: `chatcmpl-proxy-${Date.now()}`,
    object: "chat.completion",
    created: Math.floor(Date.now() / 1000),
    model,
    choices: [
      {
        index: 0,
        message: { role: "assistant", content },
        finish_reason: "stop",
      },
    ],
    _cortex: meta,
  };
}

function trimHistory(messages, maxTurns = 6) {
  // Keep system + last N user/assistant turns
  const system = messages.filter((m) => m.role === "system");
  const rest = messages.filter((m) => m.role !== "system");
  return [...system, ...rest.slice(-maxTurns)];
}

async function tryLocalChat(body, messages, opts) {
  const preferred =
    typeof body.model === "string" &&
    body.model &&
    !/jarvis-auto|auto|default/i.test(body.model)
      ? body.model
      : DEFAULT_LOCAL_MODEL;

  for (const base of [LM_STUDIO, OLLAMA]) {
    const available = await listModels(base);
    const model = pickModel(available, preferred);
    const data = await chatCompletions(base, model, messages, opts);
    let content = cleanModelText(data.choices?.[0]?.message?.content || "");
    if (!content || isGarbage(content)) {
      throw new Error(`${base}: garbage/empty`);
    }
    data.choices[0].message.content = content;
    data.model = data.model || model;
    data._cortex = {
      route: base.includes("1234") ? "lmstudio" : "ollama",
      live: opts.liveProvider || null,
      ms: opts.t0 ? Date.now() - opts.t0 : undefined,
    };
    return data;
  }
  throw new Error("no local backend");
}

async function answerChat(body) {
  const t0 = Date.now();
  const rawMessages = Array.isArray(body.messages) ? body.messages : [];
  const userText = lastUserText(rawMessages);
  const wantsLive = needsLiveData(userText);
  const errors = [];

  let live = null;
  if (wantsLive) {
    live = await fetchLive(userText.slice(0, 400));
  }

  // Fast path: Tavily already answered a simple fact — skip LLM (~300ms vs ~2s+)
  if (FAST_SEARCH && wantsLive && isSimpleFactoid(userText)) {
    const summary = tavilySummary(live);
    if (summary && summary.length > 20) {
      return completionFromText(summary, "tavily-fast", {
        route: "tavily-fast",
        live: live?.provider || null,
        ms: Date.now() - t0,
      });
    }
  }

  let messages = buildMessages(rawMessages, live, wantsLive);
  messages = trimHistory(messages, 6);

  // Tight caps — long max_tokens is the main local latency driver
  const clientMax = Number(body.max_tokens);
  const simpleLocal =
    /^[\d\s+\-*/().=?x]+$/i.test(userText) || userText.length < 40;
  const defaultCap = wantsLive ? 180 : simpleLocal ? 64 : 220;
  const maxTokens = Math.min(
    Number.isFinite(clientMax) && clientMax > 0
      ? Math.min(clientMax, 400)
      : defaultCap,
    400,
  );
  const temperature = body.temperature ?? 0.3;
  const grokReady =
    Boolean(process.env.XAI_API_KEY?.trim()) && Date.now() >= grokCooldownUntil;

  // Default: LM Studio first (local, predictable). Grok only if requested / mode=grok.
  const tryGrok =
    grokReady && (MODE === "grok" || USE_GROK_FIRST || process.env.JARVIS_USE_GROK === "1");

  if (tryGrok) {
    try {
      const data = await chatGrok(messages, {
        temperature,
        max_tokens: maxTokens,
        timeoutMs: 10_000,
      });
      let content = cleanModelText(data.choices?.[0]?.message?.content || "");
      if (content && !isGarbage(content)) {
        data.choices[0].message.content = content;
        data.model = data.model || GROK_MODEL;
        data._cortex = {
          route: "grok",
          live: live?.provider || null,
          ms: Date.now() - t0,
        };
        return data;
      }
      errors.push("grok: empty or garbage");
    } catch (e) {
      errors.push(`grok: ${e.message}`);
    }
  }

  try {
    return await tryLocalChat(body, messages, {
      temperature,
      max_tokens: maxTokens,
      liveProvider: live?.provider || null,
      t0,
    });
  } catch (e) {
    errors.push(e instanceof Error ? e.message : String(e));
  }

  // Fallback: Tavily summary without LLM
  const summary = tavilySummary(live);
  if (summary) {
    return completionFromText(summary, "live-search-only", {
      route: "search-only",
      live: live?.provider || null,
      ms: Date.now() - t0,
      errors,
    });
  }

  throw new Error(
    `No chat backend answered. Start LM Studio on :1234 and/or set XAI_API_KEY.\n${errors.join("\n")}`,
  );
}

function sendJson(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Content-Length": Buffer.byteLength(body),
    "Access-Control-Allow-Origin": "*",
  });
  res.end(body);
}

async function readBody(req) {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const raw = Buffer.concat(chunks).toString("utf8");
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url || "/", `http://127.0.0.1:${PORT}`);
  const method = req.method || "GET";

  if (method === "OPTIONS") {
    res.writeHead(204, {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type,Authorization",
    });
    res.end();
    return;
  }

  try {
    if (method === "GET" && (url.pathname === "/health" || url.pathname === "/")) {
      sendJson(res, 200, {
        status: "ok",
        service: "cortex-jarvis-chat-proxy",
        mode: MODE,
        lmStudio: LM_STUDIO,
        grok: Boolean(process.env.XAI_API_KEY?.trim()),
        tavily: Boolean(process.env.TAVILY_API_KEY?.trim()),
      });
      return;
    }

    if (method === "GET" && (url.pathname === "/v1/models" || url.pathname === "/models")) {
      const ids = new Set();
      for (const base of [LM_STUDIO, OLLAMA]) {
        for (const id of await listModels(base)) ids.add(id);
      }
      if (process.env.XAI_API_KEY?.trim()) ids.add(GROK_MODEL);
      if (!ids.size) ids.add(DEFAULT_LOCAL_MODEL);
      sendJson(res, 200, {
        object: "list",
        data: [...ids].map((id) => ({
          id,
          object: "model",
          created: Math.floor(Date.now() / 1000),
          owned_by: "cortex-proxy",
        })),
      });
      return;
    }

    if (
      method === "POST" &&
      (url.pathname === "/v1/chat/completions" ||
        url.pathname === "/chat/completions")
    ) {
      const body = await readBody(req);
      const data = await answerChat(body);
      sendJson(res, 200, data);
      return;
    }

    sendJson(res, 404, { error: `Not found: ${method} ${url.pathname}` });
  } catch (e) {
    console.error("[jarvis-proxy]", e);
    sendJson(res, 500, {
      error: {
        message: e instanceof Error ? e.message : String(e),
        type: "proxy_error",
      },
    });
  }
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(
    `[jarvis-proxy] listening on http://127.0.0.1:${PORT} mode=${MODE} lmstudio=${LM_STUDIO}`,
  );
  console.log(
    `[jarvis-proxy] grok=${Boolean(process.env.XAI_API_KEY?.trim())} tavily=${Boolean(process.env.TAVILY_API_KEY?.trim())}`,
  );
});
