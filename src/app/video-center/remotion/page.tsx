"use client";

import Link from "next/link";
import { Clapperboard, ExternalLink } from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { CourseOutline } from "@/components/learning/CourseOutline";
import { Button } from "@/components/ui/Button";
import { Card, CardBody } from "@/components/ui/Card";
import {
  REMOTION_DOCS,
  REMOTION_GITHUB,
  REMOTION_UNITS,
  remotionUrl,
} from "@/lib/video/remotion";

export default function RemotionPage() {
  return (
    <>
      <PageHeader
        title="Remotion"
        description="Make videos programmatically with React"
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <a href={REMOTION_DOCS} target="_blank" rel="noopener noreferrer">
              <Button type="button" size="sm">
                <Clapperboard className="h-4 w-4" />
                Open docs
              </Button>
            </a>
            <a href={REMOTION_GITHUB} target="_blank" rel="noopener noreferrer">
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
              This is{" "}
              <a
                href={REMOTION_GITHUB}
                target="_blank"
                rel="noopener noreferrer"
                className="text-sky-300 hover:underline"
              >
                remotion-dev/remotion
              </a>
              — video tools for the agent era. Create videos with a coding
              agent, edit in Remotion Studio, or write React as the source of
              truth. Start a project with{" "}
              <code className="rounded bg-white/5 px-1.5 py-0.5 text-[12px]">
                npx create-video@latest
              </code>
              . Docs live at{" "}
              <a
                href={REMOTION_DOCS}
                target="_blank"
                rel="noopener noreferrer"
                className="text-sky-300 hover:underline"
              >
                remotion.dev/docs
              </a>
              . Remotion has a special license for companies — read it before
              shipping.
            </p>
            <p className="text-xs text-muted">
              Source: github.com/remotion-dev/remotion
              {" · "}
              <Link
                href="/video-center"
                className="text-sky-300 hover:underline"
              >
                Video Center
              </Link>
            </p>
          </CardBody>
        </Card>

        <CourseOutline
          units={REMOTION_UNITS}
          lessonUrl={remotionUrl}
          initiallyOpen="start"
        />
      </div>
    </>
  );
}
