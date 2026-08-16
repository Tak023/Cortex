import fs from "fs";
import os from "os";
import path from "path";
import type { McpServerDefinition, McpServerState } from "./types";
import { secretPresent } from "../env/secrets";

/**
 * Local RivalSearchMCP install (no API key — stdio via uv).
 * Override with RIVALSEARCH_MCP_DIR if the clone lives elsewhere.
 */
export function resolveRivalSearchDir(): string {
  // Prefer the full local clone (with .venv) over a thin package copy.
  const candidates = [
    process.env.RIVALSEARCH_MCP_DIR?.trim(),
    process.env.CORTEX_PROJECT_ROOT
      ? path.join(process.env.CORTEX_PROJECT_ROOT, "RivalSearchMCP")
      : "",
    path.join(os.homedir(), "Projects/Grok/Cortex/RivalSearchMCP"),
    path.join(process.cwd(), "RivalSearchMCP"),
    path.join(process.cwd(), "..", "RivalSearchMCP"),
  ].filter(Boolean) as string[];

  for (const dir of candidates) {
    try {
      if (fs.existsSync(path.join(dir, "server.py"))) return dir;
    } catch {
      /* ignore */
    }
  }
  return candidates[0] || path.join(process.cwd(), "RivalSearchMCP");
}

export function resolveUvCommand(): string {
  const fromEnv = process.env.UV_BIN?.trim();
  if (fromEnv && fs.existsSync(fromEnv)) return fromEnv;
  const candidates = [
    path.join(os.homedir(), ".local/bin/uv"),
    "/opt/homebrew/bin/uv",
    "/usr/local/bin/uv",
  ];
  for (const c of candidates) {
    try {
      if (fs.existsSync(c)) return c;
    } catch {
      /* ignore */
    }
  }
  return "uv";
}

/** Resolve uvx (used by heventure-search-mcp and other uv tools). */
export function resolveUvxCommand(): string {
  const fromEnv = process.env.UVX_BIN?.trim();
  if (fromEnv && fs.existsSync(fromEnv)) return fromEnv;
  const candidates = [
    path.join(os.homedir(), ".local/bin/uvx"),
    "/opt/homebrew/bin/uvx",
    "/usr/local/bin/uvx",
  ];
  for (const c of candidates) {
    try {
      if (fs.existsSync(c)) return c;
    } catch {
      /* ignore */
    }
  }
  // uvx ships with uv — fall back to sibling of uv
  const uv = resolveUvCommand();
  if (uv !== "uv") {
    const sibling = path.join(path.dirname(uv), "uvx");
    if (fs.existsSync(sibling)) return sibling;
  }
  return "uvx";
}

/** Matches Hermes mcp_servers.web-search launch. */
export function heventureSearchArgs(): string[] {
  return ["--with", "mcp<2", "heventure-search-mcp"];
}

export function rivalSearchInstalled(): boolean {
  try {
    return fs.existsSync(path.join(resolveRivalSearchDir(), "server.py"));
  } catch {
    return false;
  }
}

function rivalSearchArgs(): string[] {
  return [
    "run",
    "--directory",
    resolveRivalSearchDir(),
    "python",
    "server.py",
  ];
}

/**
 * Built-in MCP servers for Cortex + OpenJarvis.
 * Secrets are never hard-coded — only env var *names* are referenced.
 */
