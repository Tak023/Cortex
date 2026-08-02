import fs from "fs";
import path from "path";
import type {
  ActivityEvent,
  Agent,
  AppSettings,
  AppState,
  Idea,
  Project,
  UsageRecord,
} from "./types";
import { DEFAULT_AGENTS } from "./agents/registry";
import { defaultMcpStates } from "./mcp/catalog";
import type { McpServerState } from "./mcp/types";
import { ensureSecretsLoaded } from "./env/secrets";

// Packaged Electron may not inject env before Next boots — load secrets first.
ensureSecretsLoaded();

/**
 * Local-first persistence.
 * - Web/dev: ./data under the project
 * - Desktop (Electron): CORTEX_DATA_DIR → OS userData/data
 */
function resolveDataDir(): string {
  if (process.env.CORTEX_DATA_DIR) {
    return process.env.CORTEX_DATA_DIR;
  }
  return path.join(process.cwd(), "data");
}

const DATA_DIR = resolveDataDir();
const STATE_FILE = path.join(DATA_DIR, "state.json");

/** Absolute path to Cortex's local data directory (state + workspaces). */
export function getDataDir(): string {
  return resolveDataDir();
}

function parseJarvisChatMode(
  raw: string | undefined,
): AppSettings["jarvisChatMode"] {
  const m = (raw || "hybrid").trim().toLowerCase();
  if (m === "local" || m === "lmstudio" || m === "ollama") return "local";
  if (m === "grok" || m === "cloud" || m === "xai") return "grok";
  return "hybrid";
}

function defaultSettings(): AppSettings {
  return {
    xaiApiKeySet: Boolean(process.env.XAI_API_KEY?.trim()),
    simulationSpeedMs: 1800,
    autoApprove: false,
    defaultLocalModel:
      "lmstudio-community/Qwen3-Coder-30B-A3B-Instruct-MLX-4bit",
    voiceInputMode: "auto",
    jarvisEnabled: true,
    jarvisBaseUrl: process.env.JARVIS_BASE_URL || "http://127.0.0.1:8000",
    jarvisChatBaseUrl:
      process.env.JARVIS_CHAT_BASE_URL || "http://127.0.0.1:1234",
    jarvisChatModel:
      process.env.JARVIS_MODEL ||
      process.env.JARVIS_CHAT_MODEL ||
      "gulan28/Hermes-3-Llama-3.1-8B-abliterated-GGUF",
    jarvisChatMode: parseJarvisChatMode(
      process.env.JARVIS_CHAT_MODE || "hybrid",
    ),
    jarvisDefaultAgent: "orchestrator",
    jarvisCliPath: process.env.JARVIS_CLI || "jarvis",
    jarvisPreferCli: false,
    jarvisTimeoutMs: 120_000,
    jarvisUseInPipeline: true,
    mcpServers: defaultMcpStates(),
  };
}

/** Merge MCP catalog defaults with saved prefs (add new servers on upgrade). */
export function mergeMcpStates(
  saved: McpServerState[] | undefined,
): McpServerState[] {
  const defaults = defaultMcpStates();
  if (!saved?.length) return defaults;
  const byId = new Map(saved.map((s) => [s.id, s]));
  return defaults.map((d) => {
    const prev = byId.get(d.id);
    return prev ? { ...d, ...prev, id: d.id } : d;
  });
}

function defaultState(): AppState {
  return {
    agents: DEFAULT_AGENTS.map((a) => ({
      ...a,
      lastSeenAt: new Date().toISOString(),
    })),
    ideas: [],
    projects: [],
    activity: [
      {
        id: "evt-boot",
        type: "info",
        message: "Cortex control plane online — agents registered.",
        createdAt: new Date().toISOString(),
      },
    ],
    usage: [],
    settings: defaultSettings(),
    version: 1,
  };
}

let memory: AppState | null = null;
let writeTimer: ReturnType<typeof setTimeout> | null = null;

function ensureDir() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
}

function load(): AppState {
  if (memory) return memory;
  ensureDir();
  try {
    if (fs.existsSync(STATE_FILE)) {
      const raw = fs.readFileSync(STATE_FILE, "utf-8");
      const parsed = JSON.parse(raw) as AppState;
      // Merge default agents if new ones appear (e.g. OpenJarvis after upgrade)
      const byId = new Map(parsed.agents.map((a) => [a.id, a]));
      let agentsAdded = 0;
      for (const def of DEFAULT_AGENTS) {
        if (!byId.has(def.id)) {
          parsed.agents.push({ ...def, lastSeenAt: new Date().toISOString() });
          agentsAdded += 1;
        }
      }
      const defaults = defaultSettings();
      parsed.settings = {
        ...defaults,
        ...parsed.settings,
        xaiApiKeySet: Boolean(process.env.XAI_API_KEY?.trim()),
        jarvisChatMode: parseJarvisChatMode(
          parsed.settings?.jarvisChatMode || defaults.jarvisChatMode,
        ),
        mcpServers: mergeMcpStates(parsed.settings?.mcpServers),
      };
      memory = parsed;
      if (agentsAdded > 0) {
        // Persist so upgrades stick across restarts
        persist();
      }
      return memory;
    }
  } catch {
    // fall through
  }
  memory = defaultState();
  persist();
  return memory;
}

