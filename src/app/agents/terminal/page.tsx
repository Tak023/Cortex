"use client";

import { Suspense, useMemo } from "react";
import { useSearchParams } from "next/navigation";
import { AgentTerminal } from "@/components/agents/AgentTerminal";
import {
  EXTERNAL_AGENTS,
  type ExternalAgentId,
} from "@/lib/agents/externalAgents";

function TerminalInner() {
  const params = useSearchParams();
  const agent = (params.get("agent") || "").trim() as ExternalAgentId;
  const meta = useMemo(
    () => EXTERNAL_AGENTS.find((a) => a.id === agent),
    [agent],
  );

  if (!meta) {
    return (
      <div className="flex h-screen items-center justify-center bg-[#07090f] p-6 text-sm text-muted">
        Unknown agent. Open from the AI Agents list in the sidebar.
      </div>
    );
  }

  return <AgentTerminal agent={meta.id} label={meta.label} />;
}

export default function AgentTerminalPage() {
  return (
    <Suspense
      fallback={
        <div className="flex h-screen items-center justify-center bg-[#07090f] text-sm text-muted">
          Opening terminal…
        </div>
      }
    >
      <TerminalInner />
    </Suspense>
  );
}
