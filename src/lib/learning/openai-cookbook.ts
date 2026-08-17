/**
 * OpenAI Cookbook — official examples from
 * https://github.com/openai/openai-cookbook (registry.yaml → cookbook.openai.com).
 */
import type { CourseUnit } from "./types";

export const OPENAI_COOKBOOK_HOME = "https://cookbook.openai.com";
export const OPENAI_COOKBOOK_GITHUB =
  "https://github.com/openai/openai-cookbook";
export const OPENAI_COOKBOOK_SIGNUP = "https://platform.openai.com/signup";

export function openaiCookbookUrl(slug: string): string {
  const clean = slug.replace(/^\/+/, "");
  if (!clean) return OPENAI_COOKBOOK_HOME;
  if (clean.startsWith("http://") || clean.startsWith("https://")) return clean;
  if (
    clean.startsWith("examples/") ||
    clean.startsWith("articles/") ||
    clean.endsWith(".ipynb") ||
    clean.endsWith(".md")
  ) {
    const kind = /\.[a-z0-9]+$/i.test(clean) ? "blob" : "tree";
    return `${OPENAI_COOKBOOK_GITHUB}/${kind}/main/${clean}`;
  }
  return `${OPENAI_COOKBOOK_HOME}/${clean}`;
}

export const OPENAI_COOKBOOK_UNITS: CourseUnit[] = [
  {
    id: "start",
    label: "Start",
    title: "Using the Cookbook",
    description: "Official site, GitHub source, and API key setup.",
    lessons: [
      { slug: "", title: "cookbook.openai.com" },
      { slug: "README.md", title: "Repository README" },
      { slug: "examples", title: "All example notebooks" },
      { slug: "articles", title: "Articles" },
    ],
  },
  {
    id: "agents",
    label: "Agents",
    title: "Agents SDK & orchestration",
    description: "Build, migrate, memory, sandbox, and multi-agent workflows.",
    lessons: [
      { slug: "agentkit-walkthrough", title: "AgentKit walkthrough" },
      { slug: "session-memory", title: "Short-term memory with Sessions" },
      {
        slug: "multi-agent-portfolio-collaboration",
        title: "Multi-agent portfolio collaboration",
      },
      {
        slug: "migrate-from-claude-agent-sdk",
        title: "Migrate from Claude Agent SDK",
      },
      { slug: "computer-use-with-daytona", title: "Computer Use in a sandbox" },
      { slug: "orchestrating-agents", title: "Routines and handoffs" },
    ],
  },
  {
    id: "models",
    label: "Models",
    title: "GPT-5, prompting & Responses",
    description: "Prompting, reasoning, tools, and the Responses API.",
    lessons: [
      { slug: "gpt-5-prompting-guide", title: "GPT-5 prompting guide" },
      { slug: "gpt-5-new-params-and-tools", title: "GPT-5 params and tools" },
      { slug: "gpt-5-frontend", title: "Frontend coding with GPT-5" },
      { slug: "prompt-optimization-cookbook", title: "Prompt optimizer" },
      { slug: "reasoning-items", title: "Reasoning items (Responses API)" },
      { slug: "responses-example", title: "Web search and state" },
      { slug: "mcp-tool-guide", title: "Responses API MCP tool" },
    ],
  },
  {
    id: "embeddings",
    label: "RAG",
    title: "Embeddings, search & RAG",
    description: "Classic embedding notebooks plus retrieval patterns.",
    lessons: [
      { slug: "using-embeddings", title: "Using embeddings" },
      {
        slug: "semantic-text-search-using-embeddings",
        title: "Semantic text search",
      },
      {
        slug: "question-answering-using-embeddings",
        title: "Q&A with embeddings",
      },
      { slug: "image-understanding-with-rag", title: "Image understanding with RAG" },
      { slug: "rag-with-graph-db", title: "RAG with a graph database" },
      { slug: "examples/vector_databases", title: "Vector database examples" },
    ],
  },
  {
    id: "audio",
    label: "Audio",
    title: "Realtime, speech & video",
    description: "Realtime API, transcription, Sora, and vision.",
    lessons: [
      { slug: "realtime-prompting-guide", title: "Realtime prompting guide" },
      { slug: "speech-transcription-methods", title: "Speech-to-text methods" },
      {
        slug: "migrating-from-whisper-to-gpt-transcribe",
        title: "Migrate Whisper → GPT-Transcribe",
      },
      { slug: "sora2-prompting-guide", title: "Sora 2 prompting guide" },
      { slug: "vision-understanding", title: "Vision and document understanding" },
    ],
  },
  {
    id: "finetune",
    label: "Tune",
    title: "Fine-tuning & evals",
    description: "SFT, DPO, RFT, and evaluation workflows.",
    lessons: [
      {
        slug: "fine-tuning-direct-preference-optimization-guide",
        title: "SFT vs DPO vs RFT",
      },
      { slug: "reinforcement-fine-tuning", title: "Reinforcement fine-tuning" },
      { slug: "optimize-prompts", title: "Optimize prompts" },
      { slug: "getting-started-with-openai-evals", title: "Getting started with Evals" },
    ],
  },
  {
    id: "oss",
    label: "Open",
    title: "gpt-oss & local models",
    description: "Run and fine-tune open-weight models locally.",
    lessons: [
      { slug: "run-locally-ollama", title: "Run gpt-oss with Ollama" },
      { slug: "run-locally-lmstudio", title: "Run gpt-oss with LM Studio" },
      { slug: "run-vllm", title: "Run gpt-oss with vLLM" },
      { slug: "run-transformers", title: "Run gpt-oss with Transformers" },
      { slug: "openai-harmony", title: "Harmony response format" },
    ],
  },
  {
    id: "codex",
    label: "Codex",
    title: "Codex & automation",
    description: "Goals, exec plans, and CLI/Agents SDK workflows.",
    lessons: [
      { slug: "using-goals-in-codex", title: "Using Goals in Codex" },
      { slug: "codex-exec-plans", title: "PLANS.md for long jobs" },
      {
        slug: "building-consistent-workflows-codex-cli-agents-sdk",
        title: "Codex CLI + Agents SDK",
      },
      { slug: "jira-github", title: "Automate Jira ↔ GitHub" },
    ],
  },
];
