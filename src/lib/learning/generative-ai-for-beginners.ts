/**
 * Generative AI for Beginners — official 21-lesson course from
 * https://github.com/microsoft/generative-ai-for-beginners
 */
import type { CourseUnit } from "./types";

export const GENAI_BEGINNERS_GITHUB =
  "https://github.com/microsoft/generative-ai-for-beginners";
export const GENAI_BEGINNERS_SITE =
  "https://microsoft.github.io/generative-ai-for-beginners/";
export const GENAI_BEGINNERS_DISCORD = "https://aka.ms/genai-discord";
export const GENAI_BEGINNERS_COLLECTION = "https://aka.ms/genai-collection";

export function genaiBeginnersUrl(path: string): string {
  const clean = path.replace(/^\/+/, "");
  if (!clean) return GENAI_BEGINNERS_GITHUB;
  if (clean.startsWith("http://") || clean.startsWith("https://")) return clean;
  const kind = /\.[a-z0-9]+$/i.test(clean) ? "blob" : "tree";
  return `${GENAI_BEGINNERS_GITHUB}/${kind}/main/${clean}`;
}

export const GENAI_BEGINNERS_UNITS: CourseUnit[] = [
  {
    id: "setup",
    label: "00",
    title: "Course setup",
    description: "Set up Python or TypeScript and Azure OpenAI, OpenAI, or Foundry Local.",
    lessons: [
      { slug: "00-course-setup/README.md", title: "How to set up your environment" },
      { slug: "README.md", title: "Course README" },
    ],
  },
  {
    id: "learn",
    label: "01–05",
    title: "Learn the fundamentals",
    description: "What GenAI and LLMs are, responsible use, and prompt engineering.",
    lessons: [
      {
        slug: "01-introduction-to-genai/README.md",
        title: "01 · Introduction to Generative AI and LLMs",
      },
      {
        slug: "02-exploring-and-comparing-different-llms/README.md",
        title: "02 · Exploring and comparing LLMs",
      },
      {
        slug: "03-using-generative-ai-responsibly/README.md",
        title: "03 · Using Generative AI responsibly",
      },
      {
        slug: "04-prompt-engineering-fundamentals/README.md",
        title: "04 · Prompt engineering fundamentals",
      },
      {
        slug: "05-advanced-prompts/README.md",
        title: "05 · Creating advanced prompts",
      },
    ],
  },
  {
    id: "build",
    label: "06–11",
    title: "Build applications",
    description: "Text, chat, search, images, low-code, and function calling.",
    lessons: [
      {
        slug: "06-text-generation-apps/README.md",
        title: "06 · Text generation applications",
      },
      {
        slug: "07-building-chat-applications/README.md",
        title: "07 · Chat applications",
      },
      {
        slug: "08-building-search-applications/README.md",
        title: "08 · Search apps and vector databases",
      },
      {
        slug: "09-building-image-applications/README.md",
        title: "09 · Image generation applications",
      },
      {
        slug: "10-building-low-code-ai-applications/README.md",
        title: "10 · Low-code AI applications",
      },
      {
        slug: "11-integrating-with-function-calling/README.md",
        title: "11 · Function calling",
      },
    ],
  },
  {
    id: "ship",
    label: "12–14",
    title: "Design, security & lifecycle",
    description: "UX for AI apps, threats, and LLMOps.",
    lessons: [
      {
        slug: "12-designing-ux-for-ai-applications/README.md",
        title: "12 · Designing UX for AI applications",
      },
      {
        slug: "13-securing-ai-applications/README.md",
        title: "13 · Securing Generative AI applications",
      },
      {
        slug: "14-the-generative-ai-application-lifecycle/README.md",
        title: "14 · The Generative AI application lifecycle",
      },
    ],
  },
  {
    id: "advanced",
    label: "15–21",
    title: "RAG, agents, and model families",
    description: "RAG, Hugging Face, agents, fine-tuning, SLMs, Mistral, and Meta.",
    lessons: [
      {
        slug: "15-rag-and-vector-databases/README.md",
        title: "15 · RAG and vector databases",
      },
      {
        slug: "16-open-source-models/README.md",
        title: "16 · Open-source models and Hugging Face",
      },
      { slug: "17-ai-agents/README.md", title: "17 · AI agents" },
      { slug: "18-fine-tuning/README.md", title: "18 · Fine-tuning LLMs" },
      { slug: "19-slm/README.md", title: "19 · Building with SLMs" },
      { slug: "20-mistral/README.md", title: "20 · Building with Mistral models" },
      { slug: "21-meta/README.md", title: "21 · Building with Meta models" },
    ],
  },
];
