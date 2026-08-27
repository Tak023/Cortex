/** Cortex core domain types */

export type AgentStatus = "online" | "idle" | "busy" | "error" | "offline";
export type AgentType = "cloud" | "local";
export type AgentRole =
  | "planner"
  | "coder"
  | "researcher"
  | "critic"
  | "architect"
  | "tester"
  | "generalist";

export type PipelinePhase =
  | "research"
  | "planning"
  | "architecture"
  | "implementation"
  | "testing"
  | "polish";

export type TaskStatus =
  | "pending"
  | "queued"
  | "running"
  | "awaiting_approval"
  | "approved"
  | "rejected"
  | "completed"
  | "failed"
  | "paused";

export type ProjectStatus =
  | "draft"
  | "concepts"
  | "running"
  | "paused"
  | "awaiting_approval"
  | "completed"
  | "failed";

export interface AgentMetrics {
  tokensUsed: number;
  avgLatencyMs: number;
  successRate: number;
  tasksCompleted: number;
  tasksFailed: number;
  /**
   * Where these numbers came from. Registry defaults ship as "seeded" so a
   * demo tile can never be mistaken for a measurement; the first real
   * invocation flips the agent to "measured".
   */
  source?: MetricsSource;
}

/**
 * - seeded:    registry placeholder, never observed
 * - simulated: produced by the simulation adapter, not a real model call
 * - measured:  observed from a live agent invocation
 */
export type MetricsSource = "seeded" | "simulated" | "measured";

export interface Agent {
  id: string;
  name: string;
  slug: string;
  type: AgentType;
  roles: AgentRole[];
  status: AgentStatus;
  capabilities: string[];
  strengths: Partial<Record<PipelinePhase | "brainstorm", number>>; // 0–100
  currentTaskId: string | null;
  currentTaskLabel: string | null;
  description: string;
  model?: string;
  config: AgentConfig;
  metrics: AgentMetrics;
  lastSeenAt: string;
}

export interface AgentConfig {
  enabled: boolean;
  apiKeyEnv?: string;
  systemPrompt: string;
  toolAccess: string[];
  modelOverride?: string;
  maxConcurrent: number;
  /**
   * Operator-declared price in USD per 1k tokens, used to break ties inside
   * the metered cost tier. Left unset by default — Cortex will not invent a
   * price it cannot verify.
   */
  costPer1kUsd?: number;
  /**
   * Adapter-specific options (e.g. OpenJarvis agent name, base URL override).
   * Kept open so future integrations don't need schema migrations.
   */
  extras?: Record<string, unknown>;
}

export interface Concept {
  id: string;
  title: string;
  summary: string;
  features: string[];
  stack: string[];
  difficulty: "easy" | "medium" | "hard";
  estimatedEffort: string;
  agentsUsed: string[];
  score: number;
}

export interface Idea {
  id: string;
  statement: string;
  templateId: string | null;
  concepts: Concept[];
  selectedConceptId: string | null;
  projectId: string | null;
  createdAt: string;
  status: "draft" | "generating" | "ready" | "selected";
}

export interface Artifact {
  id: string;
  name: string;
  kind: "doc" | "code" | "plan" | "test" | "note" | "export";
  content: string;
  phase: PipelinePhase | "concept";
  agentId: string;
  createdAt: string;
}

export interface Task {
  id: string;
  projectId: string;
  phase: PipelinePhase;
  title: string;
  description: string;
  status: TaskStatus;
  agentId: string | null;
  dependsOn: string[];
  artifacts: Artifact[];
  progress: number; // 0–100
  requiresApproval: boolean;
  outputSummary: string | null;
  startedAt: string | null;
  completedAt: string | null;
  estimatedMinutes: number;
  order: number;
  /** How many automatic recovery attempts have been used for this stage */
  retryCount?: number;
  /** Cap for automatic stage recovery (default applied by engine) */
  maxRetries?: number;
  /** Last error message when status is failed or during recovery */
  lastError?: string | null;
  /**
   * Agents that already failed this task. The router escalates past them
   * instead of retrying the agent that just failed.
   */
  failedAgentIds?: string[];
  /** Why the router chose the current agent — shown in the project timeline. */
  routingReason?: string | null;
}

export interface ProjectMessage {
  id: string;
  role: "system" | "user" | "agent";
  agentId?: string;
  content: string;
  createdAt: string;
}