export const MCP_CATALOG: McpServerDefinition[] = [
  {
    id: "rival-search",
    name: "RivalSearchMCP",
    description:
      "Free multi-source research (web, news, social, academic, GitHub, docs) — local stdio via uv, no API key.",
    homepage: "https://github.com/damionrashford/RivalSearchMCP",
    transport: "stdio",
    // command/args resolved at launch so paths stay correct on each machine
    command: "uv",
    args: [
      "run",
      "--directory",
      "RivalSearchMCP",
      "python",
      "server.py",
    ],
    envVars: [],
    tags: ["search", "research", "web", "news", "free"],
  },
  {
    id: "heventure-search",
    name: "Heventure Search",
    description:
      "Free API-key-free web search MCP (DuckDuckGo, Bing, Google) — same as Hermes web-search via uvx heventure-search-mcp.",
    homepage: "https://github.com/HughesCuit/heventure-search-mcp",
    transport: "stdio",
    command: "uvx",
    // Matches ~/.hermes/config.yaml mcp_servers.web-search
    args: ["--with", "mcp<2", "heventure-search-mcp"],
    envVars: [],
    tags: ["search", "web", "free", "duckduckgo", "bing"],
  },
  {
    id: "firecrawl",
    name: "Firecrawl",
    description:
      "Web scraping, crawling, map, and extract — turn sites into clean LLM-ready data.",
    homepage: "https://docs.firecrawl.dev/mcp-server",
    transport: "stdio",
    command: "npx",
    args: ["-y", "firecrawl-mcp"],
    envVars: [
      {
        key: "FIRECRAWL_API_KEY",
        label: "Firecrawl API key",
        required: true,
        secret: true,
        placeholder: "fc-…",
        docsUrl: "https://www.firecrawl.dev/app/api-keys",
      },
    ],
    tags: ["web", "scrape", "crawl", "research"],
  },
  {
    id: "playwright",
    name: "Playwright",
    description:
      "Browser automation — navigate, click, fill forms, and capture pages with Playwright.",
    homepage: "https://github.com/microsoft/playwright-mcp",
    transport: "stdio",
    command: "npx",
    args: ["-y", "@playwright/mcp@latest"],
    envVars: [],
    tags: ["browser", "automation", "testing"],
  },
  {
    id: "tavily",
    name: "Tavily",
    description:
      "AI-optimized web search with citations — strong for research agents.",
    homepage: "https://docs.tavily.com/documentation/mcp",
    transport: "stdio",
    command: "npx",
    args: ["-y", "tavily-mcp@latest"],
    envVars: [
      {
        key: "TAVILY_API_KEY",
        label: "Tavily API key",
        required: true,
        secret: true,
        placeholder: "tvly-…",
        docsUrl: "https://app.tavily.com/home",
      },
    ],
    tags: ["search", "research", "web"],
  },
  {
    id: "github",
    name: "GitHub",
    description:
      "Official GitHub MCP server — repos, issues, PRs, code search, and Actions.",
    homepage: "https://github.com/github/github-mcp-server",
    transport: "stdio",
    // Prefer docker image from GitHub (most reliable for the official server)
    command: "docker",
    args: [
      "run",
      "-i",
      "--rm",
      "-e",
      "GITHUB_PERSONAL_ACCESS_TOKEN",
      "ghcr.io/github/github-mcp-server",
    ],
    docker: {
      image: "ghcr.io/github/github-mcp-server",
      args: [
        "run",
        "-i",
        "--rm",
        "-e",
        "GITHUB_PERSONAL_ACCESS_TOKEN",
        "ghcr.io/github/github-mcp-server",
      ],
    },
    envVars: [
      {
        key: "GITHUB_PERSONAL_ACCESS_TOKEN",
        label: "GitHub personal access token",
        required: true,
        secret: true,
        placeholder: "ghp_… or github_pat_…",
        docsUrl: "https://github.com/settings/tokens",
      },
    ],
    tags: ["github", "git", "code", "devops"],
  },
  {
    id: "lancedb",
    name: "LanceDB",
    description:
      "Embedded vector / full-text database for the second brain and research history — local, no API key.",
    homepage: "https://github.com/lancedb/lancedb",
    transport: "stdio",
    command: "cortex-embedded",
    args: ["lancedb"],
    envVars: [],
    tags: ["vector", "search", "memory", "local", "fts"],
  },
];

export function defaultMcpStates(): McpServerState[] {
  return MCP_CATALOG.map((s) => ({
    id: s.id,
    enabled: true,
    useDocker: s.id === "github",
  }));
}

export function getMcpDefinition(
  id: string,
): McpServerDefinition | undefined {
  return MCP_CATALOG.find((s) => s.id === id);
}

/** Whether process.env has a non-empty value for this key */
export function envKeyPresent(key: string): boolean {
  return secretPresent(key);
}

export function resolveMcpLaunch(
  def: McpServerDefinition,
  state?: McpServerState,
): { command: string; args: string[]; env: Record<string, string> } {
  const useDocker = state?.useDocker && def.docker;
  let command = useDocker ? "docker" : def.command;
  let args = useDocker ? [...(def.docker?.args ?? def.args)] : [...def.args];

  // Local RivalSearchMCP: absolute uv + project dir (matches Hermes config)
  if (def.id === "rival-search" && !useDocker) {
    command = resolveUvCommand();
    args = rivalSearchArgs();
  }

  // Heventure Search: absolute uvx + package args (matches Hermes web-search)
  if (def.id === "heventure-search" && !useDocker) {
    command = resolveUvxCommand();
    args = heventureSearchArgs();
  }

  if (def.id === "lancedb") {
    command = "cortex-embedded";
    args = ["lancedb"];
  }

  const env: Record<string, string> = {};
  for (const e of def.envVars) {
    const fromOverride = state?.envOverrides?.[e.key];
    const fromProcess = process.env[e.key];
    const val = (fromOverride || fromProcess || "").trim();
    if (val) env[e.key] = val;
  }

  return { command, args, env };
}
