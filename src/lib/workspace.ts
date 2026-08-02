import fs from "fs";
import path from "path";
import type { Project } from "./types";
import { getDataDir } from "./store";

function slugify(name: string): string {
  return (
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 48) || "project"
  );
}

/** Absolute directory for a project's exported artifacts. */
export function projectWorkspaceDir(project: Project): string {
  const slug = slugify(project.name);
  return path.join(getDataDir(), "workspaces", `${project.id}-${slug}`);
}

/**
 * Write all pipeline artifacts to disk and return the workspace path.
 *
 * Cortex pipelines produce design docs / plans / notes — not a full runnable
 * app binary. The README in the folder explains where the project lives in the
 * UI and how to open the exported files.
 */
export function writeProjectWorkspace(project: Project): string {
  const dir = projectWorkspaceDir(project);
  const artifactsDir = path.join(dir, "artifacts");
  fs.mkdirSync(artifactsDir, { recursive: true });

  for (const art of project.artifacts) {
    const safe = art.name.replace(/[^\w.\-]+/g, "_");
    fs.writeFileSync(path.join(artifactsDir, safe), art.content ?? "", "utf-8");
  }

  // Shared memory dumps (useful for debugging / handoff context)
  const memoryDir = path.join(dir, "memory");
  fs.mkdirSync(memoryDir, { recursive: true });
  for (const [key, value] of Object.entries(project.sharedMemory ?? {})) {
    const safe = key.replace(/[^\w.\-]+/g, "_");
    fs.writeFileSync(path.join(memoryDir, `${safe}.md`), value ?? "", "utf-8");
  }

  fs.writeFileSync(
    path.join(dir, "concept.json"),
    JSON.stringify(project.concept, null, 2),
    "utf-8",
  );

  const readme = buildReadme(project, dir);
  fs.writeFileSync(path.join(dir, "README.md"), readme, "utf-8");
  fs.writeFileSync(
    path.join(dir, "HOW-TO-OPEN.md"),
    buildHowToOpen(project, dir),
    "utf-8",
  );

  return dir;
}

function buildReadme(project: Project, dir: string): string {
  const arts = project.artifacts
    .map((a) => `- \`artifacts/${a.name}\` — ${a.phase}`)
    .join("\n");
  return `# ${project.name}

**Status:** ${project.status}  
**Project id:** \`${project.id}\`  
**Exported:** ${new Date().toISOString()}

## Where this lives

| What | Where |
|------|--------|
| **This folder (artifacts on disk)** | \`${dir}\` |
| **Cortex UI** | Open Cortex → **Projects** → **${project.name}** (or go to \`/projects/${project.id}\`) |
| **Cortex data root** | \`${getDataDir()}\` |

## Concept

${project.concept.summary}

**Stack:** ${(project.concept.stack ?? []).join(", ") || "—"}  
**Features:**
${(project.concept.features ?? []).map((f) => `- ${f}`).join("\n") || "- —"}

## Pipeline artifacts

${arts || "_No artifacts were generated._"}

## Generated application

If the **implementation** phase completed with the real builder, a runnable app lives in:

\`\`\`
${dir}/app
\`\`\`

\`\`\`bash
cd "${dir}/app"
npm install   # if needed
npm run dev
\`\`\`

Plans and architecture notes remain under \`artifacts/\`.

See \`HOW-TO-OPEN.md\` for launch steps.
`;
}

function buildHowToOpen(project: Project, dir: string): string {
  return `# How to open this project

## 1. In Cortex (recommended)

1. Launch the **Cortex** app (or run the dev server).
2. Go to **Projects** in the sidebar.
3. Open **${project.name}**.
4. Use the tabs: Kanban · Shared memory · **Artifacts** · Conversation.

Direct path in the app: \`/projects/${project.id}\`

## 2. On disk

Folder:

\`\`\`
${dir}
\`\`\`

macOS Finder:

\`\`\`bash
open "${dir}"
\`\`\`

Or reveal the folder:

\`\`\`bash
open -R "${dir}"
\`\`\`

## 3. Export history

From the project page in Cortex, use **Export history** (JSON download of messages + artifacts).

## 4. Run the generated app

\`\`\`bash
cd "${dir}/app"
npm install
npm run dev
\`\`\`

Docker-style concepts open a container viewer on http://127.0.0.1:3456 (requires Docker Desktop).

If \`app/\` is missing, open the project in Cortex and click **Build app now** to re-run implementation.
`;
}

/** Ensure a project has a workspace folder; write/update files and return path. */
export function ensureProjectWorkspace(project: Project): string {
  return writeProjectWorkspace(project);
}
