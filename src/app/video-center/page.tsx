"use client";

import Link from "next/link";
import { Clapperboard, Workflow } from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { Card, CardBody } from "@/components/ui/Card";

const TABS = [
  {
    href: "/video-center/remotion",
    title: "Remotion",
    blurb:
      "Make videos programmatically with React — Studio, agents, Lambda, and the official remotion-dev/remotion repo.",
    Icon: Clapperboard,
    accent: "border-rose-400/30 bg-rose-500/10 text-rose-200",
  },
  {
    href: "/video-center/comfyui",
    title: "ComfyUI",
    blurb:
      "Node-graph engine for images, video, 3D, and audio — desktop app, workflows, and the official Comfy-Org/ComfyUI repo.",
    Icon: Workflow,
    accent: "border-amber-400/30 bg-amber-500/10 text-amber-200",
  },
];

export default function VideoCenterPage() {
  return (
    <>
      <PageHeader
        title="Video Center"
        description="Tools and repos for programmatic video"
      />
      <div className="flex-1 overflow-y-auto p-6">
        <div className="grid max-w-3xl gap-3 sm:grid-cols-2">
          {TABS.map(({ href, title, blurb, Icon, accent }) => (
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
