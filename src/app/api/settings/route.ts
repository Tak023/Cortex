import { NextResponse } from "next/server";
import { getSettings, updateSettings } from "@/lib/store";
import { isAiConfigured, isClaudeConfigured } from "@/lib/ai/client";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({
    settings: {
      ...getSettings(),
      xaiApiKeySet: isAiConfigured(),
      anthropicApiKeySet: isClaudeConfigured(),
    },
  });
}

export async function PATCH(req: Request) {
  const body = await req.json();
  const settings = updateSettings({
    ...(typeof body.simulationSpeedMs === "number"
      ? { simulationSpeedMs: body.simulationSpeedMs }
      : {}),
    ...(typeof body.autoApprove === "boolean"
      ? { autoApprove: body.autoApprove }
      : {}),
    ...(typeof body.defaultLocalModel === "string"
      ? { defaultLocalModel: body.defaultLocalModel }
      : {}),
    ...(body.voiceInputMode === "auto" ||
    body.voiceInputMode === "builtin" ||
    body.voiceInputMode === "external"
      ? { voiceInputMode: body.voiceInputMode }
      : {}),
    ...(body.agentApprovalPolicy === "inherit" ||
    body.agentApprovalPolicy === "read-only" ||
    body.agentApprovalPolicy === "ask" ||
    body.agentApprovalPolicy === "auto"
      ? { agentApprovalPolicy: body.agentApprovalPolicy }
      : {}),
    ...(body.agentWorkspaceScope === "project" ||
    body.agentWorkspaceScope === "custom" ||
    body.agentWorkspaceScope === "home"
      ? { agentWorkspaceScope: body.agentWorkspaceScope }
      : {}),
    ...(typeof body.agentWorkspaceDir === "string"
      ? { agentWorkspaceDir: body.agentWorkspaceDir }
      : {}),
    ...(body.claudeAuthPreference === "auto" ||
    body.claudeAuthPreference === "subscription" ||
    body.claudeAuthPreference === "api-key"
      ? { claudeAuthPreference: body.claudeAuthPreference }
      : {}),
    ...(typeof body.showSeededMetrics === "boolean"
      ? { showSeededMetrics: body.showSeededMetrics }
      : {}),
    ...(typeof body.codegenEnabled === "boolean"
      ? { codegenEnabled: body.codegenEnabled }
      : {}),
    ...(body.routingPolicy === "quality-first" ||
    body.routingPolicy === "cost-aware" ||
    body.routingPolicy === "local-first"
      ? { routingPolicy: body.routingPolicy }
      : {}),
    ...(typeof body.routingMinSuccessRate === "number"
      ? {
          routingMinSuccessRate: Math.min(
            1,
            Math.max(0, body.routingMinSuccessRate),
          ),
        }
      : {}),
    ...(typeof body.routingMinAttempts === "number"
      ? {
          routingMinAttempts: Math.max(
            1,
            Math.round(body.routingMinAttempts),
          ),
        }
      : {}),
    ...(typeof body.routingExploreUnproven === "boolean"
      ? { routingExploreUnproven: body.routingExploreUnproven }
      : {}),
    // null clears a cap; a non-positive number is treated as "uncapped" too,
    // so an empty input can never mean "block everything".
    ...(body.dailyBudgetUsd === null || typeof body.dailyBudgetUsd === "number"
      ? {
          dailyBudgetUsd:
            typeof body.dailyBudgetUsd === "number" && body.dailyBudgetUsd > 0
              ? body.dailyBudgetUsd
              : null,
        }
      : {}),
    ...(body.projectBudgetUsd === null ||
    typeof body.projectBudgetUsd === "number"
      ? {
          projectBudgetUsd:
            typeof body.projectBudgetUsd === "number" &&
            body.projectBudgetUsd > 0
              ? body.projectBudgetUsd
              : null,
        }
      : {}),
    ...(typeof body.vaultEnabled === "boolean"
      ? { vaultEnabled: body.vaultEnabled }
      : {}),
    ...(typeof body.vaultDir === "string" ? { vaultDir: body.vaultDir } : {}),
    ...(typeof body.jarvisEnabled === "boolean"
      ? { jarvisEnabled: body.jarvisEnabled }
      : {}),
    ...(typeof body.jarvisBaseUrl === "string"
      ? { jarvisBaseUrl: body.jarvisBaseUrl }
      : {}),
    ...(typeof body.jarvisChatBaseUrl === "string"
      ? { jarvisChatBaseUrl: body.jarvisChatBaseUrl }
      : {}),
    ...(typeof body.jarvisChatModel === "string"
      ? { jarvisChatModel: body.jarvisChatModel }
      : {}),
    ...(body.jarvisChatMode === "hybrid" ||
    body.jarvisChatMode === "local" ||
    body.jarvisChatMode === "grok"
      ? { jarvisChatMode: body.jarvisChatMode }
      : {}),
    ...(typeof body.jarvisDefaultAgent === "string"
      ? { jarvisDefaultAgent: body.jarvisDefaultAgent }
      : {}),
    ...(typeof body.jarvisCliPath === "string"
      ? { jarvisCliPath: body.jarvisCliPath }
      : {}),
    ...(typeof body.jarvisPreferCli === "boolean"
      ? { jarvisPreferCli: body.jarvisPreferCli }
      : {}),
    ...(typeof body.jarvisTimeoutMs === "number"
      ? { jarvisTimeoutMs: body.jarvisTimeoutMs }
      : {}),
    ...(typeof body.jarvisUseInPipeline === "boolean"
      ? { jarvisUseInPipeline: body.jarvisUseInPipeline }
      : {}),
    ...(Array.isArray(body.mcpServers)
      ? { mcpServers: body.mcpServers }
      : {}),
  });
  return NextResponse.json({
    settings: {
      ...settings,
      xaiApiKeySet: isAiConfigured(),
      anthropicApiKeySet: isClaudeConfigured(),
    },
  });
}
