/**
 * Client-safe catalog of external AI coding agents (no Node APIs).
 */

export type ExternalAgentId =
  | "hermes"
  | "claude-code"
  | "codex"
  | "grok"
  | "antigravity";

export const EXTERNAL_AGENTS: Array<{
  id: ExternalAgentId;
  label: string;
  description: string;
  iconSrc: string;
}> = [
  {
    id: "hermes",
    label: "Hermes",
    description: "Open Hermes in an in-app terminal",
    // Official Hermes Agent app icon (Nous Research)
    iconSrc: "/branding/agents/hermes.png",
  },
  {
    id: "claude-code",
    label: "Claude Code",
    description: "Open Claude Code in an in-app terminal",
    // Official Claude starburst (Anthropic)
    iconSrc: "/branding/agents/claude.svg",
  },
  {
    id: "codex",
    label: "Codex",
    description: "Open Codex in an in-app terminal",
    // Official OpenAI Codex mark
    iconSrc: "/branding/agents/codex.svg",
  },
  {
    id: "grok",
    label: "Grok",
    description: "Open Grok Code in an in-app terminal",
    // Official xAI / Grok monogram
    iconSrc: "/branding/agents/grok.svg",
  },
  {
    id: "antigravity",
    label: "Antigravity",
    description: "Open Antigravity CLI (`agy`) in an in-app terminal",
    iconSrc: "/branding/agents/antigravity.png",
  },
];
