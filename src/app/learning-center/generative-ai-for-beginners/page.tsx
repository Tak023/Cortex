"use client";

import Link from "next/link";
import { ExternalLink, Wand2 } from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { CourseOutline } from "@/components/learning/CourseOutline";
import { Button } from "@/components/ui/Button";
import { Card, CardBody } from "@/components/ui/Card";
import {
  GENAI_BEGINNERS_COLLECTION,
  GENAI_BEGINNERS_DISCORD,
  GENAI_BEGINNERS_GITHUB,
  GENAI_BEGINNERS_SITE,
  GENAI_BEGINNERS_UNITS,
  genaiBeginnersUrl,
} from "@/lib/learning/generative-ai-for-beginners";

export default function GenerativeAiForBeginnersPage() {
  return (
    <>
      <PageHeader
        title="Generative AI for Beginners"
        description="Microsoft’s 21-lesson course for building Generative AI apps in Python and TypeScript"
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <a
              href={GENAI_BEGINNERS_GITHUB}
              target="_blank"
              rel="noopener noreferrer"
            >
              <Button type="button" size="sm">
                <Wand2 className="h-4 w-4" />
                Open course
              </Button>
            </a>
            <a
              href={GENAI_BEGINNERS_SITE}
              target="_blank"
              rel="noopener noreferrer"
            >
              <Button type="button" variant="secondary" size="sm">
                <ExternalLink className="h-4 w-4" />
                Web version
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
                href={GENAI_BEGINNERS_GITHUB}
                target="_blank"
                rel="noopener noreferrer"
                className="text-sky-300 hover:underline"
              >
                microsoft/generative-ai-for-beginners
              </a>
              . Lessons are Learn (concepts) or Build (Python and TypeScript
              samples for Azure OpenAI, OpenAI, or Foundry Local). Start with
              setup, then open any lesson README below.
            </p>
            <p className="text-xs text-muted">
              <a
                href={GENAI_BEGINNERS_COLLECTION}
                target="_blank"
                rel="noopener noreferrer"
                className="text-sky-300 hover:underline"
              >
                Extra learning
              </a>
              {" · "}
              <a
                href={GENAI_BEGINNERS_DISCORD}
                target="_blank"
                rel="noopener noreferrer"
                className="text-sky-300 hover:underline"
              >
                Discord
              </a>
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
          units={GENAI_BEGINNERS_UNITS}
          lessonUrl={genaiBeginnersUrl}
          initiallyOpen="setup"
        />
      </div>
    </>
  );
}
