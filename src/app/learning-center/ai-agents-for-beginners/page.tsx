"use client";

import Link from "next/link";
import { Bot, ExternalLink } from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { CourseOutline } from "@/components/learning/CourseOutline";
import { Button } from "@/components/ui/Button";
import { Card, CardBody } from "@/components/ui/Card";
import {
  AI_AGENTS_BEGINNERS_COLLECTION,
  AI_AGENTS_BEGINNERS_DISCORD,
  AI_AGENTS_BEGINNERS_GITHUB,
  AI_AGENTS_BEGINNERS_UNITS,
  aiAgentsBeginnersUrl,
} from "@/lib/learning/ai-agents-for-beginners";

export default function AiAgentsForBeginnersPage() {
  return (
    <>
      <PageHeader
        title="AI Agents for Beginners"
        description="Microsoft’s 18-lesson course for building AI agents with Microsoft Agent Framework"
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <a
              href={AI_AGENTS_BEGINNERS_GITHUB}
              target="_blank"
              rel="noopener noreferrer"
            >
              <Button type="button" size="sm">
                <Bot className="h-4 w-4" />
                Open course
              </Button>
            </a>
            <a
              href={AI_AGENTS_BEGINNERS_COLLECTION}
              target="_blank"
              rel="noopener noreferrer"
            >
              <Button type="button" variant="secondary" size="sm">
                <ExternalLink className="h-4 w-4" />
                Extra learning
              </Button>
            </a>
          </div>
        }
      />

      <div className="flex-1 overflow-y-auto p-6 space-y-5">
        <Card>
          <CardBody className="space-y-2 text-sm leading-relaxed text-foreground/90">
            <p>
              This is{" "}
              <a
                href={AI_AGENTS_BEGINNERS_GITHUB}
                target="_blank"
                rel="noopener noreferrer"
                className="text-sky-300 hover:underline"
              >
                microsoft/ai-agents-for-beginners
              </a>
              . Eighteen lessons cover agent frameworks, design patterns, RAG,
              multi-agent systems, MCP, memory, and shipping agents with
              Microsoft Foundry. Each item opens that lesson’s README on GitHub.
            </p>
            <p className="text-xs text-muted">
              <a
                href={AI_AGENTS_BEGINNERS_DISCORD}
                target="_blank"
                rel="noopener noreferrer"
                className="text-sky-300 hover:underline"
              >
                Discord
              </a>
              {" · "}
              <Link
                href="/learning-center/generative-ai-for-beginners"
                className="text-sky-300 hover:underline"
              >
                Generative AI for Beginners
              </Link>
              {" · "}
              <Link
                href="/learning-center"
                className="text-sky-300 hover:underline"
              >
                All courses
              </Link>
            </p>
          </CardBody>
        </Card>

        <CourseOutline
          units={AI_AGENTS_BEGINNERS_UNITS}
          lessonUrl={aiAgentsBeginnersUrl}
          initiallyOpen="setup"
        />
      </div>
    </>
  );
}
