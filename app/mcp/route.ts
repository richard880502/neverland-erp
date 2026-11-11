import { NextResponse } from "next/server";
import { authenticateMcpAccessToken, baseUrl, requireHttpsInProduction, type McpAuth } from "@/lib/mcp/oauth";
import { callMcpTool, listMcpTools } from "@/lib/mcp/registry";
import { takeRateLimit } from "@/lib/mcp/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Serve the 2026 stateless era and the existing 2025 initialization era side by side.
// Avoid tying protocol state to a Node process, connection, or load-balancer replica.
const MODERN_PROTOCOL_VERSION = "2026-07-28";
const LEGACY_PROTOCOL_VERSION = "2025-06-18";
const LEGACY_VERSIONS = [LEGACY_PROTOCOL_VERSION, "2025-03-26", "2024-11-05"];
const SUPPORTED_VERSIONS = [MODERN_PROTOCOL_VERSION, ...LEGACY_VERSIONS];
const SERVER_INFO = { name: "Neverland ERP", version: "3.1.0" };
const SERVER_INSTRUCTIONS = "Neverland ERP MCP。所有庫存、請款建立/作廢與外部文件寫入均需取得使用者確認。";

type Rpc = { jsonrpc?: unknown; id?: unknown; method?: unknown; params?: unknown };
type ProtocolError = { code: number; message: string; status: number; data?: unknown };
type JsonRecord = Record<string, unknown>;