function persist() {
  if (!memory) return;
  ensureDir();
  const snapshot = JSON.stringify(memory, null, 2);
  // Debounce disk writes
  if (writeTimer) clearTimeout(writeTimer);
  writeTimer = setTimeout(() => {
    try {
      fs.writeFileSync(STATE_FILE, snapshot, "utf-8");
    } catch (e) {
      console.error("Failed to persist state", e);
    }
  }, 50);
}

export function getState(): AppState {
  return load();
}

export function updateState(mutator: (state: AppState) => void): AppState {
  const state = load();
  mutator(state);
  persist();
  return state;
}

export function getAgents(): Agent[] {
  return load().agents;
}

export function getAgent(id: string): Agent | undefined {
  return load().agents.find((a) => a.id === id);
}

export function updateAgent(
  id: string,
  patch: Partial<Agent>,
): Agent | undefined {
  let updated: Agent | undefined;
  updateState((s) => {
    const idx = s.agents.findIndex((a) => a.id === id);
    if (idx === -1) return;
    s.agents[idx] = {
      ...s.agents[idx],
      ...patch,
      config: patch.config
        ? { ...s.agents[idx].config, ...patch.config }
        : s.agents[idx].config,
      metrics: patch.metrics
        ? { ...s.agents[idx].metrics, ...patch.metrics }
        : s.agents[idx].metrics,
      lastSeenAt: new Date().toISOString(),
    };
    updated = s.agents[idx];
  });
  return updated;
}

export function getIdeas(): Idea[] {
  return load().ideas;
}

export function getIdea(id: string): Idea | undefined {
  return load().ideas.find((i) => i.id === id);
}

export function upsertIdea(idea: Idea): Idea {
  updateState((s) => {
    const idx = s.ideas.findIndex((i) => i.id === idea.id);
    if (idx === -1) s.ideas.unshift(idea);
    else s.ideas[idx] = idea;
  });
  return idea;
}

export function getProjects(): Project[] {
  return load().projects;
}

export function getProject(id: string): Project | undefined {
  return load().projects.find((p) => p.id === id);
}

export function upsertProject(project: Project): Project {
  updateState((s) => {
    const idx = s.projects.findIndex((p) => p.id === project.id);
    if (idx === -1) s.projects.unshift(project);
    else s.projects[idx] = project;
  });
  return project;
}

/** Remove a project from state. Optionally delete workspace files on disk. */
export function deleteProject(
  id: string,
  opts: { deleteWorkspace?: boolean } = {},
): boolean {
  let removed: Project | undefined;
  updateState((s) => {
    const idx = s.projects.findIndex((p) => p.id === id);
    if (idx === -1) return;
    removed = s.projects[idx];
    s.projects.splice(idx, 1);
    // Detach idea link if present
    for (const idea of s.ideas) {
      if (idea.projectId === id) {
        idea.projectId = null;
        if (idea.status === "selected") idea.status = "ready";
      }
    }
    s.activity.unshift({
      id: `evt-del-${Date.now()}`,
      type: "info",
      message: `Project deleted: ${removed?.name ?? id}`,
      projectId: id,
      createdAt: new Date().toISOString(),
    });
    s.activity = s.activity.slice(0, 200);
  });

  if (removed && opts.deleteWorkspace !== false) {
    try {
      const dirs = [
        removed.workspacePath,
        removed.appPath ? path.dirname(removed.appPath) : null,
      ].filter(Boolean) as string[];
      for (const dir of dirs) {
        // Only delete under our data/workspaces tree for safety
        const root = path.join(resolveDataDir(), "workspaces");
        if (dir.startsWith(root) && fs.existsSync(dir)) {
          fs.rmSync(dir, { recursive: true, force: true });
        }
      }
    } catch (e) {
      console.error("workspace delete failed", e);
    }
  }

  return Boolean(removed);
}

export function pushActivity(
  event: Omit<ActivityEvent, "id" | "createdAt"> & {
    id?: string;
    createdAt?: string;
  },
): ActivityEvent {
  const full: ActivityEvent = {
    id: event.id ?? `evt-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    createdAt: event.createdAt ?? new Date().toISOString(),
    type: event.type,
    message: event.message,
    agentId: event.agentId,
    projectId: event.projectId,
    taskId: event.taskId,
  };
  updateState((s) => {
    s.activity.unshift(full);
    s.activity = s.activity.slice(0, 200);
  });
  return full;
}

export function pushUsage(record: UsageRecord) {
  updateState((s) => {
    s.usage.unshift(record);
    s.usage = s.usage.slice(0, 500);
  });
}

export function getSettings(): AppSettings {
  return load().settings;
}

export function updateSettings(patch: Partial<AppSettings>): AppSettings {
  let next = defaultSettings();
  updateState((s) => {
    s.settings = { ...s.settings, ...patch };
    next = s.settings;
  });
  return next;
}

export function resetState(): AppState {
  memory = defaultState();
  persist();
  return memory;
}