export interface Project {
  id: string;
  name: string;
  ideaId: string;
  conceptId: string;
  concept: Concept;
  status: ProjectStatus;
  tasks: Task[];
  messages: ProjectMessage[];
  artifacts: Artifact[];
  sharedMemory: Record<string, string>;
  createdAt: string;
  updatedAt: string;
  paused: boolean;
  /**
   * Absolute path on disk where pipeline artifacts were written when the
   * project finished (or was exported). Surfaced in the UI so users know
   * where to find the deliverables.
   */
  workspacePath?: string | null;
  /** Absolute path to scaffolded app (`…/app`) when implementation built source */
  appPath?: string | null;
  /** Local URL to open after `npm run dev` (e.g. http://127.0.0.1:3456) */
  launchUrl?: string | null;
  /** Shell command to start the app */
  launchCommand?: string | null;
  /** Last build/test outcome for UI visibility */
  buildStatus?: "pending" | "passed" | "failed" | null;
  /** Human-readable unresolved errors after auto-fix attempts */
  unresolvedErrors?: string[];
  /** Full last verify report (also stored as artifact) */
  lastVerifyReport?: string | null;
  /**
   * Step-by-step instructions when orchestration cannot auto-resolve a
   * failed stage (shown in project UI + conversation).
   */
  resolutionGuide?: string[] | null;
}

export interface ActivityEvent {
  id: string;
  type:
    | "agent_status"
    | "task_start"
    | "task_complete"
    | "handoff"
    | "approval_needed"
    | "approval_resolved"
    | "concept_generated"
    | "project_created"
    | "error"
    | "info";
  message: string;
  agentId?: string;
  projectId?: string;
  taskId?: string;
  createdAt: string;
}

export interface AppTemplate {
  id: string;
  name: string;
  description: string;
  icon: string;
  defaultPhases: PipelinePhase[];
  suggestedStack: string[];
  promptHint: string;
}

export interface UsageRecord {
  id: string;
  agentId: string;
  projectId?: string;
  tokens: number;
  /**
   * Marginal USD cost. Zero for local models and for work covered by a
   * subscription — only metered usage consumes a budget.
   */
  costUsd: number;
  latencyMs: number;
  createdAt: string;
  /** Task class this run served, so spend can be attributed to a lane. */
  taskClass?: TaskClass;
  /** Cost tier at dispatch time, for auditing routing decisions. */
  costTier?: string;
}

/** Re-exported from ./agents/taskClass so state types stay in one file. */
export type TaskClass = import("./agents/taskClass").TaskClass;

/**
 * Outcome history for one (agent, task class) pair — the evidence the router
 * uses to decide whether a cheaper agent is allowed to take a class.
 */
export interface RoutingStat {
  agentId: string;
  taskClass: TaskClass;
  /** Real (non-simulated) attempts. */
  attempts: number;
  successes: number;
  /** Simulated runs, tracked separately and never used for routing. */
  simulatedAttempts: number;
  totalTokens: number;
  totalLatencyMs: number;
  totalCostUsd: number;
  lastAt: string;
  lastError: string | null;
}

/**
 * - quality-first: curated specialist wins, cost ignored (pre-0.2.12 behaviour)
 * - cost-aware:    cheapest agent that clears the success bar, escalate on failure
 * - local-first:   as cost-aware, but a local model must fail before paid work
 */
export type RoutingPolicy = "quality-first" | "cost-aware" | "local-first";

/** One resolved routing decision, kept for display and for audit. */
export interface RoutingDecision {
  agentId: string | null;
  agentName: string;
  taskClass: TaskClass;
  policy: RoutingPolicy;
  costTier: string;
  /** Observed success rate on this class, or null when unproven. */
  successRate: number | null;
  attempts: number;
  /** Why this agent and not the others. */
  reason: string;
  /** Agents that were considered and rejected, cheapest first. */
  rejected: Array<{ agentId: string; name: string; reason: string }>;
  /** Escalation ladder if this agent fails, cheapest to most expensive. */
  escalationPath: string[];
  estimatedCostUsd: number;
  budgetBlocked: boolean;
}

export type VoiceInputMode = "auto" | "builtin" | "external";

/**
 * One fleet-wide approval posture, translated into each CLI's own flags at
 * launch. "inherit" keeps whatever the CLI defaults to (the pre-0.2.12
 * behaviour, where Claude Code sat in manual mode and Grok in always-approve
 * purely by accident).
 */
export type AgentApprovalPolicy = "inherit" | "read-only" | "ask" | "auto";

/** How much of the filesystem an embedded agent terminal can see. */
export type AgentWorkspaceScope = "project" | "custom" | "home";

/** Which credential wins when an agent has both a plan session and an API key. */
export type ClaudeAuthPreference = "auto" | "subscription" | "api-key";

/** OpenJarvis default agent modes (see jarvis ask -a …) */
export type JarvisAgentMode =
  | "simple"
  | "orchestrator"
  | "deep_research"
  | "operative"
  | "native_react"
  | "native_openhands"
  | string;

