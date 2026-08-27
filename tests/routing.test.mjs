/**
 * Routing policy and cost model.
 *
 * The router decides which agent gets paid work, so its failure modes are
 * expensive rather than merely wrong. The budget cases exist because the
 * original implementation let a spent cap through: the curated-specialist
 * fallback selected from the raw agent pool instead of the budget-filtered
 * one, turning the hard stop into a suggestion.
 */
import { suite, check, equals } from "./harness.mjs";

export async function run(mod) {
  const { routeForClass, escalateFrom } = await import(mod("agents/router.js"));
  const { agentCost } = await import(mod("agents/costModel.js"));

  const agent = (id, name, type, roles, caps = [], status = "idle") => ({
    id,
    name,
    type,
    roles,
    status,
    capabilities: caps,
    slug: id,
    strengths: {},
    currentTaskId: null,
    currentTaskLabel: null,
    description: "",
    config: { enabled: true, systemPrompt: "", toolAccess: [], maxConcurrent: 1 },
    metrics: {
      tokensUsed: 0,
      avgLatencyMs: 0,
      successRate: 0.9,
      tasksCompleted: 0,
      tasksFailed: 0,
      source: "seeded",
    },
    lastSeenAt: new Date(0).toISOString(),
  });

  // Tagged as the real registry tags them: only true on-device inference
  // carries `offline` / `local-inference`.
  const QWEN = agent("agent-lmstudio-qwen", "Qwen3-Coder-30B", "local",
    ["coder", "tester"], ["local-inference", "offline"]);
  const HERMES = agent("agent-hermes", "Hermes", "local",
    ["researcher", "generalist", "planner"], ["local-cli", "web-research"]);
  const JARVIS = agent("agent-jarvis", "Jarvis", "local",
    ["generalist", "planner", "researcher", "coder"], ["openjarvis", "local-first"]);
  // The registry's on-device planner — this is the agent that actually took
  // the `draft` class in the first live pipeline run.
  const NEMOTRON = agent("agent-lmstudio-nemotron", "Nemotron Omni", "local",
    ["planner", "researcher", "critic", "generalist"], ["local-inference", "offline"]);
  const CLAUDE = agent("agent-claude-code", "Claude Code", "cloud",
    ["coder", "architect", "tester"]);
  const CODEX = agent("agent-codex", "Codex", "cloud",
    ["coder", "tester", "architect"]);

  const AGENTS = [QWEN, NEMOTRON, HERMES, CLAUDE, CODEX];
  const BILLING = {
    "agent-hermes": "metered", // Nous Portal prepaid credits
    "agent-claude-code": "metered",
    "agent-codex": "metered",
  };
  const base = {
    agents: AGENTS,
    usage: [],
    billing: BILLING,
    minSuccessRate: 0.7,
    minAttempts: 3,
    exploreUnproven: false,
    stats: [],
  };
  const stat = (agentId, taskClass, attempts, successes) => ({
    agentId, taskClass, attempts, successes, simulatedAttempts: 0,
    totalTokens: 2000 * attempts, totalLatencyMs: 1000 * attempts,
    totalCostUsd: 0, lastAt: new Date(0).toISOString(), lastError: null,
  });

  suite("Cost tiers follow who pays, not where the process runs");
  {
    equals("Hermes billing metered → not free-local",
      agentCost(HERMES, [], "metered").tier, "metered");
    equals("LM Studio (offline capability) → free-local",
      agentCost(QWEN, [], undefined).tier, "free-local");
    equals("Jarvis: local but can proxy to paid → not claimed free",
      agentCost(JARVIS, [], undefined).tier, "included");
    equals("cloud on a plan → included",
      agentCost(CLAUDE, [], "subscription").tier, "included");
    equals("cloud with unknown auth → metered, never free",
      agentCost(CLAUDE, [], undefined).tier, "metered");

    const few = Array.from({ length: 4 }, (_, i) => ({
      id: `u${i}`, agentId: "agent-claude-code", tokens: 1000, costUsd: 0.05,
      latencyMs: 10, createdAt: new Date(0).toISOString(),
    }));
    check("under 5 samples yields no observed rate",
      agentCost(CLAUDE, few, "metered").observedPer1kUsd === null);
    const enough = [...few, { ...few[0], id: "u4" }];
    check("5 samples yields $0.05/1k",
      Math.abs(agentCost(CLAUDE, enough, "metered").observedPer1kUsd - 0.05) < 1e-9);
  }

  suite("Policy behaviour");
  {
    const proven = [stat("agent-lmstudio-qwen", "test", 10, 9)];
    equals("quality-first ignores a cheaper proven agent",
      routeForClass({ ...base, stats: proven, taskClass: "test", phase: "testing",
        policy: "quality-first" }).agentId, "agent-codex");
    equals("cost-aware prefers the proven free local",
      routeForClass({ ...base, stats: proven, taskClass: "test", phase: "testing",
        policy: "cost-aware" }).agentId, "agent-lmstudio-qwen");

    const thin = routeForClass({ ...base, stats: [stat("agent-lmstudio-qwen", "test", 2, 2)],
      taskClass: "test", phase: "testing", policy: "cost-aware" });
    check("unproven agent is skipped and the reason recorded",
      thin.agentId !== "agent-lmstudio-qwen" &&
      thin.rejected.some((r) => /unproven/.test(r.reason)));

    const bad = routeForClass({ ...base, stats: [stat("agent-lmstudio-qwen", "test", 10, 4)],
      taskClass: "test", phase: "testing", policy: "cost-aware" });
    check("40% success does not clear the bar",
      bad.agentId !== "agent-lmstudio-qwen" &&
      bad.rejected.some((r) => /below the bar/.test(r.reason)));
  }

  suite("High-stakes classes enforce a stricter floor than the setting");
  {
    check("75% rejected for implement (0.85 floor)",
      routeForClass({ ...base, stats: [stat("agent-lmstudio-qwen", "implement", 20, 15)],
        taskClass: "implement", phase: "implementation", policy: "cost-aware" })
        .agentId !== "agent-lmstudio-qwen");
    equals("90% accepted for implement",
      routeForClass({ ...base, stats: [stat("agent-lmstudio-qwen", "implement", 20, 18)],
        taskClass: "implement", phase: "implementation", policy: "cost-aware" }).agentId,
      "agent-lmstudio-qwen");
  }

  suite("Capability and health filtering");
  {
    check("a coder is not routed to research",
      routeForClass({ ...base, stats: [stat("agent-lmstudio-qwen", "research", 10, 10)],
        taskClass: "research", phase: "research", policy: "cost-aware" })
        .agentId !== "agent-lmstudio-qwen");
    const errored = AGENTS.map((a) =>
      a.id === "agent-lmstudio-qwen" ? { ...a, status: "error" } : a);
    check("an errored agent is skipped despite perfect history",
      routeForClass({ ...base, agents: errored, stats: [stat("agent-lmstudio-qwen", "test", 10, 10)],
        taskClass: "test", phase: "testing", policy: "cost-aware" })
        .agentId !== "agent-lmstudio-qwen");
  }

  suite("Exploration is bounded by stakes");
  {
    equals("low-stakes draft explores to the role-capable free local",
      routeForClass({ ...base, exploreUnproven: true, taskClass: "draft",
        phase: "planning", policy: "cost-aware" }).agentId, "agent-lmstudio-nemotron");
    check("a coder-only local is not explored into draft",
      routeForClass({ ...base, exploreUnproven: true, taskClass: "draft",
        phase: "planning", policy: "cost-aware" }).agentId !== "agent-lmstudio-qwen");
    check("high-stakes implement does not explore",
      routeForClass({ ...base, exploreUnproven: true, taskClass: "implement",
        phase: "implementation", policy: "cost-aware" }).agentId !== "agent-lmstudio-qwen");
  }

  suite("Budget hard stop is a stop, in every branch");
  {
    for (const policy of ["cost-aware", "quality-first"]) {
      const d = routeForClass({ ...base, taskClass: "implement", phase: "implementation",
        policy, meteredBlocked: true });
      const chosen = AGENTS.find((a) => a.id === d.agentId);
      check(`${policy}: never routes to a metered agent when blocked`,
        !chosen || chosen.type === "local", `got ${d.agentId}`);
    }
    const d = routeForClass({ ...base, taskClass: "implement", phase: "implementation",
      policy: "cost-aware", meteredBlocked: true });
    check("blocked agents are reported as rejected",
      d.rejected.some((r) => /budget cap spent/.test(r.reason)));
    check("decision carries budgetBlocked", d.budgetBlocked === true);
  }

  suite("Escalation and evidence");
  {
    const d = routeForClass({ ...base, stats: [stat("agent-lmstudio-qwen", "test", 10, 10)],
      taskClass: "test", phase: "testing", policy: "cost-aware" });
    check("ladder is cheapest-first", d.escalationPath[0] === "agent-lmstudio-qwen");
    check("escalates past the failed agent",
      escalateFrom(d, ["agent-lmstudio-qwen"]) !== "agent-lmstudio-qwen");
    check("returns null when the ladder is exhausted",
      escalateFrom(d, d.escalationPath) === null);

    const simOnly = {
      agentId: "agent-lmstudio-qwen", taskClass: "test", attempts: 0, successes: 0,
      simulatedAttempts: 50, totalTokens: 0, totalLatencyMs: 0, totalCostUsd: 0,
      lastAt: new Date(0).toISOString(), lastError: null,
    };
    check("50 simulated wins do not promote an agent",
      routeForClass({ ...base, stats: [simOnly], taskClass: "test", phase: "testing",
        policy: "cost-aware" }).agentId !== "agent-lmstudio-qwen");
  }

  suite("Degenerate input");
  {
    const d = routeForClass({ ...base, agents: [], taskClass: "test",
      phase: "testing", policy: "cost-aware" });
    check("no routable agent yields a null decision with a reason",
      d.agentId === null && Boolean(d.reason));
  }
}
