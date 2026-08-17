"use client";

import Link from "next/link";
import { ExternalLink, Hammer } from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { CourseOutline } from "@/components/learning/CourseOutline";
import { Button } from "@/components/ui/Button";
import { Card, CardBody } from "@/components/ui/Card";
import {
  BUILD_YOUR_OWN_X_GITHUB,
  BUILD_YOUR_OWN_X_SITE,
  BUILD_YOUR_OWN_X_UNITS,
  buildYourOwnXUrl,
} from "@/lib/learning/build-your-own-x";

export default function BuildYourOwnXPage() {
  return (
    <>
      <PageHeader
        title="Build Your Own X"
        description="Master programming by recreating your favorite technologies from scratch"
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <a
              href={BUILD_YOUR_OWN_X_GITHUB}
              target="_blank"
              rel="noopener noreferrer"
            >
              <Button type="button" size="sm">
                <Hammer className="h-4 w-4" />
                Open list
              </Button>
            </a>
            <a
              href={BUILD_YOUR_OWN_X_SITE}
              target="_blank"
              rel="noopener noreferrer"
            >
              <Button type="button" variant="secondary" size="sm">
                <ExternalLink className="h-4 w-4" />
                CodeCrafters
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
                href={BUILD_YOUR_OWN_X_GITHUB}
                target="_blank"
                rel="noopener noreferrer"
                className="text-sky-300 hover:underline"
              >
                codecrafters-io/build-your-own-x
              </a>
              — a curated index of step-by-step guides for rebuilding Git,
              Redis, Docker, compilers, browsers, and more. Categories below
              jump to the GitHub README section; featured tutorials open the
              original write-up.
            </p>
            <p className="text-xs text-muted">
              “What I cannot create, I do not understand.” — Richard Feynman
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
          units={BUILD_YOUR_OWN_X_UNITS}
          lessonUrl={buildYourOwnXUrl}
          initiallyOpen="index"
        />
      </div>
    </>
  );
}
