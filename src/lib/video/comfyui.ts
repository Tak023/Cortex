/**
 * ComfyUI — modular node-graph engine for images, video, 3D, and audio.
 * https://github.com/Comfy-Org/ComfyUI
 */
import type { CourseUnit } from "@/lib/learning/types";

export const COMFYUI_GITHUB = "https://github.com/Comfy-Org/ComfyUI";
export const COMFYUI_DOCS = "https://docs.comfy.org";
export const COMFYUI_SITE = "https://www.comfy.org";
export const COMFYUI_DOWNLOAD = "https://www.comfy.org/download";
export const COMFYUI_WORKFLOWS = "https://comfy.org/workflows";

export function comfyuiUrl(slug: string): string {
  const clean = slug.trim();
  if (!clean) return COMFYUI_GITHUB;
  if (clean.startsWith("http://") || clean.startsWith("https://")) return clean;
  if (clean.startsWith("#")) return `${COMFYUI_GITHUB}${clean}`;
  return `${COMFYUI_GITHUB}/${clean.replace(/^\/+/, "")}`;
}

export const COMFYUI_UNITS: CourseUnit[] = [
  {
    id: "start",
    label: "Start",
    title: "Get started",
    description: "Desktop app, portable build, or clone the repo and run locally.",
    lessons: [
      { slug: "", title: "GitHub — Comfy-Org/ComfyUI" },
      { slug: "https://www.comfy.org/download", title: "Desktop app (Windows & macOS)" },
      { slug: "https://docs.comfy.org/installation/desktop", title: "Desktop install docs" },
      { slug: "#installing", title: "Portable & manual install" },
      { slug: "https://docs.comfy.org/comfy-cli/getting-started", title: "comfy-cli" },
      { slug: "https://www.comfy.org/cloud", title: "Comfy Cloud" },
    ],
  },
  {
    id: "video",
    label: "Video",
    title: "Video generation",
    description: "Wan, LTX-Video, HunyuanVideo, and other native video models.",
    lessons: [
      { slug: "https://comfy.org/workflows/tag/video-generation", title: "Video workflow templates" },
      { slug: "https://docs.comfy.org/tutorials/video/wan/wan-video", title: "Wan video tutorial" },
      { slug: "https://docs.comfy.org/tutorials/video/ltx/ltx-video", title: "LTX-Video tutorial" },
      { slug: "https://docs.comfy.org/tutorials/video/hunyuan/hunyuan-video", title: "HunyuanVideo tutorial" },
      { slug: "https://comfyanonymous.github.io/ComfyUI_examples/", title: "Classic example workflows" },
    ],
  },
  {
    id: "image",
    label: "Image",
    title: "Images & editing",
    description: "Text-to-image, edit, inpaint, and ControlNet-style workflows.",
    lessons: [
      { slug: "https://comfy.org/workflows/tag/text-to-image", title: "Text-to-image templates" },
      { slug: "https://comfy.org/workflows/tag/image-edit", title: "Image edit templates" },
      { slug: "https://docs.comfy.org/tutorials/basic/first-generation", title: "First generation tutorial" },
      { slug: "blob/master/extra_model_paths.yaml.example", title: "Share models (extra_model_paths.yaml)" },
    ],
  },
  {
    id: "extend",
    label: "Extend",
    title: "API, manager, custom nodes",
    description: "Queue workflows from code and install community nodes.",
    lessons: [
      { slug: "tree/master/script_examples", title: "API script examples" },
      { slug: "blob/master/openapi.yaml", title: "OpenAPI spec" },
      { slug: "https://github.com/Comfy-Org/ComfyUI-Manager", title: "ComfyUI-Manager" },
      { slug: "https://docs.comfy.org/custom-nodes/overview", title: "Custom nodes docs" },
      { slug: "https://docs.comfy.org/tutorials/partner-nodes/overview", title: "Partner / API nodes" },
    ],
  },
  {
    id: "more",
    label: "More",
    title: "Docs, frontend, community",
    description: "Official docs, frontend repo, and support channels.",
    lessons: [
      { slug: "https://docs.comfy.org", title: "docs.comfy.org" },
      { slug: "https://github.com/Comfy-Org/ComfyUI_frontend", title: "ComfyUI Frontend" },
      { slug: "blob/master/CONTRIBUTING.md", title: "Contributing" },
      { slug: "https://comfy.org/discord", title: "Discord" },
      { slug: "https://www.comfy.org", title: "comfy.org" },
    ],
  },
];
