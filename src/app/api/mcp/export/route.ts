import { NextResponse } from "next/server";
import { buildMcpClientConfig } from "@/lib/mcp/export";
import { getSettings, mergeMcpStates } from "@/lib/store";

export const dynamic = "force-dynamic";

/** Download-ready MCP client config (Claude Desktop / Cursor shape). */
export async function GET() {
  const states = mergeMcpStates(getSettings().mcpServers);
  const config = buildMcpClientConfig(states);
  return NextResponse.json(config, {
    headers: {
      "Content-Disposition":
        'attachment; filename="cortex-mcp-servers.json"',
    },
  });
}
