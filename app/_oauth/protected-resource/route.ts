import { NextResponse } from "next/server";
import { MCP_SCOPES, baseUrl } from "@/lib/mcp/oauth";

export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  const origin = baseUrl(request);
  return NextResponse.json({ resource: `${origin}/mcp`, authorization_servers: [origin], scopes_supported: MCP_SCOPES, bearer_methods_supported: ["header"], resource_name: "Neverland ERP MCP" }, { headers: { "Cache-Control": "no-store" } });
}
