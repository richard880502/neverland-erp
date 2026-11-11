import assert from "node:assert/strict";
import test from "node:test";
import { GET, handleAuthenticatedMcpRequest } from "../app/mcp/route";
import type { McpAuth } from "../lib/mcp/oauth";

const viewer: McpAuth = {
  userId: "viewer", role: "VIEWER", scopes: ["inventory:read"],
  connectionId: "viewer-connection", clientId: "client",
};
const staff: McpAuth = {
  userId: "staff", role: "STAFF", scopes: ["inventory:read", "inventory:write"],
  connectionId: "staff-connection", clientId: "client",
};

function modernRequest(
  method: string,
  params: Record<string, unknown> = {},
  headers: Record<string, string> = {},
  meta: Record<string, unknown> = {},
) {
  return new Request("https://erp.example.com/mcp", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      "mcp-protocol-version": "2026-07-28",
      "mcp-method": method,
      ...(method === "tools/call" && typeof params.name === "string" ? { "mcp-name": params.name } : {}),
      ...headers,
    },
    body: JSON.stringify({
      jsonrpc: "2.0", id: 1, method,
      params: {
        ...params,
        _meta: {
          "io.modelcontextprotocol/protocolVersion": "2026-07-28",
          "io.modelcontextprotocol/clientInfo": { name: "test", version: "1.0.0" },
          "io.modelcontextprotocol/clientCapabilities": {},
          ...meta,
        },
      },
    }),
  });
}

function legacyRequest(method: string, params: Record<string, unknown> = {}) {
  return new Request("https://erp.example.com/mcp", {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json, text/event-stream" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
}

async function data(response: Response) {
  return response.json() as Promise<{ result?: Record<string, unknown>; error?: { code: number; message: string; data?: unknown } }>;
}

test("server/discover advertises modern and legacy versions without session handshake", async () => {
  const response = await handleAuthenticatedMcpRequest(modernRequest("server/discover"), viewer);
  const json = await data(response);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("mcp-protocol-version"), "2026-07-28");
  assert.equal(response.headers.get("mcp-session-id"), null);
  assert.equal(json.result?.resultType, "complete");
  assert.deepEqual(json.result?.supportedVersions, ["2026-07-28", "2025-06-18", "2025-03-26", "2024-11-05"]);
  assert.deepEqual(json.result?.capabilities, { tools: { listChanged: false } });
  assert.deepEqual((json.result?._meta as Record<string, unknown>)?.["io.modelcontextprotocol/serverInfo"], { name: "Neverland ERP", version: "3.0.8" });
  assert.equal(json.result?.cacheScope, "private");
  assert.equal(json.result?.ttlMs, 0);
});

test("modern tools/list uses a complete result, private zero-TTL cache and per-request scopes", async () => {
  const request = () => modernRequest("tools/list");
  const first = await handleAuthenticatedMcpRequest(request(), viewer);
  const second = await handleAuthenticatedMcpRequest(request(), staff);
  const firstJson = await data(first);
  const secondJson = await data(second);
  const viewerNames = (firstJson.result?.tools as Array<{ name: string }>).map((tool) => tool.name);
  const staffNames = (secondJson.result?.tools as Array<{ name: string }>).map((tool) => tool.name);
  assert.deepEqual(viewerNames, ["get_inventory", "get_inventory_by_channel", "get_low_stock"]);
  assert.ok(staffNames.includes("create_inventory_movement"));
  assert.ok(!viewerNames.includes("create_inventory_movement"));
  assert.equal(firstJson.result?.resultType, "complete");
  assert.equal(firstJson.result?.cacheScope, "private");
  assert.equal(firstJson.result?.ttlMs, 0);
  assert.equal(first.headers.get("mcp-session-id"), null);
  assert.equal(second.headers.get("mcp-session-id"), null);
});

test("modern tools/call rejects unavailable tools at protocol layer", async () => {
  const response = await handleAuthenticatedMcpRequest(
    modernRequest("tools/call", { name: "create_inventory_movement", arguments: {} }), viewer,
  );
  const json = await data(response);
  assert.equal(response.status, 400);
  assert.equal(json.error?.code, -32602);
  assert.match(json.error?.message || "", /unauthorized/);
});

test("modern request rejects missing, conflicting and malformed protocol routing headers", async () => {
  for (const [description, headers, meta] of [
    ["missing version", { "mcp-protocol-version": "" }, {}],
    ["conflicting version", { "mcp-protocol-version": "2025-06-18" }, {}],
    ["wrong method", { "mcp-method": "tools/call" }, {}],
    ["missing method", { "mcp-method": "" }, {}],
    ["missing client info", {}, { "io.modelcontextprotocol/clientInfo": null }],
  ] as const) {
    const response = await handleAuthenticatedMcpRequest(modernRequest("tools/list", {}, headers, meta), viewer);
    assert.equal(response.status, 400, description);
    const json = await data(response);
    assert.ok(json.error, description);
  }
});

test("modern tools/call requires matching Mcp-Name", async () => {
  for (const headers of [{ "mcp-name": "" }, { "mcp-name": "other" }, { "mcp-name": "=?base64?%%%?=" }]) {
    const response = await handleAuthenticatedMcpRequest(
      modernRequest("tools/call", { name: "get_inventory", arguments: {} }, headers), viewer,
    );
    const json = await data(response);
    assert.equal(response.status, 400);
    assert.match(json.error?.message || "", /Mcp-Name/);
  }
});

test("unsupported modern version emits supportedVersions and does not execute calls", async () => {
  const response = await handleAuthenticatedMcpRequest(
    modernRequest("tools/list", {}, { "mcp-protocol-version": "2099-01-01" }, { "io.modelcontextprotocol/protocolVersion": "2099-01-01" }), viewer,
  );
  const json = await data(response);
  assert.equal(response.status, 400);
  assert.ok(JSON.stringify(json.error?.data).includes("2026-07-28"));
});

test("legacy initialize and tools/list remain compatible", async () => {
  const initialize = await handleAuthenticatedMcpRequest(legacyRequest("initialize", { protocolVersion: "2025-06-18" }), viewer);
  const init = await data(initialize);
  assert.equal(initialize.status, 200);
  assert.equal(init.result?.protocolVersion, "2025-06-18");
  assert.equal(init.result?.resultType, undefined);
  const response = await handleAuthenticatedMcpRequest(legacyRequest("tools/list"), viewer);
  const json = await data(response);
  assert.equal(response.status, 200);
  assert.deepEqual((json.result?.tools as Array<{ name: string }>).map((tool) => tool.name), ["get_inventory", "get_inventory_by_channel", "get_low_stock"]);
});

test("GET /mcp advertises OAuth discovery before authentication", async () => {
  const response = await GET(new Request("https://erp.example.com/mcp"));
  assert.equal(response.status, 401);
  assert.equal(response.headers.get("www-authenticate"), 'Bearer resource_metadata="https://erp.example.com/.well-known/oauth-protected-resource/mcp"');
});
