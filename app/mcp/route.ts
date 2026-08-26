import { NextResponse } from "next/server";
import { authenticateMcpAccessToken, baseUrl, requireHttpsInProduction, type McpAuth } from "@/lib/mcp/oauth";
import { callMcpTool, listMcpTools } from "@/lib/mcp/registry";
import { takeRateLimit } from "@/lib/mcp/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const PROTOCOL_VERSION = "2025-06-18";
const SUPPORTED_PROTOCOL_VERSIONS = new Set([PROTOCOL_VERSION, "2025-03-26", "2024-11-05"]);

function response(id: unknown, result: unknown, status = 200) {
  return NextResponse.json({ jsonrpc: "2.0", id, result }, { status, headers: { "MCP-Protocol-Version": PROTOCOL_VERSION, "Cache-Control": "no-store" } });
}

function error(id: unknown, code: number, message: string, status = 200) {
  return NextResponse.json({ jsonrpc: "2.0", id, error: { code, message } }, { status, headers: { "MCP-Protocol-Version": PROTOCOL_VERSION, "Cache-Control": "no-store" } });
}

function unauthorized(request: Request) {
  const metadata = `${baseUrl(request)}/.well-known/oauth-protected-resource/mcp`;
  return NextResponse.json({ error: "invalid_token" }, { status: 401, headers: { "WWW-Authenticate": `Bearer resource_metadata="${metadata}"`, "Cache-Control": "no-store" } });
}

export async function handleAuthenticatedMcpRequest(request: Request, auth: McpAuth) {
  const body: unknown = await request.json();
  if (!body || typeof body !== "object" || Array.isArray(body)) return error(null, -32600, "Invalid Request", 400);
  const rpc = body as { jsonrpc?: string; id?: unknown; method?: string; params?: Record<string, unknown> };
  if (rpc.jsonrpc !== "2.0" || typeof rpc.method !== "string") return error(rpc.id ?? null, -32600, "Invalid Request", 400);
  const isNotification = rpc.id === undefined;
  if (rpc.method === "notifications/initialized") return new NextResponse(null, { status: 202, headers: { "MCP-Protocol-Version": PROTOCOL_VERSION } });
  if (rpc.method === "initialize") {
    const requestedVersion = typeof rpc.params?.protocolVersion === "string" ? rpc.params.protocolVersion : null;
    const protocolVersion = requestedVersion && SUPPORTED_PROTOCOL_VERSIONS.has(requestedVersion) ? requestedVersion : PROTOCOL_VERSION;
    console.info("mcp_initialized", { protocolVersion, userId: auth.userId, connectionId: auth.connectionId });
    return response(rpc.id, { protocolVersion, capabilities: { tools: { listChanged: false } }, serverInfo: { name: "Neverland ERP", version: "1.0.0" }, instructions: "Neverland ERP MCP。所有庫存、請款建立/作廢與外部文件寫入均需取得使用者確認。" });
  }
  if (rpc.method === "tools/list") return response(rpc.id, { tools: listMcpTools(auth) });
  if (rpc.method === "tools/call") {
    const name = rpc.params?.name;
    if (typeof name !== "string") return error(rpc.id ?? null, -32602, "tool name is required");
    try {
      const result = await callMcpTool(name, rpc.params?.arguments, auth);
      return isNotification ? new NextResponse(null, { status: 202 }) : response(rpc.id, result);
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : "工具執行失敗";
      return isNotification ? new NextResponse(null, { status: 202 }) : response(rpc.id, { content: [{ type: "text", text: message }], isError: true });
    }
  }
  return error(rpc.id ?? null, -32601, "Method not found");
}

export async function POST(request: Request) {
  try {
    requireHttpsInProduction(request);
    const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || request.headers.get("x-real-ip") || "unknown";
    const rate = takeRateLimit(`mcp:${ip}`);
    if (!rate.allowed) return NextResponse.json({ error: "rate_limited" }, { status: 429, headers: { "Retry-After": String(rate.retryAfter) } });
    const header = request.headers.get("authorization");
    if (!header?.startsWith("Bearer ")) return unauthorized(request);
    const auth = await authenticateMcpAccessToken(header.slice(7), `${baseUrl(request)}/mcp`);
    if (!auth) return unauthorized(request);
    return await handleAuthenticatedMcpRequest(request, auth);
  } catch (cause) {
    const message = cause instanceof Error && cause.message === "MCP 必須透過 HTTPS 使用" ? cause.message : "Internal error";
    return error(null, -32603, message, 400);
  }
}

export async function GET(request: Request) {
  try {
    requireHttpsInProduction(request);
    const header = request.headers.get("authorization");
    if (!header?.startsWith("Bearer ")) return unauthorized(request);
    const auth = await authenticateMcpAccessToken(header.slice(7), `${baseUrl(request)}/mcp`);
    if (!auth) return unauthorized(request);
    return new NextResponse(null, { status: 405, headers: { Allow: "POST", "Cache-Control": "no-store" } });
  } catch {
    return unauthorized(request);
  }
}
