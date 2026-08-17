/**
 * Remotion — make videos programmatically with React.
 * https://github.com/remotion-dev/remotion
 */
import type { CourseUnit } from "@/lib/learning/types";

export const REMOTION_GITHUB = "https://github.com/remotion-dev/remotion";
export const REMOTION_DOCS = "https://www.remotion.dev/docs";
export const REMOTION_SITE = "https://www.remotion.dev";
export const REMOTION_CREATE = "https://www.remotion.dev/docs";

export function remotionUrl(slug: string): string {
  const clean = slug.trim();
  if (!clean) return REMOTION_GITHUB;
  if (clean.startsWith("http://") || clean.startsWith("https://")) return clean;
  if (clean.startsWith("#")) return `${REMOTION_GITHUB}${clean}`;
  return `${REMOTION_GITHUB}/${clean.replace(/^\/+/, "")}`;
}

export const REMOTION_UNITS: CourseUnit[] = [
  {
    id: "start",
    label: "Start",
    title: "Get started",
    description: "Create a Remotion project and read the official docs.",
    lessons: [
      { slug: "", title: "GitHub — remotion-dev/remotion" },
      { slug: "https://www.remotion.dev/docs", title: "Installation & docs" },
      { slug: "https://www.remotion.dev/docs/the-fundamentals", title: "The fundamentals" },
      { slug: "https://www.remotion.dev/templates", title: "Templates" },
      { slug: "https://www.remotion.dev/docs/ai/skills", title: "Agent skills" },
      { slug: "https://www.remotion.dev/prompts", title: "Prompts for coding agents" },
    ],
  },
  {
    id: "create",
    label: "Create",
    title: "Video creation",
    description: "Agentic, interactive, or programmatic — React is the source of truth.",
    lessons: [
      { slug: "https://www.remotion.dev/docs/ai", title: "Make videos with a coding agent" },
      { slug: "https://www.remotion.dev/docs/studio", title: "Remotion Studio (interactive)" },
      { slug: "https://www.remotion.dev/docs/the-fundamentals", title: "Make videos with code" },
      { slug: "https://www.remotion.dev/docs/animating-properties", title: "Animating properties" },
      { slug: "https://www.remotion.dev/docs/sequences", title: "Sequences & timeline" },
    ],
  },
  {
    id: "components",
    label: "Assets",
    title: "Components",
    description: "Elements, effects, shapes, transitions, captions, and fonts.",
    lessons: [
      { slug: "https://www.remotion.dev/elements", title: "Elements" },
      { slug: "https://www.remotion.dev/effects", title: "Effects" },
      { slug: "https://www.remotion.dev/docs/shapes", title: "Shapes" },
      { slug: "https://www.remotion.dev/transitions", title: "Transitions" },
      { slug: "https://www.remotion.dev/docs/sfx", title: "Sound effects" },
      { slug: "https://www.remotion.dev/docs/captions", title: "Captions" },
      { slug: "https://www.remotion.dev/docs/fonts", title: "Fonts" },
    ],
  },
  {
    id: "render",
    label: "Render",
    title: "Rendering & automation",
    description: "Local Node, Lambda, Vercel, or in the browser — batch at scale.",
    lessons: [
      { slug: "https://www.remotion.dev/docs/ssr", title: "Node.js rendering APIs" },
      { slug: "https://www.remotion.dev/docs/lambda", title: "Render on AWS Lambda" },
      { slug: "https://www.remotion.dev/docs/vercel-sandbox", title: "Vercel Sandbox" },
      { slug: "https://www.remotion.dev/docs/client-side-rendering", title: "Client-side rendering" },
      { slug: "https://www.remotion.dev/docs/compare-ssr", title: "Compare render options" },
    ],
  },
  {
    id: "apps",
    label: "Apps",
    title: "Making apps",
    description: "Embed a player or ship a video editor on top of Remotion.",
    lessons: [
      { slug: "https://www.remotion.dev/docs/player", title: "Player" },
      { slug: "https://www.remotion.dev/editor-starter", title: "Editor Starter" },
      { slug: "https://www.remotion.dev/docs/mediabunny", title: "Mediabunny" },
    ],
  },
  {
    id: "community",
    label: "More",
    title: "Community & license",
    description: "Support, showcase, and Remotion’s company license.",
    lessons: [
      { slug: "https://www.remotion.dev/docs/api", title: "API reference" },
      { slug: "https://remotion.dev/showcase", title: "Showcase" },
      { slug: "https://remotion.dev/discord", title: "Discord" },
      { slug: "https://remotion.dev/license", title: "License" },
      { slug: "blob/main/CONTRIBUTING.md", title: "Contributing" },
    ],
  },
];
