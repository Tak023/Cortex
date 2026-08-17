"use client";

import Link from "next/link";
import { BookOpen, Bot, ChefHat, GraduationCap, Hammer, Wand2 } from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { Card, CardBody } from "@/components/ui/Card";

const COURSES = [
  {
    href: "/learning-center/agents-course",
    title: "Hugging Face Agent Course",
    blurb:
      "Free course from the basics of agents to a certified final project — smolagents, LlamaIndex, LangGraph, and Agentic RAG.",
    Icon: GraduationCap,
    accent:
      "border-amber-400/30 bg-amber-500/10 text-amber-200",
  },
  {
    href: "/learning-center/llms-from-scratch",
    title: "LLMs from Scratch",
    blurb:
      "Implement a ChatGPT-like LLM in PyTorch from scratch — tokenization, attention, GPT, pretraining, and finetuning.",
    Icon: BookOpen,
    accent: "border-sky-400/30 bg-sky-500/10 text-sky-200",
  },
  {
    href: "/learning-center/openai-cookbook",
    title: "OpenAI Cookbook",
    blurb:
      "Official examples for the OpenAI API — agents, prompting, embeddings, audio, fine-tuning, and Codex.",
    Icon: ChefHat,
    accent: "border-emerald-400/30 bg-emerald-500/10 text-emerald-200",
  },
  {
    href: "/learning-center/build-your-own-x",
    title: "Build Your Own X",
    blurb:
      "Step-by-step guides to rebuild Git, Redis, Docker, compilers, browsers, and more from scratch.",
    Icon: Hammer,
    accent: "border-violet-400/30 bg-violet-500/10 text-violet-200",
  },
  {
    href: "/learning-center/generative-ai-for-beginners",
    title: "Generative AI for Beginners",
    blurb:
      "Microsoft’s 21-lesson course — prompts, chat, RAG, images, agents, and fine-tuning in Python and TypeScript.",
    Icon: Wand2,
    accent: "border-rose-400/30 bg-rose-500/10 text-rose-200",
  },
  {
    href: "/learning-center/ai-agents-for-beginners",
    title: "AI Agents for Beginners",
    blurb:
      "Microsoft’s 18-lesson course — agent patterns, RAG, multi-agent, MCP, memory, and Microsoft Agent Framework.",
    Icon: Bot,
    accent: "border-orange-400/30 bg-orange-500/10 text-orange-200",
  },
];

export default function LearningCenterPage() {
  return (
    <>
      <PageHeader
        title="Learning Center"
        description="Courses and labs you can work through from Cortex"
      />
      <div className="flex-1 overflow-y-auto p-6">
        <div className="grid max-w-3xl gap-3 sm:grid-cols-2">
          {COURSES.map(({ href, title, blurb, Icon, accent }) => (
            <Link key={href} href={href} className="block">
              <Card className="h-full transition-colors hover:border-sky-400/40 hover:bg-white/5">
                <CardBody className="flex items-start gap-3">
                  <span
                    className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border ${accent}`}
                  >
                    <Icon className="h-5 w-5" />
                  </span>
                  <div className="min-w-0">
                    <div className="text-sm font-semibold">{title}</div>
                    <p className="mt-1 text-xs leading-relaxed text-muted">
                      {blurb}
                    </p>
                  </div>
                </CardBody>
              </Card>
            </Link>
          ))}
        </div>
      </div>
    </>
  );
}
