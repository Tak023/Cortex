/**
 * Hugging Face Agents Course — official syllabus from
 * https://github.com/huggingface/agents-course (units/en/_toctree.yml).
 * Lessons live on Hugging Face Learn; the GitHub repo is the source.
 */
import type { CourseUnit } from "./types";

export const AGENTS_COURSE_HOME = "https://huggingface.co/learn/agents-course";
export const AGENTS_COURSE_SIGNUP = "https://bit.ly/hf-learn-agents";
export const AGENTS_COURSE_GITHUB =
  "https://github.com/huggingface/agents-course";

function lessonUrl(slug: string): string {
  return `${AGENTS_COURSE_HOME}/en/${slug}`;
}

export function agentsCourseLessonUrl(slug: string): string {
  return lessonUrl(slug);
}

export const AGENTS_COURSE_UNITS: CourseUnit[] = [
  {
    id: "unit0",
    label: "Unit 0",
    title: "Welcome to the course",
    description: "Welcome, guidelines, tools, and course overview.",
    lessons: [
      { slug: "unit0/introduction", title: "Welcome to the course" },
      { slug: "unit0/onboarding", title: "Onboarding" },
      { slug: "unit0/discord101", title: "(Optional) Discord 101" },
    ],
  },
  {
    id: "unit1",
    label: "Unit 1",
    title: "Introduction to Agents",
    description:
      "What agents and LLMs are, tools, the thought–action–observation loop, and your first smolagents agent.",
    lessons: [
      { slug: "unit1/introduction", title: "Introduction" },
      { slug: "unit1/what-are-agents", title: "What is an Agent?" },
      { slug: "unit1/quiz1", title: "Quick Quiz 1" },
      { slug: "unit1/what-are-llms", title: "What are LLMs?" },
      { slug: "unit1/messages-and-special-tokens", title: "Messages and Special Tokens" },
      { slug: "unit1/tools", title: "What are Tools?" },
      { slug: "unit1/quiz2", title: "Quick Quiz 2" },
      {
        slug: "unit1/agent-steps-and-structure",
        title: "Thought-Action-Observation Cycle",
      },
      { slug: "unit1/thoughts", title: "Thought and the ReAct Approach" },
      { slug: "unit1/actions", title: "Actions" },
      { slug: "unit1/observations", title: "Observe" },
      { slug: "unit1/dummy-agent-library", title: "Dummy Agent Library" },
      { slug: "unit1/tutorial", title: "First Agent with smolagents" },
      { slug: "unit1/final-quiz", title: "Unit 1 Final Quiz" },
      { slug: "unit1/conclusion", title: "Conclusion" },
    ],
  },
  {
    id: "unit2",
    label: "Unit 2",
    title: "Frameworks for AI Agents",
    description: "Overview of smolagents, LlamaIndex, and LangGraph.",
    lessons: [{ slug: "unit2/introduction", title: "Frameworks for AI Agents" }],
  },
  {
    id: "unit2-smolagents",
    label: "Unit 2.1",
    title: "The smolagents framework",
    description:
      "Build code agents, tool-calling agents, retrieval and multi-agent systems with smolagents.",
    lessons: [
      { slug: "unit2/smolagents/introduction", title: "Introduction to smolagents" },
      { slug: "unit2/smolagents/why_use_smolagents", title: "Why use smolagents?" },
      { slug: "unit2/smolagents/quiz1", title: "Quick Quiz 1" },
      { slug: "unit2/smolagents/code_agents", title: "Building Agents That Use Code" },
      {
        slug: "unit2/smolagents/tool_calling_agents",
        title: "Code snippets or JSON blobs",
      },
      { slug: "unit2/smolagents/tools", title: "Tools" },
      { slug: "unit2/smolagents/retrieval_agents", title: "Retrieval Agents" },
      { slug: "unit2/smolagents/quiz2", title: "Quick Quiz 2" },
      { slug: "unit2/smolagents/multi_agent_systems", title: "Multi-Agent Systems" },
      { slug: "unit2/smolagents/vision_agents", title: "Vision and Browser agents" },
      { slug: "unit2/smolagents/final_quiz", title: "Final Quiz" },
      { slug: "unit2/smolagents/conclusion", title: "Conclusion" },
    ],
  },
  {
    id: "unit2-llamaindex",
    label: "Unit 2.2",
    title: "The LlamaIndex framework",
    description: "Indexes, tools, and agentic workflows over your data.",
    lessons: [
      { slug: "unit2/llama-index/introduction", title: "Introduction to LlamaIndex" },
      { slug: "unit2/llama-index/llama-hub", title: "LlamaHub" },
      { slug: "unit2/llama-index/components", title: "Components" },
      { slug: "unit2/llama-index/tools", title: "Using Tools" },
      { slug: "unit2/llama-index/quiz1", title: "Quick Quiz 1" },
      { slug: "unit2/llama-index/agents", title: "Using Agents" },
      { slug: "unit2/llama-index/workflows", title: "Agentic Workflows" },
      { slug: "unit2/llama-index/quiz2", title: "Quick Quiz 2" },
      { slug: "unit2/llama-index/conclusion", title: "Conclusion" },
    ],
  },
  {
    id: "unit2-langgraph",
    label: "Unit 2.3",
    title: "The LangGraph framework",
    description: "Production graphs with explicit control over agent flow.",
    lessons: [
      { slug: "unit2/langgraph/introduction", title: "Introduction to LangGraph" },
      { slug: "unit2/langgraph/when_to_use_langgraph", title: "What is LangGraph?" },
      { slug: "unit2/langgraph/building_blocks", title: "Building Blocks" },
      { slug: "unit2/langgraph/first_graph", title: "Your First LangGraph" },
      {
        slug: "unit2/langgraph/document_analysis_agent",
        title: "Document Analysis Graph",
      },
      { slug: "unit2/langgraph/quiz1", title: "Quick Quiz 1" },
      { slug: "unit2/langgraph/conclusion", title: "Conclusion" },
    ],
  },
  {
    id: "unit3",
    label: "Unit 3",
    title: "Use Case for Agentic RAG",
    description: "Build an agent that retrieves, reasons, and uses tools over documents.",
    lessons: [
      {
        slug: "unit3/agentic-rag/introduction",
        title: "Introduction to Agentic RAG",
      },
      { slug: "unit3/agentic-rag/agentic-rag", title: "Agentic RAG" },
      { slug: "unit3/agentic-rag/invitees", title: "RAG Tool for Guest Stories" },
      { slug: "unit3/agentic-rag/tools", title: "Building and Integrating Tools" },
      { slug: "unit3/agentic-rag/agent", title: "Creating Your Gala Agent" },
      { slug: "unit3/agentic-rag/conclusion", title: "Conclusion" },
    ],
  },
  {
    id: "unit4",
    label: "Unit 4",
    title: "Final Project — Create, Test, and Certify Your Agent",
    description: "GAIA benchmark, hands-on submission, and certificate of excellence.",
    lessons: [
      { slug: "unit4/introduction", title: "Introduction to the Final Unit" },
      { slug: "unit4/what-is-gaia", title: "What is GAIA?" },
      { slug: "unit4/hands-on", title: "The Final Hands-On" },
      { slug: "unit4/get-your-certificate", title: "Get Your Certificate" },
      { slug: "unit4/conclusion", title: "Conclusion of the Course" },
      { slug: "unit4/additional-readings", title: "What Should You Learn Now?" },
    ],
  },
  {
    id: "bonus1",
    label: "Bonus 1",
    title: "Fine-tuning an LLM for Function-calling",
    description: "Fine-tune a model so it can call tools reliably.",
    lessons: [
      { slug: "bonus-unit1/introduction", title: "Introduction" },
      {
        slug: "bonus-unit1/what-is-function-calling",
        title: "What is Function Calling?",
      },
      { slug: "bonus-unit1/fine-tuning", title: "Fine-tune for Function-calling" },
      { slug: "bonus-unit1/conclusion", title: "Conclusion" },
    ],
  },
  {
    id: "bonus2",
    label: "Bonus 2",
    title: "Agent Observability and Evaluation",
    description: "Trace, monitor, and evaluate agents.",
    lessons: [
      { slug: "bonus-unit2/introduction", title: "Introduction" },
      {
        slug: "bonus-unit2/what-is-agent-observability-and-evaluation",
        title: "What is observability and evaluation?",
      },
      {
        slug: "bonus-unit2/monitoring-and-evaluating-agents-notebook",
        title: "Monitoring and evaluating agents",
      },
      { slug: "bonus-unit2/quiz", title: "Quiz" },
    ],
  },
  {
    id: "bonus3",
    label: "Bonus 3",
    title: "Agents in Games with Pokémon",
    description: "From LLMs to a Pokémon battle agent.",
    lessons: [
      { slug: "bonus-unit3/introduction", title: "Introduction" },
      { slug: "bonus-unit3/state-of-art", title: "LLMs in Games" },
      { slug: "bonus-unit3/from-llm-to-agents", title: "From LLMs to AI Agents" },
      {
        slug: "bonus-unit3/building_your_pokemon_agent",
        title: "Build Your Pokémon Battle Agent",
      },
      {
        slug: "bonus-unit3/launching_agent_battle",
        title: "Launching Your Battle Agent",
      },
      { slug: "bonus-unit3/conclusion", title: "Conclusion" },
    ],
  },
];
