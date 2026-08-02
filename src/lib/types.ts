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
}

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
  costUsd: number;
  latencyMs: number;
  createdAt: string;
}

export type VoiceInputMode = "auto" | "builtin" | "external";

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
}

export interface AppState {
  agents: Agent[];
  ideas: Idea[];
  projects: Project[];
  activity: ActivityEvent[];
  usage: UsageRecord[];
  settings: AppSettings;
  version: number;
}
