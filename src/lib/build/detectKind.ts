import type { Concept } from "../types";

/**
 * Decide what kind of app to scaffold.
 *
 * The stack is the reliable signal: it names the runtime, whereas the title
 * and summary name the *topic*. "Shadowlog — Static Dark Changelog for CLI
 * Tools" is a website about CLI tools, with a stack of Eleventy + Tailwind +
 * GitHub Pages — but a substring match on "cli" scaffolded it as a
 * command-line app. Substring matching also fires on "client", "clipboard",
 * "click" and "declining", so keywords are matched on word boundaries.
 */
export function detectKind(
  concept: Concept,
  ideaHint = "",
): "docker" | "cli" | "api" | "web" {
  const hay =
    `${concept.title} ${concept.summary} ${concept.features?.join(" ")} ${ideaHint}`.toLowerCase();
  const stack = (concept.stack ?? []).join(" ").toLowerCase();
  const word = (w: string) => new RegExp(`\\b${w}\\b`).test(hay);

  // A named web framework or host outranks any topic keyword.
  const webStack =
    /next\.?js|astro|eleventy|11ty|remix|nuxt|svelte|solidstart|gatsby|vite|react|vue|tailwind|github pages|vercel|netlify|cloudflare pages/.test(
      stack,
    );

  if (!webStack) {
    if (word("docker") || word("container") || word("compose")) return "docker";
    if (word("cli") || /command[- ]line/.test(hay) || word("terminal")) {
      return "cli";
    }
    if (/\bapi service\b|\brest api\b|\bbackend only\b/.test(hay)) return "api";
  }
  return "web";
}
