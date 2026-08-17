"use client";

import Link from "next/link";
import { ChefHat, ExternalLink } from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { CourseOutline } from "@/components/learning/CourseOutline";
import { Button } from "@/components/ui/Button";
import { Card, CardBody } from "@/components/ui/Card";
import {
  OPENAI_COOKBOOK_GITHUB,
  OPENAI_COOKBOOK_HOME,
  OPENAI_COOKBOOK_SIGNUP,
  OPENAI_COOKBOOK_UNITS,
  openaiCookbookUrl,
} from "@/lib/learning/openai-cookbook";

export default function OpenaiCookbookPage() {
  return (
    <>
      <PageHeader
        title="OpenAI Cookbook"
        description="Official examples and guides for common OpenAI API tasks"
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <a
              href={OPENAI_COOKBOOK_HOME}
              target="_blank"
              rel="noopener noreferrer"
            >
              <Button type="button" size="sm">
                <ChefHat className="h-4 w-4" />
                Open cookbook
              </Button>
            </a>
            <a
              href={OPENAI_COOKBOOK_GITHUB}
              target="_blank"
              rel="noopener noreferrer"
            >
              <Button type="button" variant="secondary" size="sm">
                <ExternalLink className="h-4 w-4" />
                GitHub
              </Button>
            </a>
          </div>
        }
      />

      <div className="flex-1 overflow-y-auto p-6 space-y-5">
        <Card>
          <CardBody className="space-y-2 text-sm leading-relaxed text-foreground/90">
            <p>
              This is the{" "}
              <a
                href={OPENAI_COOKBOOK_GITHUB}
                target="_blank"
                rel="noopener noreferrer"
                className="text-sky-300 hover:underline"
              >
                openai/openai-cookbook
              </a>
              . Guides render at{" "}
              <a
                href={OPENAI_COOKBOOK_HOME}
                target="_blank"
                rel="noopener noreferrer"
                className="text-sky-300 hover:underline"
              >
                cookbook.openai.com
              </a>
              . Open a topic below for agents, prompting, embeddings, audio,
              fine-tuning, gpt-oss, and Codex. You need an{" "}
              <a
                href={OPENAI_COOKBOOK_SIGNUP}
                target="_blank"
                rel="noopener noreferrer"
                className="text-sky-300 hover:underline"
              >
                OpenAI API key
              </a>{" "}
              to run the notebooks.
            </p>
            <p className="text-xs text-muted">
              Source: github.com/openai/openai-cookbook
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
          units={OPENAI_COOKBOOK_UNITS}
          lessonUrl={openaiCookbookUrl}
          initiallyOpen="start"
        />
      </div>
    </>
  );
}
