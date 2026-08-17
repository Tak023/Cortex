"use client";

import Link from "next/link";
import { ExternalLink, Workflow } from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { CourseOutline } from "@/components/learning/CourseOutline";
import { Button } from "@/components/ui/Button";
import { Card, CardBody } from "@/components/ui/Card";
import {
  COMFYUI_DOCS,
  COMFYUI_GITHUB,
  COMFYUI_UNITS,
  comfyuiUrl,
} from "@/lib/video/comfyui";

export default function ComfyUIPage() {
  return (
    <>
      <PageHeader
        title="ComfyUI"
        description="The most powerful and modular AI engine for content creation"
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <a href={COMFYUI_DOCS} target="_blank" rel="noopener noreferrer">
              <Button type="button" size="sm">
                <Workflow className="h-4 w-4" />
                Open docs
              </Button>
            </a>
            <a href={COMFYUI_GITHUB} target="_blank" rel="noopener noreferrer">
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
                href={COMFYUI_GITHUB}
                target="_blank"
                rel="noopener noreferrer"
                className="text-sky-300 hover:underline"
              >
                Comfy-Org/ComfyUI
              </a>
              — a node-graph engine for images, video, 3D, and audio. Run it
              locally with the{" "}
              <a
                href="https://www.comfy.org/download"
                target="_blank"
                rel="noopener noreferrer"
                className="text-sky-300 hover:underline"
              >
                desktop app
              </a>
              , or clone the repo and start with{" "}
              <code className="rounded bg-white/5 px-1.5 py-0.5 text-[12px]">
                python main.py
              </code>
              . Docs live at{" "}
              <a
                href={COMFYUI_DOCS}
                target="_blank"
                rel="noopener noreferrer"
                className="text-sky-300 hover:underline"
              >
                docs.comfy.org
              </a>
              .
            </p>
            <p className="text-xs text-muted">
              Source: github.com/Comfy-Org/ComfyUI
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
          units={COMFYUI_UNITS}
          lessonUrl={comfyuiUrl}
          initiallyOpen="start"
        />
      </div>
    </>
  );
}
