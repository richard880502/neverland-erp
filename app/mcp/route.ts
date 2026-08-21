import { createMcpHandler, Server } from "@modelcontextprotocol/server";
import type { ListToolsResult } from "@modelcontextprotocol/server";
import { NextResponse } from "next/server";
import { authenticateMcpAccessToken, baseUrl, requireHttpsInProduction, type McpAuth } from "@/lib/mcp/oauth";
import { callMcpTool, listMcpTools } from "@/lib/mcp/tools";
import { takeRateLimit } from "@/lib/mcp/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function unauthorized(request: Request) {
  const metadata = `${baseUrl(request)}/.well-known/oauth-protected-resource`;
  return NextResponse.json(
    { error: "invalid_token" },
    {
      status: 401,
      headers: {
        "WWW-Authenticate": `Bearer resource_metadata="${metadata}"`,
        "Cache-Control": "no-store",
      },
    },
  );
}

async function authenticate(request: Request) {
  requireHttpsInProduction(request);

  const ip =
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    request.headers.get("x-real-ip") ||
    "unknown";
  const rate = takeRateLimit(`mcp:${ip}`);
  if (!rate.allowed) {
    return {
      error: NextResponse.json(
        { error: "rate_limited" },
        { status: 429, headers: { "Retry-After": String(rate.retryAfter) } },
      ),
    };
  }

  const header = request.headers.get("authorization");
  if (!header?.startsWith("Bearer ")) return { error: unauthorized(request) };

  const auth = await authenticateMcpAccessToken(header.slice(7), `${baseUrl(request)}/mcp`);
  return auth ? { auth } : { error: unauthorized(request) };
}

function createServer(auth: McpAuth) {
  const server = new Server(
    { name: "Neverland ERP", version: "1.0.0" },
    {
      capabilities: { tools: { listChanged: false } },
      instructions: "Neverland ERP MCP。所有庫存寫入與沖銷均需取得使用者確認。",
    },
  );

  server.oninitialized = () => {
    console.info("mcp_initialized", {
      client: server.getClientVersion(),
      userId: auth.userId,
      connectionId: auth.connectionId,
    });
  };

  server.setRequestHandler("tools/list", async () => ({ tools: listMcpTools(auth) as ListToolsResult["tools"], ttlMs: 0, cacheScope: "private" }));
  server.setRequestHandler("tools/call", async (request) => {
    try {
      return await callMcpTool(request.params.name, request.params.arguments, auth);
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : "工具執行失敗";
      return { content: [{ type: "text" as const, text: message }], isError: true };
    }
  });

  return server;
}

export function createNeverlandMcpHandler(auth: McpAuth) {
  return createMcpHandler(() => createServer(auth), {
    responseMode: "json",
    legacy: "stateless",
    onerror: (error) => console.error("mcp_protocol_error", error),
  });
}

export async function POST(request: Request) {
  try {
    const authenticated = await authenticate(request);
    if (authenticated.error) return authenticated.error;

    const body = await request.clone().json().catch(() => null);
    const messages = Array.isArray(body) ? body : [body];
    console.info("mcp_request", {
      methods: messages
        .filter((message): message is { method: string } => Boolean(message && typeof message.method === "string"))
        .map((message) => message.method),
      userId: authenticated.auth.userId,
      connectionId: authenticated.auth.connectionId,
    });

    const handler = createNeverlandMcpHandler(authenticated.auth);
    const response = await handler.fetch(request, {
      authInfo: {
        token: "validated",
        clientId: authenticated.auth.clientId,
        scopes: authenticated.auth.scopes,
        resource: new URL(`${baseUrl(request)}/mcp`),
        extra: {
          userId: authenticated.auth.userId,
          role: authenticated.auth.role,
          connectionId: authenticated.auth.connectionId,
        },
      },
    });
    response.headers.set("Cache-Control", "no-store");
    return response;
  } catch (cause) {
    console.error("mcp_request_failed", cause);
    const message = cause instanceof Error && cause.message === "MCP 必須透過 HTTPS 使用" ? cause.message : "Internal error";
    return NextResponse.json(
      { jsonrpc: "2.0", error: { code: -32603, message }, id: null },
      { status: 500, headers: { "Cache-Control": "no-store" } },
    );
  }
}

export async function GET(request: Request) {
  try {
    const authenticated = await authenticate(request);
    if (authenticated.error) return authenticated.error;
    return new NextResponse(null, { status: 405, headers: { Allow: "POST", "Cache-Control": "no-store" } });
  } catch {
    return unauthorized(request);
  }
}

export const DELETE = GET;
