import type { McpServerDefinition, McpServerState } from "./types";
import { secretPresent } from "../env/secrets";

/**
 * Built-in MCP servers for Cortex + OpenJarvis.
 * Secrets are never hard-coded — only env var *names* are referenced.
 */
export const MCP_CATALOG: McpServerDefinition[] = [
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
    id: "brave-search",
    name: "Brave Search",
    description:
      "Independent web & local search via Brave Search API (privacy-focused index).",
    homepage:
      "https://github.com/modelcontextprotocol/servers/tree/main/src/brave-search",
    transport: "stdio",
    command: "npx",
    args: ["-y", "@modelcontextprotocol/server-brave-search"],
    envVars: [
      {
        key: "BRAVE_API_KEY",
        label: "Brave Search API key",
        required: true,
        secret: true,
        placeholder: "BSA…",
        docsUrl: "https://brave.com/search/api/",
      },
    ],
    tags: ["search", "web"],
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
];

export function defaultMcpStates(): McpServerState[] {
  return MCP_CATALOG.map((s) => ({
    id: s.id,
    // Brave requires a paid API key — off unless the user opts in
    enabled: s.id !== "brave-search",
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
  const command = useDocker ? "docker" : def.command;
  const args = useDocker ? [...(def.docker?.args ?? def.args)] : [...def.args];

  const env: Record<string, string> = {};
  for (const e of def.envVars) {
    const fromOverride = state?.envOverrides?.[e.key];
    const fromProcess = process.env[e.key];
    const val = (fromOverride || fromProcess || "").trim();
    if (val) env[e.key] = val;
  }

  return { command, args, env };
}
