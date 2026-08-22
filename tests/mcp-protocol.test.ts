import assert from "node:assert/strict";
import test from "node:test";
import { handleAuthenticatedMcpRequest } from "../app/mcp/route";
import type { McpAuth } from "../lib/mcp/oauth";

const auth: McpAuth = {
  userId: "viewer",
  role: "VIEWER",
  scopes: ["inventory:read"],
  connectionId: "connection",
  clientId: "client",
};

function modernRequest(method: string, params: Record<string, unknown> = {}, headers: Record<string, string> = {}) {
  return new Request("https://erp.example.com/mcp", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      "mcp-protocol-version": "2026-07-28",
      "mcp-method": method,
      ...headers,
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method,
      params: {
        ...params,
        _meta: {
          "io.modelcontextprotocol/protocolVersion": "2026-07-28",
          "io.modelcontextprotocol/clientInfo": { name: "test", version: "1.0.0" },
          "io.modelcontextprotocol/clientCapabilities": {},
        },
      },
    }),
  });
}

test("legacy MCP tools/list is stateless and permission filtered", async () => {
  const response = await handleAuthenticatedMcpRequest(modernRequest("tools/list"), auth);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("mcp-session-id"), null);
  const body = await response.json() as { result: { tools: Array<{ name: string }> } };
  assert.deepEqual(body.result.tools.map((tool) => tool.name), ["get_inventory", "get_inventory_by_channel", "get_low_stock"]);
});

test("legacy MCP ignores optional routing headers used by newer clients", async () => {
  const response = await handleAuthenticatedMcpRequest(modernRequest("tools/list", {}, { "mcp-method": "tools/call" }), auth);
  assert.equal(response.status, 200);
});
