/**
 * Task classes — the unit a routing policy can actually reason about.
 *
 * A pipeline *phase* says where you are in a project. A task *class* says what
 * kind of work the model is being asked to do, which is the thing that
 * predicts whether a 30B local coder can handle it. "Implementation" is one
 * phase but covers both `implement` and `test`; "polish" is really a refactor.
 *
 * Client-safe: no Node APIs.
 */
import type { PipelinePhase } from "../types";

export type TaskClass =
  | "research"
  | "draft"
  | "summarize"
  | "architect"
  | "implement"
  | "refactor"
  | "test"
  | "critique"
  | "brainstorm";

export const TASK_CLASSES: TaskClass[] = [
  "research",
  "draft",
  "summarize",
  "architect",
  "implement",
  "refactor",
  "test",
  "critique",
  "brainstorm",
];

export const TASK_CLASS_LABEL: Record<TaskClass, string> = {
  research: "Research",
  draft: "Draft",
  summarize: "Summarize",
  architect: "Architect",
  implement: "Implement",
  refactor: "Refactor",
  test: "Test",
  critique: "Critique",
  brainstorm: "Brainstorm",
};

/**
 * How much a wrong answer costs. High-stakes classes keep a stricter success
 * threshold before a cheaper agent is allowed to take them.
 */
export const TASK_CLASS_STAKES: Record<TaskClass, "low" | "medium" | "high"> = {
  research: "medium",
  draft: "low",
  summarize: "low",
  architect: "high",
  implement: "high",
  refactor: "medium",
  test: "medium",
  critique: "medium",
  brainstorm: "low",
};

/**
 * Classes a competent local coding model should own outright. These are the
 * ones the review called out — boilerplate, test scaffolding, summarization —
 * and they are where the local-first thesis is actually tested.
 */
export const LOCAL_FIRST_CLASSES: TaskClass[] = [
  "draft",
  "summarize",
  "test",
  "refactor",
];

export function taskClassForPhase(
  phase: PipelinePhase | "brainstorm",
): TaskClass {
  switch (phase) {
    case "research":
      return "research";
    case "planning":
      return "draft";
    case "architecture":
      return "architect";
    case "implementation":
      return "implement";
    case "testing":
      return "test";
    case "polish":
      return "refactor";
    case "brainstorm":
      return "brainstorm";
    default:
      return "draft";
  }
}

/** Roles that plausibly serve a class, used as a coarse capability filter. */
export const TASK_CLASS_ROLES: Record<TaskClass, string[]> = {
  research: ["researcher", "generalist"],
  draft: ["planner", "researcher", "generalist", "architect"],
  summarize: ["generalist", "researcher", "planner"],
  architect: ["architect", "planner"],
  implement: ["coder"],
  refactor: ["coder", "critic", "generalist"],
  test: ["tester", "coder"],
  critique: ["critic", "architect", "tester"],
  brainstorm: ["generalist", "planner", "researcher", "architect"],
};
