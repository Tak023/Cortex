import { NextResponse } from "next/server";
import { getSettings, updateSettings } from "@/lib/store";
import { isAiConfigured } from "@/lib/ai/client";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({
    settings: {
      ...getSettings(),
      xaiApiKeySet: isAiConfigured(),
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
    settings: { ...settings, xaiApiKeySet: isAiConfigured() },
  });
}
