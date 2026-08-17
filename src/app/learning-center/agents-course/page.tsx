"use client";

import Link from "next/link";
import { ExternalLink, GraduationCap } from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { CourseOutline } from "@/components/learning/CourseOutline";
import { Button } from "@/components/ui/Button";
import { Card, CardBody } from "@/components/ui/Card";
import {
  AGENTS_COURSE_GITHUB,
  AGENTS_COURSE_HOME,
  AGENTS_COURSE_SIGNUP,
  AGENTS_COURSE_UNITS,
  agentsCourseLessonUrl,
} from "@/lib/learning/agents-course";

export default function AgentsCoursePage() {
  return (
    <>
      <PageHeader
        title="Hugging Face Agent Course"
        description="Official free course — from agent basics to a certified final project"
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <a href={AGENTS_COURSE_HOME} target="_blank" rel="noopener noreferrer">
              <Button type="button" size="sm">
                <GraduationCap className="h-4 w-4" />
                Open course
              </Button>
            </a>
            <a
              href={AGENTS_COURSE_GITHUB}
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
                href={AGENTS_COURSE_HOME}
                target="_blank"
                rel="noopener noreferrer"
                className="text-sky-300 hover:underline"
              >
                Hugging Face Agents Course
              </a>
              . Lessons, quizzes, and the certificate live on Hugging Face Learn
              (the site blocks embedding). Open a unit below — Cortex will launch
              the official lesson.
            </p>
            <p className="text-xs text-muted">
              Source:{" "}
              <a
                href={AGENTS_COURSE_GITHUB}
                target="_blank"
                rel="noopener noreferrer"
                className="text-sky-300 hover:underline"
              >
                github.com/huggingface/agents-course
              </a>
              {" · "}
              <a
                href={AGENTS_COURSE_SIGNUP}
                target="_blank"
                rel="noopener noreferrer"
                className="text-sky-300 hover:underline"
              >
                Free signup
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
          units={AGENTS_COURSE_UNITS}
          lessonUrl={agentsCourseLessonUrl}
          initiallyOpen="unit0"
        />
      </div>
    </>
  );
}
