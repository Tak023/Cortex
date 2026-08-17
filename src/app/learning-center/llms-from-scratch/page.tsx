"use client";

import Link from "next/link";
import { BookOpen, ExternalLink } from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { CourseOutline } from "@/components/learning/CourseOutline";
import { Button } from "@/components/ui/Button";
import { Card, CardBody } from "@/components/ui/Card";
import {
  LLMS_FROM_SCRATCH_BOOK,
  LLMS_FROM_SCRATCH_GITHUB,
  LLMS_FROM_SCRATCH_SETUP,
  LLMS_FROM_SCRATCH_UNITS,
  LLMS_FROM_SCRATCH_VIDEO,
  llmsFromScratchUrl,
} from "@/lib/learning/llms-from-scratch";

export default function LlmsFromScratchPage() {
  return (
    <>
      <PageHeader
        title="LLMs from Scratch"
        description="Build a GPT-like LLM in PyTorch from scratch — official code for Sebastian Raschka’s book"
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <a
              href={LLMS_FROM_SCRATCH_GITHUB}
              target="_blank"
              rel="noopener noreferrer"
            >
              <Button type="button" size="sm">
                <BookOpen className="h-4 w-4" />
                Open repo
              </Button>
            </a>
            <a
              href={LLMS_FROM_SCRATCH_BOOK}
              target="_blank"
              rel="noopener noreferrer"
            >
              <Button type="button" variant="secondary" size="sm">
                <ExternalLink className="h-4 w-4" />
                Book
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
                href={LLMS_FROM_SCRATCH_GITHUB}
                target="_blank"
                rel="noopener noreferrer"
                className="text-sky-300 hover:underline"
              >
                rasbt/LLMs-from-scratch
              </a>
              , the official code for{" "}
              <em>Build a Large Language Model (From Scratch)</em>. Chapters 2–7
              are Jupyter notebooks plus Python scripts. Start with the setup
              guide, then open each chapter notebook on GitHub.
            </p>
            <p className="text-xs text-muted">
              <a
                href={LLMS_FROM_SCRATCH_SETUP}
                target="_blank"
                rel="noopener noreferrer"
                className="text-sky-300 hover:underline"
              >
                Setup
              </a>
              {" · "}
              <a
                href={LLMS_FROM_SCRATCH_VIDEO}
                target="_blank"
                rel="noopener noreferrer"
                className="text-sky-300 hover:underline"
              >
                Companion video
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
          units={LLMS_FROM_SCRATCH_UNITS}
          lessonUrl={llmsFromScratchUrl}
          initiallyOpen="setup"
        />
      </div>
    </>
  );
}
