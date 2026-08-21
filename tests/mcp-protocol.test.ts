import assert from "node:assert/strict";
import test from "node:test";
import { createNeverlandMcpHandler } from "../app/mcp/route";
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

test("MCP 2026 tools/list is stateless and permission filtered", async () => {
  const handler = createNeverlandMcpHandler(auth);
  const response = await handler.fetch(modernRequest("tools/list"));
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("mcp-session-id"), null);
  const body = await response.json() as { result: { tools: Array<{ name: string }> } };
  assert.deepEqual(body.result.tools.map((tool) => tool.name), ["get_inventory", "get_inventory_by_channel", "get_low_stock"]);
  await handler.close();
});

test("MCP 2026 rejects missing and mismatched routing headers", async () => {
  const missing = createNeverlandMcpHandler(auth);
  const missingResponse = await missing.fetch(modernRequest("tools/list", {}, { "mcp-method": "" }));
  assert.equal(missingResponse.status, 400);
  await missing.close();

  const mismatched = createNeverlandMcpHandler(auth);
  const mismatchResponse = await mismatched.fetch(modernRequest("tools/list", {}, { "mcp-method": "tools/call" }));
  assert.equal(mismatchResponse.status, 400);
  await mismatched.close();
});
