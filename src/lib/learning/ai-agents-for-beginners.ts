/**
 * AI Agents for Beginners — official 18-lesson course from
 * https://github.com/microsoft/ai-agents-for-beginners
 */
import type { CourseUnit } from "./types";

export const AI_AGENTS_BEGINNERS_GITHUB =
  "https://github.com/microsoft/ai-agents-for-beginners";
export const AI_AGENTS_BEGINNERS_DISCORD = "https://aka.ms/ai-agents/discord";
export const AI_AGENTS_BEGINNERS_COLLECTION =
  "https://aka.ms/ai-agents-beginners/collection";

export function aiAgentsBeginnersUrl(path: string): string {
  const clean = path.replace(/^\/+/, "");
  if (!clean) return AI_AGENTS_BEGINNERS_GITHUB;
  if (clean.startsWith("http://") || clean.startsWith("https://")) return clean;
  const kind = /\.[a-z0-9]+$/i.test(clean) ? "blob" : "tree";
  return `${AI_AGENTS_BEGINNERS_GITHUB}/${kind}/main/${clean}`;
}

export const AI_AGENTS_BEGINNERS_UNITS: CourseUnit[] = [
  {
    id: "setup",
    label: "00",
    title: "Course setup",
    description: "Fork the repo and configure Microsoft Agent Framework / Foundry.",
    lessons: [
      { slug: "00-course-setup/README.md", title: "How to set up your environment" },
      { slug: "README.md", title: "Course README" },
      { slug: "STUDY_GUIDE.md", title: "Study guide" },
    ],
  },
  {
    id: "foundations",
    label: "01–06",
    title: "Foundations",
    description: "What agents are, frameworks, design patterns, tools, RAG, and trust.",
    lessons: [
      {
        slug: "01-intro-to-ai-agents/README.md",
        title: "01 · Intro to AI agents and use cases",
      },
      {
        slug: "02-explore-agentic-frameworks/README.md",
        title: "02 · Exploring agentic frameworks",
      },
      {
        slug: "03-agentic-design-patterns/README.md",
        title: "03 · Agentic design patterns",
      },
      { slug: "04-tool-use/README.md", title: "04 · Tool-use design pattern" },
      { slug: "05-agentic-rag/README.md", title: "05 · Agentic RAG" },
      {
        slug: "06-building-trustworthy-agents/README.md",
        title: "06 · Building trustworthy agents",
      },
    ],
  },
  {
    id: "patterns",
    label: "07–11",
    title: "Planning, teams & protocols",
    description: "Planning, multi-agent, metacognition, production, MCP / A2A / NLWeb.",
    lessons: [
      { slug: "07-planning-design/README.md", title: "07 · Planning design pattern" },
      { slug: "08-multi-agent/README.md", title: "08 · Multi-agent design pattern" },
      { slug: "09-metacognition/README.md", title: "09 · Metacognition design pattern" },
      {
        slug: "10-ai-agents-production/README.md",
        title: "10 · AI agents in production",
      },
      {
        slug: "11-agentic-protocols/README.md",
        title: "11 · Agentic protocols (MCP, A2A, NLWeb)",
      },
    ],
  },
  {
    id: "advanced",
    label: "12–18",
    title: "Memory, Microsoft Agent Framework & shipping",
    description:
      "Context, memory, MAF, computer use, scale, local agents, and security.",
    lessons: [
      {
        slug: "12-context-engineering/README.md",
        title: "12 · Context engineering",
      },
      { slug: "13-agent-memory/README.md", title: "13 · Managing agentic memory" },
      {
        slug: "14-microsoft-agent-framework/README.md",
        title: "14 · Microsoft Agent Framework",
      },
      { slug: "15-browser-use/README.md", title: "15 · Computer-use agents (CUA)" },
      {
        slug: "16-deploying-scalable-agents/README.md",
        title: "16 · Deploying scalable agents",
      },
      {
        slug: "17-creating-local-ai-agents/README.md",
        title: "17 · Creating local AI agents",
      },
      { slug: "18-securing-ai-agents/README.md", title: "18 · Securing AI agents" },
    ],
  },
];