export interface AppSettings {
  xaiApiKeySet: boolean;
  simulationSpeedMs: number;
  autoApprove: boolean;
  defaultLocalModel: string;
  /**
   * Preferred voice-to-text mode for VoiceTextArea defaults.
   * - auto: built-in mic recording when available, else external dictation
   * - builtin: MediaRecorder + Whisper (on-device or server)
   * - external: Whisperflow / macOS Dictation / system VTT
   */
  voiceInputMode: VoiceInputMode;

  // ── Fleet governance (embedded agent terminals) ──
  /** Fleet-wide approval posture applied to every CLI that supports one. */
  agentApprovalPolicy: AgentApprovalPolicy;
  /** Filesystem scope for embedded terminals. */
  agentWorkspaceScope: AgentWorkspaceScope;
  /** Directory used when scope is "custom" (or as the project fallback). */
  agentWorkspaceDir: string;
  /** Which Claude credential wins when a plan session and an API key coexist. */
  claudeAuthPreference: ClaudeAuthPreference;
  /**
   * Render registry placeholder metrics. When false, unmeasured tiles show
   * "—" instead of a plausible-looking number.
   */
  showSeededMetrics: boolean;

  // ── Routing policy & budgets ──
  /** How the router trades quality against marginal cost. */
  routingPolicy: RoutingPolicy;
  /**
   * Minimum observed success rate on a class before a cheaper agent may take
   * it from the curated specialist (0–1).
   */
  routingMinSuccessRate: number;
  /** Real attempts required before a success rate is trusted at all. */
  routingMinAttempts: number;
  /**
   * Let an unproven cheaper agent try a low-stakes class so it can earn
   * evidence. Without this the router can never learn anything new.
   */
  routingExploreUnproven: boolean;
  /** Hard cap on metered spend per calendar day, USD. null = uncapped. */
  dailyBudgetUsd: number | null;
  /** Hard cap on metered spend per project, USD. null = uncapped. */
  projectBudgetUsd: number | null;
  /**
   * Let the Implementation phase run a coding agent with write access inside
   * the project workspace. When false (or when the approval policy is
   * read-only) the phase produces the starter scaffold only.
   */
  codegenEnabled: boolean;

  // ── Second brain (Obsidian vault) ──
  /**
   * When true (and the vault exists), Jarvis grounds answers in local notes
   * and the pipeline reads/writes the vault as long-term memory.
   */
  vaultEnabled: boolean;
  /** Path to the Obsidian vault (supports ~). Env CORTEX_VAULT_DIR overrides. */
  vaultDir: string;

  // ── OpenJarvis integration (https://github.com/open-jarvis/OpenJarvis) ──
  /** Master switch for the OpenJarvis adapter */
  jarvisEnabled: boolean;
  /** Base URL for `jarvis serve` OpenAI-compatible API */
  jarvisBaseUrl: string;
  /**
   * OpenAI-compatible base for interactive Jarvis chat (LM Studio / Ollama).
   * Default: LM Studio local server.
   */
  jarvisChatBaseUrl: string;
  /**
   * Model id for interactive chat (LM Studio key or Ollama tag).
   * Default: gulan28/Hermes-3-Llama-3.1-8B-abliterated-GGUF via LM Studio.
   * Use "auto" to pick the best model listed by the live backend.
   */
  jarvisChatModel: string;
  /**
   * Interactive Jarvis routing:
   * - hybrid: LM Studio for private chat; Grok + live search for current events
   * - local: LM Studio / Ollama only (still injects Tavily when available)
   * - grok: always use xAI Grok when key is set
   */
  jarvisChatMode: "hybrid" | "local" | "grok";
  /** Default Jarvis agent name (orchestrator, simple, deep_research, …) */
  jarvisDefaultAgent: JarvisAgentMode;
  /** CLI binary name or absolute path */
  jarvisCliPath: string;
  /** Prefer CLI over HTTP when both work */
  jarvisPreferCli: boolean;
  /** Per-request timeout (ms) */
  jarvisTimeoutMs: number;
  /**
   * When true, pipeline research/planning/architecture phases use live
   * OpenJarvis when those agents are selected (falls back to simulation).
   */
  jarvisUseInPipeline: boolean;

  /**
   * MCP server enablement / launch prefs (Firecrawl, Playwright, Tavily, …).
   * API keys stay in process env; this only tracks which servers are on.
   */
  mcpServers: import("./mcp/types").McpServerState[];
  /** Per-agent MCP tool allow/deny lists */
  mcpPermissions: import("./mcp/types").McpAgentPermissions[];
  /** Isolated stdio client timeouts */
  mcpTimeouts: import("./mcp/types").McpTimeouts;
}

export interface AppState {
  agents: Agent[];
  ideas: Idea[];
  projects: Project[];
  activity: ActivityEvent[];
  usage: UsageRecord[];
  /** Per-(agent, class) outcome history driving the router. */
  routingStats?: RoutingStat[];
  settings: AppSettings;
  version: number;
}