function object(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function rpcError(id: unknown, code: number, message: string, status = 200, version = LEGACY_PROTOCOL_VERSION, data?: unknown) {
  return NextResponse.json(
    { jsonrpc: "2.0", id, error: { code, message, ...(data === undefined ? {} : { data }) } },
    { status, headers: { "MCP-Protocol-Version": version, "Cache-Control": "no-store" } },
  );
}

function rpcResult(id: unknown, result: JsonRecord, modern: boolean) {
  return NextResponse.json(
    { jsonrpc: "2.0", id, result: modern ? { resultType: "complete", ...result } : result },
    { headers: { "MCP-Protocol-Version": modern ? MODERN_PROTOCOL_VERSION : LEGACY_PROTOCOL_VERSION, "Cache-Control": "no-store" } },
  );
}

function unauthorized(request: Request) {
  const metadata = `${baseUrl(request)}/.well-known/oauth-protected-resource/mcp`;
  return NextResponse.json({ error: "invalid_token" }, {
    status: 401,
    headers: { "WWW-Authenticate": `Bearer resource_metadata="${metadata}"`, "Cache-Control": "no-store" },
  });
}

// Deny cross-origin browser requests unless an origin was explicitly allowed.
// Native/CLI and server-to-server MCP requests generally do not send Origin.
function validateOrigin(request: Request): boolean {
  const origin = request.headers.get("origin");
  if (!origin) return true;
  const canonical = process.env.NEXT_PUBLIC_APP_URL || new URL(request.url).origin;
  const allowed = [canonical, ...(process.env.MCP_ALLOWED_ORIGINS || "").split(",").map((item) => item.trim()).filter(Boolean)];
  return allowed.some((url) => {
    try { return new URL(url).origin === origin; } catch { return false; }
  });
}

function requestMeta(rpc: Rpc): JsonRecord | null {
  const params = object(rpc.params) ? rpc.params : null;
  return params && object(params._meta) ? params._meta : null;
}

function isModern(request: Request, rpc: Rpc): boolean {
  const meta = requestMeta(rpc);
  const declared = request.headers.get("mcp-protocol-version");
  return meta?.["io.modelcontextprotocol/protocolVersion"] !== undefined
    || rpc.method === "server/discover"
    || (declared !== null && !LEGACY_VERSIONS.includes(declared));
}

function mismatch(message: string): ProtocolError {
  return { code: -32020, message: `Header mismatch: ${message}`, status: 400 };
}

// MCP's RFC 9110-safe Base64 sentinel encoding for mirrored name headers.
function decodeHeaderValue(raw: string | null): string | null {
  if (!raw) return null;
  if (raw.startsWith("=?base64?")) {
    if (!raw.endsWith("?=")) return null;
    const payload = raw.slice(9, -2);
    if (!payload || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(payload)) return null;
    const bytes = Buffer.from(payload, "base64");
    const decoded = bytes.toString("utf8");
    return Buffer.from(decoded, "utf8").toString("base64") === payload ? decoded : null;
  }
  if (!/^[\x20-\x7e]+$/.test(raw) || raw !== raw.trim()) return null;
  return raw;
}

function validateModernRequest(request: Request, rpc: Rpc): ProtocolError | null {
  const meta = requestMeta(rpc);
  const headerVersion = request.headers.get("mcp-protocol-version");
  const bodyVersion = meta?.["io.modelcontextprotocol/protocolVersion"];
  if (!headerVersion || typeof bodyVersion !== "string" || headerVersion !== bodyVersion) {
    return mismatch("MCP-Protocol-Version does not match params._meta");
  }
  if (bodyVersion !== MODERN_PROTOCOL_VERSION) {
    return {
      code: -32022, message: "Unsupported protocol version", status: 400,
      data: { requested: bodyVersion, supported: SUPPORTED_VERSIONS },
    };
  }
  if (request.headers.get("mcp-method") !== rpc.method) {
    return mismatch("Mcp-Method does not match method");
  }
  const clientInfo = meta?.["io.modelcontextprotocol/clientInfo"];
  const clientCapabilities = meta?.["io.modelcontextprotocol/clientCapabilities"];
  if (!object(clientInfo) || typeof clientInfo.name !== "string" || !clientInfo.name
      || typeof clientInfo.version !== "string" || !clientInfo.version
      || !object(clientCapabilities)) {
    return { code: -32602, message: "Missing or invalid MCP client metadata", status: 400 };
  }
  if (rpc.method === "tools/call") {
    const params = object(rpc.params) ? rpc.params : null;
    const mirrored = decodeHeaderValue(request.headers.get("mcp-name"));
    if (typeof params?.name !== "string" || !mirrored || mirrored !== params.name) {
      return mismatch("Mcp-Name does not match params.name");
    }
  }
  return null;
}

export async function handleAuthenticatedMcpRequest(request: Request, auth: McpAuth) {
  let body: unknown;
  try { body = await request.json(); } catch {
    return rpcError(null, -32700, "Parse error", 400);
  }
  if (!object(body)) return rpcError(null, -32600, "Invalid Request", 400);
  const rpc: Rpc = body;
  if (rpc.jsonrpc !== "2.0" || typeof rpc.method !== "string" || (rpc.id !== undefined && typeof rpc.id !== "string" && typeof rpc.id !== "number")) {
    return rpcError(rpc.id ?? null, -32600, "Invalid Request", 400);
  }

  const modern = isModern(request, rpc);
  const version = modern ? MODERN_PROTOCOL_VERSION : LEGACY_PROTOCOL_VERSION;
  if (modern) {
    const failure = validateModernRequest(request, rpc);
    if (failure) return rpcError(rpc.id ?? null, failure.code, failure.message, failure.status, version, failure.data);
  }
  const params = object(rpc.params) ? rpc.params : {};

  if (!modern && rpc.method === "notifications/initialized") {
    return new NextResponse(null, { status: 202, headers: { "MCP-Protocol-Version": LEGACY_PROTOCOL_VERSION } });
  }

  if (!modern && rpc.method === "initialize") {
    const requested = params.protocolVersion;
    const protocolVersion = typeof requested === "string" && LEGACY_VERSIONS.includes(requested) ? requested : LEGACY_PROTOCOL_VERSION;
    return rpcResult(rpc.id, {
      protocolVersion, capabilities: { tools: { listChanged: false } },
      serverInfo: SERVER_INFO, instructions: SERVER_INSTRUCTIONS,
    }, false);
  }

  if (modern && rpc.method === "server/discover") {
    return rpcResult(rpc.id, {
      supportedVersions: SUPPORTED_VERSIONS,
      capabilities: { tools: { listChanged: false } },
      _meta: { "io.modelcontextprotocol/serverInfo": SERVER_INFO },
      instructions: SERVER_INSTRUCTIONS,
      ttlMs: 0, cacheScope: "private",
    }, true);
  }

  if (rpc.method === "tools/list") {
    // Tool visibility is bound to the current OAuth token's scopes and ERP role.
    return rpcResult(rpc.id, { tools: listMcpTools(auth), ...(modern ? { ttlMs: 0, cacheScope: "private" } : {}) }, modern);
  }

  if (rpc.method === "tools/call") {
    const name = params.name;
    if (typeof name !== "string" || !name) {
      return rpcError(rpc.id ?? null, -32602, "tool name is required", modern ? 400 : 200, version);
    }
    if (modern && !listMcpTools(auth).some((tool) => tool.name === name)) {
      return rpcError(rpc.id ?? null, -32602, "Unknown or unauthorized tool", 400, version);
    }
    try {
      const result = await callMcpTool(name, params.arguments, auth);
      return rpcResult(rpc.id, result, modern);
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : "工具執行失敗";
      return rpcResult(rpc.id, { content: [{ type: "text", text: message }], isError: true }, modern);
    }
  }

  return rpcError(rpc.id ?? null, -32601, "Method not found", modern ? 404 : 200, version);
}

export async function POST(request: Request) {
  try {
    requireHttpsInProduction(request);
    if (!validateOrigin(request)) return NextResponse.json({ error: "Invalid Origin" }, { status: 403 });
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
    return rpcError(null, -32603, message, 400);
  }
}

export async function GET(request: Request) {
  try {
    requireHttpsInProduction(request);
    if (!validateOrigin(request)) return NextResponse.json({ error: "Invalid Origin" }, { status: 403 });
    const header = request.headers.get("authorization");
    if (!header?.startsWith("Bearer ")) return unauthorized(request);
    const auth = await authenticateMcpAccessToken(header.slice(7), `${baseUrl(request)}/mcp`);
    if (!auth) return unauthorized(request);
    return new NextResponse(null, { status: 405, headers: { Allow: "POST", "Cache-Control": "no-store" } });
  } catch {
    return unauthorized(request);
  }
}
